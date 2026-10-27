import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  History,
  LayoutGrid,
  Library,
  LogOut,
  Paperclip,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useApp } from "../state";
import { cx, initials } from "../lib/format";
import { BootScreen } from "./BootScreen";
import { SettingsDialog } from "./SettingsDialog";

const NAV = [
  { to: "/", label: "工作台", icon: LayoutGrid, end: true },
  { to: "/skills", label: "技能库", icon: Library, end: false },
  { to: "/runs", label: "运行记录", icon: History, end: false },
];

function pageMeta(pathname: string): { section: string; label: string } {
  if (pathname === "/") return { section: "Workspace", label: "工作台" };
  if (pathname === "/skills") return { section: "Workspace", label: "技能库" };
  if (pathname === "/runs") return { section: "Workspace", label: "运行记录" };
  if (pathname === "/admin") return { section: "Admin", label: "账户管理" };
  if (/^\/runs\/[^/]+$/.test(pathname)) return { section: "Run", label: "运行详情" };
  if (/^\/agents\/[^/]+\/run$/.test(pathname)) return { section: "Agent", label: "任务运行" };
  if (/^\/agents\/[^/]+$/.test(pathname)) return { section: "Agent", label: "智能体编排" };
  return { section: "Workspace", label: "工作台" };
}

export function Layout() {
  const { loading, loadError, user, logout, settings, setSettingsOpen, refresh, agents } =
    useApp();
  const { pathname } = useLocation();
  const meta = pageMeta(pathname);

  if (loading) {
    return <BootScreen />;
  }

  if (loadError && agents.length === 0) {
    return <BootScreen error={loadError} onRetry={() => void refresh()} />;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label="Agent Studio 首页">
          <span className="brand-mark">
            <Paperclip size={17} />
          </span>
          <span className="brand-copy">
            <span className="brand-name">Agent Studio</span>
            <span className="brand-sub">多智能体控制台</span>
          </span>
        </NavLink>

        <NavLink to="/?new=1" className="sidebar-create">
          <Plus size={15} />
          新建智能体
        </NavLink>

        <nav className="nav" aria-label="主导航">
          <span className="nav-label">工作</span>
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => cx("nav-link", isActive && "is-active")}
              >
                <Icon size={15} strokeWidth={1.8} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {user?.role === "admin" ? (
          <nav className="nav nav-admin" aria-label="管理导航">
            <span className="nav-label">管理</span>
            <NavLink
              to="/admin"
              className={({ isActive }) => cx("nav-link", isActive && "is-active")}
            >
              <ShieldCheck size={15} strokeWidth={1.8} />
              <span>账户管理</span>
            </NavLink>
          </nav>
        ) : null}

        <div className="sidebar-agents">
          <div className="sidebar-agents-head">
            <span className="nav-label">智能体</span>
            <span className="sidebar-count mono">{agents.length}</span>
          </div>
          <div className="sidebar-agent-list">
            {agents.length === 0 ? (
              <span className="sidebar-empty">尚未创建智能体</span>
            ) : (
              agents.slice(0, 6).map((agent) => (
                <NavLink
                  key={agent.id}
                  to={`/agents/${agent.id}`}
                  className={({ isActive }) =>
                    cx("sidebar-agent", isActive && "is-active")
                  }
                  title={agent.description}
                >
                  <span className="sidebar-agent-avatar">{initials(agent.name)}</span>
                  <span className="sidebar-agent-copy">
                    <span className="sidebar-agent-name">{agent.name}</span>
                    <span className="sidebar-agent-meta mono">
                      {agent.subagents.length} agents
                    </span>
                  </span>
                </NavLink>
              ))
            )}
          </div>
        </div>

        <div className="sidebar-bottom">
          <button
            type="button"
            className="provider-card"
            onClick={() => setSettingsOpen(true)}
          >
            <span className={cx("provider-dot", settings.mode === "openai" && "is-live")} />
            <span className="provider-copy">
              <span className="provider-label">
                {settings.mode === "demo" ? "演示模式" : "OpenAI 兼容"}
              </span>
              <span className="provider-model mono">{settings.model}</span>
            </span>
            <Settings2 size={14} className="provider-settings" />
          </button>

          <div className="sidebar-user">
            <span className="user-avatar">
              {initials(user?.displayName || user?.username || "?")}
            </span>
            <span className="user-copy">
              <span className="user-name">{user?.displayName}</span>
              <span className="user-meta mono">
                {user?.role === "admin" ? "管理员" : `@${user?.username}`}
              </span>
            </span>
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              onClick={() => void logout()}
              aria-label="退出登录"
              title="退出登录"
            >
              <LogOut size={14} />
            </button>
          </div>

          <div className="sidebar-meta">
            <Sparkles size={11} />
            <span>deepagents.js · LangGraph</span>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">
            <span className="topbar-section mono">{meta.section}</span>
            <span className="topbar-page">{meta.label}</span>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className={cx("mode-chip", settings.mode === "openai" && "is-live")}
              onClick={() => setSettingsOpen(true)}
            >
              <span className="mode-dot" />
              {settings.mode === "demo" ? "演示模式" : settings.model}
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setSettingsOpen(true)}
              aria-label="打开模型设置"
              title="模型设置"
            >
              <Settings2 size={15} />
            </button>
          </div>
        </header>

        <main className="main-inner">
          <Outlet />
        </main>
      </div>

      <nav className="mobile-nav" aria-label="移动端导航">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => cx("mobile-nav-link", isActive && "is-active")}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          className="mobile-nav-link"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 size={18} strokeWidth={1.8} />
          <span>设置</span>
        </button>
      </nav>

      <SettingsDialog />
    </div>
  );
}
