"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { api, ApiError } from "./api";
import { applyChanges, mergeChanges, upsert } from "./plan";
import type { Change, Plan, Proposal, RecResponse, SimResponse, Workspace } from "./types";

export type Sheet = { kind: "person"; id: string } | { kind: "shared" } | null;

interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}

export interface Preview {
  label: string;
  changes: Change[]; // applied on top of the draft
  sim: SimResponse | null;
}

interface Ctx {
  ws: Workspace | null;
  loadError: string | null;
  viewer: string;
  setViewer: (id: string) => void;
  sheet: Sheet;
  openSheet: (s: Sheet) => void;
  /** The agreed plan (both partners). */
  plan: Plan | null;
  /** Agreed plan with the viewer's draft changes applied locally (instant). */
  draftPlan: Plan | null;
  draft: Change[];
  setChange: (path: string, value: unknown) => void;
  addChanges: (changes: Change[]) => void;
  removeChange: (path: string) => void;
  discardDraft: () => void;
  sim: SimResponse | null;
  simLoading: boolean;
  simError: string | null;
  preview: Preview | null;
  startPreview: (label: string, changes: Change[]) => void;
  stopPreview: () => void;
  recs: RecResponse | null;
  recsLoading: boolean;
  refreshRecs: () => void;
  dismissed: string[];
  dismissRec: (id: string) => void;
  propose: (title: string, kind?: string) => Promise<Proposal | null>;
  decide: (id: string, approve: boolean) => Promise<void>;
  restore: (vid: number) => Promise<void>;
  reset: () => Promise<void>;
  refresh: () => Promise<void>;
  toasts: Toast[];
  toast: (text: string, kind?: Toast["kind"]) => void;
  inboxOpen: boolean;
  setInboxOpen: (o: boolean) => void;
  sourcesOpen: boolean;
  setSourcesOpen: (o: boolean) => void;
  name: (id: string | null | undefined) => string;
  idx: (id: string | null | undefined) => number;
}

const C = createContext<Ctx | null>(null);

function readLS<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewer, setViewerState] = useState<string>("");
  const [sheet, openSheet] = useState<Sheet>(null);
  const [drafts, setDrafts] = useState<Record<string, Change[]>>({});
  const [sim, setSim] = useState<SimResponse | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const toastId = useRef(0);

  const toast = useCallback((text: string, kind: Toast["kind"] = "success") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const w = await api.workspace();
      setWs(w);
      setLoadError(null);
      setViewerState((v) => (v && w.people.some((p) => p.id === v) ? v : w.people[0].id));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Initial load + restore local UI state (after the first await, so no synchronous setState in the effect).
  const hydrated = useRef(false);
  useEffect(() => {
    (async () => {
      await refresh();
      if (hydrated.current) return;
      hydrated.current = true;
      setDrafts(readLS("converge.drafts", {}));
      const v = readLS<string>("converge.viewer", "");
      if (v) setViewerState(v);
    })();
  }, [refresh]);

  useEffect(() => {
    if (hydrated.current) writeLS("converge.drafts", drafts);
  }, [drafts]);

  const setViewer = useCallback((id: string) => {
    setViewerState(id);
    writeLS("converge.viewer", id);
    setPreview(null);
    setDismissed([]);
  }, []);


  const plan = ws?.plan ?? null;
  const draft = useMemo(() => (viewer ? drafts[viewer] ?? [] : []), [drafts, viewer]);
  const draftPlan = useMemo(() => (plan ? applyChanges(plan, draft) : null), [plan, draft]);

  const updateDraft = useCallback(
    (fn: (d: Change[]) => Change[]) => {
      setDrafts((all) => ({ ...all, [viewer]: fn(all[viewer] ?? []) }));
      setPreview(null);
    },
    [viewer],
  );

  const setChange = useCallback(
    (path: string, value: unknown) => {
      if (!plan) return;
      updateDraft((d) => upsert(d, plan, path, value));
    },
    [plan, updateDraft],
  );
  const addChanges = useCallback(
    (changes: Change[]) => {
      if (!plan) return;
      updateDraft((d) => mergeChanges(d, changes, plan));
    },
    [plan, updateDraft],
  );
  const removeChange = useCallback((path: string) => updateDraft((d) => d.filter((c) => c.path !== path)), [updateDraft]);
  const discardDraft = useCallback(() => updateDraft(() => []), [updateDraft]);

  // Live simulation of the draft (debounced, abortable). Loading state is derived from request keys.
  const draftKey = JSON.stringify(draft);
  const planKey = ws ? `${ws.versions.length}` : "";
  const simKey = `${planKey}|${draftKey}`;
  const [simFor, setSimFor] = useState("");
  const [simErrFor, setSimErrFor] = useState("");
  useEffect(() => {
    if (!ws) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await api.simulate(JSON.parse(draftKey), ctrl.signal);
        setSim(r);
        setSimError(null);
        setSimFor(simKey);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setSimError(e instanceof ApiError ? e.message : String(e));
        setSimErrFor(simKey);
      }
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [draftKey, simKey, ws]);
  const simLoading = !!ws && simFor !== simKey && simErrFor !== simKey;

  // Recommendations for the current draft whenever it has issues.
  const [recsState, setRecsState] = useState<{ key: string; data: RecResponse | null }>({ key: "", data: null });
  const [recsNonce, setRecsNonce] = useState(0);
  const refreshRecs = useCallback(() => setRecsNonce((n) => n + 1), []);
  const simFresh = !!sim && simFor === simKey;
  const needsRecs = simFresh && sim!.evaluation.status !== "on_track";
  const recsKey = `${simKey}|${recsNonce}`;
  useEffect(() => {
    if (!needsRecs) return;
    const ctrl = new AbortController();
    api
      .recommendations(JSON.parse(draftKey), ctrl.signal)
      .then((r) => setRecsState({ key: recsKey, data: r }))
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setRecsState({ key: recsKey, data: null });
      });
    return () => ctrl.abort();
  }, [needsRecs, recsKey, draftKey]);
  const recs: RecResponse | null = !simFresh
    ? recsState.data
    : !needsRecs
      ? { status: "on_track", evaluated: 0, recommendations: [], message: null }
      : recsState.key === recsKey ? recsState.data : null;
  const recsLoading = needsRecs && recsState.key !== recsKey;

  const startPreview = useCallback(
    (label: string, changes: Change[]) => {
      const all = plan ? mergeChanges(draft, changes, plan) : changes;
      setPreview({ label, changes, sim: null });
      api.simulate(all).then((s) => setPreview((p) => (p && p.label === label ? { ...p, sim: s } : p)));
    },
    [draft, plan],
  );
  const stopPreview = useCallback(() => setPreview(null), []);
  const dismissRec = useCallback((id: string) => setDismissed((d) => [...d, id]), []);

  const name = useCallback((id: string | null | undefined) => ws?.people.find((p) => p.id === id)?.name ?? "Both", [ws]);
  const idx = useCallback((id: string | null | undefined) => ws?.people.findIndex((p) => p.id === id) ?? -1, [ws]);

  const propose = useCallback(
    async (title: string, kind = "manual") => {
      if (!draft.length) return null;
      try {
        const p = await api.propose(viewer, title, draft, kind);
        updateDraft(() => []);
        await refresh();
        if (p.status === "applied") toast("Applied to your plan");
        else {
          const others = Object.entries(p.approvals).filter(([, v]) => v === "pending").map(([k]) => name(k));
          toast(`Sent to ${others.join(" & ")} for approval`, "info");
        }
        return p;
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), "error");
        return null;
      }
    },
    [draft, viewer, updateDraft, refresh, toast, name],
  );

  const decide = useCallback(
    async (id: string, approve: boolean) => {
      try {
        const p = approve ? await api.approve(id, viewer) : await api.reject(id, viewer);
        await refresh();
        if (p.status === "applied") toast("Approved — the shared plan is updated");
        else if (p.status === "rejected") toast("Proposal declined", "info");
        else if (p.status === "superseded") toast(`Could not apply: ${p.error}`, "error");
        else toast("Approval recorded", "info");
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), "error");
      }
    },
    [viewer, refresh, toast],
  );

  const restore = useCallback(
    async (vid: number) => {
      try {
        await api.restore(vid, viewer);
        await refresh();
        toast("Proposed to return to this version", "info");
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), "error");
      }
    },
    [viewer, refresh, toast],
  );

  const reset = useCallback(async () => {
    await api.reset();
    setDrafts({});
    setPreview(null);
    setDismissed([]);
    await refresh();
    toast("Demo reset to the UBS starting point", "info");
  }, [refresh, toast]);

  const value: Ctx = {
    ws, loadError, viewer, setViewer, sheet, openSheet, plan, draftPlan, draft,
    setChange, addChanges, removeChange, discardDraft, sim, simLoading, simError, preview, startPreview,
    stopPreview, recs, recsLoading, refreshRecs, dismissed, dismissRec, propose, decide, restore, reset,
    refresh, toasts, toast, inboxOpen, setInboxOpen, sourcesOpen, setSourcesOpen, name, idx,
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useStore(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error("useStore outside provider");
  return c;
}

/** Evaluation currently displayed: preview > draft > agreed. */
export function useDisplayed() {
  const { sim, preview } = useStore();
  const current = preview?.sim?.evaluation ?? sim?.evaluation ?? null;
  const base = sim?.base ?? null;
  return { current, base, isPreview: !!preview?.sim };
}
