import type { AppData, Settings } from "../types";

export type Collection = "clients" | "vendors" | "employees" | "departments" | "branches" | "projects" | "estimates" | "invoices" | "expenses";

/**
 * A single change to the dataset. The UI applies ops locally (instant feedback)
 * and sends the same ops to the server, which applies them to its copy. Sending
 * changes instead of the whole dataset means two people editing at the same
 * time don't overwrite each other's work.
 *
 * Keep in sync with apply_op() in server/api.py.
 */
export type Op =
  | { op: "upsert"; col: Collection; item: { id: string } & Record<string, unknown> }
  | { op: "remove"; col: Collection; id: string }
  | { op: "settings"; patch: Partial<Settings> }
  | { op: "replace"; data: AppData };

export function applyOp(d: AppData, o: Op): AppData {
  switch (o.op) {
    case "upsert": {
      const list = (d[o.col] ?? []) as unknown as { id: string }[];
      const exists = list.some((x) => x.id === o.item.id);
      const next = exists ? list.map((x) => (x.id === o.item.id ? o.item : x)) : [o.item, ...list];
      return { ...d, [o.col]: next };
    }
    case "remove":
      return { ...d, [o.col]: ((d[o.col] ?? []) as { id: string }[]).filter((x) => x.id !== o.id) };
    case "settings":
      return { ...d, settings: { ...d.settings, ...o.patch } };
    case "replace":
      return o.data;
  }
}
