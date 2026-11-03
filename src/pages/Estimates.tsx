import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { COUNTRIES, ESTIMATE_TYPES, type CountryCode, type Estimate, type EstimateStatus, type EstimateType, type Invoice } from "../types";
import { useStore } from "../lib/store";
import { clearParam, go } from "../lib/route";
import { addDays, docFormat, fmtDate, invoiceTotals, money, today, uid } from "../lib/util";
import { Badge, Empty, Field, Modal, PageHeader, confirmDelete } from "../components/ui";
import { DocumentView, ItemsEditor, newLine } from "../components/Doc";
// The editor (Quill) is only downloaded when an estimate form is opened.
const LazyEditor = lazy(() => import("../components/RichText"));
const RichTextEditor = (props: { value: string; onChange: (html: string) => void; placeholder?: string; label: string }) => (
  <Suspense fallback={<div className="rte rte-loading muted small">Loading editor…</div>}>
    <LazyEditor {...props} />
  </Suspense>
);

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

/** Estimates made before types existed count as "Project". */
export const estimateType = (e: Estimate): EstimateType => e.type ?? "project";
const typeInfo = (id: string) => ESTIMATE_TYPES.find((t) => t.id === id);
const TYPE_TABS = [{ id: "all", label: "All", hint: "Every estimate, of every type" }, ...ESTIMATE_TYPES];

const displayStatus = (e: Estimate) => (e.status === "sent" && e.validUntil && e.validUntil < today() ? "expired" : e.status);

export default function Estimates({ params }: { params: URLSearchParams }) {
  const { data, upsert, remove, updateSettings } = useStore();
  const s = data.settings;
  const clientName = (id: string) => data.clients.find((c) => c.id === id)?.name ?? "—";
  const jobName = (id: string) => data.projects.find((p) => p.id === id)?.name ?? "";

  // Tab = estimate type (#/estimates?type=media); "all" shows every type.
  const typeTab = TYPE_TABS.some((t) => t.id === params.get("type")) ? (params.get("type") as string) : "all";
  const tabInfo = TYPE_TABS.find((t) => t.id === typeTab)!;
  const switchTab = (type: string) => go("estimates", { ...(type !== "all" && { type }), ...(filter !== "all" && { status: filter }) });

  const blank = (projectId = ""): Estimate => {
    const job = data.projects.find((p) => p.id === projectId);
    const client = data.clients.find((c) => c.id === job?.clientId);
    const issue = today();
    return {
      id: uid(),
      type: typeTab === "all" ? "project" : (typeTab as EstimateType),
      number: "", // assigned on first save
      title: job?.name ?? "",
      header: "",
      remarks: "",
      clientAddress: client?.address ?? "",
      country: COUNTRIES.find((c) => c.currency === s.currency)?.code ?? "IN",
      roundOff: true,
      discountPct: 0,
      clientId: job?.clientId ?? "",
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
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = tabsRef.current;
    const el = row?.querySelector<HTMLElement>(".tab.active");
    if (row && el) row.scrollLeft = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
  }, [typeTab]);

  const isNew = (e: Estimate) => !data.estimates.some((x) => x.id === e.id);
  const rows = useMemo(
    () =>
      data.estimates
        .filter((e) => (typeTab === "all" || estimateType(e) === typeTab) && (filter === "all" || e.status === filter) && `${e.number} ${clientName(e.clientId)} ${jobName(e.projectId)}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number)),
    [data.estimates, data.clients, data.projects, filter, q, typeTab], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const save = (e: Estimate) => {
    if (isNew(e) && !e.number) {
      e = { ...e, number: `${s.estimatePrefix}${String(s.nextEstimateNumber).padStart(4, "0")}` };
      updateSettings({ nextEstimateNumber: s.nextEstimateNumber + 1 });
    }
    upsert("estimates", e);
    setEdit(null);
  };

  const decide = (e: Estimate, status: "approved" | "rejected" | "sent" | "draft") => {
    upsert("estimates", { ...e, status, decidedDate: status === "approved" || status === "rejected" ? today() : "" });
    // Approving a quote starts the job: mark leads active and use the quote as the budget if none is set.
    const job = data.projects.find((p) => p.id === e.projectId);
    if (status === "approved" && job && (job.status === "lead" || !job.budget)) {
      const t = invoiceTotals(e);
      upsert("projects", { ...job, status: job.status === "lead" ? "active" : job.status, budget: job.budget || t.net });
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
      country: e.country,
      roundOff: e.roundOff,
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

  if (edit) return <EstimateForm initial={edit} isNew={isNew(edit)} onCancel={() => setEdit(null)} onSave={save} />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Estimates</h1>
          <p className="muted">Quote a job, get the client's approval, then raise the invoice.</p>
        </div>
      </div>
      <div ref={tabsRef} className="tabs directory-tabs" role="tablist" aria-label="Estimate types">
        {TYPE_TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={typeTab === t.id} className={`tab ${typeTab === t.id ? "active" : ""}`} onClick={() => switchTab(t.id)}>
            {t.label}
            <span className="tab-count">{t.id === "all" ? data.estimates.length : data.estimates.filter((e) => estimateType(e) === t.id).length}</span>
          </button>
        ))}
      </div>
      <PageHeader
        level={2}
        title={typeTab === "all" ? "All estimates" : `${tabInfo.label} estimates`}
        subtitle={`${tabInfo.hint} · ${rows.length} shown`}
        actions={
          <>
            <select value={filter} onChange={(e) => setFilter(e.target.value as EstimateStatus | "all")} aria-label="Status">
              {FILTERS.map((f) => {
                const n = data.estimates.filter((e) => (typeTab === "all" || estimateType(e) === typeTab) && (f.id === "all" || e.status === f.id)).length;
                return <option key={f.id} value={f.id}>{f.id === "all" ? "All statuses" : f.label} ({n})</option>;
              })}
            </select>
            <input placeholder="Search number, client or job…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn primary" disabled={!data.clients.length} title={!data.clients.length ? "Add a client first" : ""} onClick={() => setEdit(blank())}>
              + New {typeTab === "all" ? "" : `${tabInfo.label.toLowerCase()} `}estimate
            </button>
          </>
        }
      />

      <div className="card flush">
        {rows.length === 0 ? (
          <Empty>{!data.clients.length ? "Add a client first, then create estimates." : typeTab === "all" ? "No estimates here." : `No ${tabInfo.label.toLowerCase()} estimates${filter === "all" ? "" : " with this status"}.`}</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Number</th>{typeTab === "all" && <th>Type</th>}<th>Client / job</th><th>Issued</th><th>Valid until</th><th>Status</th><th className="num">Total</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const st = displayStatus(e);
                return (
                  <tr key={e.id} className="clickable" onClick={() => setView(e)}>
                    <td><strong>{e.number}</strong></td>
                    {typeTab === "all" && <td className="muted">{typeInfo(estimateType(e))?.label}</td>}
                    <td>{clientName(e.clientId)}{e.projectId && <div className="muted small">{jobName(e.projectId)}</div>}</td>
                    <td className="nowrap">{fmtDate(e.issueDate, s.locale)}</td>
                    <td className={`nowrap ${st === "expired" ? "warn" : ""}`}>{fmtDate(e.validUntil, s.locale)}</td>
                    <td><Badge tone={ESTIMATE_STATUS[st].tone}>{ESTIMATE_STATUS[st].label}</Badge></td>
                    <td className="num">{money(invoiceTotals(e).total, docFormat(e.country, s))}</td>
                    <td className="actions" onClick={(ev) => ev.stopPropagation()}>{actions(e)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>


      {view && (
        <Modal title={`${typeInfo(estimateType(view))?.label} estimate ${view.number}`} onClose={() => setView(null)} wide>
          <DocumentView
            title={`${typeInfo(estimateType(view))?.label.toUpperCase()} ESTIMATE`}
            number={view.number}
            clientId={view.clientId}
            projectId={view.projectId}
            dates={[["Issued", view.issueDate], ["Valid until", view.validUntil]]}
            badge={<Badge tone={ESTIMATE_STATUS[displayStatus(view)].tone}>{ESTIMATE_STATUS[displayStatus(view)].label}</Badge>}
            doc={view}
            notes={view.notes}
            totalLabel="Grand total"
            heading={view.title}
            header={view.header}
            remarks={view.remarks}
            billTo={{ address: view.clientAddress || undefined }}
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

function EstimateForm({ initial, isNew, onSave, onCancel }: { initial: Estimate; isNew: boolean; onSave: (e: Estimate) => void; onCancel: () => void }) {
  const { data } = useStore();
  const s = data.settings;
  const [est, setEst] = useState(initial);
  const client = data.clients.find((c) => c.id === est.clientId);
  const jobs = data.projects.filter((p) => p.clientId === est.clientId);
  const fmt = docFormat(est.country, s);
  const subtotal = invoiceTotals({ ...est, discount: 0 }).subtotal;
  const type = typeInfo(estimateType(est))!;

  /** Keep a percentage discount in step with the lines. */
  const withDiscount = (e: Estimate): Estimate => {
    if (!e.discountPct) return e;
    const sub = invoiceTotals({ ...e, discount: 0 }).subtotal;
    return { ...e, discount: Math.round(sub * e.discountPct) / 100 };
  };
  const set = (patch: Partial<Estimate>) => setEst((e) => withDiscount({ ...e, ...patch }));

  const pickClient = (id: string) => {
    const c = data.clients.find((x) => x.id === id);
    set({ clientId: id, projectId: "", clientAddress: c?.address ?? "" });
  };
  const pickJob = (id: string) => {
    const job = data.projects.find((p) => p.id === id);
    set({ projectId: id, title: est.title || job?.name || "" });
  };
  const pickCountry = (code: CountryCode) =>
    set({ country: code, taxRate: code === "IN" ? (est.country === "IN" ? est.taxRate : s.defaultTaxRate) : 0 });

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="back-title">
          <button type="button" className="icon-btn back-btn" onClick={onCancel} aria-label="Back to estimates">‹</button>
          {isNew ? `Add ${type.label} Estimate` : `Edit ${type.label} Estimate ${est.number}`}
        </h1>
      </div>
      <form className="card form estimate-form" onSubmit={(e) => { e.preventDefault(); onSave(est); }}>
        <div className="span2 row between top estimate-top">
          <div className="estimate-brand">
            {s.logo ? <img src={s.logo} alt="" /> : null}
            <span>{s.agencyName}</span>
          </div>
          <Field label="Date *"><input required type="date" value={est.issueDate} onChange={(e) => set({ issueDate: e.target.value, validUntil: isNew ? addDays(e.target.value, s.estimateValidDays) : est.validUntil })} /></Field>
        </div>

        <div className="span2 grid-3">
          <Field label="Client details *">
            <select required value={est.clientId} onChange={(e) => pickClient(e.target.value)}>
              <option value="" disabled>Select…</option>
              {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="GSTIN"><input readOnly value={client?.taxId ?? ""} placeholder="From client" /></Field>
          <Field label="Estimate No. *"><input readOnly value={est.number} placeholder="Save to get No." /></Field>

          <Field label="Address"><textarea rows={3} value={est.clientAddress ?? ""} onChange={(e) => set({ clientAddress: e.target.value })} placeholder="Billing address" /></Field>
          <div className="stack">
            <Field label="PAN"><input readOnly value={client?.pan ?? ""} placeholder="From client" /></Field>
            <Field label="Country *">
              <select required value={est.country ?? ""} onChange={(e) => pickCountry(e.target.value as CountryCode)}>
                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label} ({c.currency})</option>)}
              </select>
            </Field>
          </div>
          <div className="stack">
            <Field label="Job No.">
              <select value={est.projectId} onChange={(e) => pickJob(e.target.value)} disabled={!est.clientId}>
                <option value="">{est.clientId ? "Select…" : "Choose a client first"}</option>
                {jobs.map((p) => <option key={p.id} value={p.id}>{p.number ? `${p.number} · ` : ""}{p.name}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select value={estimateType(est)} onChange={(e) => set({ type: e.target.value as EstimateType })}>
                {ESTIMATE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </Field>
          </div>
        </div>

        <Field label="Title *" span={2}><input required value={est.title ?? ""} onChange={(e) => set({ title: e.target.value })} placeholder="Enter the job title" /></Field>
        <div className="field span2">
          <span>Header</span>
          <RichTextEditor label="Header" value={est.header ?? ""} onChange={(header) => set({ header })} placeholder="Enter the job header" />
        </div>

        <ItemsEditor items={est.items} onChange={(items) => set({ items })} settings={fmt} />

        <div className="field">
          <span>Remarks</span>
          <RichTextEditor label="Remarks" value={est.remarks ?? ""} onChange={(remarks) => set({ remarks })} placeholder="Any important message to add" />
          <div className="grid-2-tight">
            <Field label="Valid until"><input required type="date" value={est.validUntil} onChange={(e) => set({ validUntil: e.target.value })} /></Field>
            <Field label="Status">
              <select value={est.status} onChange={(e) => { const status = e.target.value as EstimateStatus; set({ status, decidedDate: status === "approved" || status === "rejected" ? est.decidedDate || today() : "" }); }}>
                <option value="draft">Draft</option>
                <option value="sent">Sent – awaiting approval</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </Field>
          </div>
        </div>

        <div className="estimate-totals">
          <Field label="Total"><input readOnly className="num" value={money(subtotal, fmt)} /></Field>
          <div className="field">
            <span>Discount</span>
            <div className="grid-2-tight">
              <Field label="Percentage">
                <input type="number" min={0} max={100} step="0.01" value={est.discountPct || ""} placeholder="0"
                  onChange={(e) => set({ discountPct: Number(e.target.value) || 0, ...(Number(e.target.value) ? {} : { discount: 0 }) })} />
              </Field>
              <Field label={`Value (${fmt.currency})`}>
                <input type="number" min={0} step="0.01" value={est.discount || ""} placeholder="0.00"
                  onChange={(e) => setEst({ ...est, discount: Number(e.target.value) || 0, discountPct: 0 })} />
              </Field>
            </div>
          </div>
          <Field label="Estimated revenue"><input readOnly className="num" value={money(invoiceTotals(est).net, fmt)} /></Field>
          <div className="grid-2-tight">
            <Field label="Tax rate (%)"><input type="number" min={0} step="0.01" value={est.taxRate} onChange={(e) => set({ taxRate: Number(e.target.value) })} /></Field>
            <Field label="Tax"><input readOnly className="num" value={money(invoiceTotals(est).tax, fmt)} /></Field>
          </div>
          <Field label="Round off">
            <div className="row gap">
              <input readOnly className="num" value={money(invoiceTotals(est).roundOff, fmt)} />
              <label className="check small"><input type="checkbox" checked={!!est.roundOff} onChange={(e) => set({ roundOff: e.target.checked })} /> Round</label>
            </div>
          </Field>
          <Field label="Grand total"><input readOnly className="num grand-input" value={money(invoiceTotals(est).total, fmt)} /></Field>
        </div>

        <div className="form-actions span2 start">
          <button className="btn primary">Save estimate</button>
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
