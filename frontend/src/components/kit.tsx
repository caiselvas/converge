import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform, type Variants } from 'motion/react'
import {
  Banknote, Bus, ChevronDown, GraduationCap, Gift, House, Pill, Plane, ShieldPlus, ShoppingBag, ShoppingBasket,
  Smartphone, TriangleAlert, Ticket, UtensilsCrossed, Zap, type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { words } from '@/lib/data'

export const ease = [0.16, 1, 0.3, 1] as const

export const stagger: Variants = { show: { transition: { staggerChildren: 0.05 } } }
export const rise: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease } },
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <motion.div variants={stagger} initial="hidden" animate="show" className={cn('flex flex-col gap-5', className)}>{children}</motion.div>
}

export function Panel({ title, aside, children, className, pad = true, id }: {
  title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; pad?: boolean; id?: string
}) {
  return (
    <motion.section id={id} variants={rise} className={cn('panel min-w-0 scroll-mt-6', className)}>
      {title && (
        <header className="flex items-center justify-between gap-3 px-5 pt-4">
          <h2 className="text-[0.95rem] font-semibold tracking-tight">{title}</h2>
          {aside}
        </header>
      )}
      <div className={cn(pad && 'p-5', title && pad && 'pt-4')}>{children}</div>
    </motion.section>
  )
}

export function PageTitle({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <motion.div variants={rise} className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[1.65rem] leading-tight font-semibold tracking-[-0.025em]">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </motion.div>
  )
}

export function Num({ value, format }: { value: number; format: (n: number) => string }) {
  const reduce = useReducedMotion()
  const mv = useMotionValue(value)
  const text = useTransform(mv, format)
  useEffect(() => {
    const c = animate(mv, value, { duration: reduce ? 0 : 0.7, ease })
    return () => c.stop()
  }, [value, reduce, mv])
  return <motion.span className="tnum">{text}</motion.span>
}

const tones = {
  neutral: 'bg-muted text-ink-2',
  brand: 'bg-brand-soft text-brand',
  negative: 'bg-negative-soft text-negative',
  outline: 'border bg-transparent text-muted-foreground',
}
export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: keyof typeof tones; className?: string }) {
  return <span className={cn('inline-flex h-[22px] items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap', tones[tone], className)}>{children}</span>
}

export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed px-6 py-8 text-center">
      <Icon className="mb-1 size-5 text-muted-foreground" strokeWidth={1.5} />
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="max-w-sm text-sm text-muted-foreground">{children}</p>}
    </div>
  )
}

export function Disclosure({ summary, children, defaultOpen = false }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 rounded-lg text-left">
        <div className="min-w-0 flex-1">{summary}</div>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-300', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease }} className="overflow-hidden">
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function Fields({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="tnum min-w-0 break-words font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

const icons: Record<string, LucideIcon> = {
  groceries: ShoppingBasket, restaurants: UtensilsCrossed, retail: ShoppingBag, leisure: Ticket, pharmacy: Pill,
  housing_rent: House, health_insurance: ShieldPlus, utilities: Zap, transport: Bus, telecom: Smartphone,
  travel: Plane, unexpected_expense: TriangleAlert, education: GraduationCap, salary_or_support: Banknote, annual_bonus: Gift,
}
export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = icons[category] ?? Banknote
  const income = category === 'salary_or_support' || category === 'annual_bonus'
  return (
    <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', income ? 'bg-brand-soft text-brand' : 'bg-muted text-ink-2', className)} title={words(category)}>
      <Icon className="size-4" strokeWidth={1.75} />
    </span>
  )
}
