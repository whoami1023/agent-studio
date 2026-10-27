# Agent Studio

基于 [deepagents.js](https://github.com/langchain-ai/deepagents) 的多智能体编排控制台：用可视化的方式搭建一个「主智能体 + 子智能体编队」的协作架构，让主智能体在任务到来时通过 task 工具把工作并行分派给持有不同技能的子智能体。

## 功能特性

- **多账户与管理员**：内置账户体系，管理员可创建用户、重置密码、开关账户；首次启动自动播种默认管理员（`admin` / `admin123`），无需任何 API Key 即可开箱体验。
- **内置示例编队**：开箱自带「产品发布策划组」「开源调研组」「代码审查组」等示例主智能体，展示不同场景的编队方式，可直接运行、复制改造或删除。
- **推荐子智能体编队**：新建主智能体时，根据名称、描述与系统提示词自动推荐子智能体角色（接入模型时为模型生成，demo 模式为内置模板），创建后可逐个修改。
- **子智能体编排**：为每个子智能体配置职责描述、系统提示词与技能绑定，技能以 `SKILL.md` 注入对应子智能体的工作区。
- **技能库**：内置常用技能；支持 ZIP 导入自定义技能（解析 frontmatter、自动推导标识、同名标识自动加后缀）；绑定 Python / Node 等脚本的技能可在运行中执行脚本并回传产物。
- **运行记录与实时链路**：每次运行完整记录任务、分派链路、耗时与产出文件，可回看每一步事件与最终答案。
- **双模式运行**：
  - **demo 模式（默认）**：使用本地确定性模型，无需任何配置即可完整跑通编排流程，适合演示与开发；
  - **OpenAI 兼容模式**：在「设置」中配置 `baseUrl`、`model` 与 `apiKey` 即可接入任意 OpenAI 兼容服务（如 DeepSeek 的 `https://api.deepseek.com/v1` + `deepseek-chat`）。

## 快速开始

需要 Node.js 20+（开发环境使用 Node 24）。

```bash
npm install
npm run dev
```

- Web 界面：<http://localhost:5273>
- API 服务：<http://127.0.0.1:8689>

用默认管理员 `admin` / `admin123` 登录（首次启动自动创建，建议登录后在「管理」中修改密码）。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 同时启动 API（tsx watch）与前端（Vite） |
| `npm run dev:api` | 仅启动 API 服务（`127.0.0.1:8689`） |
| `npm run dev:web` | 仅启动前端（`http://localhost:5273`） |
| `npm run build` | 类型检查 + 构建产物到 `dist/` |
| `npm start` | 以生产模式启动服务（同时托管 API 与 `dist/` 静态文件） |
| `npm run typecheck` | 仅类型检查 |

## 模型配置

在「设置 → 模型」中配置：

- **模式**：`demo`（默认，无需密钥）或 `openai`（OpenAI 兼容接口）。
- **OpenAI 兼容模式**：填写 `baseUrl`、`apiKey` 与 `model`。例如使用 DeepSeek：`baseUrl` 为 `https://api.deepseek.com/v1`，`model` 为 `deepseek-chat`。

配置保存在 `data/` 目录中，仅存于本地。

## 数据存储

所有数据（账户、智能体、技能、运行记录、设置）保存在 `data/` 目录下的 JSON 文件中，该目录已加入 `.gitignore`，不会被提交到仓库。删除该目录即恢复全新初始状态（默认管理员会重新播种）。

## 项目结构

```
agent-studio/
├── server/            # Express API、账户认证、编排器、技能导入与脚本执行
│   ├── index.ts       # API 路由与中间件
│   ├── orchestrator.ts# 主智能体 → 子智能体分派执行（deepagents）
│   ├── demoModel.ts   # demo 模式确定性模型
│   ├── suggestSubagents.ts # 推荐子智能体编队（模型生成 / 内置模板）
│   ├── skillImport.ts # 技能 ZIP 导入与 SKILL.md 解析
│   ├── scriptRunner.ts# 技能脚本执行（Python / Node 等）
│   ├── auth.ts        # 账户认证与管理员能力
│   ├── store.ts       # 数据存储读写
│   └── seed.ts        # 默认账户与内置技能播种
├── shared/            # 前后端共享类型与校验 schema（zod）
├── src/               # React 前端（页面、组件、状态）
├── scripts/           # 依赖探测等工具脚本
└── public/            # 静态资源
```

## 技术栈

React 19 · React Router 7 · Vite · Express 5 · TypeScript · zod · deepagents.js · @langchain/openai
