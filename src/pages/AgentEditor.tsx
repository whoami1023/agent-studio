import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  History,
  Pencil,
  Play,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { MainAgent, Skill, SubAgentConfig } from "../../shared/types";
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
import { StatusPill } from "../components/StatusPill";
import { ConfirmDialog, Modal } from "../components/Modal";

interface SubagentDraft {
  id?: string;
  name: string;
  description: string;
  systemPrompt: string;
  skillIds: string[];
}

const emptySubagent: SubagentDraft = {
  name: "",
  description: "",
  systemPrompt: "",
  skillIds: [],
};

const newId = () =>
  `sub_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-3)}`;

export function AgentEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { agents, skills, runs, refresh, notify } = useApp();
  const agent = agents.find((item) => item.id === id);
  const [draft, setDraft] = useState<MainAgent | null>(null);
  const [saving, setSaving] = useState(false);
  const [subagentOpen, setSubagentOpen] = useState(false);
  const [subagentForm, setSubagentForm] = useState<SubagentDraft>(emptySubagent);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [subagentError, setSubagentError] = useState("");
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);
  const [deleteAgentOpen, setDeleteAgentOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (agent) setDraft(structuredClone(agent));
    // initialize once per agent id; edits are tracked in the local draft
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.id]);

  const agentRuns = useMemo(
    () => runs.filter((run) => run.agentId === id),
    [runs, id],
  );

  if (!agent || !draft) {
    return (
      <div className="page">
        <div className="empty-hero">
          <span className="empty-hero-icon">
            <Bot size={24} />
          </span>
          <h3>智能体不存在</h3>
          <p>它可能已被删除，返回工作区查看其他智能体。</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate("/")}>
            <ArrowLeft size={15} />
            返回工作区
          </button>
        </div>
      </div>
    );
  }

  const dirty =
    JSON.stringify({
      name: draft.name,
      description: draft.description,
      systemPrompt: draft.systemPrompt,
      subagents: draft.subagents,
    }) !==
    JSON.stringify({
      name: agent.name,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      subagents: agent.subagents,
    });

  async function saveDraft(): Promise<boolean> {
    if (!draft || saving) return false;
    if (!draft.name.trim() || !draft.description.trim()) {
      notify("名称和描述不能为空", "error");
      return false;
    }
    setSaving(true);
    try {
      const result = await api.updateAgent(draft.id, {
        name: draft.name.trim(),
        description: draft.description.trim(),
        systemPrompt: draft.systemPrompt,
        subagents: draft.subagents.map((subagent) => ({
          id: subagent.id,
          name: subagent.name,
          description: subagent.description,
          systemPrompt: subagent.systemPrompt,
          skillIds: subagent.skillIds,
        })),
      });
      setDraft(structuredClone(result.agent));
      await refresh();
      notify("编排配置已保存", "success");
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "保存失败", "error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleRun() {
    if (!draft) return;
    if (dirty) {
      const saved = await saveDraft();
      if (!saved) return;
    }
    navigate(`/agents/${draft.id}/run`);
  }

  function openCreateSubagent() {
    setEditingIndex(null);
    setSubagentForm({ ...emptySubagent, skillIds: [] });
    setSubagentError("");
    setSubagentOpen(true);
  }

  function openEditSubagent(index: number) {
    const subagent = draft?.subagents[index];
    if (!subagent) return;
    setEditingIndex(index);
    setSubagentForm({
      id: subagent.id,
      name: subagent.name,
      description: subagent.description,
      systemPrompt: subagent.systemPrompt,
      skillIds: [...subagent.skillIds],
    });
    setSubagentError("");
    setSubagentOpen(true);
  }

  function saveSubagent() {
    if (!draft) return;
    const name = subagentForm.name.trim();
    const description = subagentForm.description.trim();
    if (!name || !description) {
      setSubagentError("请填写子智能体名称与描述");
      return;
    }
    const duplicate = draft.subagents.some(
      (subagent, index) => subagent.name === name && index !== editingIndex,
    );
    if (duplicate) {
      setSubagentError("子智能体名称不能重复，主智能体用名称分派任务");
      return;
    }
    const next: SubAgentConfig = {
      id: subagentForm.id ?? newId(),
      name,
      description,
      systemPrompt: subagentForm.systemPrompt,
      skillIds: subagentForm.skillIds,
    };
    setDraft({
      ...draft,
      subagents:
        editingIndex === null
          ? [...draft.subagents, next]
          : draft.subagents.map((subagent, index) =>
              index === editingIndex ? next : subagent,
            ),
    });
    setSubagentOpen(false);
    notify(editingIndex === null ? "子智能体已加入草稿，保存后生效" : "子智能体配置已更新", "success");
  }

  function removeSubagent() {
    if (!draft || removeIndex === null) return;
    setDraft({
      ...draft,
      subagents: draft.subagents.filter((_, index) => index !== removeIndex),
    });
    setRemoveIndex(null);
    notify("已从草稿移除，保存后生效", "info");
  }

  async function deleteAgent() {
    if (!draft || deleting) return;
    setDeleting(true);
    try {
      await api.deleteAgent(draft.id);
      await refresh();
      notify("智能体已删除", "success");
      navigate("/");
    } catch (error) {
      notify(error instanceof Error ? error.message : "删除失败", "error");
    } finally {
      setDeleting(false);
    }
  }

  const selectedSkills = draft.subagents.reduce((total, subagent) => total + subagent.skillIds.length, 0);

  return (
    <div className="page editor-page">
      <button type="button" className="back-link" onClick={() => navigate("/")}>
        <ArrowLeft size={14} />
        返回工作区
      </button>

      <header className="content-head">
        <div className="content-head-main">
          <span className="agent-avatar agent-avatar-lg">{initials(draft.name)}</span>
          <div className="content-head-copy">
            <div className="kicker">Agent / Orchestration</div>
            <h1>{draft.name || "未命名智能体"}</h1>
            <p>{draft.description || "为这个智能体补充一句描述。"}</p>
          </div>
        </div>
        <div className="content-head-actions">
          {draft.builtin ? null : (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setDeleteAgentOpen(true)}
              aria-label="删除智能体"
              title="删除智能体"
            >
              <Trash2 size={15} />
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void saveDraft()}
            disabled={!dirty || saving}
          >
            <Save size={15} />
            {saving ? "保存中…" : "保存更改"}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void handleRun()}>
            <Play size={15} />
            运行任务
          </button>
        </div>
      </header>

      {dirty ? (
        <div className="dirty-banner">
          <span className="dirty-dot" />
          有未保存的更改
          <button type="button" className="dirty-save" onClick={() => void saveDraft()}>
            立即保存
          </button>
        </div>
      ) : null}

      <section className="panel identity-panel">
        <div className="panel-head">
          <div className="panel-title">
            <CircleDot size={16} />
            <span>身份与角色</span>
          </div>
          <span className="panel-meta">主智能体会读取这些信息</span>
        </div>
        <div className="identity-grid">
          <label className="field">
            <span className="field-label">名称</span>
            <input
              className="input"
              value={draft.name}
              maxLength={40}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <div className="identity-summary">
            <span className="mono">{draft.subagents.length}</span>
            <span>个子智能体</span>
            <span className="dot-sep" />
            <span className="mono">{selectedSkills}</span>
            <span>个技能绑定</span>
          </div>
          <label className="field field-wide">
            <span className="field-label">描述</span>
            <textarea
              className="input textarea"
              rows={2}
              maxLength={400}
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
            <span className="field-hint">描述会展示在任务面板，并帮助主智能体理解自己的职责。</span>
          </label>
          <label className="field field-wide">
            <span className="field-label">系统提示词（可选）</span>
            <textarea
              className="input textarea mono-input"
              rows={4}
              maxLength={6000}
              value={draft.systemPrompt}
              placeholder="补充主智能体的工作原则，例如：优先并行分派互不依赖的子任务。"
              onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })}
            />
          </label>
        </div>
      </section>

      <section className="section subagents-section">
        <div className="section-head">
          <div className="section-heading">
            <h2>子智能体编队</h2>
            <span className="count-badge mono">{draft.subagents.length}</span>
            <span className="section-sub">
              每个子智能体拥有独立描述与技能，由主智能体通过 task 工具并行调用
            </span>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={openCreateSubagent}>
            <Plus size={14} />
            添加子智能体
          </button>
        </div>

        {draft.subagents.length === 0 ? (
          <div className="empty-hero empty-hero-compact">
            <span className="empty-hero-icon">
              <Bot size={22} />
            </span>
            <h3>还没有子智能体</h3>
            <p>为不同视角配置子智能体，主智能体才能在任务到来时并行分派。</p>
            <button type="button" className="btn btn-primary" onClick={openCreateSubagent}>
              <Plus size={15} />
              添加第一个子智能体
            </button>
          </div>
        ) : (
          <div className="table-panel subagent-list">
            <div className="subagent-list-head table-head">
              <span aria-hidden="true" />
              <span>角色</span>
              <span>技能</span>
              <span aria-hidden="true" />
            </div>
            {draft.subagents.map((subagent, index) => {
              const boundSkills = subagent.skillIds
                .map((skillId) => skills.find((skill) => skill.id === skillId))
                .filter((skill): skill is Skill => Boolean(skill));
              return (
                <div key={subagent.id} className="subagent-row">
                  <span className="subagent-index mono">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="subagent-main">
                    <div className="subagent-title-row">
                      <h3>{subagent.name}</h3>
                      <span className="subagent-status">
                        <span className="subagent-status-dot" />
                        待命
                      </span>
                    </div>
                    <p>{subagent.description}</p>
                  </div>
                  <div className="subagent-skills">
                    {boundSkills.length === 0 ? (
                      <span className="subagent-no-skill">未绑定技能</span>
                    ) : (
                      boundSkills.map((skill) => (
                        <span key={skill.id} className="skill-chip">
                          <Sparkles size={11} />
                          {skill.name}
                        </span>
                      ))
                    )}
                  </div>
                  <div className="subagent-actions">
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm"
                      onClick={() => openEditSubagent(index)}
                      aria-label={`编辑 ${subagent.name}`}
                      title="编辑"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm"
                      onClick={() => setRemoveIndex(index)}
                      aria-label={`移除 ${subagent.name}`}
                      title="移除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
            <button type="button" className="subagent-add-row" onClick={openCreateSubagent}>
              <Plus size={14} />
              <span>添加子智能体</span>
              <span className="subagent-add-hint">设置职责与技能组合</span>
            </button>
          </div>
        )}
      </section>

      <section className="panel history-panel">
        <div className="panel-head">
          <div className="panel-title">
            <History size={15} />
            <span>运行历史</span>
            <span className="panel-count mono">{agentRuns.length}</span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate("/runs")}>
            查看全部
            <ArrowRight size={13} />
          </button>
        </div>
        {agentRuns.length === 0 ? (
          <div className="history-empty">
            <Bot size={16} />
            还没有运行记录。保存配置后点击「运行任务」发起第一次协作。
          </div>
        ) : (
          <div className="history-list">
            <div className="history-head table-head">
              <span>状态</span>
              <span>任务</span>
              <span>链路</span>
              <span>耗时</span>
              <span>时间</span>
              <span aria-hidden="true" />
            </div>
            {agentRuns.slice(0, 6).map((run) => (
              <button
                key={run.id}
                type="button"
                className="history-row"
                onClick={() => navigate(`/runs/${run.id}`)}
              >
                <StatusPill status={run.status} label={RUN_LABEL[run.status]} compact />
                <span className="history-task">{truncate(run.task, 86)}</span>
                <span className="history-meta mono">{run.delegations.length} 子智能体</span>
                <span className="history-duration mono">{formatDuration(run.durationMs)}</span>
                <span className="history-time">{relativeTime(run.startedAt)}</span>
                <ChevronRight size={14} className="history-arrow" />
              </button>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={subagentOpen}
        onClose={() => setSubagentOpen(false)}
        title={editingIndex === null ? "添加子智能体" : "编辑子智能体"}
        eyebrow="Subagent"
        size="lg"
        footer={
          <>
            <span className="modal-foot-note">
              {subagentForm.skillIds.length} 个技能将被加载
            </span>
            <div className="modal-foot-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSubagentOpen(false)}
              >
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={saveSubagent}>
                {editingIndex === null ? "加入编队" : "更新子智能体"}
              </button>
            </div>
          </>
        }
      >
        <div className="form-stack">
          {subagentError ? <div className="form-error">{subagentError}</div> : null}
          <div className="form-row">
            <label className="field">
              <span className="field-label">名称</span>
              <input
                className="input"
                value={subagentForm.name}
                maxLength={40}
                placeholder="例如：市场调研员"
                onChange={(event) => {
                  setSubagentForm({ ...subagentForm, name: event.target.value });
                  setSubagentError("");
                }}
                autoFocus
              />
            </label>
            <label className="field">
              <span className="field-label">职责描述</span>
              <input
                className="input"
                value={subagentForm.description}
                maxLength={400}
                placeholder="负责调研市场与竞品，输出可追溯的洞察"
                onChange={(event) => setSubagentForm({ ...subagentForm, description: event.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span className="field-label">系统提示词（可选）</span>
            <textarea
              className="input textarea"
              rows={3}
              maxLength={4000}
              value={subagentForm.systemPrompt}
              placeholder="补充这个角色的工作方式与输出要求。留空时使用默认角色提示。"
              onChange={(event) =>
                setSubagentForm({ ...subagentForm, systemPrompt: event.target.value })
              }
            />
          </label>
          <div className="field">
            <div className="field-label-row">
              <span className="field-label">技能</span>
              <span className="field-hint">技能会以 SKILL.md 注入该子智能体的工作区</span>
            </div>
            {skills.length === 0 ? (
              <div className="form-hint-card">
                <Sparkles size={15} />
                技能库还是空的，先到技能库创建或恢复技能。
              </div>
            ) : (
              <div className="skill-picker">
                {skills.map((skill) => {
                  const selected = subagentForm.skillIds.includes(skill.id);
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      className={cx("skill-option", selected && "is-selected")}
                      onClick={() =>
                        setSubagentForm({
                          ...subagentForm,
                          skillIds: selected
                            ? subagentForm.skillIds.filter((id) => id !== skill.id)
                            : [...subagentForm.skillIds, skill.id],
                        })
                      }
                      aria-pressed={selected}
                    >
                      <span className="skill-option-check">{selected ? <Check size={12} /> : null}</span>
                      <span className="skill-option-copy">
                        <span className="skill-option-name">{skill.name}</span>
                        <span className="skill-option-desc">{skill.description}</span>
                      </span>
                      <span className="skill-option-slug mono">{skill.slug}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={removeIndex !== null}
        title="移除子智能体"
        message={
          <>
            将从草稿中移除
            {removeIndex !== null && draft.subagents[removeIndex]
              ? `「${draft.subagents[removeIndex].name}」`
              : "该子智能体"}
            ，保存后生效。历史运行记录不受影响。
          </>
        }
        confirmLabel="移除"
        onClose={() => setRemoveIndex(null)}
        onConfirm={removeSubagent}
      />

      <ConfirmDialog
        open={deleteAgentOpen}
        title={`删除「${draft.name}」`}
        message="该智能体及其全部子智能体配置会被删除，历史运行记录会保留。此操作不可撤销。"
        busy={deleting}
        onClose={() => setDeleteAgentOpen(false)}
        onConfirm={deleteAgent}
      />

      {dirty ? (
        <div className="save-dock">
          <span className="dirty-dot" />
          <span>有未保存的更改</span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void saveDraft()}
            disabled={saving}
          >
            <Save size={14} />
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
