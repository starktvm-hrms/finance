import type { ReactNode } from "react";
import type { LineItem, Settings } from "../types";
import { useStore } from "../lib/store";
import { docFormat, fmtDate, invoiceTotals, money, uid } from "../lib/util";
import { RichTextView } from "./SafeHtml";

/** Shared by invoices and estimates: anything with line items, tax and a discount. */
export interface Billable {
  items: LineItem[];
  taxRate: number;
  discount: number;
  discountPct?: number;
  roundOff?: boolean;
  country?: string;
}

type Fmt = { currency: string; locale: string };

export const newLine = (): LineItem => ({ id: uid(), description: "", quantity: 1, rate: 0 });

export function ItemsEditor({ items, onChange, settings }: { items: LineItem[]; onChange: (items: LineItem[]) => void; settings: Fmt }) {
  const set = (id: string, patch: Partial<LineItem>) => onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  return (
    <div className="span2 items">
      <div className="items-head"><span>Description</span><span>Qty</span><span>Rate</span><span className="num">Amount</span><span /></div>
      {items.map((it) => (
        <div className="items-row" key={it.id}>
          <textarea
            required
            rows={Math.min(8, Math.max(1, it.description.split("\n").length))}
            placeholder={"Service or deliverable\n• details on new lines starting with •"}
            value={it.description}
            onChange={(e) => set(it.id, { description: e.target.value })}
            aria-label="Description"
          />
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
  const f = docFormat(doc.country, settings);
  return (
    <div className={`totals ${className}`}>
      <div><span>Total</span><span>{money(t.subtotal, f)}</span></div>
      {t.discount > 0 && (
        <>
          <div><span>Discount{doc.discountPct ? ` (${doc.discountPct}%)` : ""}</span><span>− {money(t.discount, f)}</span></div>
          <div><span>Estimated revenue</span><span>{money(t.net, f)}</span></div>
        </>
      )}
      <div><span>Tax ({doc.taxRate}%)</span><span>{money(t.tax, f)}</span></div>
      {doc.roundOff && <div><span>Round off</span><span>{money(t.roundOff, f)}</span></div>}
      <div className="grand"><span>{totalLabel}</span><span>{money(t.total, f)}</span></div>
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
  heading,
  header,
  remarks,
  billTo,
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
  heading?: string; // e.g. the estimate title
  header?: string; // rich text above the lines
  remarks?: string; // rich text below the totals
  billTo?: { address?: string; gstin?: string; pan?: string };
}) {
  const { data } = useStore();
  const s = data.settings;
  const client = data.clients.find((c) => c.id === clientId);
  const project = data.projects.find((p) => p.id === projectId);
  const f = docFormat(doc.country, s);
  const address = billTo?.address ?? client?.address;
  const gstin = billTo?.gstin ?? client?.taxId;
  return (
    <div className="invoice-doc print-area">
      <div className="row between top">
        <div>
          {s.logo && <img className="doc-logo" src={s.logo} alt="" />}
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
        {address && <div className="pre">{address}</div>}
        {client?.email && <div>{client.email}</div>}
        {gstin && <div>GSTIN: {gstin}</div>}
        {(billTo?.pan ?? client?.pan) && <div>PAN: {billTo?.pan ?? client?.pan}</div>}
        {project && <div className="muted small">Job: {project.number ? `${project.number} · ` : ""}{project.name}</div>}
      </div>
      {heading && <h2 className="doc-heading">{heading}</h2>}
      <RichTextView html={header} />
      <table className="table doc-table">
        <thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {doc.items.map((it) => (
            <tr key={it.id}><td>{it.description}</td><td className="num">{it.quantity}</td><td className="num">{money(it.rate, f)}</td><td className="num">{money(it.quantity * it.rate, f)}</td></tr>
          ))}
        </tbody>
      </table>
      <Totals doc={doc} settings={s} totalLabel={totalLabel} />
      {notes && <div className="doc-notes pre">{notes}</div>}
      {remarks && <div className="doc-notes"><RichTextView html={remarks} /></div>}
    </div>
  );
}
