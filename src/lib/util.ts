import { COUNTRIES, type Invoice, type Settings } from "../types";

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

export function invoiceTotals(inv: Pick<Invoice, "items" | "taxRate" | "discount" | "roundOff">) {
  const subtotal = inv.items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.rate) || 0), 0);
  const discount = Number(inv.discount) || 0;
  const discounted = Math.max(0, subtotal - discount); // "estimated revenue" (taxable value)
  const tax = (discounted * (Number(inv.taxRate) || 0)) / 100;
  const exact = discounted + tax;
  const total = inv.roundOff ? Math.round(exact) : exact;
  return { subtotal, discount, net: discounted, tax, roundOff: total - exact, total };
}

/** Currency + number format for a document billed in `country` (falls back to the agency's). */
export function docFormat(country: string | undefined, s: Pick<Settings, "currency" | "locale">) {
  const c = COUNTRIES.find((x) => x.code === country);
  return c ? { currency: c.currency, locale: c.locale } : { currency: s.currency, locale: s.locale };
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

/** Indian financial year (April–March) of a date, as "26-27". */
export function financialYear(date: string) {
  const [y, m] = date.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** GST state code: explicit, else the first two digits of a GSTIN. */
export const gstState = (gstin?: string, explicit?: string) => (explicit?.trim() || gstin?.trim().slice(0, 2) || "").padStart(2, "0");

/**
 * How GST is printed. Same state → split into SGST + CGST; different state →
 * IGST; unknown client state is treated as same-state (local client).
 */
export function gstSplit(agencyState: string, clientGstin: string | undefined, taxRate: number) {
  const client = clientGstin?.trim().slice(0, 2);
  if (!taxRate) return "none" as const;
  return client && agencyState && client !== agencyState ? ("igst" as const) : ("cgst" as const);
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const under100 = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`);
const under1000 = (n: number) =>
  [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : "", under100(n % 100)].filter(Boolean).join(" ");

/** 23600 → "Twenty Three Thousand Six Hundred" (Indian grouping: lakh, crore). */
export function wordsIndian(n: number): string {
  n = Math.floor(n);
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  if (crore) parts.push(`${wordsIndian(crore)} Crore`);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  if (lakh) parts.push(`${under100(lakh)} Lakh`);
  n %= 1e5;
  const thousand = Math.floor(n / 1000);
  if (thousand) parts.push(`${under100(thousand)} Thousand`);
  n %= 1000;
  if (n) parts.push(under1000(n));
  return parts.join(" ");
}

/** 1234567 → "One Million Two Hundred Thirty Four Thousand Five Hundred Sixty Seven". */
export function wordsInternational(n: number): string {
  n = Math.floor(n);
  if (n === 0) return "Zero";
  const scales = ["", "Thousand", "Million", "Billion"];
  const parts: string[] = [];
  for (let i = 0; n > 0; i++, n = Math.floor(n / 1000)) {
    const chunk = n % 1000;
    if (chunk) parts.unshift(`${under1000(chunk)}${scales[i] ? " " + scales[i] : ""}`);
  }
  return parts.join(" ");
}

/** "Twenty Three Thousand Six Hundred INR Only" (with paise / cents when present). */
export function amountInWords(amount: number, currency: string) {
  const whole = Math.floor(Math.abs(amount) + 1e-9);
  const cents = Math.round((Math.abs(amount) - whole) * 100);
  const words = currency === "INR" ? wordsIndian : wordsInternational;
  const sub = cents ? ` and ${under100(cents)} ${currency === "INR" ? "Paise" : "Cents"}` : "";
  return `${amount < 0 ? "Minus " : ""}${words(whole)} ${currency}${sub} Only`;
}
