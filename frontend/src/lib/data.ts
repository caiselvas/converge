export type Profile = {
  profile_id: string; display_name: string; age_at_start: number; city: string; canton: string; country: string
  currency: string; employment_status: string; household_type: string; opening_cash_chf: number
  reference_monthly_net_income_chf: number; reference_monthly_rent_chf: number; as_of_date: string; synthetic: boolean
}
export type IndexEntry = Pick<Profile, 'profile_id' | 'display_name' | 'age_at_start' | 'city' | 'canton' | 'employment_status' | 'household_type'>
export type Account = { account_id: string; account_type: string; currency: string; opening_balance_chf: number; as_of_date: string }
export type Balance = { month: string; account_id: string; opening_cash_chf: number; net_transactions_chf: number; closing_cash_chf: number; status: string }
export type Asset = { asset_id: string; as_of_date: string; asset_type: string; value_chf: number; account_id: string; valuation_basis: string }
export type Liability = { liability_id: string; as_of_date: string; liability_type: string; opening_principal_chf: number; annual_interest_rate: number; monthly_payment_chf: number; notes: string }
export type Goal = { goal_id: string; goal_name: string; target_amount_chf: number; target_date: string; priority: string }
export type LifeEvent = { event_id: string; event_date: string; event_type: string; description: string; status: string; cash_effect_chf: number | null; linked_scenario_id: string | null }
export type Assumption = { assumption_id: string; scenario_id: string; parameter: string; value: string; unit: string; frequency: string; source_type: string; notes: string }
export type Tx = [id: string, date: string, category: string, amount: number, description: string]
export type Scenario = { id: string; category: string; scenario: string; baseline: string; intervention: string; example_metrics: string }
export type Rec = {
  profile: Profile; accounts: Account[]; balances: Balance[]; assets: Asset[]; liabilities: Liability[]
  goals: Goal[]; events: LifeEvent[]; assumptions: Assumption[]; transactions: Tx[]
}
export type Month = { month: string; opening: number; closing: number; net: number; income: number; expenses: number; status: string }

const get = <T,>(path: string): Promise<T> => fetch(`${import.meta.env.BASE_URL}data/${path}`).then(r => r.json())
export const loadIndex = () => get<IndexEntry[]>('index.json')
export const loadScenarios = () => get<Scenario[]>('scenarios.json')
export const loadProfile = (id: string) => get<Rec>(`profiles/${id}.json`)

const chfFull = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const chfWhole = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 })
export const chf = (n: number, cents = false) => `${n < 0 ? '−' : ''}CHF ${(cents ? chfFull : chfWhole).format(Math.abs(n))}`
export const chfSigned = (n: number, cents = true) => (n > 0 ? '+' : '') + chf(n, cents)
const oneDecimal = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })
export const compact = (n: number) => (n < 0 ? '−' : '') + (Math.abs(n) >= 1000 ? `${oneDecimal.format(Math.abs(n) / 1000)}k` : chfWhole.format(Math.abs(n)))
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const monthLong = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
export const date = (d: string) => dateFmt.format(new Date(d))
export const month = (m: string, long = false) => (long ? monthLong : monthFmt).format(new Date(`${m}-01`))
export const monthShort = (m: string) => new Date(`${m}-01`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) + ` ’${m.slice(2, 4)}`
export const words = (s: string) => s.replace(/_/g, ' ').replace(/chf/gi, 'CHF').replace(/^./, c => c.toUpperCase())
export const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
export function niceTicks(min: number, max: number) {
  const raw = (max - min) / 4 || 1
  const p = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw)!
  const ticks: number[] = []
  for (let t = Math.floor(min / step) * step; ; t += step) { ticks.push(Math.round(t * 100) / 100); if (t >= max) break }
  return ticks
}
export const money = (value: string, unit: string) => (unit === 'CHF' && !Number.isNaN(Number(value)) ? chf(Number(value)) : `${Number.isNaN(Number(value)) ? value : Number(value).toLocaleString('de-CH')} ${unit}`)
export const percent = (r: number) => `${(r * 100).toFixed(2)}%`

export function monthsOf(r: Rec): Month[] {
  const flow = new Map<string, [number, number]>()
  for (const [, d, , amount] of r.transactions) {
    const f = flow.get(d.slice(0, 7)) ?? [0, 0]
    f[amount > 0 ? 0 : 1] += Math.abs(amount)
    flow.set(d.slice(0, 7), f)
  }
  return r.balances.map(b => {
    const [income = 0, expenses = 0] = flow.get(b.month) ?? []
    return { month: b.month, opening: b.opening_cash_chf, closing: b.closing_cash_chf, net: b.net_transactions_chf, income, expenses, status: b.status }
  })
}

export const inPeriod = (m: string, period: string) => period === 'all' || m.startsWith(period)

export function openingPosition(r: Rec) {
  const assets = r.assets.reduce((s, a) => s + a.value_chf, 0)
  const debt = r.liabilities.reduce((s, l) => s + l.opening_principal_chf, 0)
  return { assets, debt, net: assets - debt }
}

export function spendingBy(r: Rec, period: string) {
  const totals = new Map<string, number>()
  for (const [, d, category, amount] of r.transactions)
    if (amount < 0 && inPeriod(d.slice(0, 7), period)) totals.set(category, (totals.get(category) ?? 0) - amount)
  return [...totals].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total)
}
