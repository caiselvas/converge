import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { ArrowLeftRight, ChevronsUpDown, Compass, House, Info, Moon, Sun, Wallet, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { Fields, ease } from '@/components/kit'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { chf, date, loadIndex, loadProfile, loadScenarios, monthsOf, words, type IndexEntry, type Profile, type Rec, type Scenario } from '@/lib/data'
import Home from '@/views/Home'
import Activity from '@/views/Activity'
import Finances from '@/views/Finances'
import Explore from '@/views/Explore'

const views = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'activity', label: 'Activity', icon: ArrowLeftRight },
  { id: 'finances', label: 'Finances', icon: Wallet },
  { id: 'explore', label: 'Explore', icon: Compass },
] as const
export type View = (typeof views)[number]['id']
export type Preset = { category?: string; period?: string; type?: 'income' | 'expense' } | null

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toggle = () => {
    const root = document.documentElement
    root.classList.add('theme-switch')
    const next = !root.classList.contains('dark')
    root.classList.toggle('dark', next)
    setDark(next)
    try { localStorage.setItem('theme', next ? 'dark' : 'light') } catch { /* preference simply isn't remembered */ }
    window.setTimeout(() => root.classList.remove('theme-switch'), 260)
  }
  return [dark, toggle] as const
}

function ThemeToggle({ dark, toggle, className }: { dark: boolean; toggle: () => void; className?: string }) {
  return (
    <button onClick={toggle} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title={dark ? 'Light theme' : 'Dark theme'}
      className={cn('press relative grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground', className)}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={dark ? 'moon' : 'sun'} initial={{ opacity: 0, rotate: -60, scale: 0.6 }} animate={{ opacity: 1, rotate: 0, scale: 1 }} exit={{ opacity: 0, rotate: 60, scale: 0.6 }} transition={{ duration: 0.16, ease }} className="grid">
          {dark ? <Moon className="size-[18px]" strokeWidth={1.75} /> : <Sun className="size-[18px]" strokeWidth={1.75} />}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}

const initial = (name: string) => name.slice(0, 1).toUpperCase()

function Avatar({ name, className }: { name: string; className?: string }) {
  return <span className={cn('grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand', className)}>{initial(name)}</span>
}

const details = (p: Profile): [string, string][] => [
  ['Profile ID', p.profile_id], ['Name', p.display_name], ['Age at start', `${p.age_at_start} years`], ['City', p.city], ['Canton', p.canton], ['Country', p.country],
  ['Currency', p.currency], ['Employment', words(p.employment_status)], ['Household', words(p.household_type)], ['Opening cash', chf(p.opening_cash_chf, true)],
  ['Reference monthly net income', chf(p.reference_monthly_net_income_chf, true)], ['Reference monthly rent', chf(p.reference_monthly_rent_chf, true)],
  ['As of', date(p.as_of_date)], ['Synthetic', p.synthetic ? 'Yes, fictional profile' : 'No'],
]

function Selector({ index, current, profile, onSelect }: { index: IndexEntry[]; current?: IndexEntry; profile?: Profile; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState(false)
  const [q, setQ] = useState('')
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? index.filter(p => `${p.display_name} ${p.profile_id} ${p.city} ${p.canton}`.toLowerCase().includes(s)) : index
  }, [index, q])
  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) { setQ(''); setInfo(false) } }}>
      <PopoverTrigger aria-label="Switch profile" className="flex w-full items-center gap-3 rounded-xl border bg-card p-2 pr-3 text-left shadow-panel transition-[background-color,transform] hover:bg-muted/60 active:scale-[0.99] data-popup-open:bg-muted/60">
        <Avatar name={current?.display_name ?? '·'} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-tight">{current?.display_name ?? 'Loading…'}</span>
          <span className="block truncate text-xs text-muted-foreground">{current ? `${current.profile_id} · ${current.city}` : ' '}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-[min(22rem,calc(100vw-2rem))] gap-0 p-0 shadow-pop">
        {info && profile ? (
          <div className="max-h-[min(34rem,calc(100dvh-7rem))] overflow-y-auto p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Profile details</p>
              <button onClick={() => setInfo(false)} className="press text-xs font-medium text-brand hover:underline">Back to search</button>
            </div>
            <Fields rows={details(profile)} />
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Synthetic data from the LauzHack 2026 UBS challenge. Balances are month-end ledger closes, Jan 2025 – Dec 2026, not live. Assets and debt are snapshots at {date(profile.as_of_date)}.
            </p>
          </div>
        ) : (
        <Command shouldFilter={false} className="p-1.5">
          <CommandInput value={q} onValueChange={setQ} placeholder="Search name, ID or city" />
          <CommandList className="mt-1 max-h-80">
            <CommandEmpty>No profile matches “{q}”.</CommandEmpty>
            {matches.slice(0, 50).map(p => (
              <CommandItem key={p.profile_id} value={p.profile_id} onSelect={() => { onSelect(p.profile_id); setOpen(false); setQ('') }} className="gap-3 py-2">
                <Avatar name={p.display_name} className="size-8 text-xs" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.display_name}<span className="font-normal text-muted-foreground"> · {p.age_at_start}</span></span>
                  <span className="block truncate text-xs text-muted-foreground">{p.city} · {words(p.employment_status)}</span>
                </span>
                <span className="tnum text-xs text-muted-foreground">{p.profile_id}</span>
              </CommandItem>
            ))}
          </CommandList>
          <div className="flex items-center justify-between gap-3 border-t px-2.5 pt-2 pb-1 text-xs text-muted-foreground">
            <span>{matches.length > 50 ? `Showing 50 of ${matches.length} matches` : `${matches.length} of ${index.length} fictional profiles`}</span>
            {profile && <button onClick={() => setInfo(true)} className="press flex items-center gap-1 font-medium text-brand hover:underline"><Info className="size-3.5" />Profile details</button>}
          </div>
        </Command>
        )}
      </PopoverContent>
    </Popover>
  )
}

function Mark() {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand text-brand-foreground shadow-panel" aria-hidden>
      <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 3.5 10 10l7.5 0M2.5 16.5 10 10" />
      </svg>
    </span>
  )
}

function Nav({ view, onChange, className, itemClass, id }: { view: View; onChange: (v: View) => void; className?: string; itemClass: string; id: string }) {
  return (
    <nav aria-label="Primary" className={className}>
      {views.map(({ id: v, label, icon: Icon }: { id: View; label: string; icon: LucideIcon }) => (
        <button key={v} onClick={() => onChange(v)} aria-current={view === v ? 'page' : undefined}
          className={cn('relative isolate flex items-center rounded-lg text-sm font-medium transition-colors', itemClass, view === v ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
          {view === v && <motion.span layoutId={id} transition={{ duration: 0.35, ease }} className="absolute inset-0 -z-10 rounded-lg bg-muted" />}
          <Icon className={cn('size-[18px] shrink-0 transition-colors', view === v && 'text-brand')} strokeWidth={view === v ? 2 : 1.75} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}

export default function App() {
  const [index, setIndex] = useState<IndexEntry[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [profileId, setProfileId] = useState('P00001')
  const [rec, setRec] = useState<Rec | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('home')
  const [scenarioId, setScenarioId] = useState<string | null>(null)
  const [preset, setPreset] = useState<Preset>(null)
  const [dark, toggleTheme] = useTheme()

  useEffect(() => { loadIndex().then(setIndex); loadScenarios().then(setScenarios) }, [])
  useEffect(() => {
    let live = true
    setLoading(true)
    loadProfile(profileId).then(r => { if (live) { setRec(r); setLoading(false) } })
    return () => { live = false }
  }, [profileId])

  const months = useMemo(() => (rec ? monthsOf(rec) : []), [rec])
  const go = (v: View) => { setPreset(null); if (v === 'explore') setScenarioId(null); setView(v) }
  const openActivity = (p: NonNullable<Preset>) => { setPreset(p); setView('activity') }
  const openScenario = (id: string) => { setScenarioId(id); setView('explore') }
  const current = index.find(p => p.profile_id === profileId)
  const selector = <Selector index={index} current={current} profile={rec?.profile} onSelect={setProfileId} />

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]">
        <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r bg-card/50 p-4 lg:flex">
          <div className="flex items-center gap-2 px-2 pt-1"><Mark /><span className="text-[1.05rem] font-semibold tracking-tight">Converge</span></div>
          {selector}
          <Nav view={view} onChange={go} id="nav-desktop" className="flex flex-col gap-0.5" itemClass="h-9 gap-3 px-3" />
          <div className="mt-auto flex items-end gap-2 px-2">
            <p className="flex-1 text-xs leading-relaxed text-muted-foreground">Synthetic data from the LauzHack 2026 UBS AI Financial Twin challenge.</p>
            <ThemeToggle dark={dark} toggle={toggleTheme} className="-mr-2" />
          </div>
        </aside>

        <div className="sticky top-0 z-20 flex items-center gap-3 border-b bg-background px-4 py-2.5 lg:hidden">
          <Mark /><div className="min-w-0 flex-1">{selector}</div><ThemeToggle dark={dark} toggle={toggleTheme} />
        </div>

        <main className="min-w-0 pb-24 lg:pb-12">
          <div className={cn('pointer-events-none fixed inset-x-0 top-0 z-30 h-0.5 transition-opacity', loading && rec ? 'skeleton opacity-100 delay-150' : 'opacity-0')} />
          <div className={cn('mx-auto w-full max-w-[72rem] px-4 pt-6 transition-opacity duration-200 sm:px-8 lg:pt-9', loading && rec && 'opacity-60 delay-150')}>
            {rec ? (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={view} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                  {view === 'home' && <Home rec={rec} months={months} openActivity={openActivity} setView={go} />}
                  {view === 'activity' && <Activity key={profileId} rec={rec} preset={preset} />}
                  {view === 'finances' && <Finances key={profileId} rec={rec} months={months} scenarios={scenarios} openScenario={openScenario} />}
                  {view === 'explore' && <Explore key={profileId} rec={rec} scenarios={scenarios} scenarioId={scenarioId} setScenarioId={setScenarioId} />}
                </motion.div>
              </AnimatePresence>
            ) : (
              <div className="flex flex-col gap-5" aria-busy>
                <div className="skeleton h-96 rounded-2xl" />
                <div className="skeleton h-40 rounded-2xl" />
              </div>
            )}
          </div>
        </main>

        <Nav view={view} onChange={go} id="nav-mobile" itemClass="flex-1 flex-col gap-1 py-2 text-[0.72rem]"
          className="fixed inset-x-0 bottom-0 z-20 flex border-t bg-background px-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] lg:hidden" />
      </div>
    </MotionConfig>
  )
}
