import { useEffect, useRef } from "react";
import { VENDOR_CATEGORIES } from "../types";
import { useStore } from "../lib/store";
import { go } from "../lib/route";
import Clients from "./Clients";
import Vendors from "./Vendors";

const TABS = [{ id: "clients", label: "Clients" }, ...VENDOR_CATEGORIES.map((c) => ({ id: c.id as string, label: c.label }))];

/** "Clients & Vendors": one page, one tab per list. Route: #/vendors?category=<tab>. */
export default function Directory({ tab }: { tab: string }) {
  const { data } = useStore();
  const current = TABS.some((t) => t.id === tab) ? tab : "clients";
  const tabsRef = useRef<HTMLDivElement>(null);
  // Keep the selected tab visible when the tab row scrolls (phones).
  useEffect(() => {
    const row = tabsRef.current;
    const el = row?.querySelector<HTMLElement>(".tab.active");
    if (row && el) row.scrollLeft = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
  }, [current]);
  const count = (id: string) => (id === "clients" ? data.clients.length : data.vendors.filter((v) => v.category === id).length);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Clients &amp; Vendors</h1>
          <p className="muted">Your clients and the media owners and suppliers you buy from.</p>
        </div>
      </div>
      <div ref={tabsRef} className="tabs directory-tabs" role="tablist" aria-label="Lists">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={current === t.id}
            className={`tab ${current === t.id ? "active" : ""}`}
            onClick={() => go("vendors", { category: t.id })}
          >
            {t.label}
            <span className="tab-count">{count(t.id)}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel">{current === "clients" ? <Clients /> : <Vendors key={current} category={current} />}</div>
    </div>
  );
}
