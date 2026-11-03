import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AppData, Client, Expense, Invoice, Project, Settings } from "../types";
import { getAdapter } from "./adapter";
import { emptyData, sampleData } from "./seed";

type Collection = "clients" | "projects" | "invoices" | "expenses";
type ItemOf<C extends Collection> = C extends "clients" ? Client : C extends "projects" ? Project : C extends "invoices" ? Invoice : Expense;

interface Store {
  data: AppData;
  ready: boolean;
  error: string;
  storageName: string;
  upsert<C extends Collection>(col: C, item: ItemOf<C>): void;
  remove(col: Collection, id: string): void;
  updateSettings(patch: Partial<Settings>): void;
  replaceAll(data: AppData): void;
}

const Ctx = createContext<Store | null>(null);
const adapter = getAdapter();

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(emptyData);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const loaded = useRef(false);

  useEffect(() => {
    adapter
      .load()
      .then((d) => {
        const base = emptyData();
        setData(d ? { ...base, ...d, settings: { ...base.settings, ...d.settings } } : sampleData());
      })
      .catch((e) => setError(String(e)))
      .finally(() => {
        loaded.current = true;
        setReady(true);
      });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => {
      adapter.save(data).then(() => setError("")).catch((e) => setError(String(e)));
    }, 300);
    return () => clearTimeout(t);
  }, [data]);

  const upsert = useCallback(<C extends Collection>(col: C, item: ItemOf<C>) => {
    setData((d) => {
      const list = d[col] as ItemOf<C>[];
      const exists = list.some((x) => x.id === item.id);
      return { ...d, [col]: exists ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list] };
    });
  }, []);

  const remove = useCallback((col: Collection, id: string) => {
    setData((d) => ({ ...d, [col]: (d[col] as { id: string }[]).filter((x) => x.id !== id) }));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setData((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  }, []);

  const replaceAll = useCallback((next: AppData) => setData(next), []);

  return (
    <Ctx.Provider value={{ data, ready, error, storageName: adapter.name, upsert, remove, updateSettings, replaceAll }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}
