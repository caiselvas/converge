import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, ChevronRight, Search, SearchX, SlidersHorizontal, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Disclosure, Empty, Fields, Page, PageTitle, TxRow, ease } from '@/components/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { chf, chfSigned, date, day, month, words, type Rec, type Tx } from '@/lib/data'
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
  const [f, setF] = useState<F>({ q: '', type: preset?.type ?? 'all', category: preset?.category ?? 'all', from, to, sort: 'newest', page: 0 })
  const [open, setOpen] = useState(Boolean(preset?.category || preset?.period))
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
  const grouped = f.sort === 'newest' || f.sort === 'oldest'
  const groups = useMemo(() => {
    const m = new Map<string, Tx[]>()
    for (const t of visible) { const k = grouped ? t[1].slice(0, 7) : ''; m.set(k, [...(m.get(k) ?? []), t]) }
    return [...m]
  }, [visible, grouped])
  const filters = (f.category !== 'all' ? 1 : 0) + (f.from || f.to ? 1 : 0) + (f.sort !== 'newest' ? 1 : 0)
  const dirty = f.q || f.type !== 'all' || f.category !== 'all' || f.from || f.to
  const reset = () => set({ q: '', type: 'all', category: 'all', from: '', to: '' })
  const account = rec.accounts[0]
  const field = 'h-9 bg-background'

  return (
    <Page className="mx-auto w-full max-w-3xl gap-5">
      <PageTitle title="Activity" sub={`${tx.length.toLocaleString('en-GB')} transactions, ${date(tx[0][1])} – ${date(tx[tx.length - 1][1])}`} />

      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={f.q} onChange={e => set({ q: e.target.value })} placeholder="Search transactions" aria-label="Search transactions" className="h-11 bg-card pl-10 text-base shadow-panel md:text-sm" />
          </div>
          <Button variant="outline" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Filters" className="press relative h-11 gap-2 bg-card px-3.5 shadow-panel">
            <SlidersHorizontal /><span className="hidden sm:inline">Filters</span>
            {filters > 0 && <span className="grid size-5 place-items-center rounded-full bg-brand text-[0.7rem] font-semibold text-brand-foreground">{filters}</span>}
          </Button>
        </div>

        <div role="group" aria-label="Transaction type" className="flex w-fit rounded-lg bg-muted p-0.5">
          {types.map(([v, l]) => (
            <button key={v} onClick={() => set({ type: v })} aria-pressed={f.type === v} className={cn('press relative h-8 rounded-md px-3.5 text-sm font-medium', f.type === v ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {f.type === v && <motion.span layoutId="type-pill" transition={{ duration: 0.25, ease }} className="absolute inset-0 rounded-md bg-card shadow-panel" />}
              <span className="relative">{l}</span>
            </button>
          ))}
        </div>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease }} className="-mx-1 overflow-hidden">
              <div className="grid grid-cols-2 gap-2 p-1">
                <Select value={f.category} onValueChange={v => set({ category: v as string })} items={catItems}>
                  <SelectTrigger aria-label="Category" className={cn(field, "w-full max-sm:col-span-2")}><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(catItems).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={f.sort} onValueChange={v => set({ sort: v as F['sort'] })} items={sorts}>
                  <SelectTrigger aria-label="Sort" className={cn(field, "w-full max-sm:col-span-2")}><SelectValue /></SelectTrigger>
                  <SelectContent align="end">{Object.entries(sorts).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="date" value={f.from} min={tx[0][1]} max={f.to || tx[tx.length - 1][1]} onChange={e => set({ from: e.target.value })} aria-label="From date" className={field} />
                <Input type="date" value={f.to} min={f.from || tx[0][1]} max={tx[tx.length - 1][1]} onChange={e => set({ to: e.target.value })} aria-label="To date" className={field} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {dirty && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="tnum"><b className="font-semibold text-foreground">{rows.length.toLocaleString('en-GB')}</b> found</span>
            <span className="tnum">Income {chf(income)}</span>
            <span className="tnum">Expenses {chf(expenses)}</span>
            <span className={cn('tnum', income - expenses < 0 && 'text-negative')}>Net {chfSigned(income - expenses, false)}</span>
            <button onClick={reset} className="press ml-auto flex items-center gap-1 font-medium text-brand hover:underline"><X className="size-3.5" />Clear</button>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <Empty icon={SearchX} title="No transactions match">Try a wider date range or clear a filter.</Empty>
      ) : (
        <div className="panel px-2 pb-2">
          {groups.map(([k, list]) => (
            <section key={k}>
              {k && <h2 className="label px-2 pt-4 pb-1">{month(k, true)}</h2>}
              <ul className={cn(!k && 'pt-2')}>
                {list.map(t => (
                  <li key={t[0]}>
                    <Disclosure className="px-2" summary={<TxRow t={t} when={grouped ? day(t[1]) : date(t[1])} />}>
                      <div className="mx-2 mt-1 mb-2 rounded-lg bg-muted/60 p-4">
                        <Fields rows={[
                          ['Transaction ID', t[0]], ['Date', t[1]], ['Category', t[2]], ['Amount', `${chf(t[3], true)} (signed ${t[3]})`],
                          ['Account', `${account.account_id} · ${words(account.account_type)}`], ['Currency', rec.profile.currency], ['Synthetic', 'Yes, fictional record'],
                        ]} />
                      </div>
                    </Disclosure>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between gap-3">
          <p className="tnum text-sm text-muted-foreground">{f.page * PAGE + 1}–{Math.min((f.page + 1) * PAGE, rows.length)} of {rows.length.toLocaleString('en-GB')}</p>
          <div className="flex gap-1.5">
            <Button variant="outline" size="icon" aria-label="Previous page" disabled={f.page === 0} onClick={() => setF(s => ({ ...s, page: s.page - 1 }))}><ChevronLeft /></Button>
            <Button variant="outline" size="icon" aria-label="Next page" disabled={f.page >= pages - 1} onClick={() => setF(s => ({ ...s, page: s.page + 1 }))}><ChevronRight /></Button>
          </div>
        </div>
      )}
    </Page>
  )
}
