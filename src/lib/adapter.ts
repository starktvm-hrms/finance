import type { AppData } from "../types";

/**
 * Storage adapter. The app reads/writes its whole dataset through this
 * interface, so swapping localStorage for a backend (Supabase, your website's
 * REST API, etc.) means implementing these two methods — no UI changes.
 */
export interface DataAdapter {
  name: string;
  load(): Promise<AppData | null>;
  save(data: AppData): Promise<void>;
}

const KEY = "agency-finance:data:v1";

export const localAdapter: DataAdapter = {
  name: "Browser storage",
  async load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as AppData) : null;
    } catch {
      return null;
    }
  },
  async save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.error("Failed to save data", e);
    }
  },
};

/**
 * Generic REST adapter: GET returns the AppData JSON, PUT stores it.
 * Enable by setting VITE_API_URL (e.g. https://youragency.com/api/finance).
 */
export function restAdapter(baseUrl: string, token?: string): DataAdapter {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return {
    name: "Remote API",
    async load() {
      const res = await fetch(baseUrl, { headers });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Load failed: ${res.status}`);
      return (await res.json()) as AppData;
    },
    async save(data) {
      const res = await fetch(baseUrl, { method: "PUT", headers, body: JSON.stringify(data) });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
    },
  };
}

export function getAdapter(): DataAdapter {
  const api = import.meta.env.VITE_API_URL as string | undefined;
  if (api) return restAdapter(api, import.meta.env.VITE_API_TOKEN as string | undefined);
  return localAdapter;
}
