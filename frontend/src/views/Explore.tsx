import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ChevronRight, FlaskConical, Search, SearchX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, Disclosure, Empty, Line, Page, PageTitle, Section } from '@/components/kit'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { date, month, money, words, type Rec, type Scenario } from '@/lib/data'

type Props = { rec: Rec; scenarios: Scenario[]; scenarioId: string | null; setScenarioId: (id: string | null) => void }

const SHOWN = 12

function Row({ s, sub, onClick }: { s: Scenario; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="press flex w-full items-center gap-3 rounded-lg px-1 text-left hover:bg-muted/60">
      <span className="min-w-0 flex-1"><Line title={s.scenario} sub={sub} /></span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

export default function Explore({ rec, scenarios, scenarioId, setScenarioId }: Props) {
  const { display_name: name } = rec.profile
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [more, setMore] = useState(false)

  const recorded = useMemo(() => {
    const m = new Map<string, { events: string[]; assumptions: number }>()
    const at = (id: string) => m.get(id) ?? m.set(id, { events: [], assumptions: 0 }).get(id)!
    for (const e of rec.events) if (e.linked_scenario_id) at(e.linked_scenario_id).events.push(`${words(e.event_type)}, ${month(e.event_date.slice(0, 7))}`)
    for (const a of rec.assumptions) at(a.scenario_id).assumptions++
    return m
  }, [rec])
  const why = (id: string) => {
    const r = recorded.get(id)
    return r ? [...r.events.map(e => `Proposed event: ${e}`), r.assumptions ? `${r.assumptions} recorded assumption${r.assumptions > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') : ''
  }

  const categories = useMemo(() => [...new Set(scenarios.map(s => s.category))], [scenarios])
  const filtering = q.trim() !== '' || cat !== 'all'
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    return scenarios.filter(sc => (cat === 'all' || sc.category === cat) && (!s || `${sc.scenario} ${sc.category} ${sc.baseline} ${sc.intervention}`.toLowerCase().includes(s)))
  }, [scenarios, q, cat])
  const shown = filtering || more ? matches : matches.slice(0, SHOWN)
  const mine = scenarios.filter(s => recorded.has(s.id))

  const sc = scenarios.find(s => s.id === scenarioId)
  const assumptions = rec.assumptions.filter(a => a.scenario_id === scenarioId)
  const events = rec.events.filter(e => e.linked_scenario_id === scenarioId)

  return (
    <AnimatePresence mode="wait" initial={false}>
      {sc ? (
        <motion.div key={sc.id} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
          <Page className="mx-auto w-full max-w-3xl gap-6">
            <div>
              <button onClick={() => setScenarioId(null)} className="press -ml-2 mb-3 flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"><ArrowLeft className="size-4" />Explore</button>
              <Badge tone="brand">{sc.category}</Badge>
              <h1 className="mt-2 text-[1.65rem] leading-tight font-semibold tracking-[-0.025em]">{sc.scenario}</h1>
            </div>

            <div className="grid overflow-hidden rounded-2xl border bg-card shadow-panel md:grid-cols-2">
              <div className="p-5"><p className="label">Baseline</p><p className="mt-1.5 text-lg font-semibold tracking-tight">{sc.baseline}</p></div>
              <div className="bg-brand-soft/60 p-5 max-md:border-t md:border-l"><p className="label text-brand">Alternative</p><p className="mt-1.5 text-lg font-semibold tracking-tight">{sc.intervention}</p></div>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-dashed px-4 py-3">
              <FlaskConical className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              <p className="text-sm font-medium">Simulation results are not yet available</p>
              <p className="basis-full text-xs text-muted-foreground sm:ml-auto sm:basis-auto">Will compare: {sc.example_metrics.toLowerCase()}</p>
            </div>

            {assumptions.length + events.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing is recorded for {name} on this scenario.</p>
            ) : (
              <div className="border-y">
                <Disclosure defaultOpen className="px-1" summary={<Line title={`Recorded for ${name}`} sub="Illustrative assumptions and proposed events, not executed" value={`${assumptions.length + events.length}`} />}>
                  <div className="flex flex-col gap-4 px-1 pt-1 pb-4">
                    {assumptions.length > 0 && (
                      <div>
                        <p className="label mb-1">Assumptions</p>
                        <ul className="divide-y">
                          {assumptions.map(a => (
                            <li key={a.assumption_id} className="flex flex-wrap items-baseline justify-between gap-x-6 py-2">
                              <span className="text-sm font-medium">{words(a.parameter)}</span>
                              <span className="tnum text-sm font-semibold">{money(a.value, a.unit)}<span className="font-normal text-muted-foreground"> · {a.frequency}</span></span>
                              <span className="basis-full text-xs text-muted-foreground">{a.notes} · {words(a.source_type)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {events.length > 0 && (
                      <div>
                        <p className="label mb-1">Proposed life events</p>
                        <ul className="divide-y">
                          {events.map(e => (
                            <li key={e.event_id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                              <span><span className="text-sm font-medium">{words(e.event_type)}</span><span className="block text-xs text-muted-foreground">{e.description}</span></span>
                              <span className="tnum text-xs text-muted-foreground">{date(e.event_date)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </Disclosure>
              </div>
            )}
          </Page>
        </motion.div>
      ) : (
        <motion.div key="list" exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
          <Page className="mx-auto w-full max-w-3xl gap-8">
            <PageTitle title="Explore" sub="What if? Compare a financial decision with the path you are on. Simulations are coming; for now, browse the scenarios." />

            {mine.length > 0 && (
              <Section title={`Recorded for ${name}`}>
                <div className="divide-y border-y">{mine.map(s => <Row key={s.id} s={s} sub={why(s.id)} onClick={() => setScenarioId(s.id)} />)}</div>
              </Section>
            )}

            <Section title="All scenarios" aside={<span className="tnum text-xs text-muted-foreground">{matches.length} of {scenarios.length}</span>}>
              <div className="mb-2 flex flex-wrap gap-2">
                <div className="relative min-w-48 flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search scenarios" aria-label="Search scenarios" className="h-10 bg-card pl-9 shadow-panel" />
                </div>
                <Select value={cat} onValueChange={v => setCat(v as string)} items={{ all: 'All categories', ...Object.fromEntries(categories.map(c => [c, c])) }}>
                  <SelectTrigger aria-label="Category" className="h-10 w-full bg-card shadow-panel sm:w-60"><SelectValue /></SelectTrigger>
                  <SelectContent align="end"><SelectItem value="all">All categories</SelectItem>{categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {matches.length === 0 ? <Empty icon={SearchX} title="No scenarios found" /> : (
                <div className="divide-y border-y">{shown.map(s => <Row key={s.id} s={s} sub={s.category} onClick={() => setScenarioId(s.id)} />)}</div>
              )}
              {!filtering && !more && matches.length > SHOWN && (
                <button onClick={() => setMore(true)} className="press mt-2 rounded-lg px-1 py-1 text-sm font-medium text-brand hover:underline">Show all {matches.length}</button>
              )}
            </Section>
          </Page>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
