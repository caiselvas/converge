"use client";

import { ArrowLeft, ArrowUp, CircleUserRound, Loader2, MessagesSquare, Phone } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { monthLabel } from "@/lib/format";
import { scopedHref, useStore } from "@/lib/store";
import type { Change, WhatIfResult } from "@/lib/types";
import { voiceApi, type ToolActivity } from "@/lib/voice";
import { ToolActivityLog } from "./ToolActivityLog";
import { ComparisonCards } from "./WhatIfExplorer";
import { Button, clsx } from "./ui";

interface Turn {
  speaker: "user" | "assistant";
  text: string;
  comparisons?: WhatIfResult[];
  changes?: Change[];
  basis?: string;
  activity?: ToolActivity[];
}

const prompts = [
  "Compare moving in together using our current plan’s move-in date and rent. How does each cash buffer change?",
  "I’m considering a master’s. Can we explore the costs and how much I can keep working?",
  "Can we buy the planned home without either of us falling below our cash buffer?",
];

const providerNames = { openai: "OpenAI", openrouter: "OpenRouter", local: "Local model" };

export function FinanceAgent() {
  const { viewer, ws } = useStore();
  return ws && viewer ? <Conversation key={viewer} person={viewer} /> : null;
}

function Conversation({ person }: { person: string }) {
  const { scope, name, draft, addChanges, ws } = useStore();
  const [status, setStatus] = useState<Awaited<ReturnType<typeof voiceApi.chatStatus>>>();
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<ToolActivity[]>([]);
  const [error, setError] = useState("");
  const [addedTurn, setAddedTurn] = useState<number>();
  const session = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const basis = JSON.stringify([draft, ws?.versions[0]?.id]);

  useEffect(() => {
    let mounted = true;
    void voiceApi.chatStatus().then((value) => { if (mounted) setStatus(value); }).catch(() => {
      if (mounted) setError("Could not check the finance agent connection.");
    });
    return () => { mounted = false; request.current?.abort(); };
  }, []);

  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [turns, busy, activity]);

  async function send(message: string) {
    const question = message.trim();
    if (!question || request.current || !status?.provider) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setActivity([]);
    setError("");
    setText("");
    setTurns((previous) => [...previous, { speaker: "user", text: question }]);
    try {
      session.current ??= (await voiceApi.startText(person)).session_id;
      if (controller.signal.aborted) return;
      const tools = new Map<number, ToolActivity>();
      const reply = await voiceApi.chat(session.current, question, draft, controller.signal, (entry) => {
        tools.set(entry.id, entry);
        setActivity([...tools.values()]);
      });
      setTurns((previous) => [
        ...previous, { speaker: "assistant", text: reply.text, comparisons: reply.comparisons, changes: reply.draft_changes,
          activity: [...tools.values()], basis },
      ]);
      setActivity([]);
    } catch (problem) {
      if (!controller.signal.aborted) {
        setError(problem instanceof Error ? problem.message : "The turn could not be completed.");
        setText(question);
        setTurns((previous) => previous.slice(0, -1));
      }
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(text);
  }

  return <div className="mx-auto mt-7">
    <Link href={scopedHref("/", scope)} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
      <ArrowLeft size={15} /> What-if explorer
    </Link>
    <div className="mb-6 mt-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-4xl font-semibold tracking-[-0.05em]">Your finance agent</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">Talk through a goal, test a decision against your financial twin, or explore where you and your partner could compromise.</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <Link href={scopedHref("/profile", scope)} className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
          <CircleUserRound size={16} /> {name(person)}’s profile
        </Link>
        <Link href={scopedHref("/call", scope)} className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline md:hidden">
          <Phone size={15} /> Voice call
        </Link>
      </div>
    </div>

    <div>
      <section className="flex min-h-[min(650px,72dvh)] min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-white" aria-label="Finance agent chat">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="flex items-center gap-2 font-semibold"><MessagesSquare size={18} className="text-accent" /> Chat</h2>
          <span className="text-right text-xs text-muted">{status?.provider ? providerNames[status.provider] : status ? "Agent unavailable" : "Checking connection…"}</span>
        </div>
        <div ref={scroll} role="log" aria-live="polite" className="max-h-[58dvh] flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          {!turns.length && <div className="py-3">
            <h3 className="text-xl font-semibold tracking-tight">What are you deciding?</h3>
            <p className="mb-4 mt-1 text-sm text-muted">Start with a question about your plan or tell me what matters to you.</p>
            <div className="grid gap-2">
              {prompts.map((prompt) => <button type="button" key={prompt} disabled={!status?.provider || busy}
                onClick={() => void send(prompt)} className="rounded-xl border border-line bg-page px-3 py-2.5 text-left text-sm text-ink-2 hover:border-accent disabled:opacity-50">{prompt}</button>)}
            </div>
          </div>}
          {turns.map((turn, index) => <article key={index} className={clsx("rounded-xl p-3.5 sm:p-4", turn.speaker === "user" ? "ml-auto max-w-[90%] bg-[#e2f1ec]" : "bg-page")}>
            <p className="mb-1 text-xs font-semibold text-muted">{turn.speaker === "user" ? "You" : "Finance agent"}</p>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{turn.text}</p>
            {!!turn.activity?.length && <div className="mt-3"><ToolActivityLog entries={turn.activity} /></div>}
            {turn.comparisons?.map((comparison, i) => <div className="mt-3" key={i}>
              <p className="mb-2 text-xs font-medium text-muted">Engine comparison · {monthLabel(comparison.start)} to {monthLabel(comparison.end)}</p>
              <ComparisonCards result={comparison} compact />
            </div>)}
            {!!turn.changes?.length && <Button className="mt-3" size="sm" variant="secondary" disabled={turn.basis !== basis || addedTurn === index}
              onClick={() => { addChanges(turn.changes ?? []); setAddedTurn(index); }}>
              {addedTurn === index ? "Added to draft" : turn.basis === basis ? "Add to draft for review" : "Plan changed · rerun before adding"}
            </Button>}
          </article>)}
          <ToolActivityLog entries={activity} />
          {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted"><Loader2 className="animate-spin" size={16} /> Finance agent is working…</p>}
        </div>
        <form onSubmit={submit} className="border-t border-line p-4">
          {error && <p role="alert" className="mb-2 text-sm text-bad-strong">{error}</p>}
          <div className="flex items-end gap-2 rounded-xl border border-line-strong px-3 py-2 focus-within:border-accent">
            <textarea aria-label="Message the finance agent" placeholder="Message the finance agent…"
              maxLength={4000} rows={2} disabled={busy || !status?.provider} value={text}
              onChange={(event) => setText(event.target.value)} onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send(text);
                }
              }} className="min-w-0 flex-1 resize-y bg-transparent py-1 text-sm outline-none" />
            <Button type="submit" aria-label="Send message" variant="primary" size="sm" disabled={!text.trim() || busy || !status?.provider} className="rounded-full bg-[#146b57] p-2">
              <ArrowUp size={18} />
            </Button>
          </div>
        </form>
      </section>

    </div>
  </div>;
}
