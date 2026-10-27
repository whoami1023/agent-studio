import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  MainAgent,
  PublicSettings,
  RunRecord,
  Skill,
} from "../shared/types.js";
import { builtinSkills, sampleAgents } from "./seed.js";

export interface StoredSettings {
  mode: "demo" | "openai";
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface StoreData {
  version: 1;
  agents: MainAgent[];
  skills: Skill[];
  settings: StoredSettings;
  runs: RunRecord[];
}

export const DATA_DIR = path.resolve("data");
export const WORKSPACE_ROOT = path.join(DATA_DIR, "workspaces");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const MAX_RUNS = 60;

const defaultSettings = (): StoredSettings => ({
  mode: "demo",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
});

function seededStore(): StoreData {
  const now = new Date().toISOString();
  return {
    version: 1,
    agents: sampleAgents(now),
    skills: builtinSkills(now),
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

async function load(): Promise<StoreData> {
  if (cache) return cache;
  await ensureDirs();
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreData>;
    cache = {
      version: 1,
      agents: Array.isArray(parsed.agents) ? parsed.agents : [],
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      settings: { ...defaultSettings(), ...(parsed.settings ?? {}) },
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    };
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
