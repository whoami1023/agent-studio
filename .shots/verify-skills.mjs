import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const CDP_PORT = 9225;
const SHOTS = new URL("./", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ZIP_PATH = path.join(os.tmpdir(), "test-skill.zip");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const zipBase64 = readFileSync(ZIP_PATH).toString("base64");

const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${CDP_PORT}`,
  "--user-data-dir=C:/Users/anony/AppData/Local/Temp/as-ui-verify-5",
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
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
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

function skillRowExpr(name) {
  return `[...document.querySelectorAll(".skill-row")].find(r => r.querySelector(".skill-name")?.textContent.trim() === ${JSON.stringify(name)})`;
}

await send("Page.enable");
await send("Page.navigate", { url: "http://localhost:5273/skills" });
await waitFor(`document.querySelector(".login-card") !== null`);
await evaluate(fillInput('.login-card input:not([type="password"])', "admin"));
await evaluate(fillInput('input[type="password"]', "admin123"));
await evaluate(`document.querySelector(".login-submit").click()`);
await waitFor(`document.querySelector(".skills-page") !== null`);
await sleep(600);

// 1. toolbar shows 导入技能 button
const importBtn = await evaluate(
  `[...document.querySelectorAll(".toolbar-actions button")].map(b => b.textContent.trim()).join(" | ")`
);
console.log("toolbar buttons:", importBtn);
await shot("13-skills-toolbar.png");

// 2. drive zip import through the hidden file input
await evaluate(`(() => {
  const input = document.querySelector('.toolbar-actions input[type="file"]');
  const bytes = Uint8Array.from(atob(${JSON.stringify(zipBase64)}), c => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], "report-generator.zip", { type: "application/zip" }));
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()`);
const imported = await waitFor(`${skillRowExpr("报告生成器")} !== undefined`, 20000);
console.log("imported skill row visible:", imported);
if (!imported) throw new Error("import failed in UI");
await sleep(400);
const badge = await evaluate(`${skillRowExpr("报告生成器")}.querySelector(".tag-script")?.textContent.trim()`);
console.log("script badge:", badge);
const skillName = await evaluate(`${skillRowExpr("报告生成器")}.querySelector(".skill-slug")?.textContent.trim()`);
console.log("slug:", skillName);
await shot("14-skill-imported.png");

// 3. expand row, check scripts strip chips
await evaluate(`${skillRowExpr("报告生成器")}.querySelector('button[aria-expanded]').click()`);
await waitFor(`${skillRowExpr("报告生成器")}.querySelector(".skill-scripts-strip") !== null`);
const chips = await evaluate(
  `[...(${skillRowExpr("报告生成器")}.querySelectorAll(".skill-scripts-strip .skill-script-chip"))].map(c => c.textContent.trim()).join(" | ")`
);
console.log("script chips:", chips);
await shot("15-skill-expanded.png");

// 4. open edit dialog, run analyze.py
await evaluate(`${skillRowExpr("报告生成器")}.querySelector('button[aria-label^="编辑"]').click()`);
await waitFor(`document.querySelector(".modal-panel") !== null`);
const scriptItems = await evaluate(
  `[...document.querySelectorAll(".script-list .script-item-path")].map(e => e.textContent.trim()).join(" | ")`
);
console.log("dialog script items:", scriptItems);
await shot("16-skill-edit-dialog.png");
await evaluate(`document.querySelector('button[aria-label="运行 scripts/analyze.py"]').click()`);
const ran = await waitFor(`document.querySelector(".script-run-output") !== null`, 30000);
console.log("script output panel:", ran);
const output = await evaluate(`document.querySelector(".script-run-body")?.textContent.trim()`);
console.log("run output:", JSON.stringify(output));
const runHead = await evaluate(`document.querySelector(".script-run-head")?.textContent.trim()`);
console.log("run head:", runHead);
await shot("17-skill-run-script.png");

// 5. close dialog, delete the imported skill
await evaluate(`[...document.querySelectorAll(".modal-foot-actions button")].find(b => b.textContent.includes("取消"))?.click()`);
await waitFor(`document.querySelector(".modal-panel") === null`);
await evaluate(`${skillRowExpr("报告生成器")}.querySelector('button[aria-label^="删除"]').click()`);
await waitFor(`document.querySelector(".confirm-message") !== null`);
await shot("18-skill-delete-confirm.png");
await evaluate(`document.querySelector(".modal-foot .btn-danger").click()`);
const deleted = await waitFor(`${skillRowExpr("报告生成器")} === undefined`, 10000);
console.log("skill deleted via UI:", deleted);
await sleep(400);
const countAfter = await evaluate(`document.querySelectorAll(".skill-row").length`);
console.log("skill rows after cleanup:", countAfter);
await shot("19-skills-final.png");

ws.close();
chrome.kill();
console.log("DONE");
process.exit(0);
