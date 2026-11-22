"use client";

import { ArrowRight, CheckCircle2, Home, ShieldCheck, Users } from "lucide-react";
import { useState } from "react";

import { CashChart, ChartLegend } from "@/components/charts/CashChart";
import { IssueCard } from "@/components/IssueCard";
import { Avatar, Badge, Button, Card, CardHeader, InfoTip, Progress, Segmented, Skeleton, StatusPill, Tip, clsx } from "@/components/ui";
import { chf, monthLabel, pct } from "@/lib/format";
import { useDisplayed, useStore } from "@/lib/store";
import type { Evaluation, PersonResult } from "@/lib/types";

export function ChecksBadge({ ev }: { ev: Evaluation }) {
  const c = ev.checks;
  return (
    <Tip
      content={
        <div className="space-y-0.5">
          <div className="font-semibold">Accounting identities, checked on every run</div>
          <div>Opening cash + net flows = closing cash: max error CHF {Number(c.cash_identity_max_error).toExponential(1)}</div>
          <div>Partner transfers cancel at household level: {Number(c.transfers_cancel_max_error).toExponential(1)}</div>
          <div>Net worth = assets − liabilities: {Number(c.net_worth_identity_max_error).toExponential(1)}</div>
          <div>Property & mortgage shares sum to totals: {Number(c.ownership_split_max_error).toExponential(1)}</div>
        </div>
      }
    >
      <span tabIndex={0} className={clsx("inline-flex items-center gap-1 text-[12px]", c.ok ? "text-good" : "text-bad-strong")}>
        <ShieldCheck size={13} /> {c.ok ? "All accounting checks pass" : "Accounting check failed"}
      </span>
    </Tip>
  );
}

function PersonCard({ p, i, base }: { p: PersonResult; i: number; base?: PersonResult }) {
  const { setTab, setPersonalFocus } = useStore();
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={p.name} index={i} size={32} />
          <div>
            <div className="text-[15px] font-semibold">{p.name}</div>
            <div className="text-[12px] text-muted">Personal twin</div>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => { setPersonalFocus(p.id); setTab("personal"); }}>
          Open <ArrowRight size={14} />
        </Button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
        <div>
          <div className="flex items-center gap-1 text-[12px] text-muted">Lowest cash <InfoTip content="The lowest month-end cash balance across the whole plan. This is where flexibility is smallest." /></div>
          <div className={clsx("tnum mt-0.5 text-[19px] font-semibold", p.breach ? "text-bad-strong" : "text-ink")}>{chf(p.min_cash, { compact: true })}</div>
          <div className="text-[12px] text-muted">{monthLabel(p.min_cash_month)}{base && base.min_cash !== p.min_cash && <> · was {chf(base.min_cash, { compact: true })}</>}</div>
        </div>
        <div>
          <div className="flex items-center gap-1 text-[12px] text-muted">Safety cushion <InfoTip content={`Lowest cash minus ${p.name}'s minimum safety buffer of ${chf(p.floor)}. Negative means the buffer is breached.`} /></div>
          <div className={clsx("tnum mt-0.5 text-[19px] font-semibold", p.headroom < 0 ? "text-bad-strong" : "text-ink")}>{chf(p.headroom, { compact: true })}</div>
          <div className="text-[12px] text-muted">above {chf(p.floor, { compact: true })} minimum</div>
        </div>
        <div>
          <div className="flex items-center gap-1 text-[12px] text-muted">Tightest runway <InfoTip content="At the tightest month: how many months of recurring costs could be paid from cash without any income. A measure of future options." /></div>
          <div className="tnum mt-0.5 text-[19px] font-semibold">{p.lowest_runway_months === null ? "—" : `${p.lowest_runway_months.toFixed(1)} mo`}</div>
          <div className="text-[12px] text-muted">{monthLabel(p.lowest_runway_month)}</div>
        </div>
        <div>
          <div className="text-[12px] text-muted">Net worth at end</div>
          <div className="tnum mt-0.5 text-[19px] font-semibold">{chf(p.end_net_worth, { compact: true })}</div>
          <div className="text-[12px] text-muted">from {chf(p.start_net_worth, { compact: true })} today</div>
        </div>
      </div>
      {p.goals.length > 0 && (
        <div className="mt-5 space-y-3 border-t border-line pt-4">
          {p.goals.map((g) => (
            <div key={g.id}>
              <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                <span className="font-medium text-ink">{g.name}</span>
                <span className={clsx("tnum", g.met ? "text-good" : g.in_horizon ? "text-warn" : "text-muted")}>
                  {g.met ? "On track" : g.in_horizon ? `${chf(g.shortfall_chf, { compact: true })} short` : "After horizon"}
                </span>
              </div>
              <Progress value={g.progress} tone={g.met ? "good" : "warn"} className="mt-1.5" />
              <div className="mt-1 text-[11.5px] text-muted">{chf(g.target_chf, { compact: true })} by {monthLabel(g.target_date)}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SharedCard({ ev }: { ev: Evaluation }) {
  const { draftPlan, setTab, name } = useStore();
  if (!draftPlan) return null;
  const pr = ev.property;
  const hh = draftPlan.shared.household;
  if (!pr && !hh.enabled) {
    return (
      <Card className="flex flex-col justify-between p-5">
        <div>
          <div className="flex items-center gap-2 text-[15px] font-semibold"><Users size={17} className="text-muted" /> Together</div>
          <p className="mt-2 text-[13px] leading-5 text-muted">
            Nina and Emil currently plan separately. Connect your finances to model living together, sharing costs and buying a home — each partner keeps their own accounts.
          </p>
        </div>
        <Button className="mt-4 self-start" variant="primary" size="sm" onClick={() => setTab("together")}>Plan together <ArrowRight size={14} /></Button>
      </Card>
    );
  }
  const people = ev.people;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[15px] font-semibold"><Home size={17} className="text-muted" /> {pr ? "Our home" : "Living together"}</div>
        <Button size="sm" variant="ghost" onClick={() => setTab("together")}>Edit <ArrowRight size={14} /></Button>
      </div>
      {pr ? (
        <>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="tnum text-[22px] font-semibold">{chf(pr.price, { compact: true })}</span>
            <span className="text-[12.5px] text-muted">buy {monthLabel(pr.purchase)}</span>
          </div>
          <div className="mt-3 text-[12px] text-muted">Deposit & fees {chf(pr.deposit + pr.fees, { compact: true })}</div>
          <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full">
            <div className="bg-p0" style={{ width: pct(pr.ownership[0]) }} />
            <div className="w-[2px] bg-white" />
            <div className="bg-p1" style={{ width: pct(pr.ownership[1]) }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[12px]">
            {people.map((p, i) => (
              <span key={p.id} className="tnum text-ink-2"><b className={i === 0 ? "text-p0" : "text-p1"}>{name(p.id)}</b> {chf(pr.contributions[i], { compact: true })} · {pct(pr.ownership[i])}</span>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-[12.5px]">
            <div>
              <div className="text-muted">Mortgage</div>
              <div className="tnum font-semibold">{chf(pr.mortgage, { compact: true })}</div>
            </div>
            <div>
              <div className="text-muted">Monthly cost</div>
              <div className="tnum font-semibold">{chf(pr.monthly_interest + pr.monthly_maintenance + pr.monthly_amortization)}</div>
            </div>
          </div>
          {pr.affordability && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-[12px]">
                <span className="flex items-center gap-1 text-muted">Indicative affordability <InfoTip content="Bank-style test: 5% imputed interest + 1% maintenance + required amortisation ≤ 1/3 of income. Applied to net income because gross income is not in the data — stricter than a lender. Not a lender assessment." /></span>
                <span className={clsx("tnum font-medium", pr.affordability.passes ? "text-good" : "text-bad-strong")}>{pct(pr.affordability.ratio, 1)} of {pct(pr.affordability.max_ratio)}</span>
              </div>
              <Progress value={(pr.affordability.ratio ?? 1) / pr.affordability.max_ratio} tone={pr.affordability.passes ? "good" : "bad"} className="mt-1.5" />
            </div>
          )}
        </>
      ) : (
        <div className="mt-3 space-y-1.5 text-[13px]">
          <div className="flex justify-between"><span className="text-muted">Move in</span><span className="font-medium">{monthLabel(hh.move_in)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Shared rent</span><span className="tnum font-medium">{chf(hh.rent)}/mo</span></div>
          <div className="flex justify-between"><span className="text-muted">Household costs</span><span className="tnum font-medium">{chf(hh.rent + hh.utilities + hh.groceries)}/mo</span></div>
        </div>
      )}
    </Card>
  );
}

export function Overview() {
  const { ws, draft, setTab, preview } = useStore();
  const { current, base } = useDisplayed();
  const [metric, setMetric] = useState<"cash" | "net_worth">("cash");
  if (!current || !ws) return <OverviewSkeleton />;
  const hard = current.issues.filter((i) => i.severity === "hard");
  const hasDraft = draft.length > 0 || !!preview;
  return (
    <div className="fade-up space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[24px] font-semibold tracking-tight">{ws.people.map((p) => p.name).join(" & ")}</h1>
            <StatusPill status={current.status} />
            {hasDraft && <Badge tone="info">{preview ? "Preview" : "Including your draft"}</Badge>}
          </div>
          <p className="mt-1 text-[13.5px] text-muted">
            Monthly projection {monthLabel(current.months[0])} – {monthLabel(current.months[current.months.length - 1])}, started from UBS synthetic records.
          </p>
        </div>
        <ChecksBadge ev={current} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader
            title={metric === "cash" ? "Cash of each partner" : "Net worth of each partner"}
            subtitle={metric === "cash" ? "Bank cash, month by month. Separate accounts — never pooled." : "Cash + investments + share of home equity − debt."}
            action={<Segmented size="sm" ariaLabel="Metric" value={metric} onChange={setMetric} options={[{ value: "cash", label: "Cash" }, { value: "net_worth", label: "Net worth" }]} />}
          />
          <div className="px-2 sm:px-4">
            <CashChart current={current} base={hasDraft ? base : null} metric={metric} showFloors={metric === "cash"} />
          </div>
          <div className="px-5 pt-2 pb-4 sm:px-6">
            <ChartLegend names={current.people.map((p) => p.name)} showBase={hasDraft} showFloor={metric === "cash"} showBreak={current.events.some((e) => e.kind === "career_break")} />
          </div>
        </Card>

        <div className="space-y-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">What needs attention</h2>
          {current.issues.length === 0 && current.people.filter((p) => p.headroom < 0.25 * p.floor).map((p) => (
            <Card key={p.id} className="border-[#f1e1bf] bg-warn-soft/50 p-4">
              <div className="text-[13.5px] font-semibold text-ink">Tight, but feasible</div>
              <p className="mt-1 text-[12.5px] leading-5 text-ink-2">
                In {monthLabel(p.min_cash_month)} {p.name}&apos;s cash is only {chf(p.headroom)} above the minimum safety buffer. A modest shock — higher rates or costs — could break the plan. Try a stress test.
              </p>
            </Card>
          ))}
          {current.issues.length === 0 ? (
            <Card className="p-5">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 shrink-0 text-good" size={18} />
                <div>
                  <div className="text-[14px] font-semibold">Everything checks out</div>
                  <p className="mt-1 text-[13px] leading-5 text-muted">Under these assumptions both partners stay above their safety buffers and every goal is met.</p>
                </div>
              </div>
              <Button className="mt-4" size="sm" onClick={() => setTab("explore")}>Explore a decision <ArrowRight size={14} /></Button>
            </Card>
          ) : (
            <>
              {current.issues.slice(0, 4).map((i) => <IssueCard key={i.id} issue={i} />)}
              <Button variant={hard.length ? "primary" : "secondary"} className="w-full" onClick={() => setTab("explore")}>
                See ways to make it work <ArrowRight size={15} />
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {current.people.map((p, i) => <PersonCard key={p.id} p={p} i={i} base={hasDraft ? base?.people[i] : undefined} />)}
        <SharedCard ev={current} />
      </div>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-80" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-[420px]" />
        <Skeleton className="h-[420px]" />
      </div>
    </div>
  );
}
