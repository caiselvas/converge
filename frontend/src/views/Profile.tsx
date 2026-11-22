import { ArrowRight, Landmark } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge, Disclosure, Empty, Fields, Page, PageTitle, Panel } from '@/components/kit'
import { chf, date, money, month, openingPosition, percent, words, type Month, type Rec, type Scenario } from '@/lib/data'
import { cn } from '@/lib/utils'

type Col<T> = { head: string; right?: boolean; cell: (row: T) => ReactNode }

function Table<T>({ cols, rows, empty }: { cols: Col<T>[]; rows: T[]; empty?: ReactNode }) {
  if (rows.length === 0) return <>{empty}</>
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b text-left">{cols.map(c => <th key={c.head} className={cn('label sticky top-0 bg-card py-2 pr-6 font-medium whitespace-nowrap first:pl-5 last:pr-5', c.right && 'text-right')}>{c.head}</th>)}</tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={i}>{cols.map(c => <td key={c.head} className={cn('tnum py-2.5 pr-6 align-top first:pl-5 last:pr-5', c.right && 'text-right')}>{c.cell(r)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const sections = [
  ['personal', 'Personal information'], ['accounts', 'Accounts'], ['assets', 'Assets'], ['liabilities', 'Liabilities'],
  ['goals', 'Financial goals'], ['cash', 'Cash history'], ['events', 'Life events'], ['assumptions', 'Assumptions'],
] as const

export default function Profile({ rec, months, scenarios, openScenario }: { rec: Rec; months: Month[]; scenarios: Scenario[]; openScenario: (id: string) => void }) {
  const { profile: p } = rec
  const pos = openingPosition(rec)
  const name = (id: string | null) => scenarios.find(s => s.id === id)?.scenario
  const link = (id: string | null) => id ? <button onClick={() => openScenario(id)} className="inline-flex items-center gap-1 text-left font-medium text-brand hover:underline">{id} · {name(id)}<ArrowRight className="size-3 shrink-0" /></button> : <span className="text-muted-foreground">None</span>
  const personal: [string, ReactNode][] = [
    ['Profile ID', p.profile_id], ['Name', p.display_name], ['Age at start', `${p.age_at_start} years`], ['City', p.city], ['Canton', p.canton], ['Country', p.country],
    ['Currency', p.currency], ['Employment', words(p.employment_status)], ['Household', words(p.household_type)], ['Opening cash', chf(p.opening_cash_chf, true)],
    ['Reference monthly net income', chf(p.reference_monthly_net_income_chf, true)], ['Reference monthly rent', chf(p.reference_monthly_rent_chf, true)],
    ['As of', date(p.as_of_date)], ['Synthetic', p.synthetic ? 'Yes, fictional profile' : 'No'],
  ]
  const half = Math.ceil(personal.length / 2)
  const none = (t: string) => <Empty icon={Landmark} title={t} />

  return (
    <Page>
      <PageTitle title="Financial Profile" sub={`${p.display_name}’s complete financial state, exactly as recorded in the dataset`} />
      <div className="grid items-start gap-6 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <nav aria-label="Sections" className="sticky top-8 hidden flex-col gap-0.5 text-sm lg:flex">
          {sections.map(([id, label]) => <a key={id} href={`#${id}`} onClick={e => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} className="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">{label}</a>)}
        </nav>

        <div className="flex min-w-0 flex-col gap-5">
          <Panel id="personal" title="Personal information" aside={<Badge tone="outline">Fictional</Badge>}>
            <div className="grid gap-x-12 gap-y-2 md:grid-cols-2"><Fields rows={personal.slice(0, half)} /><Fields rows={personal.slice(half)} /></div>
          </Panel>

          <Panel id="accounts" title="Accounts" aside={<Badge tone="outline">Opening snapshot</Badge>}>
            <Table rows={rec.accounts} cols={[
              { head: 'Account', cell: a => a.account_id }, { head: 'Type', cell: a => words(a.account_type) }, { head: 'Currency', cell: a => a.currency },
              { head: 'Opening balance', right: true, cell: a => chf(a.opening_balance_chf, true) }, { head: 'As of', cell: a => date(a.as_of_date) },
            ]} />
          </Panel>

          <Panel id="assets" title="Assets" aside={<Badge tone="outline">Opening snapshot</Badge>}>
            <Table rows={rec.assets} cols={[
              { head: 'Asset', cell: a => a.asset_id }, { head: 'Type', cell: a => words(a.asset_type) }, { head: 'Value', right: true, cell: a => chf(a.value_chf, true) },
              { head: 'Valuation basis', cell: a => words(a.valuation_basis) }, { head: 'Account', cell: a => a.account_id }, { head: 'As of', cell: a => date(a.as_of_date) },
            ]} />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Total opening assets {chf(pos.assets, true)}. The cash asset mirrors the cash account above, so it is counted once. Values are opening valuations, not current ones.</p>
          </Panel>

          <Panel id="liabilities" title="Liabilities" aside={<Badge tone="outline">Opening snapshot</Badge>}>
            <Table rows={rec.liabilities} empty={none(`No liabilities recorded for ${p.display_name}`)} cols={[
              { head: 'Liability', cell: l => l.liability_id }, { head: 'Type', cell: l => words(l.liability_type) },
              { head: 'Opening principal', right: true, cell: l => chf(l.opening_principal_chf, true) }, { head: 'Interest rate', right: true, cell: l => `${percent(l.annual_interest_rate)} p.a.` },
              { head: 'Recorded monthly payment', right: true, cell: l => chf(l.monthly_payment_chf, true) }, { head: 'As of', cell: l => date(l.as_of_date) },
              { head: 'Notes', cell: l => <span className="block max-w-52 text-muted-foreground">{l.notes}</span> },
            ]} />
          </Panel>

          <Panel id="goals" title="Financial goals">
            <Table rows={rec.goals} empty={none('No goals recorded')} cols={[
              { head: 'Goal', cell: g => <span className="font-medium">{g.goal_name}</span> }, { head: 'Target amount', right: true, cell: g => chf(g.target_amount_chf, true) },
              { head: 'Target date', cell: g => date(g.target_date) }, { head: 'Priority', cell: g => <Badge tone={g.priority === 'high' ? 'brand' : 'neutral'}>{words(g.priority)}</Badge> }, { head: 'Goal ID', cell: g => g.goal_id },
            ]} />
          </Panel>

          <Panel id="cash" title="Cash history" aside={<Badge tone="outline">Monthly ledger</Badge>}>
            <Disclosure defaultOpen summary={<span className="text-sm text-muted-foreground">24 month-ends from {month(months[0].month)} to {month(months[months.length - 1].month)}. Closing = opening + net transactions.</span>}>
              <div className="max-h-[26rem] overflow-y-auto pt-3">
                <Table rows={months} cols={[
                  { head: 'Month', cell: m => month(m.month) }, { head: 'Opening cash', right: true, cell: m => chf(m.opening, true) },
                  { head: 'Income', right: true, cell: m => chf(m.income, true) }, { head: 'Expenses', right: true, cell: m => chf(-m.expenses, true) },
                  { head: 'Net', right: true, cell: m => chf(m.net, true) }, { head: 'Closing cash', right: true, cell: m => <span className={cn('font-medium', m.closing < 0 && 'text-negative')}>{chf(m.closing, true)}</span> },
                  { head: 'Status', cell: m => m.status === 'ok' ? <Badge tone="brand">OK</Badge> : <Badge tone="negative">Requires financing</Badge> },
                ]} />
              </div>
            </Disclosure>
          </Panel>

          <Panel id="events" title="Life events" aside={<Badge tone="outline">Proposed, not executed</Badge>}>
            <Table rows={rec.events} empty={none(`No life events proposed for ${p.display_name}`)} cols={[
              { head: 'Date', cell: e => date(e.event_date) }, { head: 'Event', cell: e => <span className="font-medium">{words(e.event_type)}</span> },
              { head: 'Description', cell: e => <span className="block max-w-64 text-muted-foreground">{e.description}</span> }, { head: 'Status', cell: e => <Badge>{words(e.status)}</Badge> },
              { head: 'Cash effect', right: true, cell: e => e.cash_effect_chf === null ? <span className="text-muted-foreground">Not specified</span> : chf(e.cash_effect_chf, true) },
              { head: 'Linked scenario', cell: e => link(e.linked_scenario_id) }, { head: 'Event ID', cell: e => e.event_id },
            ]} />
          </Panel>

          <Panel id="assumptions" title="Scenario assumptions" aside={<Badge tone="outline">Illustrative</Badge>}>
            <Table rows={rec.assumptions} empty={none(`No scenario assumptions recorded for ${p.display_name}`)} cols={[
              { head: 'Scenario', cell: a => link(a.scenario_id) }, { head: 'Parameter', cell: a => words(a.parameter) },
              { head: 'Value', right: true, cell: a => money(a.value, a.unit) }, { head: 'Frequency', cell: a => words(a.frequency) },
              { head: 'Source', cell: a => words(a.source_type) }, { head: 'Notes', cell: a => <span className="block max-w-64 text-muted-foreground">{a.notes}</span> },
            ]} />
          </Panel>
        </div>
      </div>
    </Page>
  )
}
