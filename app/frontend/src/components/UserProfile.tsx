"use client";

import { Check, CircleUserRound, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { chf, monthLabel } from "@/lib/format";
import { scopedHref, useStore } from "@/lib/store";
import type { Person } from "@/lib/types";
import { voiceApi, type MemoryItem } from "@/lib/voice";
import { Avatar, Button } from "./ui";

const sections: { key: MemoryItem["dimension"]; title: string }[] = [
  { key: "goals", title: "Goals and motivations" },
  { key: "priorities", title: "Priorities and decisions" },
  { key: "timelines", title: "Timelines" },
  { key: "risk_flexibility", title: "Limits and trade-offs" },
  { key: "feasibility", title: "Questions about what’s affordable" },
];

const fieldLabels: Record<string, string> = {
  stated_goal: "Goal",
  underlying_objective: "What matters about it",
  constraints: "Constraint",
  flexibility: "What you’re willing to change",
  date: "Target date",
  amount: "Target amount",
  decision_status: "Decision",
  alternatives: "Options discussed",
};

function words(value: string) {
  return value.replace(/[_-]/g, " ");
}

function itemTitle(key: string) {
  const [topic, field] = key.split(".");
  if (!field) return words(topic);
  if (topic === "skip") return `Skipped topic · ${words(field)}`;
  return `${words(topic)} · ${fieldLabels[field] ?? words(field)}`;
}

function itemValue(item: MemoryItem) {
  if (item.kind === "unknown") return item.why;
  if (typeof item.value === "number" && item.key.endsWith(".amount")) return chf(item.value);
  if (typeof item.value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(item.value)) return monthLabel(item.value);
  return item.value;
}

export function UserProfile() {
  const { plan, viewer, idx, scope } = useStore();
  const person = plan?.people.find((candidate) => candidate.id === viewer);
  return person ? <Profile key={person.id} person={person} index={idx(person.id)} chatHref={scopedHref("/agent", scope)} /> : null;
}

function Profile({ person, index, chatHref }: { person: Person; index: number; chatHref: string }) {
  const [items, setItems] = useState<MemoryItem[]>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [notice, setNotice] = useState("");
  const visible = items?.filter((item) => item.status !== "rejected") ?? [];

  useEffect(() => {
    const request = new AbortController();
    void voiceApi.memory(person.id, request.signal)
      .then((response) => { if (!request.signal.aborted) setItems(response.memory); })
      .catch(() => { if (!request.signal.aborted) setLoadError(true); });
    return () => request.abort();
  }, [person.id, loadAttempt]);

  async function review(item: MemoryItem, action: "confirm" | "reject") {
    setBusy(true);
    setNotice("");
    try {
      setItems((await voiceApi.resolve(person.id, item.id, action)).memory);
      setNotice(action === "confirm" ? "Confirmed in your profile." : "Removed from your profile.");
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
      setNotice("Cleared your profile observations and conversation history.");
    } catch {
      setNotice("Could not clear your profile. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-7">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-[#122e2a] px-6 py-7 text-white sm:px-8">
        <div className="flex items-center gap-4">
          <Avatar name={person.name} index={index} size={50} />
          <div>
            <p className="text-sm font-medium text-emerald-100">Your profile</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{person.name}</h1>
          </div>
        </div>
        <Link href={chatHref} className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-2.5 text-sm font-semibold text-[#122e2a] hover:bg-white">
          <MessagesSquare size={16} /> Open agent chat
        </Link>
      </header>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section aria-labelledby="discovery-heading" className="min-w-0 space-y-3">
          <h2 id="discovery-heading" className="text-xl font-semibold tracking-tight">What the agent has learned</h2>
          <p className="text-sm text-muted">Review what you’ve shared and check the agent’s interpretations. Confirm what fits and remove what doesn’t.</p>
          {loadError && <div role="alert" className="rounded-2xl border border-line bg-white p-5 text-sm">
            Could not load your profile.
            <Button className="ml-3" size="sm" onClick={() => { setLoadError(false); setLoadAttempt((n) => n + 1); }}>Retry</Button>
          </div>}
          {!items && !loadError && <p role="status" className="py-4 text-sm text-muted">Loading profile…</p>}
          {items && visible.length === 0 && <div className="rounded-2xl border border-line bg-white p-6">
            <CircleUserRound size={24} className="mb-3 text-accent" />
            <h3 className="font-semibold">Your discovery profile is empty</h3>
            <p className="mt-1 text-sm text-muted">Tell the agent what you’re working toward, what’s driving it, and what you’d like to protect.</p>
          </div>}
          {sections.map(({ key, title }) => {
            const entries = visible.filter((item) => item.dimension === key);
            if (!entries.length) return null;
            return <section key={key} className="rounded-2xl border border-line bg-white px-5 py-4">
              <h3 className="font-semibold">{title}</h3>
              <ul className="mt-2 divide-y divide-line">
                {entries.map((item) => {
                  const title = itemTitle(item.key);
                  const canConfirm = item.kind !== "unknown" &&
                    (item.kind === "fact" || !item.key.endsWith(".underlying_objective"));
                  const status = item.status === "confirmed" ? "Confirmed" : item.kind === "inference" ? "Agent interpretation" :
                    item.kind === "unknown" ? "Open question" : "From your conversation";
                  return <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                    <div className="min-w-0 flex-1 basis-52">
                      <p className="text-xs font-medium text-muted first-letter:uppercase">{title} · {status}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm font-medium">{itemValue(item)}</p>
                      {item.quote && item.quote !== item.value && <q className="mt-1 block break-words text-xs text-muted">{item.quote}</q>}
                      {item.kind === "inference" && !canConfirm && <p className="mt-1 text-xs text-muted">To confirm this motivation, tell the agent in your own words.</p>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {item.status === "pending" && canConfirm && <Button size="sm" variant="ghost" disabled={busy}
                        aria-label={`Confirm ${title}`} onClick={() => void review(item, "confirm")}><Check size={14} /> Confirm</Button>}
                      <Button size="sm" variant="ghost" disabled={busy} aria-label={`Remove ${title}`}
                        onClick={() => void review(item, "reject")}>Remove</Button>
                    </div>
                  </li>;
                })}
              </ul>
            </section>;
          })}
          <p role="status" className="text-sm text-muted">{notice}</p>
        </section>

        <aside className="space-y-4" aria-label="Profile and plan details">
          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="font-semibold">From your agreed plan</h2>
            <dl className="mt-3 space-y-3 text-sm">
              <div><dt className="text-muted">Monthly net pay assumption</dt><dd className="mt-0.5 font-medium">{chf(person.income_monthly)}</dd></div>
              <div><dt className="text-muted">Cash buffer</dt><dd className="mt-0.5 font-medium">{chf(person.emergency_floor)}</dd></div>
              <div><dt className="text-muted">Saved goals</dt><dd className="mt-0.5 font-medium">{person.goals.length ? person.goals.map((goal) => goal.name).join(", ") : "None yet"}</dd></div>
            </dl>
          </section>
          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="font-semibold">Manage your profile</h2>
            <p className="mt-1 text-sm text-muted">Clear the agent’s notes and stored conversation history for {person.name}. This leaves the agreed financial plan in place.</p>
            {confirmClear ? <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="danger" disabled={busy} onClick={() => void clearProfile()}>Clear profile and history</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmClear(false)}>Cancel</Button>
            </div> : <Button className="mt-3" size="sm" variant="secondary" disabled={!items || busy}
              onClick={() => setConfirmClear(true)}>Clear profile…</Button>}
          </section>
        </aside>
      </div>
    </div>
  );
}
