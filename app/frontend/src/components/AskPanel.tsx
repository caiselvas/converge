"use client";

import { CornerDownLeft, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, llmProviderLabel } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { InterpretResponse } from "@/lib/types";
import { ChangeRow } from "./DraftBar";
import { Button } from "./ui";

export function AskPanel({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  const { viewer, draft, scopedPerson, addChanges, toast } = useStore();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InterpretResponse | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) input.current?.focus();
        else setOpen(true);
      }
      if (open && e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  async function run() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      setResult(await api.interpret(text, scopedPerson?.id ?? viewer, draft));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return (
    <button type="button" aria-label="Ask" aria-expanded={false} onClick={() => setOpen(true)}
      className="pointer-events-auto mb-2 grid h-12 w-12 place-items-center self-end rounded-full bg-ink text-white shadow-lg md:hidden">
      <Sparkles size={19} />
    </button>
  );

  return (
    <section id="ask-panel" aria-labelledby="ask-title" role="dialog" aria-modal="false"
      className="pointer-events-auto mb-2 max-h-[min(52dvh,480px)] overflow-y-auto rounded-2xl border border-line bg-white p-4 shadow-xl md:fixed md:top-[3.75rem] md:right-[max(1.5rem,calc((100%-1072px)/2))] md:w-[420px]">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="ask-title" className="text-[15px] font-semibold">Ask</h2>
        <Button variant="ghost" size="sm" aria-label="Close Ask" onClick={() => setOpen(false)}><X size={16} /></Button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="relative">
        <input ref={input} autoFocus value={text} maxLength={1000} onChange={(e) => setText(e.target.value)}
          aria-label="Describe a change in your own words" placeholder="Emil takes 12 months off from Jan 2028"
          className="h-10 w-full rounded-full border border-line-strong bg-white pr-10 pl-4 text-[14px] outline-none placeholder:text-subtle focus:ring-2 focus:ring-accent/30" />
        <button type="submit" aria-label="Interpret" disabled={busy || !text.trim()}
          className="absolute top-1/2 right-1.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-ink text-white disabled:opacity-30">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <CornerDownLeft size={13} />}
        </button>
      </form>
      {result && <div aria-live="polite" className="mt-3">
        <p className="text-[12px] text-muted">{result.mode === "llm" && result.provider ? `Understood by ${llmProviderLabel[result.provider]} · checked by the engine` : "Understood by the built-in parser"}</p>
        {result.notice && <p className="mt-1 text-[12px] text-warn">{result.notice}</p>}
        <div className="mt-2 divide-y divide-line">{result.described.map((c) => <ChangeRow key={c.path} c={c} />)}</div>
        {result.clarification && <p className="mt-2 text-[13px] text-warn">{result.clarification}</p>}
        {result.changes.length > 0 && <Button variant="primary" className="mt-3 w-full" onClick={() => {
          addChanges(result.changes);
          setResult(null);
          setText("");
          setOpen(false);
        }}>Try this</Button>}
      </div>}
    </section>
  );
}
