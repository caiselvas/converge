"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import * as RTooltip from "@radix-ui/react-tooltip";
import { AlertTriangle, BookOpen, CheckCircle2, CircleUserRound, Inbox as InboxIcon, Info, LayoutDashboard, MoreHorizontal, Phone, Receipt, RotateCcw, Target, X } from "lucide-react";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { scopedHref, useStore, type Scope } from "@/lib/store";
import { Avatar, Button, Segmented, clsx } from "./ui";
import { DraftBar } from "./DraftBar";
import { Inbox } from "./Inbox";
import { Sources } from "./Sources";
import { ChecksBadge } from "./ChecksBadge";
import { AssistantButton, AssistantProvider, AssistantSheet, useAssistantStatus } from "./assistant/Assistant";
import { OutcomeStrip } from "./Plan";

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
        <circle cx="10" cy="13" r="7.5" fill="none" stroke="#3d5bd9" strokeWidth="2.2" />
        <circle cx="16" cy="13" r="7.5" fill="none" stroke="#0d9488" strokeWidth="2.2" />
      </svg>
      <span className="text-[16px] font-semibold tracking-tight text-ink">Converge</span>
    </div>
  );
}

/**
 * Who is using the app. This decides who can approve proposals and whose
 * preferences are recorded; it is not the same as whose finances are shown.
 */
function ViewerSwitch({ compact = false }: { compact?: boolean }) {
  const { ws, viewer, setViewer } = useStore();
  if (!ws) return null;
  return (
    <div className="flex items-center gap-2">
      <span className={clsx("text-[12.5px] whitespace-nowrap text-muted", compact ? "sr-only" : "hidden xl:inline")}>Viewing as</span>
      <div role="radiogroup" aria-label="Viewing as" className="inline-flex rounded-full bg-sunken p-1">
        {ws.people.map((p, i) => (
          <button key={p.id} type="button" role="radio" aria-checked={viewer === p.id} aria-label={compact ? `Viewing as ${p.name}` : undefined}
            onClick={() => setViewer(p.id)}
            className={clsx("flex min-h-9 items-center gap-1.5 rounded-full text-[13.5px] font-medium transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45",
              compact ? "px-1" : "py-0.5 pr-3 pl-1",
              viewer === p.id ? "bg-white text-ink shadow-[0_1px_2px_rgb(16_24_40/0.12)] ring-1 ring-line" : "text-muted opacity-70 hover:text-ink hover:opacity-100")}>
            <Avatar name={p.name} index={i} size={compact ? 28 : 24} />
            {!compact && p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Whose finances are shown: one partner, or the couple together. */
function ScopeSwitch() {
  const { ws, scope, setScope } = useStore();
  if (!ws) return null;
  const option = (value: Scope, label: string, index: number) => ({
    value, label: <span className="flex items-center gap-1.5">{index >= 0 && <Avatar name={label} index={index} size={18} />}{label}</span>,
  });
  return (
    <Segmented<Scope> ariaLabel="Show finances for" value={scope} onChange={setScope} size="lg" full
      className="w-full sm:w-auto sm:min-w-[380px]"
      options={[option("nina", ws.people[0].name, 0), option("together", "Together", -1), option("emil", ws.people[1].name, 1)]} />
  );
}

function InboxButton() {
  const { ws, viewer, setInboxOpen } = useStore();
  const waiting = ws?.proposals.filter((p) => p.status === "pending" && p.approvals[viewer] === "pending").length ?? 0;
  return (
    <Button variant="ghost" size="sm" onClick={() => setInboxOpen(true)} aria-label={`Proposals${waiting ? `, ${waiting} awaiting you` : ""}`} className="relative px-2.5 sm:px-3">
      <InboxIcon size={18} />
      <span className="hidden lg:inline">Proposals</span>
      {waiting > 0 && <span className="absolute top-0.5 right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-bad-strong px-1 text-[11px] font-semibold text-white">{waiting}</span>}
    </Button>
  );
}

const menuItem = "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[14px] text-ink hover:bg-page";

function MoreMenu() {
  const { reset, setSourcesOpen, setScope, toast, scope } = useStore();
  const { voice } = useAssistantStatus();
  const router = useRouter();
  const path = usePathname();

  async function loadDemo(prepared: boolean) {
    try {
      await reset(prepared);
      if (path === "/") setScope("together");
      else router.push(scopedHref("/", "together"));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="More"><MoreHorizontal size={18} /></Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} collisionPadding={12} className="z-50 w-72 rounded-2xl border border-line bg-white p-1.5 shadow-raised">
          <Popover.Close asChild>
            <Link href={scopedHref("/profile", scope)} className={menuItem}><CircleUserRound size={16} className="text-muted" /> Your assistant profile</Link>
          </Popover.Close>
          {voice && <Popover.Close asChild>
            <Link href={scopedHref("/call", scope)} className={menuItem}><Phone size={16} className="text-muted" /> Voice call</Link>
          </Popover.Close>}
          <Popover.Close asChild>
            <button onClick={() => setSourcesOpen(true)} className={menuItem}><BookOpen size={16} className="text-muted" /> Assumptions & sources</button>
          </Popover.Close>
          <div className="my-1 border-t border-line" />
          <Popover.Close asChild>
            <button onClick={() => void loadDemo(true)} className={menuItem}><RotateCcw size={16} className="text-muted" /> Load demo state</button>
          </Popover.Close>
          <Popover.Close asChild>
            <button onClick={() => void loadDemo(false)} className={menuItem}><RotateCcw size={16} className="text-muted" /> Reset demo to UBS starting point</button>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Toasts() {
  const { toasts } = useStore();
  return (
    <div aria-live="polite" className="pointer-events-none fixed top-[max(4rem,calc(env(safe-area-inset-top)+3.5rem))] right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="fade-up pointer-events-auto flex items-start gap-2.5 rounded-xl border border-line bg-white px-4 py-3 text-[14px] shadow-raised">
          {t.kind === "success" ? <CheckCircle2 size={17} className="mt-px text-good" /> : t.kind === "error" ? <AlertTriangle size={17} className="mt-px text-bad-strong" /> : <Info size={17} className="mt-px text-brand" />}
          <span className="text-ink">{t.text}</span>
        </div>
      ))}
    </div>
  );
}

export function Drawer({ open, onOpenChange, title, children, width = 520 }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: React.ReactNode; width?: number }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[1px]" />
        <Dialog.Content className="fade-up fixed top-0 right-0 z-50 flex h-full w-full flex-col border-l border-line bg-page shadow-2xl focus:outline-none" style={{ maxWidth: width }}>
          <div className="flex items-center justify-between border-b border-line bg-white px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-5">
            <Dialog.Title className="text-[16px] font-semibold">{title}</Dialog.Title>
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close"><X size={18} /></Button>
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const tabs = [
  { path: "/", label: "Overview", Icon: LayoutDashboard },
  { path: "/goals", label: "Goals", Icon: Target },
  { path: "/expenses", label: "Expenses", Icon: Receipt },
] as const;

function Navigation({ mobile = false }: { mobile?: boolean }) {
  const path = usePathname();
  const { scope } = useStore();
  return (
    <nav aria-label="Main" className={mobile
      ? "fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      : "hidden items-center gap-1 md:flex"}>
      {tabs.map(({ path: href, label, Icon }) => {
        const active = path === href || (href !== "/" && path.startsWith(`${href}/`));
        return (
          <Link key={href} href={scopedHref(href, scope)} aria-current={active ? "page" : undefined}
            className={clsx("flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45",
              mobile ? "h-16 flex-col gap-1 text-[12px]" : "min-h-10 rounded-full px-3.5 text-[14px]",
              active ? (mobile ? "text-ink" : "bg-sunken text-ink") : "text-muted hover:text-ink")}>
            {mobile && <Icon size={21} strokeWidth={active ? 2.25 : 1.75} />}{label}
          </Link>
        );
      })}
    </nav>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { ws, loadError, refresh, inboxOpen, setInboxOpen, sourcesOpen, setSourcesOpen, draft, sim, scope } = useStore();
  const path = usePathname();
  const secondary = ["/agent", "/profile", "/call"].some((p) => path.startsWith(p));
  const planner = path.startsWith("/goals/");
  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur">
        <header className="border-b border-line pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between gap-2 px-4 md:grid md:grid-cols-[1fr_auto_1fr] md:px-5">
            <Link href={scopedHref("/", scope)} aria-label="Converge overview" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"><Logo /></Link>
            <Navigation />
            <div className="flex items-center justify-end gap-0.5 lg:gap-1.5">
              <AssistantButton />
              <InboxButton />
              <MoreMenu />
              <div className="ml-1 md:hidden"><ViewerSwitch compact /></div>
              <div className="ml-1 hidden md:block"><ViewerSwitch /></div>
            </div>
          </div>
        </header>
        {ws && !secondary && (
          <>
            <div className="border-b border-line px-4 py-2.5">
              <div className="mx-auto flex max-w-[1120px] items-center justify-center gap-3">
                <span className="hidden text-[13px] text-muted sm:inline">Showing</span>
                <ScopeSwitch />
              </div>
            </div>
            {path !== "/" && !planner && <OutcomeStrip />}
          </>
        )}
      </div>

      <main className={clsx("mx-auto max-w-[1120px] px-4 sm:px-6", draft.length ? "pb-60 md:pb-36" : "pb-36 md:pb-16")}>
        {loadError ? (
          <div className="mx-auto mt-24 max-w-md text-center">
            <AlertTriangle className="mx-auto mb-3 text-warn" />
            <h1 className="text-[18px] font-semibold">The planning engine is not reachable</h1>
            <p className="mt-2 text-[14px] text-muted">{loadError}</p>
            <Button className="mt-5" onClick={() => refresh()}>Retry</Button>
          </div>
        ) : !ws ? (
          <div className="pulse-soft mt-32 text-center text-[14px] text-muted">Loading your financial twins…</div>
        ) : null}
        <div hidden={!ws || !!loadError}>{children}</div>
        <footer className="mt-16 flex flex-col gap-2 border-t border-line pt-5 text-[12.5px] text-subtle sm:flex-row sm:items-center sm:justify-between">
          <span>Fictional UBS synthetic data · projections depend on assumptions · not financial advice</span>
          <span className="flex items-center gap-4">
            {sim && <ChecksBadge ev={sim.evaluation} />}
            <button onClick={() => setSourcesOpen(true)} className="min-h-10 font-medium text-muted hover:text-ink">Assumptions & sources</button>
          </span>
        </footer>
      </main>

      <Navigation mobile />
      {ws && <div className="pointer-events-none fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-[35] mx-auto flex max-w-[1120px] flex-col px-3 pb-2 sm:px-6 md:bottom-0 md:pb-4">
        {!path.startsWith("/agent") && !path.startsWith("/call") && <AssistantButton mobile />}
        <DraftBar />
      </div>}
      <Toasts />
      <AssistantSheet />
      <Drawer open={inboxOpen} onOpenChange={setInboxOpen} title="Proposals" width={520}>
        <Inbox />
      </Drawer>
      <Drawer open={sourcesOpen} onOpenChange={setSourcesOpen} title="Assumptions & sources" width={600}>
        <Sources />
      </Drawer>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <RTooltip.Provider>
      <AssistantProvider>
        <Shell>{children}</Shell>
      </AssistantProvider>
    </RTooltip.Provider>
  );
}
