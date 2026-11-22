"use client";

import { Mic } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useStore } from "@/lib/store";
import type { Change } from "@/lib/types";
import { connectRealtime, voiceApi, type MemoryItem, type Speaker, type VoiceState, type VoiceStatus } from "@/lib/voice";
import { Button } from "./ui";

type Connection = { abort: AbortController; stream?: MediaStream; timer?: number };

type Line = { speaker: Speaker; text: string; grounded: boolean };

export function VoicePanel({ person, active, setActive }: { person: string; active: boolean; setActive: (active: boolean) => void }) {
  const { draft, addChanges, name } = useStore();
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [state, setState] = useState<VoiceState>("connecting");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Change[]>([]);
  const draftRef = useRef(draft);
  const connection = useRef<Connection | null>(null);

  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => {
    let live = true;
    void voiceApi.status().then((value) => { if (live) setStatus(value); }).catch(() => {
      if (live) setNotice("Voice status is unavailable.");
    });
    void voiceApi.memory(person).then((value) => { if (live) setMemory(value.memory); }).catch(() => {});
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
    if (message) setNotice(message);
  }, [release, setActive]);

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
    let lastActivity = Date.now();
    const activity = () => { lastActivity = Date.now(); };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
      if (current.abort.signal.aborted) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      current.stream = stream;
      const session = await voiceApi.start(person, current.abort.signal);
      if (current.abort.signal.aborted) return;
      function tick() {
        const seconds = Math.max(0, Math.ceil(session.ends_at - Date.now() / 1000));
        setRemaining(seconds);
        if (!seconds) end("Voice reached its session time limit.");
        else if (Date.now() - lastActivity >= session.idle_seconds * 1000) end("Voice ended after inactivity.");
      }
      activity();
      tick();
      current.timer = window.setInterval(tick, 250);
      await connectRealtime({
        session, stream, signal: current.abort.signal, activity, state: setState, error: end,
        transcript: async (speaker, text) => {
          const result = await voiceApi.ingest(session.session_id, speaker, text, current.abort.signal);
          if (current.abort.signal.aborted) return;
          setMemory(result.memory);
          setLines((previous) => [...previous.slice(-7), { speaker, text, grounded: result.grounded }]);
        },
        tool: async (...args) => {
          const result = await voiceApi.tool(session.session_id, ...args, draftRef.current, current.abort.signal);
          if (current.abort.signal.aborted) return {};
          if (result.draft_changes?.length) setPending(result.draft_changes);
          if (result.memory) setMemory(result.memory);
          return result;
        },
      });
    } catch (error) {
      if (!current.abort.signal.aborted) end(error instanceof Error ? error.message : "Voice could not start.");
    }
  }

  async function resolve(id: number, action: "confirm" | "reject") {
    try {
      setMemory((await voiceApi.resolve(person, id, action)).memory);
    } catch {
      setNotice("Could not update discovery memory.");
    }
  }

  async function confirmedGoals() {
    try {
      const { session_id } = await voiceApi.startText(person);
      const result = await voiceApi.tool(session_id, "propose_changes", { from_confirmed_goals: true }, draftRef.current);
      setPending(result.draft_changes ?? []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not draft confirmed goals.");
    }
  }

  const shown = memory.filter((item) => item.status !== "rejected").slice(-12);
  return (
    <section aria-label="Voice discovery" className="mb-2 space-y-2 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        {active ? <p aria-live="polite" className="capitalize text-muted">
          {state}{remaining !== null && <span className="tnum ml-2">· {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</span>}
        </p> : (
          <Button variant="ghost" size="sm" onClick={() => void start()} disabled={!status?.enabled}>
            <Mic size={15} /> Voice discovery
          </Button>
        )}
        {active && <Button size="sm" variant="secondary" onClick={() => end()}>End</Button>}
      </div>
      {status?.reason && <p className="text-[12px] text-muted">{status.reason}</p>}
      {notice && <p role="status" className="text-[12px] text-warn">{notice}</p>}
      {active && <p className="text-[12px] text-muted">AI assistant · {name(person)}’s discovery · synthetic data and simulations</p>}
      {lines.length > 0 && <details>
        <summary className="cursor-pointer font-medium text-accent">Transcript</summary>
        <ul className="mt-1 space-y-1 text-[12px]">
          {lines.map((line, i) => <li key={i}><b>{line.speaker === "user" ? "You" : "AI"}:</b> {line.text}
            {!line.grounded && <span className="ml-1 text-warn">Unverified numbers</span>}</li>)}
        </ul>
      </details>}
      {shown.length > 0 && <details open={active || undefined}>
        <summary className="cursor-pointer font-medium text-accent">What I understood</summary>
        <ul className="mt-1 max-h-40 divide-y divide-line overflow-y-auto">
          {shown.map((item) => <li key={item.id} className="flex items-start justify-between gap-2 py-1.5">
            <div className="min-w-0">
              <p className="break-words"><b>{item.key.replaceAll("_", " ").replace(".", " · ")}</b> {item.value ?? item.why}</p>
              {item.quote && <q className="text-[12px] text-muted">{item.quote}</q>}
              <p className="text-[11px] text-muted">{item.status === "confirmed" ? "Confirmed" : item.kind === "unknown" ? "Unknown" : "To confirm"}</p>
            </div>
            {item.status === "pending" && <div className="flex shrink-0 flex-col gap-1 text-[11px]">
              {item.kind !== "unknown" && <button type="button" className="text-accent" onClick={() => void resolve(item.id, "confirm")}>Confirm</button>}
              <button type="button" className="text-muted" onClick={() => void resolve(item.id, "reject")}>Reject</button>
            </div>}
          </li>)}
        </ul>
        {shown.some((item) => item.status === "confirmed" && item.value !== null) &&
          <Button size="sm" variant="secondary" onClick={() => void confirmedGoals()}>Draft confirmed goals</Button>}
      </details>}
      {pending.length > 0 && <div className="flex items-center justify-between gap-2 rounded-xl bg-page p-2">
        <span>Plan changes are ready to review.</span>
        <Button size="sm" variant="primary" onClick={() => { addChanges(pending); setPending([]); }}>Add to draft</Button>
      </div>}
      {status && <button type="button" className="text-[12px] text-muted underline"
        onClick={async () => {
          end();
          try {
            await voiceApi.clear(person);
            setMemory([]);
            setLines([]);
            setPending([]);
            setNotice("Discovery memory and transcripts cleared.");
          } catch { setNotice("Could not clear discovery memory."); }
        }}>Clear discovery memory</button>}
    </section>
  );
}
