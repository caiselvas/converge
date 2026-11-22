"use client";

import { Home, KeyRound, Scale } from "lucide-react";

import { CashChart, ChartLegend } from "@/components/charts/CashChart";
import { IssueCard } from "@/components/IssueCard";
import { Avatar, Card, CardHeader, Field, InfoTip, MonthField, NumberField, Progress, Range, Segmented, StatusPill, Toggle, clsx } from "@/components/ui";
import { chf, monthLabel, pct } from "@/lib/format";
import { getPath } from "@/lib/plan";
import { useDisplayed, useStore } from "@/lib/store";
import type { Plan } from "@/lib/types";

function useEdit() {
  const { plan, draftPlan, setChange } = useStore();
  const changed = (path: string) => !!plan && !!draftPlan && JSON.stringify(getPath(plan, path)) !== JSON.stringify(getPath(draftPlan, path));
  const was = (path: string, fmt: (v: never) => string) => (changed(path) && plan ? fmt(getPath(plan, path) as never) : null);
  return { set: setChange, changed, was };
}

function shareFirst(plan: Plan): number {
  const sp = plan.shared.split;
  if (sp.mode === "equal") return 0.5;
  if (sp.mode === "custom") return sp.custom_share_first;
  const [a, b] = plan.people;
  return a.income_monthly / (a.income_monthly + b.income_monthly);
}

function LivingCard({ plan }: { plan: Plan }) {
  const { set, changed, was } = useEdit();
  const hh = plan.shared.household;
  const [a, b] = plan.people;
  const rentOf = (p: Plan["people"][number]) => p.categories.find((c) => c.key === "housing_rent")?.budget_monthly ?? 0;
  const ownHousing = plan.people.reduce((s, p) => s + p.categories.filter((c) => c.household).reduce((x, c) => x + c.budget_monthly, 0), 0);
  const shared = hh.rent + hh.utilities + hh.groceries;
  return (
    <Card>
      <CardHeader icon={<KeyRound size={17} />} title="Live together" subtitle="One shared home replaces both current homes — rent, utilities and groceries are never counted twice."
        action={<Toggle label="Live together" checked={hh.enabled} onChange={(v) => set("shared.household.enabled", v)} />} />
      {hh.enabled ? (
        <div className="divide-y divide-line px-5 pb-3 sm:px-6">
          <Field label="Move-in" changedFrom={was("shared.household.move_in", monthLabel)}>
            <MonthField ariaLabel="Move-in month" value={hh.move_in} changed={changed("shared.household.move_in")} min={plan.assumptions.start} onChange={(v) => set("shared.household.move_in", v)} />
          </Field>
          <Field label="Shared rent" hint={`Replaces ${a.name}'s ${chf(rentOf(a))} and ${b.name}'s ${chf(rentOf(b))}`} changedFrom={was("shared.household.rent", chf)}>
            <NumberField ariaLabel="Shared rent" value={hh.rent} step={50} changed={changed("shared.household.rent")} onChange={(v) => set("shared.household.rent", v)} />
          </Field>
          <Field label="Utilities" changedFrom={was("shared.household.utilities", chf)}>
            <NumberField ariaLabel="Shared utilities" value={hh.utilities} step={10} changed={changed("shared.household.utilities")} onChange={(v) => set("shared.household.utilities", v)} />
          </Field>
          <Field label="Groceries" hint="Default: both partners' observed groceries combined" changedFrom={was("shared.household.groceries", chf)}>
            <NumberField ariaLabel="Shared groceries" value={hh.groceries} step={20} changed={changed("shared.household.groceries")} onChange={(v) => set("shared.household.groceries", v)} />
          </Field>
          <Field label="Moving costs" hint="One-off, shared" changedFrom={was("shared.household.moving_cost", chf)}>
            <NumberField ariaLabel="Moving costs" value={hh.moving_cost} step={250} changed={changed("shared.household.moving_cost")} onChange={(v) => set("shared.household.moving_cost", v)} />
          </Field>
          <div className="flex items-center justify-between py-3 text-[13px]">
            <span className="text-muted">Household costs vs. two separate homes</span>
            <span className="tnum font-semibold">{chf(shared)} <span className="font-normal text-muted">vs {chf(ownHousing)}</span>
              <span className={clsx("ml-2 text-[12px] font-medium", shared <= ownHousing ? "text-good" : "text-warn")}>{chf(shared - ownHousing, { sign: true })}/mo</span>
            </span>
          </div>
        </div>
      ) : (
        <p className="px-5 pb-5 text-[13px] text-muted sm:px-6">Each partner keeps their own home. Buying a home together implies moving in on the purchase date.</p>
      )}
    </Card>
  );
}

function SplitCard({ plan }: { plan: Plan }) {
  const { set, changed } = useEdit();
  const sp = plan.shared.split;
  const s = shareFirst(plan);
  const [a, b] = plan.people;
  const hh = plan.shared.household;
  const total = hh.enabled ? hh.rent + hh.utilities + hh.groceries : hh.utilities + hh.groceries;
  const amounts = [s * total, (1 - s) * total];
  const hasBreak = plan.people.some((p) => p.career_breaks.length > 0);
  return (
    <Card>
      <CardHeader icon={<Scale size={17} />} title="Sharing household costs" subtitle="Contributions go into a joint household account. Personal savings stay personal."
        action={<Segmented size="sm" ariaLabel="Cost-sharing rule" value={sp.mode} onChange={(v) => set("shared.split.mode", v)}
          options={[{ value: "equal", label: "Equal" }, { value: "income", label: "By income" }, { value: "custom", label: "Custom" }]} />} />
      <div className="px-5 pb-5 sm:px-6">
        {sp.mode === "custom" && (
          <div className="mb-4">
            <div className="mb-1.5 flex justify-between text-[12.5px] text-muted"><span>{a.name} {pct(s)}</span><span>{b.name} {pct(1 - s)}</span></div>
            <Range ariaLabel={`${a.name}'s share of household costs`} value={Math.round(s * 100)} min={0} max={100} step={5} color="var(--color-p0)"
              onChange={(v) => set("shared.split.custom_share_first", v / 100)} />
          </div>
        )}
        <div className="space-y-3">
          {[a, b].map((p, i) => (
            <div key={p.id} className="flex items-center gap-3">
              <Avatar name={p.name} index={i} size={26} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="font-medium">{p.name}</span>
                  <span className="tnum"><b>{chf(amounts[i])}</b><span className="text-muted">/mo · {pct(amounts[i] / Math.max(1, p.income_monthly))} of net income</span></span>
                </div>
                <Progress value={i === 0 ? s : 1 - s} tone={i === 0 ? "p0" : "p1"} className="mt-1.5" />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-muted">{hh.enabled ? "Monthly household costs while renting." : "Shared costs once you live together."} After a purchase, home costs follow ownership shares.</p>
        {hasBreak && (
          <div className="mt-4 flex items-center justify-between gap-4 rounded-xl bg-page px-4 py-3 ring-1 ring-line">
            <div>
              <div className="text-[13px] font-medium">Cover for each other during career breaks</div>
              <div className="text-[12px] text-muted">While one partner earns less, contributions follow actual income.</div>
            </div>
            <Toggle label="Cover during career breaks" checked={sp.adjust_for_breaks} onChange={(v) => set("shared.split.adjust_for_breaks", v)} />
          </div>
        )}
        {changed("shared.split.mode") && <p className="mt-2 text-[12px] text-accent">Changed from the agreed rule — needs both partners.</p>}
      </div>
    </Card>
  );
}

function HomeCard({ plan }: { plan: Plan }) {
  const { set, changed, was } = useEdit();
  const { current } = useDisplayed();
  const pr = plan.shared.property;
  const [a, b] = plan.people;
  const deposit = pr.price * pr.deposit_pct;
  const fees = pr.price * pr.fees_pct;
  const aff = current?.property?.affordability;
  const prop = current?.property;
  return (
    <Card>
      <CardHeader icon={<Home size={17} />} title="Buy a home together" subtitle="Deposit converts cash into equity; ownership follows each partner's share of the deposit."
        action={<Toggle label="Buy a home" checked={pr.enabled} onChange={(v) => set("shared.property.enabled", v)} />} />
      {!pr.enabled ? (
        <p className="px-5 pb-5 text-[13px] text-muted sm:px-6">Turn on to model a purchase. Defaults: a {chf(pr.price, { compact: true })} home in Zurich, {pct(pr.deposit_pct)} deposit, bought {monthLabel(pr.purchase)}.</p>
      ) : (
        <div className="px-5 pb-5 sm:px-6">
          <div className="divide-y divide-line">
            <Field label="Price" changedFrom={was("shared.property.price", chf)}>
              <NumberField ariaLabel="Property price" value={pr.price} step={50_000} width={160} changed={changed("shared.property.price")} onChange={(v) => set("shared.property.price", v)} />
            </Field>
            <Field label="Buy in" changedFrom={was("shared.property.purchase", monthLabel)}>
              <MonthField ariaLabel="Purchase month" value={pr.purchase} min={plan.assumptions.start} changed={changed("shared.property.purchase")} onChange={(v) => set("shared.property.purchase", v)} />
            </Field>
            <Field label="We hope to own by" hint="Shared goal" changedFrom={was("shared.property.target_date", monthLabel)}>
              <MonthField ariaLabel="Target date" value={pr.target_date} changed={changed("shared.property.target_date")} onChange={(v) => set("shared.property.target_date", v)} />
            </Field>
            <div className="py-3">
              <div className="flex items-baseline justify-between text-[13.5px]">
                <span className="flex items-center gap-1 font-medium">Deposit <InfoTip content="Swiss lending practice requires at least 20% equity. A larger deposit lowers the mortgage and makes the affordability test easier to pass." /></span>
                <span className="tnum"><b>{pct(pr.deposit_pct)}</b> <span className="text-muted">· {chf(deposit)} + {chf(fees)} fees</span></span>
              </div>
              <div className="mt-2"><Range ariaLabel="Deposit percentage" value={Math.round(pr.deposit_pct * 100)} min={20} max={50} step={1} onChange={(v) => set("shared.property.deposit_pct", v / 100)} /></div>
            </div>
            <div className="py-3">
              <div className="flex items-baseline justify-between text-[13.5px]">
                <span className="font-medium">Who pays the deposit</span>
                {changed("shared.property.ownership_share_first") && <span className="text-[12px] text-accent">was {was("shared.property.ownership_share_first", (v: number) => `${pct(v)} / ${pct(1 - v)}`)}</span>}
              </div>
              <div className="mt-2"><Range ariaLabel={`${a.name}'s share of the deposit`} value={Math.round(pr.ownership_share_first * 100)} min={0} max={100} step={5} color="var(--color-p0)" onChange={(v) => set("shared.property.ownership_share_first", v / 100)} /></div>
              <div className="mt-2 grid grid-cols-2 gap-3 text-[12.5px]">
                {[a, b].map((p, i) => {
                  const share = i === 0 ? pr.ownership_share_first : 1 - pr.ownership_share_first;
                  return (
                    <div key={p.id} className={clsx("rounded-lg px-3 py-2", i === 0 ? "bg-p0-soft" : "bg-p1-soft text-right")}>
                      <div className={clsx("font-semibold", i === 0 ? "text-p0" : "text-p1")}>{p.name} · {pct(share)}</div>
                      <div className="tnum text-ink-2">{chf((deposit + fees) * share)} upfront</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <Field label="Mortgage rate" hint="Fixed, per year" changedFrom={was("shared.property.mortgage_rate", (v: number) => pct(v, 2))}>
              <NumberField ariaLabel="Mortgage rate percent" value={Number((pr.mortgage_rate * 100).toFixed(2))} step={0.1} decimals={2} prefix="" suffix="%" width={130} changed={changed("shared.property.mortgage_rate")} onChange={(v) => set("shared.property.mortgage_rate", Number((v / 100).toFixed(4)))} />
            </Field>
            <Field label="Amortise the second mortgage" hint="Down to 2/3 of value within 15 years">
              <Toggle label="Amortise" checked={pr.amortize} onChange={(v) => set("shared.property.amortize", v)} />
            </Field>
          </div>
          {prop && (
            <div className="mt-2 rounded-xl bg-page p-4 ring-1 ring-line">
              <div className="grid grid-cols-2 gap-3 text-[12.5px] sm:grid-cols-4">
                <div><div className="text-muted">Mortgage</div><div className="tnum font-semibold">{chf(prop.mortgage, { compact: true })}</div></div>
                <div><div className="text-muted">Interest</div><div className="tnum font-semibold">{chf(prop.monthly_interest)}/mo</div></div>
                <div><div className="text-muted">Maintenance</div><div className="tnum font-semibold">{chf(prop.monthly_maintenance)}/mo</div></div>
                <div><div className="text-muted">Amortisation</div><div className="tnum font-semibold">{chf(prop.monthly_amortization)}/mo</div></div>
              </div>
              {aff && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="flex items-center gap-1 font-medium">Indicative affordability <InfoTip content="Bank practice: 5% imputed interest + 1% maintenance + required amortisation ≤ 1/3 of gross income. Gross income is not in the data, so Converge uses net income (stricter). This is not a lender assessment." /></span>
                    <span className={clsx("tnum font-semibold", aff.passes ? "text-good" : "text-bad-strong")}>{pct(aff.ratio, 1)} <span className="font-normal text-muted">of max {pct(aff.max_ratio)}</span></span>
                  </div>
                  <Progress value={(aff.ratio ?? 1) / aff.max_ratio} tone={aff.passes ? "good" : "bad"} className="mt-1.5" />
                  <div className="mt-1.5 text-[12px] text-muted">Highest price passing this test with a {pct(pr.deposit_pct)} deposit: <b className="tnum text-ink">{chf(aff.max_price)}</b></div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function Together() {
  const { draftPlan, ws, draft, preview } = useStore();
  const { current, base } = useDisplayed();
  const hasDraft = draft.length > 0 || !!preview;
  if (!draftPlan || !ws) return null;
  const sharedIssues = current?.issues ?? [];
  return (
    <div className="fade-up space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Planning together</h1>
        <p className="mt-1 text-[13.5px] text-muted">Shared decisions need both partners. Every edit is simulated immediately for each of you.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <HomeCard plan={draftPlan} />
          <LivingCard plan={draftPlan} />
          <SplitCard plan={draftPlan} />
        </div>
        <div className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader title="Impact on each of you" action={current && <StatusPill status={current.status} size="sm" />} />
            {current && (
              <>
                <div className="px-2"><CashChart current={current} base={hasDraft ? base : null} height={220} /></div>
                <div className="px-5 pt-1 pb-3"><ChartLegend names={current.people.map((p) => p.name)} showBase={hasDraft} showBreak={current!.events.some((e) => e.kind === "career_break")} /></div>
                <div className="space-y-2 border-t border-line px-5 py-4">
                  {current.people.map((p, i) => (
                    <div key={p.id} className="flex items-center justify-between text-[13px]">
                      <span className="flex items-center gap-2"><Avatar name={p.name} index={i} size={20} />{p.name}&apos;s lowest cash</span>
                      <span className={clsx("tnum font-semibold", p.breach ? "text-bad-strong" : "text-ink")}>{chf(p.min_cash, { compact: true })} <span className="font-normal text-muted">{monthLabel(p.min_cash_month, true)}</span></span>
                    </div>
                  ))}
                </div>
                {sharedIssues.length > 0 && <div className="space-y-2 border-t border-line px-4 py-4">{sharedIssues.map((x) => <IssueCard key={x.id} issue={x} compact />)}</div>}
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
