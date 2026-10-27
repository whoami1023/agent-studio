import { promises as fs } from "node:fs";
import path from "node:path";
import { createDeepAgent, FilesystemBackend } from "deepagents";
import { todoListMiddleware } from "langchain";
import YAML from "yaml";
import { DemoChatModel } from "../server/demoModel.js";
import { builtinSkills, sampleAgents } from "../server/seed.js";

const workspace = path.resolve(".probe/ws");
await fs.rm(workspace, { recursive: true, force: true });
await fs.mkdir(workspace, { recursive: true });

const agent = sampleAgents()[0];
const skills = builtinSkills();
const skillsById = new Map(skills.map((skill) => [skill.id, skill]));

for (const subagent of agent.subagents) {
  for (const skillId of subagent.skillIds) {
    const skill = skillsById.get(skillId);
    if (!skill) continue;
    const dir = path.join(workspace, "skills", skill.slug);
    await fs.mkdir(dir, { recursive: true });
    const frontmatter = YAML.stringify({
      name: skill.slug,
      description: skill.description,
    });
    await fs.writeFile(
      path.join(dir, "SKILL.md"),
      `---\n${frontmatter}---\n\n${skill.instructions}\n`,
      "utf8",
    );
  }
}

const backend = new FilesystemBackend({ rootDir: workspace, virtualMode: true });

const graph = createDeepAgent({
  name: "probe",
  model: new DemoChatModel({ kind: "parent", agent, skillsById, latencyScale: 0.05 }),
  systemPrompt: agent.systemPrompt,
  backend,
  middleware: [todoListMiddleware()],
  subagents: agent.subagents.map((subagent, index) => ({
    name: subagent.name,
    description: subagent.description,
    systemPrompt: subagent.systemPrompt || undefined,
    skills: subagent.skillIds
      .map((id) => skillsById.get(id)?.slug)
      .filter((slug): slug is string => Boolean(slug))
      .map((slug) => `/skills/${slug}/`),
    model: new DemoChatModel({
      kind: "subagent",
      agent,
      skillsById,
      subagent,
      artifactSlug: `sub-${index + 1}`,
      latencyScale: 0.05,
    }),
  })),
});

const stream = await graph.stream(
  {
    messages: [
      {
        role: "user",
        content: "为下季度发布一款面向开发者的 AI 编程助手制定发布方案，重点关注市场定位与风险。",
      },
    ],
  },
  { streamMode: "updates", subgraphs: true },
);

let index = 0;
for await (const chunk of stream) {
  index += 1;
  const [namespace, update] = chunk as [string[], Record<string, unknown>];
  console.log(`\n===== chunk ${index} :: ns=${JSON.stringify(namespace)} =====`);
  console.log("update keys:", Object.keys(update));
  for (const [node, value] of Object.entries(update)) {
    if (!value || typeof value !== "object") {
      console.log(`  ${node}:`, value);
      continue;
    }
    const record = value as Record<string, unknown>;
    console.log(`  ${node} keys:`, Object.keys(record));
    if (Array.isArray(record.messages)) {
      for (const raw of record.messages as Array<Record<string, unknown>>) {
        const type = raw.type ?? raw._getType?.();
        const content =
          typeof raw.content === "string"
            ? raw.content.replace(/\s+/g, " ").slice(0, 120)
            : JSON.stringify(raw.content).slice(0, 160);
        const calls = Array.isArray(raw.tool_calls)
          ? raw.tool_calls.map((call: Record<string, unknown>) => ({
              maybeName: call.name,
              id: call.id,
              subagent: (call.args as Record<string, unknown>)?.subagent_type,
              todos: (call.args as Record<string, unknown>)?.todos,
            }))
          : [];
        const toolCallId = raw.tool_call_id;
        console.log(
          `    [${String(type)}] id=${String(raw.id)}${toolCallId ? ` tool_call_id=${String(toolCallId)}` : ""} calls=${JSON.stringify(calls)} content=${JSON.stringify(content)}`,
        );
      }
    }
    if (Array.isArray(record.todos)) {
      console.log("    todos:", JSON.stringify(record.todos));
    }
    if (Array.isArray(record.skillsMetadata)) {
      console.log(
        "    skillsMetadata:",
        JSON.stringify(
          (record.skillsMetadata as Array<Record<string, unknown>>).map((skill) => ({
            name: skill.name,
            path: skill.path,
          })),
        ),
      );
    }
    if (record.files && typeof record.files === "object") {
      console.log("    files:", Object.keys(record.files as Record<string, unknown>));
    }
  }
}

console.log("\n===== workspace tree =====");
async function walk(dir: string, prefix = ""): Promise<void> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      console.log(`${prefix}${entry.name}/`);
      await walk(path.join(dir, entry.name), `${prefix}  `);
    } else {
      console.log(`${prefix}${entry.name}`);
    }
  }
}
await walk(workspace);

const artifactPath = path.join(workspace, "artifacts", "sub-1.md");
try {
  const artifact = await fs.readFile(artifactPath, "utf8");
  console.log("\n===== artifact sub-1.md (first 500 chars) =====");
  console.log(artifact.slice(0, 500));
} catch {
  console.log("\n(no artifact sub-1.md)");
}
