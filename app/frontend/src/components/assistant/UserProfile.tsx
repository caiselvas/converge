"use client";

import { ArrowLeft, Check, CircleUserRound, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { chf, monthLabel } from "@/lib/format";
import { scopedHref, useStore } from "@/lib/store";
import type { Person } from "@/lib/types";
import { voiceApi, type MemoryItem } from "@/lib/voice";
import { Avatar, Badge, Button } from "../ui";

const SECTIONS: { key: MemoryItem["dimension"]; title: string }[] = [
  { key: "goals", title: "Goals and motivations" },
  { key: "priorities", title: "Priorities and decisions" },
  { key: "timelines", title: "Timelines" },
  { key: "risk_flexibility", title: "Limits and trade-offs" },
  { key: "feasibility", title: "Questions about what’s affordable" },
];

const FIELDS: Record<string, string> = {
  stated_goal: "Goal", underlying_objective: "What matters about it", constraints: "Constraint",
  flexibility: "What you’re willing to change", date: "Target date", amount: "Target amount",
  decision_status: "Decision", alternatives: "Options discussed", priority: "Priority",
};

const words = (value: string) => value.replace(/[_-]/g, " ");

function itemTitle(key: string) {
  const [topic, field] = key.split(".");
  if (!field) return words(topic);
  if (topic === "skip") return `Skipped topic · ${words(field)}`;
  return `${words(topic)} · ${FIELDS[field] ?? words(field)}`;
}

function itemValue(item: MemoryItem) {
  if (item.kind === "unknown") return item.why;
  if (typeof item.value === "number" && item.key.endsWith(".amount")) return chf(item.value);
  if (typeof item.value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(item.value)) return monthLabel(item.value);
  return item.value;
}

/** What the assistant has learned about the viewer. Only the viewer sees and manages it. */
export function UserProfile() {
  const { plan, viewer, idx } = useStore();
  const person = plan?.people.find((p) => p.id === viewer);
  return person ? <Profile key={person.id} person={person} index={idx(person.id)} /> : null;
}

function Profile({ person, index }: { person: Person; index: number }) {
  const { scope, openAssistant } = useStore();
  const [items, setItems] = useState<MemoryItem[]>();
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [notice, setNotice] = useState("");
  const visible = items?.filter((item) => item.status !== "rejected") ?? [];

  useEffect(() => {
    const request = new AbortController();
    void voiceApi.memory(person.id, request.signal)
      .then((r) => { if (!request.signal.aborted) { setItems(r.memory); setLoadError(false); } })
      .catch(() => { if (!request.signal.aborted) setLoadError(true); });
    return () => request.abort();
  }, [person.id, attempt]);

  async function review(item: MemoryItem, action: "confirm" | "reject") {
    setBusy(true);
    setNotice("");
    try {
      setItems((await voiceApi.resolve(person.id, item.id, action)).memory);
      setNotice(action === "confirm" ? "Confirmed. Planners can now offer it as a suggestion." : "Removed from your profile.");
    } catch {
      setNotice("Could not update your profile. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function clearProfile() {
    setBusy(true);
    setNotice("");
    try {
      setItems((await voiceApi.clear(person.id)).memory);
      setConfirmClear(false);
      setNotice("Cleared your profile notes and conversation history.");
    } catch {
      setNotice("Could not clear your profile. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[960px] pt-5 sm:pt-8">
      <Link href={scopedHref("/goals", scope)} className="inline-flex min-h-10 items-center gap-1 text-[14px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={15} /> Goals
      </Link>
      <header className="mt-1 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar name={person.name} index={index} size={48} />
          <div>
            <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">{person.name}’s assistant profile</h1>
            <p className="mt-0.5 text-[14.5px] text-muted">Only you can see and change this. Your partner has their own.</p>
          </div>
        </div>
        <Button variant="primary" onClick={() => openAssistant()}><Sparkles size={16} /> Talk to the assistant</Button>
      </header>

      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section aria-labelledby="learned" className="min-w-0 space-y-3">
          <h2 id="learned" className="text-[18px] font-semibold tracking-tight">What the assistant has noted</h2>
          <p className="text-[14.5px] leading-6 text-muted">
            Confirm what fits and remove what doesn’t. Planners only offer confirmed notes, as suggestions you can accept;
            nothing here changes your plan by itself.
          </p>
          {loadError && <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4 text-[14px]">
            Could not load your profile.
            <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>Retry</Button>
          </div>}
          {!items && !loadError && <p role="status" className="py-4 text-[14px] text-muted">Loading your profile…</p>}
          {items && visible.length === 0 && <div className="rounded-2xl border border-line bg-white p-6 shadow-card">
            <CircleUserRound size={24} className="mb-3 text-accent" />
            <h3 className="text-[16px] font-semibold">Nothing noted yet</h3>
            <p className="mt-1 text-[14px] leading-6 text-muted">Tell the assistant what you’re working toward, why it matters, and what you’d like to protect.</p>
          </div>}
          {SECTIONS.map(({ key, title }) => {
            const entries = visible.filter((item) => item.dimension === key);
            if (!entries.length) return null;
            return (
              <section key={key} className="rounded-2xl border border-line bg-white px-4 py-3 shadow-card sm:px-5">
                <h3 className="text-[15px] font-semibold">{title}</h3>
                <ul className="mt-1 divide-y divide-line">
                  {entries.map((item) => {
                    const label = itemTitle(item.key);
                    const canConfirm = item.kind !== "unknown" && (item.kind === "fact" || !item.key.endsWith(".underlying_objective"));
                    return (
                      <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                        <div className="min-w-0 flex-1 basis-52">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[12.5px] font-medium text-muted first-letter:uppercase">{label}</p>
                            {item.status === "confirmed" ? <Badge tone="good"><Check size={12} /> Confirmed</Badge>
                              : <Badge>{item.kind === "inference" ? "Assistant’s interpretation" : item.kind === "unknown" ? "Open question" : "Not confirmed"}</Badge>}
                          </div>
                          <p className="mt-1 text-[15px] font-medium break-words whitespace-pre-wrap">{itemValue(item)}</p>
                          {item.quote && item.quote !== item.value && <q className="mt-1 block text-[13px] break-words text-muted">{item.quote}</q>}
                          {item.kind === "inference" && !canConfirm && <p className="mt-1 text-[13px] text-muted">To confirm this, tell the assistant in your own words.</p>}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {item.status === "pending" && canConfirm && <Button size="sm" variant="secondary" disabled={busy}
                            aria-label={`Confirm ${label}`} onClick={() => void review(item, "confirm")}><Check size={14} /> Confirm</Button>}
                          <Button size="sm" variant="ghost" disabled={busy} aria-label={`Remove ${label}`} onClick={() => void review(item, "reject")}>Remove</Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          <p role="status" className="text-[14px] text-muted">{notice}</p>
        </section>

        <aside className="space-y-4" aria-label="Profile details">
          <section className="rounded-2xl border border-line bg-white p-5 shadow-card">
            <h2 className="text-[15px] font-semibold">From your agreed plan</h2>
            <dl className="mt-3 space-y-3 text-[14px]">
              <div><dt className="text-muted">Monthly net pay</dt><dd className="tnum mt-0.5 font-semibold">{chf(person.income_monthly)}</dd></div>
              <div><dt className="text-muted">Safety buffer</dt><dd className="tnum mt-0.5 font-semibold">{chf(person.emergency_floor)}</dd></div>
              <div><dt className="text-muted">Saved goals</dt><dd className="mt-0.5 font-semibold">{person.goals.length ? person.goals.map((g) => g.name).join(", ") : "None yet"}</dd></div>
            </dl>
          </section>
          <section className="rounded-2xl border border-line bg-white p-5 shadow-card">
            <h2 className="text-[15px] font-semibold">Erase your notes</h2>
            <p className="mt-1 text-[14px] leading-6 text-muted">Deletes the assistant’s notes and stored conversations for {person.name}. Your agreed plan stays as it is.</p>
            {confirmClear ? <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="danger" disabled={busy} onClick={() => void clearProfile()}>Erase notes and history</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmClear(false)}>Cancel</Button>
            </div> : <Button className="mt-3" size="sm" variant="secondary" disabled={!items || busy} onClick={() => setConfirmClear(true)}>Erase…</Button>}
          </section>
        </aside>
      </div>
    </div>
  );
}
