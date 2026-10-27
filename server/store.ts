import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  MainAgent,
  PublicSettings,
  RunRecord,
  Skill,
} from "../shared/types.js";
import {
  ADMIN_USER_ID,
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  hashPassword,
  type StoredSession,
  type StoredUser,
} from "./auth.js";
import {
  BUILTIN_SKILL_VERSION,
  builtinSkills,
  sampleAgents,
  sampleAgentsV2,
} from "./seed.js";

export interface StoredSettings {
  mode: "demo" | "openai";
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface StoreData {
  version: 2;
  sampleSeedVersion: number;
  builtinSkillVersion: number;
  users: StoredUser[];
  sessions: StoredSession[];
  agents: MainAgent[];
  skills: Skill[];
  settings: StoredSettings;
  runs: RunRecord[];
}

export const DATA_DIR = path.resolve("data");
export const WORKSPACE_ROOT = path.join(DATA_DIR, "workspaces");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const MAX_RUNS = 60;
const SAMPLE_SEED_VERSION = 2;
const CUSTOM_SKILL_PROMOTION_VERSION = 2;

const defaultSettings = (): StoredSettings => ({
  mode: "demo",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
});

function createAdminUser(): StoredUser {
  const now = new Date().toISOString();
  const { salt, hash } = hashPassword(DEFAULT_ADMIN_PASSWORD);
  return {
    id: ADMIN_USER_ID,
    username: DEFAULT_ADMIN_USERNAME,
    displayName: "管理员",
    role: "admin",
    passwordSalt: salt,
    passwordHash: hash,
    disabled: false,
    createdAt: now,
  };
}

function normalizeSkills(skills: Skill[]): Skill[] {
  return skills.map((skill) => ({
    ...skill,
    scripts: Array.isArray(skill.scripts)
      ? skill.scripts.filter(
          (script) =>
            script &&
            typeof script.path === "string" &&
            typeof script.content === "string" &&
            typeof script.size === "number",
        )
      : [],
  }));
}

function seededStore(): StoreData {
  const now = new Date().toISOString();
  const admin = createAdminUser();
  const skills = builtinSkills(now).map((skill) => ({
    ...skill,
    ownerId: admin.id,
    scripts: [],
  }));
  const agents = sampleAgents(now).map((agent) => ({
    ...agent,
    ownerId: admin.id,
  }));
  return {
    version: 2,
    sampleSeedVersion: SAMPLE_SEED_VERSION,
    builtinSkillVersion: BUILTIN_SKILL_VERSION,
    users: [admin],
    sessions: [],
    agents,
    skills,
    settings: defaultSettings(),
    runs: [],
  };
}

let cache: StoreData | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function ensureDirs(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
}

function migrateToV2(parsed: Record<string, unknown>): StoreData {
  const admin = createAdminUser();
  const ownerId = admin.id;
  const legacyAgents = Array.isArray(parsed.agents) ? (parsed.agents as MainAgent[]) : [];
  const legacySkills = Array.isArray(parsed.skills) ? (parsed.skills as Skill[]) : [];
  const legacyRuns = Array.isArray(parsed.runs) ? (parsed.runs as RunRecord[]) : [];
  return {
    version: 2,
    sampleSeedVersion: 1,
    builtinSkillVersion: 0,
    users: [admin],
    sessions: [],
    agents: legacyAgents.map((agent) => ({ ...agent, ownerId })),
    skills: normalizeSkills(legacySkills).map((skill) => ({ ...skill, ownerId })),
    settings: { ...defaultSettings(), ...(parsed.settings ?? {}) },
    runs: legacyRuns.map((run) => ({ ...run, ownerId })),
  };
}

function ensureSampleAgents(data: StoreData): boolean {
  if (data.sampleSeedVersion >= SAMPLE_SEED_VERSION) return false;
  const admin = data.users.find((user) => user.id === ADMIN_USER_ID);
  if (!admin) return false;
  const now = new Date().toISOString();
  const ownedIds = new Set(
    data.agents.filter((agent) => agent.ownerId === admin.id).map((agent) => agent.id),
  );
  const added = sampleAgentsV2(now).filter((agent) => !ownedIds.has(agent.id));
  data.agents.push(...added.map((agent) => ({ ...agent, ownerId: admin.id })));
  data.sampleSeedVersion = SAMPLE_SEED_VERSION;
  return true;
}

function ensureBuiltinSkills(data: StoreData): boolean {
  if (data.builtinSkillVersion >= BUILTIN_SKILL_VERSION) return false;
  const previousVersion = data.builtinSkillVersion;
  const now = new Date().toISOString();
  const fresh = builtinSkills(now);
  const bySlug = new Map(fresh.map((skill) => [skill.slug, skill]));
  let refreshed = false;
  for (const skill of data.skills) {
    const seed = bySlug.get(skill.slug);
    if (!seed || (!skill.builtin && skill.id !== seed.id)) continue;
    if (
      skill.name === seed.name &&
      skill.description === seed.description &&
      skill.instructions === seed.instructions
    ) {
      continue;
    }
    skill.name = seed.name;
    skill.description = seed.description;
    skill.instructions = seed.instructions;
    skill.updatedAt = now;
    refreshed = true;
  }
  const admin = data.users.find((user) => user.id === ADMIN_USER_ID);
  if (admin) {
    const existingIds = new Set(data.skills.map((skill) => skill.id));
    const existingSlugs = new Set(data.skills.map((skill) => skill.slug));
    for (const seed of fresh) {
      if (existingIds.has(seed.id) || existingSlugs.has(seed.slug)) continue;
      data.skills.push({ ...seed, ownerId: admin.id, scripts: [] });
      refreshed = true;
    }
  }
  let promoted = 0;
  if (previousVersion < CUSTOM_SKILL_PROMOTION_VERSION) {
    for (const skill of data.skills) {
      if (skill.builtin || skill.ownerId !== ADMIN_USER_ID) continue;
      skill.builtin = true;
      skill.updatedAt = now;
      promoted += 1;
    }
  }
  data.builtinSkillVersion = BUILTIN_SKILL_VERSION;
  if (refreshed) {
    console.log("store.json: 已更新内置技能为开源方法论文本");
  }
  if (promoted > 0) {
    console.log(`store.json: 已将 ${promoted} 个自定义技能转为内置技能`);
  }
  return true;
}

async function load(): Promise<StoreData> {
  if (cache) return cache;
  await ensureDirs();
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version !== 2 || !Array.isArray(parsed.users)) {
      cache = migrateToV2(parsed);
      console.log("store.json migrated to v2: seeded admin account, existing data assigned to admin");
    } else {
      cache = {
        version: 2,
        sampleSeedVersion:
          typeof parsed.sampleSeedVersion === "number" ? parsed.sampleSeedVersion : 1,
        builtinSkillVersion:
          typeof parsed.builtinSkillVersion === "number" ? parsed.builtinSkillVersion : 0,
        users: parsed.users as StoredUser[],
        sessions: Array.isArray(parsed.sessions) ? (parsed.sessions as StoredSession[]) : [],
        agents: Array.isArray(parsed.agents) ? (parsed.agents as MainAgent[]) : [],
        skills: normalizeSkills(Array.isArray(parsed.skills) ? (parsed.skills as Skill[]) : []),
        settings: { ...defaultSettings(), ...(parsed.settings ?? {}) },
        runs: Array.isArray(parsed.runs) ? (parsed.runs as RunRecord[]) : [],
      };
    }
    const samplesAdded = ensureSampleAgents(cache);
    if (samplesAdded) {
      console.log("store.json: 已补种内置示例智能体（开源调研组、代码审查组）");
    }
    const builtinsRefreshed = ensureBuiltinSkills(cache);
    if (
      samplesAdded ||
      builtinsRefreshed ||
      parsed.version !== 2 ||
      !Array.isArray(parsed.users)
    ) {
      await persist(cache);
    }
    return cache;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      cache = seededStore();
      await persist(cache);
      return cache;
    }
    const backup = `${STORE_PATH}.corrupt-${Date.now()}`;
    await fs.copyFile(STORE_PATH, backup).catch(() => undefined);
    console.warn(`store.json could not be parsed; backed up to ${backup}`);
    cache = seededStore();
    await persist(cache);
    return cache;
  }
}

async function persist(data: StoreData): Promise<void> {
  await ensureDirs();
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  try {
    await fs.rename(tmp, STORE_PATH);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EEXIST" && code !== "EACCES") throw error;
    // Windows can refuse an overwrite rename when the target is briefly locked.
    await fs.rm(STORE_PATH, { force: true });
    await fs.rename(tmp, STORE_PATH);
  }
}

export async function readStore(): Promise<StoreData> {
  await queue.catch(() => undefined);
  const data = await load();
  return structuredClone(data);
}

export async function mutateStore<T>(
  mutator: (data: StoreData) => T | Promise<T>,
): Promise<T> {
  let result: T | undefined;
  const job = queue.then(async () => {
    const data = await load();
    result = await mutator(data);
    await persist(data);
  });
  queue = job.catch(() => undefined);
  await job;
  return result as T;
}

export function getWorkspacePath(runId: string): string {
  return path.join(WORKSPACE_ROOT, runId);
}

export async function saveRun(run: RunRecord): Promise<void> {
  await mutateStore((data) => {
    const snapshot = structuredClone(run);
    const index = data.runs.findIndex((item) => item.id === run.id);
    if (index >= 0) data.runs[index] = snapshot;
    else data.runs.unshift(snapshot);
    data.runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    data.runs = data.runs.slice(0, MAX_RUNS);
  });
}

export async function pruneWorkspaces(): Promise<void> {
  const data = await readStore();
  const keep = new Set(data.runs.map((run) => run.id));
  try {
    const entries = await fs.readdir(WORKSPACE_ROOT, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !keep.has(entry.name))
        .map((entry) =>
          fs.rm(path.join(WORKSPACE_ROOT, entry.name), {
            recursive: true,
            force: true,
          }),
        ),
    );
  } catch {
    // workspace pruning is best-effort
  }
}

export async function markInterruptedRuns(): Promise<void> {
  await mutateStore((data) => {
    let changed = false;
    for (const run of data.runs) {
      if (run.status === "running") {
        run.status = "failed";
        run.error = "服务重启，运行已中断。";
        run.finishedAt = new Date().toISOString();
        for (const delegation of run.delegations) {
          if (delegation.status === "running" || delegation.status === "queued") {
            delegation.status = "failed";
          }
        }
        changed = true;
      }
    }
    return changed;
  });
}

export function toPublicSettings(settings: StoredSettings): PublicSettings {
  return {
    mode: settings.mode,
    baseUrl: settings.baseUrl,
    model: settings.model,
    hasApiKey: Boolean(settings.apiKey || process.env.OPENAI_API_KEY),
    envKeyAvailable: Boolean(process.env.OPENAI_API_KEY),
  };
}
