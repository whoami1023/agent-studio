import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import type {
  Skill,
  SubagentSuggestion,
  SubagentSuggestPayload,
  SubagentSuggestResult,
} from "../shared/types.js";
import type { StoredSettings } from "./store.js";

interface RoleTemplate {
  keywords: string[];
  role: { name: string; description: string; skillSlug: string };
}

const TEMPLATES: RoleTemplate[] = [
  {
    keywords: ["调研", "研究", "市场", "竞品", "行业", "情报"],
    role: {
      name: "行业研究员",
      description: "梳理行业背景与竞品格局，收集并核实关键事实，输出可追溯的研究结论。",
      skillSlug: "research",
    },
  },
  {
    keywords: ["数据", "指标", "分析", "增长", "报表", "实验"],
    role: {
      name: "数据分析师",
      description: "把业务问题转化为指标与对照分析，给出可复核的数据结论与改进建议。",
      skillSlug: "data-analysis",
    },
  },
  {
    keywords: ["评审", "风险", "方案", "复盘", "审查", "红队"],
    role: {
      name: "方案评审员",
      description: "以红队视角识别方案中的隐含假设、风险点与替代路径，提出改进建议。",
      skillSlug: "critique",
    },
  },
  {
    keywords: ["写作", "文案", "报告", "文档", "交付", "汇报"],
    role: {
      name: "技术写作者",
      description: "把复杂分析整理为面向特定读者的清晰文档，保证结构、论据与表达质量。",
      skillSlug: "writing",
    },
  },
  {
    keywords: ["代码", "开发", "实现", "技术", "架构", "程序"],
    role: {
      name: "代码审查员",
      description: "从正确性、安全性、性能与可维护性审查代码或技术方案，给出修改建议。",
      skillSlug: "code-review",
    },
  },
  {
    keywords: ["规划", "计划", "拆解", "排期", "里程碑", "执行"],
    role: {
      name: "任务规划师",
      description: "将模糊目标拆解成可执行、可验收的任务网络，明确依赖与里程碑。",
      skillSlug: "planning",
    },
  },
];

export function demoSubagentSuggestions(
  input: SubagentSuggestPayload,
  skills: Skill[],
): SubagentSuggestion[] {
  const text = `${input.name}\n${input.description}\n${input.systemPrompt ?? ""}`;
  const scored = TEMPLATES.map((template) => ({
    template,
    score: template.keywords.reduce(
      (total, keyword) => total + (text.includes(keyword) ? 1 : 0),
      0,
    ),
  })).sort((a, b) => b.score - a.score);
  const matched = scored.filter((item) => item.score > 0).slice(0, 4);
  const chosen = matched.length >= 2 ? matched : scored.slice(0, 2);
  return chosen.map(({ template }) => {
    const skill = skills.find((item) => item.slug === template.role.skillSlug);
    return {
      name: template.role.name,
      description: template.role.description,
      skillIds: skill ? [skill.id] : [],
    };
  });
}

const SuggestResponseSchema = z.object({
  subagents: z
    .array(
      z.object({
        name: z.string().trim().min(1, "子智能体名称不能为空").max(40),
        description: z.string().trim().min(1, "子智能体描述不能为空").max(400),
        systemPrompt: z.string().max(4000).optional(),
        skillIds: z.array(z.string()).optional(),
      }),
    )
    .min(1)
    .max(8),
});

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function llmText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string") {
        return (block as { text: string }).text;
      }
      return "";
    })
    .join("");
}

export async function suggestSubagents(
  input: SubagentSuggestPayload,
  settings: StoredSettings,
  skills: Skill[],
): Promise<SubagentSuggestResult> {
  const demoResult = demoSubagentSuggestions(input, skills);
  if (settings.mode !== "openai") {
    return { subagents: demoResult, source: "demo" };
  }
  const apiKey = settings.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { subagents: demoResult, source: "demo" };
  }
  try {
    const model = new ChatOpenAI({
      model: settings.model,
      apiKey,
      temperature: 0.3,
      configuration: { baseURL: settings.baseUrl },
    });
    const skillLines = skills
      .slice(0, 20)
      .map((skill) => `- id: ${skill.id} | ${skill.name}：${skill.description}`)
      .join("\n");
    const response = await model.invoke([
      {
        role: "system",
        content: [
          "你是智能体编排顾问。根据主智能体的信息，推荐 2-4 个子智能体组成的编队。",
          "",
          "要求：",
          "1. 各子智能体职责互不重叠，覆盖描述中提到的关键视角。",
          "2. 名称 2-8 个汉字（或 2-20 个字符），职责描述 20-80 字。",
          "3. 仅当技能与角色匹配时绑定，每个角色最多 2 个技能；skillIds 必须来自给定列表的 id。",
          "4. systemPrompt 可留空字符串。",
          "",
          "只输出 JSON，不要输出任何其他文字，格式：",
          '{"subagents":[{"name":"...","description":"...","systemPrompt":"...","skillIds":["..."]}]}',
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `主智能体名称：${input.name}`,
          `描述：${input.description}`,
          `系统提示词：${input.systemPrompt?.trim() || "（无）"}`,
          `可用技能：${skillLines || "（技能库为空）"}`,
        ].join("\n"),
      },
    ]);
    const parsed = extractJson(llmText(response.content));
    const validated = SuggestResponseSchema.safeParse(parsed);
    if (!validated.success) {
      return { subagents: demoResult, source: "demo" };
    }
    const validSkillIds = new Set(skills.map((skill) => skill.id));
    const seen = new Set<string>();
    const subagents: SubagentSuggestion[] = [];
    for (const item of validated.data.subagents) {
      const name = item.name.trim();
      if (seen.has(name)) continue;
      seen.add(name);
      subagents.push({
        name,
        description: item.description.trim(),
        systemPrompt: item.systemPrompt?.trim() || undefined,
        skillIds: (item.skillIds ?? [])
          .filter((id) => validSkillIds.has(id))
          .slice(0, 8),
      });
      if (subagents.length >= 4) break;
    }
    return { subagents, source: "model" };
  } catch (error) {
    console.warn("subagent suggestion via model failed, using templates:", error instanceof Error ? error.message : error);
    return { subagents: demoResult, source: "demo" };
  }
}
