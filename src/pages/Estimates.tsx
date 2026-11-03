import { useEffect, useMemo, useRef, useState } from "react";
import { COUNTRIES, ESTIMATE_TYPES, type Estimate, type EstimateStatus, type EstimateType, type Invoice } from "../types";
import { useStore } from "../lib/store";
import { clearParam, go } from "../lib/route";
import { addDays, docFormat, financialYear, fmtDate, invoiceTotals, money, today, uid } from "../lib/util";
import MediaEstimate from "../components/MediaEstimate";
import ProductionEstimate from "../components/ProductionEstimate";
import SheetForm from "../components/SheetForm";
import { estimateType, typeInfo } from "../lib/doctype";
import { Badge, Empty, Modal, PageHeader, confirmDelete } from "../components/ui";
import { newLine } from "../components/Doc";
// The editor (Quill) is only downloaded when an estimate form is opened.

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

export { estimateType };
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
      jobType: job?.jobType ?? "",
      productLabel: [job?.product, job?.subProduct].filter(Boolean).join(" "),
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
  // From the dashboard's "Estimates · For approval" tile: everything except media.
  const [noMedia, setNoMedia] = useState(params.get("kind") === "production");
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
        .filter((e) => (!noMedia || estimateType(e) !== "media") && (typeTab === "all" || estimateType(e) === typeTab) && (filter === "all" || e.status === filter) && `${e.number} ${clientName(e.clientId)} ${jobName(e.projectId)}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number)),
    [data.estimates, data.clients, data.projects, filter, q, typeTab, noMedia], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const save = (e: Estimate) => {
    e = { ...e, number: e.number.trim() };
    const clash = e.number && data.estimates.find((x) => x.id !== e.id && x.number.toLowerCase() === e.number.toLowerCase());
    if (clash && !window.confirm(`Estimate No. ${e.number} is already used by "${clash.title || clientName(clash.clientId)}". Save anyway?`)) return;
    if (!e.number) {
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
      type: e.type,
      title: e.title,
      jobType: e.jobType,
      productLabel: e.productLabel,
      clientAddress: e.clientAddress,
      header: e.header,
      remarks: e.remarks,
      discountPct: e.discountPct,
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

  if (edit) return <SheetForm kind="estimate" initial={edit} isNew={isNew(edit)} onCancel={() => setEdit(null)} onSave={(d) => save(d as Estimate)} />;

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
      {noMedia && typeTab === "all" && (
        <div className="row gap">
          <span className="badge badge-info">Excluding media estimates</span>
          <button className="btn ghost" onClick={() => setNoMedia(false)}>Show all</button>
        </div>
      )}
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
          {estimateType(view) === "media" ? <MediaEstimate est={view} /> : <ProductionEstimate est={view} />}
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

