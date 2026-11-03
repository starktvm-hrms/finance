import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AppData, Client, Estimate, Expense, Invoice, Project, Settings, Vendor } from "../types";
import { getAdapter, readBrowserData } from "./adapter";
import { applyOp, type Collection, type Op } from "./ops";
import { emptyData, sampleData } from "./seed";

type ItemOf<C extends Collection> = C extends "clients"
  ? Client
  : C extends "vendors"
    ? Vendor
    : C extends "projects"
    ? Project
    : C extends "estimates"
      ? Estimate
      : C extends "invoices"
        ? Invoice
        : Expense;

export type SyncState = "loading" | "saved" | "saving" | "error";

interface Store {
  data: AppData;
  ready: boolean;
  error: string;
  sync: SyncState;
  storageName: string;
  shared: boolean;
  upsert<C extends Collection>(col: C, item: ItemOf<C>): void;
  remove(col: Collection, id: string): void;
  updateSettings(patch: Partial<Settings>): void;
  replaceAll(data: AppData): void;
}

const Ctx = createContext<Store | null>(null);
const adapter = getAdapter();
const POLL_MS = 20_000;
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
      queue.current.unshift(...ops); // keep them and retry
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

  // Initial load (+ one-time move of browser data to the server).
  useEffect(() => {
    (async () => {
      try {
        const snap = await adapter.load();
        if (snap?.data) {
          rev.current = snap.rev;
          setData(normalize(snap.data));
        } else {
          // Nothing stored yet. On the server, start from whatever this browser
          // had (so earlier work isn't lost); otherwise an empty book.
          const local = adapter.shared ? readBrowserData() : null;
          const initial = local ? normalize(local) : adapter.shared ? emptyData() : sampleData();
          setData(initial);
          queue.current.push({ op: "replace", data: initial });
          await flush();
        }
        setSync("saved");
      } catch (e) {
        setError((e as Error).message || String(e));
        setSync("error");
      } finally {
        setReady(true);
      }
    })();
  }, [flush]);

  // Pick up changes made by other people / devices.
  useEffect(() => {
    if (!adapter.shared) return;
    const poll = async () => {
      if (inflight.current || queue.current.length) return;
      try {
        const snap = await adapter.load(rev.current);
        if (snap?.data && !queue.current.length && !inflight.current) {
          rev.current = snap.rev;
          setData(normalize(snap.data));
        }
      } catch {
        /* shown on next save */
      }
    };
    pollRef.current = poll;
    const t = window.setInterval(() => !document.hidden && poll(), POLL_MS);
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

  const upsert = useCallback(<C extends Collection>(col: C, item: ItemOf<C>) => push({ op: "upsert", col, item: item as unknown as { id: string } }), [push]);
  const remove = useCallback((col: Collection, id: string) => push({ op: "remove", col, id }), [push]);
  const updateSettings = useCallback((patch: Partial<Settings>) => push({ op: "settings", patch }), [push]);
  const replaceAll = useCallback((next: AppData) => push({ op: "replace", data: next }), [push]);

  return (
    <Ctx.Provider value={{ data, ready, error, sync, storageName: adapter.name, shared: adapter.shared, upsert, remove, updateSettings, replaceAll }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}
