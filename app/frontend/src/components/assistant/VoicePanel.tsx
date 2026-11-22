"use client";

import { ArrowLeft, AudioLines, Mic, Phone, PhoneOff, Volume2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { scopedHref, useStore } from "@/lib/store";
import type { Change, WhatIfResult } from "@/lib/types";
import { connectLocal, connectRealtime, voiceApi, type Speaker, type ToolActivity, type Transport, type VoiceState, type VoiceStatus } from "@/lib/voice";
import { Button, clsx } from "../ui";
import { EvidenceCards, ToolActivityLog } from "./Evidence";

type Connection = { abort: AbortController; stream?: MediaStream; timer?: number };
type Line = { speaker: Speaker; text: string; grounded: boolean };

const STATE_TEXT: Record<VoiceState, string> = { connecting: "Connecting…", listening: "Listening", thinking: "Thinking", speaking: "Speaking" };

/** Optional voice conversation with the same engine tools as the text assistant. */
export function VoicePanel({ person }: { person: string }) {
  const { draft, addChanges, name } = useStore();
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [tools, setTools] = useState<ToolActivity[]>([]);
  const [state, setState] = useState<VoiceState>("connecting");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [capture, setCapture] = useState<((enabled: boolean) => void) | null>(null);
  const [talking, setTalking] = useState(false);
  const [resumeAudio, setResumeAudio] = useState<(() => Promise<void>) | null>(null);
  const [pending, setPending] = useState<Change[]>([]);
  const [comparison, setComparison] = useState<WhatIfResult>();
  const draftRef = useRef(draft);
  const connection = useRef<Connection | null>(null);

  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => {
    let live = true;
    void voiceApi.status().then((value) => { if (live) setStatus(value); }).catch(() => {
      if (live) setNotice("Voice status is unavailable.");
    });
    return () => { live = false; };
  }, [person]);

  const release = useCallback(() => {
    const current = connection.current;
    connection.current = null;
    if (!current) return;
    current.abort.abort();
    current.stream?.getTracks().forEach((track) => track.stop());
    window.clearInterval(current.timer);
  }, []);

  const end = useCallback((message?: string) => {
    release();
    setActive(false);
    setRemaining(null);
    setCapture(null);
    setTalking(false);
    setResumeAudio(null);
    setTools((entries) => entries.map((entry) => entry.status === "running" ? { ...entry, status: "failed" } : entry));
    if (message) setNotice(message);
  }, [release]);

  useEffect(() => {
    const onHide = () => { if (document.hidden && connection.current) end("The call ended when the page was hidden."); };
    const onPageHide = () => { if (connection.current) end(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      release();
    };
  }, [end, release]);

  async function start() {
    if (!status?.enabled || connection.current) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setNotice("The microphone needs HTTPS or localhost.");
      return;
    }
    const current: Connection = { abort: new AbortController() };
    connection.current = current;
    setActive(true);
    setState("connecting");
    setNotice(null);
    setLines([]);
    setTools([]);
    setPending([]);
    setComparison(undefined);
    let lastActivity = Date.now();
    const activity = () => { lastActivity = Date.now(); };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (current.abort.signal.aborted) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      current.stream = stream;
      const session = await voiceApi.start(person, current.abort.signal);
      if (current.abort.signal.aborted) return;
      let busy = session.provider === "local";
      let toolId = 0;
      function tick() {
        const seconds = Math.max(0, Math.ceil(session.ends_at - Date.now() / 1000));
        setRemaining(seconds);
        if (!seconds) end("The call reached its time limit.");
        else if (!busy && Date.now() - lastActivity >= session.idle_seconds * 1000) end("The call ended after inactivity.");
      }
      activity();
      tick();
      current.timer = window.setInterval(tick, 250);
      const onResult = (result: Awaited<ReturnType<typeof voiceApi.tool>>) => {
        if (current.abort.signal.aborted) return;
        if (result.draft_changes?.length) setPending(result.draft_changes);
        if ("scenario" in result && "baseline" in result) setComparison(result as unknown as WhatIfResult);
        if (result.comparison) setComparison(result.comparison);
      };
      const options: Transport = {
        session, stream, signal: current.abort.signal, activity, error: end,
        state: (next) => {
          busy = next === "thinking" || next === "speaking";
          activity();
          setState(next);
          if (next !== "listening") setTalking(false);
        },
        transcript: async (speaker, text, check) => {
          const result = check === undefined ? await voiceApi.ingest(session.session_id, speaker, text, current.abort.signal) : null;
          if (current.abort.signal.aborted) return;
          setLines((previous) => [...previous.slice(-7), { speaker, text, grounded: check ?? result?.grounded ?? true }]);
        },
        tool: async (...args) => {
          const id = ++toolId;
          setTools((entries) => [...entries.slice(-7), { id, name: args[0], status: "running" }]);
          function finish(status: "done" | "failed") {
            if (!current.abort.signal.aborted) setTools((entries) => entries.map((entry) => entry.id === id ? { ...entry, status } : entry));
          }
          try {
            const result = await voiceApi.tool(session.session_id, ...args, draftRef.current, current.abort.signal);
            if (current.abort.signal.aborted) return {};
            finish("error" in result ? "failed" : "done");
            onResult(result);
            return result;
          } catch (error) {
            finish("failed");
            throw error;
          }
        },
      };
      if (session.provider === "local") {
        const talk = await connectLocal({ ...options, onResult, draft: () => draftRef.current });
        if (!current.abort.signal.aborted) setCapture(() => talk);
      } else {
        await connectRealtime({
          ...options,
          notice: setNotice,
          onPlaybackBlocked: (play) => {
            if (!current.abort.signal.aborted) setResumeAudio(() => play);
          },
        });
      }
    } catch (error) {
      if (!current.abort.signal.aborted) end(error instanceof Error ? error.message : "The call could not start.");
    }
  }

  const transport = status?.provider === "local" ? "On-device speech · push to talk" : status?.provider === "openai_realtime" ? "OpenAI Realtime audio" : "Voice is off";

  return (
    <section aria-label="Voice call" className="space-y-3">
      <div className="rounded-3xl border border-line bg-white px-5 py-8 text-center shadow-card">
        <div className={clsx("mx-auto grid size-20 place-items-center rounded-full", active ? "bg-ink text-white" : "bg-sunken text-ink",
          active && state === "speaking" && "pulse-soft")}>
          {active ? <AudioLines size={30} /> : <Phone size={26} />}
        </div>
        <h2 className="mt-4 text-[19px] font-semibold tracking-tight">{active ? STATE_TEXT[talking ? "listening" : state] : "Voice call"}</h2>
        <p className="mt-1 text-[13.5px] text-muted">
          {transport}{active && remaining !== null && <span className="tnum"> · {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")} left</span>}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {active ? <>
            {capture && <Button size="lg" variant="secondary" className="rounded-full" disabled={state !== "listening" && !talking}
              onClick={() => { capture(!talking); setTalking(!talking); }}><Mic size={17} /> {talking ? "Send" : "Start talking"}</Button>}
            <Button size="lg" className="rounded-full bg-bad-strong text-white hover:bg-[#912018]" onClick={() => end()}><PhoneOff size={17} /> End call</Button>
            {resumeAudio && <Button size="lg" variant="secondary" className="rounded-full" onClick={() => {
              void resumeAudio().then(() => setResumeAudio(null)).catch(() => setNotice("Could not play audio. Check your browser’s sound settings."));
            }}><Volume2 size={17} /> Enable sound</Button>}
          </> : <Button size="lg" variant="primary" className="rounded-full px-6" onClick={() => void start()} disabled={!status?.enabled}>
            <Phone size={17} /> {status ? "Start call" : "Checking voice…"}
          </Button>}
        </div>
        {active && <p className="mt-4 text-[12.5px] text-muted">AI assistant · speaking with {name(person)} · figures come from the engine</p>}
      </div>
      {status?.reason && <p className="px-1 text-[13.5px] text-muted">{status.reason}</p>}
      {notice && <p role="status" className="px-1 text-[13.5px] text-warn">{notice}</p>}
      <ToolActivityLog entries={tools} />
      {lines.length > 0 && <details open={active || undefined} className="rounded-2xl border border-line bg-white px-4 py-3">
        <summary className="min-h-8 cursor-pointer text-[14px] font-medium text-ink">Transcript</summary>
        <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto text-[14px] leading-6">
          {lines.map((line, i) => <li key={i}><b>{line.speaker === "user" ? "You" : "Assistant"}:</b> {line.text}
            {!line.grounded && <span className="ml-1 text-[12.5px] text-warn">· unverified numbers</span>}</li>)}
        </ul>
      </details>}
      {comparison && <div className="rounded-2xl border border-line bg-white p-4"><EvidenceCards result={comparison} /></div>}
      {pending.length > 0 && <div className="flex items-center justify-between gap-2 rounded-2xl border border-line bg-white p-3 text-[14px]">
        <span>Plan changes are ready to review.</span>
        <Button size="sm" variant="primary" onClick={() => { addChanges(pending); setPending([]); }}>Add to my draft</Button>
      </div>}
    </section>
  );
}

/** Dedicated voice screen (deep link /call). Optional; text planning works without it. */
export function CallPage() {
  const { scope, viewer, openAssistant } = useStore();
  return (
    <div className="mx-auto max-w-md pt-5 sm:pt-8">
      <Link href={scopedHref("/", scope)} className="inline-flex min-h-10 items-center gap-1 text-[14px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={15} /> Overview
      </Link>
      <h1 className="mt-1 text-[26px] leading-tight font-semibold tracking-[-0.02em]">Talk it through</h1>
      <p className="mt-1.5 mb-5 text-[15px] leading-6 text-muted">
        Say what you’re working toward and what you’d like to protect. Notes go to your profile for you to confirm; no audio is stored.
      </p>
      {viewer && <VoicePanel key={viewer} person={viewer} />}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[14px] font-medium">
        <Link href={scopedHref("/profile", scope)} className="min-h-10 content-center text-ink-2 hover:text-ink">Review your profile</Link>
        <button type="button" onClick={() => openAssistant()} className="min-h-10 text-accent hover:underline">Type instead</button>
      </div>
    </div>
  );
}
