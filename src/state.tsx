import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import type {
  BootstrapPayload,
  MainAgent,
  PublicSettings,
  RunRecord,
  Skill,
} from "../shared/types";
import { api } from "./api";
import { cx } from "./lib/format";

type ToastTone = "info" | "success" | "error";
export type Theme = "light" | "dark";

const THEME_KEY = "agent-studio.theme";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* localStorage unavailable */
  }
  return "light";
}

interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
}

interface AppContextValue {
  agents: MainAgent[];
  skills: Skill[];
  runs: RunRecord[];
  settings: PublicSettings;
  loading: boolean;
  loadError: string | null;
  refresh: () => Promise<void>;
  notify: (message: string, tone?: ToastTone) => void;
  applySettings: (settings: PublicSettings) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const defaultSettings: PublicSettings = {
  mode: "demo",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  hasApiKey: false,
  envKeyAvailable: false,
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#ffffff" : "#171717");
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* localStorage unavailable */
    }
  }, [theme]);

  const refresh = useCallback(async () => {
    try {
      const payload = await api.bootstrap();
      setData(payload);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "无法加载工作区");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const notify = useCallback((message: string, tone: ToastTone = "info") => {
    const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts((current) => [...current.slice(-3), { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  const applySettings = useCallback((settings: PublicSettings) => {
    setData((current) => (current ? { ...current, settings } : current));
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      agents: data?.agents ?? [],
      skills: data?.skills ?? [],
      runs: data?.runs ?? [],
      settings: data?.settings ?? defaultSettings,
      loading,
      loadError,
      refresh,
      notify,
      applySettings,
      settingsOpen,
      setSettingsOpen,
      theme,
      setTheme,
    }),
    [data, loading, loadError, refresh, notify, applySettings, settingsOpen, theme],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={cx("toast", `toast-${toast.tone}`)}>
            <span className="toast-icon">
              {toast.tone === "success" ? (
                <CheckCircle2 size={17} />
              ) : toast.tone === "error" ? (
                <AlertTriangle size={17} />
              ) : (
                <Info size={17} />
              )}
            </span>
            <span className="toast-message">{toast.message}</span>
            <button
              type="button"
              className="toast-close"
              aria-label="关闭提示"
              onClick={() =>
                setToasts((current) => current.filter((item) => item.id !== toast.id))
              }
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
