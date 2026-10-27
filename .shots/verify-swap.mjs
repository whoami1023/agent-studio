import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CDP_PORT = 9225;
const SHOTS = new URL("./", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${CDP_PORT}`,
  "--user-data-dir=C:/Users/anony/AppData/Local/Temp/as-ui-verify-4",
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

await send("Page.enable");
await send("Page.navigate", { url: "http://localhost:5273/" });
await waitFor(`document.querySelector(".login-card") !== null`);
await evaluate(fillInput('.login-card input:not([type="password"])', "admin"));
await evaluate(fillInput('input[type="password"]', "admin123"));
await evaluate(`document.querySelector(".login-submit").click()`);
await waitFor(`document.querySelector(".sidebar-bottom") !== null`);
await sleep(800);

const order = await evaluate(
  `[...document.querySelector(".sidebar-bottom").children].map(c=>c.className.split(" ")[0])`
);
console.log("sidebar-bottom order:", JSON.stringify(order));
await send("Page.captureScreenshot", { format: "png" }).then((res) => {
  writeFileSync(`${SHOTS}12-sidebar-swap.png`, Buffer.from(res.result.data, "base64"));
  console.log("shot: 12-sidebar-swap.png");
});

ws.close();
chrome.kill();
console.log("DONE");
process.exit(0);
