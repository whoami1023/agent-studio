export type ProviderMode = "demo" | "openai";

export type TodoStatus = "pending" | "in_progress" | "completed";

export type UserRole = "admin" | "user";

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  disabled: boolean;
  createdAt: string;
}

export interface AdminUserEntry extends PublicUser {
  agentCount: number;
  skillCount: number;
  runCount: number;
}

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

export interface SkillScript {
  path: string;
  language: string;
  size: number;
  content: string;
}

export interface Skill {
  id: string;
  ownerId: string;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  scripts: SkillScript[];
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
  ownerId: string;
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
  ownerId: string;
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
  user: PublicUser;
  agents: MainAgent[];
  skills: Skill[];
  runs: RunRecord[];
  settings: PublicSettings;
}

export interface LoginPayload {
  token: string;
  user: PublicUser;
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
  scripts?: SkillScript[];
}

export interface SkillImportPayload {
  fileName: string;
  dataBase64: string;
  name?: string;
  description?: string;
}

export interface ScriptRunResult {
  path: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}
