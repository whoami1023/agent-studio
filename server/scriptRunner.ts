import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import type { ScriptRunResult, Skill, SkillScript } from "../shared/types.js";

export const SCRIPT_LIMITS = {
  maxFiles: 20,
  maxFileBytes: 64 * 1024,
  maxTotalBytes: 256 * 1024,
};

const TEXT_EXTENSIONS = new Set([
  ".py", ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts",
  ".sh", ".bash", ".zsh", ".bat", ".cmd", ".ps1",
  ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
  ".csv", ".tsv", ".txt", ".text", ".log", ".sql", ".r", ".rb", ".go", ".rs",
  ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".lua", ".pl", ".kt",
  ".scala", ".swift", ".dart", ".vue", ".svelte", ".css", ".scss", ".html",
  ".xml", ".env", ".properties", ".md",
]);

function scriptLanguage(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".py":
      return "python";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".ts":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".sh":
    case ".bash":
    case ".zsh":
      return "shell";
    case ".bat":
    case ".cmd":
      return "batch";
    case ".ps1":
      return "powershell";
    default:
      return "text";
  }
}

export function sanitizeScriptPath(rawPath: string): string | null {
  const normalized = rawPath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;
  const safe: string[] = [];
  for (const segment of segments) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") {
      if (safe.length === 0) return null;
      safe.pop();
      continue;
    }
    if (/[<>:"|?*\u0000-\u001f]/.test(segment)) return null;
    safe.push(segment);
  }
  if (safe.length === 0) return null;
  const joined = safe.join("/");
  return joined.length > 240 ? null : joined;
}

function isTextContent(content: string): boolean {
  return !content.includes("\u0000");
}

export function normalizeScripts(scripts: unknown): SkillScript[] | string {
  if (!Array.isArray(scripts)) return "scripts 必须为数组";
  if (scripts.length > SCRIPT_LIMITS.maxFiles) {
    return `脚本文件数量不能超过 ${SCRIPT_LIMITS.maxFiles} 个`;
  }
  const result: SkillScript[] = [];
  let totalBytes = 0;
  for (const item of scripts) {
    if (!item || typeof item !== "object") return "脚本文件格式不正确";
    const candidate = item as { path?: unknown; content?: unknown; language?: unknown };
    if (typeof candidate.path !== "string" || typeof candidate.content !== "string") {
      return "每个脚本需要 path 与 content 字段";
    }
    const safePath = sanitizeScriptPath(candidate.path);
    if (!safePath) return `脚本路径不合法：${candidate.path}`;
    if (result.some((script) => script.path === safePath)) {
      return `脚本路径重复：${safePath}`;
    }
    if (!isTextContent(candidate.content)) return `脚本不是文本文件：${safePath}`;
    const bytes = Buffer.byteLength(candidate.content, "utf8");
    if (bytes > SCRIPT_LIMITS.maxFileBytes) {
      return `脚本超过 ${SCRIPT_LIMITS.maxFileBytes / 1024}KB 上限：${safePath}`;
    }
    totalBytes += bytes;
    if (totalBytes > SCRIPT_LIMITS.maxTotalBytes) {
      return `技能脚本总大小超过 ${SCRIPT_LIMITS.maxTotalBytes / 1024}KB 上限`;
    }
    const ext = path.extname(safePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) {
      return `不支持的文件类型：${safePath}`;
    }
    result.push({
      path: safePath,
      language:
        typeof candidate.language === "string" && candidate.language
          ? candidate.language
          : scriptLanguage(safePath),
      size: bytes,
      content: candidate.content,
    });
  }
  return result;
}

export function buildSkillScripts(
  files: Array<{ path: string; content: string }>,
): { scripts: SkillScript[]; skipped: string[] } {
  const scripts: SkillScript[] = [];
  const skipped: string[] = [];
  let totalBytes = 0;
  for (const file of files) {
    const safePath = sanitizeScriptPath(file.path);
    if (!safePath) {
      skipped.push(file.path);
      continue;
    }
    if (scripts.length >= SCRIPT_LIMITS.maxFiles) {
      skipped.push(file.path);
      continue;
    }
    const ext = path.extname(safePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) {
      skipped.push(file.path);
      continue;
    }
    if (!isTextContent(file.content)) {
      skipped.push(file.path);
      continue;
    }
    const bytes = Buffer.byteLength(file.content, "utf8");
    if (bytes > SCRIPT_LIMITS.maxFileBytes || totalBytes + bytes > SCRIPT_LIMITS.maxTotalBytes) {
      skipped.push(file.path);
      continue;
    }
    totalBytes += bytes;
    scripts.push({
      path: safePath,
      language: scriptLanguage(safePath),
      size: bytes,
      content: file.content,
    });
  }
  return { scripts, skipped };
}

export function scriptManifestSection(skill: Skill): string {
  const scripts = skill.scripts ?? [];
  if (scripts.length === 0) return "";
  const lines = scripts.map(
    (script) => `- \`${script.path}\`（${script.language}，${formatBytes(script.size)}）`,
  );
  return [
    `## 附带脚本文件`,
    ``,
    `本技能附带 ${scripts.length} 个脚本文件，存放在本技能目录下：`,
    ``,
    ...lines,
    ``,
    `使用方式：`,
    `1. 先用 read_file 阅读脚本内容，确认输入、输出与副作用。`,
    `2. 用 execute 工具在技能目录内运行，例如 \`python ${scripts[0].path}\` 或 \`node ${scripts[0].path}\`。`,
    `3. 把脚本输出整理进交付物，注明数据来源与运行时间。`,
  ].join("\n");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export async function writeSkillFiles(
  skill: Skill,
  dir: string,
  includeScriptManifest = true,
): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const frontmatter = YAML.stringify({
    name: skill.slug,
    description: skill.description,
  });
  const manifest = includeScriptManifest ? scriptManifestSection(skill) : "";
  const body = manifest ? `${skill.instructions}\n\n${manifest}` : skill.instructions;
  await fs.writeFile(path.join(dir, "SKILL.md"), `---\n${frontmatter}---\n\n${body}\n`, "utf8");
  const root = path.resolve(dir);
  for (const script of skill.scripts ?? []) {
    const target = path.resolve(dir, script.path);
    if (!target.startsWith(root + path.sep)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, script.content, "utf8");
  }
}

interface CommandSpec {
  candidates: Array<{ cmd: string; prefix: string[]; suffix: string[] }>;
}

function commandSpecFor(language: string, scriptPath: string): CommandSpec {
  switch (language) {
    case "python":
      return {
        candidates: [
          { cmd: "python", prefix: [], suffix: [scriptPath] },
          { cmd: "py", prefix: ["-3"], suffix: [scriptPath] },
          { cmd: "python3", prefix: [], suffix: [scriptPath] },
        ],
      };
    case "javascript":
      return {
        candidates: [
          { cmd: process.execPath, prefix: [], suffix: [scriptPath] },
        ],
      };
    case "typescript":
      return {
        candidates: [
          { cmd: process.execPath, prefix: ["--experimental-strip-types"], suffix: [scriptPath] },
          { cmd: "npx", prefix: ["tsx"], suffix: [scriptPath] },
        ],
      };
    case "shell":
      return {
        candidates: [
          { cmd: "bash", prefix: [], suffix: [scriptPath] },
          { cmd: "sh", prefix: [], suffix: [scriptPath] },
        ],
      };
    case "batch":
      return {
        candidates: [
          { cmd: "cmd", prefix: ["/d", "/s", "/c"], suffix: [scriptPath] },
        ],
      };
    case "powershell":
      return {
        candidates: [
          {
            cmd: "powershell",
            prefix: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "RemoteSigned", "-File"],
            suffix: [scriptPath],
          },
        ],
      };
    default:
      return { candidates: [] };
  }
}

export interface RunScriptOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export async function runScriptInDir(
  script: SkillScript,
  skillDir: string,
  options: RunScriptOptions = {},
): Promise<ScriptRunResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutputBytes = options.maxOutputBytes ?? 256 * 1024;
  const spec = commandSpecFor(script.language, script.path);
  const started = Date.now();

  const attempt = (candidate: (typeof spec.candidates)[number]): Promise<ScriptRunResult> =>
    new Promise((resolve, reject) => {
      const child = spawn(candidate.cmd, [...candidate.prefix, ...candidate.suffix], {
        cwd: skillDir,
        env: process.env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const finish = (exitCode: number) => {
        if (settled) return;
        settled = true;
        resolve({
          path: script.path,
          exitCode,
          stdout: stdout.slice(0, maxOutputBytes),
          stderr: stderr.slice(0, maxOutputBytes),
          durationMs: Date.now() - started,
          timedOut,
        });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        if (stdout.length < maxOutputBytes) stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length < maxOutputBytes) stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        finish(code ?? -1);
      });
    });

  for (let index = 0; index < spec.candidates.length; index++) {
    try {
      const result = await attempt(spec.candidates[index]);
      // Windows Store 别名（python/python3 未安装时）以 9009 退出而非 ENOENT。
      if (
        result.exitCode === 9009 &&
        !result.stdout.trim() &&
        index < spec.candidates.length - 1
      ) {
        continue;
      }
      return result;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" && index < spec.candidates.length - 1) continue;
      const now = Date.now();
      return {
        path: script.path,
        exitCode: -1,
        stdout: "",
        stderr: `无法启动解释器：${(error as Error).message ?? String(error)}`,
        durationMs: now - started,
        timedOut: false,
      };
    }
  }

  return {
    path: script.path,
    exitCode: -1,
    stdout: "",
    stderr: `不支持执行的文件类型：${script.language}`,
    durationMs: Date.now() - started,
    timedOut: false,
  };
}

export async function withSkillTempDir<T>(
  skill: Skill,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "as-skill-"));
  try {
    await writeSkillFiles(skill, root, false);
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}
