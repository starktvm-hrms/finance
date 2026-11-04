import type { AppData, Attachment, InvoiceRequest, Project, Settings } from "../types";

/**
 * The job workflow:
 * AE creates the job → department head approves → AE uploads the work order,
 * approval email etc. and forwards it to Finance → Finance raises the estimate →
 * when the work is done the AE requests the invoice → Finance raises it.
 */

export const DEFAULT_REQUIRED_DOCS = ["Work order (WO)", "Client approval email"];

/** Documents an AE must upload before forwarding a job to Finance (set in Settings). */
export const requiredDocs = (s: Settings) => {
  const list = (s.requiredDocs ?? DEFAULT_REQUIRED_DOCS.join("\n")).split("\n").map((x) => x.trim()).filter(Boolean);
  return list;
};

/** Each required document with the files uploaded for it. */
export function docChecklist(data: AppData, job: Project): { name: string; files: Attachment[] }[] {
  const files = data.attachments.filter((a) => a.projectId === job.id);
  return requiredDocs(data.settings).map((name) => ({ name, files: files.filter((f) => f.kind === name) }));
}

/** Invoice requests Finance hasn't acted on yet (no invoice raised for the job since). */
export function openInvoiceRequests(data: AppData, job: Project): InvoiceRequest[] {
  const invoiced = data.invoices.filter((i) => i.projectId === job.id).map((i) => i.createdAt).sort();
  const last = invoiced[invoiced.length - 1] ?? "";
  return (job.invoiceRequests ?? []).filter((r) => !r.doneAt && r.at > last);
}

/** Where the job is in the workflow, for lists and the job page. */
export function jobStage(data: AppData, job: Project): { label: string; tone: string } {
  if (job.status === "cancelled") return { label: "Cancelled", tone: "bad" };
  if (job.status === "completed") return { label: "Completed", tone: "good" };
  const ests = data.estimates.filter((e) => e.projectId === job.id && e.status !== "rejected");
  if (!ests.length) {
    if (!job.approval) return { label: "Not sent for approval", tone: "neutral" };
    if (job.approval.status === "pending") return { label: "Awaiting head's approval", tone: "warn" };
    if (job.approval.status === "rejected") return { label: "Rejected by head", tone: "bad" };
    if (!job.financeForward) return { label: "Approved: forward to Finance", tone: "info" };
    return { label: "With Finance: estimate", tone: "info" };
  }
  if (openInvoiceRequests(data, job).length) return { label: "Invoice requested", tone: "warn" };
  if (ests.some((e) => e.status === "sent" || e.status === "draft")) return { label: "Estimate with client", tone: "info" };
  if (ests.some((e) => e.status === "approved")) return { label: "Work in progress", tone: "info" };
  return { label: "Invoiced", tone: "good" };
}
