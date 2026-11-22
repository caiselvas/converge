import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDownToLine,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Ellipsis,
  ExternalLink,
  Flag,
  GraduationCap,
  Heart,
  Home,
  Layers3,
  Leaf,
  Link2,
  MapPin,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
  X,
  BriefcaseBusiness,
  Coffee,
  Baby,
  HandHeart,
  PanelRightClose,
  Activity,
  Upload,
  CalendarDays,
  Eye,
} from "lucide-react";
import {
  ageAt,
  EVENT_LABELS,
  monthDate,
  newEvent,
  simulate,
  validatePlan,
} from "../backend/engine";
import { createDemo, PRESETS, presetEvents } from "../backend/demo";
import { educationChecks, RULES } from "../backend/policy";
import { findSaferDates } from "../backend/search";
import type { TimingOption } from "../backend/search";
import type {
  Environment,
  EventKind,
  LifeEvent,
  Month,
  Person,
  Plan,
} from "../backend/types";
import type { UncertaintyResult } from "../backend/uncertainty";
import type { Observation } from "../backend/observations";

const STORAGE = "converge.plan.v1";
const money = (v: number, compact = false) =>
  new Intl.NumberFormat("en-CH", {
    style: "currency",
    currency: "CHF",
    maximumFractionDigits: 0,
    ...(compact ? { notation: "compact" as const } : {}),
  }).format(v);
const number = (v: number) =>
  new Intl.NumberFormat("en-CH", { maximumFractionDigits: 0 }).format(v);
const dateLabel = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const percent = (n: number) => `${Math.round(n * 100)}%`;
const icons: Record<EventKind, typeof Home> = {
  move: Home,
  study: GraduationCap,
  break: Coffee,
  home: Home,
  parttime: Leaf,
  business: BriefcaseBusiness,
  support: HandHeart,
  child: Baby,
};
const kindDescriptions: Record<EventKind, string> = {
  move: "Combine housing costs, keep your own safety nets.",
  study: "Make space for a degree and a different direction.",
  break: "A pause for travel, care, or just being.",
  home: "Explore the deposit, mortgage, and cash you keep.",
  parttime: "Trade some income for a little more life.",
  business: "Fund the runway before you take the leap.",
  support: "Make room for someone who matters.",
  child: "Plan for new costs and a growing household.",
};
function load(): Plan {
  try {
    const x = JSON.parse(localStorage.getItem(STORAGE) || "null");
    if (x) {
      validatePlan(x);
      return x;
    }
  } catch {
    /* Invalid older state is ignored; imported state is validated explicitly. */
  }
  return createDemo();
}
function App() {
  const [plan, setPlan] = useState<Plan>(load),
    [page, setPage] = useState("plan"),
    [tab, setTab] = useState("timeline");
  const [selected, setSelected] = useState<string | null>(
    plan.events.find((e) => e.kind === "study")?.id ?? null,
  );
  const [month, setMonth] = useState(Math.min(35, plan.months - 1)),
    [library, setLibrary] = useState(false),
    [showPresets, setShowPresets] = useState(false);
  const [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [scope, setScope] = useState<"all" | "a" | "b" | "shared">("all");
  const [metric, setMetric] = useState<"totalCash" | "netWorth">("totalCash"),
    [showRange, setShowRange] = useState(false);
  const [risk, setRisk] = useState<UncertaintyResult | null>(null),
    [riskBusy, setRiskBusy] = useState(false),
    [riskError, setRiskError] = useState("");
  const [history, setHistory] = useState<Plan[]>([]),
    [saved, setSaved] = useState(true),
    [ruleFilter, setRuleFilter] = useState("all");
  const [observations, setObservations] = useState<Observation[]>([]),
    [fetching, setFetching] = useState(false),
    [sourceError, setSourceError] = useState("");
  const [timing, setTiming] = useState<TimingOption[] | null>(null);
  const worker = useRef<Worker | null>(null),
    requestId = useRef(0),
    fileInput = useRef<HTMLInputElement>(null);
  const attempted = useMemo(() => {
    try {
      return { result: simulate(plan), error: "" };
    } catch (e) {
      return {
        result: null,
        error: e instanceof Error ? e.message : "Invalid plan",
      };
    }
  }, [plan]);
  const result = attempted.result;
  const baseline = useMemo(() => simulate({ ...plan, events: [] }), [plan]);
  const event = plan.events.find((e) => e.id === selected);
  useEffect(() => setTiming(null), [selected]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(plan));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [plan]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    if (!showRange && tab !== "uncertainty") return;
    const id = ++requestId.current;
    setRiskBusy(true);
    setRiskError("");
    worker.current?.terminate();
    const w = new Worker(
      new URL("../backend/uncertainty.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = w;
    w.onmessage = (e) => {
      if (e.data.id !== requestId.current) return;
      setRiskBusy(false);
      if (e.data.error) {
        setRiskError(e.data.error);
        setRisk(null);
      } else setRisk(e.data.result);
    };
    w.onerror = () => {
      setRiskBusy(false);
      setRiskError(
        "The uncertainty calculation could not finish. The exact plan is still available.",
      );
    };
    w.postMessage({ id, plan });
    return () => w.terminate();
  }, [plan, showRange, tab]);
  function update(next: Plan) {
    try {
      validatePlan(next);
      setHistory((h) => [...h.slice(-24), plan]);
      setMonth((m) => Math.min(m, next.months - 1));
      setPlan(next);
      setError("");
      setRisk(null);
      setTiming(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid input");
    }
  }
  function editEvent(patch: Partial<LifeEvent>) {
    if (!event) return;
    update({
      ...plan,
      events: plan.events.map((e) =>
        e.id === event.id ? { ...e, ...patch, approvedBy: [] } : e,
      ),
    });
  }
  function editPerson(index: number, patch: Partial<Person>) {
    const people = [...plan.people] as [Person, Person];
    people[index] = { ...people[index], ...patch };
    update({
      ...plan,
      people,
      events: plan.events.map((e) => ({ ...e, approvedBy: [] })),
    });
  }
  function assumptions(patch: Partial<Plan["assumptions"]>) {
    update({
      ...plan,
      assumptions: { ...plan.assumptions, ...patch },
      events: plan.events.map((e) => ({ ...e, approvedBy: [] })),
    });
  }
  function add(kind: EventKind) {
    const e = newEvent(kind, Math.min(month, plan.months - 1));
    update({ ...plan, events: [...plan.events, e] });
    setSelected(e.id);
    setLibrary(false);
    setTab("timeline");
    setPage("plan");
  }
  function exportPlan() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "converge-plan.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Your plan has been exported.");
  }
  async function importPlan(file?: File) {
    if (!file) return;
    try {
      if (file.size > 500000)
        throw new Error("Choose a plan file smaller than 500 KB.");
      const next = JSON.parse(await file.text());
      validatePlan(next);
      update(next);
      setSelected(null);
      setNotice("Plan imported and checked.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read this plan.");
    }
  }
  async function refreshSources() {
    setFetching(true);
    setSourceError("");
    try {
      const response = await fetch("/api/observations");
      if (!response.ok)
        throw new Error(
          "Official data is temporarily unavailable. The saved plan has not changed.",
        );
      const body = await response.json();
      if (!Array.isArray(body.data))
        throw new Error("Unexpected source response.");
      setObservations(body.data);
      setNotice(
        "Swiss historical context refreshed. Forecast assumptions remain yours.",
      );
    } catch (e) {
      setSourceError(
        e instanceof Error ? e.message : "Could not reach the official source.",
      );
    } finally {
      setFetching(false);
    }
  }
  const end = result?.months.at(-1),
    baseEnd = baseline.months.at(-1)!,
    current = result?.months[Math.min(month, plan.months - 1)];
  const breaches = result
    ? [result.firstBreachA, result.firstBreachB].filter((x) => x !== null)
        .length
    : 0;
  const totalOpening = plan.people.reduce((s, p) => s + p.cash, 0);
  const selectedChecks =
    event?.kind === "study"
      ? educationChecks(
          plan.people[event.owner === "b" ? 1 : 0],
          monthDate(plan.startDate, event.start),
        )
      : [];
  const currentDate = monthDate(plan.startDate, month);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            setPage("plan");
          }}
        >
          <span className="brand-mark">
            <Link2 size={23} />
          </span>
          converge<span className="brand-dot">.</span>
        </a>
        <div className="space-picker">
          <div className="avatar-stack">
            <Avatar name={plan.people[0].name} person="a" />
            <Avatar name={plan.people[1].name} person="b" />
          </div>
          <div>
            <strong>
              {plan.people[0].name} & {plan.people[1].name}
            </strong>
            <span>
              <MapPin size={11} /> Lausanne, Switzerland
            </span>
          </div>
        </div>
        <div className="nav-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {[
            { id: "plan", label: "Life plan", icon: Layers3 },
            { id: "finances", label: "Your finances", icon: Wallet },
            { id: "goals", label: "Goals & possibilities", icon: Flag },
            { id: "evidence", label: "Sources & Swiss rules", icon: BookOpen },
          ].map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "nav-item active" : "nav-item"}
              onClick={() => setPage(n.id)}
            >
              <n.icon size={18} />
              {n.label}
              {n.id === "evidence" && (
                <span className="nav-count">{RULES.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="tiny-label">
            <ShieldCheck size={16} /> TWO LIVES. EQUAL SAY.
          </div>
          <p>A shared future should leave room for each of you.</p>
          <button className="text-button" onClick={() => setPage("finances")}>
            Set your personal boundaries
          </button>
        </div>
        <div className="sidebar-bottom">
          <span className="offline-dot" />
          Private on this device
          <div className="subtle">Fictional demo · CHF · nominal values</div>
          <button
            className="text-button muted"
            onClick={() => {
              setPage("evidence");
              setRuleFilter("all");
            }}
          >
            Sources reviewed 22 Nov 2026
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            Our workspace <ChevronRight size={13} />
            <span>
              {page === "plan"
                ? "Life plan"
                : page === "finances"
                  ? "Your finances"
                  : page === "goals"
                    ? "Goals & possibilities"
                    : "Sources & Swiss rules"}
            </span>
          </div>
          <div className="topbar-actions">
            <span className="save-status">
              <Check size={13} />
              {saved ? "Saved on this device" : "Storage unavailable"}
            </span>
            <button
              className="icon-button"
              aria-label="Import a plan"
              title="Import a plan"
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Export your plan"
              title="Export your plan"
              onClick={exportPlan}
            >
              <ArrowDownToLine size={17} />
            </button>
            <Avatar name={plan.people[0].name} person="a" small />
          </div>
        </header>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            void importPlan(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {(error || attempted.error) && (
          <div role="alert" className="error-banner">
            <CircleHelp size={18} />
            {error || attempted.error}
            <button
              className="icon-button"
              onClick={() => setError("")}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {page === "plan" && (
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  <span className="green-line" /> A LITTLE CLARITY FOR WHAT
                  COMES NEXT
                </div>
                <h1>
                  {plan.name}
                  <button
                    className="icon-button heading-edit"
                    aria-label="Rename plan"
                    onClick={() => {
                      const name = prompt("Name this plan", plan.name);
                      if (name?.trim())
                        update({ ...plan, name: name.trim().slice(0, 60) });
                    }}
                  >
                    <Pencil size={16} />
                  </button>
                </h1>
                <p>
                  Explore your choices together. Keep what matters to each of
                  you.
                </p>
              </div>
              <div className="heading-actions">
                <button
                  className="button secondary"
                  onClick={() => setShowPresets(true)}
                >
                  <Copy size={15} />
                  Explore another path
                </button>
                <button
                  className="button primary"
                  onClick={() => setLibrary(true)}
                >
                  <Plus size={17} />
                  Add a life event
                </button>
              </div>
            </div>
            <div className="summary-row">
              <Summary
                label="Starting liquid savings"
                value={money(totalOpening)}
                detail="Your personal accounts, kept separate"
                icon={<Wallet size={17} />}
              />
              <Summary
                label="Your planning horizon"
                value={`${plan.months / 12} years`}
                detail={`${dateLabel(plan.startDate)} — ${dateLabel(monthDate(plan.startDate, plan.months - 1))}`}
                icon={<CalendarDays size={17} />}
              />
              <Summary
                label="Personal safety nets"
                value={breaches ? `${breaches} to revisit` : "Both protected"}
                detail={
                  breaches
                    ? "A personal reserve falls below your boundary"
                    : "Across every month in the reference plan"
                }
                tone={breaches ? "warning" : "green"}
                icon={<ShieldCheck size={17} />}
              />
            </div>
            <div className="workspace-tabs">
              <div role="tablist" aria-label="Plan views">
                {["timeline", "compare", "uncertainty"].map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    className={tab === t ? "selected" : ""}
                    onClick={() => setTab(t)}
                  >
                    {t === "timeline" ? (
                      <Layers3 size={15} />
                    ) : t === "compare" ? (
                      <Copy size={15} />
                    ) : (
                      <Activity size={15} />
                    )}{" "}
                    {t === "timeline"
                      ? "Your timeline"
                      : t === "compare"
                        ? "Compare paths"
                        : "Explore uncertainty"}
                  </button>
                ))}
              </div>
              <button
                className="text-button muted"
                disabled={!history.length}
                onClick={() => {
                  const prev = history.at(-1);
                  if (prev) {
                    setPlan(prev);
                    setHistory((h) => h.slice(0, -1));
                    setError("");
                    setRisk(null);
                  }
                }}
              >
                <RotateCcw size={14} />
                Undo
              </button>
            </div>
            {tab === "timeline" && (
              <div
                className={`planning-layout ${event ? "has-inspector" : ""}`}
              >
                <div className="planning-canvas">
                  <section className="timeline-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Life, on your terms</h2>
                        <p>
                          Three connected timelines. A little space for
                          everyone.
                        </p>
                      </div>
                      <select
                        aria-label="Focus timeline"
                        className="compact-select"
                        value={scope}
                        onChange={(e) =>
                          setScope(e.target.value as typeof scope)
                        }
                      >
                        <option value="all">All timelines</option>
                        <option value="a">{plan.people[0].name}</option>
                        <option value="b">{plan.people[1].name}</option>
                        <option value="shared">Together</option>
                      </select>
                    </div>
                    <Timeline
                      plan={plan}
                      selected={selected}
                      month={month}
                      scope={scope}
                      onMonth={setMonth}
                      onSelect={setSelected}
                      onMove={(id, start) =>
                        update({
                          ...plan,
                          events: plan.events.map((e) =>
                            e.id === id ? { ...e, start, approvedBy: [] } : e,
                          ),
                        })
                      }
                    />
                    <div className="timeline-caption">
                      <div className="legend">
                        <span className="dot a" />
                        {plan.people[0].name}
                        <span className="dot b" />
                        {plan.people[1].name}
                        <span className="dot shared" />
                        Together
                      </div>
                      <span>Drag an event to try a different date</span>
                    </div>
                  </section>
                  {result && (
                    <section className="chart-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Your money, in perspective</h2>
                          <p>Each decision changes the path. See how.</p>
                        </div>
                        <select
                          className="compact-select"
                          aria-label="Chart metric"
                          value={metric}
                          onChange={(e) =>
                            setMetric(e.target.value as typeof metric)
                          }
                        >
                          <option value="totalCash">Liquid savings</option>
                          <option value="netWorth">Net worth</option>
                        </select>
                      </div>
                      <div className="chart-legend">
                        <span>
                          <i className="line-key green" />
                          This plan
                        </span>
                        <span>
                          <i className="line-key dashed" />
                          Keep things as they are
                        </span>
                        {metric === "totalCash" && (
                          <label className="range-toggle">
                            <input
                              type="checkbox"
                              checked={showRange}
                              onChange={(e) => setShowRange(e.target.checked)}
                            />
                            {riskBusy
                              ? "Calculating range…"
                              : "Show modelled range"}
                          </label>
                        )}
                      </div>
                      <FinancialChart
                        rows={result.months}
                        baseline={baseline.months}
                        metric={metric}
                        month={month}
                        onMonth={setMonth}
                        opening={
                          metric === "totalCash"
                            ? totalOpening
                            : totalOpening +
                              plan.people.reduce((s, p) => s + p.investments, 0)
                        }
                        band={
                          showRange && !riskBusy && metric === "totalCash"
                            ? risk?.bands
                            : undefined
                        }
                      />
                      {riskError && (
                        <div role="alert" className="inline-warning">
                          {riskError}
                        </div>
                      )}
                      <div className="chart-footer">
                        <div>
                          <span className="selected-date">
                            {dateLabel(currentDate)}
                          </span>
                          <strong>{money(current?.[metric] ?? 0)}</strong>
                          <span className="delta">
                            {(current?.[metric] ?? 0) -
                              baseline.months[month][metric] >=
                            0
                              ? "+"
                              : ""}
                            {money(
                              (current?.[metric] ?? 0) -
                                baseline.months[month][metric],
                            )}{" "}
                            vs. unchanged
                          </span>
                        </div>
                        <span>
                          CHF · future nominal money
                          <br />
                          Reference assumptions, not a forecast
                        </span>
                      </div>
                    </section>
                  )}
                  <div className="insight-row">
                    <button
                      onClick={() => {
                        setPage("evidence");
                        setRuleFilter("education");
                      }}
                    >
                      <span className="insight-icon amber">
                        <GraduationCap size={20} />
                      </span>
                      <div>
                        <strong>Timing changes your options</strong>
                        <p>
                          Age, work history, and residence can change study
                          support.
                        </p>
                        <span>
                          Explore Swiss study rules <ExternalLink size={12} />
                        </span>
                      </div>
                    </button>
                    <button onClick={() => setPage("finances")}>
                      <span className="insight-icon green">
                        <ShieldCheck size={20} />
                      </span>
                      <div>
                        <strong>Yours, mine, and ours</strong>
                        <p>
                          Shared savings never silently cover a personal
                          shortfall.
                        </p>
                        <span>
                          Review your boundaries <SlidersHorizontal size={12} />
                        </span>
                      </div>
                    </button>
                  </div>
                </div>
                {event && (
                  <aside className="inspector">
                    <div className="inspector-top">
                      <span>EVENT DETAILS</span>
                      <button
                        aria-label="Close event details"
                        className="icon-button"
                        onClick={() => setSelected(null)}
                      >
                        <PanelRightClose size={17} />
                      </button>
                    </div>
                    <div className={`event-emblem ${event.owner}`}>
                      {(() => {
                        const Icon = icons[event.kind];
                        return <Icon size={25} />;
                      })()}
                    </div>
                    <h2>{event.title}</h2>
                    <span className={`owner-tag ${event.owner}`}>
                      {event.owner === "shared" ? (
                        <Users size={12} />
                      ) : (
                        <span className={`dot ${event.owner}`} />
                      )}{" "}
                      {event.owner === "shared"
                        ? "A shared chapter"
                        : plan.people[event.owner === "a" ? 0 : 1].name +
                          "’s chapter"}
                    </span>
                    <div className="inspector-form">
                      <Field label="Event name">
                        <input
                          value={event.title}
                          maxLength={50}
                          onChange={(e) => editEvent({ title: e.target.value })}
                        />
                      </Field>
                      <div className="field-grid">
                        <Field label="Starts">
                          <input
                            type="month"
                            min={plan.startDate.slice(0, 7)}
                            max={monthDate(
                              plan.startDate,
                              plan.months - 1,
                            ).slice(0, 7)}
                            value={monthDate(plan.startDate, event.start).slice(
                              0,
                              7,
                            )}
                            onChange={(e) => {
                              if (e.target.value) {
                                const d = new Date(
                                  `${e.target.value}-01T12:00:00Z`,
                                );
                                const s = new Date(
                                  `${plan.startDate}T12:00:00Z`,
                                );
                                editEvent({
                                  start:
                                    (d.getUTCFullYear() - s.getUTCFullYear()) *
                                      12 +
                                    d.getUTCMonth() -
                                    s.getUTCMonth(),
                                });
                              }
                            }}
                          />
                        </Field>
                        {!["move", "home"].includes(event.kind) ? (
                          <Field label="Months">
                            <NumberInput
                              value={event.duration}
                              min={1}
                              max={360}
                              onChange={(v) => editEvent({ duration: v })}
                            />
                          </Field>
                        ) : (
                          <div className="ongoing-note">
                            <Clock3 size={14} />
                            Ongoing from this date
                          </div>
                        )}
                      </div>
                      {!["move", "home", "child"].includes(event.kind) && (
                        <Field label="Whose chapter?">
                          <select
                            value={event.owner}
                            onChange={(e) =>
                              editEvent({
                                owner: e.target.value as LifeEvent["owner"],
                              })
                            }
                          >
                            <option value="a">{plan.people[0].name}</option>
                            <option value="b">{plan.people[1].name}</option>
                            {event.kind === "support" && (
                              <option value="shared">Together</option>
                            )}
                          </select>
                        </Field>
                      )}
                      {["study", "break", "parttime", "business"].includes(
                        event.kind,
                      ) && (
                        <Field
                          label="Income retained"
                          hint="% of that person’s normal take-home income"
                        >
                          <NumberInput
                            value={event.incomePercent}
                            max={100}
                            suffix="%"
                            onChange={(v) => editEvent({ incomePercent: v })}
                          />
                        </Field>
                      )}
                      {event.kind === "study" && (
                        <>
                          <Field
                            label="EPFL semester invoice"
                            hint="Choose the category confirmed by EPFL"
                          >
                            <select
                              value={event.tuitionTier}
                              onChange={(e) =>
                                editEvent({
                                  tuitionTier: e.target
                                    .value as LifeEvent["tuitionTier"],
                                })
                              }
                            >
                              <option value="standard">
                                Standard · CHF 780
                              </option>
                              <option value="increased">
                                Increased · CHF 2,240
                              </option>
                              <option value="custom">
                                Another institution / amount
                              </option>
                            </select>
                          </Field>
                          {event.tuitionTier === "custom" && (
                            <Field label="Semester invoice · CHF">
                              <NumberInput
                                value={event.tuitionCustom}
                                onChange={(v) =>
                                  editEvent({ tuitionCustom: v })
                                }
                              />
                            </Field>
                          )}
                          <Field label="Award support per month · CHF">
                            <NumberInput
                              value={event.confirmedGrant}
                              onChange={(v) => editEvent({ confirmedGrant: v })}
                            />
                          </Field>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={event.grantConfirmed}
                              onChange={(e) =>
                                editEvent({ grantConfirmed: e.target.checked })
                              }
                            />
                            I have a confirmed award amount
                          </label>
                          <p className="field-hint">
                            Unconfirmed scholarships contribute CHF 0 to this
                            plan. Fees are held at today’s level; the announced
                            2029 adjustment is not estimated.
                          </p>
                        </>
                      )}
                      {[
                        "move",
                        "home",
                        "business",
                        "support",
                        "child",
                      ].includes(event.kind) && (
                        <Field
                          label={
                            event.kind === "home"
                              ? "Purchase price · CHF"
                              : event.kind === "move"
                                ? "Shared rent per month · CHF"
                                : "Added monthly costs · CHF"
                          }
                          hint={
                            event.kind === "home"
                              ? "Deposit, fees, and mortgage use your assumptions"
                              : undefined
                          }
                        >
                          <NumberInput
                            value={event.amount}
                            onChange={(v) => editEvent({ amount: v })}
                          />
                        </Field>
                      )}
                      {event.kind !== "home" && (
                        <Field label="One-time costs · CHF">
                          <NumberInput
                            value={event.oneOff}
                            onChange={(v) => editEvent({ oneOff: v })}
                          />
                        </Field>
                      )}
                    </div>
                    {selectedChecks.length > 0 && (
                      <div className="eligibility-box">
                        <div>
                          <BookOpen size={15} />
                          <strong>Before you make the leap</strong>
                        </div>
                        <p>
                          At study start,{" "}
                          {plan.people[event.owner === "b" ? 1 : 0].name} will
                          be{" "}
                          <strong>
                            {ageAt(
                              plan.people[event.owner === "b" ? 1 : 0]
                                .birthDate,
                              monthDate(plan.startDate, event.start),
                            )}
                          </strong>
                          .
                        </p>
                        {selectedChecks.slice(0, 2).map((c) => (
                          <button
                            key={c.ruleId}
                            onClick={() => {
                              setPage("evidence");
                              setRuleFilter("education");
                            }}
                          >
                            <span className="check-ring">
                              <CircleHelp size={13} />
                            </span>
                            <span>{c.title}</span>
                            <ChevronRight size={14} />
                          </button>
                        ))}
                        <button
                          className="text-button"
                          onClick={() => {
                            setPage("evidence");
                            setRuleFilter("education");
                          }}
                        >
                          See sources and eligibility checks
                        </button>
                      </div>
                    )}
                    {event.kind === "home" && (
                      <div className="eligibility-box">
                        <strong>Buying across a policy change?</strong>
                        <p>
                          Housing taxation changes from 2029. Deductions also
                          change; no automatic tax saving is included.
                        </p>
                        <button
                          className="text-button"
                          onClick={() => {
                            setPage("evidence");
                            setRuleFilter("housing");
                          }}
                        >
                          Read the official reform
                        </button>
                      </div>
                    )}
                    <div className="approval-box">
                      <div>
                        <Heart size={14} />
                        <strong>Room for both voices</strong>
                      </div>
                      <p>
                        Local demo review markers, not authenticated consent.
                        Edits clear both markers.
                      </p>
                      <div>
                        {plan.people.map((p) => (
                          <button
                            key={p.id}
                            className={
                              event.approvedBy.includes(p.id) ? "reviewed" : ""
                            }
                            onClick={() => {
                              const approvedBy = event.approvedBy.includes(p.id)
                                ? event.approvedBy.filter((id) => id !== p.id)
                                : [...event.approvedBy, p.id];
                              update({
                                ...plan,
                                events: plan.events.map((e) =>
                                  e.id === event.id ? { ...e, approvedBy } : e,
                                ),
                              });
                            }}
                          >
                            {event.approvedBy.includes(p.id) ? (
                              <Check size={13} />
                            ) : (
                              <Plus size={13} />
                            )}{" "}
                            {p.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="timing-search">
                      <button
                        className="text-button"
                        onClick={() =>
                          setTiming(findSaferDates(plan, event.id))
                        }
                      >
                        <Clock3 size={14} />
                        Find dates that protect both reserves
                      </button>
                      {timing && (
                        <>
                          <p>
                            Exact reference-plan search · up to 36 months later.
                            No probability or tax eligibility is implied.
                          </p>
                          {timing.length ? (
                            timing.map((t) => (
                              <button
                                className="timing-option"
                                key={t.start}
                                onClick={() => {
                                  editEvent({ start: t.start });
                                  setNotice(
                                    "Date applied and recalculated. Review the updated eligibility checkpoints.",
                                  );
                                }}
                              >
                                <span>
                                  {dateLabel(
                                    monthDate(plan.startDate, t.start),
                                  )}
                                  <small>
                                    {t.delay === 0
                                      ? "Current date meets both reserves"
                                      : `${t.delay} months later`}
                                  </small>
                                </span>
                                <Check size={14} />
                              </button>
                            ))
                          ) : (
                            <p>
                              No date in this window protects both reserves
                              under the current assumptions. Change costs,
                              income or the plan—not the boundary.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                    <button
                      className="delete-event"
                      onClick={() => {
                        update({
                          ...plan,
                          events: plan.events.filter((e) => e.id !== event.id),
                        });
                        setSelected(null);
                      }}
                    >
                      <Trash2 size={14} />
                      Remove event
                    </button>
                  </aside>
                )}
              </div>
            )}
            {tab === "compare" && result && (
              <div className="secondary-content">
                <div className="section-intro">
                  <span className="eyebrow">
                    A DIFFERENT PATH, THE SAME STARTING POINT
                  </span>
                  <h2>See what changes. For each of you.</h2>
                  <p>
                    The reference plan keeps your households separate. Both
                    paths use the same starting resources and assumptions.
                  </p>
                </div>
                <div className="comparison-table">
                  <table>
                    <thead>
                      <tr>
                        <th>
                          At{" "}
                          {dateLabel(
                            monthDate(plan.startDate, plan.months - 1),
                          )}
                        </th>
                        <th>Keep things as they are</th>
                        <th>{plan.name}</th>
                        <th>Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: "Liquid savings", key: "totalCash" },
                        { label: "Net worth", key: "netWorth" },
                        {
                          label: plan.people[0].name + "’s personal cash",
                          key: "a",
                        },
                        {
                          label: plan.people[1].name + "’s personal cash",
                          key: "b",
                        },
                        { label: "Shared cash", key: "shared" },
                        { label: "Mortgage outstanding", key: "debt" },
                      ].map((row) => {
                        const key = row.key as keyof Month;
                        const change =
                          Number(end?.[key]) - Number(baseEnd[key]);
                        return (
                          <tr key={row.key}>
                            <td>{row.label}</td>
                            <td>{money(Number(baseEnd[key]))}</td>
                            <td>{money(Number(end?.[key]))}</td>
                            <td
                              className={change >= 0 ? "positive" : "negative"}
                            >
                              {change >= 0 ? "+" : ""}
                              {money(change)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="compare-persons">
                  {plan.people.map((p) => (
                    <div key={p.id} className="boundary-card">
                      <div>
                        <Avatar name={p.name} person={p.id} />
                        <h3>{p.name}’s space to breathe</h3>
                      </div>
                      <p>
                        Personal boundary <strong>{money(p.reserve)}</strong>
                      </p>
                      <p>
                        Lowest personal cash{" "}
                        <strong
                          className={
                            result[p.id === "a" ? "minimumA" : "minimumB"] <
                            p.reserve
                              ? "negative"
                              : "positive"
                          }
                        >
                          {money(
                            result[p.id === "a" ? "minimumA" : "minimumB"],
                          )}
                        </strong>
                      </p>
                      <p>
                        First boundary breach{" "}
                        <strong>
                          {result[
                            p.id === "a" ? "firstBreachA" : "firstBreachB"
                          ] === null
                            ? "None"
                            : result[
                                  p.id === "a" ? "firstBreachA" : "firstBreachB"
                                ] === -1
                              ? "At the start"
                              : dateLabel(
                                  monthDate(
                                    plan.startDate,
                                    result[
                                      p.id === "a"
                                        ? "firstBreachA"
                                        : "firstBreachB"
                                    ]!,
                                  ),
                                )}
                        </strong>
                      </p>
                    </div>
                  ))}
                </div>
                <div className="explanation">
                  <ShieldCheck size={22} />
                  <div>
                    <strong>
                      Household wealth is only part of the picture.
                    </strong>
                    <p>
                      A shared account balance does not erase a personal funding
                      gap. Contributions follow your selected split; no loan or
                      transfer is invented to rescue an infeasible plan.
                    </p>
                  </div>
                </div>
                {result.warnings.map((w) => (
                  <p key={w} className="small-print">
                    {w}
                  </p>
                ))}
              </div>
            )}
            {tab === "uncertainty" && (
              <div className="secondary-content">
                <div className="section-intro">
                  <span className="eyebrow">
                    ONE PLAN. MANY POSSIBLE OUTCOMES.
                  </span>
                  <h2>Leave a little room for the unexpected.</h2>
                  <p>
                    A fitted Gaussian process supplies correlated spending
                    paths. The same sampled environments are used for your plan
                    and the unchanged path.
                  </p>
                </div>
                {riskBusy ? (
                  <div className="loading-state">
                    <Activity size={28} />
                    <h3>Exploring 160 possible environments…</h3>
                    <p>Calculating every month, for both people.</p>
                  </div>
                ) : riskError ? (
                  <div className="error-banner">{riskError}</div>
                ) : (
                  risk && (
                    <>
                      <div className="uncertainty-stats">
                        <Summary
                          label="Either personal reserve breached"
                          value={percent(risk.breachEither)}
                          detail={`In ${Math.round(risk.breachEither * risk.paths)} of ${risk.paths} modelled paths`}
                          tone="warning"
                          icon={<ShieldCheck size={17} />}
                        />
                        <Summary
                          label={plan.people[0].name + "’s reserve breached"}
                          value={percent(risk.breachA)}
                          detail="At least once during the planning horizon"
                          icon={<Wallet size={17} />}
                        />
                        <Summary
                          label={plan.people[1].name + "’s reserve breached"}
                          value={percent(risk.breachB)}
                          detail="At least once during the planning horizon"
                          icon={<Wallet size={17} />}
                        />
                      </div>
                      <div className="chart-panel">
                        <div className="panel-heading">
                          <div>
                            <h2>A range of liquid savings</h2>
                            <p>
                              10th–90th percentiles at each month · conditional
                              on this model
                            </p>
                          </div>
                        </div>
                        <FinancialChart
                          rows={result?.months ?? baseline.months}
                          baseline={baseline.months}
                          metric="totalCash"
                          month={month}
                          onMonth={setMonth}
                          opening={totalOpening}
                          band={risk.bands}
                        />
                      </div>
                      <div className="model-notes">
                        <div>
                          <h3>What this experiment actually knows</h3>
                          <p>
                            The GP is fitted to{" "}
                            <strong>
                              24 generated monthly spending residuals
                            </strong>
                            . This is a reproducible model demonstration, not
                            validation on real households. Kernel length scale
                            selected by marginal likelihood: {risk.gpLength}{" "}
                            months.
                          </p>
                          <p>
                            Paths include common cost variation, illustrative
                            personal and shared employment interruptions, and
                            investment variation. The three-month interruptions
                            retain 20% of take-home income as an assumption, not
                            a statutory benefit calculation.
                          </p>
                          <p>
                            Pointwise bands do not guarantee a whole path stays
                            inside the band. Frequencies have sampling error and
                            are not known real-world probabilities.
                          </p>
                        </div>
                        <div>
                          <h3>Reproducible by design</h3>
                          <p>
                            {risk.paths} paths · seed {risk.seed}
                          </p>
                          <Field label="Random seed">
                            <NumberInput
                              value={plan.assumptions.seed}
                              max={4294967295}
                              onChange={(v) => assumptions({ seed: v })}
                            />
                          </Field>
                          <p className="small-print">
                            Personal interruption rate: 4%/year; shared
                            interruption rate: 1%/year. Return volatility:
                            8%/year. These are explicit demo stress assumptions.
                          </p>
                        </div>
                      </div>
                    </>
                  )
                )}
              </div>
            )}
          </>
        )}
        {page === "finances" && (
          <div className="full-page">
            <div className="page-heading">
              <div>
                <div className="eyebrow">THE STARTING POINT BELONGS TO YOU</div>
                <h1>Two people. A clearer picture.</h1>
                <p>
                  Fictional demo inputs. Edit them to explore a different story.
                </p>
              </div>
            </div>
            <div className="profile-grid">
              {plan.people.map((p, i) => (
                <section className={`profile-card ${p.id}`} key={p.id}>
                  <div className="profile-header">
                    <Avatar name={p.name} person={p.id} />
                    <div>
                      <h2>{p.name}</h2>
                      <p>
                        {ageAt(p.birthDate, plan.startDate)} at plan start ·{" "}
                        {p.canton}
                      </p>
                    </div>
                    <span className="owner-tag">Personal</span>
                  </div>
                  <div className="field-grid">
                    <Field label="Name">
                      <input
                        value={p.name}
                        maxLength={25}
                        onChange={(e) =>
                          editPerson(i, { name: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Date of birth">
                      <input
                        type="date"
                        value={p.birthDate}
                        onChange={(e) =>
                          e.target.value &&
                          editPerson(i, { birthDate: e.target.value })
                        }
                      />
                    </Field>
                  </div>
                  <Field
                    label="Take-home income / month · CHF"
                    hint="After payroll deductions AND income tax. No further income tax is deducted."
                  >
                    <NumberInput
                      value={p.income}
                      onChange={(v) => editPerson(i, { income: v })}
                    />
                  </Field>
                  <div className="field-grid">
                    <Field label="Personal cash · CHF">
                      <NumberInput
                        value={p.cash}
                        onChange={(v) => editPerson(i, { cash: v })}
                      />
                    </Field>
                    <Field label="Investments · CHF">
                      <NumberInput
                        value={p.investments}
                        onChange={(v) => editPerson(i, { investments: v })}
                      />
                    </Field>
                    <Field label="Personal spending / month">
                      <NumberInput
                        value={p.personalCosts}
                        onChange={(v) => editPerson(i, { personalCosts: v })}
                      />
                    </Field>
                    <Field label="Current rent / month">
                      <NumberInput
                        value={p.rent}
                        onChange={(v) => editPerson(i, { rent: v })}
                      />
                    </Field>
                  </div>
                  <p className="field-hint">
                    Personal spending excludes rent, basic insurance, and added
                    life-event costs.
                  </p>
                  <div className="boundary-input">
                    <ShieldCheck size={19} />
                    <Field label="My protected cash reserve · CHF">
                      <NumberInput
                        value={p.reserve}
                        onChange={(v) => editPerson(i, { reserve: v })}
                      />
                    </Field>
                  </div>
                  <details>
                    <summary>
                      Insurance, residence & education <ChevronDown size={15} />
                    </summary>
                    <div className="field-grid">
                      <Field label="Young-adult premium / month">
                        <NumberInput
                          value={p.premiumYoung}
                          onChange={(v) => editPerson(i, { premiumYoung: v })}
                        />
                      </Field>
                      <Field label="Adult premium / month">
                        <NumberInput
                          value={p.premiumAdult}
                          onChange={(v) => editPerson(i, { premiumAdult: v })}
                        />
                      </Field>
                      <Field label="Canton">
                        <select
                          value={p.canton}
                          onChange={(e) =>
                            editPerson(i, { canton: e.target.value })
                          }
                        >
                          {[
                            "VD",
                            "GE",
                            "ZH",
                            "BE",
                            "FR",
                            "VS",
                            "NE",
                            "Other",
                          ].map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Completed working years">
                        <NumberInput
                          value={p.independentYears}
                          max={60}
                          onChange={(v) =>
                            editPerson(i, { independentYears: v })
                          }
                        />
                      </Field>
                      <Field label="Years living in Switzerland">
                        <NumberInput
                          value={p.swissResidenceYears}
                          max={100}
                          onChange={(v) =>
                            editPerson(i, { swissResidenceYears: v })
                          }
                        />
                      </Field>
                    </div>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={p.hasQualification}
                        onChange={(e) =>
                          editPerson(i, { hasQualification: e.target.checked })
                        }
                      />
                      Has a qualifying professional diploma
                    </label>
                    <p className="field-hint">
                      Premiums are editable demo inputs, not insurance quotes.
                      Adult pricing starts in the calendar year after turning
                      25. Working years alone do not prove scholarship
                      independence.
                    </p>
                  </details>
                </section>
              ))}
            </div>
            <section className="assumptions-card">
              <div className="panel-heading">
                <div>
                  <h2>A shared plan, explicit assumptions</h2>
                  <p>
                    All rates below describe a scenario. Historical observations
                    do not silently become forecasts.
                  </p>
                </div>
                <SlidersHorizontal size={20} />
              </div>
              <div className="assumptions-grid">
                <Field label="Shared costs split">
                  <select
                    value={plan.assumptions.split}
                    onChange={(e) =>
                      assumptions({
                        split: e.target.value as Plan["assumptions"]["split"],
                      })
                    }
                  >
                    <option value="income">
                      Proportional to monthly income
                    </option>
                    <option value="equal">50 / 50</option>
                    <option value="custom">Custom contribution split</option>
                  </select>
                </Field>
                {plan.assumptions.split === "custom" && (
                  <Field label={plan.people[0].name + "’s share"}>
                    <NumberInput
                      value={plan.assumptions.shareA * 100}
                      max={100}
                      suffix="%"
                      onChange={(v) => assumptions({ shareA: v / 100 })}
                    />
                  </Field>
                )}
                <Field label="Total shared saving / month · CHF">
                  <NumberInput
                    value={plan.assumptions.monthlySharedSaving}
                    onChange={(v) => assumptions({ monthlySharedSaving: v })}
                  />
                </Field>
                {[
                  { key: "inflation", label: "Annual cost inflation" },
                  {
                    key: "incomeGrowth",
                    label: "Annual take-home income growth",
                  },
                  {
                    key: "investmentReturn",
                    label: "Annual investment return",
                  },
                  { key: "mortgageRate", label: "Mortgage interest" },
                  { key: "depositPercent", label: "Home deposit" },
                  {
                    key: "purchaseFeesPercent",
                    label: "Purchase transaction costs",
                  },
                  {
                    key: "maintenancePercent",
                    label: "Annual property maintenance",
                  },
                  {
                    key: "amortizationPercent",
                    label: "Annual original-loan amortization",
                  },
                ].map((f) => (
                  <Field key={f.key} label={f.label}>
                    <NumberInput
                      value={
                        Math.round(
                          Number(
                            plan.assumptions[
                              f.key as keyof Plan["assumptions"]
                            ],
                          ) * 10000,
                        ) / 100
                      }
                      min={
                        [
                          "inflation",
                          "incomeGrowth",
                          "investmentReturn",
                        ].includes(f.key)
                          ? -10
                          : 0
                      }
                      max={f.key === "depositPercent" ? 100 : 30}
                      step={0.1}
                      suffix="%"
                      onChange={(v) => assumptions({ [f.key]: v / 100 })}
                    />
                  </Field>
                ))}
              </div>
              <p className="small-print">
                The home model uses monthly interest and linear amortization,
                holds the property value constant, and makes no Swiss
                lending-eligibility or tax assessment. Personal investment
                ownership remains separate in the profile; chart totals
                consolidate both holdings.
              </p>
            </section>
          </div>
        )}
        {page === "goals" && (
          <div className="full-page">
            <div className="page-heading">
              <div>
                <div className="eyebrow">THERE’S MORE THAN ONE GOOD FUTURE</div>
                <h1>What would you make room for?</h1>
                <p>Try a fully calculated path, then make it your own.</p>
              </div>
            </div>
            <div className="preset-grid">
              {PRESETS.map((p, i) => (
                <button
                  className="preset-card"
                  key={p.id}
                  onClick={() => {
                    const events = presetEvents(p.id);
                    update({ ...plan, name: p.title, events });
                    setPage("plan");
                    setTab("timeline");
                    setSelected(events.at(-1)?.id ?? null);
                    setNotice(
                      "New path applied. Undo brings back your previous plan.",
                    );
                  }}
                >
                  <span className={`preset-art art-${i}`}>
                    {i === 0 ? (
                      <Home />
                    ) : i === 1 ? (
                      <GraduationCap />
                    ) : i === 2 ? (
                      <Link2 />
                    ) : i === 3 ? (
                      <Leaf />
                    ) : i === 4 ? (
                      <Coffee />
                    ) : (
                      <BriefcaseBusiness />
                    )}
                  </span>
                  <span className="preset-body">
                    <strong>{p.title}</strong>
                    <span>{p.description}</span>
                    <span className="preset-link">
                      Explore this path <Plus size={14} />
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <div className="explanation">
              <Heart size={24} />
              <div>
                <strong>
                  Start with the life you want, then test the numbers.
                </strong>
                <p>
                  Compare time, flexibility, and personal security alongside
                  money. Each path uses editable fictional assumptions and the
                  same accounting engine.
                </p>
              </div>
            </div>
            <button
              className="button secondary"
              onClick={() => {
                setLibrary(true);
              }}
            >
              Build your own combination <Plus size={16} />
            </button>
          </div>
        )}
        {page === "evidence" && (
          <div className="full-page">
            <div className="page-heading">
              <div>
                <div className="eyebrow">REAL SOURCES. VISIBLE LIMITS.</div>
                <h1>The world around your plan.</h1>
                <p>
                  Age, place, and policy can change your options. Here’s what we
                  checked.
                </p>
              </div>
              <button
                className="button secondary"
                disabled={fetching}
                onClick={() => void refreshSources()}
              >
                <RotateCcw size={15} className={fetching ? "spin" : ""} />
                {fetching ? "Fetching official data…" : "Refresh Swiss context"}
              </button>
            </div>
            <div className="evidence-callout">
              <BookOpen size={21} />
              <div>
                <strong>
                  Reviewed 22 November 2026 · Official sources only
                </strong>
                <p>
                  Rules are a curated snapshot, not a live legal feed.
                  Confirmed, scheduled, and proposed changes stay distinct.
                  Scholarship checks never promise an award.
                </p>
              </div>
            </div>
            {(observations.length > 0 || sourceError) && (
              <section className="context-panel">
                <h2>Historical Swiss context</h2>
                {sourceError && (
                  <p role="alert" className="negative">
                    {sourceError}
                  </p>
                )}
                <div className="context-grid">
                  {observations.map((o) => (
                    <div key={o.id}>
                      <span>{o.name}</span>
                      <strong>{o.value.toFixed(2)}%</strong>
                      <p>
                        Reference year {o.year} · {o.unit}
                      </p>
                      <a href={o.url} target="_blank" rel="noreferrer">
                        World Bank · fetched{" "}
                        {dateLabel(o.retrievedAt.slice(0, 10))}{" "}
                        <ExternalLink size={12} />
                      </a>
                    </div>
                  ))}
                </div>
                <p className="small-print">
                  Aggregate historical statistics, not a personal salary model
                  or a job-loss probability. Your planning assumptions have not
                  changed.
                </p>
              </section>
            )}
            {plan.events
              .filter((e) => e.kind === "study")
              .map((e) => {
                const p = plan.people[e.owner === "b" ? 1 : 0];
                return (
                  <section className="personal-checks" key={e.id}>
                    <div className="panel-heading">
                      <div>
                        <h2>{p.name}’s education checkpoints</h2>
                        <p>
                          {dateLabel(monthDate(plan.startDate, e.start))} · age{" "}
                          {ageAt(
                            p.birthDate,
                            monthDate(plan.startDate, e.start),
                          )}{" "}
                          · reported canton {p.canton}
                        </p>
                      </div>
                      <GraduationCap size={21} />
                    </div>
                    {educationChecks(p, monthDate(plan.startDate, e.start)).map(
                      (c) => (
                        <div className="check-item" key={c.ruleId}>
                          <CircleHelp size={17} />
                          <div>
                            <strong>{c.title}</strong>
                            <p>{c.detail}</p>
                            <a
                              href={RULES.find((r) => r.id === c.ruleId)?.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Official guidance <ExternalLink size={12} />
                            </a>
                          </div>
                        </div>
                      ),
                    )}
                  </section>
                );
              })}
            <div className="rule-filters" aria-label="Filter sources">
              {[
                "all",
                "education",
                "insurance",
                "housing",
                "pension",
                "tax",
              ].map((c) => (
                <button
                  className={ruleFilter === c ? "active" : ""}
                  key={c}
                  onClick={() => setRuleFilter(c)}
                >
                  {c === "all"
                    ? "All sources"
                    : c[0].toUpperCase() + c.slice(1)}
                </button>
              ))}
            </div>
            <div className="rule-list">
              {RULES.filter(
                (r) => ruleFilter === "all" || r.category === ruleFilter,
              ).map((r) => (
                <article key={r.id} className="rule-card">
                  <div className="rule-icon">
                    {r.category === "education" ? (
                      <GraduationCap />
                    ) : r.category === "housing" ? (
                      <Home />
                    ) : r.category === "insurance" ? (
                      <Heart />
                    ) : r.category === "pension" ? (
                      <ShieldCheck />
                    ) : (
                      <BookOpen />
                    )}
                  </div>
                  <div className="rule-body">
                    <div className="rule-title">
                      <h3>{r.title}</h3>
                      <span className={`status-chip ${r.status}`}>
                        {r.status === "in_force"
                          ? "In force"
                          : r.status === "scheduled"
                            ? "Scheduled"
                            : r.status === "proposal"
                              ? "Proposal"
                              : "Guidance"}
                      </span>
                    </div>
                    <p>{r.summary}</p>
                    <div className="rule-impact">{r.impact}</div>
                    <div className="rule-meta">
                      <span>
                        {r.jurisdiction}
                        {r.effectiveFrom
                          ? ` · from ${dateLabel(r.effectiveFrom)}`
                          : ""}{" "}
                        · reviewed {r.verifiedOn}
                      </span>
                      <a href={r.url} target="_blank" rel="noreferrer">
                        Official source <ExternalLink size={12} />
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <p className="small-print">
              Implemented cash flows: selected tuition invoice, entered
              insurance age tiers, entered confirmed grants and explicit
              scenario costs. Tax reform, pension obligations, scholarships and
              subsidies otherwise appear as checks; they do not add unverified
              savings or benefits.
            </p>
          </div>
        )}
        <footer className="page-footer">
          <span>Converge · A shared future, with room for you.</span>
          <span>
            Educational prototype · fictional profiles · calculations under
            stated assumptions
          </span>
        </footer>
      </main>
      {notice && (
        <div className="toast" role="status">
          <CheckCheck size={18} />
          {notice}
        </div>
      )}
      {library && (
        <Modal
          title="Make room for a new chapter"
          subtitle="Choose a life event. You can change every assumption."
          onClose={() => setLibrary(false)}
        >
          <div className="event-library">
            {(Object.keys(EVENT_LABELS) as EventKind[]).map((kind) => {
              const Icon = icons[kind];
              return (
                <button key={kind} onClick={() => add(kind)}>
                  <span className="library-icon">
                    <Icon size={23} />
                  </span>
                  <span>
                    <strong>{EVENT_LABELS[kind]}</strong>
                    <span>{kindDescriptions[kind]}</span>
                  </span>
                  <Plus size={17} />
                </button>
              );
            })}
          </div>
          <p className="small-print">
            New events start at your selected month. Overlapping work changes
            for one person must be rescheduled.
          </p>
        </Modal>
      )}
      {showPresets && (
        <Modal
          title="There’s more than one good path"
          subtitle="Replace the current events with a new combination. Your profiles stay the same; Undo restores your previous plan."
          onClose={() => setShowPresets(false)}
        >
          <div className="path-options">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  const events = presetEvents(p.id);
                  update({ ...plan, name: p.title, events });
                  setSelected(events.at(-1)?.id ?? null);
                  setShowPresets(false);
                  setTab("timeline");
                }}
              >
                <div>
                  <strong>{p.title}</strong>
                  <p>{p.description}</p>
                </div>
                <ChevronRight size={19} />
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function Avatar({
  name,
  person,
  small = false,
}: {
  name: string;
  person: string;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar ${person} ${small ? "small" : ""}`}
      aria-label={name}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
function Summary({
  label,
  value,
  detail,
  icon,
  tone = "",
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  tone?: string;
}) {
  return (
    <div className={`summary ${tone}`}>
      <div className="summary-label">
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </div>
  );
}
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function NumberInput({
  value,
  onChange,
  min = 0,
  max = 10000000,
  step = 1,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  function commit() {
    const v = Number(draft);
    if (draft !== "" && Number.isFinite(v) && v >= min && v <= max) onChange(v);
    else setDraft(String(value));
  }
  return (
    <span className="number-input">
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {suffix && <span>{suffix}</span>}
    </span>
  );
}
function Modal({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <button
          className="icon-button"
          autoFocus
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function Timeline({
  plan,
  selected,
  month,
  scope,
  onMonth,
  onSelect,
  onMove,
}: {
  plan: Plan;
  selected: string | null;
  month: number;
  scope: string;
  onMonth: (n: number) => void;
  onSelect: (id: string) => void;
  onMove: (id: string, start: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null),
    drag = useRef<{
      id: string;
      x: number;
      start: number;
      moved: boolean;
    } | null>(null);
  const [preview, setPreview] = useState<{ id: string; start: number } | null>(
    null,
  );
  const years = Array.from(
    { length: plan.months / 12 },
    (_, i) => Number(plan.startDate.slice(0, 4)) + i,
  );
  const lanes = [
    { id: "a", name: plan.people[0].name, detail: "Your own path" },
    { id: "b", name: plan.people[1].name, detail: "Your own path" },
    { id: "shared", name: "Together", detail: "Your shared chapters" },
  ].filter((l) => scope === "all" || scope === l.id);
  return (
    <div className="timeline">
      <div className="year-row">
        <div className="timeline-label">
          {plan.startDate.slice(0, 4)}—
          {Number(plan.startDate.slice(0, 4)) + plan.months / 12 - 1}
        </div>
        <div className="year-axis">
          {years.map((y) => (
            <span key={y}>{String(y).slice(2)}</span>
          ))}
        </div>
      </div>
      <div ref={trackRef} className="lane-wrapper">
        {lanes.map((lane) => (
          <div className="timeline-lane" key={lane.id}>
            <div className="timeline-label">
              {lane.id === "shared" ? (
                <span className="together-avatar">
                  <Users size={17} />
                </span>
              ) : (
                <Avatar name={lane.name} person={lane.id} small />
              )}
              <div>
                <strong>{lane.name}</strong>
                <span>{lane.detail}</span>
              </div>
            </div>
            <div
              className="lane-track"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                onMonth(
                  Math.max(
                    0,
                    Math.min(
                      plan.months - 1,
                      Math.round(
                        ((e.clientX - r.left) / r.width) * (plan.months - 1),
                      ),
                    ),
                  ),
                );
              }}
            >
              <div className="grid-lines">
                {years.map((y) => (
                  <span key={y} />
                ))}
              </div>
              <div
                className="time-cursor"
                style={{
                  left: `${(month / Math.max(1, plan.months - 1)) * 100}%`,
                }}
              />
              {plan.events
                .filter((e) => e.owner === lane.id)
                .map((e) => {
                  const Icon = icons[e.kind],
                    start = preview?.id === e.id ? preview.start : e.start;
                  const purchase = plan.events.find(
                    (item) => item.kind === "home",
                  );
                  const duration =
                    e.kind === "move"
                      ? Math.max(
                          1,
                          (purchase && purchase.start > start
                            ? purchase.start
                            : plan.months) - start,
                        )
                      : e.kind === "home"
                        ? plan.months - start
                        : Math.min(e.duration, plan.months - start);
                  return (
                    <button
                      className={`event-bar ${e.owner} ${selected === e.id ? "chosen" : ""}`}
                      key={e.id}
                      aria-label={`${e.title}, ${dateLabel(monthDate(plan.startDate, start))}. Select to edit date and details.`}
                      title={`${e.title} · ${dateLabel(monthDate(plan.startDate, start))}`}
                      style={{
                        left: `${(start / plan.months) * 100}%`,
                        width: `${(duration / plan.months) * 100}%`,
                      }}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        if (!drag.current?.moved) onSelect(e.id);
                      }}
                      onPointerDown={(ev) => {
                        if (ev.button !== 0) return;
                        drag.current = {
                          id: e.id,
                          x: ev.clientX,
                          start: e.start,
                          moved: false,
                        };
                        ev.currentTarget.setPointerCapture(ev.pointerId);
                      }}
                      onPointerMove={(ev) => {
                        const d = drag.current;
                        if (!d || d.id !== e.id) return;
                        const width =
                          ev.currentTarget.parentElement!.getBoundingClientRect()
                            .width;
                        const diff = ev.clientX - d.x;
                        if (Math.abs(diff) > 5) d.moved = true;
                        if (d.moved)
                          setPreview({
                            id: e.id,
                            start: Math.max(
                              0,
                              Math.min(
                                plan.months - 1,
                                d.start +
                                  Math.round((diff / width) * plan.months),
                              ),
                            ),
                          });
                      }}
                      onPointerUp={(ev) => {
                        const d = drag.current;
                        if (d?.moved && preview) {
                          onMove(e.id, preview.start);
                          setTimeout(() => {
                            drag.current = null;
                          }, 0);
                        } else drag.current = null;
                        setPreview(null);
                        ev.currentTarget.releasePointerCapture(ev.pointerId);
                      }}
                      onPointerCancel={() => {
                        drag.current = null;
                        setPreview(null);
                      }}
                    >
                      <Icon size={13} />
                      <span>{e.title}</span>
                      {e.approvedBy.length === 2 && <CheckCheck size={12} />}
                    </button>
                  );
                })}
              {!plan.events.some((e) => e.owner === lane.id) && (
                <span className="empty-lane">
                  A little space for what’s next
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FinancialChart({
  rows,
  baseline,
  metric,
  month,
  onMonth,
  opening,
  band,
}: {
  rows: Month[];
  baseline: Month[];
  metric: "totalCash" | "netWorth";
  month: number;
  onMonth: (n: number) => void;
  opening: number;
  band?: { low: number; median: number; high: number }[];
}) {
  const W = 900,
    H = 280,
    L = 65,
    R = 24,
    T = 18,
    B = 32,
    n = rows.length;
  const values = [
    opening,
    0,
    ...rows.map((r) => r[metric]),
    ...baseline.map((r) => r[metric]),
    ...(band ? band.flatMap((b) => [b.low, b.high]) : []),
  ];
  const lo = Math.min(...values),
    hi = Math.max(...values),
    padding = (hi - lo) * 0.1 || 1000,
    min = Math.min(0, lo - padding),
    max = hi + padding;
  const x = (i: number) => L + (i / n) * (W - L - R),
    y = (v: number) => T + ((max - v) / (max - min)) * (H - T - B);
  const path = (vals: number[]) =>
    vals
      .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`)
      .join(" ");
  const line = path([opening, ...rows.map((r) => r[metric])]);
  const base = path([opening, ...baseline.map((r) => r[metric])]);
  const area = `${line} L${x(n)},${y(Math.max(0, min))} L${x(0)},${y(Math.max(0, min))} Z`;
  const bandPath = band
    ? path([opening, ...band.map((b) => b.high)]) +
      " " +
      [opening, ...band.map((b) => b.low)]
        .map(
          (_, i, arr) =>
            `L${x(arr.length - 1 - i)},${y(arr[arr.length - 1 - i])}`,
        )
        .join(" ") +
      " Z"
    : "";
  const tickCount = 4;
  return (
    <div className="financial-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${metric === "totalCash" ? "Liquid savings" : "Net worth"} compared with unchanged plan. Selected ${dateLabel(rows[month]?.date ?? rows[0].date)}.`}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const xx = ((e.clientX - r.left) / r.width) * W;
          onMonth(
            Math.max(
              0,
              Math.min(n - 1, Math.round(((xx - L) / (W - L - R)) * n) - 1),
            ),
          );
        }}
      >
        <defs>
          <linearGradient id="cash-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#4b9581" stopOpacity=".16" />
            <stop offset="100%" stopColor="#4b9581" stopOpacity=".01" />
          </linearGradient>
        </defs>
        {Array.from({ length: tickCount + 1 }, (_, i) => {
          const v = min + ((max - min) * i) / tickCount;
          return (
            <g key={i}>
              <line
                x1={L}
                x2={W - R}
                y1={y(v)}
                y2={y(v)}
                stroke="#e9ecee"
                strokeDasharray="3 5"
              />
              <text x={L - 12} y={y(v) + 4} textAnchor="end">
                {Math.abs(v) >= 1000
                  ? `${Math.round(v / 1000)}k`
                  : Math.round(v)}
              </text>
            </g>
          );
        })}
        <path d={area} fill="url(#cash-fill)" />
        {band && <path d={bandPath} fill="#4b9581" opacity=".16" />}
        <path
          d={base}
          fill="none"
          stroke="#a4adb5"
          strokeWidth="2"
          strokeDasharray="5 6"
        />
        <path
          d={line}
          fill="none"
          stroke="#317b67"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <line
          x1={x(month + 1)}
          x2={x(month + 1)}
          y1={T}
          y2={H - B}
          stroke="#98a8a2"
          strokeDasharray="3 4"
        />
        <circle
          cx={x(month + 1)}
          cy={y(rows[month]?.[metric] ?? 0)}
          r="5"
          fill="#317b67"
          stroke="white"
          strokeWidth="3"
        />
        {Array.from({ length: Math.ceil(n / 12) }, (_, i) => (
          <text key={i} x={x(i * 12)} y={H - 8} textAnchor="middle">
            {Number(rows[0].date.slice(0, 4)) + i}
          </text>
        ))}
      </svg>
      <input
        className="chart-scrubber"
        aria-label="Selected month"
        type="range"
        min={0}
        max={n - 1}
        value={month}
        onChange={(e) => onMonth(Number(e.target.value))}
      />
    </div>
  );
}
export default App;
