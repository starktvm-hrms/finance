import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore } from "../lib/store";
import { computeMetrics, workflowQueues } from "../lib/metrics";
import { go, type PageId } from "../lib/route";
import { jobsByPerson, scopeInfo, scopeParams, scopedData } from "../lib/scope";
import { notifications } from "../lib/notifications";
import { fmtDate, invoiceTotals, money, monthLabel, shortMoney, today } from "../lib/util";
import { Badge, Empty, PageHeader, Stat } from "../components/ui";
import { PROJECT_STATUS } from "./Projects";
import { ESTIMATE_STATUS } from "./Estimates";
import type { ProjectStatus } from "../types";

const RANGES = [
  { v: 1, label: "This month" },
  { v: 3, label: "Last 3 months" },
  { v: 6, label: "Last 6 months" },
  { v: 12, label: "Last 12 months" },
];

export default function Dashboard() {
  const { data: all, can, access, user, myName, upsert, legacy } = useStore();
  const waiting = notifications(all, access, user, myName).filter((n) => n.needsAction);
  const decide = (jobId: string, status: "approved" | "rejected") => {
    const p = all.projects.find((x) => x.id === jobId);
    if (p?.approval) upsert("projects", { ...p, approval: { ...p.approval, status, decidedDate: today(), decidedBy: myName, decidedAt: new Date().toISOString() } });
  };
  const s = all.settings;
  const [months, setMonths] = useState(6);
  // Department heads see their department, account executives their own work, others everything.
  const info = scopeInfo(all, access, user);
  const data = scopedData(all, info, user, access.employeeId);
  const sp = scopeParams(info);
  const m = computeMetrics(data, months);
  const fm = (n: number) => money(n, s);
  const margin = m.revenue ? Math.round((m.profit / m.revenue) * 100) : 0;
  const chart = m.monthly.map((x) => ({ ...x, label: monthLabel(x.month, s.locale) }));
  const maxCat = m.byCategory[0]?.value || 1;
  const clientName = (id: string) => all.clients.find((c) => c.id === id)?.name ?? "—";
  const w = workflowQueues(data);
  const thisMonth = today().slice(0, 7);
  const newThisMonth = data.projects.filter((p) => (p.startDate || p.createdAt).slice(0, 7) === thisMonth).length;
  const allTiles: { title: string; sub: string; count: number; hint: string; page: PageId; params: Record<string, string>; needs: string[] }[] = [
    { title: "Jobs", sub: "Created", count: data.projects.length, hint: `${newThisMonth} this month`, page: "projects", params: {}, needs: [] },
    { title: "Jobs", sub: "For estimate", count: w.jobsForEstimate.length, hint: "Leads waiting for a quote", page: "projects", params: { status: "needs_estimate" }, needs: [] },
    { title: "Estimates", sub: "Raised", count: data.estimates.length, hint: `${data.estimates.filter((e) => e.status === "draft").length} still in draft`, page: "estimates", params: {}, needs: ["estimates"] },
    { title: "Estimates", sub: "For approval", count: w.estimatesForApproval.length, hint: `${fm(w.approvalValue)} in production and other estimates awaiting the client's decision`, page: "estimates", params: { status: "sent", kind: "production" }, needs: ["estimates"] },
    { title: "Media Estimates", sub: "For approval", count: w.mediaForApproval.length, hint: `${fm(w.mediaApprovalValue)} in media estimates awaiting the client's decision`, page: "estimates", params: { type: "media", status: "sent" }, needs: ["estimates"] },
    { title: "Invoice", sub: "To raise", count: w.invoiceToRaise.length, hint: `${fm(w.toRaiseValue)} approved, not yet invoiced`, page: "estimates", params: { status: "approved" }, needs: ["estimates"] },
    { title: "Invoice", sub: "To collect", count: w.invoiceToCollect.length, hint: `${fm(w.toCollectValue)} sent, not yet paid`, page: "invoices", params: { status: "unpaid" }, needs: ["invoices"] },
  ];
  const tiles = allTiles.filter((t) => t.needs.every(can));
  const openTile = (t: (typeof tiles)[number]) => {
    if (!can(t.page === "projects" ? "jobs" : t.page)) return;
    go(t.page, { ...t.params, ...(t.page !== "invoices" && sp) });
  };
  // A department head gets their department's money even without the Invoices / Expenses tabs (the server sends just those).
  const seeMoney = (can("invoices") && can("expenses")) || info.scope === "department";
  const statuses = (Object.keys(PROJECT_STATUS) as ProjectStatus[]).map((k) => ({ k, n: data.projects.filter((p) => p.status === k).length }));
  const maxStatus = Math.max(1, ...statuses.map((x) => x.n));
  const people = jobsByPerson(all, data.projects);
  const latestEstimate = (jobId: string) => data.estimates.filter((e) => e.projectId === jobId).sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0];
  const recent = [...data.projects].sort((a, b) => (b.startDate || b.createdAt).localeCompare(a.startDate || a.createdAt)).slice(0, 8);

  return (
    <div className="page">
      <PageHeader title="Dashboard" subtitle={access.admin ? undefined : `${access.roleName} · ${info.label}`} />
      {info.problem && <div className="alert">{info.problem}</div>}
      {legacy && (
        <div className="card approvals-card">
          <h3>Switch to the app's own sign-in page</h3>
          <p className="small">
            This site still uses the browser's pop-up login, so the sign-in page, signing out, roles and the demo logins aren't active yet.
            Run this once in the server's terminal (hPanel › VPS › Browser terminal). It keeps your current username and password:
          </p>
          <pre className="cmd">curl -fsSL https://raw.githubusercontent.com/starktvm-hrms/finance/main/deploy/vps-setup.sh -o /tmp/finance-setup.sh && sudo bash /tmp/finance-setup.sh</pre>
        </div>
      )}
      {waiting.length > 0 && (
        <div className="card approvals-card">
          <h3>Waiting for your approval ({waiting.length})</h3>
          <ul>
            {waiting.map((n) => (
              <li key={n.id}>
                <button className="btn ghost" style={{ textAlign: "left", whiteSpace: "normal" }} onClick={() => go("job", { id: n.jobId })}>
                  <strong>{n.body}</strong><div className="muted small">{n.title}</div>
                </button>
                {can("jobs") && (
                  <span className="row gap">
                    <button className="btn good-fill" onClick={() => decide(n.jobId, "approved")}>Approve</button>
                    <button className="btn danger" onClick={() => decide(n.jobId, "rejected")}>Reject</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tiles.length > 0 && <div className="queues" role="list" aria-label="Work queues">
        {tiles.map((t) => (
          <button key={t.title + t.sub} role="listitem" className="card queue" onClick={() => openTile(t)} title={t.hint}>
            <span className="queue-title">{t.title}</span>
            <span className="queue-sub">{t.sub}</span>
            <span className="queue-count">{t.count.toLocaleString(s.locale)}</span>
          </button>
        ))}
      </div>}

      <div className="grid-2 dash-jobs">
        <div className="card">
          <h3>Job status</h3>
          {data.projects.length === 0 ? <Empty>No jobs yet.</Empty> : (
            <div className="bars">
              {statuses.map(({ k, n }) => (
                <button key={k} className="bar-row plain" onClick={() => can("jobs") && go("projects", { status: k, ...sp })} disabled={!can("jobs")}>
                  <div className="bar-label"><span>{PROJECT_STATUS[k].label}</span><span className="num">{n}</span></div>
                  <div className="bar-track"><div className={`bar-fill tone-${PROJECT_STATUS[k].tone}`} style={{ width: `${(n / maxStatus) * 100}%` }} /></div>
                </button>
              ))}
            </div>
          )}
        </div>

        {info.scope === "own" ? (
          <div className="card">
            <h3>My recent jobs</h3>
            {recent.length === 0 ? <Empty>Jobs you create show up here.</Empty> : (
              <div className="scroll-x"><table className="table compact">
                <thead><tr><th>Job</th><th>Status</th><th>Estimate</th></tr></thead>
                <tbody>
                  {recent.map((p) => {
                    const est = latestEstimate(p.id);
                    return (
                      <tr key={p.id} className="clickable" onClick={() => go("job", { id: p.id })}>
                        <td><strong>{p.name}</strong><div className="muted small">{[p.number, clientName(p.clientId)].filter(Boolean).join(" · ")}</div></td>
                        <td><Badge tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</Badge></td>
                        <td className="small">{est ? <>{est.number}<div className="muted">{ESTIMATE_STATUS[est.status].label}</div></> : <span className="warn">Not raised</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            )}
          </div>
        ) : (
          <div className="card">
            <h3>Jobs created by</h3>
            {people.length === 0 ? <Empty>No jobs yet.</Empty> : (
              <div className="scroll-x"><table className="table compact">
                <thead><tr><th>Person</th><th className="num">Jobs</th><th className="num">Open</th></tr></thead>
                <tbody>
                  {people.map((r) => (
                    <tr key={r.key}>
                      <td>{r.name}{r.dept && info.scope === "all" && <div className="muted small">{r.dept}</div>}</td>
                      <td className="num">{r.jobs}</td>
                      <td className="num">{r.open}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        )}
      </div>

      {seeMoney && (
        <>
      <PageHeader
        title="Financials"
        subtitle={`${info.scope === "department" ? `${info.label}. ` : ""}Cash basis: revenue counts invoices when paid, excluding tax.`}
        actions={
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Period">
            {RANGES.map((r) => (
              <option key={r.v} value={r.v}>{r.label}</option>
            ))}
          </select>
        }
      />

      <div className="stats">
        <Stat label="Total revenue" value={fm(m.revenue)} hint={`+ ${fm(m.taxCollected)} tax collected`} />
        <Stat label="Total expenditure" value={fm(m.spent)} hint={`${m.byCategory.length} categories`} />
        <Stat label="Net profit" value={fm(m.profit)} hint={`${margin}% margin`} tone={m.profit >= 0 ? "good" : "bad"} />
        <Stat
          label="Outstanding"
          value={fm(m.outstanding)}
          hint={m.overdue ? `${fm(m.overdue)} overdue` : "Nothing overdue"}
          tone={m.overdue ? "warn" : undefined}
        />
      </div>

      <div className="grid-2">
        <div className="card span-2">
          <h3>Income vs expenses</h3>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} width={64} tick={{ fill: "var(--muted)", fontSize: 12 }} tickFormatter={(v) => shortMoney(v, s)} />
                <Tooltip
                  formatter={(v: number) => fm(v)}
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}
                  cursor={{ fill: "var(--hover)" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="income" name="Income" fill="var(--c-income)" radius={[4, 4, 0, 0]} maxBarSize={36} />
                <Bar dataKey="expenses" name="Expenses" fill="var(--c-expense)" radius={[4, 4, 0, 0]} maxBarSize={36} />
                <Line dataKey="profit" name="Profit" stroke="var(--c-profit)" strokeWidth={2} dot={{ r: 3 }} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h3>Expenses by category</h3>
          {m.byCategory.length === 0 ? (
            <Empty>No expenses in this period.</Empty>
          ) : (
            <div className="bars">
              {m.byCategory.map((c) => (
                <div key={c.name} className="bar-row">
                  <div className="bar-label">
                    <span>{c.name}</span>
                    <span className="num">{fm(c.value)}</span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(c.value / maxCat) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3>Revenue by client</h3>
          {m.byClient.length === 0 ? (
            <Empty>No client revenue yet.</Empty>
          ) : (
            <div className="chart small" style={{ height: Math.max(140, m.byClient.length * 48 + 20) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={m.byClient} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false} tick={{ fill: "var(--text)", fontSize: 12 }} />
                  <Tooltip formatter={(v: number) => fm(v)} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }} cursor={{ fill: "var(--hover)" }} />
                  <Bar dataKey="revenue" name="Revenue" fill="var(--c-income)" radius={[0, 4, 4, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card span-2">
          <div className="row between">
            <h3>Overdue invoices</h3>
            {can("invoices") && <button className="btn ghost" onClick={() => go("invoices", { status: "overdue" })}>All overdue →</button>}
          </div>
          {m.overdueList.length === 0 ? (
            <Empty>No overdue invoices. 🎉</Empty>
          ) : (
            <div className="scroll-x"><table className="table">
              <thead>
                <tr><th>Invoice</th><th>Client</th><th>Due</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {m.overdueList.map((i) => (
                  <tr key={i.id}>
                    <td>{i.number}</td>
                    <td>{clientName(i.clientId)}</td>
                    <td className="bad">{fmtDate(i.dueDate, s.locale)}</td>
                    <td className="num">{fm(invoiceTotals(i).total)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      </div>
        </>
      )}
    </div>
  );
}
