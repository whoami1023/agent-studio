import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  Network,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
  Waypoints,
} from "lucide-react";
import type { MainAgent, SubagentSuggestion } from "../../shared/types";
import { api } from "../api";
import { useApp } from "../state";
import {
  cx,
  formatDuration,
  initials,
  relativeTime,
  RUN_LABEL,
  truncate,
} from "../lib/format";
import { Modal, ConfirmDialog } from "../components/Modal";
import { StatusPill } from "../components/StatusPill";

export function Dashboard() {
  const { agents, skills, runs, settings, refresh, notify, setSettingsOpen, user } = useApp();
  const isAdmin = user?.role === "admin";
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<MainAgent | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", systemPrompt: "" });

  const subagentCount = agents.reduce((total, agent) => total + agent.subagents.length, 0);
  const recentRuns = runs.slice(0, 6);

  function openCreate() {
    setForm({ name: "", description: "", systemPrompt: "" });
    setCreateOpen(true);
  }

  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    openCreate();
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  async function handleCreate() {
    if (!form.name.trim() || !form.description.trim() || busy) return;
    setBusy(true);
    try {
      const input = {
        name: form.name.trim(),
        description: form.description.trim(),
        systemPrompt: form.systemPrompt.trim(),
      };
      let suggestions: SubagentSuggestion[] = [];
      let source: "demo" | "model" | null = null;
      try {
        const result = await api.suggestSubagents(input);
        suggestions = result.subagents;
        source = result.source;
      } catch {
        // 推荐失败不阻塞创建
      }
      const result = await api.createAgent({
        ...input,
        subagents: suggestions.map((suggestion) => ({
          name: suggestion.name,
          description: suggestion.description,
          systemPrompt: suggestion.systemPrompt,
          skillIds: suggestion.skillIds,
        })),
      });
      await refresh();
      setCreateOpen(false);
      notify(
        suggestions.length > 0
          ? `已生成 ${suggestions.length} 个推荐子智能体（${source === "model" ? "模型生成" : "内置模板"}），可随时修改`
          : "主智能体已创建，接下来添加子智能体",
        "success",
      );
      navigate(`/agents/${result.agent.id}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "创建失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      await api.deleteAgent(deleting.id);
      await refresh();
      notify(`已删除「${deleting.name}」`, "success");
      setDeleting(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : "删除失败", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page dashboard-page">
      {settings.mode === "demo" ? (
        <div className="notice-strip">
          <span className="notice-icon">
            <Sparkles size={14} />
          </span>
          <span>
            <strong>演示模式</strong> · 本地确定性模型会完整执行拆解、分派与汇总，无需 API Key。
          </span>
          {isAdmin ? (
            <button type="button" className="notice-action" onClick={() => setSettingsOpen(true)}>
              接入真实模型
              <ArrowRight size={13} />
            </button>
          ) : null}
        </div>
      ) : null}

      <section className="stat-rail" aria-label="工作区概览">
        <div className="stat">
          <span className="stat-label">主智能体</span>
          <span className="stat-value mono">{agents.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">子智能体</span>
          <span className="stat-value mono">{subagentCount}</span>
        </div>
        <div className="stat">
          <span className="stat-label">可用技能</span>
          <span className="stat-value mono">{skills.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">累计运行</span>
          <span className="stat-value mono">{runs.length}</span>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div className="section-heading">
            <h2>主智能体</h2>
            <span className="count-badge mono">{agents.length}</span>
            <span className="section-sub">各自拥有独立的子智能体编队与技能组合</span>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            <Plus size={14} />
            新建智能体
          </button>
        </div>

        {agents.length === 0 ? (
          <div className="empty-hero">
            <span className="empty-hero-icon">
              <Network size={22} />
            </span>
            <h3>还没有主智能体</h3>
            <p>创建一个主智能体，为它配置描述、系统提示词与多个子智能体。</p>
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <Wand2 size={15} />
              创建第一个智能体
            </button>
          </div>
        ) : (
          <div className="agent-grid">
            {agents.map((agent) => {
              const agentRuns = runs.filter((run) => run.agentId === agent.id);
              const lastRun = agentRuns[0];
              const uniqueSkills = new Set(
                agent.subagents.flatMap((subagent) => subagent.skillIds),
              ).size;
              return (
                <article
                  key={agent.id}
                  className="agent-card"
                  onClick={() => navigate(`/agents/${agent.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") navigate(`/agents/${agent.id}`);
                  }}
                  role="link"
                  tabIndex={0}
                >
                  <header className="agent-card-head">
                    <span className="agent-avatar">{initials(agent.name)}</span>
                    <div className="agent-card-title">
                      <div className="agent-name-row">
                        <h3 className="agent-name">{agent.name}</h3>
                        {agent.builtin ? <span className="tag tag-muted">内置</span> : null}
                      </div>
                      <span className="agent-card-meta">
                        {lastRun ? `${relativeTime(lastRun.startedAt)}运行` : "尚无运行记录"}
                      </span>
                    </div>
                    {lastRun ? (
                      <StatusPill
                        status={lastRun.status}
                        label={RUN_LABEL[lastRun.status]}
                        compact
                      />
                    ) : (
                      <span className="tag tag-muted">未运行</span>
                    )}
                  </header>

                  <p className="agent-desc">{agent.description}</p>

                  <div className="agent-subs">
                    {agent.subagents.length === 0 ? (
                      <span className="agent-subs-empty">尚未配置子智能体</span>
                    ) : (
                      <>
                        {agent.subagents.slice(0, 3).map((subagent) => (
                          <span key={subagent.id} className="sub-chip">
                            <span className="sub-chip-dot" />
                            {subagent.name}
                          </span>
                        ))}
                        {agent.subagents.length > 3 ? (
                          <span className="sub-chip sub-chip-more">
                            +{agent.subagents.length - 3}
                          </span>
                        ) : null}
                      </>
                    )}
                  </div>

                  <footer className="agent-foot">
                    <div className="agent-foot-meta">
                      <span>
                        <Bot size={13} />
                        {agent.subagents.length} 个子智能体
                      </span>
                      <span>
                        <Sparkles size={13} />
                        {uniqueSkills} 个技能
                      </span>
                    </div>
                    <div className="agent-foot-actions">
                      {agent.builtin ? null : (
                        <button
                          type="button"
                          className="icon-btn icon-btn-sm"
                          aria-label={`删除 ${agent.name}`}
                          title="删除"
                          onClick={(event) => {
                            event.stopPropagation();
                            setDeleting(agent);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-btn icon-btn-sm"
                        aria-label={`运行 ${agent.name}`}
                        title="发起任务"
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/agents/${agent.id}/run`);
                        }}
                      >
                        <Play size={14} />
                      </button>
                      <span className="agent-open">
                        编排
                        <ArrowRight size={14} />
                      </span>
                    </div>
                  </footer>
                </article>
              );
            })}

            <button type="button" className="agent-card agent-card-add" onClick={openCreate}>
              <span className="agent-add-icon">
                <Plus size={18} />
              </span>
              <span className="agent-add-title">新建主智能体</span>
              <span className="agent-add-sub">描述目标，组合子智能体与技能</span>
            </button>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div className="section-heading">
            <h2>最近运行</h2>
            <span className="section-sub">实时链路结果会自动保存到运行记录</span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate("/runs")}
          >
            全部记录
            <ArrowRight size={13} />
          </button>
        </div>

        {recentRuns.length === 0 ? (
          <div className="panel empty-panel">
            <Waypoints size={17} />
            <span>还没有运行记录，打开一个智能体发起第一个任务。</span>
          </div>
        ) : (
          <div className="table-panel recent-table">
            <div className="recent-head table-head">
              <span>状态</span>
              <span>智能体</span>
              <span>任务</span>
              <span>耗时</span>
              <span>时间</span>
              <span aria-hidden="true" />
            </div>
            {recentRuns.map((run) => (
              <button
                key={run.id}
                type="button"
                className="recent-row"
                onClick={() => navigate(`/runs/${run.id}`)}
              >
                <StatusPill status={run.status} compact />
                <span className="recent-agent">{run.agentName}</span>
                <span className="recent-task">{truncate(run.task, 74)}</span>
                <span className="recent-duration mono">{formatDuration(run.durationMs)}</span>
                <span className="recent-time">{relativeTime(run.startedAt)}</span>
                <ArrowRight size={14} className="recent-arrow" />
              </button>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建主智能体"
        eyebrow="New agent"
        footer={
          <>
            <span className="modal-foot-note">将根据描述自动推荐子智能体编队</span>
            <div className="modal-foot-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCreateOpen(false)}
                disabled={busy}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={busy || !form.name.trim() || !form.description.trim()}
              >
                {busy ? "生成推荐编队中…" : "创建并编排"}
              </button>
            </div>
          </>
        }
      >
        <div className="form-stack">
          <label className="field">
            <span className="field-label">智能体名称</span>
            <input
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="例如：增长策略组"
              autoFocus
              maxLength={40}
            />
          </label>
          <label className="field">
            <span className="field-label">描述</span>
            <textarea
              className="input textarea"
              rows={3}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="这个主智能体负责什么？会协调哪些视角？"
              maxLength={400}
            />
            <span className="field-hint">
              描述会出现在任务面板，并作为主智能体的角色说明。
            </span>
          </label>
          <label className="field">
            <span className="field-label">系统提示词（可选）</span>
            <textarea
              className="input textarea"
              rows={3}
              value={form.systemPrompt}
              onChange={(event) => setForm({ ...form, systemPrompt: event.target.value })}
              placeholder="例如：先确认发布目标与约束，再协调各子智能体。"
              maxLength={6000}
            />
          </label>
          <div className="form-hint-card">
            <Sparkles size={15} />
            点击「创建并编排」会根据描述与系统提示词自动推荐子智能体编队，创建后可在编排页逐个修改。
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`删除「${deleting?.name ?? ""}」`}
        message={
          <>
            该主智能体及其 {deleting?.subagents.length ?? 0} 个子智能体配置将被删除，
            历史运行记录会保留。此操作不可撤销。
          </>
        }
        busy={busy}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
