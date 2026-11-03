import { ESTIMATE_TYPES, type EstimateType } from "../types";

/** Documents saved before types existed count as "Project". */
export const estimateType = (d: { type?: EstimateType }): EstimateType => d.type ?? "project";
export const typeInfo = (id: string) => ESTIMATE_TYPES.find((t) => t.id === id);
