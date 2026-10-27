import path from "node:path";
import { unzipSync } from "fflate";
import YAML from "yaml";
import type { SkillScript } from "../shared/types.js";
import { buildSkillScripts, SCRIPT_LIMITS } from "./scriptRunner.js";

export const ZIP_LIMITS = {
  maxZipBytes: 10 * 1024 * 1024,
  maxEntries: 60,
  maxEntryBytes: 512 * 1024,
  maxTotalUncompressed: 1536 * 1024,
};

export interface ParsedSkillZip {
  name: string;
  description: string;
  instructions: string;
  scripts: SkillScript[];
  skipped: string[];
}

function stripCommonRoot<T extends { path: string }>(entries: T[]): T[] {
  const segments = entries.map((entry) => entry.path.split("/"));
  const first = segments[0] ?? [];
  let common = 0;
  while (
    common < first.length &&
    segments.every((seg) => seg.length > common && seg[common] === first[common])
  ) {
    common += 1;
  }
  if (common === 0) return entries;
  return entries.map((entry) => ({
    ...entry,
    path: entry.path.split("/").slice(common).join("/"),
  }));
}

function parseFrontmatter(markdown: string): { name?: string; description?: string } {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(markdown);
  if (!match) return {};
  try {
    const parsed = YAML.parse(match[1]);
    if (!parsed || typeof parsed !== "object") return {};
    const candidate = parsed as Record<string, unknown>;
    return {
      name: typeof candidate.name === "string" ? candidate.name.trim() : undefined,
      description:
        typeof candidate.description === "string" ? candidate.description.trim() : undefined,
    };
  } catch {
    return {};
  }
}

export function parseSkillZip(fileName: string, data: Uint8Array): ParsedSkillZip | string {
  if (data.length > ZIP_LIMITS.maxZipBytes) {
    return `压缩包超过 ${ZIP_LIMITS.maxZipBytes / 1024 / 1024}MB 上限`;
  }
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    return "无法解压该文件，请确认是有效的 ZIP 压缩包";
  }

  const files: Array<{ path: string; content: string }> = [];
  const skipped: string[] = [];
  let total = 0;
  const names = Object.keys(entries);
  if (names.length > ZIP_LIMITS.maxEntries) {
    return `压缩包内文件数量超过 ${ZIP_LIMITS.maxEntries} 个上限`;
  }
  for (const name of names) {
    if (name.endsWith("/")) continue;
    const bytes = entries[name];
    if (bytes.length > ZIP_LIMITS.maxEntryBytes) {
      skipped.push(name);
      continue;
    }
    total += bytes.length;
    if (total > ZIP_LIMITS.maxTotalUncompressed) {
      return `解压后内容超过 ${ZIP_LIMITS.maxTotalUncompressed / 1024}KB 上限`;
    }
    const content = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (content.includes("\u0000")) {
      skipped.push(name);
      continue;
    }
    files.push({ path: name.replace(/\\/g, "/"), content });
  }

  const stripped = stripCommonRoot(files).filter((file) => file.path.length > 0);
  const mdFiles = stripped.filter((file) => file.path.toLowerCase().endsWith(".md"));
  const docCandidates = [
    mdFiles.find((file) => path.basename(file.path).toUpperCase() === "SKILL.MD"),
    mdFiles.find((file) => path.basename(file.path).toUpperCase() === "README.MD"),
    ...mdFiles,
  ].filter((file): file is { path: string; content: string } => Boolean(file));

  const doc = docCandidates[0];
  const frontmatter = doc ? parseFrontmatter(doc.content) : {};
  const fallbackName = path.basename(fileName.replace(/\.zip$/i, "")).trim();
  const rootName =
    files.length > 0 ? files[0].path.split("/")[0] : "";
  const name = frontmatter.name || rootName || fallbackName || "导入技能";
  const description =
    frontmatter.description ||
    `从 ${fileName} 导入的技能` +
      (doc ? `，包含说明文档与 ${Math.max(0, stripped.length - 1)} 个附加文件` : "") +
      "。";

  const instructions = doc
    ? doc.content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim()
    : `# ${name}\n\n${description}\n\n（该压缩包未包含 Markdown 说明文档，请编辑补充使用方法。）`;

  const nonDocFiles = stripped.filter((file) => !file.path.toLowerCase().endsWith(".md"));
  const { scripts, skipped: scriptSkipped } = buildSkillScripts(nonDocFiles);

  return {
    name: name.slice(0, 40),
    description: description.slice(0, 400),
    instructions: instructions.slice(0, 12000),
    scripts,
    skipped: [...skipped, ...scriptSkipped],
  };
}
