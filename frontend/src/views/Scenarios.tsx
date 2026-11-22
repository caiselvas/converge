import { motion } from 'motion/react'
import { CalendarClock, Search, SearchX, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge, Empty, Page, PageTitle, Panel, ease } from '@/components/kit'
import { Input } from '@/components/ui/input'
import { date, money, sentence, words, type Rec, type Scenario } from '@/lib/data'
import { cn } from '@/lib/utils'

type Props = { rec: Rec; scenarios: Scenario[]; scenarioId: string; setScenarioId: (id: string) => void }

export default function Scenarios({ rec, scenarios, scenarioId, setScenarioId }: Props) {
  const { display_name: name } = rec.profile
  const [q, setQ] = useState('')
  const [onlyRecorded, setOnlyRecorded] = useState(false)
  const recorded = useMemo(() => new Set([...rec.assumptions.map(a => a.scenario_id), ...rec.events.map(e => e.linked_scenario_id)]), [rec])
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase()
    const m = new Map<string, Scenario[]>()
    for (const sc of scenarios)
      if ((!onlyRecorded || recorded.has(sc.id)) && (!s || `${sc.scenario} ${sc.category} ${sc.id} ${sc.baseline} ${sc.intervention}`.toLowerCase().includes(s)))
        m.set(sc.category, [...(m.get(sc.category) ?? []), sc])
    return [...m]
  }, [scenarios, q, onlyRecorded, recorded])

  useEffect(() => { document.getElementById(`sc-${scenarioId}`)?.scrollIntoView({ block: 'nearest' }) }, [scenarioId, scenarios.length])

  const sc = scenarios.find(s => s.id === scenarioId)
  const assumptions = rec.assumptions.filter(a => a.scenario_id === scenarioId)
  const events = rec.events.filter(e => e.linked_scenario_id === scenarioId)
  const metrics = sc?.example_metrics.split(', ').map(sentence) ?? []

  return (
    <Page>
      <PageTitle title="Scenarios" sub={`${scenarios.length} financial decisions to explore. ${recorded.size} have recorded assumptions or linked events for ${name}.`} />
      <div className="grid items-start gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <Panel pad={false} className="lg:sticky lg:top-6 lg:flex lg:max-h-[calc(100dvh-3rem)] lg:flex-col">
          <div className="flex flex-col gap-2 border-b p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search scenarios" aria-label="Search scenarios" className="h-9 bg-background pl-8" />
            </div>
            <button onClick={() => setOnlyRecorded(!onlyRecorded)} aria-pressed={onlyRecorded}
              className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium transition-colors', onlyRecorded ? 'bg-brand-soft text-brand' : 'text-muted-foreground hover:bg-muted')}>
              <SlidersHorizontal className="size-3.5" />Only those recorded for {name}
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto p-2 lg:max-h-none">
            {groups.length === 0 && <div className="p-2"><Empty icon={SearchX} title="No scenarios found" /></div>}
            {groups.map(([cat, list]) => (
              <section key={cat} className="mb-2">
                <h3 className="label sticky top-0 z-10 bg-card px-2.5 py-1.5">{cat}</h3>
                {list.map(s => (
                  <button key={s.id} id={`sc-${s.id}`} onClick={() => setScenarioId(s.id)} aria-current={s.id === scenarioId}
                    className={cn('relative flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors', s.id === scenarioId ? 'text-foreground' : 'text-ink-2 hover:bg-muted/70')}>
                    {s.id === scenarioId && <motion.span layoutId="scenario-pill" transition={{ duration: 0.3, ease }} className="absolute inset-0 rounded-lg bg-muted" />}
                    <span className="relative min-w-0 flex-1 truncate">{s.scenario}</span>
                    {recorded.has(s.id) && <i title={`Recorded for ${name}`} className="relative size-1.5 shrink-0 rounded-full bg-brand" />}
                  </button>
                ))}
              </section>
            ))}
          </div>
        </Panel>

        {sc && (
          <motion.div key={`${rec.profile.profile_id}-${sc.id}`} initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.05 } } }} className="flex min-w-0 flex-col gap-5">
            <motion.div variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease } } }}>
              <div className="flex flex-wrap items-center gap-2"><Badge tone="brand">{sc.category}</Badge><span className="tnum text-xs text-muted-foreground">{sc.id}</span></div>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em]">{sc.scenario}</h2>
            </motion.div>

            <Panel pad={false}>
              <div className="grid md:grid-cols-[1fr_auto_1fr]">
                <div className="p-5">
                  <p className="label">Baseline</p>
                  <p className="mt-1.5 text-lg font-semibold tracking-tight">{sc.baseline}</p>
                  <p className="mt-1 text-sm text-muted-foreground">The reference path {name} would otherwise follow.</p>
                </div>
                <div className="relative flex items-center justify-center max-md:border-y md:border-x md:px-3">
                  <span className="grid size-7 place-items-center rounded-full border bg-background text-[0.65rem] font-semibold text-muted-foreground max-md:my-2">vs</span>
                </div>
                <div className="bg-brand-soft/60 p-5 max-md:rounded-b-xl md:rounded-r-xl">
                  <p className="label text-brand">Intervention</p>
                  <p className="mt-1.5 text-lg font-semibold tracking-tight">{sc.intervention}</p>
                  <p className="mt-1 text-sm text-muted-foreground">The alternative decision to compare against the baseline.</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
                <span className="label mr-1">Metrics to compare</span>
                {metrics.map(m => <Badge key={m} tone="outline">{m}</Badge>)}
              </div>
            </Panel>

            <Panel title={`Recorded for ${name}`} aside={<Badge tone="outline">Illustrative · not verified</Badge>}>
              <div className="flex flex-col gap-5">
                <div>
                  <p className="label mb-2">Assumptions</p>
                  {assumptions.length === 0 ? <Empty icon={SlidersHorizontal} title="No assumptions recorded">The dataset holds no assumptions for {name} on this scenario.</Empty> : (
                    <ul className="divide-y rounded-lg border">
                      {assumptions.map(a => (
                        <li key={a.assumption_id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 px-4 py-2.5">
                          <span className="text-sm font-medium">{words(a.parameter)}</span>
                          <span className="tnum text-sm font-semibold">{money(a.value, a.unit)}<span className="font-normal text-muted-foreground"> · {a.frequency}</span></span>
                          <span className="basis-full text-xs text-muted-foreground">{a.notes} · {words(a.source_type)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="label mb-2">Linked life events</p>
                  {events.length === 0 ? <Empty icon={CalendarClock} title="No linked life events">No proposed event for {name} points to this scenario.</Empty> : (
                    <ul className="divide-y rounded-lg border">
                      {events.map(e => (
                        <li key={e.event_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                          <span><span className="text-sm font-medium">{words(e.event_type)}</span><span className="block text-xs text-muted-foreground">{e.description}</span></span>
                          <span className="flex items-center gap-2"><span className="tnum text-xs text-muted-foreground">{date(e.event_date)}</span><Badge>Proposed · not executed</Badge></span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </Panel>

            <Panel title="Simulation results" aside={<Badge tone="negative" className="bg-muted text-ink-2">Not yet available</Badge>} pad={false}>
              <div className="grid gap-px overflow-hidden bg-border md:grid-cols-[1.4fr_1fr]">
                <div className="bg-card p-5">
                  <div className="relative h-44 rounded-lg border border-dashed">
                    <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted-foreground">The baseline and intervention trajectories will be drawn here once a simulation engine is connected.</p>
                  </div>
                  <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 rounded bg-ink-2/50" />Baseline</span>
                    <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 rounded bg-brand/50" />Intervention</span>
                  </div>
                </div>
                <div className="bg-card p-5">
                  <table className="w-full text-sm">
                    <thead><tr className="label text-left"><th className="pb-2 font-medium">Metric</th><th className="pb-2 text-right font-medium">Baseline</th><th className="pb-2 text-right font-medium">Intervention</th></tr></thead>
                    <tbody className="divide-y">{metrics.map(m => <tr key={m}><td className="py-2 pr-2">{m}</td><td className="py-2 text-right text-muted-foreground">—</td><td className="py-2 text-right text-muted-foreground">—</td></tr>)}</tbody>
                  </table>
                </div>
              </div>
              <p className="border-t px-5 py-3 text-xs text-muted-foreground">Nothing on this page is a projection. Results are shown only when they are calculated from {name}’s ledger and the assumptions above.</p>
            </Panel>
          </motion.div>
        )}
      </div>
    </Page>
  )
}
