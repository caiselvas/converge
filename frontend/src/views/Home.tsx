import { motion, useReducedMotion } from 'motion/react'
import { ArrowRight, Info, TrendingUp, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Area, AreaChart, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CategoryIcon, Num, Page, Panel, Section, TxRow, ease } from '@/components/kit'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { chf, chfSigned, date, inPeriod, month, monthShort, niceTicks, spendingBy, words, type Month, type Rec } from '@/lib/data'
import type { Preset, View } from '@/App'
import { cn } from '@/lib/utils'

type Props = { rec: Rec; months: Month[]; openActivity: (p: NonNullable<Preset>) => void; setView: (v: View) => void }
type Insight = { icon: LucideIcon; text: string; preset: NonNullable<Preset>; alert?: boolean }

const periodLabel = (p: string) => (p === 'all' ? 'All 24 months' : p.length === 4 ? p : month(p))
const link = 'press flex items-center gap-1 text-sm font-medium text-brand hover:underline'

/** One simple, transparent rule at a time, in order of importance. */
function insightFor(sel: Month[], months: Month[], period: string, spend: { category: string; total: number }[], expenses: number): Insight | null {
  const single = sel.length === 1
  const below = sel.filter(m => m.closing < 0)
  if (below.length)
    return { icon: TriangleAlert, alert: true, preset: { period: below[0].month },
      text: single ? `Cash ended ${month(sel[0].month, true)} below zero.` : `Cash ended ${below.length} of ${sel.length} months below zero.` }
  const over = sel.filter(m => m.net < 0)
  if (over.length * 3 >= sel.length && over.length)
    return { icon: TriangleAlert, preset: { period: single ? sel[0].month : period, type: 'expense' },
      text: single ? `Spending exceeded income by ${chf(-sel[0].net)} in ${month(sel[0].month, true)}.` : `Spending exceeded income in ${over.length} of ${sel.length} months.` }
  if (single) {
    const i = months.indexOf(sel[0])
    const prev = months.slice(Math.max(0, i - 3), i)
    const avg = prev.reduce((s, m) => s + m.expenses, 0) / 3
    if (prev.length === 3 && avg > 0 && sel[0].expenses >= avg * 1.25)
      return { icon: TrendingUp, preset: { period: sel[0].month, type: 'expense' },
        text: `Spending in ${month(sel[0].month, true)} was ${Math.round((sel[0].expenses / avg - 1) * 100)}% above the previous three-month average.` }
  }
  if (spend[0] && spend[0].total >= expenses * 0.4)
    return { icon: Info, preset: { period, category: spend[0].category, type: 'expense' },
      text: `${words(spend[0].category)} made up ${Math.round((spend[0].total / expenses) * 100)}% of spending in ${periodLabel(period)}.` }
  return null
}

function Tip({ title, value, note }: { title: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-pop">
      <p className="text-muted-foreground">{title}</p>
      <p className="tnum mt-0.5 text-sm font-semibold">{value}</p>
      {note && <p className="mt-1 text-negative">{note}</p>}
    </div>
  )
}

export default function Home({ rec, months, openActivity, setView }: Props) {
  const { profile: p } = rec
  const [period, setPeriod] = useState(months[months.length - 1].month)
  const reduce = useReducedMotion()

  const sel = months.filter(m => inPeriod(m.month, period))
  const close = sel[sel.length - 1]
  const income = sel.reduce((s, m) => s + m.income, 0)
  const expenses = sel.reduce((s, m) => s + m.expenses, 0)
  const net = income - expenses
  const single = period.length === 7

  const cash = useMemo(() => [{ label: 'Opening', key: 'open', value: months[0].opening }, ...months.map(m => ({ label: monthShort(m.month), key: m.month, value: m.closing }))], [months])
  const keyOf = new Map(cash.map(c => [c.label, c.key]))
  const values = cash.map(c => c.value)
  const [lo, hi] = [Math.min(...values), Math.max(...values)]
  const zero = lo >= 0 ? 1 : hi <= 0 ? 0 : hi / (hi - lo)
  const ticks = niceTicks(Math.min(lo, 0), Math.max(hi, 0))
  const labels = sel.map(m => monthShort(m.month))

  const spend = useMemo(() => spendingBy(rec, period), [rec, period])
  const insight = insightFor(sel, months, period, spend, expenses)
  const recent = useMemo(() => rec.transactions.filter(t => inPeriod(t[1].slice(0, 7), period)).slice(-5).reverse(), [rec, period])
  const goal = [...rec.goals].sort((a, b) => a.target_date.localeCompare(b.target_date))[0]

  const years = [...new Set(months.map(m => m.month.slice(0, 4)))]
  const items: Record<string, string> = { all: 'All 24 months', ...Object.fromEntries(years.map(y => [y, y])), ...Object.fromEntries(months.map(m => [m.month, month(m.month, true)])) }

  return (
    <Page className="gap-7">
      <h1 className="sr-only">{p.display_name}: home</h1>
      <Panel className="hero p-5 sm:p-7">
        <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="label">Cash balance</p>
            <p className={cn('mt-2 text-[clamp(2.1rem,9vw,3.5rem)] whitespace-nowrap leading-none font-semibold tracking-[-0.045em]', close.closing < 0 && 'text-negative')}>
              <Num value={close.closing} format={n => chf(n, true)} />
            </p>
            <p className="mt-2 text-sm text-muted-foreground">Month-end close · {month(close.month, true)}</p>
          </div>
          <Select value={period} onValueChange={v => setPeriod(v as string)} items={items}>
            <SelectTrigger aria-label="Period" className="min-w-44 self-end bg-background sm:self-auto"><SelectValue /></SelectTrigger>
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

        <div className="mt-5 h-48 sm:h-56 -mx-1" aria-label="Month-end cash balance, January 2025 to December 2026">
          <ResponsiveContainer>
            <AreaChart data={cash} margin={{ top: 8, right: 6, left: 6, bottom: 0 }} style={{ cursor: 'pointer' }}
              onClick={s => { const k = keyOf.get(String(s.activeLabel)); if (k && k !== 'open') setPeriod(k) }}>
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} interval="preserveStartEnd" minTickGap={44} tickMargin={8} />
              <YAxis hide domain={[ticks[0], ticks[ticks.length - 1]]} />
              <defs><linearGradient id="cash-sign" x1="0" y1="0" x2="0" y2="1"><stop offset={zero} stopColor="var(--brand)" /><stop offset={zero} stopColor="var(--negative)" /></linearGradient></defs>
              {lo < 0 && <ReferenceLine y={0} stroke="var(--negative)" strokeOpacity={0.5} strokeDasharray="4 3" />}
              {!single && period !== 'all' && <ReferenceArea x1={labels[0]} x2={labels[labels.length - 1]} fill="var(--brand)" fillOpacity={0.07} />}
              <Tooltip cursor={{ stroke: 'var(--ink-2)', strokeOpacity: 0.2 }} content={({ active, payload }) => {
                const d = active && (payload?.[0]?.payload as (typeof cash)[number] | undefined)
                if (!d) return null
                if (d.key === 'open') return <Tip title={`Opening · ${date(p.as_of_date)}`} value={chf(d.value, true)} />
                return <Tip title={`Month-end close · ${month(d.key)}`} value={chf(d.value, true)} note={d.value < 0 ? 'Requires financing' : undefined} />
              }} />
              <Area dataKey="value" type="monotone" stroke="url(#cash-sign)" strokeWidth={2} fill="url(#cash-sign)" fillOpacity={0.1}
                animationDuration={reduce ? 0 : 500} animationEasing="ease-out"
                dot={({ cx, cy, payload }: { cx?: number; cy?: number; payload?: (typeof cash)[number] }) => payload?.key === 'open'
                  ? <circle key="o" cx={cx} cy={cy} r={4} fill="var(--card)" stroke="var(--brand)" strokeWidth={2} /> : <g key={payload?.key} />}
                activeDot={{ r: 4, fill: 'var(--brand)', stroke: 'var(--card)', strokeWidth: 2 }} />
              {single && <ReferenceLine x={labels[0]} stroke="var(--brand)" strokeDasharray="3 3" />}
              {single && <ReferenceDot x={labels[0]} y={close.closing} r={5} fill="var(--brand)" stroke="var(--card)" strokeWidth={2} ifOverflow="extendDomain" />}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <dl className="mt-4 flex flex-wrap items-end gap-x-9 gap-y-3 border-t pt-4">
          <div><dt className="label">Income</dt><dd className="tnum text-lg font-semibold tracking-tight">{chf(income)}</dd></div>
          <div><dt className="label">Expenses</dt><dd className="tnum text-lg font-semibold tracking-tight">{chf(expenses)}</dd></div>
          <div><dt className="label">Net</dt><dd className={cn('tnum text-lg font-semibold tracking-tight', net < 0 ? 'text-negative' : 'text-brand')}>{chfSigned(net, false)}</dd></div>
          <p className="ml-auto text-xs text-muted-foreground">Totals for {periodLabel(period)}</p>
        </dl>
      </Panel>

      {insight && (
        <motion.div key={insight.text} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease }}
          className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-3', insight.alert ? 'bg-negative-soft' : 'bg-muted/70')}>
          <insight.icon className={cn('size-4 shrink-0', insight.alert ? 'text-negative' : 'text-ink-2')} strokeWidth={1.75} />
          <p className="min-w-0 flex-1 text-sm">{insight.text}</p>
          <button onClick={() => openActivity(insight.preset)} className={link}>See transactions<ArrowRight className="size-3.5" /></button>
        </motion.div>
      )}

      <motion.div key={p.profile_id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}
        className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section title="Recent transactions" aside={<button onClick={() => openActivity({ period })} className={link}>See all<ArrowRight className="size-3.5" /></button>}>
          {recent.length === 0 ? <p className="py-2 text-sm text-muted-foreground">No transactions in {periodLabel(period)}.</p>
            : <ul>{recent.map(t => <li key={t[0]}><TxRow t={t} when={date(t[1])} /></li>)}</ul>}
        </Section>

        <div className="flex min-w-0 flex-col gap-8">
          <Section title="Top spending" aside={<span className="text-xs text-muted-foreground">{periodLabel(period)}</span>}>
            {spend.length === 0 ? <p className="py-2 text-sm text-muted-foreground">No spending in {periodLabel(period)}.</p> : (
              <ul className="-mx-2">
                {spend.slice(0, 3).map(s => (
                  <li key={s.category}>
                    <button onClick={() => openActivity({ category: s.category, period, type: 'expense' })} className="press block w-full rounded-lg px-2 py-2 text-left hover:bg-muted/60">
                      <span className="flex items-center gap-3">
                        <CategoryIcon category={s.category} className="size-8" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{words(s.category)}</span>
                        <span className="tnum text-sm font-medium">{chf(s.total)}</span>
                      </span>
                      <span className="mt-2 ml-11 block h-1 overflow-hidden rounded-full bg-muted">
                        <motion.span className="block h-full origin-left rounded-full bg-brand/70" initial={false} animate={{ scaleX: s.total / expenses }} transition={{ duration: 0.4, ease }} style={{ width: '100%' }} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {spend.length > 3 && <button onClick={() => openActivity({ period, type: 'expense' })} className={cn(link, 'mt-1')}>{spend.length - 3} more in Activity<ArrowRight className="size-3.5" /></button>}
          </Section>

          {goal && (
            <Section title="Next goal" aside={<button onClick={() => setView('finances')} className={link}>All goals<ArrowRight className="size-3.5" /></button>}>
              <div className="flex items-baseline justify-between gap-4">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{goal.goal_name}</p><p className="text-xs text-muted-foreground">Target date {date(goal.target_date)}</p></div>
                <p className="tnum shrink-0 text-sm font-medium">{chf(goal.target_amount_chf)}</p>
              </div>
            </Section>
          )}
        </div>
      </motion.div>
    </Page>
  )
}
