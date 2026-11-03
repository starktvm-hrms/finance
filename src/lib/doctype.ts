import { ESTIMATE_TYPES, type AppData, type EstimateType, type Project } from "../types";

/** Documents saved before types existed count as "Project". */
export const estimateType = (d: { type?: EstimateType }): EstimateType => d.type ?? "project";
export const typeInfo = (id: string) => ESTIMATE_TYPES.find((t) => t.id === id);

/** A job's category: set on the job, else its latest estimate's type, else "Project". */
export function jobCategory(job: Project, estimates: AppData["estimates"]): EstimateType {
  if (job.category) return job.category;
  const latest = estimates.filter((e) => e.projectId === job.id).sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0];
  return latest ? estimateType(latest) : "project";
}
