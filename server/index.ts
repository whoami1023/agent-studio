import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type {
  AdminUserEntry,
  BootstrapPayload,
  DelegationRecord,
  LoginPayload,
  MainAgent,
  RunDetail,
  RunEvent,
  RunRecord,
  Skill,
  SkillScript,
  SubAgentConfig,
} from "../shared/types.js";
import {
  newSessionToken,
  pruneSessions,
  toPublicUser,
  verifyPassword,
  hashPassword,
  type StoredUser,
} from "./auth.js";
import {
  DATA_DIR,
  getWorkspacePath,
  markInterruptedRuns,
  mutateStore,
  pruneWorkspaces,
  readStore,
  saveRun,
  toPublicSettings,
  type StoredSettings,
} from "./store.js";
import { executeRun } from "./orchestrator.js";
import { suggestSubagents } from "./suggestSubagents.js";
import {
  normalizeScripts,
  runScriptInDir,
  withSkillTempDir,
} from "./scriptRunner.js";
import { parseSkillZip } from "./skillImport.js";

declare global {
  namespace Express {
    interface Request {
      user?: StoredUser;
      sessionToken?: string;
    }
  }
}

const PORT = Number(process.env.PORT ?? 8689);
const HOST = process.env.HOST ?? "127.0.0.1";

const app = express();
app.disable("x-powered-by");
app.use("/api/skills/import", express.raw({ type: "*/*", limit: "16mb" }));
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
  scripts: z
    .array(
      z.object({
        path: z.string().min(1, "脚本路径不能为空").max(240, "脚本路径过长"),
        content: z.string().max(200000, "脚本内容过长"),
        language: z.string().max(20).optional(),
        size: z.number().int().nonnegative().max(200000).optional(),
      }),
    )
    .max(20, "脚本文件数量不能超过 20 个")
    .optional(),
});

const SkillImportSchema = z.object({
  fileName: z.string().trim().min(1, "缺少文件名").max(200, "文件名过长"),
  dataBase64: z.string().min(1, "缺少压缩包内容").max(15 * 1024 * 1024, "压缩包过大"),
  name: z.string().trim().max(40).optional(),
  description: z.string().trim().max(400).optional(),
});

const ScriptRunSchema = z.object({
  path: z.string().min(1, "缺少脚本路径").max(240, "脚本路径过长"),
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

const LoginSchema = z.object({
  username: z.string().trim().min(1, "请输入用户名").max(64, "用户名过长"),
  password: z.string().min(1, "请输入密码").max(200, "密码过长"),
});

const UserCreateSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2, "用户名至少 2 个字符")
    .max(32, "用户名最长 32 个字符")
    .regex(
      /^[A-Za-z0-9_\-\u4e00-\u9fa5]{2,32}$/,
      "用户名只能包含字母、数字、下划线、短横线或中文",
    ),
  password: z.string().min(6, "密码至少 6 个字符").max(200, "密码过长"),
  displayName: z.string().trim().max(40, "显示名称过长").optional(),
});

const PasswordResetSchema = z.object({
  password: z.string().min(6, "密码至少 6 个字符").max(200, "密码过长"),
});

const UserStatusSchema = z.object({
  disabled: z.boolean(),
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

/* ---------- Auth ---------- */

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
    if (!token) {
      res.status(401).json({ error: "未登录" });
      return;
    }
    const store = await readStore();
    const session = store.sessions.find((item) => item.token === token);
    if (!session) {
      res.status(401).json({ error: "会话已失效，请重新登录" });
      return;
    }
    const user = store.users.find((item) => item.id === session.userId);
    if (!user) {
      res.status(401).json({ error: "账户不存在" });
      return;
    }
    if (user.disabled) {
      res.status(403).json({ error: "账户已被停用，请联系管理员" });
      return;
    }
    req.user = user;
    req.sessionToken = token;
    next();
  })().catch(next);
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "仅管理员可执行此操作" });
    return;
  }
  next();
}

function userError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/login", async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    userError(res, 400, formatIssues(parsed.error));
    return;
  }
  const store = await readStore();
  const user = store.users.find((item) => item.username === parsed.data.username);
  if (!user || !verifyPassword(parsed.data.password, user.passwordSalt, user.passwordHash)) {
    userError(res, 401, "用户名或密码错误");
    return;
  }
  if (user.disabled) {
    userError(res, 403, "账户已被停用，请联系管理员");
    return;
  }
  const token = newSessionToken();
  await mutateStore((data) => {
    data.sessions = [
      ...pruneSessions(data.sessions),
      { token, userId: user.id, createdAt: new Date().toISOString() },
    ];
  });
  const payload: LoginPayload = { token, user: toPublicUser(user) };
  res.json(payload);
});

app.use("/api", requireAuth);

app.post("/api/auth/logout", async (req, res) => {
  await mutateStore((data) => {
    data.sessions = data.sessions.filter((item) => item.token !== req.sessionToken);
  });
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  res.json({ user: toPublicUser(req.user!) });
});

/* ---------- Bootstrap & business data (owner-scoped) ---------- */

app.get("/api/bootstrap", async (req, res) => {
  const store = await readStore();
  const user = req.user!;
  const payload: BootstrapPayload = {
    user: toPublicUser(user),
    agents: store.agents.filter((agent) => agent.ownerId === user.id),
    skills: store.skills.filter((skill) => skill.ownerId === user.id),
    runs: store.runs.filter((run) => run.ownerId === user.id).slice(0, 20),
    settings: toPublicSettings(store.settings),
  };
  res.json(payload);
});

app.get("/api/agents", async (req, res) => {
  const store = await readStore();
  const user = req.user!;
  res.json({ agents: store.agents.filter((agent) => agent.ownerId === user.id) });
});

app.post("/api/agents", async (req, res) => {
  const parsed = AgentInputSchema.safeParse(req.body);
  if (!parsed.success) {
    userError(res, 400, formatIssues(parsed.error));
    return;
  }
  const store = await readStore();
  const user = req.user!;
  const ownSkills = store.skills.filter((skill) => skill.ownerId === user.id);
  let subagents: SubAgentConfig[];
  try {
    subagents = buildSubagents(parsed.data, ownSkills);
  } catch (error) {
    userError(res, 400, error instanceof Error ? error.message : "子智能体配置有误");
    return;
  }
  const now = new Date().toISOString();
  const agent: MainAgent = {
    id: createId("agent"),
    ownerId: user.id,
    name: parsed.data.name,
    description: parsed.data.description,
    systemPrompt: parsed.data.systemPrompt?.trim() ?? "",
    subagents,
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };
  await mutateStore((data) => {
    data.agents.unshift(agent);
  });
  res.status(201).json({ agent });
});

const SuggestSchema = z.object({
  name: z.string().trim().min(1, "智能体名称不能为空").max(40, "智能体名称过长"),
  description: z.string().trim().min(1, "智能体描述不能为空").max(400, "智能体描述过长"),
  systemPrompt: z.string().max(6000, "系统提示词过长").optional(),
});

app.post("/api/agents/suggest-subagents", async (req, res) => {
  const parsed = SuggestSchema.safeParse(req.body);
  if (!parsed.success) {
    userError(res, 400, formatIssues(parsed.error));
    return;
  }
  const store = await readStore();
  const user = req.user!;
  const ownSkills = store.skills.filter((skill) => skill.ownerId === user.id);
  try {
    const result = await suggestSubagents(parsed.data, store.settings, ownSkills);
    res.json(result);
  } catch (error) {
    userError(res, 500, error instanceof Error ? error.message : "推荐子智能体失败");
  }
});

app.put("/api/agents/:id", async (req, res) => {
  const parsed = AgentInputSchema.safeParse(req.body);
  if (!parsed.success) {
    userError(res, 400, formatIssues(parsed.error));
    return;
  }
  const store = await readStore();
  const user = req.user!;
  const existing = store.agents.find(
    (agent) => agent.id === req.params.id && agent.ownerId === user.id,
  );
  if (!existing) {
    userError(res, 404, "智能体不存在");
    return;
  }
  const ownSkills = store.skills.filter((skill) => skill.ownerId === user.id);
  let subagents: SubAgentConfig[];
  try {
    subagents = buildSubagents(parsed.data, ownSkills);
  } catch (error) {
    userError(res, 400, error instanceof Error ? error.message : "子智能体配置有误");
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
  const user = req.user!;
  const removed = await mutateStore((data) => {
    const agent = data.agents.find(
      (item) => item.id === req.params.id && item.ownerId === user.id,
    );
    if (!agent) return null;
    if (agent.builtin) return "builtin";
    data.agents = data.agents.filter((item) => item.id !== agent.id);
    return "removed";
  });
  if (removed === "builtin") {
    userError(res, 400, "内置智能体组不可删除，但可以编辑内容");
    return;
  }
  if (!removed) {
    userError(res, 404, "智能体不存在");
    return;
  }
  res.json({ ok: true });
});

app.get("/api/skills", async (req, res) => {
  const store = await readStore();
  const user = req.user!;
  res.json({ skills: store.skills.filter((skill) => skill.ownerId === user.id) });
});

function parseSkillScripts(input: z.infer<typeof SkillInputSchema>): SkillScript[] | string {
  return normalizeScripts(input.scripts ?? []);
}

app.post("/api/skills", async (req, res) => {
  const parsed = SkillInputSchema.safeParse(req.body);
  if (!parsed.success) {
    userError(res, 400, formatIssues(parsed.error));
    return;
  }
  const scripts = parseSkillScripts(parsed.data);
  if (typeof scripts === "string") {
    userError(res, 400, scripts);
    return;
  }
  const store = await readStore();
  const user = req.user!;
  const ownSkills = store.skills.filter((skill) => skill.ownerId === user.id);
  const existingSlugs = new Set(ownSkills.map((skill) => skill.slug));
  let slug = parsed.data.slug;
  if (!slug) {
    let candidate = `skill-${crypto.randomBytes(3).toString("hex")}`;
    while (existingSlugs.has(candidate)) {
      candidate = `skill-${crypto.randomBytes(3).toString("hex")}`;
    }
    slug = candidate;
  }
  if (existingSlugs.has(slug)) {
    userError(res, 400, `技能标识已存在：${slug}`);
    return;
  }
  const now = new Date().toISOString();
  const skill: Skill = {
    id: createId("skill"),
    ownerId: user.id,
    slug,
    name: parsed.data.name,
    description: parsed.data.description,
    instructions: parsed.data.instructions,
    scripts,
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };
  await mutateStore((data) => {
    data.skills.push(skill);
  });
  res.status(201).json({ skill });
});

app.post("/api/skills/import", async (req, res) => {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body));
  } catch {
    userError(res, 400, "请求体不是有效的 JSON");
    return;
  }
  const parsed = SkillImportSchema.safeParse(payload);
  if (!parsed.success) {
    userError(res, 400, formatIssues(parsed.error));
    return;
  }
  let zipBytes: Buffer;
  try {
    zipBytes = Buffer.from(parsed.data.dataBase64, "base64");
  } catch {
    userError(res, 400, "压缩包内容不是有效的 Base64");
    return;
  }
  if (zipBytes.length === 0 || Buffer.byteLength(parsed.data.dataBase64) > 15 * 1024 * 1024) {
    userError(res, 400, "压缩包过大或为空");
    return;
  }
  const parsedZip = parseSkillZip(parsed.data.fileName, new Uint8Array(zipBytes));
  if (typeof parsedZip === "string") {
    userError(res, 400, parsedZip);
    return;
  }
  const store = await readStore();
  const user = req.user!;
  const existingSlugs = new Set(
    store.skills.filter((skill) => skill.ownerId === user.id).map((skill) => skill.slug),
  );
  const name = (parsed.data.name || parsedZip.name).slice(0, 40);
  const description = (parsed.data.description || parsedZip.description).slice(0, 400);
  const withSuffix = (base: string, n: number) => {
    const suffix = `-${n}`;
    return base.slice(0, 32 - suffix.length) + suffix;
  };
  let slug = parsedZip.slugCandidates.find((candidate) => !existingSlugs.has(candidate)) ?? "";
  if (!slug) {
    outer: for (const candidate of parsedZip.slugCandidates) {
      for (let n = 2; n < 100; n++) {
        const suffixed = withSuffix(candidate, n);
        if (!existingSlugs.has(suffixed)) {
          slug = suffixed;
          break outer;
        }
      }
    }
  }
  if (!slug) {
    slug = createId("skill");
    while (existingSlugs.has(slug)) {
      slug = createId("skill");
    }
  }
  const now = new Date().toISOString();
  const skill: Skill = {
    id: slug,
    ownerId: user.id,
    slug,
    name,
    description,
    instructions: parsedZip.instructions,
    scripts: parsedZip.scripts,
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };
  await mutateStore((data) => {
    data.skills.push(skill);
  });
  res.status(201).json({ skill, skipped: parsedZip.skipped });
});

app.post("/api/skills/:id/scripts/run", async (req, res) => {
  const parsed = ScriptRunSchema.safeParse(req.body);
  if (!parsed.success) {
    userError(res, 400, formatIssues(parsed.error));
    return;
  }
  const store = await readStore();
  const user = req.user!;
  const skill = store.skills.find(
    (item) => item.id === req.params.id && item.ownerId === user.id,
  );
  if (!skill) {
    userError(res, 404, "技能不存在");
    return;
  }
  const script = (skill.scripts ?? []).find((item) => item.path === parsed.data.path);
  if (!script) {
    userError(res, 404, "脚本不存在");
    return;
  }
  try {
    const result = await withSkillTempDir(skill, (dir) =>
      runScriptInDir(script, dir, { timeoutMs: 60_000 }),
    );
    res.json({ result });
  } catch (error) {
    userError(res, 500, error instanceof Error ? error.message : "脚本执行失败");
  }
});

app.put("/api/skills/:id", async (req, res) => {
  const parsed = SkillInputSchema.safeParse(req.body);
  if (!parsed.success) {
    userError(res, 400, formatIssues(parsed.error));
    return;
  }
  const scripts = parseSkillScripts(parsed.data);
  if (typeof scripts === "string") {
    userError(res, 400, scripts);
    return;
  }
  const store = await readStore();
  const user = req.user!;
  const existing = store.skills.find(
    (skill) => skill.id === req.params.id && skill.ownerId === user.id,
  );
  if (!existing) {
    userError(res, 404, "技能不存在");
    return;
  }
  const updated: Skill = {
    ...existing,
    name: parsed.data.name,
    description: parsed.data.description,
    instructions: parsed.data.instructions,
    scripts,
    updatedAt: new Date().toISOString(),
  };
  await mutateStore((data) => {
    const index = data.skills.findIndex((skill) => skill.id === updated.id);
    if (index >= 0) data.skills[index] = updated;
  });
  res.json({ skill: updated });
});

app.delete("/api/skills/:id", async (req, res) => {
  const user = req.user!;
  const removed = await mutateStore((data) => {
    const skill = data.skills.find(
      (item) => item.id === req.params.id && item.ownerId === user.id,
    );
    if (!skill) return null;
    if (skill.builtin) return "builtin";
    data.skills = data.skills.filter((item) => item.id !== skill.id);
    for (const agent of data.agents) {
      if (agent.ownerId !== user.id) continue;
      for (const subagent of agent.subagents) {
        subagent.skillIds = subagent.skillIds.filter((id) => id !== skill.id);
      }
    }
    return "removed";
  });
  if (removed === "builtin") {
    userError(res, 400, "内置技能不可删除，但可以编辑内容");
    return;
  }
  if (!removed) {
    userError(res, 404, "技能不存在");
    return;
  }
  res.json({ ok: true });
});

app.put("/api/settings", requireAdmin, async (req, res) => {
  const parsed = SettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    userError(res, 400, formatIssues(parsed.error));
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
    userError(res, 400, "OpenAI 兼容模式需要填写 API Key，或设置 OPENAI_API_KEY 环境变量");
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
    userError(res, 400, formatIssues(parsed.error));
    return;
  }
  const store = await readStore();
  const user = req.user!;
  const agent = store.agents.find(
    (item) => item.id === req.params.id && item.ownerId === user.id,
  );
  if (!agent) {
    userError(res, 404, "智能体不存在");
    return;
  }
  if (store.settings.mode === "openai" && !store.settings.apiKey && !process.env.OPENAI_API_KEY) {
    userError(res, 400, "当前为 OpenAI 兼容模式，请先在设置中填写 API Key");
    return;
  }

  const now = new Date().toISOString();
  const run: RunRecord = {
    id: `run_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`,
    ownerId: user.id,
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

  const ownSkills = store.skills.filter((skill) => skill.ownerId === user.id);
  const skillsById = new Map(ownSkills.map((skill) => [skill.id, skill]));
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
  const user = req.user!;
  const agentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
  const limit = Math.min(
    60,
    Math.max(1, Number.parseInt(String(req.query.limit ?? "30"), 10) || 30),
  );
  const runs = store.runs
    .filter((run) => run.ownerId === user.id)
    .filter((run) => (agentId ? run.agentId === agentId : true))
    .slice(0, limit);
  res.json({ runs });
});

app.get("/api/runs/:id", async (req, res) => {
  const store = await readStore();
  const user = req.user!;
  const run = store.runs.find(
    (item) => item.id === req.params.id && item.ownerId === user.id,
  );
  if (!run) {
    userError(res, 404, "运行记录不存在");
    return;
  }
  const artifactFiles = await readArtifacts(run.id);
  const detail: RunDetail = { ...run, artifactFiles };
  res.json(detail);
});

app.get("/api/runs/:id/artifact", async (req, res) => {
  const store = await readStore();
  const user = req.user!;
  const run = store.runs.find(
    (item) => item.id === req.params.id && item.ownerId === user.id,
  );
  if (!run) {
    userError(res, 404, "运行记录不存在");
    return;
  }
  const name = typeof req.query.name === "string" ? req.query.name : "";
  if (!name) {
    userError(res, 400, "缺少文件名称");
    return;
  }
  const files = await readArtifacts(run.id);
  const file = files.find((item) => item.name === name);
  if (!file) {
    userError(res, 404, "文件不存在");
    return;
  }
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(name))}`,
  );
  res.send(file.content);
});

/* ---------- Admin: account management ---------- */

app.use("/api/admin", requireAdmin);

app.get("/api/admin/users", async (req, res) => {
  const store = await readStore();
  const entries: AdminUserEntry[] = store.users.map((user) => ({
    ...toPublicUser(user),
    agentCount: store.agents.filter((agent) => agent.ownerId === user.id).length,
    skillCount: store.skills.filter((skill) => skill.ownerId === user.id).length,
    runCount: store.runs.filter((run) => run.ownerId === user.id).length,
  }));
  entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  res.json({ users: entries });
});

app.post("/api/admin/users", async (req, res) => {
  const parsed = UserCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    userError(res, 400, formatIssues(parsed.error));
    return;
  }
  const store = await readStore();
  const username = parsed.data.username;
  if (store.users.some((item) => item.username.toLowerCase() === username.toLowerCase())) {
    userError(res, 400, "用户名已存在");
    return;
  }
  const now = new Date().toISOString();
  const { salt, hash } = hashPassword(parsed.data.password);
  const user: StoredUser = {
    id: createId("user"),
    username,
    displayName: parsed.data.displayName?.trim() || username,
    role: "user",
    passwordSalt: salt,
    passwordHash: hash,
    disabled: false,
    createdAt: now,
  };
  const adminBuiltins = store.skills.filter(
    (skill) => skill.builtin && skill.ownerId === req.user!.id,
  );
  const clonedSkills: Skill[] = adminBuiltins.map((skill) => ({
    ...skill,
    id: createId("skill"),
    ownerId: user.id,
    scripts: structuredClone(skill.scripts ?? []),
    createdAt: now,
    updatedAt: now,
  }));
  const skillIdMap = new Map(
    adminBuiltins.map((skill, index) => [skill.id, clonedSkills[index].id]),
  );
  const adminBuiltinAgents = store.agents.filter(
    (agent) => agent.builtin && agent.ownerId === req.user!.id,
  );
  const clonedAgents: MainAgent[] = adminBuiltinAgents.map((agent) => ({
    ...agent,
    id: createId("agent"),
    ownerId: user.id,
    subagents: agent.subagents.map((subagent) => ({
      ...subagent,
      id: createId("sub"),
      skillIds: subagent.skillIds
        .map((id) => skillIdMap.get(id))
        .filter((id): id is string => Boolean(id)),
    })),
    createdAt: now,
    updatedAt: now,
  }));
  await mutateStore((data) => {
    data.users.push(user);
    data.skills.push(...clonedSkills);
    data.agents.push(...clonedAgents);
  });
  res.status(201).json({ user: toPublicUser(user) });
});

app.delete("/api/admin/users/:id", async (req, res) => {
  const targetId = req.params.id;
  if (targetId === req.user!.id) {
    userError(res, 400, "不能删除当前登录的管理员账户");
    return;
  }
  const result = await mutateStore((data) => {
    const target = data.users.find((item) => item.id === targetId);
    if (!target) return "missing";
    if (target.role === "admin") return "admin";
    const runIds = data.runs
      .filter((run) => run.ownerId === targetId)
      .map((run) => run.id);
    data.users = data.users.filter((item) => item.id !== targetId);
    data.sessions = data.sessions.filter((item) => item.userId !== targetId);
    data.agents = data.agents.filter((item) => item.ownerId !== targetId);
    data.skills = data.skills.filter((item) => item.ownerId !== targetId);
    data.runs = data.runs.filter((item) => item.ownerId !== targetId);
    return { runIds };
  });
  if (result === "missing") {
    userError(res, 404, "账户不存在");
    return;
  }
  if (result === "admin") {
    userError(res, 400, "不能删除管理员账户");
    return;
  }
  await Promise.all(
    result.runIds.map((runId) =>
      fs.rm(path.join(getWorkspacePath(runId)), { recursive: true, force: true }),
    ),
  ).catch(() => undefined);
  res.json({ ok: true });
});

app.post("/api/admin/users/:id/password", async (req, res) => {
  const parsed = PasswordResetSchema.safeParse(req.body);
  if (!parsed.success) {
    userError(res, 400, formatIssues(parsed.error));
    return;
  }
  const targetId = req.params.id;
  const found = await mutateStore((data) => {
    const target = data.users.find((item) => item.id === targetId);
    if (!target) return false;
    const { salt, hash } = hashPassword(parsed.data.password);
    target.passwordSalt = salt;
    target.passwordHash = hash;
    return true;
  });
  if (!found) {
    userError(res, 404, "账户不存在");
    return;
  }
  res.json({ ok: true });
});

app.post("/api/admin/users/:id/status", async (req, res) => {
  const parsed = UserStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    userError(res, 400, formatIssues(parsed.error));
    return;
  }
  const targetId = req.params.id;
  if (targetId === req.user!.id && parsed.data.disabled) {
    userError(res, 400, "不能停用当前登录的管理员账户");
    return;
  }
  const found = await mutateStore((data) => {
    const target = data.users.find((item) => item.id === targetId);
    if (!target) return false;
    target.disabled = parsed.data.disabled;
    if (parsed.data.disabled) {
      data.sessions = data.sessions.filter((item) => item.userId !== targetId);
    }
    return true;
  });
  if (!found) {
    userError(res, 404, "账户不存在");
    return;
  }
  res.json({ ok: true });
});

/* ---------- Artifacts ---------- */

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

/* ---------- Static & startup ---------- */

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
    if (res.headersSent) return;
    const status =
      error && typeof error === "object" && typeof (error as { status?: unknown }).status === "number"
        ? ((error as { status: number }).status)
        : 0;
    if (status >= 400 && status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "请求无效",
      });
      return;
    }
    console.error(error);
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
      console.log(
        `provider=${store.settings.mode} model=${store.settings.model} users=${store.users.length}`,
      );
    })
    .catch(() => undefined);
});
