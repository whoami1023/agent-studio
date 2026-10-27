import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Loader2,
  RefreshCw,
  Settings2,
} from "lucide-react";
import type { RunDetail } from "../../shared/types";
import { api } from "../api";
import { useApp } from "../state";
import { formatDuration, formatFullDateTime, initials } from "../lib/format";
import { RunResultView } from "../components/RunResultView";
import { StatusPill } from "../components/StatusPill";

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { notify } = useApp();
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.getRun(id);
      setDetail(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法加载运行记录");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    setDetail(null);
    setLoading(true);
    setError(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!detail || detail.status !== "running") return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [detail?.status, load]);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    await load();
    notify("运行记录已刷新", "success");
  }

  if (loading) {
    return (
      <div className="page">
        <div className="detail-loading">
          <Loader2 size={20} className="spin" />
          正在加载运行记录…
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="page">
        <button type="button" className="back-link" onClick={() => navigate("/runs")}>
          <ArrowLeft size={14} />
          返回运行记录
        </button>
        <div className="empty-hero">
          <span className="empty-hero-icon">
            <AlertTriangle size={24} />
          </span>
          <h3>无法打开这次运行</h3>
          <p>{error ?? "运行记录不存在或已被清理。"}</p>
          <button type="button" className="btn btn-primary" onClick={() => void load()}>
            <RefreshCw size={15} />
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page run-detail-page">
      <button type="button" className="back-link" onClick={() => navigate("/runs")}>
        <ArrowLeft size={14} />
        返回运行记录
      </button>

      <header className="content-head">
        <div className="content-head-main">
          <span className="agent-avatar agent-avatar-lg">{initials(detail.agentName)}</span>
          <div className="content-head-copy">
            <div className="kicker">Run / Replay</div>
            <h1>{detail.agentName}</h1>
            <p>
              {formatFullDateTime(detail.startedAt)} 发起 · {detail.plan.length} 个计划步骤 ·{" "}
              {detail.delegations.length} 个子智能体
            </p>
          </div>
        </div>
        <div className="content-head-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
          >
            <RefreshCw size={15} className={refreshing ? "spin" : undefined} />
            刷新
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate(`/agents/${detail.agentId}`)}
          >
            <Settings2 size={15} />
            编排配置
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate(`/agents/${detail.agentId}/run`)}
          >
            再次运行
            <ArrowRight size={14} />
          </button>
        </div>
      </header>

      <div className="run-task-bar">
        <span className="run-task-label mono">TASK</span>
        <p>{detail.task}</p>
        <span className="run-detail-duration mono">{formatDuration(detail.durationMs)}</span>
        <StatusPill status={detail.status} />
      </div>

      <RunResultView
        run={detail}
        artifacts={detail.artifactFiles}
        live={detail.status === "running"}
      />
    </div>
  );
}
