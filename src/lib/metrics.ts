import type { AppData, Invoice } from "../types";
import { invoiceDisplayStatus, invoiceTotals, lastNMonths, monthKey, today } from "./util";

/** Net (pre-tax) revenue of an invoice: subtotal minus discount. */
export const netRevenue = (inv: Invoice) => {
  const t = invoiceTotals(inv);
  return t.net;
};

export function computeMetrics(data: AppData, months: number) {
  const keys = lastNMonths(months);
  const from = keys[0] + "-01";
  const to = today();
  const inRange = (d: string) => !!d && d >= from && d <= to;

  const paid = data.invoices.filter((i) => i.status === "paid" && inRange(i.paidDate || i.issueDate));
  const expenses = data.expenses.filter((e) => inRange(e.date));

  const revenue = paid.reduce((s, i) => s + netRevenue(i), 0);
  const taxCollected = paid.reduce((s, i) => s + invoiceTotals(i).tax, 0);
  const spent = expenses.reduce((s, e) => s + e.amount, 0);

  const open = data.invoices.filter((i) => i.status === "sent");
  const outstanding = open.reduce((s, i) => s + invoiceTotals(i).total, 0);
  const overdueList = open.filter((i) => invoiceDisplayStatus(i) === "overdue");
  const overdue = overdueList.reduce((s, i) => s + invoiceTotals(i).total, 0);

  const monthly = keys.map((k) => {
    const inc = paid.filter((i) => monthKey(i.paidDate || i.issueDate) === k).reduce((s, i) => s + netRevenue(i), 0);
    const exp = expenses.filter((e) => monthKey(e.date) === k).reduce((s, e) => s + e.amount, 0);
    return { month: k, income: inc, expenses: exp, profit: inc - exp };
  });

  const byCategory = Object.entries(
    expenses.reduce<Record<string, number>>((acc, e) => ((acc[e.category] = (acc[e.category] || 0) + e.amount), acc), {}),
  )
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const byClient = data.clients
    .map((c) => ({
      id: c.id,
      name: c.name,
      revenue: paid.filter((i) => i.clientId === c.id).reduce((s, i) => s + netRevenue(i), 0),
      outstanding: open.filter((i) => i.clientId === c.id).reduce((s, i) => s + invoiceTotals(i).total, 0),
    }))
    .filter((c) => c.revenue || c.outstanding)
    .sort((a, b) => b.revenue - a.revenue);

  return { revenue, taxCollected, spent, profit: revenue - spent, outstanding, overdue, overdueList, monthly, byCategory, byClient };
}

/** All-time profitability per project (paid invoices vs. expenses tagged to it). */
export function projectFinancials(data: AppData, projectId: string) {
  const invoiced = data.invoices
    .filter((i) => i.projectId === projectId && i.status !== "cancelled" && i.status !== "draft")
    .reduce((s, i) => s + netRevenue(i), 0);
  const received = data.invoices
    .filter((i) => i.projectId === projectId && i.status === "paid")
    .reduce((s, i) => s + netRevenue(i), 0);
  const cost = data.expenses.filter((e) => e.projectId === projectId).reduce((s, e) => s + e.amount, 0);
  return { invoiced, received, cost, profit: received - cost };
}

/**
 * Workflow queues shown as tiles on the dashboard:
 * job (lead) → estimate sent → approved → invoice raised → paid.
 */
export function workflowQueues(data: AppData) {
  const quoted = new Set(data.estimates.filter((e) => e.status !== "rejected" && e.projectId).map((e) => e.projectId));
  const sum = (xs: Invoice[] | AppData["estimates"]) => xs.reduce((s, x) => s + invoiceTotals(x).total, 0);
  const jobsForEstimate = data.projects.filter((p) => p.status === "lead" && !quoted.has(p.id));
  const isMedia = (e: AppData["estimates"][number]) => (e.type ?? "project") === "media";
  const estimatesForApproval = data.estimates.filter((e) => e.status === "sent" && !isMedia(e));
  const mediaForApproval = data.estimates.filter((e) => e.status === "sent" && isMedia(e));
  const invoiceToRaise = data.estimates.filter((e) => e.status === "approved");
  const invoiceToCollect = data.invoices.filter((i) => i.status === "sent");
  return {
    jobsForEstimate,
    estimatesForApproval,
    invoiceToRaise,
    invoiceToCollect,
    approvalValue: sum(estimatesForApproval),
    mediaForApproval,
    mediaApprovalValue: sum(mediaForApproval),
    toRaiseValue: sum(invoiceToRaise),
    toCollectValue: sum(invoiceToCollect),
  };
}

/** Jobs that still need an estimate (used by the Jobs page filter). */
export const needsEstimate = (data: AppData, projectId: string) =>
  data.projects.some((p) => p.id === projectId && p.status === "lead") &&
  !data.estimates.some((e) => e.projectId === projectId && e.status !== "rejected");
