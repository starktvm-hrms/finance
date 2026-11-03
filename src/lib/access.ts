import type { PageId } from "./route";

/** The app's tabs, as the admin grants them to roles. Keep in step with AREAS in server/api.py. */
export const AREAS = [
  { id: "dashboard", label: "Dashboard", page: "dashboard" },
  { id: "jobs", label: "Jobs", page: "projects" },
  { id: "estimates", label: "Estimates", page: "estimates" },
  { id: "invoices", label: "Invoices", page: "invoices" },
  { id: "expenses", label: "Expenses", page: "expenses" },
  { id: "directory", label: "Clients & Vendors", page: "vendors" },
  { id: "people", label: "Employees", page: "people" },
  { id: "settings", label: "Settings", page: "settings" },
] as const;
export type AreaId = (typeof AREAS)[number]["id"];

export interface Access {
  admin: boolean;
  areas: string[];
  roleName: string;
}
export const FULL_ACCESS: Access = { admin: true, areas: AREAS.map((a) => a.id), roleName: "Admin" };

/** Which area a page belongs to (Clients is part of Clients & Vendors). */
export function areaOfPage(page: PageId): AreaId {
  if (page === "clients") return "directory";
  return (AREAS.find((a) => a.page === page)?.id ?? "dashboard") as AreaId;
}
