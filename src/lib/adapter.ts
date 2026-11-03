import type { AppData } from "../types";
import { applyOp, type Op } from "./ops";

export interface Snapshot {
  data: AppData | null; // null = nothing stored yet
  rev: number;
}

/**
 * Where the data lives. The app loads a snapshot, then sends batches of ops.
 * `load(rev)` may return null when nothing changed since `rev`.
 */
export interface DataAdapter {
  name: string;
  shared: boolean; // true when other people/devices see the same data
  load(sinceRev?: number): Promise<Snapshot | null>;
  apply(ops: Op[]): Promise<number>; // returns the new revision
}

const KEY = "agency-finance:data:v1";

export function readBrowserData(): AppData | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AppData) : null;
  } catch {
    return null;
  }
}

export const localAdapter: DataAdapter = {
  name: "This browser",
  shared: false,
  async load() {
    return { data: readBrowserData(), rev: 0 };
  },
  async apply(ops) {
    let d = readBrowserData();
    for (const o of ops) {
      if (o.op === "replace") d = o.data;
      else if (d) d = applyOp(d, o);
    }
    if (d) localStorage.setItem(KEY, JSON.stringify(d));
    return 0;
  },
};

/**
 * Server storage (server/api.py). Same origin as the app, so the site's login
 * (HTTP basic auth) protects it and the browser sends credentials automatically.
 */
export function serverAdapter(base: string): DataAdapter {
  const url = base.replace(/\/$/, "");
  const check = async (res: Response) => {
    if (res.status === 401) throw new Error("Not signed in. Reload the page and log in again.");
    if (!res.ok) {
      let msg = `${res.status}`;
      try {
        msg = (await res.json()).error ?? msg;
      } catch {
        /* not JSON */
      }
      throw new Error(`Server error: ${msg}`);
    }
    return res.json();
  };
  return {
    name: "Server",
    shared: true,
    async load(sinceRev) {
      const q = sinceRev ? `?since=${sinceRev}` : "";
      const body = await check(await fetch(`${url}/data${q}`, { cache: "no-store", credentials: "same-origin" }));
      return body.unchanged ? null : (body as Snapshot);
    },
    async apply(ops) {
      const body = await check(
        await fetch(`${url}/ops`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ops }),
        }),
      );
      return body.rev as number;
    },
  };
}

export function getAdapter(): DataAdapter {
  const api = import.meta.env.VITE_API_URL as string | undefined;
  return api ? serverAdapter(api) : localAdapter;
}
