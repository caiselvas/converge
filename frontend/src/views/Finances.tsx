import { ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge, Disclosure, Fields, Line, Page, PageTitle, Section } from '@/components/kit'
import { chf, date, money, month, openingPosition, percent, words, type Month, type Rec, type Scenario } from '@/lib/data'
import { cn } from '@/lib/utils'

type Col<T> = { head: string; right?: boolean; cell: (row: T) => ReactNode }

function Table<T>({ cols, rows }: { cols: Col<T>[]; rows: T[] }) {
  return (
    <div className="mt-2 mb-1 max-h-96 overflow-auto rounded-lg border">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="text-left">{cols.map(c => <th key={c.head} className={cn('label sticky top-0 border-b bg-card px-3 py-2 font-medium whitespace-nowrap', c.right && 'text-right')}>{c.head}</th>)}</tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => <tr key={i}>{cols.map(c => <td key={c.head} className={cn('tnum px-3 py-2 align-top', c.right && 'text-right')}>{c.cell(r)}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  )
}

const list = 'divide-y border-y'
const row = 'px-1'

export default function Finances({ rec, months, scenarios, openScenario }: { rec: Rec; months: Month[]; scenarios: Scenario[]; openScenario: (id: string) => void }) {
  const { profile: p } = rec
  const pos = openingPosition(rec)
  const last = months[months.length - 1]
  const link = (id: string | null) => id
    ? <button onClick={() => openScenario(id)} className="inline-flex items-center gap-1 text-left font-medium text-brand hover:underline">{scenarios.find(s => s.id === id)?.scenario ?? id}<ArrowRight className="size-3 shrink-0" /></button>
    : <span className="text-muted-foreground">None</span>
  const goals = [...rec.goals].sort((a, b) => a.target_date.localeCompare(b.target_date))

  return (
    <Page className="mx-auto w-full max-w-3xl gap-9">
      <PageTitle title="Finances" sub={`Opening snapshot at ${date(p.as_of_date)}, cash history to ${month(last.month, true)}`} />

      <Section title="Accounts">
        <div className={list}>
          {rec.accounts.map(a => (
            <Disclosure key={a.account_id} className={row} summary={<Line title={`${words(a.account_type)} account`} sub={a.account_id} value={chf(last.closing, true)} valueSub={`Month-end close · ${month(last.month)}`} tone={last.closing < 0 ? 'text-negative' : undefined} />}>
              <div className="mb-3 rounded-lg bg-muted/60 p-4">
                <Fields rows={[['Account ID', a.account_id], ['Type', words(a.account_type)], ['Currency', a.currency], ['Opening balance', `${chf(a.opening_balance_chf, true)} · ${date(a.as_of_date)}`]]} />
              </div>
            </Disclosure>
          ))}
        </div>
      </Section>

      <Section title="Assets and debt" aside={<Badge tone="outline">Opening snapshot · {date(p.as_of_date)}</Badge>}>
        <dl className="mb-1 flex flex-wrap gap-x-9 gap-y-2 pb-3">
          {([['Assets', pos.assets], ['Debt', pos.debt], ['Opening net position', pos.net]] as const).map(([k, v]) => (
            <div key={k}><dt className="label">{k}</dt><dd className="tnum text-lg font-semibold tracking-tight">{chf(v)}</dd></div>
          ))}
        </dl>
        <div className={list}>
          {rec.assets.map(a => (
            <Disclosure key={a.asset_id} className={row} summary={<Line title={words(a.asset_type)} sub={words(a.valuation_basis)} value={chf(a.value_chf)} />}>
              <div className="mb-3 rounded-lg bg-muted/60 p-4">
                <Fields rows={[['Asset ID', a.asset_id], ['Type', words(a.asset_type)], ['Value', chf(a.value_chf, true)], ['Valuation basis', words(a.valuation_basis)], ['Account', a.account_id], ['As of', date(a.as_of_date)]]} />
              </div>
            </Disclosure>
          ))}
          {rec.liabilities.map(l => (
            <Disclosure key={l.liability_id} className={row} summary={<Line title={words(l.liability_type)} sub={`Debt · ${percent(l.annual_interest_rate)} p.a.`} value={`−${chf(l.opening_principal_chf)}`} tone="text-negative" />}>
              <div className="mb-3 rounded-lg bg-muted/60 p-4">
                <Fields rows={[
                  ['Liability ID', l.liability_id], ['Type', words(l.liability_type)], ['Opening principal', chf(l.opening_principal_chf, true)], ['Interest rate', `${percent(l.annual_interest_rate)} p.a.`],
                  ['Recorded monthly payment', chf(l.monthly_payment_chf, true)], ['As of', date(l.as_of_date)], ['Notes', l.notes],
                ]} />
              </div>
            </Disclosure>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {rec.liabilities.length === 0 && 'No debt is recorded. '}Opening valuations, not current ones. Cash is also an account above and is counted once.
        </p>
      </Section>

      <Section title="Financial goals">
        {goals.length === 0 ? <p className="text-sm text-muted-foreground">No goals recorded.</p> : (
          <div className={list}>
            {goals.map(g => (
              <Disclosure key={g.goal_id} className={row} summary={<Line title={g.goal_name} sub={`By ${date(g.target_date)}`} value={chf(g.target_amount_chf)} valueSub="Target" />}>
                <div className="mb-3 rounded-lg bg-muted/60 p-4">
                  <Fields rows={[['Goal ID', g.goal_id], ['Target amount', chf(g.target_amount_chf, true)], ['Target date', date(g.target_date)], ['Priority', words(g.priority)]]} />
                </div>
              </Disclosure>
            ))}
          </div>
        )}
        {goals.length > 0 && <p className="mt-3 text-xs text-muted-foreground">The dataset allocates no funds to goals, so no progress is shown.</p>}
      </Section>

      <Section title="More detail">
        <div className={list}>
          <Disclosure className={row} summary={<Line title="Cash history" sub="Monthly ledger, closing = opening + net transactions" value={`${months.length} months`} />}>
            <Table rows={months} cols={[
              { head: 'Month', cell: m => month(m.month) }, { head: 'Opening cash', right: true, cell: m => chf(m.opening, true) },
              { head: 'Income', right: true, cell: m => chf(m.income, true) }, { head: 'Expenses', right: true, cell: m => chf(-m.expenses, true) },
              { head: 'Net', right: true, cell: m => chf(m.net, true) }, { head: 'Closing cash', right: true, cell: m => <span className={cn('font-medium', m.closing < 0 && 'text-negative')}>{chf(m.closing, true)}</span> },
              { head: 'Status', cell: m => m.status === 'ok' ? <Badge tone="brand">OK</Badge> : <Badge tone="negative">Requires financing</Badge> },
            ]} />
          </Disclosure>
          <Disclosure className={row} summary={<Line title="Proposed life events" sub="Proposed, not executed" value={rec.events.length ? `${rec.events.length}` : 'None'} />}>
            {rec.events.length === 0 ? <p className="pb-3 text-sm text-muted-foreground">No life events are proposed for {p.display_name}.</p> : (
              <Table rows={rec.events} cols={[
                { head: 'Date', cell: e => date(e.event_date) }, { head: 'Event', cell: e => <span className="font-medium">{words(e.event_type)}</span> },
                { head: 'Description', cell: e => <span className="block max-w-64 text-muted-foreground">{e.description}</span> }, { head: 'Status', cell: e => <Badge>{words(e.status)}</Badge> },
                { head: 'Cash effect', right: true, cell: e => e.cash_effect_chf === null ? <span className="text-muted-foreground">Not specified</span> : chf(e.cash_effect_chf, true) },
                { head: 'Linked scenario', cell: e => link(e.linked_scenario_id) }, { head: 'Event ID', cell: e => e.event_id },
              ]} />
            )}
          </Disclosure>
          <Disclosure className={row} summary={<Line title="Scenario assumptions" sub="Illustrative, not verified" value={rec.assumptions.length ? `${rec.assumptions.length}` : 'None'} />}>
            {rec.assumptions.length === 0 ? <p className="pb-3 text-sm text-muted-foreground">No scenario assumptions are recorded for {p.display_name}.</p> : (
              <Table rows={rec.assumptions} cols={[
                { head: 'Scenario', cell: a => link(a.scenario_id) }, { head: 'Parameter', cell: a => words(a.parameter) },
                { head: 'Value', right: true, cell: a => money(a.value, a.unit) }, { head: 'Frequency', cell: a => words(a.frequency) },
                { head: 'Source', cell: a => words(a.source_type) }, { head: 'Notes', cell: a => <span className="block max-w-64 text-muted-foreground">{a.notes}</span> },
              ]} />
            )}
          </Disclosure>
        </div>
      </Section>
    </Page>
  )
}
