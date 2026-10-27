import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ChevronRight,
  History,
  RefreshCw,
  Search,
  Waypoints,
} from "lucide-react";
import type { RunStatus } from "../../shared/types";
import { useApp } from "../state";
import {
  cx,
  formatDuration,
  relativeTime,
  RUN_LABEL,
  truncate,
} from "../lib/format";
import { StatusPill } from "../components/StatusPill";

type Filter = "all" | RunStatus;

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "running", label: "编排中" },
  { key: "completed", label: "已完成" },
  { key: "failed", label: "失败" },
];

export function RunsPage() {
  const { runs, refresh, loading } = useApp();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const completed = runs.filter((run) => run.status === "completed").length;
  const failed = runs.filter((run) => run.status === "failed").length;
  const average = useMemo(() => {
    const durations = runs
      .map((run) => run.durationMs)
      .filter((value): value is number => typeof value === "number");
    if (durations.length === 0) return undefined;
    return durations.reduce((total, value) => total + value, 0) / durations.length;
  }, [runs]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return runs.filter((run) => {
      if (filter !== "all" && run.status !== filter) return false;
      if (!needle) return true;
      return `${run.agentName} ${run.task} ${run.id}`.toLowerCase().includes(needle);
    });
  }, [runs, filter, query]);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="page runs-page">
      <div className="page-toolbar">
        <div className="filter-group" role="tablist" aria-label="按状态筛选">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={cx("filter-chip", filter === item.key && "is-active")}
              onClick={() => setFilter(item.key)}
              aria-pressed={filter === item.key}
            >
              {item.label}
              <span className="filter-count mono">
                {item.key === "all"
                  ? runs.length
                  : runs.filter((run) => run.status === item.key).length}
              </span>
            </button>
          ))}
        </div>
        <div className="toolbar-side">
          <div className="search-box">
            <Search size={14} />
            <input
              className="search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索任务、智能体或 Run ID…"
              aria-label="搜索运行记录"
            />
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            aria-label="刷新运行记录"
            title="刷新"
          >
            <RefreshCw size={15} className={cx(refreshing && "spin")} />
          </button>
          <button type="button" className="btn btn-primary" onClick={() => navigate("/")}>
            <Waypoints size={15} />
            发起新任务
          </button>
        </div>
      </div>

      <section className="stat-rail" aria-label="运行概览">
        <div className="stat">
          <span className="stat-label">运行总数</span>
          <span className="stat-value mono">{runs.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">已完成</span>
          <span className="stat-value mono">{completed}</span>
        </div>
        <div className="stat">
          <span className="stat-label">失败</span>
          <span className="stat-value mono">{failed}</span>
        </div>
        <div className="stat">
          <span className="stat-label">平均耗时</span>
          <span className="stat-value mono">{formatDuration(average)}</span>
        </div>
      </section>

      {loading ? null : filtered.length === 0 ? (
        <div className="panel empty-panel">
          <History size={17} />
          <span>
            {runs.length === 0
              ? "还没有运行记录。打开一个智能体，下发第一条任务。"
              : "当前筛选条件下没有运行记录。"}
          </span>
        </div>
      ) : (
        <div className="table-panel runs-panel">
          <div className="runs-head-row table-head">
            <span>状态</span>
            <span>智能体</span>
            <span>任务</span>
            <span>Run ID</span>
            <span>协作链路</span>
            <span>耗时</span>
            <span>时间</span>
            <span aria-hidden="true" />
          </div>
          {filtered.map((run) => {
            const done = run.plan.filter((todo) => todo.status === "completed").length;
            const completedDelegations = run.delegations.filter(
              (lane) => lane.status === "completed",
            ).length;
            return (
              <button
                key={run.id}
                type="button"
                className="run-row"
                onClick={() => navigate(`/runs/${run.id}`)}
              >
                <StatusPill status={run.status} label={RUN_LABEL[run.status]} compact />
                <span className="run-agent">
                  <strong>{run.agentName}</strong>
                  <span className="run-mode mono">
                    {run.provider === "demo" ? "demo" : "live"}
                  </span>
                </span>
                <span className="run-task">{truncate(run.task, 92)}</span>
                <span className="run-id mono">{run.id}</span>
                <span className="run-chain mono">
                  {completedDelegations}/{run.delegations.length} 子智能体
                  <span className="dot-sep" />
                  {done}/{run.plan.length || "—"} 步骤
                </span>
                <span className="run-duration mono">{formatDuration(run.durationMs)}</span>
                <span className="run-time">{relativeTime(run.startedAt)}</span>
                <ChevronRight size={14} className="run-arrow" />
              </button>
            );
          })}
        </div>
      )}

      {filtered.length > 0 ? (
        <div className="runs-foot">
          <span className="muted mono">
            显示 {filtered.length} / {runs.length} 条记录
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate("/")}>
            返回工作区
            <ArrowRight size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
