import { useState } from "react";
import type { Project, ProjectStatus } from "../types";
import { useStore } from "../lib/store";
import { projectFinancials } from "../lib/metrics";
import { fmtDate, money, today, uid } from "../lib/util";
import { Badge, Empty, Field, Modal, PageHeader, confirmDelete } from "../components/ui";

export const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: string }> = {
  lead: { label: "Lead", tone: "neutral" },
  active: { label: "Active", tone: "info" },
  on_hold: { label: "On hold", tone: "warn" },
  completed: { label: "Completed", tone: "good" },
  cancelled: { label: "Cancelled", tone: "bad" },
};

export default function Projects() {
  const { data, upsert, remove } = useStore();
  const s = data.settings;
  const [edit, setEdit] = useState<Project | null>(null);
  const [status, setStatus] = useState<ProjectStatus | "all">("all");

  const blank = (): Project => ({ id: uid(), clientId: data.clients[0]?.id ?? "", name: "", status: "active", budget: 0, startDate: today(), endDate: "", notes: "", createdAt: new Date().toISOString() });
  const clientName = (id: string) => data.clients.find((c) => c.id === id)?.name ?? "—";
  const rows = data.projects.filter((p) => status === "all" || p.status === status);

  const del = (p: Project) => {
    if (data.invoices.some((i) => i.projectId === p.id) || data.expenses.some((e) => e.projectId === p.id)) {
      if (!window.confirm(`"${p.name}" has linked invoices/expenses. They will be kept but unlinked. Continue?`)) return;
      data.invoices.filter((i) => i.projectId === p.id).forEach((i) => upsert("invoices", { ...i, projectId: "" }));
      data.expenses.filter((e) => e.projectId === p.id).forEach((e) => upsert("expenses", { ...e, projectId: "" }));
    } else if (!confirmDelete(p.name)) return;
    remove("projects", p.id);
  };

  return (
    <div className="page">
      <PageHeader
        title="Projects"
        subtitle="Track budget, billing and profitability per project."
        actions={
          <>
            <select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus | "all")} aria-label="Status filter">
              <option value="all">All statuses</option>
              {Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <button className="btn primary" disabled={!data.clients.length} title={!data.clients.length ? "Add a client first" : ""} onClick={() => setEdit(blank())}>+ New project</button>
          </>
        }
      />
      <div className="card flush">
        {rows.length === 0 ? (
          <Empty>{data.clients.length ? "No projects yet." : "Add a client first, then create projects for them."}</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Project</th><th>Status</th><th className="num">Budget</th><th className="num">Invoiced</th><th className="num">Costs</th><th className="num">Profit</th><th>Billed</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const f = projectFinancials(data, p.id);
                const pct = p.budget ? Math.min(100, Math.round((f.invoiced / p.budget) * 100)) : 0;
                return (
                  <tr key={p.id} className="clickable" onClick={() => setEdit(p)}>
                    <td><strong>{p.name}</strong><div className="muted small">{clientName(p.clientId)} · {fmtDate(p.startDate, s.locale)}</div></td>
                    <td><Badge tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</Badge></td>
                    <td className="num">{money(p.budget, s)}</td>
                    <td className="num">{money(f.invoiced, s)}</td>
                    <td className="num">{money(f.cost, s)}</td>
                    <td className={`num ${f.profit < 0 ? "bad" : "good"}`}>{money(f.profit, s)}</td>
                    <td style={{ minWidth: 90 }}>
                      <div className="bar-track" title={`${pct}% of budget invoiced`}><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
                      <div className="muted small">{pct}%</div>
                    </td>
                    <td className="actions"><button className="btn ghost danger" onClick={(e) => (e.stopPropagation(), del(p))}>Delete</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {edit && (
        <Modal title={data.projects.some((p) => p.id === edit.id) ? "Edit project" : "New project"} onClose={() => setEdit(null)}>
          <form className="form" onSubmit={(e) => { e.preventDefault(); upsert("projects", edit); setEdit(null); }}>
            <Field label="Project name" span={2}><input required autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Client">
              <select required value={edit.clientId} onChange={(e) => setEdit({ ...edit, clientId: e.target.value })}>
                {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as ProjectStatus })}>
                {Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <Field label={`Budget (${s.currency})`}><input type="number" min={0} step="0.01" value={edit.budget} onChange={(e) => setEdit({ ...edit, budget: Number(e.target.value) })} /></Field>
            <div />
            <Field label="Start date"><input type="date" value={edit.startDate} onChange={(e) => setEdit({ ...edit, startDate: e.target.value })} /></Field>
            <Field label="End date"><input type="date" value={edit.endDate} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} /></Field>
            <Field label="Notes" span={2}><textarea rows={2} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
            <div className="form-actions span2">
              <button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn primary">Save project</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
