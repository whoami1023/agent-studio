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

async function putSettings(token, body) {
  const res = await fetch(`${API}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`settings failed: ${res.status} ${await res.text()}`);
}

const token = await login();

console.log("1) switch settings to demo mode (apiKey untouched)");
await putSettings(token, {
  mode: "demo",
  baseUrl: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
});

console.log("2) run agent-sample-code-review (demo)");
const res = await fetch(`${API}/api/agents/agent-sample-code-review/run`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    task:
      "审查一段支付回调处理代码：重点关注异常处理、边界条件与安全校验，按阻断 / 建议 / 提示分级输出审查意见。",
  }),
});
if (!res.ok) throw new Error(`run failed: ${res.status} ${await res.text()}`);

let runId = "";
let finalAnswer = "";
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
    else if (event.type === "final_answer") finalAnswer = event.answer;
    else if (event.run?.status === "failed" || event.type === "run_failed") {
      throw new Error(`run failed: ${JSON.stringify(event).slice(0, 300)}`);
    } else {
      console.log(`   event: ${event.type}`);
    }
  }
}

console.log("3) fetch run detail");
const detailRes = await fetch(`${API}/api/runs/${runId}`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!detailRes.ok) throw new Error(`detail failed: ${detailRes.status}`);
const detail = await detailRes.json();
console.log(
  `   status=${detail.status} durationMs=${detail.durationMs}`,
);
for (const delegation of detail.delegations) {
  console.log(`   delegation ${delegation.subagent}: ${delegation.status}`);
}
console.log(`   answer head: ${finalAnswer.slice(0, 140).replace(/\s+/g, " ")}`);

console.log("4) restore openai settings");
await putSettings(token, {
  mode: "openai",
  baseUrl: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
});
const boot = await fetch(`${API}/api/bootstrap`, {
  headers: { Authorization: `Bearer ${token}` },
});
const payload = await boot.json();
console.log(
  `   settings: mode=${payload.settings.mode} model=${payload.settings.model} hasApiKey=${payload.settings.hasApiKey}`,
);

console.log("OK");
