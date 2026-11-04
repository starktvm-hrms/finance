import { useState } from "react";
import type { Estimate, Invoice } from "../types";
import { useStore } from "../lib/store";
import { go } from "../lib/route";
import { estimateBilling } from "../lib/billing";
import { defaultBranch, makeInvoiceNumber } from "../lib/invoiceno";
import { addDays, docFormat, money, today, uid } from "../lib/util";
import { Field, Modal } from "./ui";

  /**
 * Raise an invoice from an approved estimate and open it:
 * - "full": every line of the estimate (nothing invoiced yet);
 * - "balance": whatever is left after part invoices;
 * - a part: one line for the amount (pre-tax) given.
 * Any number of part invoices can be raised before the balance.
 */
export function useCreateInvoice() {
  const { data, upsert, updateSettings, access } = useStore();
  const s = data.settings;
  return (e: Estimate, how: "full" | { amount: number; text: string }) => {
    const b = estimateBilling(data, e);
    const issue = today();
    const part = how !== "full";
    const balance = !part && b.started;
    const amount = part ? how.amount : b.remaining;
    const lineText = part ? how.text : `Balance payment against Estimate No. ${e.number}${e.title ? ` — ${e.title}` : ""}`;
    const inv: Invoice = {
      id: uid(),
      number: makeInvoiceNumber(data, issue, defaultBranch(data, access.employeeId)?.id),
      branchId: defaultBranch(data, access.employeeId)?.id,
      clientId: e.clientId,
      projectId: e.projectId,
      estimateId: e.id,
      billing: part ? "part" : balance ? "balance" : "full",
      issueDate: issue,
      dueDate: addDays(issue, s.paymentTermsDays),
      status: "draft",
      items: part || balance ? [{ id: uid(), description: lineText, quantity: 1, rate: amount }] : e.items.map((it) => ({ ...it, id: uid() })),
      taxRate: e.taxRate,
      discount: part || balance ? 0 : e.discount,
      discountPct: part || balance ? undefined : e.discountPct,
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
      paidDate: "",
      createdAt: new Date().toISOString(),
    };
    upsert("invoices", inv);
    updateSettings({ nextInvoiceNumber: s.nextInvoiceNumber + 1 });
    const fullyBilled = !part || amount >= b.remaining - 0.009;
    upsert("estimates", { ...e, status: fullyBilled ? "invoiced" : "approved", invoiceId: inv.id });
    go("invoices", { open: inv.id });
  };
}

/** Billed so far, with links to each invoice. */
export function BillingLine({ est: e }: { est: Estimate }) {
    const { data } = useStore();
    const s = data.settings;
    const b = estimateBilling(data, e);
    if (!b.invoices.length) return null;
    const fmt = docFormat(e.country, s);
    return (
      <div className="billing" onClick={(ev) => ev.stopPropagation()}>
        <div className="bar-track" title={`${money(b.billed, fmt)} of ${money(b.total, fmt)} invoiced (before tax)`}><div className="bar-fill" style={{ width: `${b.pct}%` }} /></div>
        <div className="small muted">{b.pct}% invoiced{b.remaining > 0 && ` · ${money(b.remaining, fmt)} left`}</div>
        <div className="inv-chips">
          {b.invoices.map((i) => (
            <button key={i.id} className={`chip ${i.status === "paid" ? "paid" : i.status === "cancelled" ? "cancelled" : ""}`} title={`${i.billing === "part" ? "Part" : i.billing === "balance" ? "Balance" : "Full"} invoice · ${i.status}`} onClick={() => go("invoices", { open: i.id })}>
              {i.number}
            </button>
          ))}
        </div>
      </div>
    );
  }

/** Ask how much of the estimate to invoice now (a percentage or an amount, before tax). */
export function PartInvoice({ est, onCancel, onCreate }: { est: Estimate; onCancel: () => void; onCreate: (amount: number, text: string) => void }) {
  const { data } = useStore();
  const b = estimateBilling(data, est);
  const fmt = docFormat(est.country, data.settings);
  const n = b.invoices.filter((i) => i.billing === "part" && i.status !== "cancelled").length + 1;
  const [mode, setMode] = useState<"pct" | "amount">("pct");
  const [value, setValue] = useState(b.started ? "" : "50");
  const v = Number(value) || 0;
  const amount = Math.round((mode === "pct" ? (b.total * v) / 100 : v) * 100) / 100;
  const pctOfTotal = b.total ? Math.round((amount / b.total) * 1000) / 10 : 0;
  const defaultText = `Part payment ${n} (${pctOfTotal}%) against Estimate No. ${est.number}${est.title ? ` — ${est.title}` : ""}`;
  const [text, setText] = useState("");
  const tax = (amount * (Number(est.taxRate) || 0)) / 100;
  const tooMuch = amount > b.remaining + 0.009;
  return (
    <Modal title={`Part invoice for ${est.number}`} onClose={onCancel}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (amount > 0 && !tooMuch) onCreate(amount, text.trim() || defaultText); }}>
        <div className="span2 part-sum small">
          <div className="row between"><span className="muted">Estimate (before tax)</span><span>{money(b.total, fmt)}</span></div>
          <div className="row between"><span className="muted">Invoiced so far</span><span>{money(b.billed, fmt)} ({b.pct}%)</span></div>
          <div className="row between"><strong>Left to invoice</strong><strong>{money(b.remaining, fmt)}</strong></div>
        </div>
        <Field label="Invoice">
          <select value={mode} onChange={(e) => { setMode(e.target.value as "pct" | "amount"); setValue(""); }}>
            <option value="pct">A percentage of the estimate</option>
            <option value="amount">An amount</option>
          </select>
        </Field>
        <Field label={mode === "pct" ? "Percentage (%)" : `Amount before tax (${fmt.currency})`}>
          <input type="number" min={0} step="0.01" required autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field label="Line on the invoice" span={2}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={defaultText} />
        </Field>
        <div className="span2 part-sum small">
          <div className="row between"><span className="muted">This invoice</span><span>{money(amount, fmt)} + {money(tax, fmt)} tax = <strong>{money(amount + tax, fmt)}</strong></span></div>
          {tooMuch && <div className="bad">That's more than is left to invoice ({money(b.remaining, fmt)}).</div>}
        </div>
        <div className="form-actions span2">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={!(amount > 0) || tooMuch}>Create part invoice</button>
        </div>
      </form>
    </Modal>
  );
}
