import type { AppData, Project } from "../types";
import type { Access } from "./access";

type Owned = { createdBy?: string; createdById?: string; departmentId?: string; projectId?: string };

/** Department of a job: set on the job, else its creator's department. Mirrors dept_of() in server/api.py. */
export function departmentOf(data: AppData, x: Owned): string {
  if (x.departmentId) return x.departmentId;
  if (x.projectId) {
    const p = data.projects.find((j) => j.id === x.projectId);
    if (p) return departmentOf(data, { ...p, projectId: undefined });
  }
  return data.employees.find((e) => e.id === x.createdById)?.departmentId ?? "";
}

/** Whether `x` was created by this login (or the employee linked to it). */
export const isMine = (x: Owned, user: string | null, employeeId: string) =>
  (!!user && x.createdBy === user) || (!!employeeId && x.createdById === employeeId);

export interface ScopeInfo {
  scope: Access["scope"];
  departmentId: string; // for "department"
  departmentName: string;
  label: string; // what the numbers cover, for headings
  problem: string; // why the numbers are empty, if they are
}

export function scopeInfo(data: AppData, access: Access, user: string | null): ScopeInfo {
  const emp = data.employees.find((e) => e.id === access.employeeId);
  const departmentId = emp?.departmentId ?? "";
  const departmentName = data.departments.find((d) => d.id === departmentId)?.name ?? "";
  if (access.scope === "department") {
    return {
      scope: "department", departmentId, departmentName,
      label: departmentName ? `${departmentName} department` : "Your department",
      problem: !emp ? "Your login isn't linked to an employee yet, so there is no department to show. Ask an admin to link it (Employees › Logins & access)."
        : !departmentId ? `${emp.name} has no department set. Ask an admin to set it on the Employees page.` : "",
    };
  }
  if (access.scope === "own") {
    return { scope: "own", departmentId, departmentName, label: emp ? `${emp.name}'s work` : `Your work`, problem: user ? "" : "Sign in to see your own work." };
  }
  return { scope: "all", departmentId, departmentName, label: "Whole agency", problem: "" };
}

/** The data narrowed to what this user's dashboard counts. */
export function scopedData(data: AppData, info: ScopeInfo, user: string | null, employeeId: string): AppData {
  if (info.scope === "all") return data;
  let keepJob: (p: Project) => boolean;
  let keepDoc: (x: Owned) => boolean;
  if (info.scope === "department") {
    const d = info.departmentId;
    keepJob = (p) => !!d && departmentOf(data, p) === d;
    keepDoc = (x) => !!d && departmentOf(data, x) === d;
  } else {
    keepJob = (p) => isMine(p, user, employeeId);
    const jobs = new Set(data.projects.filter(keepJob).map((p) => p.id));
    keepDoc = (x) => isMine(x, user, employeeId) || (!!x.projectId && jobs.has(x.projectId));
  }
  return {
    ...data,
    projects: data.projects.filter(keepJob),
    estimates: data.estimates.filter(keepDoc),
    invoices: data.invoices.filter(keepDoc),
    expenses: data.expenses.filter(keepDoc),
  };
}

/** Jobs per person who created them (most first). */
export function jobsByPerson(all: AppData, jobs: Project[]) {
  const rows = new Map<string, { key: string; name: string; dept: string; jobs: number; open: number }>();
  for (const p of jobs) {
    const emp = all.employees.find((e) => e.id === p.createdById);
    const key = emp?.id ?? p.createdBy ?? "";
    const r = rows.get(key) ?? {
      key,
      name: emp?.name ?? p.createdBy ?? "Not recorded",
      dept: all.departments.find((d) => d.id === emp?.departmentId)?.name ?? "",
      jobs: 0,
      open: 0,
    };
    r.jobs += 1;
    if (p.status === "lead" || p.status === "active" || p.status === "on_hold") r.open += 1;
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => b.jobs - a.jobs || a.name.localeCompare(b.name));
}

/**
 * Optional list filter from the URL, used when a dashboard tile opens a page:
 * `by=me` (this user's work) or `dept=<id>` (one department).
 */
export function listFilter(data: AppData, params: URLSearchParams, user: string | null, employeeId: string) {
  const dept = params.get("dept");
  if (dept) {
    const name = data.departments.find((d) => d.id === dept)?.name ?? "one department";
    const keep = (x: Owned) => departmentOf(data, x) === dept;
    return { label: `${name} department`, keepJob: keep, keepDoc: keep };
  }
  if (params.get("by") === "me") {
    const jobs = new Set(data.projects.filter((p) => isMine(p, user, employeeId)).map((p) => p.id));
    return {
      label: "your work",
      keepJob: (p: Owned) => isMine(p, user, employeeId),
      keepDoc: (x: Owned) => isMine(x, user, employeeId) || (!!x.projectId && jobs.has(x.projectId)),
    };
  }
  return null;
}

/** URL params that carry the dashboard's scope onto a list page. */
export const scopeParams = (info: ScopeInfo): Record<string, string> =>
  info.scope === "own" ? { by: "me" } : info.scope === "department" && info.departmentId ? { dept: info.departmentId } : {};
