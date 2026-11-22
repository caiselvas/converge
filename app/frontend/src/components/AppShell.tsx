"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import * as RTooltip from "@radix-ui/react-tooltip";
import { AlertTriangle, BookOpen, CheckCircle2, Inbox as InboxIcon, Info, MoreHorizontal, RotateCcw, X } from "lucide-react";

import { useStore, type Tab } from "@/lib/store";
import { Avatar, Button, clsx } from "./ui";
import { DraftBar } from "./DraftBar";
import { Inbox } from "./Inbox";
import { Sources } from "./Sources";
import { Overview } from "./views/Overview";
import { Personal } from "./views/Personal";
import { Together } from "./views/Together";
import { Explore } from "./views/Explore";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "personal", label: "Personal" },
  { id: "together", label: "Together" },
  { id: "explore", label: "Scenarios" },
];

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

function ViewerSwitch() {
  const { ws, viewer, setViewer } = useStore();
  if (!ws) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-[12px] text-muted md:inline">Viewing as</span>
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
      <span className="hidden sm:inline">Proposals</span>
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
        <Popover.Content align="end" sideOffset={6} className="z-50 w-64 rounded-xl border border-line bg-white p-1.5 shadow-lg">
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

export function AppShell() {
  const { ws, loadError, tab, setTab, refresh, inboxOpen, setInboxOpen, sourcesOpen, setSourcesOpen, draft } = useStore();

  return (
    <RTooltip.Provider>
      <div className="min-h-screen">
        <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[1240px] items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex items-center gap-6">
              <Logo />
              <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
                {TABS.map((t) => (
                  <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}
                    className={clsx("rounded-lg px-3 py-1.5 text-[13.5px] font-medium transition-colors", tab === t.id ? "bg-page text-ink" : "text-muted hover:text-ink")}>
                    {t.label}
                  </button>
                ))}
              </nav>
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <InboxButton />
              <MoreMenu />
              <ViewerSwitch />
            </div>
          </div>
          <nav aria-label="Main mobile" className="flex gap-1 overflow-x-auto border-t border-line px-3 py-1.5 md:hidden">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}
                className={clsx("shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-medium", tab === t.id ? "bg-page text-ink" : "text-muted")}>
                {t.label}
              </button>
            ))}
          </nav>
        </header>

        <main className={clsx("mx-auto max-w-[1240px] px-4 pt-6 sm:px-6", draft.length ? "pb-40" : "pb-16")}>
          {loadError ? (
            <div className="mx-auto mt-16 max-w-md rounded-2xl border border-line bg-white p-6 text-center">
              <AlertTriangle className="mx-auto mb-3 text-warn" />
              <h1 className="text-[16px] font-semibold">The planning engine is not reachable</h1>
              <p className="mt-2 text-[13px] text-muted">{loadError}</p>
              <p className="mt-2 text-[12.5px] text-muted">Start the backend with <code className="rounded bg-page px-1">make backend</code> (see README), then retry.</p>
              <Button className="mt-4" onClick={() => refresh()}>Retry</Button>
            </div>
          ) : !ws ? (
            <div className="mt-24 text-center text-[13px] text-muted pulse-soft">Loading your financial twins…</div>
          ) : (
            <>
              {tab === "overview" && <Overview />}
              {tab === "personal" && <Personal />}
              {tab === "together" && <Together />}
              {tab === "explore" && <Explore />}
            </>
          )}
          <footer className="mt-14 border-t border-line pt-5 text-[11.5px] leading-5 text-subtle">
            Converge is an educational prototype built on fictional UBS × LauzHack synthetic data. Projections are conditional on the stated
            assumptions — they are not forecasts and not financial advice. Nina and Emil are unrelated synthetic profiles paired for this demonstration.
          </footer>
        </main>
        {ws && <DraftBar />}
        <Toasts />
        <Drawer open={inboxOpen} onOpenChange={setInboxOpen} title="Proposals" width={560}>
          <Inbox />
        </Drawer>
        <Drawer open={sourcesOpen} onOpenChange={setSourcesOpen} title="Assumptions & sources" width={640}>
          <Sources />
        </Drawer>
      </div>
    </RTooltip.Provider>
  );
}
