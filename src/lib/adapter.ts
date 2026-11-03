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
  auth?: AuthApi; // present when the data lives behind a sign-in
}

/** Thrown when the server says the session is missing or expired. */
export class SignedOutError extends Error {
  constructor(message = "Please sign in.") {
    super(message);
    this.name = "SignedOutError";
  }
}

/** Thrown when the server refuses a change this user has no access to. */
export class ForbiddenError extends Error {
  constructor(message = "You don't have access to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export interface Me {
  user: string | null; // null in "legacy" mode (server's own login in front)
  mode: "on" | "legacy" | "locked";
  admin?: boolean;
  role?: string;
  roleName?: string;
  areas?: string[];
  employeeId?: string;
}

export interface Role {
  id: string;
  name: string;
  areas: string[];
}
export interface Login {
  username: string;
  role: string;
  employeeId: string;
}

export interface AuthApi {
  me(): Promise<Me>; // throws SignedOutError when signed out
  login(username: string, password: string, remember: boolean): Promise<Me>;
  logout(): Promise<void>;
  changePassword(current: string, next: string): Promise<void>;
  branding(): Promise<{ agencyName: string; logo: string }>;
  // Admin only
  access(): Promise<{ users: Login[]; roles: Role[] }>;
  saveRoles(roles: Role[]): Promise<void>;
  saveLogin(login: Login & { password?: string; create?: boolean }): Promise<void>;
  deleteLogin(username: string): Promise<void>;
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
    if (res.status === 401) {
      let msg = "Please sign in.";
      try {
        msg = (await res.json()).error ?? msg;
      } catch {
        /* not JSON */
      }
      throw new SignedOutError(msg);
    }
    if (res.status === 403) {
      throw new ForbiddenError((await res.json().catch(() => ({}))).error ?? undefined);
    }
    if (res.status === 429 || res.status === 400) {
      throw new Error((await res.json().catch(() => ({}))).error ?? `Error ${res.status}`);
    }
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
    auth: {
      async me() {
        return (await check(await fetch(`${url}/me`, { cache: "no-store", credentials: "same-origin" }))) as Me;
      },
      async login(username, password, remember) {
        const r = await fetch(`${url}/login`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, remember }) });
        if (r.status === 401) throw new Error((await r.json().catch(() => ({}))).error ?? "Wrong username or password.");
        const body = await check(r);
        return { user: body.user, mode: body.mode ?? "on" } as Me;
      },
      async logout() {
        await fetch(`${url}/logout`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
      },
      async changePassword(current, next) {
        await check(await fetch(`${url}/password`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current, new: next }) }));
      },
      async branding() {
        return check(await fetch(`${url}/branding`, { cache: "no-store", credentials: "same-origin" }));
      },
      async access() {
        return check(await fetch(`${url}/admin/access`, { cache: "no-store", credentials: "same-origin" }));
      },
      async saveRoles(roles) {
        await check(await fetch(`${url}/admin/roles`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roles }) }));
      },
      async saveLogin(login) {
        await check(await fetch(`${url}/admin/users`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(login) }));
      },
      async deleteLogin(username) {
        await check(await fetch(`${url}/admin/users/delete`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) }));
      },
    },
  };
}

export function getAdapter(): DataAdapter {
  const api = import.meta.env.VITE_API_URL as string | undefined;
  return api ? serverAdapter(api) : localAdapter;
}
