import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { COUNTRIES, ESTIMATE_TYPES, type CountryCode, type Estimate, type EstimateStatus, type EstimateType, type Invoice } from "../types";
import { useStore } from "../lib/store";
import { clearParam, go } from "../lib/route";
import { addDays, amountInWords, docFormat, financialYear, fmtDate, gstSplit, gstState, invoiceTotals, money, today, uid } from "../lib/util";
import ProductionEstimate, { EstimateFooter, Letterhead, SignatureBlock, dmyDate, plainAmount } from "../components/ProductionEstimate";
import { AutoTextarea, Badge, Empty, Field, Modal, PageHeader, confirmDelete } from "../components/ui";
import { newLine } from "../components/Doc";
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
  // `#/estimates?new=<jobId>` opens a new estimate for that job;
  // `#/estimates?edit=<estimateId>` opens an existing one in the form.
  const [edit, setEdit] = useState<Estimate | null>(() => {
    const editId = params.get("edit");
    if (editId) {
      clearParam("edit");
      return data.estimates.find((e) => e.id === editId) ?? null;
    }
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

  /** Open a saved estimate in the form (always the latest saved version). */
  const startEdit = (e: Estimate) => {
    const current = data.estimates.find((x) => x.id === e.id) ?? e;
    if (current.status === "invoiced") {
      const inv = data.invoices.find((i) => i.id === current.invoiceId);
      const ok = window.confirm(
        `${current.number} has already been invoiced${inv ? ` (${inv.number})` : ""}. Changes to the estimate will not change the invoice. Edit anyway?`,
      );
      if (!ok) return;
    }
    setView(null);
    setEdit(current);
  };
  const rows = useMemo(
    () =>
      data.estimates
        .filter((e) => (typeTab === "all" || estimateType(e) === typeTab) && (filter === "all" || e.status === filter) && `${e.number} ${clientName(e.clientId)} ${jobName(e.projectId)}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number)),
    [data.estimates, data.clients, data.projects, filter, q, typeTab], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const save = (e: Estimate) => {
    if (isNew(e) && !e.number) {
      // PE/26-27/369 for production estimates, ME/26-27/370 for media estimates
      const prefix = estimateType(e) === "media" ? s.mediaEstimatePrefix : s.productionEstimatePrefix;
      e = { ...e, number: `${prefix}/${financialYear(e.issueDate)}/${s.nextEstimateNumber}` };
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
                    <td className="actions" onClick={(ev) => ev.stopPropagation()}>
                      {actions(e)}
                      <button className="btn ghost" onClick={() => startEdit(e)} aria-label={`Edit ${e.number}`}>Edit</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>


      {view && (
        <Modal title={`${typeInfo(estimateType(view))?.label} estimate ${view.number}`} onClose={() => setView(null)} wide>
          {/* Media estimates get their own landscape layout later; until then all use this one. */}
          <ProductionEstimate est={view} />
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
            <button className="btn" onClick={() => startEdit(view)}>Edit</button>
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
  const job = data.projects.find((p) => p.id === est.projectId);
  const jobs = data.projects.filter((p) => p.clientId === est.clientId);
  const fmt = docFormat(est.country, s);
  const t = invoiceTotals(est);
  const type = typeInfo(estimateType(est))!;
  const split = gstSplit(gstState(s.taxId, s.stateCode), client?.taxId, est.taxRate);
  const jobTypes = [...new Set(data.estimates.map((e) => e.jobType).filter((x): x is string => !!x))].sort();
  const previewNo = `${estimateType(est) === "media" ? s.mediaEstimatePrefix : s.productionEstimatePrefix}/${financialYear(est.issueDate || today())}/${s.nextEstimateNumber}`;

  /** Keep a percentage discount in step with the lines. */
  const withDiscount = (e: Estimate): Estimate => {
    if (!e.discountPct) return e;
    const sub = invoiceTotals({ ...e, discount: 0 }).subtotal;
    return { ...e, discount: Math.round(sub * e.discountPct) / 100 };
  };
  const set = (patch: Partial<Estimate>) => setEst((e) => withDiscount({ ...e, ...patch }));
  const setItem = (id: string, patch: Partial<Estimate["items"][number]>) =>
    set({ items: est.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });

  const pickClient = (id: string) => {
    const c = data.clients.find((x) => x.id === id);
    set({ clientId: id, projectId: "", clientAddress: c?.address ?? "" });
  };
  const pickJob = (id: string) => {
    const j = data.projects.find((p) => p.id === id);
    set({
      projectId: id,
      title: est.title || j?.name || "",
      productLabel: est.productLabel || [j?.product, j?.subProduct].filter(Boolean).join(" "),
    });
  };
  const pickCountry = (code: CountryCode) =>
    set({ country: code, taxRate: code === "IN" ? (est.country === "IN" ? est.taxRate : s.defaultTaxRate) : 0 });

  const dirty = JSON.stringify(est) !== JSON.stringify(initial);
  const leave = () => {
    if (dirty && !window.confirm(isNew ? "Discard this new estimate?" : "Discard your changes to this estimate?")) return;
    onCancel();
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="back-title">
          <button type="button" className="icon-btn back-btn" onClick={leave} aria-label="Back to estimates">‹</button>
          {isNew ? `Add ${type.label} Estimate` : `Edit ${type.label} Estimate ${est.number}`}
        </h1>
      </div>

      <form className="estimate-editor" onSubmit={(e) => { e.preventDefault(); onSave(est); }}>
        {/* The sheet: everything here prints, laid out like the printed estimate. */}
        <div className="pe-doc pe-edit">
          <div className="pe-fixed" title="From Settings → Agency / Letterhead"><Letterhead /></div>

          <h1 className="pe-title">ESTIMATE</h1>

          <div className="pe-meta">
            <dl className="pe-meta-left">
              <dt>Est No. :</dt>
              <dd><span className="pe-auto" title="Given when you save">{est.number || previewNo}</span></dd>
              <dt>Date :</dt>
              <dd><input required type="date" aria-label="Estimate date" value={est.issueDate} onChange={(e) => set({ issueDate: e.target.value, validUntil: isNew ? addDays(e.target.value, s.estimateValidDays) : est.validUntil })} /></dd>
              <dt>Job No. :</dt>
              <dd>
                <select aria-label="Job" value={est.projectId} onChange={(e) => pickJob(e.target.value)} disabled={!est.clientId}>
                  <option value="">{est.clientId ? "Select…" : "Client first"}</option>
                  {jobs.map((p) => <option key={p.id} value={p.id}>{p.number ?? p.name}</option>)}
                </select>
              </dd>
              <dt>Date :</dt>
              <dd><span className="pe-auto">{job ? dmyDate(job.startDate) : "—"}</span></dd>
              <dt>Job Type :</dt>
              <dd className="span3">
                <input aria-label="Job type" list="job-types" value={est.jobType ?? ""} onChange={(e) => set({ jobType: e.target.value })} placeholder="e.g. Brochure Printing" />
                <datalist id="job-types">{jobTypes.map((x) => <option key={x} value={x} />)}</datalist>
              </dd>
              <dt>Product :</dt>
              <dd className="span3"><input aria-label="Product" value={est.productLabel ?? ""} onChange={(e) => set({ productLabel: e.target.value })} placeholder="From the job's product" /></dd>
            </dl>
            <dl className="pe-meta-right">
              <dt>To:</dt>
              <dd className="pe-to">
                <select required aria-label="Client" value={est.clientId} onChange={(e) => pickClient(e.target.value)}>
                  <option value="" disabled>Select client…</option>
                  {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <AutoTextarea aria-label="Client address" value={est.clientAddress ?? ""} onChange={(e) => set({ clientAddress: e.target.value })} placeholder="Billing address" />
              </dd>
              <dt>GSTIN:</dt><dd><span className="pe-auto">{client?.taxId || "—"}</span></dd>
              <dt>PAN No.:</dt><dd><span className="pe-auto">{client?.pan || "—"}</span></dd>
            </dl>
          </div>

          <div className="pe-rich-edit">
            <RichTextEditor label="Header (optional, prints above the table)" value={est.header ?? ""} onChange={(header) => set({ header })} placeholder="Header (optional) — prints above the table" />
          </div>

          <table className="pe-table pe-table-edit">
            <thead>
              <tr><th className="pe-sl">Sl. No.</th><th>Description</th><th className="pe-amt">Amount({fmt.currency})</th><th className="pe-x" /></tr>
            </thead>
            <tbody>
              {est.items.map((it, i) => (
                <tr key={it.id}>
                  <td className="pe-sl">{i + 1}</td>
                  <td>
                    <AutoTextarea
                      required
                      aria-label={`Line ${i + 1} description`}
                      value={it.description}
                      onChange={(e) => setItem(it.id, { description: e.target.value })}
                      placeholder={"Heading of the work (prints bold)\n• detail lines start with •"}
                    />
                  </td>
                  <td className="pe-amt">
                    <input className="num" type="number" min={0} step="0.01" aria-label={`Line ${i + 1} amount`} value={it.rate || ""} placeholder="0.00" onChange={(e) => setItem(it.id, { rate: Number(e.target.value) })} />
                    <label className="pe-qty-edit">
                      Qty <input type="number" min={0} step="0.01" aria-label={`Line ${i + 1} quantity`} value={it.quantity} onChange={(e) => setItem(it.id, { quantity: Number(e.target.value) })} />
                    </label>
                    {Number(it.quantity) !== 1 && <div className="pe-qty">= {plainAmount(it.quantity * it.rate, fmt.locale)}</div>}
                  </td>
                  <td className="pe-x">
                    <button type="button" className="icon-btn" disabled={est.items.length === 1} onClick={() => set({ items: est.items.filter((x) => x.id !== it.id) })} aria-label={`Remove line ${i + 1}`}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn ghost pe-add" onClick={() => set({ items: [...est.items, newLine()] })}>+ Add line</button>

          <div className="pe-totals">
            <div className="pe-words">Amount in Words: {amountInWords(t.total, fmt.currency)}</div>
            <dl>
              <dt>Total:</dt><dd>{plainAmount(t.subtotal, fmt.locale)}</dd>
              <dt className="pe-inline">
                Discount
                <input type="number" min={0} max={100} step="0.01" aria-label="Discount percent" value={est.discountPct || ""} placeholder="0"
                  onChange={(e) => set({ discountPct: Number(e.target.value) || 0, ...(Number(e.target.value) ? {} : { discount: 0 }) })} />%:
              </dt>
              <dd>
                <input className="num" type="number" min={0} step="0.01" aria-label="Discount amount" value={est.discount || ""} placeholder="0.00"
                  onChange={(e) => setEst({ ...est, discount: Number(e.target.value) || 0, discountPct: 0 })} />
              </dd>
              {t.discount > 0 && <><dt>Taxable Value:</dt><dd>{plainAmount(t.net, fmt.locale)}</dd></>}
              {split === "cgst" && (
                <>
                  <dt className="pe-inline">SGST ({est.taxRate / 2}%):</dt><dd>{plainAmount(t.tax / 2, fmt.locale)}</dd>
                  <dt>CGST ({est.taxRate / 2}%):</dt><dd>{plainAmount(t.tax / 2, fmt.locale)}</dd>
                </>
              )}
              {split === "igst" && <><dt>IGST ({est.taxRate}%):</dt><dd>{plainAmount(t.tax, fmt.locale)}</dd></>}
              <dt className="pe-inline">
                <label className="pe-check"><input type="checkbox" checked={!!est.roundOff} onChange={(e) => set({ roundOff: e.target.checked })} /> Round Off:</label>
              </dt>
              <dd>{plainAmount(t.roundOff, fmt.locale)}</dd>
              <dt className="pe-grand">Grand Total:</dt><dd className="pe-grand">{plainAmount(t.total, fmt.locale)}</dd>
            </dl>
          </div>

          <div className="pe-rich-edit">
            <RichTextEditor label="Remarks (optional, prints below the totals)" value={est.remarks ?? ""} onChange={(remarks) => set({ remarks })} placeholder="Remarks (optional) — any important message to add" />
          </div>

          <div className="pe-fixed" title="From Settings → Letterhead & bank details">
            <SignatureBlock />
            <EstimateFooter />
          </div>
        </div>

        {/* Details that don't print, or that set how the sheet is worked out. */}
        <aside className="card estimate-side">
          <Field label="Title (for your lists) *"><input required value={est.title ?? ""} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. HLL Parivarthan folder" /></Field>
          <Field label="Type">
            <select value={estimateType(est)} onChange={(e) => set({ type: e.target.value as EstimateType })}>
              {ESTIMATE_TYPES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={est.status} onChange={(e) => { const status = e.target.value as EstimateStatus; set({ status, decidedDate: status === "approved" || status === "rejected" ? est.decidedDate || today() : "" }); }}>
              <option value="draft">Draft</option>
              <option value="sent">Sent – awaiting approval</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </Field>
          <Field label="Country / currency">
            <select required value={est.country ?? ""} onChange={(e) => pickCountry(e.target.value as CountryCode)}>
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label} ({c.currency})</option>)}
            </select>
          </Field>
          <Field label="GST rate (%)"><input type="number" min={0} step="0.01" value={est.taxRate} onChange={(e) => set({ taxRate: Number(e.target.value) })} /></Field>
          <Field label="Valid until"><input required type="date" value={est.validUntil} onChange={(e) => set({ validUntil: e.target.value })} /></Field>
          <p className="muted small">
            {split === "cgst" ? "Same state as you: GST is split into SGST + CGST." : split === "igst" ? "Client is in another state: IGST applies." : "No GST on this estimate."}
          </p>
          <div className="estimate-side-actions">
            <button className="btn primary">{isNew ? "Save estimate" : "Save changes"}</button>
            <button type="button" className="btn" onClick={leave}>Cancel</button>
          </div>
        </aside>
      </form>
    </div>
  );
}
