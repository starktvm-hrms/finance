import { useMemo, useState } from "react";
import type { Invoice, InvoiceStatus } from "../types";
import { useStore } from "../lib/store";
import { addDays, downloadFile, fmtDate, invoiceDisplayStatus, invoiceTotals, money, toCSV, today, uid, type DisplayStatus } from "../lib/util";
import { Badge, Empty, Field, Modal, PageHeader, confirmDelete } from "../components/ui";

const STATUS: Record<DisplayStatus, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  overdue: { label: "Overdue", tone: "bad" },
  paid: { label: "Paid", tone: "good" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

export default function Invoices() {
  const { data, upsert, remove, updateSettings } = useStore();
  const s = data.settings;
  const [edit, setEdit] = useState<Invoice | null>(null);
  const [view, setView] = useState<Invoice | null>(null);
  const [filter, setFilter] = useState<DisplayStatus | "all">("all");
  const [q, setQ] = useState("");

  const clientName = (id: string) => data.clients.find((c) => c.id === id)?.name ?? "—";
  const isNew = (inv: Invoice) => !data.invoices.some((i) => i.id === inv.id);

  const blank = (): Invoice => {
    const issue = today();
    return {
      id: uid(),
      number: `${s.invoicePrefix}${String(s.nextInvoiceNumber).padStart(4, "0")}`,
      clientId: data.clients[0]?.id ?? "",
      projectId: "",
      issueDate: issue,
      dueDate: addDays(issue, s.paymentTermsDays),
      status: "draft",
      items: [{ id: uid(), description: "", quantity: 1, rate: 0 }],
      taxRate: s.defaultTaxRate,
      discount: 0,
      notes: "",
      paidDate: "",
      createdAt: new Date().toISOString(),
    };
  };

  const rows = useMemo(
    () =>
      data.invoices
        .filter((i) => (filter === "all" || invoiceDisplayStatus(i) === filter) && `${i.number} ${clientName(i.clientId)}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number)),
    [data.invoices, data.clients, filter, q],
  );

  const counts = data.invoices.reduce<Record<string, number>>((acc, i) => ((acc[invoiceDisplayStatus(i)] = (acc[invoiceDisplayStatus(i)] || 0) + 1), acc), {});

  const save = (inv: Invoice) => {
    if (isNew(inv)) updateSettings({ nextInvoiceNumber: s.nextInvoiceNumber + 1 });
    upsert("invoices", inv);
    setEdit(null);
  };

  const setStatus = (inv: Invoice, status: InvoiceStatus) =>
    upsert("invoices", { ...inv, status, paidDate: status === "paid" ? inv.paidDate || today() : "" });

  const exportCSV = () =>
    downloadFile(
      `invoices-${today()}.csv`,
      toCSV(rows.map((i) => {
        const t = invoiceTotals(i);
        return { number: i.number, client: clientName(i.clientId), issued: i.issueDate, due: i.dueDate, status: invoiceDisplayStatus(i), subtotal: t.subtotal, discount: t.discount, tax: t.tax, total: t.total, paid_on: i.paidDate };
      })),
      "text/csv",
    );

  return (
    <div className="page">
      <PageHeader
        title="Invoices"
        subtitle="Create, send and track client invoices."
        actions={
          <>
            <button className="btn" onClick={exportCSV} disabled={!rows.length}>Export CSV</button>
            <button className="btn primary" disabled={!data.clients.length} title={!data.clients.length ? "Add a client first" : ""} onClick={() => setEdit(blank())}>+ New invoice</button>
          </>
        }
      />
      <div className="filters">
        <div className="tabs">
          {(["all", "draft", "sent", "overdue", "paid", "cancelled"] as const).map((k) => (
            <button key={k} className={`tab ${filter === k ? "active" : ""}`} onClick={() => setFilter(k)}>
              {k === "all" ? "All" : STATUS[k].label}
              <span className="tab-count">{k === "all" ? data.invoices.length : counts[k] || 0}</span>
            </button>
          ))}
        </div>
        <input placeholder="Search number or client…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card flush">
        {rows.length === 0 ? (
          <Empty>{data.clients.length ? "No invoices here." : "Add a client first, then create invoices."}</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Number</th><th>Client</th><th>Issued</th><th>Due</th><th>Status</th><th className="num">Total</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const st = invoiceDisplayStatus(i);
                return (
                  <tr key={i.id} className="clickable" onClick={() => setView(i)}>
                    <td><strong>{i.number}</strong></td>
                    <td>{clientName(i.clientId)}</td>
                    <td className="nowrap">{fmtDate(i.issueDate, s.locale)}</td>
                    <td className={`nowrap ${st === "overdue" ? "bad" : ""}`}>{fmtDate(i.dueDate, s.locale)}</td>
                    <td><Badge tone={STATUS[st].tone}>{STATUS[st].label}</Badge></td>
                    <td className="num">{money(invoiceTotals(i).total, s)}</td>
                    <td className="actions" onClick={(e) => e.stopPropagation()}>
                      {i.status === "draft" && <button className="btn ghost" onClick={() => setStatus(i, "sent")}>Mark sent</button>}
                      {i.status === "sent" && <button className="btn ghost good" onClick={() => setStatus(i, "paid")}>Mark paid</button>}
                      <button className="btn ghost" onClick={() => setEdit(i)}>Edit</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {edit && <InvoiceEditor initial={edit} isNew={isNew(edit)} onCancel={() => setEdit(null)} onSave={save} />}

      {view && (
        <Modal title={`Invoice ${view.number}`} onClose={() => setView(null)} wide>
          <InvoiceDocument inv={view} />
          <div className="form-actions no-print">
            <button
              className="btn ghost danger"
              onClick={() => {
                if (confirmDelete(`invoice ${view.number}`)) {
                  remove("invoices", view.id);
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
            <button className="btn" onClick={() => { setEdit(view); setView(null); }}>Edit</button>
            <button className="btn primary" onClick={() => window.print()}>Print / Save PDF</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function InvoiceEditor({ initial, isNew, onSave, onCancel }: { initial: Invoice; isNew: boolean; onSave: (i: Invoice) => void; onCancel: () => void }) {
  const { data } = useStore();
  const s = data.settings;
  const [inv, setInv] = useState(initial);
  const t = invoiceTotals(inv);
  const projects = data.projects.filter((p) => p.clientId === inv.clientId);
  const setItem = (id: string, patch: Partial<Invoice["items"][number]>) =>
    setInv({ ...inv, items: inv.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });

  return (
    <Modal title={isNew ? "New invoice" : `Edit ${inv.number}`} onClose={onCancel} wide>
      <form className="form" onSubmit={(e) => { e.preventDefault(); onSave(inv); }}>
        <Field label="Invoice number"><input required value={inv.number} onChange={(e) => setInv({ ...inv, number: e.target.value })} /></Field>
        <Field label="Status">
          <select value={inv.status} onChange={(e) => { const status = e.target.value as InvoiceStatus; setInv({ ...inv, status, paidDate: status === "paid" ? inv.paidDate || today() : "" }); }}>
            <option value="draft">Draft</option><option value="sent">Sent</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option>
          </select>
        </Field>
        <Field label="Client">
          <select required value={inv.clientId} onChange={(e) => setInv({ ...inv, clientId: e.target.value, projectId: "" })}>
            {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Project (optional)">
          <select value={inv.projectId} onChange={(e) => setInv({ ...inv, projectId: e.target.value })}>
            <option value="">—</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Issue date"><input required type="date" value={inv.issueDate} onChange={(e) => setInv({ ...inv, issueDate: e.target.value, dueDate: isNew ? addDays(e.target.value, s.paymentTermsDays) : inv.dueDate })} /></Field>
        <Field label="Due date"><input required type="date" value={inv.dueDate} onChange={(e) => setInv({ ...inv, dueDate: e.target.value })} /></Field>
        {inv.status === "paid" && <Field label="Paid on"><input type="date" value={inv.paidDate} onChange={(e) => setInv({ ...inv, paidDate: e.target.value })} /></Field>}

        <div className="span2 items">
          <div className="items-head"><span>Description</span><span>Qty</span><span>Rate</span><span className="num">Amount</span><span /></div>
          {inv.items.map((it) => (
            <div className="items-row" key={it.id}>
              <input required placeholder="Service or deliverable" value={it.description} onChange={(e) => setItem(it.id, { description: e.target.value })} aria-label="Description" />
              <input type="number" min={0} step="0.01" value={it.quantity} onChange={(e) => setItem(it.id, { quantity: Number(e.target.value) })} aria-label="Quantity" />
              <input type="number" min={0} step="0.01" value={it.rate || ""} onChange={(e) => setItem(it.id, { rate: Number(e.target.value) })} aria-label="Rate" />
              <span className="num">{money(it.quantity * it.rate, s)}</span>
              <button type="button" className="icon-btn" disabled={inv.items.length === 1} onClick={() => setInv({ ...inv, items: inv.items.filter((x) => x.id !== it.id) })} aria-label="Remove line">×</button>
            </div>
          ))}
          <button type="button" className="btn ghost" onClick={() => setInv({ ...inv, items: [...inv.items, { id: uid(), description: "", quantity: 1, rate: 0 }] })}>+ Add line</button>
        </div>

        <Field label={`Discount (${s.currency})`}><input type="number" min={0} step="0.01" value={inv.discount || ""} onChange={(e) => setInv({ ...inv, discount: Number(e.target.value) })} /></Field>
        <Field label="Tax rate (%)"><input type="number" min={0} step="0.01" value={inv.taxRate} onChange={(e) => setInv({ ...inv, taxRate: Number(e.target.value) })} /></Field>
        <Field label="Notes / payment instructions" span={2}><textarea rows={2} value={inv.notes} onChange={(e) => setInv({ ...inv, notes: e.target.value })} /></Field>

        <div className="totals span2">
          <div><span>Subtotal</span><span>{money(t.subtotal, s)}</span></div>
          {t.discount > 0 && <div><span>Discount</span><span>− {money(t.discount, s)}</span></div>}
          <div><span>Tax ({inv.taxRate}%)</span><span>{money(t.tax, s)}</span></div>
          <div className="grand"><span>Total</span><span>{money(t.total, s)}</span></div>
        </div>
        <div className="form-actions span2">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary">Save invoice</button>
        </div>
      </form>
    </Modal>
  );
}

function InvoiceDocument({ inv }: { inv: Invoice }) {
  const { data } = useStore();
  const s = data.settings;
  const client = data.clients.find((c) => c.id === inv.clientId);
  const project = data.projects.find((p) => p.id === inv.projectId);
  const t = invoiceTotals(inv);
  return (
    <div className="invoice-doc print-area">
      <div className="row between top">
        <div>
          <div className="doc-agency">{s.agencyName}</div>
          <div className="muted pre">{s.agencyAddress}</div>
          <div className="muted">{s.agencyEmail}</div>
          {s.taxId && <div className="muted">Tax ID: {s.taxId}</div>}
        </div>
        <div className="right">
          <div className="doc-title">INVOICE</div>
          <div><strong>{inv.number}</strong></div>
          <div className="muted">Issued {fmtDate(inv.issueDate, s.locale)}</div>
          <div className="muted">Due {fmtDate(inv.dueDate, s.locale)}</div>
          {inv.status === "paid" && <Badge tone="good">Paid {fmtDate(inv.paidDate, s.locale)}</Badge>}
        </div>
      </div>
      <div className="doc-bill">
        <div className="muted small">BILL TO</div>
        <strong>{client?.name}</strong>
        {client?.contactName && <div>{client.contactName}</div>}
        {client?.address && <div className="pre">{client.address}</div>}
        {client?.email && <div>{client.email}</div>}
        {client?.taxId && <div>Tax ID: {client.taxId}</div>}
        {project && <div className="muted small">Project: {project.name}</div>}
      </div>
      <table className="table doc-table">
        <thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {inv.items.map((it) => (
            <tr key={it.id}><td>{it.description}</td><td className="num">{it.quantity}</td><td className="num">{money(it.rate, s)}</td><td className="num">{money(it.quantity * it.rate, s)}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="totals">
        <div><span>Subtotal</span><span>{money(t.subtotal, s)}</span></div>
        {t.discount > 0 && <div><span>Discount</span><span>− {money(t.discount, s)}</span></div>}
        <div><span>Tax ({inv.taxRate}%)</span><span>{money(t.tax, s)}</span></div>
        <div className="grand"><span>Total due</span><span>{money(t.total, s)}</span></div>
      </div>
      {inv.notes && <div className="doc-notes pre">{inv.notes}</div>}
    </div>
  );
}
