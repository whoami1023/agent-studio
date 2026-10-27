import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { ChatResult } from "@langchain/core/outputs";
import type {
  MainAgent,
  ScriptRunResult,
  Skill,
  SubAgentConfig,
  TodoItem,
} from "../shared/types.js";
import { runScriptInDir, withSkillTempDir } from "./scriptRunner.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const short = (text: string, max = 48) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

const excerpt = (text: string, max = 1600) =>
  text.length > max ? `${text.slice(0, max)}…（输出已截断）` : text;

async function runSkillScripts(skills: Skill[]): Promise<ScriptRunResult[]> {
  const results: ScriptRunResult[] = [];
  const maxScripts = 3;
  for (const skill of skills) {
    for (const script of skill.scripts ?? []) {
      if (results.length >= maxScripts) return results;
      try {
        results.push(
          await withSkillTempDir(skill, (dir) =>
            runScriptInDir(script, dir, { timeoutMs: 20_000, maxOutputBytes: 32 * 1024 }),
          ),
        );
      } catch (error) {
        results.push({
          path: script.path,
          exitCode: -1,
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
          durationMs: 0,
          timedOut: false,
        });
      }
    }
  }
  return results;
}

function scriptResultsSection(results: ScriptRunResult[], skillNames: string[]): string {
  if (results.length === 0) return "";
  const blocks = results.map((result) => {
    const status =
      result.timedOut
        ? "超时中止"
        : result.exitCode === 0
          ? `退出码 0`
          : `退出码 ${result.exitCode}`;
    const output = (result.stdout || result.stderr).trim();
    return [
      `### \`${result.path}\``,
      ``,
      `> 运行状态：${status} · 耗时 ${result.durationMs}ms`,
      ``,
      output ? "```text" : "",
      output ? excerpt(output) : "（无输出）",
      output ? "```" : "",
    ].join("\n");
  });
  return [
    `## 脚本执行结果（演示模式实跑）`,
    ``,
    `演示模式实际执行了技能（${skillNames.join("、")}）附带的 ${results.length} 个脚本，输出如下，可直接作为交付依据。`,
    ``,
    ...blocks,
  ].join("\n");
}

const firstLine = (text: string) =>
  text
    .split("\n")
    .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
    .find((line) => line.length > 8) ?? text.trim();

const bulletLines = (text: string, count = 2) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .slice(0, count)
    .map((line) => line.replace(/^[-*]\s+/, ""));

function callId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

interface SubagentTask {
  subagent: SubAgentConfig;
  artifactSlug: string;
}

export interface DemoModelOptions {
  kind: "parent" | "subagent";
  agent: MainAgent;
  skillsById: Map<string, Skill>;
  subagent?: SubAgentConfig;
  artifactSlug?: string;
  latencyScale?: number;
}

function agentTasks(agent: MainAgent): SubagentTask[] {
  return agent.subagents.map((subagent, index) => ({
    subagent,
    artifactSlug: `sub-${index + 1}`,
  }));
}
async function subagentDeliverable(
  task: string,
  subagent: SubAgentConfig,
  skills: Skill[],
): Promise<string> {
  const skillNames = skills.map((skill) => skill.name);
  const guidance = skills.flatMap((skill) => {
    const bullets = bulletLines(skill.instructions, 2);
    return bullets.length > 0
      ? bullets.map((line) => `**${skill.name}**：${line}`)
      : [`**${skill.name}**：${firstLine(skill.instructions)}`];
  });
  const scriptResults = await runSkillScripts(skills);
  const scriptSection = scriptResultsSection(
    scriptResults,
    skills.filter((skill) => (skill.scripts ?? []).length > 0).map((skill) => skill.name),
  );

  const findings = [
    `任务目标是「${short(task, 72)}」，本角色聚焦于${subagent.description.replace(/[。.]$/, "")}。`,
    ...(guidance.length > 0
      ? guidance
      : ["从通用分析视角梳理了背景、约束与可执行路径。"]),
  ];

  const recommendations = [
    `先确认与「${subagent.name}」职责直接相关的验收标准，再锁定交付范围。`,
    skills.length > 0
      ? `按 ${skillNames.join("、")} 的方法执行，并在每个阶段留下可复核的结论。`
      : "将结论拆成可验证的假设，逐条给出证据与下一步动作。",
    "把关键产出沉淀为文档，便于主智能体汇总与后续复盘。",
  ];

  return [
    `## 结论摘要`,
    ``,
    `围绕「${short(task, 90)}」，${subagent.name}从${skillNames.length > 0 ? skillNames.join("、") : "通用分析"}视角完成了本次子任务，结论可直接进入主智能体的汇总阶段。`,
    ``,
    `## 关键发现`,
    ``,
    ...findings.map((line, index) => `${index + 1}. ${line}`),
    ``,
    `## 交付建议`,
    ``,
    ...recommendations.map((line) => `- ${line}`),
    ``,
    ...(scriptSection ? [scriptSection, ""] : []),
    `## 风险与待确认`,
    ``,
    `- 以上结论基于任务描述与现有技能约束推导，演示模式未接入外部数据源；真实执行时应补充一手资料。`,
    `- 若目标或范围发生变化，请优先更新验收标准，再调整执行路径。`,
  ].join("\n");
}

function finalAnswer(
  agent: MainAgent,
  task: string,
  results: string[],
  skillsById: Map<string, Skill>,
): string {
  const sections = agent.subagents.map((subagent, index) => {
    const result = results[index]?.trim() || "该子智能体未返回内容。";
    return `### ${index + 1}. ${subagent.name}\n\n${result}`;
  });

  const skillNames = Array.from(
    new Set(
      agent.subagents.flatMap((subagent) =>
        subagent.skillIds
          .map((id) => skillsById.get(id)?.name)
          .filter((name): name is string => Boolean(name)),
      ),
    ),
  );

  return [
    `# 最终交付 · ${agent.name}`,
    ``,
    `> ${task}`,
    ``,
    `## 执行摘要`,
    ``,
    `主智能体将任务拆解为 ${agent.subagents.length} 个并行子任务，分别交由 ${agent.subagents
      .map((item) => item.name)
      .join("、")} 执行。全部子智能体均已返回结果，汇总如下。`,
    ``,
    `## 分角色产出`,
    ``,
    ...sections,
    ``,
    `## 综合结论`,
    ``,
    `1. **目标已闭环**：各子智能体的产出覆盖了任务要求的分析、建议与风险三个层面。`,
    `2. **能力组合**：本次执行综合运用了 ${skillNames.length > 0 ? skillNames.join("、") : "通用分析与写作"} 等技能，形成互补视角。`,
    `3. **可执行性**：建议先确认验收标准与优先级，再按角色分工推进落地。`,
    ``,
    `## 建议的下一步`,
    ``,
    `- 将上述建议拆成带负责人和截止时间的行动项。`,
    `- 对高风险假设安排一次专项验证，并回收结果更新方案。`,
    `- 把本次产出归档为基线版本，后续迭代在此基础上对比。`,
    ``,
    `---`,
    ``,
    `*本报告由 Agent Studio 演示模式生成，用于验证“拆解 → 分派 → 汇总”的完整编排链路。接入真实模型后，内容将由所选模型生成。*`,
  ].join("\n");
}

export class DemoChatModel extends BaseChatModel {
  private readonly options: DemoModelOptions;
  private cachedDeliverable?: string;
  private startedAt = Date.now();

  constructor(options: DemoModelOptions) {
    super({});
    this.options = options;
  }

  _llmType(): string {
    return "agent-studio-demo";
  }

  bindTools(): this {
    return this;
  }

  private latency(ms: number): Promise<void> {
    return sleep(Math.round(ms * (this.options.latencyScale ?? 1)));
  }

  private taskText(messages: BaseMessage[]): string {
    const human = [...messages].reverse().find((message) => message.getType() === "human");
    if (!human) return "";
    if (typeof human.content === "string") return human.content;
    return human.content
      .map((block) =>
        typeof block === "string"
          ? block
          : "text" in block && typeof block.text === "string"
            ? block.text
            : "",
      )
      .join("\n");
  }

  async _generate(
    messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    if (this.options.kind === "subagent") {
      return this.generateSubagent(messages);
    }
    return this.generateParent(messages);
  }

  private async generateParent(messages: BaseMessage[]): Promise<ChatResult> {
    const { agent } = this.options;
    const task = this.taskText(messages);
    const aiMessages = messages.filter((message) => message.getType() === "ai");
    const todoCalls = aiMessages.flatMap((message) =>
      "tool_calls" in message && Array.isArray(message.tool_calls)
        ? message.tool_calls.filter((call) => call.name === "write_todos")
        : [],
    );
    const taskCalls = aiMessages.flatMap((message) =>
      "tool_calls" in message && Array.isArray(message.tool_calls)
        ? message.tool_calls.filter((call) => call.name === "task")
        : [],
    );

    if (todoCalls.length === 0) {
      await this.latency(420 + (Date.now() - this.startedAt) % 120);
      const names = agent.subagents.map((item) => item.name).join("、");
      const todos: TodoItem[] = [
        {
          content: `拆解任务并明确交付标准：${short(task, 36)}`,
          status: "completed",
        },
        ...(agent.subagents.length > 0
          ? [
              {
                content: `并行分派 ${agent.subagents.length} 个子智能体${names ? `（${names}）` : ""}`,
                status: "in_progress" as const,
              },
              {
                content: "汇总子智能体产出并形成最终交付",
                status: "pending" as const,
              },
            ]
          : [
              {
                content: "独立完成分析与交付",
                status: "in_progress" as const,
              },
            ]),
      ];
      const message = new AIMessage({
        content: `我已理解任务，先制定执行计划，随后${agent.subagents.length > 0 ? "把子任务并行分派给子智能体" : "独立完成交付"}。`,
        tool_calls: [
          {
            id: callId("plan"),
            name: "write_todos",
            args: { todos },
          },
        ],
      });
      return { generations: [{ text: message.text, message }] };
    }

    if (taskCalls.length === 0 && agent.subagents.length > 0) {
      await this.latency(620 + (Date.now() - this.startedAt) % 160);
      const tasks = agentTasks(agent);
      const message = new AIMessage({
        content: `计划已就绪。现在把 ${tasks.length} 个子任务并行分派给对应子智能体。`,
        tool_calls: tasks.map(({ subagent, artifactSlug }) => ({
          id: callId("task"),
          name: "task",
          args: {
            subagent_type: subagent.name,
            description: [
              `总任务：${task}`,
              "",
              `你的角色：${subagent.name}`,
              `职责说明：${subagent.description}`,
              "",
              "请完成该角色对应的部分，并以 Markdown 输出：结论摘要、关键发现、交付建议、风险与待确认。",
              `如果产出适合作为文件，请写入 /artifacts/${artifactSlug}.md。`,
            ].join("\n"),
          },
        })),
      });
      return { generations: [{ text: message.text, message }] };
    }

    if (todoCalls.length === 1) {
      await this.latency(340);
      const names = agent.subagents.map((item) => item.name).join("、");
      const todos: TodoItem[] = [
        {
          content: `拆解任务并明确交付标准：${short(task, 36)}`,
          status: "completed",
        },
        ...(agent.subagents.length > 0
          ? [
              {
                content: `并行分派 ${agent.subagents.length} 个子智能体${names ? `（${names}）` : ""}`,
                status: "completed" as const,
              },
              {
                content: "汇总子智能体产出并形成最终交付",
                status: "in_progress" as const,
              },
            ]
          : [
              {
                content: "独立完成分析与交付",
                status: "completed" as const,
              },
            ]),
      ];
      const message = new AIMessage({
        content: "子智能体已全部返回，更新计划并开始汇总。",
        tool_calls: [
          {
            id: callId("plan"),
            name: "write_todos",
            args: { todos },
          },
        ],
      });
      return { generations: [{ text: message.text, message }] };
    }

    if (todoCalls.length === 2) {
      await this.latency(280);
      const names = agent.subagents.map((item) => item.name).join("、");
      const todos: TodoItem[] = [
        {
          content: `拆解任务并明确交付标准：${short(task, 36)}`,
          status: "completed",
        },
        ...(agent.subagents.length > 0
          ? [
              {
                content: `并行分派 ${agent.subagents.length} 个子智能体${names ? `（${names}）` : ""}`,
                status: "completed" as const,
              },
              {
                content: "汇总子智能体产出并形成最终交付",
                status: "completed" as const,
              },
            ]
          : [
              {
                content: "独立完成分析与交付",
                status: "completed" as const,
              },
            ]),
      ];
      const message = new AIMessage({
        content: "全部步骤已完成，正在生成最终交付。",
        tool_calls: [
          {
            id: callId("plan"),
            name: "write_todos",
            args: { todos },
          },
        ],
      });
      return { generations: [{ text: message.text, message }] };
    }

    await this.latency(700);
    const taskCallIds = new Set(taskCalls.map((call) => call.id));
    const resultByCallId = new Map<string, string>();
    for (const message of messages) {
      if (
        message.getType() !== "tool" ||
        !("tool_call_id" in message) ||
        typeof message.tool_call_id !== "string" ||
        !taskCallIds.has(message.tool_call_id)
      ) {
        continue;
      }
      const text =
        typeof message.content === "string"
          ? message.content
          : message.content
              .map((block) =>
                typeof block === "string"
                  ? block
                  : "text" in block && typeof block.text === "string"
                    ? block.text
                    : "",
              )
              .join("\n");
      resultByCallId.set(message.tool_call_id, text);
    }
    const results = agent.subagents.map((subagent) => {
      const call = taskCalls.find(
        (item) => item.args?.subagent_type === subagent.name,
      );
      return call ? (resultByCallId.get(call.id) ?? "") : "";
    });

    const answer =
      agent.subagents.length > 0
        ? finalAnswer(agent, task, results, this.options.skillsById)
        : [
            `# 最终交付 · ${agent.name}`,
            "",
            `> ${task}`,
            "",
            "## 分析与建议",
            "",
            "当前智能体没有配置子智能体，因此由主智能体独立完成任务。建议补充至少一个子智能体，以体验并行拆解与汇总。",
            "",
            "## 下一步",
            "",
            "- 在编排页面添加子智能体，并为其绑定技能。",
            "- 再次发起任务，观察主智能体的拆解、分派与汇总过程。",
            "",
            "---",
            "",
            "*本报告由 Agent Studio 演示模式生成。*",
          ].join("\n");

    const message = new AIMessage({ content: answer });
    return { generations: [{ text: answer, message }] };
  }

  private async generateSubagent(messages: BaseMessage[]): Promise<ChatResult> {
    const { agent, subagent, skillsById } = this.options;
    if (!subagent) throw new Error("Demo subagent context missing");
    const task = this.taskText(messages);
    const skills = subagent.skillIds
      .map((id) => skillsById.get(id))
      .filter((skill): skill is Skill => Boolean(skill));
    const brief =
      task
        .split("\n")
        .find((line) => line.startsWith("总任务："))
        ?.slice("总任务：".length)
        .trim() || task;

    if (!this.cachedDeliverable) {
      this.cachedDeliverable = await subagentDeliverable(brief, subagent, skills);
    }

    const aiMessages = messages.filter((message) => message.getType() === "ai");
    if (aiMessages.length === 0) {
      await this.latency(760 + (Date.now() - this.startedAt) % 260);
      const artifactSlug = this.options.artifactSlug ?? "artifact";
      const skillLabel =
        skills.length > 0
          ? skills
              .map((skill) =>
                (skill.scripts ?? []).length > 0
                  ? `${skill.name}（含 ${skill.scripts.length} 个脚本）`
                  : skill.name,
              )
              .join("、")
          : "通用能力";
      const header = [
        `# ${subagent.name} · 子任务交付`,
        "",
        `> ${short(brief.replace(/\n/g, " "), 160)}`,
        "",
        `**职责**：${subagent.description}`,
        `**技能**：${skillLabel}`,
        "",
        "---",
        "",
      ].join("\n");
      const message = new AIMessage({
        content: `正在完成 ${subagent.name} 的分析，并沉淀交付物。`,
        tool_calls: [
          {
            id: callId("write"),
            name: "write_file",
            args: {
              file_path: `/artifacts/${artifactSlug}.md`,
              content: `${header}${this.cachedDeliverable}\n`,
            },
          },
        ],
      });
      return { generations: [{ text: message.text, message }] };
    }

    await this.latency(520 + (Date.now() - this.startedAt) % 220);
    const message = new AIMessage({
      content: `已完成《${subagent.name}》的工作，交付物已写入工作区。\n\n${this.cachedDeliverable}`,
    });
    return { generations: [{ text: message.text, message }] };
  }
}
