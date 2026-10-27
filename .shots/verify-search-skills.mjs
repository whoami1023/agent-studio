const API = "http://127.0.0.1:8689";

async function login() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  return (await res.json()).token;
}

const token = await login();
const auth = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

const boot = await fetch(`${API}/api/bootstrap`, { headers: { Authorization: `Bearer ${token}` } });
const bootPayload = await boot.json();
console.log(`模式：${bootPayload.settings.mode} 模型：${bootPayload.settings.model} hasApiKey=${bootPayload.settings.hasApiKey}`);

const task = [
  "调研域名 github.com 的公开技术痕迹，必须真实执行技能脚本，不要凭记忆作答：",
  "1) 用「开源情报检索」的 dns_record.py 查询 NS 与 MX 记录；",
  "2) 用 rdap_domain.py 查询该域名的注册时间与到期时间；",
  "3) 用 subdomain_probe.py 探测 api、docs、blog、gist、status 五个前缀；",
  "4) 把三条脚本的实际输出整理成一份简报写入交付物，每条结论注明来自哪个脚本与接口。",
].join("\n");

const res = await fetch(`${API}/api/agents/agent-sample-oss-research/run`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ task }),
});
if (!res.ok) throw new Error(`run failed: ${res.status} ${await res.text()}`);

let runId = "";
let finalAnswer = "";
const activities = [];
const errors = [];
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
    else if (event.type === "final_answer") finalAnswer = event.answer ?? "";
    else if (event.type === "delegation_activity") activities.push(`${event.line}`);
    else if (event.type === "run_failed") errors.push(event.message);
    else if (event.type === "delegation") {
      console.log(`分派：${event.delegation.subagent} -> ${event.delegation.status}`);
    }
  }
}

console.log(`\n运行 ${runId} 完成，事件中的执行命令如下：`);
for (const activity of activities) {
  if (activity.startsWith("执行命令") || activity.startsWith("加载技能")) console.log(`  ${activity}`);
}
if (errors.length) console.log(`错误：${errors.join("; ")}`);

const detailRes = await fetch(`${API}/api/runs/${runId}`, { headers: { Authorization: `Bearer ${token}` } });
const detail = await detailRes.json();
console.log(`\n状态=${detail.run?.status ?? detail.status} 耗时=${detail.run?.durationMs ?? detail.durationMs}ms`);
for (const delegation of detail.run?.delegations ?? detail.delegations ?? []) {
  console.log(`  ${delegation.subagent}: ${delegation.status}`);
}
const answer = finalAnswer || detail.run?.finalAnswer || detail.finalAnswer || "";
console.log(`\n最终回答（前 900 字）：\n${answer.slice(0, 900)}`);
const markers = ["MarkMonitor", "2007", "nsone", "api.github.com", "到期"];
console.log(`\n事实校验（回答中出现的关键片段）：${markers.map((m) => `${m}=${answer.includes(m)}`).join("  ")}`);

console.log("\n工作区落盘的技能文件：");
console.log(`  路径 data/workspaces/${runId}/skills`);
