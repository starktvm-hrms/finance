import { useState } from "react";
import { VENDOR_CATEGORIES } from "./types";
import Vendors, { vendorCategory } from "./pages/Vendors";
import { useStore } from "./lib/store";
import Dashboard from "./pages/Dashboard";
import Clients from "./pages/Clients";
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
];

/** "Clients & Vendors" group: clients plus one list per vendor category. */
const MASTERS: { label: string; page: PageId; category?: string }[] = [
  { label: "Clients", page: "clients" },
  ...VENDOR_CATEGORIES.map((c) => ({ label: c.label, page: "vendors" as PageId, category: c.id })),
];

const GROUP_KEY = "agency-finance:nav:masters-open";
const readOpen = () => {
  try {
    return localStorage.getItem(GROUP_KEY) !== "0";
  } catch {
    return true;
  }
};

export default function App() {
  const { ready, error, data, storageName, sync } = useStore();
  const { page, params } = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  const [mastersOpen, setMastersOpen] = useState(readOpen);
  const nav = (id: PageId, params?: Record<string, string>) => {
    go(id, params);
    setNavOpen(false);
  };
  const toggleMasters = () => {
    setMastersOpen((o) => {
      try {
        localStorage.setItem(GROUP_KEY, o ? "0" : "1");
      } catch {
        /* per-viewer convenience only */
      }
      return !o;
    });
  };
  const inMasters = page === "clients" || page === "vendors";
  const isActiveMaster = (m: (typeof MASTERS)[number]) =>
    m.page === page && (m.page !== "vendors" || vendorCategory(params.get("category")).id === m.category);
  const pageLabel = page === "vendors" ? vendorCategory(params.get("category")).label : page === "clients" ? "Clients" : PAGES.find((p) => p.id === page)?.label;
  const settingsItem = { id: "settings" as PageId, label: "Settings", icon: "⚙" };

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
            <button key={p.id} className={`nav-item ${page === p.id ? "active" : ""}`} onClick={() => nav(p.id)}>
              <span className="nav-icon">{p.icon}</span>
              {p.label}
            </button>
          ))}

          <button
            className={`nav-item nav-group ${inMasters && !mastersOpen ? "active" : ""}`}
            onClick={toggleMasters}
            aria-expanded={mastersOpen}
            aria-controls="nav-masters"
          >
            <span className="nav-icon">◉</span>
            Clients &amp; Vendors
            <span className={`nav-chevron ${mastersOpen ? "open" : ""}`} aria-hidden>›</span>
          </button>
          {mastersOpen && (
            <div id="nav-masters" className="nav-sub">
              {MASTERS.map((m) => {
                const active = isActiveMaster(m);
                return (
                  <button
                    key={m.label}
                    className={`nav-item nav-subitem ${active ? "active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => nav(m.page, m.category ? { category: m.category } : undefined)}
                  >
                    <span className="nav-bullet" aria-hidden />
                    {m.label}
                  </button>
                );
              })}
            </div>
          )}

          <button className={`nav-item ${page === "settings" ? "active" : ""}`} onClick={() => nav("settings")}>
            <span className="nav-icon">{settingsItem.icon}</span>
            {settingsItem.label}
          </button>
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
            {page === "vendors" && <Vendors key={params.toString()} params={params} />}
            {page === "projects" && <Projects key={params.toString()} params={params} />}
            {page === "clients" && <Clients />}
            {page === "settings" && <SettingsPage />}
          </>
        )}
      </main>
    </div>
  );
}
