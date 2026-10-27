import { useState, type FormEvent } from "react";
import { KeyRound, LogIn, Paperclip, User } from "lucide-react";
import { useApp } from "../state";

export function LoginPage() {
  const { login, loadError } = useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || !username.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <span className="brand-mark brand-mark-lg">
            <Paperclip size={20} />
          </span>
          <h1>Agent Studio</h1>
          <p>多智能体编排工作台 · 账户登录</p>
        </div>

        {loadError ? <div className="login-error">服务不可用：{loadError}</div> : null}
        {error ? <div className="login-error">{error}</div> : null}

        <label className="field">
          <span className="field-label">用户名</span>
          <div className="input-with-action">
            <User size={15} className="input-leading" />
            <input
              className="input has-leading"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoFocus
              autoComplete="username"
              spellCheck={false}
              placeholder="请输入用户名"
            />
          </div>
        </label>

        <label className="field">
          <span className="field-label">密码</span>
          <div className="input-with-action">
            <KeyRound size={15} className="input-leading" />
            <input
              className="input has-leading"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="请输入密码"
            />
          </div>
        </label>

        <button
          type="submit"
          className="btn btn-primary login-submit"
          disabled={busy || !username.trim() || !password}
        >
          <LogIn size={15} />
          {busy ? "登录中…" : "登录"}
        </button>

        <span className="login-hint">账户由管理员创建，如需新账户请联系管理员。</span>
      </form>
    </div>
  );
}
