"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { AssumptionRow } from "@/lib/types";
import { SourceTag } from "./ui";

function fmt(r: AssumptionRow): string | null {
  if (r.value === null || r.value === undefined) return null;
  if (r.unit?.startsWith("CHF")) return `CHF ${Math.round(r.value).toLocaleString("de-CH")}${r.unit === "CHF/month" ? "/month" : ""}`;
  if (r.unit === "years") return `${r.value} years`;
  return `${(r.value * 100).toFixed(2).replace(/\.?0+$/, "")}% ${r.unit ?? ""}`;
}

export function Sources() {
  const { ws } = useStore();
  const [rows, setRows] = useState<AssumptionRow[] | null>(null);
  useEffect(() => {
    api.assumptions().then(setRows).catch(() => setRows([]));
  }, [ws?.versions.length]);
  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-5 text-ink-2">
        Every number in Converge is either taken from the UBS synthetic dataset, derived from it, taken from a published source, or an explicit
        assumption you can change. Projections are conditional on these assumptions — they are not forecasts, and the indicative affordability check is not a lender decision.
      </p>
      <p className="text-[13px] leading-5 text-ink-2">
        The voice discovery assistant is AI and uses the synthetic twin. The engine supplies all plan results as simulations.
        You can skip sensitive questions and clear your viewer’s transcript and memory from Ask.
        Converge keeps that text in local SQLite and saves no audio. Hosted voice sends live audio to OpenAI for processing.
      </p>
      <div className="flex flex-wrap gap-2 text-[11.5px] text-muted">
        <span className="flex items-center gap-1"><SourceTag kind="dataset" /> UBS synthetic data</span>
        <span className="flex items-center gap-1"><SourceTag kind="official" /> bank / authority publication</span>
        <span className="flex items-center gap-1"><SourceTag kind="illustrative" /> modelling choice</span>
      </div>
      <div className="divide-y divide-line rounded-2xl border border-line bg-white">
        {(rows ?? []).map((r) => (
          <div key={r.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-medium">{r.name}</span>
                <SourceTag kind={r.kind} />
              </div>
              {fmt(r) && <span className="tnum text-[13px] font-semibold">{fmt(r)}</span>}
            </div>
            <p className="mt-1 text-[12.5px] leading-5 text-muted">{r.note}</p>
            {r.source_detail && (
              <div className="mt-1 text-[11.5px] text-subtle">
                {r.source_detail.url ? (
                  <a href={r.source_detail.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                    {r.source_detail.name} <ExternalLink size={11} />
                  </a>
                ) : r.source_detail.name}{" "}
                · {r.source_detail.date}
              </div>
            )}
          </div>
        ))}
        {!rows && <div className="p-4 text-[13px] text-muted">Loading…</div>}
      </div>
    </div>
  );
}
