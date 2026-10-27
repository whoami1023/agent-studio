import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, Server, ShieldCheck, Sparkles, Zap } from "lucide-react";
import type { ProviderMode } from "../../shared/types";
import { api } from "../api";
import { useApp } from "../state";
import { cx } from "../lib/format";
import { Modal } from "./Modal";

const PRESETS: Array<{ label: string; baseUrl: string; model: string }> = [
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  {
    label: "百炼 / Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
  },
  { label: "Ollama 本地", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5:7b" },
];

export function SettingsDialog() {
  const { settings, settingsOpen, setSettingsOpen, applySettings, notify, theme, setTheme } =
    useApp();
  const [mode, setMode] = useState<ProviderMode>(settings.mode);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settingsOpen) return;
    setMode(settings.mode);
    setBaseUrl(settings.baseUrl);
    setModel(settings.model);
    setApiKey("");
    setClearKey(false);
    setReveal(false);
  }, [settingsOpen, settings.mode, settings.baseUrl, settings.model]);

  const typedKey = apiKey.trim().length > 0;
  const effectiveKey = clearKey
    ? typedKey || settings.envKeyAvailable
    : typedKey || settings.hasApiKey || settings.envKeyAvailable;
  const canSave = mode === "demo" || (effectiveKey && baseUrl.trim() && model.trim());

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const result = await api.updateSettings({
        mode,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: typedKey ? apiKey.trim() : undefined,
        clearApiKey: clearKey && !typedKey,
      });
      applySettings(result.settings);
      notify(mode === "demo" ? "已切换到演示模式" : "真实模型配置已保存", "success");
      setSettingsOpen(false);
    } catch (error) {
      notify(error instanceof Error ? error.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      title="模型与运行设置"
      eyebrow="Settings"
      size="lg"
      footer={
        <>
          <span className="modal-foot-note">
            <ShieldCheck size={14} />
            配置仅保存在本机服务端
          </span>
          <div className="modal-foot-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setSettingsOpen(false)}
              disabled={saving}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!canSave || saving}
            >
              {saving ? "保存中…" : "保存设置"}
            </button>
          </div>
        </>
      }
    >
      <div className="settings-stack">
        <div className="settings-group">
          <span className="field-label">界面主题</span>
          <div className="mode-grid">
            <button
              type="button"
              className={cx("mode-card", theme === "light" && "is-active")}
              onClick={() => setTheme("light")}
              aria-pressed={theme === "light"}
            >
              <span className="theme-swatch theme-swatch-light" aria-hidden="true" />
              <span className="mode-copy">
                <strong>浅色</strong>
                <span>Paperclip 风格，界面默认使用。</span>
              </span>
              <span className="mode-check" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={cx("mode-card", theme === "dark" && "is-active")}
              onClick={() => setTheme("dark")}
              aria-pressed={theme === "dark"}
            >
              <span className="theme-swatch theme-swatch-dark" aria-hidden="true" />
              <span className="mode-copy">
                <strong>深色</strong>
                <span>低亮度控制台，适合弱光环境。</span>
              </span>
              <span className="mode-check" aria-hidden="true" />
            </button>
          </div>
          <span className="field-hint">主题偏好保存在当前浏览器，切换后立即生效。</span>
        </div>

        <div className="settings-group">
          <span className="field-label">模型通道</span>
          <div className="mode-grid">
            <button
              type="button"
              className={cx("mode-card", mode === "demo" && "is-active")}
              onClick={() => setMode("demo")}
              aria-pressed={mode === "demo"}
            >
              <span className="mode-icon">
                <Sparkles size={18} />
              </span>
              <span className="mode-copy">
                <strong>演示模式</strong>
                <span>本地确定性模型，离线验证拆解、分派与汇总链路，不消耗额度。</span>
              </span>
              <span className="mode-check" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={cx("mode-card", mode === "openai" && "is-active")}
              onClick={() => setMode("openai")}
              aria-pressed={mode === "openai"}
            >
              <span className="mode-icon">
                <Server size={18} />
              </span>
              <span className="mode-copy">
                <strong>OpenAI 兼容接口</strong>
                <span>接入任意兼容 Chat Completions 的服务，让真实模型驱动协作。</span>
              </span>
              <span className="mode-check" aria-hidden="true" />
            </button>
          </div>
        </div>

        {mode === "demo" ? (
          <div className="settings-note">
            <Zap size={15} />
            <div>
              <strong>无需 API Key。</strong>
              演示模型会读取子智能体的技能配置，生成结构化的并行交付，用于观察完整编排行为。
            </div>
          </div>
        ) : (
          <div className="settings-form">
            <div className="preset-row">
              <span className="field-hint">快速填充</span>
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="chip chip-button"
                  onClick={() => {
                    setBaseUrl(preset.baseUrl);
                    setModel(preset.model);
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <label className="field">
              <span className="field-label">Base URL</span>
              <input
                className="input"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://api.openai.com/v1"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span className="field-label">模型名称</span>
              <input
                className="input mono-input"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="gpt-4o-mini"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span className="field-label">API Key</span>
              <div className="input-with-action">
                <KeyRound size={15} className="input-leading" />
                <input
                  className="input has-leading"
                  type={reveal ? "text" : "password"}
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    if (event.target.value) setClearKey(false);
                  }}
                  placeholder={
                    settings.hasApiKey ? "已保存，留空保持不变" : "sk-… 或本地服务的 key"
                  }
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="input-action"
                  onClick={() => setReveal((value) => !value)}
                  aria-label={reveal ? "隐藏密钥" : "显示密钥"}
                >
                  {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <span className="field-hint">
                {typedKey
                  ? "保存后写入本机配置。"
                  : settings.hasApiKey
                    ? "已保存服务端密钥，留空不会覆盖。"
                    : settings.envKeyAvailable
                      ? "检测到 OPENAI_API_KEY 环境变量，可直接使用。"
                      : "服务端尚未配置密钥。"}
              </span>
            </label>
            {settings.hasApiKey ? (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={clearKey}
                  onChange={(event) => {
                    setClearKey(event.target.checked);
                    if (event.target.checked) setApiKey("");
                  }}
                />
                <span>清除已保存的 API Key</span>
              </label>
            ) : null}
            <div className="settings-note settings-note-quiet">
              <ShieldCheck size={15} />
              <div>
                密钥只在服务端用于调用模型，不会返回前端。请求会直接发送到你填写的 Base URL。
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
