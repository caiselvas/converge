"use client";

import { AudioLines, Mic, Phone, PhoneOff, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useStore } from "@/lib/store";
import { chf, monthLabel } from "@/lib/format";
import { addTimeline } from "@/lib/timeline-image";
import type { Change, WhatIfResult } from "@/lib/types";
import { connectLocal, connectRealtime, voiceApi, type Speaker, type ToolActivity, type Transport, type VoiceState, type VoiceStatus } from "@/lib/voice";
import { ToolActivityLog } from "./ToolActivityLog";
import { TimelineExport } from "./TimelineExport";
import { Button, clsx } from "./ui";
import { ComparisonCards } from "./WhatIfExplorer";

type Connection = { abort: AbortController; stream?: MediaStream; timer?: number };

type Line = { speaker: Speaker; text: string; grounded: boolean };

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
  const [commit, setCommit] = useState<(() => void) | null>(null);
  const [talking, setTalking] = useState(false);
  const [resumeAudio, setResumeAudio] = useState<(() => Promise<void>) | null>(null);
  const [pending, setPending] = useState<Change[]>([]);
  const [comparison, setComparison] = useState<WhatIfResult>();
  const [timelines, setTimelines] = useState<WhatIfResult[]>([]);
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
    setCommit(null);
    setTalking(false);
    setResumeAudio(null);
    setTools((entries) => entries.map((entry) => entry.status === "running" ? { ...entry, status: "failed" } : entry));
    if (message) setNotice(message);
  }, [release]);

  useEffect(() => {
    const onHide = () => { if (document.hidden && connection.current) end("Voice ended when the page was hidden."); };
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
    setTimelines([]);
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
        if (!seconds) end("Voice reached its session time limit.");
        else if (!busy && Date.now() - lastActivity >= session.idle_seconds * 1000) end("Voice ended after inactivity.");
      }
      activity();
      tick();
      current.timer = window.setInterval(tick, 250);
      function showComparison(result: WhatIfResult) {
        setComparison(result);
        setTimelines((previous) => addTimeline(previous, result));
      }
      const onResult = (result: Awaited<ReturnType<typeof voiceApi.tool>>) => {
        if (current.abort.signal.aborted) return;
        if (result.draft_changes?.length) setPending(result.draft_changes);
        if ("scenario" in result && "baseline" in result) showComparison(result as unknown as WhatIfResult);
        if (result.comparison) showComparison(result.comparison);
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
          const result = check === undefined ? await voiceApi.ingest(
            session.session_id, speaker, text, current.abort.signal, speaker === "user" ? draftRef.current : undefined,
          ) : null;
          if (current.abort.signal.aborted) return;
          setLines((previous) => [...previous.slice(-7), { speaker, text, grounded: check ?? result?.grounded ?? true }]);
          if (result?.study_preview) {
            const comparison = result.study_preview;
            const study = comparison.inputs.study;
            const id = ++toolId;
            setTools((entries) => [...entries.slice(-7), { id, name: "compare_study", status: "done" }]);
            showComparison(comparison);
            return "The app already ran this comparison for the current spoken turn. "
              + `Report this result before asking another question: ${comparison.speakable ?? ""} `
              + `Label these inputs as illustrative: ${comparison.assumed_inputs?.join(", ") || "none"}. `
              + (study ? `Extra study costs are ${chf(study.extra_cost_chf)}. Change to pay after study is ${chf(study.monthly_pay_delta)} per month. ` : "")
              + "Keep the reply short. No further tool call is needed for this comparison.";
          }
          if (result?.study_preview_error) {
            const id = ++toolId;
            setTools((entries) => [...entries.slice(-7), { id, name: "compare_study", status: "failed" }]);
            return `The app couldn't run the study comparison. Reason: ${result.study_preview_error}. Ask for the one input needed to move forward.`;
          }
        },
        tool: async (...args) => {
          const id = ++toolId;
          setTools((entries) => [...entries.slice(-7), { id, name: args[0], status: "running" }]);
          function finish(status: "done" | "failed") {
            if (!current.abort.signal.aborted) setTools((entries) => entries.map((entry) => entry.id === id ? { ...entry, status } : entry));
          }
          try {
            const result = await voiceApi.tool(session.session_id, ...args, draftRef.current, current.abort.signal, true);
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
        const sendTurn = await connectRealtime({
          ...options,
          notice: setNotice,
          onPlaybackBlocked: (play) => {
            if (!current.abort.signal.aborted) setResumeAudio(() => play);
          },
        });
        if (!current.abort.signal.aborted) setCommit(() => sendTurn);
      }
    } catch (error) {
      if (!current.abort.signal.aborted) end(error instanceof Error ? error.message : "Voice could not start.");
    }
  }

  return (
    <section aria-label="Voice call" className="space-y-3 rounded-2xl border border-line bg-white p-3 text-[13px]">
      <div className="rounded-xl bg-[#122e2a] px-5 py-6 text-center text-white">
        <div className={clsx("mx-auto grid size-16 place-items-center rounded-full border border-emerald-200/20 bg-[#27594b] text-emerald-100", active && state === "speaking" && "pulse-soft")}>
          {active ? <AudioLines size={26} /> : <Phone size={22} />}
        </div>
        <h2 className="mt-3 text-lg font-semibold tracking-tight">Voice call</h2>
        <p className="mt-1 text-xs text-emerald-50/80">{status?.provider === "local" ? "Local · Push to talk" : status?.provider === "openai_realtime" ? "OpenAI Realtime · In-app audio" : "In-app microphone and audio"}</p>
        {active ? <>
          <p aria-live="polite" className="my-3 capitalize text-emerald-100">
            {talking ? "Recording" : state}{remaining !== null && <span className="tnum ml-2">· {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</span>}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {capture && <Button size="sm" variant="secondary" disabled={state !== "listening" && !talking}
              onClick={() => { capture(!talking); setTalking(!talking); }}><Mic size={14} /> {talking ? "Send turn" : "Start talking"}</Button>}
            {commit && state === "listening" && <Button variant="secondary" className="min-h-11 rounded-full"
              onClick={commit}><Mic size={14} /> Done speaking</Button>}
            <Button variant="primary" className="min-h-11 rounded-full bg-[#a72f39] px-5 text-white hover:bg-[#8b2530]" onClick={() => end()}><PhoneOff size={15} /> End call</Button>
            {resumeAudio && <Button variant="secondary" className="min-h-11 rounded-full" onClick={() => {
              void resumeAudio().then(() => setResumeAudio(null)).catch(() => setNotice("Could not play audio. Check your browser’s sound settings."));
            }}><Volume2 size={15} /> Enable sound</Button>}
          </div>
        </> : <Button variant="secondary" className="mt-4 min-h-11 rounded-full bg-emerald-100 px-5 text-[#122e2a]"
          onClick={() => void start()} disabled={!status?.enabled}>
          <Phone size={15} /> {status ? "Start call" : "Checking voice…"}
        </Button>}
      </div>
      {status?.reason && <p className="px-2 text-xs text-muted">{status.reason}</p>}
      {notice && <p role="status" className="px-2 text-xs text-warn">{notice}</p>}
      {active && <p className="px-2 text-xs text-muted">AI finance agent · Speaking with {name(person)}</p>}
      <ToolActivityLog entries={tools} />
      {lines.length > 0 && <details open={active || undefined} className="px-2">
        <summary className="cursor-pointer font-medium text-accent">Transcript</summary>
        <ul className="mt-1 max-h-60 space-y-2 overflow-y-auto text-xs">
          {lines.map((line, i) => <li key={i}><b>{line.speaker === "user" ? "You" : "AI"}:</b> {line.text}
            {!line.grounded && <span className="ml-1 text-warn">Unverified numbers</span>}
            {line.speaker === "assistant" && line.text.indexOf("?") !== line.text.lastIndexOf("?") &&
              <span className="ml-1 text-warn">Multiple questions</span>}</li>)}
        </ul>
      </details>}
      {comparison && <details key={JSON.stringify(comparison.inputs.study)} open className="px-2">
        <summary className="cursor-pointer font-medium text-accent">Latest engine comparison</summary>
        {comparison.inputs.study && <p className="mt-2 text-xs text-muted">
          {comparison.inputs.study.program} · {monthLabel(comparison.inputs.study.start)} · {comparison.inputs.study.income_pct}% of normal pay
          · {chf(comparison.inputs.study.semester_fee_chf)} per semester
          {comparison.assumed_inputs?.length ? ` · Assumed ${comparison.assumed_inputs.join(", ")}` : ""}
        </p>}
        {comparison.inputs.study?.replaced_breaks?.map((event) => <p key={`${event.start}-${event.label}`} className="mt-1 text-xs text-muted">
          Study replaces {event.label} starting {monthLabel(event.start)} ({event.months} months) in the comparison. The baseline keeps it.
        </p>)}
        <div className="mt-2 [&>div]:grid-cols-1"><ComparisonCards result={comparison} compact /></div>
      </details>}
      {timelines.length > 0 && <div className="px-2"><TimelineExport results={timelines} /></div>}
      {pending.length > 0 && <div className="flex items-center justify-between gap-2 rounded-xl bg-page p-2">
        <span>Plan changes are ready to review.</span>
        <Button size="sm" variant="primary" onClick={() => { addChanges(pending); setPending([]); }}>Add to draft</Button>
      </div>}
    </section>
  );
}
