import { useEffect, useState } from "react";

export const PAGE_IDS = ["dashboard", "estimates", "invoices", "expenses", "projects", "clients", "settings"] as const;
export type PageId = (typeof PAGE_IDS)[number];

export interface Route {
  page: PageId;
  params: URLSearchParams;
}

/** Routes look like `#/invoices?status=unpaid`. */
export function parseHash(hash = window.location.hash): Route {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const page = (PAGE_IDS as readonly string[]).includes(path) ? (path as PageId) : "dashboard";
  return { page, params: new URLSearchParams(query) };
}

export function go(page: PageId, params?: Record<string, string>) {
  const q = params ? new URLSearchParams(params).toString() : "";
  window.location.hash = `#/${page}${q ? `?${q}` : ""}`;
}

/** Drop one-shot params (e.g. `new`, `open`) without adding a history entry. */
export function clearParam(name: string) {
  const { page, params } = parseHash();
  if (!params.has(name)) return;
  params.delete(name);
  const q = params.toString();
  history.replaceState(null, "", `#/${page}${q ? `?${q}` : ""}`);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
