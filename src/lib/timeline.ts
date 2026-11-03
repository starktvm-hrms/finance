import type { AppData, Project } from "../types";
import { money } from "./util";

/** Name for a record's creator: their employee name, else their login. */
export function personName(data: AppData, by?: string, byId?: string) {
  return data.employees.find((e) => e.id === byId)?.name ?? by ?? "";
}

export interface TimelineEvent {
  at: string; // ISO time, or a plain date when only the day is known
  text: string;
  note?: string;
}

/** Everything that happened on a job, newest first. */
export function jobTimeline(data: AppData, job: Project): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  const s = data.settings;
  const who = (by?: string, byId?: string, fallback = "Someone") => personName(data, by, byId) || fallback;

  ev.push({ at: job.createdAt, text: job.createdBy ? `${who(job.createdBy, job.createdById)} created the job` : "Job created" });
  const ap = job.approval;
  if (ap) {
    if (ap.askedAt) ev.push({ at: ap.askedAt, text: `${ap.askedBy || "Someone"} asked ${ap.head} for approval` });
    if (ap.status !== "pending") {
      const by = ap.decidedBy || ap.head;
      ev.push({ at: ap.decidedAt || ap.decidedDate || job.createdAt, text: `${by} ${ap.status === "approved" ? "approved" : "rejected"} the job` });
    }
  }
  for (const f of job.forwards ?? []) {
    const dept = data.departments.find((d) => d.id === f.departmentId)?.name ?? "another";
    ev.push({ at: f.at, text: `${f.by} forwarded this job to the ${dept} department` });
  }
  for (const e of data.estimates.filter((x) => x.projectId === job.id)) {
    ev.push({ at: e.createdAt, text: `${who(e.createdBy, e.createdById)} created estimate with Estimate No.: ${e.number}` });
    if (e.decidedDate && (e.status === "approved" || e.status === "invoiced" || e.status === "rejected")) {
      ev.push({
        at: e.decidedAt || e.decidedDate,
        text: `Client ${e.status === "rejected" ? "rejected" : "approved"} estimate ${e.number}`,
        note: e.decidedBy ? `Recorded by ${e.decidedBy}` : undefined,
      });
    }
  }
  for (const i of data.invoices.filter((x) => x.projectId === job.id)) {
    ev.push({ at: i.createdAt, text: `${who(i.createdBy, i.createdById)} raised invoice ${i.number}` });
    if (i.status === "paid" && i.paidDate) ev.push({ at: i.paidDate, text: `Invoice ${i.number} was paid` });
  }
  for (const p of data.payments.filter((x) => x.projectId === job.id)) {
    ev.push({ at: p.createdAt, text: `${who(p.createdBy, p.createdById)} recorded a payment of ${money(p.amount, s)}`, note: p.note || undefined });
  }
  // Same moment: keep a stable, logical order (later steps first).
  return ev.map((e, i) => ({ e, i })).sort((a, b) => b.e.at.localeCompare(a.e.at) || b.i - a.i).map((x) => x.e);
}

/** 03-11-2026 and 10:29 AM (time only when it's known). */
export function stamp(at: string) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(at);
  const d = dateOnly ? new Date(`${at}T00:00:00`) : new Date(at);
  if (Number.isNaN(d.getTime())) return { date: at, time: "" };
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
  if (dateOnly) return { date, time: "" };
  const h = d.getHours() % 12 || 12;
  return { date, time: `${p(h)}:${p(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}` };
}
