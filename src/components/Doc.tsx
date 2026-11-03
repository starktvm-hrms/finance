import type { ReactNode } from "react";
import type { LineItem, Settings } from "../types";
import { useStore } from "../lib/store";
import { fmtDate, invoiceTotals, money, uid } from "../lib/util";

/** Shared by invoices and estimates: anything with line items, tax and a discount. */
export interface Billable {
  items: LineItem[];
  taxRate: number;
  discount: number;
}

export const newLine = (): LineItem => ({ id: uid(), description: "", quantity: 1, rate: 0 });

export function ItemsEditor({ items, onChange, settings }: { items: LineItem[]; onChange: (items: LineItem[]) => void; settings: Settings }) {
  const set = (id: string, patch: Partial<LineItem>) => onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  return (
    <div className="span2 items">
      <div className="items-head"><span>Description</span><span>Qty</span><span>Rate</span><span className="num">Amount</span><span /></div>
      {items.map((it) => (
        <div className="items-row" key={it.id}>
          <input required placeholder="Service or deliverable" value={it.description} onChange={(e) => set(it.id, { description: e.target.value })} aria-label="Description" />
          <input type="number" min={0} step="0.01" value={it.quantity} onChange={(e) => set(it.id, { quantity: Number(e.target.value) })} aria-label="Quantity" />
          <input type="number" min={0} step="0.01" value={it.rate || ""} onChange={(e) => set(it.id, { rate: Number(e.target.value) })} aria-label="Rate" />
          <span className="num">{money(it.quantity * it.rate, settings)}</span>
          <button type="button" className="icon-btn" disabled={items.length === 1} onClick={() => onChange(items.filter((x) => x.id !== it.id))} aria-label="Remove line">×</button>
        </div>
      ))}
      <button type="button" className="btn ghost" onClick={() => onChange([...items, newLine()])}>+ Add line</button>
    </div>
  );
}

export function Totals({ doc, settings, totalLabel = "Total", className = "" }: { doc: Billable; settings: Settings; totalLabel?: string; className?: string }) {
  const t = invoiceTotals(doc);
  return (
    <div className={`totals ${className}`}>
      <div><span>Subtotal</span><span>{money(t.subtotal, settings)}</span></div>
      {t.discount > 0 && <div><span>Discount</span><span>− {money(t.discount, settings)}</span></div>}
      <div><span>Tax ({doc.taxRate}%)</span><span>{money(t.tax, settings)}</span></div>
      <div className="grand"><span>{totalLabel}</span><span>{money(t.total, settings)}</span></div>
    </div>
  );
}

/** Printable invoice / estimate. */
export function DocumentView({
  title,
  number,
  clientId,
  projectId,
  dates,
  badge,
  doc,
  notes,
  totalLabel,
}: {
  title: string;
  number: string;
  clientId: string;
  projectId: string;
  dates: [string, string][];
  badge?: ReactNode;
  doc: Billable;
  notes: string;
  totalLabel: string;
}) {
  const { data } = useStore();
  const s = data.settings;
  const client = data.clients.find((c) => c.id === clientId);
  const project = data.projects.find((p) => p.id === projectId);
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
          <div className="doc-title">{title}</div>
          <div><strong>{number}</strong></div>
          {dates.map(([label, d]) => (
            <div key={label} className="muted">{label} {fmtDate(d, s.locale)}</div>
          ))}
          {badge}
        </div>
      </div>
      <div className="doc-bill">
        <div className="muted small">BILL TO</div>
        <strong>{client?.name}</strong>
        {client?.contactName && <div>{client.contactName}</div>}
        {client?.address && <div className="pre">{client.address}</div>}
        {client?.email && <div>{client.email}</div>}
        {client?.taxId && <div>Tax ID: {client.taxId}</div>}
        {project && <div className="muted small">Job: {project.name}</div>}
      </div>
      <table className="table doc-table">
        <thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {doc.items.map((it) => (
            <tr key={it.id}><td>{it.description}</td><td className="num">{it.quantity}</td><td className="num">{money(it.rate, s)}</td><td className="num">{money(it.quantity * it.rate, s)}</td></tr>
          ))}
        </tbody>
      </table>
      <Totals doc={doc} settings={s} totalLabel={totalLabel} />
      {notes && <div className="doc-notes pre">{notes}</div>}
    </div>
  );
}
