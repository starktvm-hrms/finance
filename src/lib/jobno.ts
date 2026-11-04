import type { Client, Settings } from "../types";

const STOP = new Set(["of", "the", "and", "&", "for", "pvt", "pvt.", "private", "ltd", "ltd.", "limited", "llp", "inc", "inc.", "co", "co.", "company", "corp", "corporation"]);

/** A client code is 2 to 4 letters, set by an admin on the client (e.g. HLL, DT, KSEB). */
export const CODE_RE = /^[A-Z]{2,4}$/;

/** Suggested code from the name: a leading acronym ("HLL Lifecare" → HLL), else initials ("Department of Tourism" → DT). */
export function suggestCode(name: string): string {
  const words = name.split(/[\s,/()-]+/).filter(Boolean);
  const letters = (w: string) => w.replace(/[^A-Za-z]/g, "");
  const first = letters(words[0] ?? "");
  if (first.length >= 2 && first.length <= 4 && first === first.toUpperCase()) return first;
  let code = words.filter((w) => !STOP.has(w.toLowerCase())).map((w) => letters(w)[0] ?? "").join("").toUpperCase().slice(0, 4);
  if (code.length < 2) code = first.toUpperCase().slice(0, 3);
  return code.length >= 2 ? code : "JOB";
}

/** The client's code: the one the admin set, else one suggested from the name. */
export function clientCode(client: Pick<Client, "name" | "code"> | undefined): string {
  const set = client?.code?.trim().toUpperCase();
  if (set) return set;
  return suggestCode(client?.name ?? "");
}

export type JobNumberStyle = NonNullable<Settings["jobNumberStyle"]>;
/** Layouts an admin can pick in Settings (the first is the default). */
export const JOB_NUMBER_STYLES: { id: JobNumberStyle; label: string }[] = [
  { id: "code-serial-date", label: "Code + serial no. + date, month, year" },
  { id: "code-date-serial", label: "Code + date, month, year + serial no." },
  { id: "client", label: "Code + year, month + serial no." },
  { id: "prefix", label: "Prefix + serial no. (JOB-0001)" },
];

/**
 * Job number, generated automatically. With the default layout:
 * client code + 4-digit serial + DD MM YY of the job's date,
 * e.g. HLL + 0417 + 04 11 26 → HLL0417041126.
 */
export function makeJobNumber(s: Pick<Settings, "jobNumberStyle" | "jobPrefix">, client: Pick<Client, "name" | "code"> | undefined, date: string, seq: number) {
  const serial = String(seq % 10000).padStart(4, "0");
  const style = s.jobNumberStyle ?? "code-serial-date";
  if (style === "prefix") return `${s.jobPrefix}${serial}`;
  const [y, m, d] = (date || new Date().toISOString().slice(0, 10)).split("-");
  const code = clientCode(client);
  if (style === "client") return `${code}${y.slice(2)}${m}${serial}`;
  if (style === "code-date-serial") return `${code}${d}${m}${y.slice(2)}${serial}`;
  return `${code}${serial}${d}${m}${y.slice(2)}`;
}
