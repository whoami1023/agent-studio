import { useMemo, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Library,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import type { Skill, SkillInput } from "../../shared/types";
import { api } from "../api";
import { useApp } from "../state";
import { cx, relativeTime } from "../lib/format";
import { ConfirmDialog, Modal } from "../components/Modal";

interface SkillForm {
  name: string;
  slug: string;
  description: string;
  instructions: string;
}

const emptyForm: SkillForm = {
  name: "",
  slug: "",
  description: "",
  instructions: "",
};

const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

export function SkillsPage() {
  const { skills, agents, refresh, notify } = useApp();
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [form, setForm] = useState<SkillForm>(emptyForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Skill | null>(null);
  const [busy, setBusy] = useState(false);

  const refCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const agent of agents) {
      for (const subagent of agent.subagents) {
        for (const id of subagent.skillIds) {
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
    }
    return counts;
  }, [agents]);

  const customCount = skills.filter((skill) => !skill.builtin).length;
  const boundCount = skills.reduce((total, skill) => total + (refCounts.get(skill.id) ?? 0), 0);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return skills;
    return skills.filter((skill) =>
      [skill.name, skill.slug, skill.description]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [skills, query]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(skill: Skill) {
    setEditing(skill);
    setForm({
      name: skill.name,
      slug: skill.slug,
      description: skill.description,
      instructions: skill.instructions,
    });
    setFormError("");
    setFormOpen(true);
  }

  async function saveSkill() {
    if (saving) return;
    const name = form.name.trim();
    const description = form.description.trim();
    const instructions = form.instructions.trim();
    const slug = form.slug.trim();
    if (!name || !description) {
      setFormError("请填写技能名称与描述");
      return;
    }
    if (instructions.length < 10) {
      setFormError("技能说明至少需要 10 个字符");
      return;
    }
    if (!editing && slug && !SLUG_PATTERN.test(slug)) {
      setFormError("技能标识需为小写字母、数字或短横线，2-32 位");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const input: SkillInput = { name, description, instructions };
      if (editing) {
        await api.updateSkill(editing.id, input);
      } else {
        await api.createSkill({ ...input, slug: slug || undefined });
      }
      await refresh();
      setFormOpen(false);
      notify(editing ? "技能已更新" : "技能已创建", "success");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSkill() {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      await api.deleteSkill(deleting.id);
      await refresh();
      notify(`已删除技能「${deleting.name}」`, "success");
      setDeleting(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : "删除失败", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page skills-page">
      <div className="page-toolbar">
        <div className="toolbar-side">
          <div className="search-box">
            <Search size={14} />
            <input
              className="search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索技能…"
              aria-label="搜索技能"
            />
          </div>
          <span className="toolbar-meta mono">
            {filtered.length} / {skills.length}
          </span>
        </div>
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          <Plus size={15} />
          新建技能
        </button>
      </div>

      <section className="stat-rail" aria-label="技能概览">
        <div className="stat">
          <span className="stat-label">技能总数</span>
          <span className="stat-value mono">{skills.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">内置方法</span>
          <span className="stat-value mono">{skills.length - customCount}</span>
        </div>
        <div className="stat">
          <span className="stat-label">自定义技能</span>
          <span className="stat-value mono">{customCount}</span>
        </div>
        <div className="stat">
          <span className="stat-label">角色绑定</span>
          <span className="stat-value mono">{boundCount}</span>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div className="section-heading">
            <h2>全部技能</h2>
            <span className="count-badge mono">{filtered.length}</span>
            <span className="section-sub">
              技能说明会作为方法指引随子智能体的系统提示一起加载
            </span>
          </div>
          <span className="section-sub mono">{skills.length} loaded</span>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-hero empty-hero-compact">
            <span className="empty-hero-icon">
              <BookOpen size={22} />
            </span>
            <h3>{skills.length === 0 ? "技能库是空的" : "没有匹配的技能"}</h3>
            <p>
              {skills.length === 0
                ? "创建技能来描述一类工作的标准方法，再把它绑定给子智能体。"
                : "换个关键词试试，或直接创建一个新技能。"}
            </p>
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <Plus size={15} />
              新建技能
            </button>
          </div>
        ) : (
          <div className="table-panel skill-list">
            <div className="skill-list-head table-head">
              <span>技能</span>
              <span>描述</span>
              <span>引用</span>
              <span>更新时间</span>
              <span aria-hidden="true" />
            </div>
            {filtered.map((skill) => {
              const expanded = expandedId === skill.id;
              const references = refCounts.get(skill.id) ?? 0;
              return (
                <div
                  key={skill.id}
                  className={cx("skill-row", expanded && "is-open")}
                >
                  <div className="skill-row-main">
                    <span className="skill-glyph">
                      {skill.builtin ? <Library size={15} /> : <Wand2 size={15} />}
                    </span>
                    <span className="skill-identity">
                      <span className="skill-name-row">
                        <strong className="skill-name">{skill.name}</strong>
                        <span className={cx("tag", skill.builtin ? "tag-muted" : "tag-accent")}>
                          {skill.builtin ? "内置" : "自定义"}
                        </span>
                      </span>
                      <span className="skill-slug mono">/{skill.slug}</span>
                    </span>
                    <span className="skill-desc">{skill.description}</span>
                    <span className="skill-refs mono">{references}</span>
                    <span className="skill-updated">{relativeTime(skill.updatedAt)}</span>
                    <span className="skill-actions">
                      <button
                        type="button"
                        className="icon-btn icon-btn-sm"
                        onClick={() => setExpandedId(expanded ? null : skill.id)}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "收起" : "查看"} ${skill.name} 的技能说明`}
                        title={expanded ? "收起说明" : "查看说明"}
                      >
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn-sm"
                        onClick={() => openEdit(skill)}
                        aria-label={`编辑 ${skill.name}`}
                        title="编辑"
                      >
                        <Pencil size={14} />
                      </button>
                      {skill.builtin ? null : (
                        <button
                          type="button"
                          className="icon-btn icon-btn-sm icon-btn-danger"
                          onClick={() => setDeleting(skill)}
                          aria-label={`删除 ${skill.name}`}
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </span>
                  </div>
                  {expanded ? (
                    <div className="skill-instructions-wrap">
                      <div className="skill-instructions-head">
                        <span className="mono">/skills/{skill.slug}/SKILL.md</span>
                        <span className="mono">{skill.instructions.length} chars</span>
                      </div>
                      <pre className="skill-instructions">{skill.instructions}</pre>
                    </div>
                  ) : null}
                </div>
              );
            })}
            <button type="button" className="skill-add-row" onClick={openCreate}>
              <Plus size={14} />
              <span>新建技能</span>
              <span className="skill-add-hint">沉淀一套可复用的工作方法</span>
            </button>
          </div>
        )}
      </section>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `编辑「${editing.name}」` : "新建技能"}
        eyebrow="Skill"
        size="lg"
        footer={
          <>
            <span className="modal-foot-note">
              {editing ? (
                <>标识 <span className="mono">/{editing.slug}</span> 创建后不可更改</>
              ) : (
                "标识留空时会自动生成"
              )}
            </span>
            <div className="modal-foot-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setFormOpen(false)}
                disabled={saving}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void saveSkill()}
                disabled={saving}
              >
                {saving ? "保存中…" : editing ? "保存技能" : "创建技能"}
              </button>
            </div>
          </>
        }
      >
        <div className="form-stack">
          {formError ? <div className="form-error">{formError}</div> : null}
          <div className="form-row">
            <label className="field">
              <span className="field-label">技能名称</span>
              <input
                className="input"
                value={form.name}
                maxLength={40}
                placeholder="例如：竞品拆解"
                onChange={(event) => {
                  setForm({ ...form, name: event.target.value });
                  setFormError("");
                }}
                autoFocus
              />
            </label>
            <label className="field">
              <span className="field-label">标识（可选）</span>
              <input
                className="input mono-input"
                value={form.slug}
                maxLength={32}
                placeholder="competitive-analysis"
                spellCheck={false}
                disabled={Boolean(editing)}
                onChange={(event) =>
                  setForm({ ...form, slug: event.target.value.toLowerCase().trim() })
                }
              />
              <span className="field-hint">
                {editing
                  ? "技能标识用于生成 /skills/<slug>/SKILL.md"
                  : "小写字母、数字与短横线；留空则自动生成"}
              </span>
            </label>
          </div>
          <label className="field">
            <span className="field-label">描述</span>
            <textarea
              className="input textarea"
              rows={2}
              maxLength={400}
              value={form.description}
              placeholder="一句话说明这个技能解决什么问题。"
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">技能说明（Markdown）</span>
            <textarea
              className="input textarea mono-input textarea-code"
              rows={10}
              maxLength={12000}
              value={form.instructions}
              placeholder={"# 方法\n\n- 先确认目标与范围\n- 拆解关键步骤\n- 输出结构化结论"}
              onChange={(event) => setForm({ ...form, instructions: event.target.value })}
              spellCheck={false}
            />
            <span className="field-hint">
              会写入 SKILL.md 正文，子智能体在开始工作前加载。用 Markdown 列表写清步骤与输出结构。
            </span>
          </label>
          <div className="form-hint-card">
            <Sparkles size={15} />
            技能只提供方法，不绑定模型。同一个技能可以被多个子智能体复用。
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`删除「${deleting?.name ?? ""}」`}
        message={
          <>
            该技能会从 {deleting ? refCounts.get(deleting.id) ?? 0 : 0} 个子智能体的技能绑定中移除，
            历史运行记录不受影响。此操作不可撤销。
          </>
        }
        busy={busy}
        onClose={() => setDeleting(null)}
        onConfirm={deleteSkill}
      />
    </div>
  );
}
