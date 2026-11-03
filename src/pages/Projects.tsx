import { useState } from "react";
import type { Project, ProjectStatus } from "../types";
import { useStore } from "../lib/store";
import { needsEstimate, projectFinancials } from "../lib/metrics";
import { go } from "../lib/route";
import { ESTIMATE_STATUS } from "./Estimates";
import { fmtDate, money, today, uid } from "../lib/util";
import { Badge, Empty, Field, Modal, PageHeader, confirmDelete } from "../components/ui";

export const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: string }> = {
  lead: { label: "Lead", tone: "neutral" },
  active: { label: "Active", tone: "info" },
  on_hold: { label: "On hold", tone: "warn" },
  completed: { label: "Completed", tone: "good" },
  cancelled: { label: "Cancelled", tone: "bad" },
};

type JobFilter = ProjectStatus | "all" | "needs_estimate";

export default function Projects({ params }: { params: URLSearchParams }) {
  const { data, upsert, remove, updateSettings } = useStore();
  const s = data.settings;
  const [edit, setEdit] = useState<Project | null>(null);
  const [status, setStatus] = useState<JobFilter>(() => {
    const f = params.get("status") as JobFilter | null;
    return f && (f === "needs_estimate" || f in PROJECT_STATUS) ? f : "all";
  });
  const latestEstimate = (jobId: string) =>
    data.estimates.filter((e) => e.projectId === jobId).sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0];

  const blank = (): Project => ({
    id: uid(), clientId: "", contactPerson: "", product: "", subProduct: "", name: "", status: "lead",
    budget: 0, startDate: today(), endDate: "", notes: "", createdAt: new Date().toISOString(),
  });

  const saveJob = (job: Project, sendForApproval: boolean, head: string) => {
    let next: Project = { ...job, name: job.name.trim(), product: job.product?.trim(), subProduct: job.subProduct?.trim() };
    next.number = next.number?.trim() || undefined;
    const clash = next.number && data.projects.find((p) => p.id !== job.id && p.number?.toLowerCase() === next.number!.toLowerCase());
    if (clash && !window.confirm(`Job No. ${next.number} is already used by "${clash.name}". Save anyway?`)) return;
    next.jobType = next.jobType?.trim() || undefined;
    if (!next.number) {
      // No number typed: give the next one in the series.
      next.number = `${s.jobPrefix}${String(s.nextJobNumber).padStart(4, "0")}`;
      updateSettings({ nextJobNumber: s.nextJobNumber + 1 });
    }
    if (sendForApproval && head && (next.approval?.head !== head || next.approval?.status === "rejected")) {
      next.approval = { head, status: "pending", decidedDate: "" };
    } else if (!sendForApproval) {
      next = { ...next, approval: undefined };
    }
    upsert("projects", next);
    // Remember new products / sub-products on the client so they can be picked next time.
    const client = data.clients.find((c) => c.id === next.clientId);
    if (client && next.product) {
      const products = [...(client.products ?? [])];
      const i = products.findIndex((p) => p.name.toLowerCase() === next.product!.toLowerCase());
      if (i < 0) products.push({ name: next.product, subProducts: next.subProduct ? [next.subProduct] : [] });
      else if (next.subProduct && !products[i].subProducts.some((x) => x.toLowerCase() === next.subProduct!.toLowerCase()))
        products[i] = { ...products[i], subProducts: [...products[i].subProducts, next.subProduct] };
      if (i < 0 || products[i] !== client.products?.[i]) upsert("clients", { ...client, products });
    }
    setEdit(null);
  };

  const decideApproval = (p: Project, status: "approved" | "rejected") =>
    p.approval && upsert("projects", { ...p, approval: { ...p.approval, status, decidedDate: today() } });
  const clientName = (id: string) => data.clients.find((c) => c.id === id)?.name ?? "—";
  const rows = data.projects.filter((p) => status === "all" || p.status === status || (status === "needs_estimate" && needsEstimate(data, p.id)));

  const del = (p: Project) => {
    if (data.invoices.some((i) => i.projectId === p.id) || data.expenses.some((e) => e.projectId === p.id) || data.estimates.some((e) => e.projectId === p.id)) {
      if (!window.confirm(`"${p.name}" has linked estimates/invoices/expenses. They will be kept but unlinked. Continue?`)) return;
      data.estimates.filter((e) => e.projectId === p.id).forEach((e) => upsert("estimates", { ...e, projectId: "" }));
      data.invoices.filter((i) => i.projectId === p.id).forEach((i) => upsert("invoices", { ...i, projectId: "" }));
      data.expenses.filter((e) => e.projectId === p.id).forEach((e) => upsert("expenses", { ...e, projectId: "" }));
    } else if (!confirmDelete(p.name)) return;
    remove("projects", p.id);
  };

  return (
    <div className="page">
      <PageHeader
        title="Jobs"
        subtitle="Every job from lead to completion: estimate, budget, billing and profit."
        actions={
          <>
            <select value={status} onChange={(e) => setStatus(e.target.value as JobFilter)} aria-label="Status filter">
              <option value="all">All statuses</option>
              <option value="needs_estimate">Needs estimate</option>
              {Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <button className="btn primary" disabled={!data.clients.length} title={!data.clients.length ? "Add a client first" : ""} onClick={() => setEdit(blank())}>+ New job</button>
          </>
        }
      />
      <div className="card flush">
        {rows.length === 0 ? (
          <Empty>{!data.clients.length ? "Add a client first, then create jobs for them." : status === "needs_estimate" ? "Every lead has an estimate. 🎉" : "No jobs here."}</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Job No.</th><th>Job</th><th>Type</th><th>Status</th><th>Estimate</th><th className="num">Budget</th><th className="num">Invoiced</th><th className="num">Costs</th><th className="num">Profit</th><th>Billed</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const f = projectFinancials(data, p.id);
                const pct = p.budget ? Math.min(100, Math.round((f.invoiced / p.budget) * 100)) : 0;
                return (
                  <tr key={p.id} className="clickable" onClick={() => setEdit(p)}>
                    <td className="nowrap">{p.number ?? <span className="muted">—</span>}</td>
                    <td>
                      <strong>{p.name}</strong>
                      <div className="muted small">
                        {[clientName(p.clientId), [p.product, p.subProduct].filter(Boolean).join(" › "), fmtDate(p.startDate, s.locale)].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td>{p.jobType ?? <span className="muted">—</span>}</td>
                    <td onClick={(e) => p.approval?.status === "pending" && e.stopPropagation()}>
                      <Badge tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</Badge>
                      {p.approval && (
                        <div className="small approval">
                          {p.approval.status === "pending" ? (
                            <>
                              <span className="warn">Awaiting {p.approval.head}</span>
                              <button className="btn ghost good" onClick={() => decideApproval(p, "approved")}>Approve</button>
                              <button className="btn ghost danger" onClick={() => decideApproval(p, "rejected")}>Reject</button>
                            </>
                          ) : (
                            <span className={p.approval.status === "approved" ? "good" : "bad"}>
                              {p.approval.status === "approved" ? "Approved" : "Rejected"} by {p.approval.head}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const est = latestEstimate(p.id);
                        if (needsEstimate(data, p.id))
                          return <button className="btn ghost good" onClick={() => go("estimates", { new: p.id })}>Create estimate</button>;
                        if (!est) return <span className="muted">—</span>;
                        return (
                          <button className="btn ghost" title={est.number} onClick={() => go("estimates", { open: est.id })}>
                            <Badge tone={ESTIMATE_STATUS[est.status].tone}>{ESTIMATE_STATUS[est.status].label}</Badge>
                          </button>
                        );
                      })()}
                    </td>
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

      {edit && <JobForm initial={edit} isNew={!data.projects.some((p) => p.id === edit.id)} onCancel={() => setEdit(null)} onSave={saveJob} />}
    </div>
  );
}

const COMMON_JOB_TYPES = [
  "Brochure Printing", "Creative Design", "Video Production", "Photo Shoot", "Media Buying",
  "Event", "Social Media", "Website", "Outdoor", "Retainer",
];

function JobForm({ initial, isNew, onSave, onCancel }: { initial: Project; isNew: boolean; onSave: (p: Project, sendForApproval: boolean, head: string) => void; onCancel: () => void }) {
  const { data } = useStore();
  const s = data.settings;
  const [job, setJob] = useState(initial);
  const [approve, setApprove] = useState(!!initial.approval);
  const [head, setHead] = useState(initial.approval?.head ?? "");
  const client = data.clients.find((c) => c.id === job.clientId);
  const products = client?.products ?? [];
  const subProducts = products.find((p) => p.name.toLowerCase() === (job.product ?? "").trim().toLowerCase())?.subProducts ?? [];
  const contacts = [client?.contactName, ...data.projects.filter((p) => p.clientId === job.clientId).map((p) => p.contactPerson)]
    .filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
  const heads = s.departmentHeads.filter(Boolean);
  const nextNo = `${s.jobPrefix}${String(s.nextJobNumber).padStart(4, "0")}`;
  const typeSuggestions = [
    ...new Set(
      [...data.projects.map((p) => p.jobType), ...data.estimates.map((e) => e.jobType), ...COMMON_JOB_TYPES].filter((x): x is string => !!x),
    ),
  ].sort();

  return (
    <Modal title={isNew ? "Add Job" : `Edit job ${job.number ?? ""}`} onClose={onCancel}>
      <form className="form form-rows" onSubmit={(e) => { e.preventDefault(); onSave(job, approve, head); }}>
        <Field label="Client *" span={2}>
          <select required autoFocus value={job.clientId} onChange={(e) => setJob({ ...job, clientId: e.target.value, product: "", subProduct: "", contactPerson: "" })}>
            <option value="" disabled>Select…</option>
            {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Contact person" span={2}>
          <input list="job-contacts" value={job.contactPerson ?? ""} onChange={(e) => setJob({ ...job, contactPerson: e.target.value })} placeholder="Enter name of person" />
          <datalist id="job-contacts">{contacts.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Product *" span={2}>
          <input required list="job-products" disabled={!job.clientId} value={job.product ?? ""} onChange={(e) => setJob({ ...job, product: e.target.value, subProduct: "" })} placeholder={job.clientId ? "Select or type a new product" : "Choose a client first"} />
          <datalist id="job-products">{products.map((p) => <option key={p.name} value={p.name} />)}</datalist>
        </Field>
        <Field label="Sub-product *" span={2}>
          <input required list="job-subproducts" disabled={!job.product?.trim()} value={job.subProduct ?? ""} onChange={(e) => setJob({ ...job, subProduct: e.target.value })} placeholder={job.product?.trim() ? "Select or type a new sub-product" : "Choose a product first"} />
          <datalist id="job-subproducts">{subProducts.map((p) => <option key={p} value={p} />)}</datalist>
        </Field>
        <Field label="Job No." span={2}>
          <input value={job.number ?? ""} onChange={(e) => setJob({ ...job, number: e.target.value })} placeholder={`${nextNo} (given when you save)`} />
        </Field>
        <Field label="Type" span={2}>
          <input list="job-type-list" value={job.jobType ?? ""} onChange={(e) => setJob({ ...job, jobType: e.target.value })} placeholder="e.g. Brochure Printing" />
          <datalist id="job-type-list">{typeSuggestions.map((t) => <option key={t} value={t} />)}</datalist>
        </Field>
        <Field label="Title *" span={2}><input required value={job.name} onChange={(e) => setJob({ ...job, name: e.target.value })} placeholder="Enter title of the work" /></Field>
        <Field label="Description" span={2}><textarea rows={3} value={job.notes} onChange={(e) => setJob({ ...job, notes: e.target.value })} placeholder="Enter description" /></Field>
        <Field label="Date" span={2}><input type="date" value={job.startDate} onChange={(e) => setJob({ ...job, startDate: e.target.value })} /></Field>
        <label className="check span2"><input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} /> Send for approval</label>
        <Field label="Department head" span={2}>
          <select required={approve} disabled={!approve} value={head} onChange={(e) => setHead(e.target.value)}>
            <option value="">{heads.length ? "Select…" : "Add department heads in Settings"}</option>
            {heads.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </Field>
        <details className="span2 more" open={!isNew}>
          <summary>Status, budget and end date</summary>
          <div className="form">
            <Field label="Status">
              <select value={job.status} onChange={(e) => setJob({ ...job, status: e.target.value as ProjectStatus })}>
                {Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <Field label={`Budget (${s.currency})`}><input type="number" min={0} step="0.01" value={job.budget || ""} onChange={(e) => setJob({ ...job, budget: Number(e.target.value) })} /></Field>
            <Field label="End date"><input type="date" value={job.endDate} onChange={(e) => setJob({ ...job, endDate: e.target.value })} /></Field>
          </div>
        </details>
        <div className="form-actions span2">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary">Save job</button>
        </div>
      </form>
    </Modal>
  );
}
