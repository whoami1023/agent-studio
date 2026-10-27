import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CDP_PORT = 9225;
const SHOTS = new URL("./", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${CDP_PORT}`,
  "--user-data-dir=C:/Users/anony/AppData/Local/Temp/as-ui-verify-6",
  "--window-size=1440,900",
  "--no-first-run",
  "about:blank",
], { stdio: "ignore" });

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const pages = await res.json();
      const page = pages.find((p) => p.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(300);
  }
  throw new Error("CDP not available");
}

const ws = new WebSocket(await getWsUrl());
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let msgId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const res = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.result?.exceptionDetails) {
    return { __error: res.result.exceptionDetails.text };
  }
  return res.result?.result?.value;
}

async function waitFor(expression, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return true;
    await sleep(250);
  }
  return false;
}

function fillInput(selector, value) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return "no-el";
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return el.value;
  })()`;
}

async function shot(name) {
  const res = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SHOTS}${name}`, Buffer.from(res.result.data, "base64"));
  console.log("shot:", name);
}

await send("Page.enable");
await send("Page.navigate", { url: "http://localhost:5173/" });
await waitFor(`document.querySelector(".login-card") !== null`);
await evaluate(fillInput('.login-card input:not([type="password"])', "admin"));
await evaluate(fillInput('input[type="password"]', "admin123"));
await evaluate(`document.querySelector(".login-submit").click()`);
await waitFor(`document.querySelector(".dashboard-page") !== null`);
await sleep(600);

// 1. open create modal
await evaluate(`document.querySelector(".agent-card-add").click()`);
await waitFor(`document.querySelector(".modal-panel") !== null`);
await shot("20-create-modal.png");

// 2. fill fields
await evaluate(fillInput('.modal-panel input.input', "增长策略组"));
await evaluate(fillInput('.modal-panel textarea.input', "负责用户增长策略的制定与复盘，需要市场调研、数据分析和方案评审，产出增长报告。"));
await evaluate(fillInput('.modal-panel textarea.input:nth-of-type(2)', ""));
// note: description is the first textarea; system prompt second — fill system prompt too
const taCount = await evaluate(`document.querySelectorAll(".modal-panel textarea").length`);
console.log("textarea count:", taCount);
await shot("21-create-filled.png");

// 3. click 创建并编排
await evaluate(`[...document.querySelectorAll(".modal-foot-actions .btn-primary")].find(b => b.textContent.includes("创建并编排")).click()`);
const editorOk = await waitFor(`document.querySelector(".editor-page") !== null`, 20000);
console.log("editor page reached:", editorOk);
if (!editorOk) throw new Error("editor not reached");
await sleep(600);

const agentName = await evaluate(`document.querySelector(".content-head h1")?.textContent.trim()`);
console.log("agent name:", agentName);
const subNames = await evaluate(
  `[...document.querySelectorAll(".subagent-row h3")].map(e => e.textContent.trim()).join(" | ")`
);
console.log("suggested subagents:", subNames);
const skillChips = await evaluate(
  `[...document.querySelectorAll(".subagent-row .skill-chip")].map(e => e.textContent.trim()).join(" | ")`
);
console.log("skill chips:", skillChips);
await shot("22-editor-suggestions.png");

// 4. delete the test agent to clean up
await evaluate(`document.querySelector('.content-head-actions .icon-btn[aria-label="删除智能体"]').click()`);
await waitFor(`document.querySelector(".confirm-message") !== null`);
await shot("23-delete-confirm.png");
await evaluate(`document.querySelector(".modal-foot .btn-danger").click()`);
const backOk = await waitFor(`document.querySelector(".dashboard-page") !== null`, 10000);
console.log("back at dashboard:", backOk);
await sleep(400);
await shot("24-dashboard-final.png");

ws.close();
chrome.kill();
console.log("DONE");
process.exit(0);
