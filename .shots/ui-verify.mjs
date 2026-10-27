import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const CDP_PORT = 9223;
const SHOTS = new URL("./", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${CDP_PORT}`,
  "--user-data-dir=C:/Users/anony/AppData/Local/Temp/as-ui-verify-2",
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

const wsUrl = await getWsUrl();
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let msgId = 0;
const pending = new Map();
const events = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method) {
    events.push(msg);
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
    return { error: res.result.exceptionDetails.text };
  }
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
    const ok = await evaluate(expression);
    if (ok) return true;
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

// 1. Load login page
await send("Page.enable");
await send("Page.navigate", { url: "http://localhost:5173/" });
await waitFor(`document.querySelector(".login-card") !== null`);
await sleep(400);
console.log("login page:", await evaluate(`document.querySelector(".login-title")?.textContent`));
await screenshot("01-login");

// 2. Login as admin
await evaluate(fillInput('input[type="text"], .login-card input:not([type="password"])', "admin"));
await evaluate(fillInput('input[type="password"]', "admin123"));
await evaluate(`document.querySelector(".login-submit").click()`);
const loggedIn = await waitFor(`document.querySelector(".app-shell") !== null`);
console.log("dashboard loaded:", loggedIn);
await sleep(600);
const userRow = await evaluate(`document.querySelector(".sidebar-user")?.textContent`);
console.log("sidebar user:", userRow);
await screenshot("02-dashboard");

// 3. Admin sees 账户管理 nav
const navText = await evaluate(`[...document.querySelectorAll("nav a, .sidebar a")].map(a=>a.textContent.trim()).join("|")`);
console.log("nav:", navText);
const hasAdminNav = await evaluate(`[...document.querySelectorAll("a")].some(a=>a.getAttribute("href")==="/admin")`);
console.log("admin nav visible:", hasAdminNav);

// 4. Admin page
await send("Page.navigate", { url: "http://localhost:5173/admin" });
await waitFor(`document.querySelector(".admin-head") !== null || document.querySelector("table") !== null`);
await sleep(500);
const rows = await evaluate(`[...document.querySelectorAll(".admin-row")].map(r=>r.textContent.replace(/\\s+/g," ").trim())`);
console.log("admin rows:", JSON.stringify(rows, null, 1));
await screenshot("03-admin");

// 5. Logout
await evaluate(`document.querySelector('button[aria-label="退出登录"]')?.click()`);
const backToLogin = await waitFor(`document.querySelector(".login-card") !== null`);
console.log("logout returns to login:", backToLogin);
await screenshot("04-after-logout");

// 6. Wrong password shows error
await evaluate(fillInput('input[type="text"], .login-card input:not([type="password"])', "admin"));
await evaluate(fillInput('input[type="password"]', "wrongpass"));
await evaluate(`document.querySelector(".login-submit").click()`);
await waitFor(`document.querySelector(".login-error") !== null`);
console.log("login error:", await evaluate(`document.querySelector(".login-error")?.textContent`));
await screenshot("05-login-error");

ws.close();
chrome.kill();
console.log("DONE");
process.exit(0);
