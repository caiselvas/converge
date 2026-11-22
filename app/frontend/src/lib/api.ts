import type {
  AssumptionRow, Change, ExplainResponse, InterpretResponse, LlmProvider, Proposal, RecResponse, SimResponse, Stress, Workspace,
} from "./types";

export const llmProviderLabel = { anthropic: "Claude", openai: "OpenAI" } satisfies Record<LlmProvider, string>;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api${path}`, {
    ...rest,
    method: rest.method ?? (json !== undefined ? "POST" : "GET"),
    headers: json !== undefined ? { "content-type": "application/json" } : undefined,
    body: json !== undefined ? JSON.stringify(json) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => call<{ ok: boolean; llm_available: boolean; llm_model: string | null }>("/health"),
  workspace: () => call<Workspace>("/workspace"),
  simulate: (changes: Change[], signal?: AbortSignal, stress?: Stress) =>
    call<SimResponse>("/simulate", { json: { changes, stress }, signal }),
  recommendations: (changes: Change[], signal?: AbortSignal, stress?: Stress) =>
    call<RecResponse>("/recommendations", { json: { changes, stress }, signal }),
  propose: (author: string, title: string, changes: Change[], kind = "manual", note = "") =>
    call<Proposal>("/proposals", { json: { author, title, changes, kind, note } }),
  approve: (id: string, person: string) => call<Proposal>(`/proposals/${id}/approve`, { json: { person } }),
  reject: (id: string, person: string) => call<Proposal>(`/proposals/${id}/reject`, { json: { person } }),
  preview: (id: string) => call<Omit<SimResponse, "plan" | "approvers">>(`/proposals/${id}/preview`),
  restore: (vid: number, author: string) => call<Proposal>(`/versions/${vid}/restore`, { json: { author } }),
  reset: () => call<Workspace>("/reset", { method: "POST" }),
  assumptions: () => call<AssumptionRow[]>("/assumptions"),
  provenance: (pid: string) => call<Record<string, unknown>>(`/provenance/${pid}`),
  interpret: (text: string, viewer: string, changes: Change[]) =>
    call<InterpretResponse>("/assistant/interpret", { json: { text, viewer, changes } }),
  explain: (changes: Change[], stress?: Stress) => call<ExplainResponse>("/assistant/explain", { json: { changes, stress } }),
};
