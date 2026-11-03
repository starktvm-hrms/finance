import { useEffect, useState } from "react";
import Directory from "./pages/Directory";
import Login from "./pages/Login";
import People from "./pages/People";
import { BRAND_MARK } from "./lib/brand";
import { areaOfPage, pageAllowed } from "./lib/access";
import { useStore } from "./lib/store";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import JobDetails from "./pages/JobDetails";
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
  { id: "people", label: "Employees", icon: "◎" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

export default function App() {
  const { ready, error, data, storageName, sync, auth, user, signOut, access, can } = useStore();
  const allowedPages = PAGES.filter((p) => can(areaOfPage(p.id)));
  const { page, params } = useRoute();
  // Landing on the dashboard without access to it: open the first page this role has.
  useEffect(() => {
    if (ready && page === "dashboard" && !can("dashboard") && allowedPages[0]) go(allowedPages[0].id);
  }, [ready, page, access]); // eslint-disable-line react-hooks/exhaustive-deps
  const [navOpen, setNavOpen] = useState(false);
  const nav = (id: PageId, params?: Record<string, string>) => {
    go(id, params);
    setNavOpen(false);
  };
  // "clients" is the old route for the Clients list; it now lives in the Clients & Vendors page.
  const inDirectory = page === "clients" || page === "vendors";
  const isActive = (id: PageId) => id === page || (id === "vendors" && inDirectory) || (id === "projects" && page === "job");
  const pageLabel = inDirectory ? "Clients & Vendors" : page === "job" ? "Job Details" : PAGES.find((p) => p.id === page)?.label;

  if (auth === "checking") return <div className="splash">Loading…</div>;
  if (auth === "signed-out") return <Login />;

  return (
    <div className="shell">
      <aside className={`sidebar ${navOpen ? "open" : ""}`}>
        <div className="brand">
          <img className="logo" src={BRAND_MARK} alt="" />
          <div>
            <div className="brand-name">{data.settings.agencyName}</div>
            <div className="brand-sub">Finance</div>
          </div>
        </div>
        <nav>
          {allowedPages.map((p) => (
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
        {auth === "signed-in" && (
          <div className="sidebar-user">
            <span className="who" title={`Signed in as ${user} (${access.roleName})`}>
              {user}
              <span className="muted small"> · {access.roleName}</span>
            </span>
            <button className="btn ghost" onClick={signOut}>Sign out</button>
          </div>
        )}
      </aside>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      <main className="main">
        <div className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setNavOpen(true)} aria-label="Open menu">☰</button>
          <span className="topbar-title">{pageLabel}</span>
        </div>
        {error && (
          <div className="alert">
            {sync === "error" ? <>Changes are not being saved: {error}. Keep this tab open; it retries automatically.</> : error}
          </div>
        )}
        {!ready ? (
          <div className="empty">Loading…</div>
        ) : !pageAllowed(page, can) ? (
          <div className="page">
            <div className="card empty">
              <h2>No access</h2>
              <p className="muted">Your role ({access.roleName}) doesn't include this page. Ask an admin if you need it.</p>
              {allowedPages[0] && <button className="btn primary" onClick={() => nav(allowedPages[0].id)}>Go to {allowedPages[0].label}</button>}
            </div>
          </div>
        ) : (
          <>
            {page === "dashboard" && <Dashboard />}
            {page === "estimates" && <Estimates key={params.toString()} params={params} />}
            {page === "invoices" && <Invoices key={params.toString()} params={params} />}
            {page === "expenses" && <Expenses key={params.toString()} params={params} />}
            {page === "projects" && <Projects key={params.toString()} params={params} />}
            {page === "job" && <JobDetails key={params.get("id")} id={params.get("id") ?? ""} />}
            {page === "people" && <People key={params.toString()} params={params} />}
            {inDirectory && <Directory key={params.toString()} tab={page === "clients" ? "clients" : params.get("category") ?? "clients"} />}
            {page === "settings" && <SettingsPage />}
          </>
        )}
      </main>
    </div>
  );
}
