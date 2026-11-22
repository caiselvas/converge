"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { clsx } from "./ui";

export function PlanSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-line bg-white px-4 pt-4 pb-2 sm:px-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A quiet row that reveals its editor on click. */
export function EditRow({ label, sub, value, changed, children, defaultOpen = false }: {
  label: React.ReactNode; sub?: React.ReactNode; value: React.ReactNode; changed?: boolean; children?: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const Row = children ? "button" : "div";
  return (
    <div className="border-b border-line/80 last:border-b-0">
      <Row
        type={children ? "button" : undefined}
        onClick={children ? () => setOpen(!open) : undefined}
        aria-expanded={children ? open : undefined}
        className={clsx("flex w-full items-center justify-between gap-4 py-3 text-left", children && "group")}
      >
        <span className="min-w-0">
          <span className="block text-[14px] text-ink">{label}</span>
          {sub && <span className="block text-[12px] text-muted">{sub}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {changed && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="changed" />}
          <span className="tnum text-[14px] font-medium text-ink">{value}</span>
          {children && <ChevronDown size={15} className={clsx("text-subtle transition-transform group-hover:text-muted", open && "rotate-180")} />}
        </span>
      </Row>
      {open && children && <div className="fade-up pb-4">{children}</div>}
    </div>
  );
}
