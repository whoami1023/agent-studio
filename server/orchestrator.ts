import { promises as fs } from "node:fs";
import path from "node:path";
import { createDeepAgent, FilesystemBackend, type SubAgent } from "deepagents";
import { ChatOpenAI } from "@langchain/openai";
import { todoListMiddleware } from "langchain";
import YAML from "yaml";
import type {
  ArtifactFile,
  ArtifactRef,
  DelegationRecord,
  MainAgent,
  RunEvent,
  RunRecord,
  Skill,
  TodoItem,
} from "../shared/types.js";
import { DemoChatModel } from "./demoModel.js";
import { getWorkspacePath, pruneWorkspaces, saveRun, type StoredSettings } from "./store.js";

interface ExecuteRunInput {
  run: RunRecord;
  agent: MainAgent;
  settings: StoredSettings;
  skillsById: Map<string, Skill>;
  emit: (event: RunEvent) => void;
}

interface TaskInvocation {
  toolCallId: string;
  laneId: string;
  subagent: string;
  description: string;
}

const MAX_ARTIFACT_BYTES = 512 * 1024;

function messageType(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const candidate = message as { getType?: () => string; type?: string };
  return candidate.getType?.() ?? candidate.type ?? "";
}

function messageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string") {
          return (block as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function messageToolCalls(message: unknown): Array<{
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
}> {
  if (!message || typeof message !== "object") return [];
  const calls = (message as { tool_calls?: unknown }).tool_calls;
  return Array.isArray(calls)
    ? (calls as Array<{ id?: string; name?: string; args?: Record<string, unknown> }>)
    : [];
}

function toolCallIdOf(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const id = (message as { tool_call_id?: unknown }).tool_call_id;
  return typeof id === "string" ? id : undefined;
}

function normalizeTodos(value: unknown): TodoItem[] | null {
  if (!Array.isArray(value)) return null;
  const todos: TodoItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const content = (item as { content?: unknown }).content;
    const status = (item as { status?: unknown }).status;
    if (typeof content !== "string") return null;
    if (status !== "pending" && status !== "in_progress" && status !== "completed") {
      return null;
    }
    todos.push({ content, status });
  }
  return todos;
}

function safeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function usedSkills(agent: MainAgent, skillsById: Map<string, Skill>): Skill[] {
  const ids = new Set(agent.subagents.flatMap((subagent) => subagent.skillIds));
  return Array.from(ids)
    .map((id) => skillsById.get(id))
    .filter((skill): skill is Skill => Boolean(skill && safeSlug(skill.slug)));
}

async function materializeSkills(workspace: string, skills: Skill[]): Promise<void> {
  for (const skill of skills) {
    const slug = safeSlug(skill.slug);
    if (!slug) continue;
    const dir = path.join(workspace, "skills", slug);
    await fs.mkdir(dir, { recursive: true });
    const frontmatter = YAML.stringify({
      name: slug,
      description: skill.description,
    });
    await fs.writeFile(
      path.join(dir, "SKILL.md"),
      `---\n${frontmatter}---\n\n${skill.instructions}\n`,
      "utf8",
    );
  }
}

function parentSystemPrompt(agent: MainAgent): string {
  const subagentLines =
    agent.subagents.length > 0
      ? agent.subagents
          .map((subagent) => `- ${subagent.name}：${subagent.description}`)
          .join("\n")
      : "- 当前没有配置子智能体，请独立完成任务。";
  return [
    `你是「${agent.name}」的主智能体，负责统筹多智能体协作并交付最终结果。`,
    ``,
    `角色说明：${agent.description}`,
    agent.systemPrompt.trim() ? `\n补充要求：\n${agent.systemPrompt.trim()}` : "",
    ``,
    `## 协作规则`,
    `1. 先用 write_todos 制定可执行计划，并随进度更新状态。`,
    `2. 使用 task 工具把子任务分派给子智能体；互不依赖的子任务应在同一条消息中并行发起多个 task 调用。`,
    `3. 每次分派都要写清楚总任务、子智能体职责与交付要求。`,
    `4. 所有子智能体返回后，汇总它们的产出，形成结构清晰、可直接使用的最终 Markdown 交付。`,
    ``,
    `## 可用子智能体`,
    subagentLines,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function subagentSystemPrompt(agent: MainAgent, subagent: MainAgent["subagents"][number]): string {
  const base =
    subagent.systemPrompt.trim() ||
    `你是「${subagent.name}」，是「${agent.name}」的协作子智能体。\n职责：${subagent.description}`;
  return [
    base,
    ``,
    `## 交付约定`,
    `- 只处理主智能体分派给你的部分，不要重复其他角色的工作。`,
    `- 以 Markdown 输出：结论摘要、关键发现、交付建议、风险与待确认。`,
    `- 需要沉淀为文件时写入 /artifacts/ 目录。`,
    `- 不确定的信息明确标注为假设，不要臆造事实或数据。`,
  ].join("\n");
}

function buildModels(
  agent: MainAgent,
  settings: StoredSettings,
  skillsById: Map<string, Skill>,
) {
  if (settings.mode === "demo") {
    return {
      parent: new DemoChatModel({ kind: "parent", agent, skillsById }),
      forSubagent: (subagent: MainAgent["subagents"][number], index: number) =>
        new DemoChatModel({
          kind: "subagent",
          agent,
          skillsById,
          subagent,
          artifactSlug: `sub-${index + 1}`,
        }),
    };
  }
  const apiKey = settings.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI 兼容模式缺少 API Key，请在设置中填写或配置 OPENAI_API_KEY。");
  }
  const model = new ChatOpenAI({
    model: settings.model,
    apiKey,
    temperature: 0.2,
    configuration: { baseURL: settings.baseUrl },
  });
  return {
    parent: model,
    forSubagent: () => model,
  };
}

function chunkNamespace(chunk: unknown): { namespace: string[]; update: Record<string, unknown> } | null {
  if (!Array.isArray(chunk) || chunk.length < 2) return null;
  const namespace = Array.isArray(chunk[0]) ? (chunk[0] as string[]) : [];
  const update = chunk.length >= 3 ? chunk[2] : chunk[1];
  if (!update || typeof update !== "object") return null;
  return { namespace, update: update as Record<string, unknown> };
}

async function collectArtifacts(runId: string): Promise<ArtifactFile[]> {
  const root = path.join(getWorkspacePath(runId), "artifacts");
  const files: ArtifactFile[] = [];

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
        if (stat.size > MAX_ARTIFACT_BYTES) continue;
        const content = await fs.readFile(absolute, "utf8");
        if (content.includes("\u0000")) continue;
        files.push({ name: nextRelative, size: stat.size, content });
      } catch {
        // skip unreadable artifacts
      }
    }
  }

  await walk(root, "");
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

export async function executeRun(input: ExecuteRunInput): Promise<RunRecord> {
  const { run, agent, settings, skillsById, emit } = input;
  const startedMs = Date.parse(run.startedAt);
  const workspace = getWorkspacePath(run.id);
  const namespaceLanes = new Map<string, string>();
  const taskInvocations = new Map<string, TaskInvocation>();
  const invocationOrder: TaskInvocation[] = [];
  const subagentToolNames = new Map<string, string>();
  let finalAnswer: string | undefined;

  const send = (event: RunEvent) => {
    try {
      emit(event);
    } catch {
      // client disconnected; keep executing so the run is persisted
    }
  };

  const laneById = (id: string) => run.delegations.find((lane) => lane.id === id);
  const addActivity = (lane: DelegationRecord, line: string) => {
    if (lane.activity[lane.activity.length - 1] === line) return;
    lane.activity.push(line);
    if (lane.activity.length > 16) lane.activity.shift();
    send({ type: "delegation_activity", id: lane.id, line });
  };

  const emitDelegation = (lane: DelegationRecord) => {
    send({ type: "delegation", delegation: structuredClone(lane) });
  };

  const setPlan = (todos: TodoItem[] | null) => {
    if (!todos) return;
    const serialized = JSON.stringify(todos);
    if (serialized === JSON.stringify(run.plan)) return;
    run.plan = todos;
    send({ type: "plan", todos: structuredClone(todos) });
  };

  const findOrCreateLane = (subagentName: string, description: string): DelegationRecord => {
    let lane = run.delegations.find((item) => item.subagent === subagentName);
    if (!lane) {
      lane = {
        id: `del-dynamic-${run.delegations.length + 1}`,
        subagent: subagentName,
        description,
        status: "running",
        activity: [],
      };
      run.delegations.push(lane);
    }
    lane.status = "running";
    if (!lane.description) lane.description = description;
    lane.startedAt = new Date().toISOString();
    lane.finishedAt = undefined;
    lane.durationMs = undefined;
    lane.activity = ["收到主智能体分派的任务"];
    emitDelegation(lane);
    send({ type: "delegation_activity", id: lane.id, line: lane.activity[0] });
    return lane;
  };

  const normalizeForMatch = (value: string) => value.replace(/\s+/g, " ").trim();

  const resolveNamespaceLane = (
    namespace: string[],
    messages: unknown[],
  ): DelegationRecord | undefined => {
    if (namespace.length === 0) return undefined;
    const key = namespace.join("/");
    const cached = namespaceLanes.get(key);
    if (cached) return laneById(cached);

    const text = normalizeForMatch(messages.map(messageText).join("\n"));
    let best: { laneId: string; score: number } | undefined;
    for (const invocation of invocationOrder) {
      const description = normalizeForMatch(invocation.description);
      let score = 0;
      if (description.length > 20 && text.includes(description.slice(0, Math.min(160, description.length)))) {
        score = 100;
      } else if (text.length > 20 && description.includes(text.slice(0, Math.min(160, text.length)))) {
        score = 95;
      } else if (text.includes(`你的角色：${invocation.subagent}`)) {
        score = 90;
      } else if (text.includes(invocation.subagent)) {
        score = 70;
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { laneId: invocation.laneId, score };
      }
    }

    let laneId = best?.laneId;
    if (!laneId) {
      const assigned = new Set(namespaceLanes.values());
      const candidate = invocationOrder.find((invocation) => !assigned.has(invocation.laneId));
      laneId = candidate?.laneId;
    }
    if (!laneId) return undefined;
    namespaceLanes.set(key, laneId);
    const lane = laneById(laneId);
    if (lane) addActivity(lane, "子智能体已开始执行");
    return lane;
  };

  const handleParentToolCalls = (message: unknown) => {
    for (const call of messageToolCalls(message)) {
      if (call.name === "write_todos") {
        setPlan(normalizeTodos(call.args?.todos));
        continue;
      }
      if (call.name !== "task") continue;
      const toolCallId = typeof call.id === "string" ? call.id : "";
      if (!toolCallId || taskInvocations.has(toolCallId)) continue;
      const rawName = call.args?.subagent_type;
      const rawDescription = call.args?.description;
      const subagentName = typeof rawName === "string" && rawName.trim() ? rawName.trim() : "未命名子智能体";
      const description =
        typeof rawDescription === "string" && rawDescription.trim()
          ? rawDescription.trim()
          : `请完成 ${subagentName} 的职责。`;
      const lane = findOrCreateLane(subagentName, description);
      const invocation: TaskInvocation = {
        toolCallId,
        laneId: lane.id,
        subagent: subagentName,
        description,
      };
      taskInvocations.set(toolCallId, invocation);
      invocationOrder.push(invocation);
    }
  };

  const handleParentToolResult = (message: unknown) => {
    const toolCallId = toolCallIdOf(message);
    if (!toolCallId) return;
    const invocation = taskInvocations.get(toolCallId);
    if (!invocation) return;
    const lane = laneById(invocation.laneId);
    if (!lane) return;
    const result = messageText(message).trim();
    const failed = /^(error|error:)/i.test(result) || /invoked agent of type/i.test(result);
    const now = new Date().toISOString();
    lane.status = failed ? "failed" : "completed";
    lane.result = result || (failed ? "子智能体执行失败，未返回内容。" : "子智能体未返回文本结果。");
    lane.finishedAt = now;
    lane.durationMs = lane.startedAt ? Math.max(0, Date.parse(now) - Date.parse(lane.startedAt)) : undefined;
    addActivity(lane, failed ? "执行失败，已返回错误信息" : "已返回结构化结果");
    send({
      type: "delegation_done",
      id: lane.id,
      result: lane.result,
      durationMs: lane.durationMs ?? 0,
      status: lane.status,
    });
    emitDelegation(lane);
  };

  const handleSubagentUpdate = (
    namespace: string[],
    update: Record<string, unknown>,
    messages: unknown[],
  ) => {
    if (namespace.length === 0) return;
    const lane = resolveNamespaceLane(namespace, messages);

    const skillsMetadata = update.skillsMetadata;
    if (lane && Array.isArray(skillsMetadata) && skillsMetadata.length > 0) {
      const names = skillsMetadata
        .map((skill) =>
          skill && typeof skill === "object" && typeof (skill as { name?: unknown }).name === "string"
            ? (skill as { name: string }).name
            : "",
        )
        .filter(Boolean);
      if (names.length > 0) addActivity(lane, `加载技能：${names.join("、")}`);
    }

    for (const message of messages) {
      const type = messageType(message);
      if (type === "ai") {
        const calls = messageToolCalls(message);
        for (const call of calls) {
          if (call.id) {
            subagentToolNames.set(call.id, call.name ?? "");
          }
          if (!lane) continue;
          const filePath =
            call.args && typeof call.args.file_path === "string" ? call.args.file_path : "";
          if (call.name === "write_file") {
            addActivity(lane, `写入交付物：${filePath || "/artifacts/"}`);
          } else if (call.name === "read_file" && filePath) {
            addActivity(lane, `读取参考文件：${filePath}`);
          } else if (call.name === "edit_file" && filePath) {
            addActivity(lane, `修订文件：${filePath}`);
          }
        }
        if (calls.length === 0 && lane) {
          addActivity(lane, "完成分析，正在整理交付");
        }
      } else if (type === "tool" && lane) {
        const id = toolCallIdOf(message);
        if (id && subagentToolNames.get(id) === "write_file") {
          addActivity(lane, "交付物已保存到工作区");
        }
      }
    }
  };

  try {
    await materializeSkills(workspace, usedSkills(agent, skillsById));
    await fs.mkdir(path.join(workspace, "artifacts"), { recursive: true });

    const models = buildModels(agent, settings, skillsById);
    const backend = new FilesystemBackend({ rootDir: workspace, virtualMode: true });
    const skillPaths = (subagent: MainAgent["subagents"][number]) =>
      subagent.skillIds
        .map((id) => skillsById.get(id)?.slug)
        .map((slug) => (slug ? safeSlug(slug) : ""))
        .filter(Boolean)
        .map((slug) => `/skills/${slug}/`);

    const allSkillPaths = Array.from(
      new Set(agent.subagents.flatMap((subagent) => skillPaths(subagent))),
    );

    const subagents: SubAgent[] = agent.subagents.map((subagent, index) => ({
      name: subagent.name,
      description: subagent.description || subagent.name,
      systemPrompt: subagentSystemPrompt(agent, subagent),
      skills: skillPaths(subagent),
      model: models.forSubagent(subagent, index),
    }));

    const graph = createDeepAgent({
      model: models.parent,
      systemPrompt: parentSystemPrompt(agent),
      backend,
      middleware: [todoListMiddleware()],
      skills: allSkillPaths,
      subagents,
    });

    const stream = await graph.stream(
      {
        messages: [
          {
            role: "user",
            content: run.task,
          },
        ],
      },
      { streamMode: "updates", subgraphs: true, recursionLimit: 80 },
    );

    let chunkCount = 0;
    for await (const rawChunk of stream) {
      chunkCount += 1;
      if (process.env.DEBUG_ORCH) {
        console.log(
          `[orch] chunk ${chunkCount} ${JSON.stringify(rawChunk).slice(0, 240)}`,
        );
      }
      const chunk = chunkNamespace(rawChunk);
      if (!chunk) continue;
      const { namespace, update } = chunk;
      const nodeValues = Object.values(update).filter(
        (value): value is Record<string, unknown> => Boolean(value) && typeof value === "object",
      );

      if (namespace.length === 0) {
        for (const node of nodeValues) {
          if (Array.isArray(node.todos)) {
            setPlan(normalizeTodos(node.todos));
          }
          const messages = Array.isArray(node.messages) ? (node.messages as unknown[]) : [];
          for (const message of messages) {
            const type = messageType(message);
            if (type === "ai") {
              handleParentToolCalls(message);
              if (messageToolCalls(message).length === 0) {
                const text = messageText(message).trim();
                if (text && text !== finalAnswer) {
                  finalAnswer = text;
                  send({ type: "final_answer", answer: text });
                }
              }
            } else if (type === "tool") {
              handleParentToolResult(message);
            }
          }
        }
      } else {
        for (const node of nodeValues) {
          const messages = Array.isArray(node.messages) ? (node.messages as unknown[]) : [];
          if (messages.length === 0 && !Array.isArray(node.skillsMetadata)) continue;
          handleSubagentUpdate(namespace, node, messages);
        }
      }
    }

    if (process.env.DEBUG_ORCH) {
      console.log(
        `[orch] stream finished after ${chunkCount} chunks; invocations=${taskInvocations.size}; final=${Boolean(finalAnswer)}`,
      );
    }

    const now = new Date().toISOString();
    for (const lane of run.delegations) {
      if (lane.status === "queued") {
        lane.status = "skipped";
        lane.activity.push("本次任务未被主智能体调用");
      } else if (lane.status === "running") {
        lane.status = "failed";
        lane.finishedAt = now;
        lane.activity.push("运行结束但未收到结果");
      }
    }

    const artifacts = await collectArtifacts(run.id);
    run.status = "completed";
    run.finishedAt = now;
    run.durationMs = Math.max(0, Date.parse(now) - startedMs);
    run.finalAnswer =
      finalAnswer?.trim() ||
      "主智能体已完成执行，但没有返回最终文本。请检查模型输出或运行日志。";
    run.artifacts = artifacts.map(({ name, size }): ArtifactRef => ({ name, size }));
    await saveRun(run);
    await pruneWorkspaces();
    send({ type: "run_completed", run: structuredClone(run), artifacts });
    return run;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const now = new Date().toISOString();
    for (const lane of run.delegations) {
      if (lane.status === "running" || lane.status === "queued") {
        lane.status = "failed";
        lane.finishedAt = now;
        lane.activity.push("运行中断");
      }
    }
    run.status = "failed";
    run.error = message;
    run.finishedAt = now;
    run.durationMs = Math.max(0, Date.parse(now) - startedMs);
    await saveRun(run).catch(() => undefined);
    send({ type: "run_failed", run: structuredClone(run), message });
    console.error(`[run ${run.id}] failed: ${message}`);
    return run;
  }
}
