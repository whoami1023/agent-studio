import type { MainAgent, Skill } from "../shared/types.js";

interface BuiltinSkillSeed {
  slug: string;
  name: string;
  description: string;
  instructions: string;
}

const BUILTIN_SKILLS: BuiltinSkillSeed[] = [
  {
    slug: "research",
    name: "深度研究",
    description: "面向陌生领域快速建立事实基线，形成可追溯的研究结论。",
    instructions: [
      "# 深度研究方法",
      "",
      "- 先界定研究问题、范围与时间盒，列出需要验证的关键假设。",
      "- 将问题拆成背景、现状、关键玩家、数据与趋势五个面，逐面收集证据。",
      "- 每条结论标注来源与可信度（高 / 中 / 低），明确区分事实、推断与观点。",
      "- 遇到相互冲突的信息时保留分歧，并说明哪一方证据更可靠。",
      "- 输出结构：研究摘要、关键事实表、洞察、未解问题、下一步调研建议。",
    ].join("\n"),
  },
  {
    slug: "data-analysis",
    name: "数据分析",
    description: "把业务问题转化为指标与对照，输出可复核的分析结论。",
    instructions: [
      "# 数据分析方法",
      "",
      "- 先写清楚指标口径、时间窗口与对比基准，避免口径漂移。",
      "- 检查数据完整性、异常值与样本偏差，说明数据可信度。",
      "- 至少给出一种横向对比和一种敏感性分析，避免单点结论。",
      "- 区分相关性与因果性，对因果判断给出验证设计。",
      "- 输出结构：指标定义、关键发现、图表建议、决策建议。",
    ].join("\n"),
  },
  {
    slug: "critique",
    name: "方案评审",
    description: "以红队视角识别方案中的隐含假设、风险与替代路径。",
    instructions: [
      "# 方案评审方法",
      "",
      "- 先用一句话复述方案目标，确认评审对象没有跑偏。",
      "- 列出方案依赖的隐含假设，并标注每条假设的验证状态。",
      "- 按「影响 × 概率」给风险排序，区分可缓解与不可逆风险。",
      "- 至少提出一个替代方案，说明取舍与迁移成本。",
      "- 输出结构：评审结论、风险矩阵、替代方案、Go / No-Go 建议、验证清单。",
    ].join("\n"),
  },
  {
    slug: "writing",
    name: "技术写作",
    description: "把复杂分析整理为面向特定读者的清晰文档。",
    instructions: [
      "# 技术写作方法",
      "",
      "- 先确认读者身份与阅读目的，再决定详略与术语密度。",
      "- 使用金字塔结构：结论先行，论据分层展开。",
      "- 每段只表达一个观点，术语前后一致，避免形容词堆砌。",
      "- 用具体例子或数字支撑抽象判断。",
      "- 输出结构：标题、摘要、正文、关键结论、待补充信息。",
    ].join("\n"),
  },
  {
    slug: "code-review",
    name: "代码审查",
    description: "从正确性、安全、性能与可维护性审查代码或技术方案。",
    instructions: [
      "# 代码审查方法",
      "",
      "- 先理解变更意图与影响范围，再逐项审查实现。",
      "- 正确性：检查边界条件、错误处理、并发与状态一致性。",
      "- 安全性：检查注入、越权、敏感信息泄露与依赖风险。",
      "- 性能：定位热点路径、无界增长与重复计算。",
      "- 按「阻断 / 建议 / 提示」分级输出问题与修复方案。",
    ].join("\n"),
  },
  {
    slug: "planning",
    name: "任务规划",
    description: "将模糊目标拆成可执行、可验收的任务网络。",
    instructions: [
      "# 任务规划方法",
      "",
      "- 先用可验证的语言定义「完成」的标准。",
      "- 按依赖关系拆分里程碑，识别关键路径与资源瓶颈。",
      "- 每项任务写清楚负责人、产出物、验收方式与时间盒。",
      "- 为不确定项预留缓冲，并设计早期验证点。",
      "- 输出结构：目标与验收标准、任务表、排期、风险与缓冲。",
    ].join("\n"),
  },
];

export function builtinSkills(now = new Date().toISOString()): Skill[] {
  return BUILTIN_SKILLS.map((skill, index) => ({
    id: `skill-builtin-${skill.slug}`,
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    builtin: true,
    createdAt: now,
    updatedAt: now,
  }));
}

export function sampleAgents(now = new Date().toISOString()): MainAgent[] {
  return [
    {
      id: "agent-sample-launch",
      name: "产品发布策划组",
      description:
        "从市场、数据与风险三个视角，为新产品的发布准备一份可执行的作战方案。",
      systemPrompt:
        "你是产品发布的总策划。先确认发布目标与约束，再协调调研、数据与评审子智能体，最终给出可执行方案。",
      subagents: [
        {
          id: "sub-launch-research",
          name: "市场调研员",
          description:
            "调研目标市场、竞品与用户需求，输出可追溯的市场洞察与机会判断。",
          systemPrompt: "",
          skillIds: ["skill-builtin-research", "skill-builtin-writing"],
        },
        {
          id: "sub-launch-data",
          name: "数据分析师",
          description:
            "建立发布相关的指标口径，评估增长假设、敏感性与数据风险。",
          systemPrompt: "",
          skillIds: ["skill-builtin-data-analysis", "skill-builtin-planning"],
        },
        {
          id: "sub-launch-risk",
          name: "风险评审员",
          description:
            "以红队视角审查发布方案，识别风险、替代路径并给出 Go / No-Go 建议。",
          systemPrompt: "",
          skillIds: ["skill-builtin-critique", "skill-builtin-planning"],
        },
      ],
      createdAt: now,
      updatedAt: now,
      sample: true,
    },
    {
      id: "agent-sample-review",
      name: "技术方案评审组",
      description:
        "对一个技术方案进行架构、安全与表达层面的综合评审，输出决策建议。",
      systemPrompt:
        "你是技术评审的协调者。确保每个子智能体只负责自己的视角，最后合并成一份面向决策者的评审报告。",
      subagents: [
        {
          id: "sub-review-arch",
          name: "架构研究员",
          description:
            "梳理方案的技术背景、备选架构与关键取舍，给出架构层面的判断。",
          systemPrompt: "",
          skillIds: ["skill-builtin-research", "skill-builtin-code-review"],
        },
        {
          id: "sub-review-security",
          name: "安全审查员",
          description:
            "检查方案中的安全边界、权限模型与潜在攻击面，给出修复优先级。",
          systemPrompt: "",
          skillIds: ["skill-builtin-code-review", "skill-builtin-critique"],
        },
        {
          id: "sub-review-docs",
          name: "文档工程师",
          description:
            "把评审结论整理为面向决策者的清晰文档，突出结论、依据与行动项。",
          systemPrompt: "",
          skillIds: ["skill-builtin-writing", "skill-builtin-planning"],
        },
      ],
      createdAt: now,
      updatedAt: now,
      sample: true,
    },
  ];
}
