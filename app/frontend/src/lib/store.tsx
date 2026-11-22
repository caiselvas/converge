"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { api, ApiError } from "./api";
import { applyChanges, mergeChanges, upsert } from "./plan";
import type { Change, Evaluation, Person, Plan, Proposal, SimResponse, Workspace, Stress } from "./types";

export type Scope = "nina" | "together" | "emil";

export function scopedIssues(evaluation: Evaluation, personId?: string) {
  return personId ? evaluation.issues.filter((issue) => issue.person === personId) : evaluation.issues;
}

export function scopedHref(path: string, scope: Scope, hash = "") {
  return `${path}?scope=${scope}${hash}`;
}

const scopeChanged = "converge:scope";

function urlScope(): Scope {
  const scope = new URLSearchParams(window.location.search).get("scope");
  return scope === "nina" || scope === "emil" ? scope : "together";
}

function subscribeToScope(update: () => void) {
  window.addEventListener("popstate", update);
  window.addEventListener(scopeChanged, update);
  return () => {
    window.removeEventListener("popstate", update);
    window.removeEventListener(scopeChanged, update);
  };
}

interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}

interface Ctx {
  ws: Workspace | null;
  loadError: string | null;
  viewer: string;
  setViewer: (id: string) => void;
  scope: Scope;
  setScope: (scope: Scope) => void;
  scopedPerson: Person | null;
  stress: Stress;
  setStress: (stress: Stress) => void;
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
  propose: (title: string, kind?: string) => Promise<Proposal | null>;
  decide: (id: string, approve: boolean) => Promise<void>;
  restore: (vid: number) => Promise<void>;
  reset: (prepared?: boolean) => Promise<void>;
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
  const path = usePathname();
  const scope = useSyncExternalStore<Scope>(subscribeToScope, urlScope, () => "together");
  const [stress, setStressState] = useState<Stress>({});
  const setScope = useCallback((next: Scope) => {
    if (next === urlScope()) return;
    const url = new URL(window.location.href);
    url.searchParams.set("scope", next);
    window.history.pushState(null, "", url);
    window.dispatchEvent(new Event(scopeChanged));
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const selected = urlScope();
    if (url.searchParams.get("scope") === selected) return;
    url.searchParams.set("scope", selected);
    window.history.replaceState(null, "", url);
  }, [path]);
  const [drafts, setDrafts] = useState<Record<string, Change[]>>({});
  const [sim, setSim] = useState<SimResponse | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const setStress = useCallback((next: Stress) => {
    setStressState(next);
  }, []);
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
  }, []);


  const plan = ws?.plan ?? null;
  const draft = useMemo(() => (viewer ? drafts[viewer] ?? [] : []), [drafts, viewer]);
  const draftPlan = useMemo(() => (plan ? applyChanges(plan, draft) : null), [plan, draft]);
  const scopedPerson = scope === "together" ? null : draftPlan?.people[scope === "nina" ? 0 : 1] ?? null;

  const updateDraft = useCallback(
    (fn: (d: Change[]) => Change[]) => {
      setDrafts((all) => ({ ...all, [viewer]: fn(all[viewer] ?? []) }));
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
  const stressKey = JSON.stringify(stress);
  const simKey = `${planKey}|${draftKey}|${stressKey}`;
  const [simFor, setSimFor] = useState("");
  const [simErrFor, setSimErrFor] = useState("");
  useEffect(() => {
    if (!ws) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await api.simulate(JSON.parse(draftKey), ctrl.signal, JSON.parse(stressKey));
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
  }, [draftKey, simKey, stressKey, ws]);
  const simLoading = !!ws && simFor !== simKey && simErrFor !== simKey;

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

  const reset = useCallback(async (prepared = false) => {
    await api.reset(prepared);
    setDrafts({});
    setStressState({});
    await refresh();
    toast(prepared ? "Demo loaded with the agreed home purchase" : "Demo reset to the UBS starting point", "info");
  }, [refresh, toast]);

  const value: Ctx = {
    ws, loadError, viewer, setViewer, scope, setScope, scopedPerson, stress, setStress, plan, draftPlan, draft,
    setChange, addChanges, removeChange, discardDraft, sim, simLoading, simError: simErrFor === simKey ? simError : null,
    propose, decide, restore, reset,
    refresh, toasts, toast, inboxOpen, setInboxOpen, sourcesOpen, setSourcesOpen, name, idx,
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useStore(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error("useStore outside provider");
  return c;
}

/** Evaluation for the displayed plan and its agreed baseline. */
export function useDisplayed() {
  const { sim } = useStore();
  const current = sim?.evaluation ?? null;
  const base = sim?.base ?? null;
  return { current, base };
}
