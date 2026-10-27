export type ProviderMode = "demo" | "openai";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

export interface Skill {
  id: string;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SubAgentConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  skillIds: string[];
}

export interface MainAgent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  subagents: SubAgentConfig[];
  createdAt: string;
  updatedAt: string;
  sample?: boolean;
}

export type DelegationStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface DelegationRecord {
  id: string;
  subagent: string;
  description: string;
  status: DelegationStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  result?: string;
  activity: string[];
}

export interface ArtifactRef {
  name: string;
  size: number;
}

export interface ArtifactFile extends ArtifactRef {
  content: string;
}

export type RunStatus = "running" | "completed" | "failed";

export interface RunRecord {
  id: string;
  agentId: string;
  agentName: string;
  task: string;
  provider: ProviderMode;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  plan: TodoItem[];
  delegations: DelegationRecord[];
  finalAnswer?: string;
  artifacts: ArtifactRef[];
  error?: string;
}

export interface RunDetail extends RunRecord {
  artifactFiles: ArtifactFile[];
}

export interface PublicSettings {
  mode: ProviderMode;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  envKeyAvailable: boolean;
}

export interface SettingsUpdate {
  mode: ProviderMode;
  baseUrl: string;
  model: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface BootstrapPayload {
  agents: MainAgent[];
  skills: Skill[];
  runs: RunRecord[];
  settings: PublicSettings;
}

export type RunEvent =
  | { type: "run_started"; run: RunRecord }
  | { type: "plan"; todos: TodoItem[] }
  | { type: "delegation"; delegation: DelegationRecord }
  | { type: "delegation_activity"; id: string; line: string }
  | {
      type: "delegation_done";
      id: string;
      result: string;
      durationMs: number;
      status: "completed" | "failed";
    }
  | { type: "final_answer"; answer: string }
  | { type: "run_completed"; run: RunRecord; artifacts: ArtifactFile[] }
  | { type: "run_failed"; run: RunRecord; message: string };

export interface AgentInput {
  name: string;
  description: string;
  systemPrompt?: string;
  subagents?: SubAgentInput[];
  sample?: boolean;
}

export interface SubAgentInput {
  name: string;
  description: string;
  systemPrompt?: string;
  skillIds?: string[];
}

export interface SkillInput {
  name: string;
  slug?: string;
  description: string;
  instructions: string;
}
