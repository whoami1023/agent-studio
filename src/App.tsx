import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { BootScreen } from "./components/BootScreen";
import { useApp } from "./state";
import { LoginPage } from "./pages/LoginPage";
import { Dashboard } from "./pages/Dashboard";
import { AgentEditor } from "./pages/AgentEditor";
import { RunPage } from "./pages/RunPage";
import { RunDetailPage } from "./pages/RunDetailPage";
import { RunsPage } from "./pages/RunsPage";
import { SkillsPage } from "./pages/SkillsPage";
import { AdminPage } from "./pages/AdminPage";

function Root() {
  const { user, loading } = useApp();

  if (loading) return <BootScreen />;
  if (!user) return <LoginPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="agents/:id" element={<AgentEditor />} />
        <Route path="agents/:id/run" element={<RunPage />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/:id" element={<RunDetailPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  );
}
