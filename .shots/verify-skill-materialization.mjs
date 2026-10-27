import { readdirSync } from "node:fs";

const API = "http://127.0.0.1:8689";

async function api(pathname, token, init = {}) {
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init.headers },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${pathname} failed: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

const token = (await api("/api/auth/login", null, {
  method: "POST",
  body: JSON.stringify({ username: "admin", password: "admin123" }),
})).token;

await api("/api/settings", token, {
  method: "PUT",
  body: JSON.stringify({ mode: "demo", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" }),
});
console.log("已切到 demo 模式（apiKey 不动）");

let runId = "";
const res = await fetch(`${API}/api/agents/agent-sample-oss-research/run`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ task: "调研 github.com 的公开注册信息与子域名暴露面，输出带来源的简报。" }),
});
if (!res.ok) throw new Error(`run failed: ${res.status} ${await res.text()}`);

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (event.type === "run_started") runId = event.run.id;
    if (event.type === "delegation") console.log(`分派：${event.delegation.subagent}`);
    if (event.type === "run_failed") throw new Error(`run failed: ${event.message}`);
  }
}

const dirs = readdirSync(`data/workspaces/${runId}/skills`).sort();
console.log(`\n工作区 ${runId} 落盘技能目录（${dirs.length} 个）：`);
console.log("  " + dirs.join(", "));
const scripts = readdirSync(`data/workspaces/${runId}/skills/google-search/scripts`).sort();
console.log(`\ngoogle-search 脚本：${scripts.join(", ")}`);
const osint = readdirSync(`data/workspaces/${runId}/skills/osint-search/scripts`).sort();
console.log(`osint-search 脚本：${osint.join(", ")}`);
const web = readdirSync(`data/workspaces/${runId}/skills/web-search/scripts`).sort();
console.log(`web-search 脚本：${web.join(", ")}`);

await api("/api/settings", token, {
  method: "PUT",
  body: JSON.stringify({ mode: "openai", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" }),
});
const boot = await api("/api/bootstrap", token);
console.log(`\n已恢复：mode=${boot.settings.mode} model=${boot.settings.model} hasApiKey=${boot.settings.hasApiKey}`);
console.log("DONE");
