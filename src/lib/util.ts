import type { Invoice, Settings } from "../types";

export const uid = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));

export const today = () => new Date().toISOString().slice(0, 10);

export function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function money(n: number, s: Pick<Settings, "currency" | "locale">) {
  try {
    return new Intl.NumberFormat(s.locale, {
      style: "currency",
      currency: s.currency,
      minimumFractionDigits: Number.isInteger(n || 0) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(n || 0);
  } catch {
    return `${s.currency} ${(n || 0).toFixed(2)}`;
  }
}

export function shortMoney(n: number, s: Pick<Settings, "currency" | "locale">) {
  try {
    return new Intl.NumberFormat(s.locale, {
      style: "currency",
      currency: s.currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n || 0);
  } catch {
    return String(Math.round(n));
  }
}

export function fmtDate(d: string, locale: string) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function invoiceTotals(inv: Pick<Invoice, "items" | "taxRate" | "discount">) {
  const subtotal = inv.items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.rate) || 0), 0);
  const discounted = Math.max(0, subtotal - (Number(inv.discount) || 0));
  const tax = (discounted * (Number(inv.taxRate) || 0)) / 100;
  return { subtotal, discount: Number(inv.discount) || 0, tax, total: discounted + tax };
}

export type DisplayStatus = Invoice["status"] | "overdue";

export function invoiceDisplayStatus(inv: Invoice): DisplayStatus {
  if (inv.status === "sent" && inv.dueDate && inv.dueDate < today()) return "overdue";
  return inv.status;
}

export const monthKey = (d: string) => d.slice(0, 7);

export function lastNMonths(n: number) {
  const out: string[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function monthLabel(key: string, locale: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: "short", year: "2-digit" });
}

export function downloadFile(name: string, content: string, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCSV(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
