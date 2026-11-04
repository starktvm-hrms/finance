import type { AppData, Estimate, Invoice } from "../types";
import { invoiceTotals } from "./util";

/** Invoices raised against an estimate (part, balance or full), oldest first. */
export function estimateInvoices(data: AppData, e: Estimate): Invoice[] {
  return data.invoices
    .filter((i) => i.estimateId === e.id || (!i.estimateId && i.id === e.invoiceId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** How much of an estimate has been invoiced (pre-tax amounts; cancelled invoices don't count). */
export function estimateBilling(data: AppData, e: Estimate) {
  const invoices = estimateInvoices(data, e);
  const live = invoices.filter((i) => i.status !== "cancelled");
  const total = invoiceTotals(e).net;
  const billed = live.reduce((t, i) => t + invoiceTotals(i).net, 0);
  const remaining = Math.max(0, Math.round((total - billed) * 100) / 100);
  const pct = total ? Math.min(100, Math.round((billed / total) * 100)) : 0;
  return { invoices, total, billed, remaining, pct, started: live.length > 0, done: live.length > 0 && remaining <= 0.009 };
}
