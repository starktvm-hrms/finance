import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { DEFAULT_DEPARTMENTS, type AppData, type Branch, type Client, type Department, type Employee, type Estimate, type Expense, type Invoice, type Message, type Payment, type Project, type Settings, type Vendor, type Attachment } from "../types";
import { ForbiddenError, SignedOutError, getAdapter, readBrowserData, type Me } from "./adapter";
import { FULL_ACCESS, type Access } from "./access";
import { applyOp, type Collection, type Op } from "./ops";
import { codesPatch, emptyData, letterheadPatch, sampleData, withDefaultDepartments } from "./seed";

type ItemOf<C extends Collection> = C extends "clients"
  ? Client
  : C extends "vendors"
    ? Vendor
    : C extends "employees"
    ? Employee
    : C extends "departments"
    ? Department
    : C extends "branches"
    ? Branch
    : C extends "projects"
    ? Project
    : C extends "estimates"
      ? Estimate
      : C extends "invoices"
        ? Invoice
        : C extends "payments"
        ? Payment
        : C extends "messages"
        ? Message
        : C extends "attachments"
        ? Attachment
        : Expense;

export type SyncState = "loading" | "saved" | "saving" | "error";
/** "off" = no sign-in (browser storage, or a server still behind its own login). */
export type AuthState = "checking" | "signed-in" | "signed-out" | "off";

interface Store {
  data: AppData;
  ready: boolean;
  error: string;
  sync: SyncState;
  storageName: string;
  shared: boolean;
  auth: AuthState;
  user: string | null;
  /** What this user may open and change (everything unless signed in with a limited role). */
  access: Access;
  can(area: string): boolean;
  /** Name shown for the signed-in person in timelines ("Anu Thomas", else the login, else "Admin"). */
  myName: string;
  /** The server is still behind its own browser pop-up login (no app sign-in). */
  legacy: boolean;
  /** Fetch the latest data from the server now (after uploads etc.). */
  refresh(): void;
  signIn(username: string, password: string, remember: boolean): Promise<void>;
  signOut(): Promise<void>;
  changePassword(current: string, next: string): Promise<void>;
  upsert<C extends Collection>(col: C, item: ItemOf<C>): void;
  remove(col: Collection, id: string): void;
  updateSettings(patch: Partial<Settings>): void;
  replaceAll(data: AppData): void;
}

const Ctx = createContext<Store | null>(null);
const adapter = getAdapter();
const POLL_MS = 20_000;
const OWNED = new Set<Collection>(["projects", "estimates", "invoices", "expenses", "payments", "messages"]);
const FLUSH_MS = 400;

/** Fill in fields added in newer versions so old data keeps working. */
function normalize(d: AppData): AppData {
  const base = emptyData();
  return { ...base, ...d, settings: { ...base.settings, ...d.settings } };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(emptyData);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [sync, setSync] = useState<SyncState>("loading");
  const [auth, setAuth] = useState<AuthState>(adapter.auth ? "checking" : "off");
  const [access, setAccess] = useState<Access>(FULL_ACCESS);
  const accessRef = useRef<Access>(FULL_ACCESS);
  const applyMe = (me: Me) => {
    const a: Access = me.mode === "legacy" || me.admin !== false
      ? { ...FULL_ACCESS, employeeId: me.employeeId ?? "" }
      : { admin: false, areas: me.areas ?? [], roleName: me.roleName ?? me.role ?? "", scope: me.scope ?? "all", employeeId: me.employeeId ?? "" };
    accessRef.current = a;
    setAccess(a);
  };
  const [user, setUser] = useState<string | null>(null);
  const loaded = useRef(false);

  const rev = useRef(0);
  const queue = useRef<Op[]>([]);
  const inflight = useRef(false);
  const flushTimer = useRef<number>();

  const flushRef = useRef<() => Promise<void>>(async () => {});
  const pollRef = useRef<() => Promise<void>>(async () => {});
  const schedule = useCallback((ms: number) => {
    window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => flushRef.current(), ms);
  }, []);

  const flush = useCallback(async () => {
    if (inflight.current || !queue.current.length) return;
    inflight.current = true;
    const ops = queue.current.splice(0);
    setSync("saving");
    try {
      const before = rev.current;
      const next = await adapter.apply(ops);
      // Each save bumps the server revision by one. A bigger jump means someone
      // else saved in between, so our copy is missing their changes: refetch.
      if (adapter.shared && next !== before + 1) {
        rev.current = 0;
        window.setTimeout(() => pollRef.current(), 0);
      } else {
        rev.current = next;
      }
      setError("");
    } catch (e) {
      if (e instanceof ForbiddenError) {
        // Not allowed: drop these changes and reload what the server has.
        inflight.current = false;
        setError(`${e.message} The change was not saved.`);
        setSync(queue.current.length ? "saving" : "saved");
        rev.current = 0;
        window.setTimeout(() => pollRef.current(), 0);
        if (queue.current.length) schedule(FLUSH_MS);
        return;
      }
      queue.current.unshift(...ops); // keep them and retry
      if (e instanceof SignedOutError) {
        inflight.current = false;
        setAuth("signed-out"); // saved again right after signing back in
        return;
      }
      setError((e as Error).message || String(e));
      setSync("error");
      inflight.current = false;
      schedule(5000);
      return;
    }
    inflight.current = false;
    if (queue.current.length) schedule(FLUSH_MS);
    else setSync("saved");
  }, [schedule]);
  flushRef.current = flush;

  const push = useCallback(
    (op: Op) => {
      setData((d) => applyOp(d, op));
      queue.current.push(op);
      setSync("saving");
      schedule(FLUSH_MS);
    },
    [schedule],
  );

  // Who is signed in? (Only when the data is behind a sign-in.)
  useEffect(() => {
    if (!adapter.auth) return;
    adapter.auth
      .me()
      .then((me) => {
        setUser(me.user);
        applyMe(me);
        setAuth(me.mode === "legacy" ? "off" : "signed-in");
      })
      .catch((e) => {
        if (e instanceof SignedOutError) setAuth("signed-out");
        else {
          setError((e as Error).message || String(e));
          setSync("error");
          setReady(true);
        }
      });
  }, []);

  // Load the data once signed in (+ one-time move of browser data to the server).
  const canLoad = auth === "signed-in" || auth === "off";
  useEffect(() => {
    if (!canLoad) return;
    if (loaded.current) {
      // Signed back in after a session expired: send what was waiting.
      if (queue.current.length) schedule(0);
      return;
    }
    (async () => {
      try {
        const snap = await adapter.load();
        loaded.current = true;
        if (snap?.data) {
          rev.current = snap.rev;
          const d = normalize(snap.data);
          setData(d);
          // One-time: data saved before departments existed gets the default list.
          if (!Array.isArray(snap.data.departments) && accessRef.current.admin) {
            const t0 = Date.now();
            for (const [i, name] of DEFAULT_DEPARTMENTS.entries()) {
              const item = { id: crypto.randomUUID?.() ?? `${t0}-${name}`, name, description: "", createdAt: new Date(t0 + i).toISOString() };
              setData((x) => applyOp(x, { op: "upsert", col: "departments", item }));
              queue.current.push({ op: "upsert", col: "departments", item });
            }
            await flush();
          }
          // One-time: codes for clients and branches (job and invoice numbers start with them).
          const codeOps = accessRef.current.admin ? codesPatch(d) : [];
          if (codeOps.length) {
            for (const op of codeOps) {
              setData((x) => applyOp(x, op));
              queue.current.push(op);
            }
            await flush();
          }
          // One-time: put the agency's letterhead into blank Settings fields.
          const patch = accessRef.current.admin ? letterheadPatch(d.settings) : null;
          if (patch) {
            setData((x) => applyOp(x, { op: "settings", patch }));
            queue.current.push({ op: "settings", patch });
            await flush();
          }
        } else {
          // Nothing stored yet. On the server, start from whatever this browser
          // had (so earlier work isn't lost); otherwise an empty book.
          const local = adapter.shared ? readBrowserData() : null;
          const start = local ? normalize(local) : adapter.shared ? emptyData() : sampleData();
          const initial = start.departments.length ? start : withDefaultDepartments(start);
          setData(initial);
          queue.current.push({ op: "replace", data: initial });
          await flush();
        }
        setSync("saved");
      } catch (e) {
        if (e instanceof SignedOutError) return setAuth("signed-out");
        setError((e as Error).message || String(e));
        setSync("error");
      } finally {
        setReady(true);
      }
    })();
  }, [canLoad, flush, schedule]);

  // Pick up changes made by other people / devices.
  useEffect(() => {
    if (!adapter.shared) return;
    const poll = async () => {
      if (inflight.current || queue.current.length) return;
      if (!loaded.current) return;
      try {
        const snap = await adapter.load(rev.current);
        if (snap?.data && !queue.current.length && !inflight.current) {
          rev.current = snap.rev;
          setData(normalize(snap.data));
        }
      } catch (e) {
        if (e instanceof SignedOutError) setAuth("signed-out");
        /* other errors are shown on the next save */
      }
    };
    pollRef.current = poll;
    // Background tabs check less often, but still check, so approval alerts reach people.
    let tick = 0;
    const t = window.setInterval(() => (!document.hidden || ++tick % 3 === 0) && poll(), POLL_MS);
    const onFocus = () => poll();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (queue.current.length || inflight.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  const dataRef = useRef(data);
  dataRef.current = data;
  const userRef = useRef(user);
  userRef.current = user;
  const upsert = useCallback(<C extends Collection>(col: C, item: ItemOf<C>) => {
    let it = item as unknown as Record<string, unknown> & { id: string };
    // Record who created jobs, estimates, invoices and expenses (dashboards count by person and department).
    const who = userRef.current;
    if (who && OWNED.has(col) && !it.createdBy && !(dataRef.current[col] as { id: string }[]).some((x) => x.id === it.id)) {
      const empId = accessRef.current.employeeId;
      it = { ...it, createdBy: who, ...(empId && { createdById: empId }) };
      if (col === "projects" && !it.departmentId) {
        const dept = dataRef.current.employees.find((e) => e.id === empId)?.departmentId;
        if (dept) it = { ...it, departmentId: dept };
      }
    }
    push({ op: "upsert", col, item: it });
  }, [push]);
  const remove = useCallback((col: Collection, id: string) => push({ op: "remove", col, id }), [push]);
  const updateSettings = useCallback((patch: Partial<Settings>) => push({ op: "settings", patch }), [push]);
  const replaceAll = useCallback((next: AppData) => push({ op: "replace", data: next }), [push]);

  const signIn = useCallback(async (username: string, password: string, remember: boolean) => {
    const me = await adapter.auth!.login(username, password, remember);
    setUser(me.user);
    applyMe(await adapter.auth!.me().catch(() => me));
    setError("");
    setAuth(me.mode === "legacy" ? "off" : "signed-in");
  }, []);

  const signOut = useCallback(async () => {
    if (queue.current.length && !window.confirm("Some changes have not been saved yet. Sign out anyway?")) return;
    if (auth === "off" && adapter.auth) {
      // Still behind the server's browser pop-up login: replace the remembered
      // password with a wrong one so the browser asks again, then reload.
      await fetch("api/health", { headers: { Authorization: `Basic ${btoa("signed-out:x")}` }, cache: "no-store" }).catch(() => undefined);
      window.location.replace(`${window.location.pathname}?signed-out=${Date.now()}`);
      return;
    }
    await adapter.auth?.logout().catch(() => undefined);
    // Forget the data in this tab (shared computers).
    queue.current = [];
    loaded.current = false;
    rev.current = 0;
    setData(emptyData());
    setReady(false);
    setUser(null);
    setAuth("signed-out");
  }, [auth]);

  const changePassword = useCallback(async (current: string, next: string) => {
    await adapter.auth!.changePassword(current, next);
  }, []);

  return (
    <Ctx.Provider value={{ legacy: auth === "off" && !!adapter.auth, myName: data.employees.find((e) => e.id === access.employeeId)?.name ?? user ?? "Admin", refresh: () => { rev.current = 0; window.setTimeout(() => pollRef.current(), 0); }, data, ready, error, sync, storageName: adapter.name, shared: adapter.shared, auth, user, access, can: (area: string) => access.admin || access.areas.includes(area), signIn, signOut, changePassword, upsert, remove, updateSettings, replaceAll }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}
