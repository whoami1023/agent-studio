import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { KeyRound, Power, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import type { AdminUserEntry } from "../../shared/types";
import { api } from "../api";
import { useApp } from "../state";
import { initials } from "../lib/format";
import { Modal, ConfirmDialog } from "../components/Modal";
import { StatusPill } from "../components/StatusPill";

function formatDate(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export function AdminPage() {
  const { user, notify } = useApp();
  const [users, setUsers] = useState<AdminUserEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminUserEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUserEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ username: "", displayName: "", password: "" });
  const [resetPassword, setResetPassword] = useState("");

  async function loadUsers() {
    try {
      const result = await api.admin.listUsers();
      setUsers(result.users);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "无法加载账户列表");
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  async function handleCreate() {
    if (!form.username.trim() || !form.password || busy) return;
    setBusy(true);
    try {
      await api.admin.createUser({
        username: form.username.trim(),
        displayName: form.displayName.trim() || undefined,
        password: form.password,
      });
      await loadUsers();
      setCreateOpen(false);
      setForm({ username: "", displayName: "", password: "" });
      notify(`账户「${form.username.trim()}」已创建`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "创建失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPassword() {
    if (!resetTarget || resetPassword.length < 6 || busy) return;
    setBusy(true);
    try {
      await api.admin.resetPassword(resetTarget.id, resetPassword);
      setResetTarget(null);
      setResetPassword("");
      notify(`已重置「${resetTarget.username}」的密码`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "重置失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(entry: AdminUserEntry) {
    if (busy) return;
    setBusy(true);
    try {
      await api.admin.setUserStatus(entry.id, !entry.disabled);
      await loadUsers();
      notify(
        entry.disabled ? `已启用「${entry.username}」` : `已停用「${entry.username}」`,
        "success",
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "操作失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || busy) return;
    setBusy(true);
    try {
      await api.admin.deleteUser(deleteTarget.id);
      await loadUsers();
      notify(`已删除「${deleteTarget.username}」及其数据`, "success");
      setDeleteTarget(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : "删除失败", "error");
    } finally {
      setBusy(false);
    }
  }

  if (user?.role !== "admin") return <Navigate to="/" replace />;

  return (
    <div className="page admin-page">
      <section className="section">
        <div className="section-head">
          <div className="section-heading">
            <h2>账户管理</h2>
            <span className="count-badge mono">{users?.length ?? 0}</span>
            <span className="section-sub">创建账户、重置密码、停用或删除账户</span>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
            <UserPlus size={14} />
            新建账户
          </button>
        </div>

        {loadError ? (
          <div className="panel empty-panel">
            <ShieldCheck size={17} />
            <span>{loadError}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadUsers()}>
              重试
            </button>
          </div>
        ) : users === null ? (
          <div className="panel empty-panel">
            <span>正在加载账户…</span>
          </div>
        ) : (
          <div className="table-panel">
            <div className="admin-head table-head">
              <span>账户</span>
              <span>角色</span>
              <span>状态</span>
              <span>数据量</span>
              <span>创建时间</span>
              <span aria-hidden="true" />
            </div>
            {users.map((entry) => {
              const isSelf = entry.id === user.id;
              const isAdminRow = entry.role === "admin";
              return (
                <div key={entry.id} className="admin-row">
                  <span className="admin-user">
                    <span className="user-avatar">{initials(entry.displayName || entry.username)}</span>
                    <span className="admin-user-copy">
                      <span className="admin-username">
                        {entry.displayName}
                        {isSelf ? <span className="tag tag-muted">当前</span> : null}
                      </span>
                      <span className="admin-user-meta mono">@{entry.username}</span>
                    </span>
                  </span>
                  <span>
                    {isAdminRow ? (
                      <span className="tag tag-accent">管理员</span>
                    ) : (
                      <span className="tag tag-muted">普通用户</span>
                    )}
                  </span>
                  <StatusPill
                    status={entry.disabled ? "failed" : "completed"}
                    label={entry.disabled ? "已停用" : "正常"}
                    compact
                  />
                  <span className="admin-stats mono">
                    {entry.agentCount} 智能体 · {entry.skillCount} 技能 · {entry.runCount} 运行
                  </span>
                  <span className="admin-created">{formatDate(entry.createdAt)}</span>
                  <span className="admin-actions">
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm"
                      onClick={() => {
                        setResetPassword("");
                        setResetTarget(entry);
                      }}
                      aria-label={`重置 ${entry.username} 的密码`}
                      title="重置密码"
                    >
                      <KeyRound size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm"
                      onClick={() => void handleToggle(entry)}
                      disabled={isSelf || busy}
                      aria-label={entry.disabled ? `启用 ${entry.username}` : `停用 ${entry.username}`}
                      title={entry.disabled ? "启用账户" : "停用账户"}
                    >
                      <Power size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm icon-btn-danger"
                      onClick={() => setDeleteTarget(entry)}
                      disabled={isSelf || isAdminRow || busy}
                      aria-label={`删除 ${entry.username}`}
                      title={isAdminRow ? "不能删除管理员" : "删除账户"}
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建账户"
        eyebrow="New account"
        footer={
          <>
            <span className="modal-foot-note">新账户会获得一套可编辑的内置技能</span>
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
                disabled={busy || !form.username.trim() || form.password.length < 6}
              >
                {busy ? "创建中…" : "创建账户"}
              </button>
            </div>
          </>
        }
      >
        <div className="form-stack">
          <label className="field">
            <span className="field-label">用户名（登录名）</span>
            <input
              className="input mono-input"
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              placeholder="例如：zhangsan"
              autoFocus
              maxLength={32}
              spellCheck={false}
            />
            <span className="field-hint">2-32 位，字母、数字、下划线、短横线或中文。</span>
          </label>
          <label className="field">
            <span className="field-label">显示名称（可选）</span>
            <input
              className="input"
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
              placeholder="例如：张三"
              maxLength={40}
            />
          </label>
          <label className="field">
            <span className="field-label">初始密码</span>
            <input
              className="input mono-input"
              type="text"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              placeholder="至少 6 位"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="form-hint-card">
            <ShieldCheck size={15} />
            创建后请把用户名和初始密码告知使用者，登录后可由管理员随时重置。
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(resetTarget)}
        onClose={() => setResetTarget(null)}
        title={`重置密码 · ${resetTarget?.username ?? ""}`}
        eyebrow="Reset password"
        footer={
          <div className="modal-foot-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setResetTarget(null)}
              disabled={busy}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleResetPassword}
              disabled={busy || resetPassword.length < 6}
            >
              {busy ? "重置中…" : "确认重置"}
            </button>
          </div>
        }
      >
        <div className="form-stack">
          <label className="field">
            <span className="field-label">新密码</span>
            <input
              className="input mono-input"
              type="text"
              value={resetPassword}
              onChange={(event) => setResetPassword(event.target.value)}
              placeholder="至少 6 位"
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            <span className="field-hint">重置后该账户的所有登录会话将立即失效。</span>
          </label>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`删除账户「${deleteTarget?.username ?? ""}」`}
        message={
          <>
            该账户及其全部智能体、技能与运行记录将被永久删除，此操作不可撤销。
            {deleteTarget?.disabled ? null : "建议先停用账户再确认删除。"}
          </>
        }
        busy={busy}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
