import { useState } from "react";
import Directory from "./pages/Directory";
import { useStore } from "./lib/store";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import Invoices from "./pages/Invoices";
import Estimates from "./pages/Estimates";
import { go, useRoute, type PageId } from "./lib/route";
import Expenses from "./pages/Expenses";
import SettingsPage from "./pages/Settings";

const PAGES: { id: PageId; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "◧" },
  { id: "projects", label: "Jobs", icon: "◩" },
  { id: "estimates", label: "Estimates", icon: "▥" },
  { id: "invoices", label: "Invoices", icon: "▤" },
  { id: "expenses", label: "Expenses", icon: "◫" },
  { id: "vendors", label: "Clients & Vendors", icon: "◉" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

export default function App() {
  const { ready, error, data, storageName, sync } = useStore();
  const { page, params } = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  const nav = (id: PageId, params?: Record<string, string>) => {
    go(id, params);
    setNavOpen(false);
  };
  // "clients" is the old route for the Clients list; it now lives in the Clients & Vendors page.
  const inDirectory = page === "clients" || page === "vendors";
  const isActive = (id: PageId) => id === page || (id === "vendors" && inDirectory);
  const pageLabel = inDirectory ? "Clients & Vendors" : PAGES.find((p) => p.id === page)?.label;

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
            <button key={p.id} className={`nav-item ${isActive(p.id) ? "active" : ""}`} onClick={() => nav(p.id)}>
              <span className="nav-icon">{p.icon}</span>
              {p.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot muted">
          <span className={`sync-dot ${sync}`} />
          {sync === "saving" ? "Saving…" : sync === "error" ? "Not saved – retrying" : sync === "loading" ? "Loading…" : `Saved · ${storageName}`}
        </div>
      </aside>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      <main className="main">
        <div className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setNavOpen(true)} aria-label="Open menu">☰</button>
          <span className="topbar-title">{pageLabel}</span>
        </div>
        {error && <div className="alert">Changes are not being saved: {error}. Keep this tab open; it retries automatically.</div>}
        {!ready ? (
          <div className="empty">Loading…</div>
        ) : (
          <>
            {page === "dashboard" && <Dashboard />}
            {page === "estimates" && <Estimates key={params.toString()} params={params} />}
            {page === "invoices" && <Invoices key={params.toString()} params={params} />}
            {page === "expenses" && <Expenses key={params.toString()} params={params} />}
            {page === "projects" && <Projects key={params.toString()} params={params} />}
            {inDirectory && <Directory key={params.toString()} tab={page === "clients" ? "clients" : params.get("category") ?? "clients"} />}
            {page === "settings" && <SettingsPage />}
          </>
        )}
      </main>
    </div>
  );
}
