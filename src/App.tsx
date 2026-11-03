import { useEffect, useState } from "react";
import { useStore } from "./lib/store";
import Dashboard from "./pages/Dashboard";
import Clients from "./pages/Clients";
import Projects from "./pages/Projects";
import Invoices from "./pages/Invoices";
import Expenses from "./pages/Expenses";
import SettingsPage from "./pages/Settings";

const PAGES = [
  { id: "dashboard", label: "Dashboard", icon: "◧" },
  { id: "invoices", label: "Invoices", icon: "▤" },
  { id: "expenses", label: "Expenses", icon: "◫" },
  { id: "projects", label: "Projects", icon: "◩" },
  { id: "clients", label: "Clients", icon: "◉" },
  { id: "settings", label: "Settings", icon: "⚙" },
] as const;
type PageId = (typeof PAGES)[number]["id"];

const fromHash = (): PageId => {
  const h = window.location.hash.replace("#/", "") as PageId;
  return PAGES.some((p) => p.id === h) ? h : "dashboard";
};

export default function App() {
  const { ready, error, data, storageName } = useStore();
  const [page, setPage] = useState<PageId>(fromHash);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const on = () => setPage(fromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const go = (id: PageId) => {
    window.location.hash = `#/${id}`;
    setNavOpen(false);
  };

  return (
    <div className="shell">
      <aside className={`sidebar ${navOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="logo">₹</div>
          <div>
            <div className="brand-name">{data.settings.agencyName}</div>
            <div className="brand-sub">Finance</div>
          </div>
        </div>
        <nav>
          {PAGES.map((p) => (
            <button key={p.id} className={`nav-item ${page === p.id ? "active" : ""}`} onClick={() => go(p.id)}>
              <span className="nav-icon">{p.icon}</span>
              {p.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot muted">Storage: {storageName}</div>
      </aside>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      <main className="main">
        <div className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setNavOpen(true)} aria-label="Open menu">☰</button>
          <span className="topbar-title">{PAGES.find((p) => p.id === page)?.label}</span>
        </div>
        {error && <div className="alert">Sync problem: {error}</div>}
        {!ready ? (
          <div className="empty">Loading…</div>
        ) : (
          <>
            {page === "dashboard" && <Dashboard go={go} />}
            {page === "invoices" && <Invoices />}
            {page === "expenses" && <Expenses />}
            {page === "projects" && <Projects />}
            {page === "clients" && <Clients />}
            {page === "settings" && <SettingsPage />}
          </>
        )}
      </main>
    </div>
  );
}
