import { useEffect, useMemo, useRef, useState } from "react";
import { COUNTRIES, ESTIMATE_TYPES, type EstimateType, type Invoice, type InvoiceStatus } from "../types";
import { useStore } from "../lib/store";
import { clearParam, go } from "../lib/route";
import { addDays, docFormat, downloadFile, fmtDate, invoiceDisplayStatus, invoiceTotals, money, toCSV, today, uid, type DisplayStatus } from "../lib/util";
import InvoiceSheet from "../components/InvoiceSheet";
import { defaultBranch, makeInvoiceNumber } from "../lib/invoiceno";
import { estimateType, typeInfo } from "../lib/doctype";
import { Badge, Empty, Modal, PageHeader, confirmDelete } from "../components/ui";
import { newLine } from "../components/Doc";
import SheetForm from "../components/SheetForm";

const STATUS: Record<DisplayStatus, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  overdue: { label: "Overdue", tone: "bad" },
  paid: { label: "Paid", tone: "good" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

/** "unpaid" = sent + overdue: everything still to collect. */
type Filter = DisplayStatus | "all" | "unpaid";
const TYPE_TABS = [{ id: "all", label: "All", hint: "Every type" }, ...ESTIMATE_TYPES];
const STATUSES: { id: Filter; label: string; hint: string }[] = [
  { id: "all", label: "All", hint: "Every status" },
  { id: "draft", label: "Draft", hint: "Not sent to the client yet" },
  { id: "unpaid", label: "To collect", hint: "Sent and not yet paid" },
  { id: "overdue", label: "Overdue", hint: "Past the due date and not paid" },
  { id: "paid", label: "Paid", hint: "Payment received" },
  { id: "cancelled", label: "Cancelled", hint: "Cancelled invoices" },
];
const matches = (f: Filter, st: DisplayStatus) => f === "all" || f === st || (f === "unpaid" && (st === "sent" || st === "overdue"));

export default function Invoices({ params }: { params: URLSearchParams }) {
  const { data, upsert, remove, updateSettings, can, access } = useStore();
  const s = data.settings;
  const clientName = (id: string) => data.clients.find((c) => c.id === id)?.name ?? "—";
  const jobName = (id: string) => data.projects.find((p) => p.id === id)?.name ?? "";
  const fromEstimate = (inv: Invoice) => data.estimates.find((e) => (inv.estimateId ? e.id === inv.estimateId : e.invoiceId === inv.id));
  const isNew = (inv: Invoice) => !data.invoices.some((i) => i.id === inv.id);

  const blank = (): Invoice => {
    const issue = today();
    return {
      id: uid(),
      number: "", // given on save unless typed
      branchId: defaultBranch(data, access.employeeId)?.id,
      clientId: "",
      projectId: "",
      issueDate: issue,
      dueDate: addDays(issue, s.paymentTermsDays),
      status: "draft",
      items: [newLine()],
      taxRate: s.defaultTaxRate,
      discount: 0,
      discountPct: 0,
      notes: "",
      paidDate: "",
      country: COUNTRIES.find((c) => c.currency === s.currency)?.code ?? "IN",
      roundOff: true,
      type: typeTab === "all" ? "project" : (typeTab as EstimateType),
      title: "",
      header: "",
      remarks: "",
      clientAddress: "",
      createdAt: new Date().toISOString(),
    };
  };

  // #/invoices?open=<id> shows one; ?edit=<id> opens it in the form; ?status=… picks a tab.
  const [edit, setEdit] = useState<Invoice | null>(() => {
    const id = params.get("edit");
    if (id) clearParam("edit");
    return data.invoices.find((i) => i.id === id) ?? null;
  });
  const [view, setView] = useState<Invoice | null>(() => {
    const id = params.get("open");
    if (id) clearParam("open");
    return data.invoices.find((i) => i.id === id) ?? null;
  });
  const [filter, setFilter] = useState<Filter>(() => {
    const f = params.get("status") as Filter | null;
    return f && STATUSES.some((t) => t.id === f) ? f : "all";
  });
  const [q, setQ] = useState("");
  const status = STATUSES.find((t) => t.id === filter)!;
  // Tab = type, like Estimates (#/invoices?type=media&status=unpaid)
  const typeTab = TYPE_TABS.some((t) => t.id === params.get("type")) ? (params.get("type") as string) : "all";
  const typeLabel = TYPE_TABS.find((t) => t.id === typeTab)!;
  const ofType = (i: Invoice) => typeTab === "all" || estimateType(i) === typeTab;
  const switchTab = (type: string) => go("invoices", { ...(type !== "all" && { type }), ...(filter !== "all" && { status: filter }) });
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = tabsRef.current;
    const el = row?.querySelector<HTMLElement>(".tab.active");
    if (row && el) row.scrollLeft = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
  }, [typeTab]);

  const rows = useMemo(
    () =>
      data.invoices
        .filter((i) => ofType(i) && matches(filter, invoiceDisplayStatus(i)) && `${i.number} ${clientName(i.clientId)} ${jobName(i.projectId)} ${i.title ?? ""}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number)),
    [data.invoices, data.clients, data.projects, filter, q, typeTab], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const count = (f: Filter) => data.invoices.filter((i) => ofType(i) && matches(f, invoiceDisplayStatus(i))).length;
  const shownTotal = rows.reduce((t, i) => t + invoiceTotals(i).total, 0);

  const save = (inv: Invoice) => {
    inv = { ...inv, number: inv.number.trim() };
    const clash = inv.number && data.invoices.find((x) => x.id !== inv.id && x.number.toLowerCase() === inv.number.toLowerCase());
    if (clash && !window.confirm(`Invoice No. ${inv.number} is already used by another invoice (${clientName(clash.clientId)}). Save anyway?`)) return;
    if (!inv.number) {
      // Automatic: branch code / financial year / serial (e.g. tvpm/26-27/284).
      const branchId = inv.branchId || defaultBranch(data, access.employeeId)?.id;
      inv = { ...inv, branchId, number: makeInvoiceNumber(data, inv.issueDate, branchId) };
      updateSettings({ nextInvoiceNumber: s.nextInvoiceNumber + 1 });
    }
    upsert("invoices", inv);
    setEdit(null);
  };

  const setStatus = (inv: Invoice, status: InvoiceStatus) =>
    upsert("invoices", { ...inv, status, paidDate: status === "paid" ? inv.paidDate || today() : "" });

  const startEdit = (inv: Invoice) => {
    setView(null);
    setEdit(data.invoices.find((x) => x.id === inv.id) ?? inv);
  };

  const exportCSV = () =>
    downloadFile(
      `invoices-${today()}.csv`,
      toCSV(rows.map((i) => {
        const t = invoiceTotals(i);
        return { number: i.number, type: typeInfo(estimateType(i))?.label, client: clientName(i.clientId), job: jobName(i.projectId), issued: i.issueDate, due: i.dueDate, status: invoiceDisplayStatus(i), subtotal: t.subtotal, discount: t.discount, tax: t.tax, round_off: t.roundOff, total: t.total, paid_on: i.paidDate };
      })),
      "text/csv",
    );

  if (edit) return <SheetForm kind="invoice" initial={edit} isNew={isNew(edit)} onCancel={() => setEdit(null)} onSave={(d) => save(d as Invoice)} />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Invoices</h1>
          <p className="muted">Raise, send and collect client invoices.</p>
        </div>
      </div>
      <div ref={tabsRef} className="tabs directory-tabs" role="tablist" aria-label="Invoice types">
        {TYPE_TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={typeTab === t.id} className={`tab ${typeTab === t.id ? "active" : ""}`} onClick={() => switchTab(t.id)}>
            {t.label}
            <span className="tab-count">{t.id === "all" ? data.invoices.length : data.invoices.filter((i) => estimateType(i) === t.id).length}</span>
          </button>
        ))}
      </div>
      <PageHeader
        level={2}
        title={typeTab === "all" ? "All invoices" : `${typeLabel.label} invoices`}
        subtitle={`${filter === "all" ? typeLabel.hint : status.hint} · ${rows.length} shown · ${money(shownTotal, s)}`}
        actions={
          <>
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Status">
              {STATUSES.map((f) => <option key={f.id} value={f.id}>{f.id === "all" ? "All statuses" : f.label} ({count(f.id)})</option>)}
            </select>
            <input placeholder="Search number, client or job…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn" onClick={exportCSV} disabled={!rows.length}>Export CSV</button>
            <button className="btn primary" disabled={!data.clients.length} title={!data.clients.length ? "Add a client first" : ""} onClick={() => setEdit(blank())}>
              + New {typeTab === "all" ? "" : `${typeLabel.label.toLowerCase()} `}invoice
            </button>
          </>
        }
      />

      <div className="card flush">
        {rows.length === 0 ? (
          <Empty>{!data.clients.length ? "Add a client first, then create invoices." : typeTab === "all" ? "No invoices here." : `No ${typeLabel.label.toLowerCase()} invoices${filter === "all" ? "" : " with this status"}.`}</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Number</th>{typeTab === "all" && <th>Type</th>}<th>Client / job</th><th>Issued</th><th>Due</th><th>Status</th><th className="num">Total</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const st = invoiceDisplayStatus(i);
                return (
                  <tr key={i.id} className="clickable" onClick={() => setView(i)}>
                    <td><strong>{i.number}</strong></td>
                    {typeTab === "all" && <td className="muted">{typeInfo(estimateType(i))?.label}</td>}
                    <td>{clientName(i.clientId)}{(i.projectId || i.title) && <div className="muted small">{jobName(i.projectId) || i.title}</div>}</td>
                    <td className="nowrap">{fmtDate(i.issueDate, s.locale)}</td>
                    <td className={`nowrap ${st === "overdue" ? "bad" : ""}`}>{fmtDate(i.dueDate, s.locale)}</td>
                    <td><Badge tone={STATUS[st].tone}>{STATUS[st].label}</Badge></td>
                    <td className="num">{money(invoiceTotals(i).total, docFormat(i.country, s))}</td>
                    <td className="actions" onClick={(e) => e.stopPropagation()}>
                      {i.status === "draft" && <button className="btn ghost" onClick={() => setStatus(i, "sent")}>Mark sent</button>}
                      {i.status === "sent" && <button className="btn ghost good" onClick={() => setStatus(i, "paid")}>Mark paid</button>}
                      <button className="btn ghost" onClick={() => startEdit(i)} aria-label={`Edit ${i.number}`}>Edit</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {view && (
        <Modal title={`Invoice ${view.number}`} onClose={() => setView(null)} wide>
          <InvoiceSheet inv={view} />
          {fromEstimate(view) && <p className="muted small no-print">{view.billing === "part" ? "Part invoice" : view.billing === "balance" ? "Balance invoice" : "Raised"} from estimate {fromEstimate(view)!.number}.</p>}
          <div className="form-actions no-print">
            <button
              className="btn ghost danger"
              onClick={() => {
                if (confirmDelete(`invoice ${view.number}`)) {
                  remove("invoices", view.id);
                  const est = fromEstimate(view);
                  // The estimate goes back to "to raise" for what this invoice billed.
                  if (est && can("estimates")) upsert("estimates", { ...est, status: est.status === "invoiced" ? "approved" : est.status, invoiceId: est.invoiceId === view.id ? "" : est.invoiceId });
                  setView(null);
                }
              }}
            >
              Delete
            </button>
            <div className="spacer" />
            {view.status !== "cancelled" && view.status !== "paid" && (
              <button className="btn" onClick={() => { setStatus(view, "cancelled"); setView(null); }}>Cancel invoice</button>
            )}
            {view.status === "paid" && <button className="btn" onClick={() => { setStatus(view, "sent"); setView(null); }}>Mark unpaid</button>}
            <button className="btn" onClick={() => startEdit(view)}>Edit</button>
            <button className="btn primary" onClick={() => window.print()}>Print / Save PDF</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
