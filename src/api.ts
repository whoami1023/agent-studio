import type {
  AdminUserEntry,
  AgentInput,
  BootstrapPayload,
  LoginPayload,
  MainAgent,
  PublicSettings,
  PublicUser,
  RunDetail,
  RunEvent,
  RunRecord,
  ScriptRunResult,
  SettingsUpdate,
  Skill,
  SkillInput,
  SubagentSuggestPayload,
  SubagentSuggestResult,
} from "../shared/types";

const TOKEN_KEY = "agent-studio.token";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // localStorage unavailable
  }
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const jsonHeaders = { "Content-Type": "application/json" };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
    ...authHeaders(),
  };
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // keep default message
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<LoginPayload>("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ username, password }),
    }),
  logout: () =>
    request<{ ok: boolean }>("/api/auth/logout", {
      method: "POST",
    }),
  me: () => request<{ user: PublicUser }>("/api/auth/me"),
  bootstrap: () => request<BootstrapPayload>("/api/bootstrap"),
  listRuns: (limit = 30) => request<{ runs: RunRecord[] }>(`/api/runs?limit=${limit}`),
  getRun: (id: string) => request<RunDetail>(`/api/runs/${encodeURIComponent(id)}`),
  createAgent: (input: AgentInput) =>
    request<{ agent: MainAgent }>("/api/agents", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(input),
    }),
  suggestSubagents: (input: SubagentSuggestPayload) =>
    request<SubagentSuggestResult>("/api/agents/suggest-subagents", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(input),
    }),
  updateAgent: (id: string, input: AgentInput) =>
    request<{ agent: MainAgent }>(`/api/agents/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(input),
    }),
  deleteAgent: (id: string) =>
    request<{ ok: boolean }>(`/api/agents/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  createSkill: (input: SkillInput) =>
    request<{ skill: Skill }>("/api/skills", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(input),
    }),
  updateSkill: (id: string, input: SkillInput) =>
    request<{ skill: Skill }>(`/api/skills/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(input),
    }),
  deleteSkill: (id: string) =>
    request<{ ok: boolean }>(`/api/skills/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  importSkill: (file: File) =>
    file.arrayBuffer().then((buffer) => {
      let binary = "";
      const bytes = new Uint8Array(buffer);
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const dataBase64 = btoa(binary);
      return request<{ skill: Skill; skipped: string[] }>("/api/skills/import", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ fileName: file.name, dataBase64 }),
      });
    }),
  runSkillScript: (skillId: string, path: string) =>
    request<{ result: ScriptRunResult }>(`/api/skills/${encodeURIComponent(skillId)}/scripts/run`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ path }),
    }),
  updateSettings: (input: SettingsUpdate) =>
    request<{ settings: PublicSettings }>("/api/settings", {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(input),
    }),
  admin: {
    listUsers: () => request<{ users: AdminUserEntry[] }>("/api/admin/users"),
    createUser: (input: { username: string; password: string; displayName?: string }) =>
      request<{ user: PublicUser }>("/api/admin/users", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(input),
      }),
    deleteUser: (id: string) =>
      request<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    resetPassword: (id: string, password: string) =>
      request<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(id)}/password`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ password }),
      }),
    setUserStatus: (id: string, disabled: boolean) =>
      request<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(id)}/status`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ disabled }),
      }),
  },
};

export async function* streamRun(
  agentId: string,
  task: string,
  signal?: AbortSignal,
): AsyncGenerator<RunEvent> {
  const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/run`, {
    method: "POST",
    headers: { ...jsonHeaders, ...authHeaders() },
    body: JSON.stringify({ task }),
    signal,
  });
  if (!response.ok) {
    let message = `运行失败（${response.status}）`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // keep default
    }
    throw new ApiError(response.status, message);
  }
  if (!response.body) throw new Error("当前浏览器不支持流式响应");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let breakIndex = buffer.indexOf("\n");
      while (breakIndex >= 0) {
        const line = buffer.slice(0, breakIndex).trim();
        buffer = buffer.slice(breakIndex + 1);
        if (line) yield JSON.parse(line) as RunEvent;
        breakIndex = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield JSON.parse(buffer) as RunEvent;
  } finally {
    reader.releaseLock();
  }
}

export function downloadArtifactUrl(runId: string, name: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/artifact?name=${encodeURIComponent(name)}`;
}
