import type {
  AgentInput,
  BootstrapPayload,
  MainAgent,
  PublicSettings,
  RunDetail,
  RunEvent,
  RunRecord,
  SettingsUpdate,
  Skill,
  SkillInput,
} from "../shared/types";

const jsonHeaders = { "Content-Type": "application/json" };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // keep default message
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export const api = {
  bootstrap: () => request<BootstrapPayload>("/api/bootstrap"),
  listRuns: (limit = 30) => request<{ runs: RunRecord[] }>(`/api/runs?limit=${limit}`),
  getRun: (id: string) => request<RunDetail>(`/api/runs/${encodeURIComponent(id)}`),
  createAgent: (input: AgentInput) =>
    request<{ agent: MainAgent }>("/api/agents", {
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
  updateSettings: (input: SettingsUpdate) =>
    request<{ settings: PublicSettings }>("/api/settings", {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(input),
    }),
};

export async function* streamRun(
  agentId: string,
  task: string,
  signal?: AbortSignal,
): AsyncGenerator<RunEvent> {
  const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/run`, {
    method: "POST",
    headers: jsonHeaders,
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
    throw new Error(message);
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
