import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import { z } from "zod";
import type {
  BootstrapPayload,
  DelegationRecord,
  MainAgent,
  RunEvent,
  RunRecord,
  RunDetail,
  Skill,
  SubAgentConfig,
} from "../shared/types.js";
import {
  DATA_DIR,
  markInterruptedRuns,
  mutateStore,
  pruneWorkspaces,
  readStore,
  saveRun,
  toPublicSettings,
  type StoredSettings,
} from "./store.js";
import { executeRun } from "./orchestrator.js";
import { getWorkspacePath } from "./store.js";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const createId = (prefix: string) =>
  `${prefix}_${crypto.randomBytes(6).toString("hex")}`;

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("；");
}

const SubAgentSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "子智能体名称不能为空").max(40, "子智能体名称过长"),
  description: z
    .string()
    .trim()
    .min(1, "子智能体描述不能为空")
    .max(400, "子智能体描述过长"),
  systemPrompt: z.string().max(4000, "子智能体提示词过长").optional(),
  skillIds: z.array(z.string()).max(8, "单个子智能体最多绑定 8 个技能").optional(),
});

const AgentInputSchema = z.object({
  name: z.string().trim().min(1, "智能体名称不能为空").max(40, "智能体名称过长"),
  description: z.string().trim().min(1, "智能体描述不能为空").max(400, "智能体描述过长"),
  systemPrompt: z.string().max(6000, "系统提示词过长").optional(),
  subagents: z.array(SubAgentSchema).max(8, "单个主智能体最多 8 个子智能体").optional(),
});

const SkillInputSchema = z.object({
  name: z.string().trim().min(1, "技能名称不能为空").max(40, "技能名称过长"),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9-]{1,31}$/, "技能标识需为小写字母、数字或短横线，2-32 位")
    .optional(),
  description: z.string().trim().min(1, "技能描述不能为空").max(400, "技能描述过长"),
  instructions: z
    .string()
    .trim()
    .min(10, "技能说明至少 10 个字符")
    .max(12000, "技能说明过长"),
});

const SettingsSchema = z.object({
  mode: z.enum(["demo", "openai"]),
  baseUrl: z.string().trim().url("Base URL 格式不正确").max(300),
  model: z.string().trim().min(1, "模型名称不能为空").max(120),
  apiKey: z.string().max(500, "API Key 过长").optional(),
  clearApiKey: z.boolean().optional(),
});

const TaskSchema = z.object({
  task: z.string().trim().min(4, "任务描述至少 4 个字符").max(6000, "任务描述过长"),
});

function buildSubagents(
  input: z.infer<typeof AgentInputSchema>,
  skills: Skill[],
): SubAgentConfig[] {
  const skillIds = new Set(skills.map((skill) => skill.id));
  const names = new Set<string>();
  return (input.subagents ?? []).map((subagent) => {
    if (names.has(subagent.name)) {
      throw new Error(`子智能体名称重复：${subagent.name}`);
    }
    names.add(subagent.name);
    const selected = (subagent.skillIds ?? []).filter((id) => skillIds.has(id));
    return {
      id: subagent.id?.trim() || createId("sub"),
      name: subagent.name,
      description: subagent.description,
      systemPrompt: subagent.systemPrompt?.trim() ?? "",
      skillIds: Array.from(new Set(selected)),
    };
  });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/bootstrap", async (_req, res) => {
  const store = await readStore();
  const payload: BootstrapPayload = {
    agents: store.agents,
    skills: store.skills,
    runs: store.runs.slice(0, 20),
    settings: toPublicSettings(store.settings),
  };
  res.json(payload);
});

app.get("/api/agents", async (_req, res) => {
  const store = await readStore();
  res.json({ agents: store.agents });
});

app.post("/api/agents", async (req, res) => {
  const parsed = AgentInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatIssues(parsed.error) });
    return;
  }
  const store = await readStore();
  let subagents: SubAgentConfig[];
  try {
    subagents = buildSubagents(parsed.data, store.skills);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "子智能体配置有误" });
    return;
  }
  const now = new Date().toISOString();
  const agent: MainAgent = {
    id: createId("agent"),
    name: parsed.data.name,
    description: parsed.data.description,
    systemPrompt: parsed.data.systemPrompt?.trim() ?? "",
    subagents,
    createdAt: now,
    updatedAt: now,
  };
  await mutateStore((data) => {
    data.agents.unshift(agent);
  });
  res.status(201).json({ agent });
});

app.put("/api/agents/:id", async (req, res) => {
  const parsed = AgentInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatIssues(parsed.error) });
    return;
  }
  const store = await readStore();
  const existing = store.agents.find((agent) => agent.id === req.params.id);
  if (!existing) {
    res.status(404).json({ error: "智能体不存在" });
    return;
  }
  let subagents: SubAgentConfig[];
  try {
    subagents = buildSubagents(parsed.data, store.skills);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "子智能体配置有误" });
    return;
  }
  const updated: MainAgent = {
    ...existing,
    name: parsed.data.name,
    description: parsed.data.description,
    systemPrompt: parsed.data.systemPrompt?.trim() ?? "",
    subagents,
    updatedAt: new Date().toISOString(),
  };
  await mutateStore((data) => {
    const index = data.agents.findIndex((agent) => agent.id === updated.id);
    if (index >= 0) data.agents[index] = updated;
  });
  res.json({ agent: updated });
});

app.delete("/api/agents/:id", async (req, res) => {
  const removed = await mutateStore((data) => {
    const before = data.agents.length;
    data.agents = data.agents.filter((agent) => agent.id !== req.params.id);
    return before !== data.agents.length;
  });
  if (!removed) {
    res.status(404).json({ error: "智能体不存在" });
    return;
  }
  res.json({ ok: true });
});

app.get("/api/skills", async (_req, res) => {
  const store = await readStore();
  res.json({ skills: store.skills });
});

app.post("/api/skills", async (req, res) => {
  const parsed = SkillInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatIssues(parsed.error) });
    return;
  }
  const store = await readStore();
  const existingSlugs = new Set(store.skills.map((skill) => skill.slug));
  let slug = parsed.data.slug;
  if (!slug) {
    let candidate = `skill-${crypto.randomBytes(3).toString("hex")}`;
    while (existingSlugs.has(candidate)) {
      candidate = `skill-${crypto.randomBytes(3).toString("hex")}`;
    }
    slug = candidate;
  }
  if (existingSlugs.has(slug)) {
    res.status(400).json({ error: `技能标识已存在：${slug}` });
    return;
  }
  const now = new Date().toISOString();
  const skill: Skill = {
    id: createId("skill"),
    slug,
    name: parsed.data.name,
    description: parsed.data.description,
    instructions: parsed.data.instructions,
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };
  await mutateStore((data) => {
    data.skills.push(skill);
  });
  res.status(201).json({ skill });
});

app.put("/api/skills/:id", async (req, res) => {
  const parsed = SkillInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatIssues(parsed.error) });
    return;
  }
  const store = await readStore();
  const existing = store.skills.find((skill) => skill.id === req.params.id);
  if (!existing) {
    res.status(404).json({ error: "技能不存在" });
    return;
  }
  const updated: Skill = {
    ...existing,
    name: parsed.data.name,
    description: parsed.data.description,
    instructions: parsed.data.instructions,
    updatedAt: new Date().toISOString(),
  };
  await mutateStore((data) => {
    const index = data.skills.findIndex((skill) => skill.id === updated.id);
    if (index >= 0) data.skills[index] = updated;
  });
  res.json({ skill: updated });
});

app.delete("/api/skills/:id", async (req, res) => {
  const removed = await mutateStore((data) => {
    const skill = data.skills.find((item) => item.id === req.params.id);
    if (!skill) return null;
    if (skill.builtin) return "builtin";
    data.skills = data.skills.filter((item) => item.id !== skill.id);
    for (const agent of data.agents) {
      for (const subagent of agent.subagents) {
        subagent.skillIds = subagent.skillIds.filter((id) => id !== skill.id);
      }
    }
    return "removed";
  });
  if (removed === "builtin") {
    res.status(400).json({ error: "内置技能不可删除，但可以编辑内容" });
    return;
  }
  if (!removed) {
    res.status(404).json({ error: "技能不存在" });
    return;
  }
  res.json({ ok: true });
});

app.put("/api/settings", async (req, res) => {
  const parsed = SettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatIssues(parsed.error) });
    return;
  }
  const store = await readStore();
  const next: StoredSettings = {
    mode: parsed.data.mode,
    baseUrl: parsed.data.baseUrl.replace(/\/+$/, ""),
    model: parsed.data.model,
    apiKey: parsed.data.clearApiKey
      ? undefined
      : parsed.data.apiKey?.trim() || store.settings.apiKey,
  };
  if (next.mode === "openai" && !next.apiKey && !process.env.OPENAI_API_KEY) {
    res.status(400).json({ error: "OpenAI 兼容模式需要填写 API Key，或设置 OPENAI_API_KEY 环境变量" });
    return;
  }
  await mutateStore((data) => {
    data.settings = next;
  });
  res.json({ settings: toPublicSettings(next) });
});

app.post("/api/agents/:id/run", async (req, res) => {
  const parsed = TaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatIssues(parsed.error) });
    return;
  }
  const store = await readStore();
  const agent = store.agents.find((item) => item.id === req.params.id);
  if (!agent) {
    res.status(404).json({ error: "智能体不存在" });
    return;
  }
  if (store.settings.mode === "openai" && !store.settings.apiKey && !process.env.OPENAI_API_KEY) {
    res.status(400).json({ error: "当前为 OpenAI 兼容模式，请先在设置中填写 API Key" });
    return;
  }

  const now = new Date().toISOString();
  const run: RunRecord = {
    id: `run_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`,
    agentId: agent.id,
    agentName: agent.name,
    task: parsed.data.task,
    provider: store.settings.mode,
    status: "running",
    startedAt: now,
    plan: [],
    delegations: agent.subagents.map(
      (subagent, index): DelegationRecord => ({
        id: `del-${index + 1}`,
        subagent: subagent.name,
        description: subagent.description,
        status: "queued",
        activity: [],
      }),
    ),
    artifacts: [],
  };
  await saveRun(run);

  res.status(200);
  res.set({
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const emit = (event: RunEvent) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`${JSON.stringify(event)}\n`);
  };

  emit({ type: "run_started", run });

  const skillsById = new Map(store.skills.map((skill) => [skill.id, skill]));
  await executeRun({
    run,
    agent,
    settings: store.settings,
    skillsById,
    emit,
  }).catch((error) => {
    emit({
      type: "run_failed",
      run,
      message: error instanceof Error ? error.message : String(error),
    });
  });

  if (!res.writableEnded && !res.destroyed) res.end();
});

app.get("/api/runs", async (req, res) => {
  const store = await readStore();
  const agentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
  const limit = Math.min(
    60,
    Math.max(1, Number.parseInt(String(req.query.limit ?? "30"), 10) || 30),
  );
  const runs = store.runs
    .filter((run) => (agentId ? run.agentId === agentId : true))
    .slice(0, limit);
  res.json({ runs });
});

app.get("/api/runs/:id", async (req, res) => {
  const store = await readStore();
  const run = store.runs.find((item) => item.id === req.params.id);
  if (!run) {
    res.status(404).json({ error: "运行记录不存在" });
    return;
  }
  const artifactFiles = await readArtifacts(run.id);
  const detail: RunDetail = { ...run, artifactFiles };
  res.json(detail);
});

app.get("/api/runs/:id/artifact", async (req, res) => {
  const store = await readStore();
  const run = store.runs.find((item) => item.id === req.params.id);
  if (!run) {
    res.status(404).json({ error: "运行记录不存在" });
    return;
  }
  const name = typeof req.query.name === "string" ? req.query.name : "";
  if (!name) {
    res.status(400).json({ error: "缺少文件名称" });
    return;
  }
  const files = await readArtifacts(run.id);
  const file = files.find((item) => item.name === name);
  if (!file) {
    res.status(404).json({ error: "文件不存在" });
    return;
  }
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(name))}`,
  );
  res.send(file.content);
});

async function readArtifacts(runId: string) {
  const root = path.join(getWorkspacePath(runId), "artifacts");
  const files: Array<{ name: string; size: number; content: string }> = [];
  async function walk(dir: string, relative: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(absolute, nextRelative);
        continue;
      }
      try {
        const stat = await fs.stat(absolute);
        if (stat.size > 512 * 1024) continue;
        const content = await fs.readFile(absolute, "utf8");
        if (content.includes("\u0000")) continue;
        files.push({ name: nextRelative, size: stat.size, content });
      } catch {
        // skip
      }
    }
  }
  await walk(root, "");
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

const distDir = path.resolve("dist");
app.use(express.static(distDir));
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api/")) {
    next();
    return;
  }
  if (!req.accepts("html")) {
    next();
    return;
  }
  res.sendFile(path.join(distDir, "index.html"), (error) => {
    if (error) next();
  });
});

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(error);
    if (res.headersSent) return;
    res.status(500).json({
      error: error instanceof Error ? error.message : "服务器内部错误",
    });
  },
);

await fs.mkdir(DATA_DIR, { recursive: true });
await markInterruptedRuns();
await pruneWorkspaces();

app.listen(PORT, HOST, () => {
  console.log(`Agent Studio API ready at http://${HOST}:${PORT}`);
  readStore()
    .then((store) => {
      console.log(`provider=${store.settings.mode} model=${store.settings.model}`);
    })
    .catch(() => undefined);
});
