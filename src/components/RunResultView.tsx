import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  Copy,
  Download,
  FileText,
  ListChecks,
  Loader2,
  Sparkles,
  Workflow,
} from "lucide-react";
import type {
  ArtifactFile,
  DelegationRecord,
  RunRecord,
  TodoItem,
} from "../../shared/types";
import { downloadArtifactUrl } from "../api";
import {
  cx,
  DELEGATION_LABEL,
  formatBytes,
  formatDateTime,
  formatDuration,
  truncate,
} from "../lib/format";
import { useApp } from "../state";
import { Markdown } from "./Markdown";
import { StatusPill } from "./StatusPill";

interface RunResultViewProps {
  run: RunRecord;
  artifacts: ArtifactFile[];
  live?: boolean;
  elapsedMs?: number;
  displayAnswer?: string;
  typing?: boolean;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function RunResultView({
  run,
  artifacts,
  live = false,
  elapsedMs,
  displayAnswer,
  typing,
}: RunResultViewProps) {
  const answer = displayAnswer ?? run.finalAnswer ?? "";
  return (
    <div className="run-grid">
      <div className="run-main">
        <LanesPanel delegations={run.delegations} agent={run.agentName} />
        <FinalPanel
          run={run}
          answer={answer}
          typing={typing}
          live={live}
        />
      </div>
      <aside className="run-side">
        <PlanPanel run={run} live={live} />
        <MetaPanel run={run} live={live} elapsedMs={elapsedMs} />
        <ArtifactsPanel run={run} artifacts={artifacts} />
      </aside>
    </div>
  );
}

function PlanPanel({ run, live }: { run: RunRecord; live: boolean }) {
  const total = run.plan.length;
  const completed = run.plan.filter((todo) => todo.status === "completed").length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <section className="panel plan-panel">
      <div className="panel-head">
        <div className="panel-title">
          <ListChecks size={16} />
          <span>执行计划</span>
        </div>
        <span className="panel-meta mono">
          {completed}/{total || "—"}
        </span>
      </div>
      <div className="plan-progress" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      {total === 0 ? (
        <div className={cx("plan-empty", live && run.status === "running" && "is-loading")}>
          {live && run.status === "running" ? (
            <>
              <Loader2 size={15} className="spin" />
              主智能体正在拆解任务…
            </>
          ) : (
            "暂无执行计划"
          )}
        </div>
      ) : (
        <ol className="plan-list">
          {run.plan.map((todo, index) => (
            <PlanStep key={`${index}-${todo.content}`} todo={todo} index={index} />
          ))}
        </ol>
      )}
    </section>
  );
}

function PlanStep({ todo, index }: { todo: TodoItem; index: number }) {
  return (
    <li className={cx("plan-step", `is-${todo.status}`)}>
      <span className="plan-icon" aria-hidden="true">
        {todo.status === "completed" ? (
          <CheckCircle2 size={16} />
        ) : todo.status === "in_progress" ? (
          <Loader2 size={16} className="spin" />
        ) : (
          <Circle size={16} />
        )}
      </span>
      <span className="plan-copy">
        <span className="plan-index mono">{String(index + 1).padStart(2, "0")}</span>
        <span className="plan-text">{todo.content}</span>
      </span>
    </li>
  );
}

function MetaPanel({
  run,
  live,
  elapsedMs,
}: {
  run: RunRecord;
  live: boolean;
  elapsedMs?: number;
}) {
  const { notify } = useApp();
  const duration =
    run.status === "running" && live ? elapsedMs : run.durationMs ?? elapsedMs;

  return (
    <section className="panel meta-panel">
      <div className="panel-head">
        <div className="panel-title">
          <Clock size={15} />
          <span>运行信息</span>
        </div>
        <StatusPill status={run.status} />
      </div>
      <dl className="meta-list">
        <div>
          <dt>模型通道</dt>
          <dd>{run.provider === "demo" ? "本地演示模型" : "OpenAI 兼容"}</dd>
        </div>
        <div>
          <dt>总耗时</dt>
          <dd className="mono">{formatDuration(duration)}</dd>
        </div>
        <div>
          <dt>开始时间</dt>
          <dd className="mono">{formatDateTime(run.startedAt)}</dd>
        </div>
        <div>
          <dt>Run ID</dt>
          <dd className="meta-run-id">
            <span className="mono">{run.id}</span>
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              aria-label="复制 Run ID"
              onClick={async () => {
                const ok = await copyToClipboard(run.id);
                notify(ok ? "Run ID 已复制" : "复制失败", ok ? "success" : "error");
              }}
            >
              <Copy size={13} />
            </button>
          </dd>
        </div>
      </dl>
    </section>
  );
}

function ArtifactsPanel({
  run,
  artifacts,
}: {
  run: RunRecord;
  artifacts: ArtifactFile[];
}) {
  const [openName, setOpenName] = useState<string | null>(null);

  return (
    <section className="panel artifacts-panel">
      <div className="panel-head">
        <div className="panel-title">
          <FileText size={15} />
          <span>交付文件</span>
        </div>
        <span className="panel-meta mono">{artifacts.length}</span>
      </div>
      {artifacts.length === 0 ? (
        <p className="panel-empty">
          {run.status === "running"
            ? "子智能体写入 /artifacts 的文件会出现在这里。"
            : "本次运行没有生成文件。"}
        </p>
      ) : (
        <ul className="artifact-list">
          {artifacts.map((artifact) => {
            const open = openName === artifact.name;
            return (
              <li key={artifact.name} className={cx("artifact", open && "is-open")}>
                <div className="artifact-row">
                  <button
                    type="button"
                    className="artifact-main"
                    onClick={() => setOpenName(open ? null : artifact.name)}
                    aria-expanded={open}
                  >
                    <span className="artifact-ext">MD</span>
                    <span className="artifact-copy">
                      <span className="artifact-name mono">{artifact.name}</span>
                      <span className="artifact-size">{formatBytes(artifact.size)}</span>
                    </span>
                    {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <a
                    className="icon-btn icon-btn-sm"
                    href={downloadArtifactUrl(run.id, artifact.name)}
                    aria-label={`下载 ${artifact.name}`}
                    title="下载"
                  >
                    <Download size={14} />
                  </a>
                </div>
                {open ? <pre className="artifact-preview">{artifact.content}</pre> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function LanesPanel({
  delegations,
  agent,
}: {
  delegations: DelegationRecord[];
  agent: string;
}) {
  const completed = delegations.filter((lane) => lane.status === "completed").length;
  const active = delegations.filter((lane) => lane.status === "running").length;

  return (
    <section className="panel lanes-panel">
      <div className="panel-head">
        <div className="panel-title">
          <Workflow size={16} />
          <span>子智能体协作</span>
        </div>
        <span className="panel-meta">
          {active > 0 ? (
            <span className="live-label">
              <span className="live-dot" />
              {active} 个执行中
            </span>
          ) : (
            <span className="mono">
              {completed}/{delegations.length} 完成
            </span>
          )}
        </span>
      </div>
      {delegations.length === 0 ? (
        <p className="panel-empty">
          「{agent}」没有配置子智能体，任务由主智能体独立完成。
        </p>
      ) : (
        <div className="lanes-grid">
          {delegations.map((lane, index) => (
            <LaneCard key={lane.id} lane={lane} index={index} />
          ))}
        </div>
      )}
    </section>
  );
}

function LaneCard({ lane, index }: { lane: DelegationRecord; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = lane.status === "running";
  const isDone = lane.status === "completed";
  const isFailed = lane.status === "failed";
  const result = lane.result?.trim() ?? "";
  const canExpand = result.length > 360;
  const preview = truncate(
    result
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/[*_`>]+/g, "")
      .replace(/\n{2,}/g, "\n"),
    340,
  );
  const visibleActivity = lane.activity.slice(-4);

  return (
    <article className={cx("lane", `lane-${lane.status}`)}>
      <header className="lane-head">
        <span className="lane-index mono">{String(index + 1).padStart(2, "0")}</span>
        <div className="lane-title">
          <h3>{lane.subagent}</h3>
          <span className="lane-role">{truncate(lane.description, 96)}</span>
        </div>
        <span className={cx("lane-status", `is-${lane.status}`)}>
          {(lane.status === "running" || lane.status === "completed" || lane.status === "failed") && (
            <span className="lane-status-dot" />
          )}
          {DELEGATION_LABEL[lane.status]}
        </span>
      </header>

      <div className="lane-activity">
        {visibleActivity.length === 0 ? (
          <span className="lane-idle">
            {lane.status === "queued" ? "等待主智能体分派…" : "准备中…"}
          </span>
        ) : (
          visibleActivity.map((line, lineIndex) => (
            <span
              key={`${lineIndex}-${line}`}
              className={cx(
                "lane-log",
                lineIndex === visibleActivity.length - 1 && isRunning && "is-current",
              )}
            >
              <span className="lane-log-mark">›</span>
              {line}
            </span>
          ))
        )}
        {isRunning ? (
          <span className="lane-typing">
            <span />
            <span />
            <span />
          </span>
        ) : null}
      </div>

      {isDone && result ? (
        <div className={cx("lane-result", expanded && "is-expanded")}>
          <div className="lane-result-head">
            <CheckCircle2 size={13} />
            <span>交付摘要</span>
            {canExpand ? (
              <button
                type="button"
                className="lane-expand"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? "收起" : "展开"}
              </button>
            ) : null}
          </div>
          {expanded ? (
            <div className="lane-result-scroll">
              <Markdown content={result} />
            </div>
          ) : (
            <p className="lane-preview">{preview}</p>
          )}
        </div>
      ) : null}

      {isFailed ? (
        <div className="lane-error">
          <AlertTriangle size={13} />
          <span>{lane.result || "子智能体执行失败"}</span>
        </div>
      ) : null}

      <footer className="lane-foot">
        <span className="mono">
          {lane.durationMs !== undefined ? formatDuration(lane.durationMs) : "—"}
        </span>
        {isDone && result ? <span className="mono">{result.length} 字符</span> : null}
        {lane.status === "skipped" ? <span>本次未被调用</span> : null}
      </footer>
    </article>
  );
}

function FinalPanel({
  run,
  answer,
  typing,
  live,
}: {
  run: RunRecord;
  answer: string;
  typing?: boolean;
  live: boolean;
}) {
  const { notify } = useApp();
  const failed = run.status === "failed";

  return (
    <section className={cx("panel final-panel", typing && "is-typing")}>
      <div className="panel-head">
        <div className="panel-title">
          <Sparkles size={16} />
          <span>汇总交付</span>
        </div>
        {answer ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              const ok = await copyToClipboard(run.finalAnswer ?? answer);
              notify(ok ? "最终交付已复制" : "复制失败", ok ? "success" : "error");
            }}
          >
            <Copy size={14} />
            复制
          </button>
        ) : null}
      </div>

      {failed ? (
        <div className="final-error">
          <AlertTriangle size={17} />
          <div>
            <strong>运行失败</strong>
            <p>{run.error ?? "主智能体未能完成本次任务。"}</p>
          </div>
        </div>
      ) : answer ? (
        <>
          <Markdown content={answer} className="final-prose" />
          {typing ? <span className="type-cursor" aria-hidden="true" /> : null}
        </>
      ) : (
        <div className={cx("final-placeholder", live && run.status === "running" && "is-loading")}>
          {live && run.status === "running" ? (
            <>
              <span className="skeleton-line w-90" />
              <span className="skeleton-line w-70" />
              <span className="skeleton-line w-80" />
              <span className="final-wait">
                <Loader2 size={14} className="spin" />
                等待子智能体返回并汇总…
              </span>
            </>
          ) : (
            "暂无最终交付"
          )}
        </div>
      )}
    </section>
  );
}
