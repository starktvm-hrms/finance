import { useEffect, useMemo, useRef, useState } from "react";
import { COUNTRIES, type Invoice, type InvoiceStatus } from "../types";
import { useStore } from "../lib/store";
import { clearParam } from "../lib/route";
import { addDays, docFormat, downloadFile, fmtDate, invoiceDisplayStatus, invoiceTotals, money, toCSV, today, uid, type DisplayStatus } from "../lib/util";
import { estimateType, typeInfo } from "../lib/doctype";
import { Badge, Empty, Modal, PageHeader, confirmDelete } from "../components/ui";
import { newLine } from "../components/Doc";
import ProductionEstimate from "../components/ProductionEstimate";
import MediaEstimate from "../components/MediaEstimate";
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
const TABS: { id: Filter; label: string; hint: string }[] = [
  { id: "all", label: "All", hint: "Every invoice" },
  { id: "draft", label: "Draft", hint: "Not sent to the client yet" },
  { id: "unpaid", label: "To collect", hint: "Sent and not yet paid" },
  { id: "overdue", label: "Overdue", hint: "Past the due date and not paid" },
  { id: "paid", label: "Paid", hint: "Payment received" },
  { id: "cancelled", label: "Cancelled", hint: "Cancelled invoices" },
];
const matches = (f: Filter, st: DisplayStatus) => f === "all" || f === st || (f === "unpaid" && (st === "sent" || st === "overdue"));

export default function Invoices({ params }: { params: URLSearchParams }) {
  const { data, upsert, remove, updateSettings } = useStore();
  const s = data.settings;
  const clientName = (id: string) => data.clients.find((c) => c.id === id)?.name ?? "—";
  const jobName = (id: string) => data.projects.find((p) => p.id === id)?.name ?? "";
  const fromEstimate = (inv: Invoice) => data.estimates.find((e) => e.invoiceId === inv.id);
  const isNew = (inv: Invoice) => !data.invoices.some((i) => i.id === inv.id);

  const blank = (): Invoice => {
    const issue = today();
    return {
      id: uid(),
      number: "", // given on save unless typed
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
      type: "project",
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
    return f && TABS.some((t) => t.id === f) ? f : "all";
  });
  const [q, setQ] = useState("");
  const tab = TABS.find((t) => t.id === filter)!;
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = tabsRef.current;
    const el = row?.querySelector<HTMLElement>(".tab.active");
    if (row && el) row.scrollLeft = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
  }, [filter]);

  const rows = useMemo(
    () =>
      data.invoices
        .filter((i) => matches(filter, invoiceDisplayStatus(i)) && `${i.number} ${clientName(i.clientId)} ${jobName(i.projectId)} ${i.title ?? ""}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number)),
    [data.invoices, data.clients, data.projects, filter, q], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const count = (f: Filter) => data.invoices.filter((i) => matches(f, invoiceDisplayStatus(i))).length;
  const shownTotal = rows.reduce((t, i) => t + invoiceTotals(i).total, 0);

  const save = (inv: Invoice) => {
    inv = { ...inv, number: inv.number.trim() };
    const clash = inv.number && data.invoices.find((x) => x.id !== inv.id && x.number.toLowerCase() === inv.number.toLowerCase());
    if (clash && !window.confirm(`Invoice No. ${inv.number} is already used by another invoice (${clientName(clash.clientId)}). Save anyway?`)) return;
    if (!inv.number) {
      inv = { ...inv, number: `${s.invoicePrefix}${String(s.nextInvoiceNumber).padStart(4, "0")}` };
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
      <div ref={tabsRef} className="tabs directory-tabs" role="tablist" aria-label="Invoice status">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={filter === t.id} className={`tab ${filter === t.id ? "active" : ""}`} onClick={() => setFilter(t.id)}>
            {t.label}
            <span className="tab-count">{count(t.id)}</span>
          </button>
        ))}
      </div>
      <PageHeader
        level={2}
        title={filter === "all" ? "All invoices" : `${tab.label} invoices`}
        subtitle={`${tab.hint} · ${rows.length} shown · ${money(shownTotal, s)}`}
        actions={
          <>
            <input placeholder="Search number, client or job…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn" onClick={exportCSV} disabled={!rows.length}>Export CSV</button>
            <button className="btn primary" disabled={!data.clients.length} title={!data.clients.length ? "Add a client first" : ""} onClick={() => setEdit(blank())}>+ New invoice</button>
          </>
        }
      />

      <div className="card flush">
        {rows.length === 0 ? (
          <Empty>{data.clients.length ? "No invoices here." : "Add a client first, then create invoices."}</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Number</th><th>Type</th><th>Client / job</th><th>Issued</th><th>Due</th><th>Status</th><th className="num">Total</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const st = invoiceDisplayStatus(i);
                return (
                  <tr key={i.id} className="clickable" onClick={() => setView(i)}>
                    <td><strong>{i.number}</strong></td>
                    <td className="muted">{typeInfo(estimateType(i))?.label}</td>
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
          {estimateType(view) === "media" ? <MediaEstimate est={view} kind="invoice" /> : <ProductionEstimate est={view} kind="invoice" />}
          {fromEstimate(view) && <p className="muted small no-print">Raised from estimate {fromEstimate(view)!.number}.</p>}
          <div className="form-actions no-print">
            <button
              className="btn ghost danger"
              onClick={() => {
                if (confirmDelete(`invoice ${view.number}`)) {
                  remove("invoices", view.id);
                  const est = fromEstimate(view);
                  if (est) upsert("estimates", { ...est, status: "approved", invoiceId: "" }); // back to "to raise"
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
