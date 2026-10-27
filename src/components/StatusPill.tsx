import { cx } from "../lib/format";

const LABELS: Record<string, string> = {
  running: "编排中",
  completed: "已完成",
  failed: "失败",
  queued: "排队中",
  skipped: "未调用",
};

export function StatusPill({
  status,
  label,
  compact = false,
}: {
  status: string;
  label?: string;
  compact?: boolean;
}) {
  return (
    <span className={cx("pill", `pill-${status}`, compact && "pill-compact")}>
      <span className="pill-dot" aria-hidden="true" />
      {label ?? LABELS[status] ?? status}
    </span>
  );
}
