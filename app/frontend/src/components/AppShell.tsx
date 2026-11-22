"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import * as RTooltip from "@radix-ui/react-tooltip";
import { AlertTriangle, BookOpen, CheckCircle2, Inbox as InboxIcon, Info, LayoutDashboard, MoreHorizontal, Receipt, RotateCcw, Sparkles, Target, X } from "lucide-react";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { scopedHref, useStore, type Scope } from "@/lib/store";
import { Avatar, Button, Segmented, clsx } from "./ui";
import { DraftBar } from "./DraftBar";
import { Inbox } from "./Inbox";
import { Sources } from "./Sources";
import { ChecksBadge } from "./ChecksBadge";
import { AskPanel } from "./AskPanel";
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

function ViewerSwitch({ mobile = false }: { mobile?: boolean }) {
  const { ws, viewer, setViewer } = useStore();
  if (!ws) return null;
  return (
    <div className="flex items-center gap-2">
      <span className={clsx("text-[12px] text-muted", !mobile && "hidden xl:inline")}>Viewing as</span>
      <div role="radiogroup" aria-label="Viewing as" className="inline-flex rounded-full bg-page p-0.5 ring-1 ring-line">
        {ws.people.map((p, i) => (
          <button
            key={p.id}
            role="radio"
            aria-checked={viewer === p.id}
            onClick={() => setViewer(p.id)}
            className={clsx("flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-[13px] font-medium transition-all", viewer === p.id ? "bg-white text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink")}
          >
            <Avatar name={p.name} index={i} size={22} />
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function InboxButton() {
  const { ws, viewer, setInboxOpen } = useStore();
  const waiting = ws?.proposals.filter((p) => p.status === "pending" && p.approvals[viewer] === "pending").length ?? 0;
  return (
    <Button variant="ghost" size="sm" onClick={() => setInboxOpen(true)} aria-label={`Proposals${waiting ? `, ${waiting} awaiting you` : ""}`} className="relative">
      <InboxIcon size={16} />
      <span className="hidden lg:inline">Proposals</span>
      {waiting > 0 && <span className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-bad-strong px-1 text-[10.5px] font-semibold text-white">{waiting}</span>}
    </Button>
  );
}

function MoreMenu() {
  const { reset, setSourcesOpen } = useStore();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="sm" aria-label="More">
          <MoreHorizontal size={16} />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-72 rounded-xl border border-line bg-white p-1.5 shadow-lg">
          <div className="border-b border-line px-2 pb-2 pt-1 md:hidden"><ViewerSwitch mobile /></div>
          <Popover.Close asChild>
            <button onClick={() => setSourcesOpen(true)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-page">
              <BookOpen size={15} /> Assumptions & sources
            </button>
          </Popover.Close>
          <Popover.Close asChild>
            <button onClick={() => reset()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-page">
              <RotateCcw size={15} /> Reset demo to UBS starting point
            </button>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Toasts() {
  const { toasts } = useStore();
  return (
    <div aria-live="polite" className="pointer-events-none fixed top-16 right-4 z-[60] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="fade-up pointer-events-auto flex items-start gap-2.5 rounded-xl border border-line bg-white px-4 py-3 text-[13px] shadow-lg">
          {t.kind === "success" ? <CheckCircle2 size={16} className="mt-px text-good" /> : t.kind === "error" ? <AlertTriangle size={16} className="mt-px text-bad-strong" /> : <Info size={16} className="mt-px text-brand" />}
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
          <div className="flex items-center justify-between border-b border-line bg-white px-5 py-4">
            <Dialog.Title className="text-[16px] font-semibold">{title}</Dialog.Title>
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" aria-label="Close">
                <X size={16} />
              </Button>
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
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
    <nav aria-label="Plan pages" className={mobile
      ? "fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      : "hidden items-center gap-1 md:flex"}>
      {tabs.map(({ path: href, label, Icon }) => (
        <Link key={href} href={scopedHref(href, scope)} aria-current={path === href ? "page" : undefined}
          className={clsx("flex items-center justify-center font-medium hover:text-ink",
            mobile ? "h-[55px] flex-col gap-0.5 text-[11.5px]" : "rounded-full px-3 py-2 text-[13.5px]",
            path === href || (href !== "/" && path.startsWith(`${href}/`)) ? "text-accent md:bg-page" : "text-muted")}>
          {mobile && <Icon size={18} />}{label}
        </Link>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { ws, loadError, refresh, inboxOpen, setInboxOpen, sourcesOpen, setSourcesOpen, draft, preview, sim, scope, setScope } = useStore();
  const path = usePathname();
  const [askOpen, setAskOpen] = useState(false);
  return (
    <RTooltip.Provider>
      <div className="min-h-screen">
        <div className="sticky top-0 z-30 bg-white">
          <header className="border-b border-line">
            <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between gap-2 px-4 md:grid md:grid-cols-[1fr_auto_1fr] md:px-5">
              <Link href={scopedHref("/", scope)} aria-label="Converge overview"><Logo /></Link>
              <Navigation />
              <div className="flex items-center justify-end gap-1 lg:gap-2">
                <Button variant="ghost" size="sm" onClick={() => setAskOpen(!askOpen)} aria-expanded={askOpen} aria-controls={askOpen ? "ask-panel" : undefined} className="hidden md:inline-flex">
                  <Sparkles size={16} /> Ask
                </Button>
                <InboxButton />
                <MoreMenu />
                <div className="hidden md:block"><ViewerSwitch /></div>
              </div>
            </div>
          </header>
          {ws && (
            <>
              <div className="flex justify-center border-b border-line px-4 py-2">
                <Segmented<Scope> ariaLabel="Plan scope" value={scope} onChange={setScope} size="sm" options={[
                  { value: "nina", label: ws.people[0].name },
                  { value: "together", label: "Together" },
                  { value: "emil", label: ws.people[1].name },
                ]} />
              </div>
              {path !== "/" && !path.startsWith("/goals/") && <OutcomeStrip />}
            </>
          )}
        </div>

        <main className={clsx("mx-auto max-w-[1120px] px-4 sm:px-6", draft.length || preview ? "pb-56 md:pb-36" : "pb-32 md:pb-16")}>
          {loadError ? (
            <div className="mx-auto mt-24 max-w-md text-center">
              <AlertTriangle className="mx-auto mb-3 text-warn" />
              <h1 className="text-[17px] font-semibold">The planning engine is not reachable</h1>
              <p className="mt-2 text-[13px] text-muted">{loadError}</p>
              <Button className="mt-5" onClick={() => refresh()}>Retry</Button>
            </div>
          ) : !ws ? (
            <div className="pulse-soft mt-32 text-center text-[13px] text-muted">Loading your financial twins…</div>
          ) : null}
          <div hidden={!ws || !!loadError}>{children}</div>
          <footer className="mt-16 flex flex-col gap-2 border-t border-line pt-5 text-[12px] text-subtle sm:flex-row sm:items-center sm:justify-between">
            <span>Fictional UBS synthetic data · projections depend on assumptions · not financial advice</span>
            <span className="flex items-center gap-4">
              {sim && <ChecksBadge ev={sim.evaluation} />}
              <button onClick={() => setSourcesOpen(true)} className="font-medium text-muted hover:text-ink">Assumptions & sources</button>
            </span>
          </footer>
        </main>

        <Navigation mobile />
        {ws && <div className="pointer-events-none fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-[35] mx-auto flex max-w-[1120px] flex-col px-3 pb-2 sm:px-6 md:bottom-0 md:pb-4">
          <AskPanel open={askOpen} setOpen={setAskOpen} />
          <DraftBar />
        </div>}
        <Toasts />
        <Drawer open={inboxOpen} onOpenChange={setInboxOpen} title="Proposals" width={520}>
          <Inbox />
        </Drawer>
        <Drawer open={sourcesOpen} onOpenChange={setSourcesOpen} title="Assumptions & sources" width={600}>
          <Sources />
        </Drawer>
      </div>
    </RTooltip.Provider>
  );
}
