import type { Client, Settings } from "../types";

const STOP = new Set(["of", "the", "and", "&", "for", "pvt", "pvt.", "private", "ltd", "ltd.", "limited", "llp", "inc", "inc.", "co", "co.", "company", "corp", "corporation"]);

/**
 * Short client code for job numbers: a leading acronym is used as is
 * ("HLL Lifecare Ltd" → HLL), otherwise the initials of the main words
 * ("Department of Tourism" → DT). An explicit client code always wins.
 */
export function clientCode(client: Pick<Client, "name" | "code"> | undefined): string {
  if (client?.code?.trim()) return client.code.trim().toUpperCase();
  const words = (client?.name ?? "").split(/[\s,/()-]+/).filter(Boolean);
  if (!words.length) return "JOB";
  const first = words[0].replace(/[^A-Za-z0-9]/g, "");
  if (first.length >= 2 && first.length <= 5 && first === first.toUpperCase() && /[A-Z]/.test(first)) return first;
  const initials = words.filter((w) => !STOP.has(w.toLowerCase())).map((w) => w.replace(/[^A-Za-z0-9]/g, "")[0] ?? "").join("");
  return (initials || first.slice(0, 3)).toUpperCase().slice(0, 4);
}

/**
 * Job number in the agency's pattern: client code + YY + MM + running 4-digit
 * number, e.g. HLL + 26 + 10 + 0417 → HLL26100417. With the "prefix" style it
 * is the older JOB-0001 form.
 */
export function makeJobNumber(s: Pick<Settings, "jobNumberStyle" | "jobPrefix">, client: Pick<Client, "name" | "code"> | undefined, date: string, seq: number) {
  if (s.jobNumberStyle === "prefix") return `${s.jobPrefix}${String(seq).padStart(4, "0")}`;
  const [y, m] = (date || new Date().toISOString().slice(0, 10)).split("-");
  return `${clientCode(client)}${y.slice(2)}${m}${String(seq % 10000).padStart(4, "0")}`;
}
