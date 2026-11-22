"use client";

import { ChevronDown, X } from "lucide-react";
import { useEffect, useState } from "react";

import { clsx } from "./ui";

/** Non-modal side panel: on desktop the plan stays visible (and updates live) next to it. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={typeof title === "string" ? title : "Details"}
      className="fade-up fixed inset-0 z-40 flex flex-col bg-white lg:inset-y-0 lg:right-0 lg:left-auto lg:top-14 lg:w-[440px] lg:border-l lg:border-line lg:shadow-[-12px_0_40px_rgb(15_23_42/0.06)]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
        <div className="min-w-0">{title}</div>
        <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-page hover:text-ink">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-28">{children}</div>
    </aside>
  );
}

export function SheetSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="pt-7">
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
  return (
    <div className="border-b border-line/80 last:border-b-0">
      <button
        type="button"
        onClick={() => children && setOpen(!open)}
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
      </button>
      {open && children && <div className="fade-up pb-4">{children}</div>}
    </div>
  );
}
