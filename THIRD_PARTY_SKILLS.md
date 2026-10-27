# 第三方技能来源与许可

Agent Studio 的六个内置技能是下列 MIT 许可开源技能的简体中文改编版。改编保留原方法论与关键检查项，针对中文多智能体运行时做了精简、术语本地化和执行方式调整。每个内置技能的 SKILL.md 开头也标注了来源。

| 内置技能 | slug | 上游项目 | 上游文件 | 许可证 |
| --- | --- | --- | --- | --- |
| 深度研究 | `research` | [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) | `research/deep-research/skills/deep-research/SKILL.md` | MIT |
| 数据分析 | `data-analysis` | [LeoYeAI/openclaw-master-skills](https://github.com/LeoYeAI/openclaw-master-skills) | `skills/data-analysis/SKILL.md` | MIT |
| 方案评审 | `critique` | [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) 打包的 [Matt Pocock — grill-me](https://github.com/mattpocock/skills/tree/main/skills/productivity/grill-me) | `engineering/grill-me/skills/grill-me/SKILL.md` | MIT |
| 技术写作 | `writing` | [rcarmo/piclaw](https://github.com/rcarmo/piclaw) | `skel/.pi/skills/technical-docs/SKILL.md` | MIT |
| 代码审查 | `code-review` | [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills) | `skills/code-reviewer/SKILL.md` | MIT |
| 任务规划 | `planning` | [obra/superpowers](https://github.com/obra/superpowers) | `skills/writing-plans/SKILL.md` | MIT |

## 运行时依赖

搜索类技能（`web-search`、`google-search`、`osint-search`）通过 Python 包 `ddgs` 执行无需密钥的网页搜索。`ddgs` 采用 MIT 许可：[deedy5/ddgs](https://github.com/deedy5/ddgs)。

## 主要修改

- 全文译为简体中文，并按目标应用场景调整术语。
- 移除或替换上游技能依赖的特定目录结构、脚本与会话工具；保留可独立执行的流程与检查清单。
- 方案评审：上游是交互式逐题追问，本版本增加「多智能体无法实时问答时，把问题分为已查证与待用户确认两组」的执行规则。
- 深度研究：增加「当前环境无网络工具时明确标注无法在线核验」的限制，避免编造来源。
- 数据分析：保留决策优先原则、统计严谨性清单、六类分析陷阱与方法选择表。
- 技术写作：把英文文风规则改写为中文写作规则，并替换为中文常见套话清单。
- 代码审查：保留五步流程、OWASP 基线、分级输出模板。
- 任务规划：保留任务右尺寸、步骤粒度、计划头部、自检与交付流程。

## MIT License

Copyright (c) 2025 Alireza Rezvani
Copyright (c) 2026 MyClaw.ai (LeoYeAI)
Copyright (c) 2026 Matt Pocock
Copyright (c) 2026 Rui Carmo
Copyright (c) 2025
Copyright (c) 2025 Jesse Vincent
Copyright (c) 2022 deedy5

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
