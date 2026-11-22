import type { Change, Plan } from "./types";

type Node = Record<string, unknown> | unknown[];

function step(node: unknown, seg: string): unknown {
  if (Array.isArray(node)) {
    return node.find((el) => el && typeof el === "object" && ((el as { id?: string }).id === seg || (el as { key?: string }).key === seg));
  }
  if (node && typeof node === "object") return (node as Record<string, unknown>)[seg];
  return undefined;
}

export function getPath(plan: Plan, path: string): unknown {
  let node: unknown = plan;
  for (const seg of path.split(".")) node = step(node, seg);
  return node;
}

function setPath(root: Node, path: string, value: unknown): void {
  const segs = path.split(".");
  let node: unknown = root;
  for (let i = 0; i < segs.length - 1; i++) node = step(node, segs[i]);
  const last = segs[segs.length - 1];
  if (Array.isArray(node)) {
    const idx = node.findIndex((el) => (el as { id?: string }).id === last || (el as { key?: string }).key === last);
    if (idx >= 0) node[idx] = value;
  } else if (node && typeof node === "object") {
    (node as Record<string, unknown>)[last] = value;
  }
}

/** Local optimistic application of changes for instant UI; the server re-validates. */
export function applyChanges(plan: Plan, changes: Change[]): Plan {
  const copy = structuredClone(plan) as unknown as Node;
  for (const ch of changes) setPath(copy, ch.path, structuredClone(ch.value));
  return copy as unknown as Plan;
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Upsert a change; drop it when it equals the agreed plan's value. */
export function upsert(changes: Change[], base: Plan, path: string, value: unknown): Change[] {
  const rest = changes.filter((c) => c.path !== path);
  const baseVal = getPath(base, path);
  if (sameValue(baseVal, value)) return rest;
  const idx = changes.findIndex((c) => c.path === path);
  const next = { path, value };
  if (idx >= 0) {
    const copy = [...changes];
    copy[idx] = next;
    return copy;
  }
  return [...rest, next];
}

export function mergeChanges(a: Change[], b: Change[], base: Plan): Change[] {
  let out = a;
  for (const ch of b) out = upsert(out, base, ch.path, ch.value);
  return out;
}

export function personIndex(plan: Plan, pid: string | null | undefined): number {
  return plan.people.findIndex((p) => p.id === pid);
}
