import type { AppData, Branch } from "../types";
import { financialYear } from "./util";

/** Branch code shown in invoice numbers: the one set on the branch, else letters from its name. */
export const branchCode = (b: Pick<Branch, "name" | "code"> | undefined) =>
  (b?.code?.trim() || (b?.name ?? "").replace(/[^A-Za-z]/g, "").slice(0, 4)).toLowerCase() || "inv";

/** The branch an invoice is raised from: the person's own branch, else the first branch with a code. */
export function defaultBranch(data: AppData, employeeId: string): Branch | undefined {
  const own = data.branches.find((b) => b.id === data.employees.find((e) => e.id === employeeId)?.branchId);
  return own ?? data.branches.find((b) => b.code) ?? data.branches[0];
}

/** Invoice number: branch code / financial year / serial, e.g. tvpm/26-27/284 (serial is automatic). */
export function makeInvoiceNumber(data: AppData, date: string, branchId: string | undefined, serial = data.settings.nextInvoiceNumber) {
  const b = data.branches.find((x) => x.id === branchId) ?? data.branches.find((x) => x.code) ?? data.branches[0];
  return `${branchCode(b)}/${financialYear(date || new Date().toISOString().slice(0, 10))}/${serial}`;
}
