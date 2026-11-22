import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import {
  Banknote, Bus, ChevronDown, GraduationCap, Gift, House, Pill, Plane, ShieldPlus, ShoppingBag, ShoppingBasket,
  Smartphone, TriangleAlert, Ticket, UtensilsCrossed, Zap, type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { chfSigned, words, type Tx } from '@/lib/data'

export const ease = [0.16, 1, 0.3, 1] as const

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease }} className={cn('flex flex-col gap-8', className)}>
      {children}
    </motion.div>
  )
}

export function PageTitle({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div>
      <h1 className="text-[1.65rem] leading-tight font-semibold tracking-[-0.025em]">{title}</h1>
      {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
    </div>
  )
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('panel min-w-0', className)}>{children}</section>
}

export function Section({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0', className)}>
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[0.95rem] font-semibold tracking-tight">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  )
}

export function Num({ value, format }: { value: number; format: (n: number) => string }) {
  const reduce = useReducedMotion()
  const mv = useMotionValue(value)
  const text = useTransform(mv, format)
  useEffect(() => {
    const c = animate(mv, value, { duration: reduce ? 0 : 0.5, ease })
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
    <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed px-6 py-8 text-center">
      <Icon className="mb-1 size-5 text-muted-foreground" strokeWidth={1.5} />
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="max-w-sm text-sm text-muted-foreground">{children}</p>}
    </div>
  )
}

export function Disclosure({ summary, children, defaultOpen = false, className }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className={cn('press flex w-full items-center gap-3 rounded-lg text-left hover:bg-muted/60', className)}>
        <div className="min-w-0 flex-1">{summary}</div>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease }} className="overflow-hidden">
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

/** A label on the left, a figure on the right; used as the summary of rows. */
export function Line({ title, sub, value, valueSub, tone }: { title: ReactNode; sub?: ReactNode; value?: ReactNode; valueSub?: ReactNode; tone?: string }) {
  return (
    <span className="flex items-center justify-between gap-4 py-2.5 text-left">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{title}</span>
        {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
      </span>
      {value && (
        <span className="shrink-0 text-right">
          <span className={cn('tnum block text-sm font-medium', tone)}>{value}</span>
          {valueSub && <span className="block text-xs text-muted-foreground">{valueSub}</span>}
        </span>
      )}
    </span>
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
    <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', income ? 'bg-brand-soft text-brand' : 'bg-muted text-ink-2', className)} title={words(category)}>
      <Icon className="size-4" strokeWidth={1.75} />
    </span>
  )
}

export function TxRow({ t, when }: { t: Tx; when: string }) {
  const [, , c, a, desc] = t
  return (
    <span className="flex items-center gap-3 py-2 text-left">
      <CategoryIcon category={c} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{desc}</span>
        <span className="block truncate text-xs text-muted-foreground">{when} · {words(c)}</span>
      </span>
      <span className={cn('tnum shrink-0 text-sm font-medium', a > 0 && 'text-brand')}>{chfSigned(a)}</span>
    </span>
  )
}
