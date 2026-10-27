import { AlertTriangle, Paperclip, RefreshCw } from "lucide-react";

export function BootScreen({
  error,
  onRetry,
}: {
  error?: string | null;
  onRetry?: () => void;
}) {
  if (error) {
    return (
      <div className="boot-screen boot-error">
        <div className="boot-error-icon">
          <AlertTriangle size={20} />
        </div>
        <h1>无法连接本地服务</h1>
        <p>{error}</p>
        {onRetry ? (
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            <RefreshCw size={15} />
            重试连接
          </button>
        ) : null}
        <span className="boot-hint">请确认已在项目目录运行 npm run dev</span>
      </div>
    );
  }
  return (
    <div className="boot-screen">
      <div className="brand-mark brand-mark-lg">
        <Paperclip size={20} />
      </div>
      <div className="boot-copy">
        <span className="boot-title">Agent Studio</span>
        <span className="boot-sub">正在连接编排中枢…</span>
      </div>
      <div className="boot-bar">
        <span />
      </div>
    </div>
  );
}
