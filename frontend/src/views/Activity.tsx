import { motion } from 'motion/react'
import { ChevronLeft, ChevronRight, Search, SearchX, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, CategoryIcon, Disclosure, Empty, Fields, Num, Page, PageTitle, Panel, ease } from '@/components/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { chf, chfSigned, date, words, type Rec } from '@/lib/data'
import type { Preset } from '@/App'
import { cn } from '@/lib/utils'

const PAGE = 40
const sorts = { newest: 'Newest first', oldest: 'Oldest first', largest: 'Largest amount', smallest: 'Smallest amount' }
const types = [['all', 'All'], ['income', 'Income'], ['expense', 'Expenses']] as const

type F = { q: string; type: string; category: string; from: string; to: string; sort: keyof typeof sorts; page: number }

function range(period?: string) {
  if (!period || period === 'all') return ['', '']
  if (period.length === 4) return [`${period}-01-01`, `${period}-12-31`]
  const last = new Date(Date.UTC(+period.slice(0, 4), +period.slice(5), 0)).getUTCDate()
  return [`${period}-01`, `${period}-${last}`]
}

export default function Activity({ rec, preset }: { rec: Rec; preset: Preset }) {
  const [from, to] = range(preset?.period)
  const [f, setF] = useState<F>({ q: '', type: 'all', category: preset?.category ?? 'all', from, to, sort: 'newest', page: 0 })
  const set = (patch: Partial<F>) => setF(s => ({ ...s, page: 0, ...patch }))
  const tx = rec.transactions
  const categories = useMemo(() => [...new Set(tx.map(t => t[2]))].sort((a, b) => words(a).localeCompare(words(b))), [tx])
  const catItems = { all: 'All categories', ...Object.fromEntries(categories.map(c => [c, words(c)])) }

  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    const out = tx.filter(([id, d, c, a, desc]) =>
      (f.type === 'all' || (f.type === 'income') === a > 0) && (f.category === 'all' || c === f.category) &&
      (!f.from || d >= f.from) && (!f.to || d <= f.to) && (!q || desc.toLowerCase().includes(q) || id.toLowerCase().includes(q)))
    if (f.sort === 'newest') out.reverse()
    if (f.sort === 'largest') out.sort((a, b) => Math.abs(b[3]) - Math.abs(a[3]))
    if (f.sort === 'smallest') out.sort((a, b) => Math.abs(a[3]) - Math.abs(b[3]))
    return out
  }, [tx, f.q, f.type, f.category, f.from, f.to, f.sort])

  const income = rows.reduce((s, t) => s + Math.max(t[3], 0), 0)
  const expenses = rows.reduce((s, t) => s - Math.min(t[3], 0), 0)
  const pages = Math.ceil(rows.length / PAGE)
  const visible = rows.slice(f.page * PAGE, (f.page + 1) * PAGE)
  const dirty = f.q || f.type !== 'all' || f.category !== 'all' || f.from || f.to
  const reset = () => set({ q: '', type: 'all', category: 'all', from: '', to: '' })
  const account = rec.accounts[0]

  return (
    <Page>
      <PageTitle title="Activity" sub={`${tx.length} ledger transactions for ${rec.profile.display_name}, ${date(tx[0][1])} – ${date(tx[tx.length - 1][1])}`} />

      <Panel pad={false}>
        <div className="flex flex-wrap items-center gap-2 p-4">
          <div className="relative basis-full">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={f.q} onChange={e => set({ q: e.target.value })} placeholder="Search description" aria-label="Search transactions" className="h-9 bg-background pl-8" />
          </div>
          <div role="group" aria-label="Transaction type" className="flex rounded-lg bg-muted p-0.5">
            {types.map(([v, l]) => (
              <button key={v} onClick={() => set({ type: v })} aria-pressed={f.type === v} className={cn('relative h-8 rounded-md px-3 text-sm font-medium transition-colors', f.type === v ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {f.type === v && <motion.span layoutId="type-pill" transition={{ duration: 0.3, ease }} className="absolute inset-0 rounded-md bg-card shadow-panel" />}
                <span className="relative">{l}</span>
              </button>
            ))}
          </div>
          <Select value={f.category} onValueChange={v => set({ category: v as string })} items={catItems}>
            <SelectTrigger aria-label="Category" className="h-9 w-44 bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(catItems).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="date" value={f.from} min={tx[0][1]} max={f.to || tx[tx.length - 1][1]} onChange={e => set({ from: e.target.value })} aria-label="From date" className="h-9 w-36 bg-background" />
          <span className="text-muted-foreground">–</span>
          <Input type="date" value={f.to} min={f.from || tx[0][1]} max={tx[tx.length - 1][1]} onChange={e => set({ to: e.target.value })} aria-label="To date" className="h-9 w-36 bg-background" />
          <Select value={f.sort} onValueChange={v => set({ sort: v as F['sort'] })} items={sorts}>
            <SelectTrigger aria-label="Sort" className="h-9 w-44 bg-background"><SelectValue /></SelectTrigger>
            <SelectContent align="end">{Object.entries(sorts).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
          </Select>
          {dirty && <Button variant="ghost" size="lg" onClick={reset}><X />Clear</Button>}
        </div>

        <dl className="grid grid-cols-2 divide-x border-y sm:grid-cols-4">
          {([['Transactions', <Num key="n" value={rows.length} format={n => Math.round(n).toLocaleString('en-GB')} />, ''], ['Income', chf(income, true), ''], ['Expenses', chf(expenses, true), ''], ['Net', chfSigned(income - expenses), income - expenses < 0 ? 'text-negative' : 'text-brand']] as const).map(([k, v, c], i) => (
            <div key={k} className={cn('px-5 py-3', i > 1 && 'max-sm:border-t')}>
              <dt className="label">{k}</dt><dd className={cn('tnum text-base font-semibold tracking-tight', c)}>{v}</dd>
            </div>
          ))}
        </dl>

        {rows.length === 0 ? (
          <div className="p-6"><Empty icon={SearchX} title="No transactions match these filters">Try a wider date range or clear a filter.</Empty></div>
        ) : (
          <ul className="divide-y px-3">
            {visible.map(([id, d, c, a, desc]) => (
              <li key={id} className="px-2 py-2">
                <Disclosure summary={
                  <span className="flex items-center gap-3 py-0.5">
                    <CategoryIcon category={c} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{desc}</span><span className="text-xs text-muted-foreground">{words(c)}<span className="sm:hidden"> · {date(d)}</span></span></span>
                    <span className="tnum hidden w-28 text-right text-sm text-muted-foreground sm:block">{date(d)}</span>
                    <span className={cn('tnum w-28 text-right text-sm font-medium', a > 0 && 'text-brand')}>{chfSigned(a)}</span>
                  </span>}>
                  <div className="mx-1 mt-2 mb-1 rounded-lg bg-muted/60 p-4">
                    <Fields rows={[
                      ['Transaction ID', id], ['Date', `${date(d)} (${d})`], ['Type', <Badge key="t" tone={a > 0 ? 'brand' : 'neutral'}>{a > 0 ? 'Income' : 'Expense'}</Badge>],
                      ['Category', c], ['Amount', `${chf(a, true)} (signed ${a})`], ['Account', `${account.account_id} · ${words(account.account_type)}`], ['Currency', rec.profile.currency],
                      ['Description', desc], ['Synthetic', 'Yes, fictional record'],
                    ]} />
                  </div>
                </Disclosure>
              </li>
            ))}
          </ul>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
            <p className="tnum text-sm text-muted-foreground">{f.page * PAGE + 1}–{Math.min((f.page + 1) * PAGE, rows.length)} of {rows.length}</p>
            <div className="flex gap-1.5">
              <Button variant="outline" size="icon" aria-label="Previous page" disabled={f.page === 0} onClick={() => setF(s => ({ ...s, page: s.page - 1 }))}><ChevronLeft /></Button>
              <Button variant="outline" size="icon" aria-label="Next page" disabled={f.page >= pages - 1} onClick={() => setF(s => ({ ...s, page: s.page + 1 }))}><ChevronRight /></Button>
            </div>
          </div>
        )}
      </Panel>
    </Page>
  )
}
