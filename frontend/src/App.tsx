import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { ChevronsUpDown, LayoutDashboard, ListFilter, FlaskConical, UserRound, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { ease } from '@/components/kit'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { loadIndex, loadProfile, loadScenarios, monthsOf, words, type IndexEntry, type Rec, type Scenario } from '@/lib/data'
import Overview from '@/views/Overview'
import Activity from '@/views/Activity'
import Profile from '@/views/Profile'
import Scenarios from '@/views/Scenarios'

const views = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'activity', label: 'Activity', icon: ListFilter },
  { id: 'profile', label: 'Financial Profile', icon: UserRound },
  { id: 'scenarios', label: 'Scenarios', icon: FlaskConical },
] as const
export type View = (typeof views)[number]['id']
export type Preset = { category?: string; period?: string } | null

const initial = (name: string) => name.slice(0, 1).toUpperCase()

function Avatar({ name, className }: { name: string; className?: string }) {
  return <span className={cn('grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand', className)}>{initial(name)}</span>
}

function Selector({ index, current, onSelect }: { index: IndexEntry[]; current?: IndexEntry; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? index.filter(p => `${p.display_name} ${p.profile_id} ${p.city} ${p.canton}`.toLowerCase().includes(s)) : index
  }, [index, q])
  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setQ('') }}>
      <PopoverTrigger aria-label="Switch profile" className="flex w-full items-center gap-3 rounded-xl border bg-card p-2 pr-3 text-left shadow-panel transition-colors hover:bg-muted/60 data-popup-open:bg-muted/60">
        <Avatar name={current?.display_name ?? '·'} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-tight">{current?.display_name ?? 'Loading…'}</span>
          <span className="block truncate text-xs text-muted-foreground">{current ? `${current.profile_id} · ${current.city}` : ' '}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-[min(22rem,calc(100vw-2rem))] gap-0 p-0 shadow-pop">
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
          <p className="border-t px-2.5 pt-2 pb-1 text-xs text-muted-foreground">
            {matches.length > 50 ? `Showing 50 of ${matches.length} matches` : `${matches.length} of ${index.length} fictional profiles`}
          </p>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function Mark() {
  return (
    <svg viewBox="0 0 20 20" className="size-5 text-brand" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 3.5 10 10l7.5 0M2.5 16.5 10 10" />
    </svg>
  )
}

function Nav({ view, onChange, className, itemClass, id }: { view: View; onChange: (v: View) => void; className?: string; itemClass: string; id: string }) {
  return (
    <nav aria-label="Primary" className={className}>
      {views.map(({ id: v, label, icon: Icon }: { id: View; label: string; icon: LucideIcon }) => (
        <button key={v} onClick={() => onChange(v)} aria-current={view === v ? 'page' : undefined}
          className={cn('relative isolate flex items-center rounded-lg text-sm font-medium transition-colors', itemClass, view === v ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
          {view === v && <motion.span layoutId={id} transition={{ duration: 0.35, ease }} className="absolute inset-0 -z-10 rounded-lg bg-muted" />}
          <Icon className="size-[18px] shrink-0" strokeWidth={view === v ? 2 : 1.75} />
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
  const [view, setView] = useState<View>('overview')
  const [scenarioId, setScenarioId] = useState('S001')
  const [preset, setPreset] = useState<Preset>(null)

  useEffect(() => { loadIndex().then(setIndex); loadScenarios().then(setScenarios) }, [])
  useEffect(() => {
    let live = true
    setLoading(true)
    loadProfile(profileId).then(r => { if (live) { setRec(r); setLoading(false) } })
    return () => { live = false }
  }, [profileId])

  const months = useMemo(() => (rec ? monthsOf(rec) : []), [rec])
  const go = (v: View) => { setPreset(null); setView(v) }
  const openActivity = (p: NonNullable<Preset>) => { setPreset(p); setView('activity') }
  const openScenario = (id: string) => { setScenarioId(id); setView('scenarios') }
  const current = index.find(p => p.profile_id === profileId)
  const selector = <Selector index={index} current={current} onSelect={setProfileId} />

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]">
        <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r bg-card/50 p-4 lg:flex">
          <div className="flex items-center gap-2 px-2 pt-1"><Mark /><span className="text-[1.05rem] font-semibold tracking-tight">Converge</span></div>
          {selector}
          <Nav view={view} onChange={go} id="nav-desktop" className="flex flex-col gap-0.5" itemClass="h-9 gap-3 px-3" />
          <p className="mt-auto px-2 text-xs leading-relaxed text-muted-foreground">
            Fictional profiles from the LauzHack 2026 UBS AI Financial Twin challenge. All data is synthetic.
          </p>
        </aside>

        <div className="sticky top-0 z-20 flex items-center gap-3 border-b bg-background px-4 py-2.5 lg:hidden">
          <Mark /><div className="min-w-0 flex-1">{selector}</div>
        </div>

        <main className="min-w-0 pb-24 lg:pb-12">
          <div className={cn('pointer-events-none fixed inset-x-0 top-0 z-30 h-0.5 transition-opacity', loading && rec ? 'skeleton opacity-100 delay-150' : 'opacity-0')} />
          <div className={cn('mx-auto w-full max-w-[72rem] px-4 pt-6 transition-opacity duration-200 sm:px-8 lg:pt-9', loading && rec && 'opacity-60 delay-150')}>
            {rec ? (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={`${view}-${profileId}`} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                  {view === 'overview' && <Overview rec={rec} months={months} scenarios={scenarios} openActivity={openActivity} setView={go} openScenario={openScenario} />}
                  {view === 'activity' && <Activity rec={rec} preset={preset} />}
                  {view === 'profile' && <Profile rec={rec} months={months} scenarios={scenarios} openScenario={openScenario} />}
                  {view === 'scenarios' && <Scenarios rec={rec} scenarios={scenarios} scenarioId={scenarioId} setScenarioId={setScenarioId} />}
                </motion.div>
              </AnimatePresence>
            ) : (
              <div className="flex flex-col gap-5" aria-busy>
                <div className="skeleton h-12 w-72 rounded-lg" />
                <div className="skeleton h-96 rounded-xl" />
                <div className="grid gap-5 md:grid-cols-2"><div className="skeleton h-64 rounded-xl" /><div className="skeleton h-64 rounded-xl" /></div>
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
