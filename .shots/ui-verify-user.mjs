import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CDP_PORT = 9224;
const SHOTS = new URL("./", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${CDP_PORT}`,
  "--user-data-dir=C:/Users/anony/AppData/Local/Temp/as-ui-verify-3",
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
  return res.result?.result?.value;
}

async function screenshot(name) {
  const res = await send("Page.captureScreenshot", { format: "png" });
  if (res.result?.data) {
    writeFileSync(`${SHOTS}${name}.png`, Buffer.from(res.result.data, "base64"));
    console.log(`shot: ${name}.png`);
  }
}

async function waitFor(expression, timeout = 10000) {
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

// Login as wangwu
await send("Page.enable");
await send("Page.navigate", { url: "http://localhost:5273/" });
await waitFor(`document.querySelector(".login-card") !== null`);
await evaluate(fillInput('.login-card input:not([type="password"])', "wangwu"));
await evaluate(fillInput('input[type="password"]', "ww123456"));
await evaluate(`document.querySelector(".login-submit").click()`);
await waitFor(`document.querySelector(".sidebar-user") !== null`);
await sleep(600);
console.log("wangwu sidebar user:", await evaluate(`document.querySelector(".sidebar-user")?.textContent`));
console.log("has /admin nav:", await evaluate(`[...document.querySelectorAll("a")].some(a=>a.getAttribute("href")==="/admin")`));
await screenshot("10-wangwu-dashboard");

// Direct navigate to /admin should redirect away
await send("Page.navigate", { url: "http://localhost:5273/admin" });
await sleep(800);
const onAdmin = await evaluate(`location.pathname`);
console.log("path after /admin attempt:", onAdmin);

// Settings dialog: no provider config
await evaluate(`[...document.querySelectorAll("button")].find(b=>b.textContent.includes("设置") || b.getAttribute("aria-label")?.includes("设置"))?.click()`);
await sleep(500);
const hasProviderSection = await evaluate(`document.body.textContent.includes("模型通道")`);
console.log("settings shows 模型通道:", hasProviderSection);
const settingsText = await evaluate(`document.querySelector(".modal")?.textContent.replace(/\\s+/g," ").slice(0,120)`);
console.log("settings content:", settingsText);
await screenshot("11-wangwu-settings");
await evaluate(`[...document.querySelectorAll(".modal button")].find(b=>b.textContent.trim()==="关闭")?.click()`);

ws.close();
chrome.kill();
console.log("DONE");
process.exit(0);
