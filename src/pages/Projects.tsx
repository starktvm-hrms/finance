import { useEffect, useRef, useState } from "react";
import { ESTIMATE_TYPES, type AppData, type Employee, type EstimateType, type Project, type ProjectStatus } from "../types";
import { useStore } from "../lib/store";
import { needsEstimate, projectFinancials } from "../lib/metrics";
import { makeJobNumber } from "../lib/jobno";
import { jobStage } from "../lib/workflow";
import { jobCategory } from "../lib/doctype";
import { go } from "../lib/route";
import { listFilter } from "../lib/scope";
import { ScopeChip } from "../components/ScopeChip";
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

/** How a department head is shown in the approval list: "Meera Pillai (Media)". */
export function headLabel(data: AppData, e: Employee) {
  const d = data.departments.find((x) => x.id === e.departmentId)?.name;
  return d ? `${e.name} (${d})` : e.name;
}

type JobFilter = ProjectStatus | "all" | "needs_estimate";

export default function Projects({ params }: { params: URLSearchParams }) {
  const { data, upsert, remove, updateSettings, can, access, user, myName } = useStore();
  const lf = listFilter(data, params, user, access.employeeId); // from a dashboard tile: your / one department's jobs
  const seeMoney = can("invoices") && can("expenses"); // invoiced / costs / profit need both
  const s = data.settings;
  // #/projects?edit=ID opens a job's form (from the job's page; saving goes back there).
  const [edit, setEdit] = useState<Project | null>(() => data.projects.find((p) => p.id === params.get("edit")) ?? null);
  const fromJob = params.get("edit");
  const closeForm = () => (fromJob ? window.location.replace(`#/job?id=${encodeURIComponent(fromJob)}`) : setEdit(null));
  const [status, setStatus] = useState<JobFilter>(() => {
    const f = params.get("status") as JobFilter | null;
    return f && (f === "needs_estimate" || f in PROJECT_STATUS) ? f : "all";
  });
  // Tabs = category, like Estimates and Invoices (#/projects?type=media&status=active)
  const TYPE_TABS = [{ id: "all", label: "All", hint: "Every job from lead to completion: estimate, budget, billing and profit." }, ...ESTIMATE_TYPES];
  const typeTab = TYPE_TABS.some((t) => t.id === params.get("type")) ? (params.get("type") as string) : "all";
  const tab = TYPE_TABS.find((t) => t.id === typeTab)!;
  const catOf = (p: Project) => jobCategory(p, data.estimates);
  const keep = Object.fromEntries(["by", "dept"].filter((k) => params.has(k)).map((k) => [k, params.get(k)!]));
  const switchTab = (type: string) => go("projects", { ...(type !== "all" && { type }), ...(status !== "all" && { status }), ...keep });
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = tabsRef.current;
    const el = row?.querySelector<HTMLElement>(".tab.active");
    if (row && el) row.scrollLeft = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
  }, [typeTab]);
  const latestEstimate = (jobId: string) =>
    data.estimates.filter((e) => e.projectId === jobId).sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0];

  const blank = (): Project => ({
    id: uid(), clientId: "", contactPerson: "", product: "", subProduct: "", name: "", status: "lead",
    category: typeTab === "all" ? undefined : (typeTab as EstimateType),
    budget: 0, startDate: today(), endDate: "", notes: "", createdAt: new Date().toISOString(),
  });

  const saveJob = (job: Project, sendForApproval: boolean, head: string) => {
    let next: Project = { ...job, name: job.name.trim(), product: job.product?.trim(), subProduct: job.subProduct?.trim() };
    next.jobType = next.jobType?.trim() || undefined;
    if (!next.number) {
      // Automatic: client code + serial number + the job's date (layout set in Settings).
      next.number = makeJobNumber(s, data.clients.find((c) => c.id === next.clientId), next.startDate, s.nextJobNumber);
      updateSettings({ nextJobNumber: s.nextJobNumber + 1 });
    }
    if (sendForApproval && head && (next.approval?.head !== head || next.approval?.status === "rejected")) {
      const headEmp = data.employees.find((e) => e.isHead && headLabel(data, e) === head);
      next.approval = { head, ...(headEmp && { headId: headEmp.id }), status: "pending", decidedDate: "", askedBy: myName, askedAt: new Date().toISOString() };
    } else if (!sendForApproval) {
      next = { ...next, approval: undefined };
    }
    upsert("projects", next);
    // Remember new products / sub-products on the client so they can be picked next time.
    const client = data.clients.find((c) => c.id === next.clientId);
    if (client && next.product && can("directory")) {
      const products = [...(client.products ?? [])];
      const i = products.findIndex((p) => p.name.toLowerCase() === next.product!.toLowerCase());
      if (i < 0) products.push({ name: next.product, subProducts: next.subProduct ? [next.subProduct] : [] });
      else if (next.subProduct && !products[i].subProducts.some((x) => x.toLowerCase() === next.subProduct!.toLowerCase()))
        products[i] = { ...products[i], subProducts: [...products[i].subProducts, next.subProduct] };
      if (i < 0 || products[i] !== client.products?.[i]) upsert("clients", { ...client, products });
    }
    closeForm();
  };

  const decideApproval = (p: Project, status: "approved" | "rejected") =>
    p.approval && upsert("projects", { ...p, approval: { ...p.approval, status, decidedDate: today(), decidedBy: myName, decidedAt: new Date().toISOString() } });
  const clientName = (id: string) => data.clients.find((c) => c.id === id)?.name ?? "—";
  const statusMatch = (p: Project, f: JobFilter) => f === "all" || p.status === f || (f === "needs_estimate" && needsEstimate(data, p.id));
  const inTab = (p: Project) => (typeTab === "all" || catOf(p) === typeTab) && (!lf || lf.keepJob(p));
  const rows = data.projects.filter((p) => inTab(p) && statusMatch(p, status));
  const statusCount = (f: JobFilter) => data.projects.filter((p) => inTab(p) && statusMatch(p, f)).length;

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
      <div className="page-head">
        <div>
          <h1>Jobs</h1>
          <p className="muted">Every job from lead to completion: estimate, budget, billing and profit.</p>
        </div>
      </div>
      <div ref={tabsRef} className="tabs directory-tabs" role="tablist" aria-label="Job categories">
        {TYPE_TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={typeTab === t.id} className={`tab ${typeTab === t.id ? "active" : ""}`} onClick={() => switchTab(t.id)}>
            {t.label}
            <span className="tab-count">{t.id === "all" ? data.projects.length : data.projects.filter((p) => catOf(p) === t.id).length}</span>
          </button>
        ))}
      </div>
      {lf && <ScopeChip label={lf.label} page="projects" params={params} />}
      <PageHeader
        level={2}
        title={typeTab === "all" ? "All jobs" : `${tab.label} jobs`}
        subtitle={`${typeTab === "all" ? "Every category" : tab.hint} · ${rows.length} shown`}
        actions={
          <>
            <select value={status} onChange={(e) => setStatus(e.target.value as JobFilter)} aria-label="Status filter">
              <option value="all">All statuses ({statusCount("all")})</option>
              <option value="needs_estimate">Needs estimate ({statusCount("needs_estimate")})</option>
              {(Object.entries(PROJECT_STATUS) as [ProjectStatus, { label: string }][]).map(([k, v]) => <option key={k} value={k}>{v.label} ({statusCount(k)})</option>)}
            </select>
            <button className="btn primary" disabled={!data.clients.length} title={!data.clients.length ? "Add a client first" : ""} onClick={() => setEdit(blank())}>
              + New {typeTab === "all" ? "" : `${tab.label.toLowerCase()} `}job
            </button>
          </>
        }
      />
      <div className="card flush">
        {rows.length === 0 ? (
          <Empty>{!data.clients.length ? "Add a client first, then create jobs for them." : status === "needs_estimate" ? "Every lead has an estimate. 🎉" : typeTab === "all" ? "No jobs here." : `No ${tab.label.toLowerCase()} jobs${status === "all" ? "" : " with this status"}.`}</Empty>
        ) : (
          <table className="table jobs-table">
            <thead>
              <tr><th>Job</th><th>{typeTab === "all" ? "Category / type" : "Type"}</th><th>Status</th>{can("estimates") && <th>Estimate</th>}<th className="num">Budget</th>{seeMoney && <><th className="num">Invoiced</th><th className="num">Profit</th></>}<th /></tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const f = projectFinancials(data, p.id);
                const pct = p.budget ? Math.min(100, Math.round((f.invoiced / p.budget) * 100)) : 0;
                return (
                  <tr key={p.id} className="clickable" onClick={() => go("job", { id: p.id })} title="Open job details">
                    <td className="job-cell">
                      {p.number && <div className="job-no">{p.number}</div>}
                      <strong>{p.name}</strong>
                      <div className="muted small">
                        {[clientName(p.clientId), [p.product, p.subProduct].filter(Boolean).join(" › "), fmtDate(p.startDate, s.locale)].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td>
                      {typeTab === "all" && <div>{ESTIMATE_TYPES.find((t) => t.id === catOf(p))?.label}</div>}
                      <div className={typeTab === "all" ? "muted small" : ""}>{p.jobType ?? (typeTab === "all" ? "" : <span className="muted">—</span>)}</div>
                    </td>
                    <td onClick={(e) => p.approval?.status === "pending" && e.stopPropagation()}>
                      <Badge tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</Badge>
                      <div className="small stage-line">{jobStage(data, p).label}</div>
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
                    {can("estimates") && <td onClick={(e) => e.stopPropagation()}>
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
                    </td>}
                    <td className="num">{money(p.budget, s)}</td>
                    {seeMoney && (
                      <>
                        <td className="num">
                          {money(f.invoiced, s)}
                          <div className="bar-track mini" title={`${pct}% of budget invoiced`}><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
                          <div className="muted small">{pct}% billed</div>
                        </td>
                        <td className="num">
                          <span className={f.profit < 0 ? "bad" : "good"}>{money(f.profit, s)}</span>
                          <div className="muted small">costs {money(f.cost, s)}</div>
                        </td>
                      </>
                    )}
                    <td className="actions" onClick={(e) => e.stopPropagation()}>
                      <button className="icon-btn row-icon" onClick={() => setEdit(p)} title="Edit job" aria-label={`Edit ${p.name}`}>✎</button>
                      {access.admin && <button className="icon-btn row-icon danger" onClick={() => del(p)} title="Delete job" aria-label={`Delete ${p.name}`}>🗑</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {edit && <JobForm initial={edit} isNew={!data.projects.some((p) => p.id === edit.id)} onCancel={closeForm} onSave={saveJob} />}
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
  // Department heads from Employees (ticked "Department head"), plus any typed in Settings.
  const heads = [
    ...new Set([
      ...data.employees
        .filter((e) => e.isHead && e.active)
        .map((e) => headLabel(data, e)),
      ...s.departmentHeads.filter(Boolean),
    ]),
  ];
  // The number is generated from the client code, serial and date when the job is first saved.
  const autoNo = makeJobNumber(s, client, job.startDate, s.nextJobNumber);
  const typeSuggestions = [
    ...new Set(
      [...data.projects.map((p) => p.jobType), ...data.estimates.map((e) => e.jobType), ...COMMON_JOB_TYPES].filter((x): x is string => !!x),
    ),
  ].sort();

  return (
    <Modal title={isNew ? "Add Job" : `Edit job ${job.number ?? ""}`} onClose={onCancel}>
      <form className="form form-rows" onSubmit={(e) => { e.preventDefault(); onSave(isNew ? { ...job, number: "" } : job, approve, head); }}>
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
        <Field label="Job No. (automatic)" span={2}>
          <input
            aria-label="Job number"
            readOnly
            className="readonly"
            value={isNew ? (job.clientId ? autoNo : "") : job.number || (job.clientId ? `${autoNo} (given on save)` : "")}
            placeholder="Generated when you pick the client"
            title={isNew ? "Generated from the client code, serial number and the job's date when you save" : "Job numbers don't change once given"}
          />
        </Field>
        <Field label="Department" span={2}>
          <select value={job.departmentId ?? ""} onChange={(e) => setJob({ ...job, departmentId: e.target.value || undefined })}>
            <option value="">{isNew ? "Yours (from your employee record)" : "Not set"}</option>
            {data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Category" span={2}>
          <select value={job.category ?? ""} onChange={(e) => setJob({ ...job, category: (e.target.value || undefined) as EstimateType | undefined })}>
            <option value="">{isNew ? "Project" : `From its estimates (${ESTIMATE_TYPES.find((t) => t.id === jobCategory(initial, data.estimates))?.label})`}</option>
            {ESTIMATE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
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
            <option value="">{heads.length ? "Select…" : "Tick “Department head” on employees first"}</option>
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
