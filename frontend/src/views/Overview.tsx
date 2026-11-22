import { motion, useReducedMotion } from 'motion/react'
import { ArrowRight, CalendarClock, Target } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge, CategoryIcon, Disclosure, Empty, Fields, Num, Page, PageTitle, Panel, ease } from '@/components/kit'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { chf, chfSigned, compact, date, inPeriod, month, monthShort, niceTicks, openingPosition, spendingBy, words, type Month, type Rec, type Scenario } from '@/lib/data'
import type { Preset, View } from '@/App'
import { cn } from '@/lib/utils'

type Props = { rec: Rec; months: Month[]; scenarios: Scenario[]; openActivity: (p: NonNullable<Preset>) => void; setView: (v: View) => void; openScenario: (id: string) => void }

const periodLabel = (p: string, long = true) => (p === 'all' ? 'All 24 months' : p.length === 4 ? p : month(p, long))
const axis = { tickLine: false, axisLine: false, tick: { fontSize: 12, fill: 'var(--muted-foreground)' } } as const

function Tip({ title, rows, note }: { title: string; rows: [string, string, string?][]; note?: string }) {
  return (
    <div className="min-w-44 rounded-lg border bg-card p-3 text-xs shadow-pop">
      <p className="mb-1.5 font-medium">{title}</p>
      {rows.map(([k, v, c]) => (
        <p key={k} className="flex justify-between gap-4 py-0.5"><span className="text-muted-foreground">{k}</span><span className={cn('tnum font-medium', c)}>{v}</span></p>
      ))}
      {note && <p className="mt-1.5 border-t pt-1.5 text-negative">{note}</p>}
    </div>
  )
}

function BarRow({ label, sub, value, max, tone = 'brand', active, onClick }: {
  label: string; sub?: string; value: number; max: number; tone?: 'brand' | 'negative'; active?: boolean; onClick?: () => void
}) {
  const Row = onClick ? 'button' : 'div'
  return (
    <Row onClick={onClick} aria-pressed={onClick ? active : undefined}
      className={cn('block w-full rounded-lg px-2 py-1.5 text-left', onClick && 'transition-colors hover:bg-muted/70', active && 'bg-muted')}>
      <span className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium">{label}{sub && <span className="font-normal text-muted-foreground"> · {sub}</span>}</span>
        <span className="tnum shrink-0 font-medium">{chf(value)}</span>
      </span>
      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted">
        <motion.span className={cn('block h-full origin-left rounded-full', tone === 'brand' ? (active === false ? 'bg-brand/45' : 'bg-brand') : 'bg-negative')}
          initial={{ scaleX: 0 }} animate={{ scaleX: Math.max(value / max, 0.01) }} transition={{ duration: 0.7, ease }} style={{ width: '100%' }} />
      </span>
    </Row>
  )
}

export default function Overview({ rec, months, scenarios, openActivity, setView, openScenario }: Props) {
  const { profile: p } = rec
  const latest = months[months.length - 1].month
  const [period, setPeriod] = useState(latest)
  const [category, setCategory] = useState<string | null>(null)
  const noMotion = useReducedMotion()
  const dur = noMotion ? 0 : 700

  const sel = months.filter(m => inPeriod(m.month, period))
  const income = sel.reduce((s, m) => s + m.income, 0)
  const expenses = sel.reduce((s, m) => s + m.expenses, 0)
  const net = sel.reduce((s, m) => s + m.net, 0)
  const closing = sel[sel.length - 1].closing
  const shortfalls = sel.filter(m => m.status !== 'ok')
  const single = period.length === 7
  const per = sel.length > 1 ? ` · ${chf(net / sel.length)} avg / month` : ''

  const cash = useMemo(() => [{ label: 'Opening', key: 'open', value: months[0].opening }, ...months.map(m => ({ label: monthShort(m.month), key: m.month, value: m.closing }))], [months])
  const byLabel = new Map(cash.map(c => [c.label, c.key]))
  const monthsBy = new Map(months.map(m => [m.month, m]))
  const pick = (s: { activeLabel?: string | number | undefined }) => {
    const key = byLabel.get(String(s.activeLabel))
    if (key && key !== 'open') setPeriod(key)
  }
  const labels = sel.map(m => monthShort(m.month))
  const hasNegative = months.some(m => m.closing < 0)
  const values = cash.map(c => c.value)
  const [lo, hi] = [Math.min(...values), Math.max(...values)]
  const zero = lo >= 0 ? 1 : hi <= 0 ? 0 : hi / (hi - lo)
  const cashTicks = niceTicks(Math.min(lo, 0), Math.max(hi, 0))
  const flowTicks = niceTicks(0, Math.max(...months.flatMap(m => [m.income, m.expenses])))

  const spend = useMemo(() => spendingBy(rec, period), [rec, period])
  const spendMax = spend[0]?.total ?? 1
  const cat = spend.find(s => s.category === category)
  const catTx = cat ? rec.transactions.filter(t => t[2] === cat.category && t[3] < 0 && inPeriod(t[1].slice(0, 7), period)).reverse() : []

  const pos = openingPosition(rec)
  const posMax = Math.max(...rec.assets.map(a => a.value_chf), ...rec.liabilities.map(l => l.opening_principal_chf))
  const recent = rec.transactions.slice(-6).reverse()
  const goals = [...rec.goals].sort((a, b) => a.target_date.localeCompare(b.target_date))
  const years = [...new Set(months.map(m => m.month.slice(0, 4)))]
  const periodItems: Record<string, string> = { all: 'All 24 months', ...Object.fromEntries(years.map(y => [y, y])), ...Object.fromEntries(months.map(m => [m.month, month(m.month, true)])) }

  return (
    <Page>
      <PageTitle title={p.display_name} sub={
        <>{p.age_at_start} years old at ledger start · {p.city}, {p.canton} · {words(p.employment_status)} · {words(p.household_type)} household</>
      }>
        <div className="flex items-center gap-2">
          <Badge tone="outline">Fictional profile · synthetic data</Badge>
          <Select value={period} onValueChange={v => { setPeriod(v as string); setCategory(null) }} items={periodItems}>
            <SelectTrigger aria-label="Period" className="min-w-40 bg-card shadow-panel"><SelectValue /></SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                <SelectItem value="all">All 24 months</SelectItem>
                {years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              </SelectGroup>
              {years.slice().reverse().map(y => (
                <SelectGroup key={y}>
                  <SelectLabel>{y}</SelectLabel>
                  {months.filter(m => m.month.startsWith(y)).reverse().map(m => <SelectItem key={m.month} value={m.month}>{month(m.month, true)}</SelectItem>)}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PageTitle>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel pad={false}>
            <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
              <div>
                <p className="label">Cash balance · ledger close, {periodLabel(period)}</p>
                <p className="mt-1 text-[2.6rem] leading-none font-semibold tracking-[-0.04em]"><Num value={closing} format={n => chf(n, true)} /></p>
                <p className="tnum mt-2 text-sm text-muted-foreground">from {chf(sel[0].opening, true)} at the start of {month(sel[0].month)}</p>
              </div>
              {shortfalls.length > 0 && <Badge tone="negative">Negative balance · {shortfalls.length === 1 ? 'requires financing' : `${shortfalls.length} months require financing`}</Badge>}
            </div>
            <div className="h-64 px-2 pt-4" aria-label="Month-end cash balance, January 2025 to December 2026">
              <ResponsiveContainer>
                <AreaChart data={cash} margin={{ top: 8, right: 14, left: 0, bottom: 0 }} onClick={pick} style={{ cursor: 'pointer' }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
                  <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={28} tickMargin={8} />
                  <YAxis {...axis} width={48} tickFormatter={compact} ticks={cashTicks} domain={[cashTicks[0], cashTicks[cashTicks.length - 1]]} />
                  <defs><linearGradient id="cash-sign" x1="0" y1="0" x2="0" y2="1"><stop offset={zero} stopColor="var(--brand)" /><stop offset={zero} stopColor="var(--negative)" /></linearGradient></defs>
                  {hasNegative && <ReferenceLine y={0} stroke="var(--negative)" strokeOpacity={0.6} strokeDasharray="4 3" />}
                  {!single && period !== 'all' && <ReferenceArea x1={labels[0]} x2={labels[labels.length - 1]} fill="var(--brand)" fillOpacity={0.07} />}
                  <Tooltip cursor={{ stroke: 'var(--ink-2)', strokeOpacity: 0.25 }} content={({ active, payload }) => {
                    const d = active && payload?.[0]?.payload as (typeof cash)[number] | undefined
                    if (!d) return null
                    if (d.key === 'open') return <Tip title={`Opening snapshot · ${date(p.as_of_date)}`} rows={[['Opening cash', chf(d.value, true)]]} />
                    const m = monthsBy.get(d.key)!
                    return <Tip title={`Month-end ledger close · ${month(d.key)}`} note={m.status !== 'ok' ? 'Negative balance requires financing' : undefined}
                      rows={[['Closing cash', chf(m.closing, true)], ['Income', chf(m.income, true)], ['Expenses', chf(m.expenses, true)], ['Net', chfSigned(m.net), m.net < 0 ? 'text-negative' : 'text-brand']]} />
                  }} />
                  <Area dataKey="value" type="monotone" stroke="url(#cash-sign)" strokeWidth={2} fill="url(#cash-sign)" fillOpacity={0.1}
                    animationDuration={dur} animationEasing="ease-out"
                    dot={({ cx, cy, payload }: { cx?: number; cy?: number; payload?: (typeof cash)[number] }) => payload?.key === 'open'
                      ? <circle key="o" cx={cx} cy={cy} r={4.5} fill="var(--card)" stroke="var(--brand)" strokeWidth={2} /> : <g key={payload?.key} />}
                    activeDot={{ r: 4, fill: 'var(--brand)', stroke: 'var(--card)', strokeWidth: 2 }} />
                  {single && <ReferenceLine x={labels[0]} stroke="var(--brand)" strokeDasharray="3 3" />}
                  {single && <ReferenceDot x={labels[0]} y={closing} r={5} fill="var(--brand)" stroke="var(--card)" strokeWidth={2} ifOverflow="extendDomain" />}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="px-5 pb-3 text-xs text-muted-foreground">Hollow point: opening snapshot at {date(p.as_of_date)}. Line: month-end ledger closes, Jan 2025 – Dec 2026 (dataset dates, not today’s balance). Select a point to change period.</p>
            <dl className="grid grid-cols-3 divide-x border-t">
              {[['Income', chf(income), ''], ['Expenses', chf(expenses), ''], ['Net cash flow', chfSigned(net, false), net < 0 ? 'text-negative' : 'text-brand']].map(([k, v, c]) => (
                <div key={k} className="px-4 py-3.5 sm:px-5">
                  <dt className="label">{k} · {periodLabel(period, false)}</dt>
                  <dd className={cn('tnum mt-0.5 text-lg font-semibold tracking-tight', c)}>{v}</dd>
                </div>
              ))}
            </dl>
            {per && <p className="border-t px-5 py-2 text-xs text-muted-foreground">Net cash flow{per}</p>}
          </Panel>

          <Panel title="Income and expenses" aside={
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-brand" />Income</span>
              <span className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-ink-2" />Expenses</span>
            </div>}>
            <div className="h-56 -mx-2">
              <ResponsiveContainer>
                <BarChart data={months.map(m => ({ ...m, label: monthShort(m.month) }))} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={1} barCategoryGap="22%"
                  onClick={s => { const m = months.find(x => monthShort(x.month) === s.activeLabel); if (m) setPeriod(m.month) }} style={{ cursor: 'pointer' }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
                  <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={28} tickMargin={8} />
                  <YAxis {...axis} width={48} tickFormatter={compact} ticks={flowTicks} domain={[0, flowTicks[flowTicks.length - 1]]} />
                  <Tooltip cursor={{ fill: 'var(--muted)', fillOpacity: 0.7 }} content={({ active, payload }) => {
                    const m = active && payload?.[0]?.payload as Month | undefined
                    return m ? <Tip title={month(m.month, true)} rows={[['Income', chf(m.income, true), 'text-brand'], ['Expenses', chf(m.expenses, true)], ['Net', chfSigned(m.net), m.net < 0 ? 'text-negative' : 'text-brand']]} /> : null
                  }} />
                  <Bar dataKey="income" radius={[3, 3, 0, 0]} animationDuration={dur} animationEasing="ease-out">
                    {months.map(m => <Cell key={m.month} fill="var(--brand)" fillOpacity={inPeriod(m.month, period) ? 1 : 0.5} />)}
                  </Bar>
                  <Bar dataKey="expenses" radius={[3, 3, 0, 0]} animationDuration={dur} animationEasing="ease-out">
                    {months.map(m => <Cell key={m.month} fill="var(--ink-2)" fillOpacity={inPeriod(m.month, period) ? 1 : 0.5} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Recent activity" aside={<button onClick={() => setView('activity')} className="flex items-center gap-1 text-sm font-medium text-brand hover:underline">All activity<ArrowRight className="size-3.5" /></button>} pad={false}>
            <ul className="divide-y px-5 pt-2 pb-1">
              {recent.map(([id, d, c, a, desc]) => (
                <li key={id} className="flex items-center gap-3 py-2.5">
                  <CategoryIcon category={c} />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{desc}</p><p className="text-xs text-muted-foreground">{date(d)} · {words(c)}</p></div>
                  <span className={cn('tnum text-sm font-medium', a > 0 && 'text-brand')}>{chfSigned(a)}</span>
                </li>
              ))}
            </ul>
            <p className="px-5 pb-4 pt-1 text-xs text-muted-foreground">Latest records in the dataset, up to {date(recent[0][1])}.</p>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Opening position" aside={<Badge tone="outline">Snapshot · {date(p.as_of_date)}</Badge>}>
            <p className="label">Assets less debt at the opening date</p>
            <p className="mt-1 text-2xl font-semibold tracking-[-0.03em]"><Num value={pos.net} format={n => chf(n)} /></p>
            <div className="mt-4 flex flex-col gap-1 -mx-2">
              {rec.assets.map(a => <BarRow key={a.asset_id} label={words(a.asset_type)} sub={words(a.valuation_basis)} value={a.value_chf} max={posMax} />)}
              {rec.liabilities.length === 0
                ? <p className="px-2 py-1.5 text-sm text-muted-foreground">No liabilities recorded for {p.display_name}.</p>
                : rec.liabilities.map(l => <BarRow key={l.liability_id} label={words(l.liability_type)} sub="opening principal" value={l.opening_principal_chf} max={posMax} tone="negative" />)}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Opening valuations, not current ones. Cash appears in both the account and asset records and is counted once. Debt is an opening snapshot, not an updated balance.</p>
          </Panel>

          <Panel title="Spending by category" aside={<span className="text-xs text-muted-foreground">{periodLabel(period, false)}</span>}>
            {spend.length === 0 ? <Empty icon={CalendarClock} title="No spending in this period" /> : (
              <div className="-mx-2 flex flex-col">
                <p className="label mb-1 px-2">{chf(expenses)} across {spend.length} categories</p>
                {spend.map(s => (
                  <div key={s.category}>
                    <BarRow label={words(s.category)} value={s.total} max={spendMax} active={category ? category === s.category : undefined}
                      onClick={() => setCategory(category === s.category ? null : s.category)} />
                    {category === s.category && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} transition={{ duration: 0.3, ease }} className="overflow-hidden">
                        <ul className="mx-2 mb-1 mt-0.5 divide-y rounded-lg border bg-background px-3 text-sm">
                          {catTx.slice(0, 5).map(t => (
                            <li key={t[0]} className="flex justify-between gap-3 py-2"><span className="min-w-0 break-words text-muted-foreground">{date(t[1])} · {t[4]}</span><span className="tnum shrink-0 font-medium whitespace-nowrap">{chf(t[3], true)}</span></li>
                          ))}
                        </ul>
                        <button onClick={() => openActivity({ category: s.category, period })} className="mx-2 mb-2 flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                          View all {catTx.length} in Activity<ArrowRight className="size-3" />
                        </button>
                      </motion.div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Goals">
            {goals.length === 0 ? <Empty icon={Target} title="No goals recorded" /> : (
              <ul className="-my-2 divide-y">
                {goals.map(g => (
                  <li key={g.goal_id} className="py-2.5">
                    <Disclosure summary={
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0"><span className="block truncate text-sm font-medium">{g.goal_name}</span><span className="text-xs text-muted-foreground">By {date(g.target_date)}</span></span>
                        <span className="tnum shrink-0 text-sm font-medium"><span className="font-normal text-muted-foreground">Target </span>{chf(g.target_amount_chf)}</span>
                      </span>}>
                      <div className="pt-3 pb-1">
                        <Fields rows={[['Goal ID', g.goal_id], ['Target amount', chf(g.target_amount_chf, true)], ['Target date', date(g.target_date)], ['Priority', <Badge key="p" tone={g.priority === 'high' ? 'brand' : 'neutral'}>{words(g.priority)}</Badge>]]} />
                        <p className="mt-3 text-xs text-muted-foreground">The dataset does not allocate funds to goals, so no progress is shown.</p>
                      </div>
                    </Disclosure>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Proposed life events">
            {rec.events.length === 0 ? <Empty icon={CalendarClock} title="No life events proposed">{p.display_name} has no proposed events in the dataset.</Empty> : (
              <ul className="-my-2 divide-y">
                {rec.events.map(e => {
                  const sc = scenarios.find(s => s.id === e.linked_scenario_id)
                  return (
                    <li key={e.event_id} className="py-2.5">
                      <div className="flex items-baseline justify-between gap-3"><span className="text-sm font-medium">{words(e.event_type)}</span><span className="tnum text-xs text-muted-foreground">{month(e.event_date.slice(0, 7))}</span></div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{e.description}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <Badge>Proposed · not executed</Badge>
                        {sc && <button onClick={() => openScenario(sc.id)} className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">{sc.scenario}<ArrowRight className="size-3" /></button>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </Page>
  )
}
