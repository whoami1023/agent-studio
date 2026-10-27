import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Info,
  Loader2,
  PenLine,
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
  Square,
  Zap,
} from "lucide-react";
import type {
  ArtifactFile,
  DelegationRecord,
  RunEvent,
  RunRecord,
} from "../../shared/types";
import { streamRun } from "../api";
import { useApp } from "../state";
import { cx, initials } from "../lib/format";
import { RunResultView } from "../components/RunResultView";
import { StatusPill } from "../components/StatusPill";

const SUGGESTIONS = [
  "为下个版本制定一份从市场调研、数据指标到风险评审的完整发布方案。",
  "评估当前方案是否值得推进，覆盖机会、成本与主要风险，并给出 Go / No-Go 建议。",
  "围绕用户增长、交付成本与安全风险做一次综合评审，输出可执行的行动清单。",
];

function mergeDelegation(run: RunRecord, delegation: DelegationRecord): RunRecord {
  const exists = run.delegations.some((lane) => lane.id === delegation.id);
  return {
    ...run,
    delegations: exists
      ? run.delegations.map((lane) => (lane.id === delegation.id ? delegation : lane))
      : [...run.delegations, delegation],
  };
}

export function RunPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { agents, settings, refresh, notify, setSettingsOpen } = useApp();
  const agent = agents.find((item) => item.id === id);

  const [task, setTask] = useState("");
  const [run, setRun] = useState<RunRecord | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactFile[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [displayAnswer, setDisplayAnswer] = useState("");
  const [typing, setTyping] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const startRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const typingRef = useRef(false);
  const startedAnswerRef = useRef<string>("");

  useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => {
      if (startRef.current) setElapsedMs(Date.now() - startRef.current);
    }, 120);
    return () => window.clearInterval(timer);
  }, [streaming]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  function stopTyping() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    typingRef.current = false;
    setTyping(false);
    if (startedAnswerRef.current) setDisplayAnswer(startedAnswerRef.current);
  }

  function resetTyping() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    typingRef.current = false;
    startedAnswerRef.current = "";
    setTyping(false);
    setDisplayAnswer("");
  }

  function beginTyping(answer: string) {
    if (!answer) return;
    if (startedAnswerRef.current === answer) {
      if (!typingRef.current) setDisplayAnswer(answer);
      return;
    }
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    startedAnswerRef.current = answer;
    typingRef.current = true;
    setDisplayAnswer("");
    setTyping(true);
    const started = performance.now();
    const tick = () => {
      const chars = Math.min(answer.length, Math.floor((performance.now() - started) / 1.2));
      setDisplayAnswer(answer.slice(0, chars));
      if (chars >= answer.length) {
        rafRef.current = null;
        typingRef.current = false;
        setTyping(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function handleEvent(event: RunEvent) {
    switch (event.type) {
      case "run_started":
        setRun(structuredClone(event.run));
        setArtifacts([]);
        setError(null);
        setInterrupted(false);
        resetTyping();
        startRef.current = Date.now();
        setElapsedMs(0);
        break;
      case "plan":
        setRun((current) => (current ? { ...current, plan: event.todos } : current));
        break;
      case "delegation":
        setRun((current) =>
          current ? mergeDelegation(current, event.delegation) : current,
        );
        break;
      case "delegation_activity":
        setRun((current) => {
          if (!current) return current;
          return {
            ...current,
            delegations: current.delegations.map((lane) => {
              if (lane.id !== event.id) return lane;
              if (lane.activity[lane.activity.length - 1] === event.line) return lane;
              return { ...lane, activity: [...lane.activity, event.line].slice(-24) };
            }),
          };
        });
        break;
      case "delegation_done":
        setRun((current) => {
          if (!current) return current;
          return {
            ...current,
            delegations: current.delegations.map((lane) =>
              lane.id === event.id
                ? {
                    ...lane,
                    status: event.status,
                    result: event.result,
                    durationMs: event.durationMs,
                    finishedAt: new Date().toISOString(),
                  }
                : lane,
            ),
          };
        });
        break;
      case "final_answer":
        setRun((current) =>
          current ? { ...current, finalAnswer: event.answer } : current,
        );
        beginTyping(event.answer);
        break;
      case "run_completed":
        setRun(structuredClone(event.run));
        setArtifacts(event.artifacts);
        setStreaming(false);
        if (event.run.finalAnswer) beginTyping(event.run.finalAnswer);
        void refresh();
        break;
      case "run_failed":
        setRun(structuredClone(event.run));
        setError(event.message);
        setStreaming(false);
        stopTyping();
        void refresh();
        break;
      default:
        break;
    }
  }

  async function startRun() {
    if (!agent) return;
    const instruction = task.trim();
    if (instruction.length < 4 || streaming) return;
    setRun(null);
    setArtifacts([]);
    setError(null);
    setInterrupted(false);
    resetTyping();
    setElapsedMs(0);
    startRef.current = Date.now();
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      for await (const event of streamRun(agent.id, instruction, controller.signal)) {
        handleEvent(event);
      }
      setStreaming(false);
    } catch (err) {
      if (controller.signal.aborted) {
        setStreaming(false);
        setInterrupted(true);
        notify("已停止接收实时流，服务端仍会继续执行并保存本次运行", "info");
      } else {
        setStreaming(false);
        setError(err instanceof Error ? err.message : "运行失败");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function stopRun() {
    if (!streaming) return;
    abortRef.current?.abort();
  }

  function resetRun() {
    if (streaming) return;
    setRun(null);
    setArtifacts([]);
    setError(null);
    setInterrupted(false);
    resetTyping();
    setElapsedMs(0);
  }

  if (!agent) {
    return (
      <div className="page">
        <div className="empty-hero">
          <span className="empty-hero-icon">
            <Sparkles size={24} />
          </span>
          <h3>智能体不存在</h3>
          <p>它可能已被删除，返回工作区选择其他智能体。</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate("/")}>
            <ArrowLeft size={15} />
            返回工作区
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page run-page">
      <button
        type="button"
        className="back-link"
        onClick={() => navigate(`/agents/${agent.id}`)}
      >
        <ArrowLeft size={14} />
        返回编排
      </button>

      <header className="content-head">
        <div className="content-head-main">
          <span className="agent-avatar agent-avatar-lg">{initials(agent.name)}</span>
          <div className="content-head-copy">
            <div className="kicker">Agent / Task run</div>
            <h1>{agent.name}</h1>
            <p>{agent.description}</p>
          </div>
        </div>
        <div className="content-head-actions">
          {streaming ? (
            <button type="button" className="btn btn-secondary" onClick={stopRun}>
              <Square size={13} />
              停止接收
            </button>
          ) : run ? (
            <button type="button" className="btn btn-secondary" onClick={resetRun}>
              <RotateCcw size={15} />
              新任务
            </button>
          ) : null}
          {run && !streaming ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate(`/runs/${run.id}`)}
            >
              运行详情
              <ArrowRight size={14} />
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate(`/agents/${agent.id}`)}
          >
            <Settings2 size={15} />
            编排
          </button>
        </div>
      </header>

      {error && !run ? <div className="run-error-banner">{error}</div> : null}

      {run ? (
        <>
          <div className="run-task-bar">
            <span className="run-task-label mono">TASK</span>
            <p>{run.task}</p>
            {typing ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={stopTyping}>
                显示全文
              </button>
            ) : null}
            {streaming ? (
              <span className="live-label">
                <span className="live-dot" />
                实时编排中
              </span>
            ) : (
              <StatusPill status={run.status} />
            )}
          </div>

          {interrupted ? (
            <div className="run-notice">
              <Info size={15} />
              <span>
                实时流已断开，服务端仍会完成本次运行并保存记录。
              </span>
              <button
                type="button"
                className="notice-action"
                onClick={() => navigate("/runs")}
              >
                查看运行记录
                <ArrowRight size={13} />
              </button>
            </div>
          ) : null}

          {error ? <div className="run-error-banner">{error}</div> : null}

          <RunResultView
            run={run}
            artifacts={artifacts}
            live={streaming}
            elapsedMs={elapsedMs}
            displayAnswer={typing ? displayAnswer : undefined}
            typing={typing}
          />
        </>
      ) : (
        <>
          {streaming ? (
            <div className="run-connecting">
              <Loader2 size={17} className="spin" />
              正在连接编排中枢，主智能体开始拆解任务…
            </div>
          ) : null}

          <section className="panel run-composer">
            <div className="composer-head">
              <div className="panel-title">
                <PenLine size={16} />
                <span>下达任务</span>
              </div>
              <button
                type="button"
                className={cx("mode-badge", settings.mode === "openai" && "is-live")}
                onClick={() => setSettingsOpen(true)}
                title="打开模型设置"
              >
                {settings.mode === "demo" ? <Zap size={12} /> : <Sparkles size={12} />}
                {settings.mode === "demo" ? "演示模型" : settings.model}
              </button>
            </div>

            <textarea
              className="composer-input"
              value={task}
              onChange={(event) => setTask(event.target.value)}
              placeholder={`描述要交给「${agent.name}」完成的任务。主智能体会拆解目标，并行分派给 ${agent.subagents.length} 个子智能体，最后汇总交付。`}
              maxLength={6000}
              rows={6}
              autoFocus
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void startRun();
                }
              }}
            />

            <div className="composer-suggestions">
              <span className="composer-suggestions-label">试试</span>
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="suggestion-chip"
                  onClick={() => setTask(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <div className="roster-strip">
              <span className="roster-label mono">TEAM</span>
              {agent.subagents.length === 0 ? (
                <span className="muted">
                  未配置子智能体，主智能体将独立完成任务。可以先返回编排添加角色。
                </span>
              ) : (
                <div className="roster-items">
                  {agent.subagents.map((subagent) => (
                    <span key={subagent.id} className="roster-item">
                      <span className="roster-dot" />
                      {subagent.name}
                      <span className="roster-skill mono">{subagent.skillIds.length}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="composer-foot">
              <span className="composer-hint">
                {task.trim().length > 0 ? `${task.trim().length} 字符 · ` : ""}
                Ctrl / ⌘ + Enter 启动 · 子智能体将并行执行
              </span>
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={() => void startRun()}
                disabled={task.trim().length < 4 || streaming}
              >
                <Play size={16} />
                启动编排
              </button>
            </div>
          </section>

          {agent.subagents.length > 0 ? (
            <section className="roster-preview">
              <div className="roster-preview-head">
                <h2>协作编队</h2>
                <span>主智能体会按任务需要并行调用这些角色</span>
              </div>
              <div className="roster-grid">
                {agent.subagents.map((subagent, index) => (
                  <div key={subagent.id} className="roster-card">
                    <span className="lane-index mono">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{subagent.name}</strong>
                      <p>{subagent.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
