import { useMemo, useState } from "react";
import type { Estimate, EstimateStatus, Invoice } from "../types";
import { useStore } from "../lib/store";
import { clearParam, go } from "../lib/route";
import { addDays, fmtDate, invoiceTotals, money, today, uid } from "../lib/util";
import { Badge, Empty, Field, Modal, PageHeader, confirmDelete } from "../components/ui";
import { DocumentView, ItemsEditor, Totals, newLine } from "../components/Doc";

export const ESTIMATE_STATUS: Record<EstimateStatus | "expired", { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Awaiting approval", tone: "info" },
  expired: { label: "Expired", tone: "warn" },
  approved: { label: "Approved", tone: "good" },
  rejected: { label: "Rejected", tone: "bad" },
  invoiced: { label: "Invoiced", tone: "muted" },
};

const FILTERS: { id: EstimateStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "sent", label: "For approval" },
  { id: "approved", label: "To invoice" },
  { id: "invoiced", label: "Invoiced" },
  { id: "rejected", label: "Rejected" },
];

const displayStatus = (e: Estimate) => (e.status === "sent" && e.validUntil && e.validUntil < today() ? "expired" : e.status);

export default function Estimates({ params }: { params: URLSearchParams }) {
  const { data, upsert, remove, updateSettings } = useStore();
  const s = data.settings;
  const clientName = (id: string) => data.clients.find((c) => c.id === id)?.name ?? "—";
  const jobName = (id: string) => data.projects.find((p) => p.id === id)?.name ?? "";

  const blank = (projectId = ""): Estimate => {
    const job = data.projects.find((p) => p.id === projectId);
    const issue = today();
    return {
      id: uid(),
      number: `${s.estimatePrefix}${String(s.nextEstimateNumber).padStart(4, "0")}`,
      clientId: job?.clientId ?? data.clients[0]?.id ?? "",
      projectId: job?.id ?? "",
      issueDate: issue,
      validUntil: addDays(issue, s.estimateValidDays),
      status: "draft",
      items: [job ? { ...newLine(), description: job.name } : newLine()],
      taxRate: s.defaultTaxRate,
      discount: 0,
      notes: "",
      decidedDate: "",
      invoiceId: "",
      createdAt: new Date().toISOString(),
    };
  };

  // `#/estimates?new=<jobId>` opens a new estimate for that job (from the Jobs page).
  const [edit, setEdit] = useState<Estimate | null>(() => {
    if (!params.has("new")) return null;
    const jobId = params.get("new") ?? "";
    clearParam("new");
    return data.clients.length ? blank(jobId) : null;
  });
  const [view, setView] = useState<Estimate | null>(() => {
    const id = params.get("open");
    if (id) clearParam("open");
    return data.estimates.find((e) => e.id === id) ?? null;
  });
  const [filter, setFilter] = useState<EstimateStatus | "all">(() => {
    const f = params.get("status");
    return FILTERS.some((x) => x.id === f) ? (f as EstimateStatus) : "all";
  });
  const [q, setQ] = useState("");

  const isNew = (e: Estimate) => !data.estimates.some((x) => x.id === e.id);
  const rows = useMemo(
    () =>
      data.estimates
        .filter((e) => (filter === "all" || e.status === filter) && `${e.number} ${clientName(e.clientId)} ${jobName(e.projectId)}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number)),
    [data.estimates, data.clients, data.projects, filter, q], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const save = (e: Estimate) => {
    if (isNew(e)) updateSettings({ nextEstimateNumber: s.nextEstimateNumber + 1 });
    upsert("estimates", e);
    setEdit(null);
  };

  const decide = (e: Estimate, status: "approved" | "rejected" | "sent" | "draft") => {
    upsert("estimates", { ...e, status, decidedDate: status === "approved" || status === "rejected" ? today() : "" });
    // Approving a quote starts the job: mark leads active and use the quote as the budget if none is set.
    const job = data.projects.find((p) => p.id === e.projectId);
    if (status === "approved" && job && (job.status === "lead" || !job.budget)) {
      const t = invoiceTotals(e);
      upsert("projects", { ...job, status: job.status === "lead" ? "active" : job.status, budget: job.budget || t.total - t.tax });
    }
  };

  /** Turn an approved estimate into a draft invoice and open it. */
  const createInvoice = (e: Estimate) => {
    const issue = today();
    const inv: Invoice = {
      id: uid(),
      number: `${s.invoicePrefix}${String(s.nextInvoiceNumber).padStart(4, "0")}`,
      clientId: e.clientId,
      projectId: e.projectId,
      issueDate: issue,
      dueDate: addDays(issue, s.paymentTermsDays),
      status: "draft",
      items: e.items.map((it) => ({ ...it, id: uid() })),
      taxRate: e.taxRate,
      discount: e.discount,
      notes: e.notes,
      paidDate: "",
      createdAt: new Date().toISOString(),
    };
    upsert("invoices", inv);
    updateSettings({ nextInvoiceNumber: s.nextInvoiceNumber + 1 });
    upsert("estimates", { ...e, status: "invoiced", invoiceId: inv.id });
    go("invoices", { open: inv.id });
  };

  const actions = (e: Estimate) => (
    <>
      {e.status === "draft" && <button className="btn ghost" onClick={() => decide(e, "sent")}>Mark sent</button>}
      {e.status === "sent" && (
        <>
          <button className="btn ghost good" onClick={() => decide(e, "approved")}>Approve</button>
          <button className="btn ghost danger" onClick={() => decide(e, "rejected")}>Reject</button>
        </>
      )}
      {e.status === "approved" && <button className="btn ghost good" onClick={() => createInvoice(e)}>Create invoice</button>}
    </>
  );

  return (
    <div className="page">
      <PageHeader
        title="Estimates"
        subtitle="Quote a job, get the client's approval, then raise the invoice."
        actions={
          <button className="btn primary" disabled={!data.clients.length} title={!data.clients.length ? "Add a client first" : ""} onClick={() => setEdit(blank())}>+ New estimate</button>
        }
      />
      <div className="filters">
        <div className="tabs">
          {FILTERS.map((f) => (
            <button key={f.id} className={`tab ${filter === f.id ? "active" : ""}`} onClick={() => setFilter(f.id)}>
              {f.label}
              <span className="tab-count">{f.id === "all" ? data.estimates.length : data.estimates.filter((e) => e.status === f.id).length}</span>
            </button>
          ))}
        </div>
        <input placeholder="Search number, client or job…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card flush">
        {rows.length === 0 ? (
          <Empty>{data.clients.length ? "No estimates here." : "Add a client first, then create estimates."}</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Number</th><th>Client / job</th><th>Issued</th><th>Valid until</th><th>Status</th><th className="num">Total</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const st = displayStatus(e);
                return (
                  <tr key={e.id} className="clickable" onClick={() => setView(e)}>
                    <td><strong>{e.number}</strong></td>
                    <td>{clientName(e.clientId)}{e.projectId && <div className="muted small">{jobName(e.projectId)}</div>}</td>
                    <td className="nowrap">{fmtDate(e.issueDate, s.locale)}</td>
                    <td className={`nowrap ${st === "expired" ? "warn" : ""}`}>{fmtDate(e.validUntil, s.locale)}</td>
                    <td><Badge tone={ESTIMATE_STATUS[st].tone}>{ESTIMATE_STATUS[st].label}</Badge></td>
                    <td className="num">{money(invoiceTotals(e).total, s)}</td>
                    <td className="actions" onClick={(ev) => ev.stopPropagation()}>{actions(e)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {edit && <EstimateEditor initial={edit} isNew={isNew(edit)} onCancel={() => setEdit(null)} onSave={save} />}

      {view && (
        <Modal title={`Estimate ${view.number}`} onClose={() => setView(null)} wide>
          <DocumentView
            title="ESTIMATE"
            number={view.number}
            clientId={view.clientId}
            projectId={view.projectId}
            dates={[["Issued", view.issueDate], ["Valid until", view.validUntil]]}
            badge={<Badge tone={ESTIMATE_STATUS[displayStatus(view)].tone}>{ESTIMATE_STATUS[displayStatus(view)].label}</Badge>}
            doc={view}
            notes={view.notes}
            totalLabel="Estimated total"
          />
          <div className="form-actions no-print">
            <button
              className="btn ghost danger"
              onClick={() => {
                if (confirmDelete(`estimate ${view.number}`)) {
                  remove("estimates", view.id);
                  setView(null);
                }
              }}
            >
              Delete
            </button>
            <div className="spacer" />
            {view.status === "invoiced" && view.invoiceId && (
              <button className="btn" onClick={() => go("invoices", { open: view.invoiceId })}>View invoice</button>
            )}
            {view.status !== "invoiced" && <button className="btn" onClick={() => { setEdit(view); setView(null); }}>Edit</button>}
            <button className="btn" onClick={() => window.print()}>Print / Save PDF</button>
            {(view.status === "draft" || view.status === "sent" || view.status === "approved") && (
              <span onClick={() => setView(null)} className="row gap">{actions(view)}</span>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function EstimateEditor({ initial, isNew, onSave, onCancel }: { initial: Estimate; isNew: boolean; onSave: (e: Estimate) => void; onCancel: () => void }) {
  const { data } = useStore();
  const s = data.settings;
  const [est, setEst] = useState(initial);
  const jobs = data.projects.filter((p) => p.clientId === est.clientId);

  return (
    <Modal title={isNew ? "New estimate" : `Edit ${est.number}`} onClose={onCancel} wide>
      <form className="form" onSubmit={(e) => { e.preventDefault(); onSave(est); }}>
        <Field label="Estimate number"><input required value={est.number} onChange={(e) => setEst({ ...est, number: e.target.value })} /></Field>
        <Field label="Status">
          <select value={est.status} onChange={(e) => { const status = e.target.value as EstimateStatus; setEst({ ...est, status, decidedDate: status === "approved" || status === "rejected" ? est.decidedDate || today() : "" }); }}>
            <option value="draft">Draft</option>
            <option value="sent">Sent – awaiting approval</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </Field>
        <Field label="Client">
          <select required value={est.clientId} onChange={(e) => setEst({ ...est, clientId: e.target.value, projectId: "" })}>
            {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Job">
          <select value={est.projectId} onChange={(e) => setEst({ ...est, projectId: e.target.value })}>
            <option value="">—</option>
            {jobs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Issue date"><input required type="date" value={est.issueDate} onChange={(e) => setEst({ ...est, issueDate: e.target.value, validUntil: isNew ? addDays(e.target.value, s.estimateValidDays) : est.validUntil })} /></Field>
        <Field label="Valid until"><input required type="date" value={est.validUntil} onChange={(e) => setEst({ ...est, validUntil: e.target.value })} /></Field>

        <ItemsEditor items={est.items} onChange={(items) => setEst({ ...est, items })} settings={s} />

        <Field label={`Discount (${s.currency})`}><input type="number" min={0} step="0.01" value={est.discount || ""} onChange={(e) => setEst({ ...est, discount: Number(e.target.value) })} /></Field>
        <Field label="Tax rate (%)"><input type="number" min={0} step="0.01" value={est.taxRate} onChange={(e) => setEst({ ...est, taxRate: Number(e.target.value) })} /></Field>
        <Field label="Notes / terms" span={2}><textarea rows={2} value={est.notes} onChange={(e) => setEst({ ...est, notes: e.target.value })} /></Field>

        <Totals doc={est} settings={s} className="span2" totalLabel="Estimated total" />
        <div className="form-actions span2">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary">Save estimate</button>
        </div>
      </form>
    </Modal>
  );
}
