import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { notifications, type Notice } from "../lib/notifications";
import { go } from "../lib/route";
import { stamp } from "../lib/timeline";

const canAlert = typeof window !== "undefined" && "Notification" in window;

// What this person has already looked at (a per-browser convenience; approvals stay until decided).
function readSeen(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]") as string[]);
  } catch {
    return new Set();
  }
}
function writeSeen(key: string, ids: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...ids].slice(-300)));
  } catch {
    /* storage unavailable */
  }
}

/** Bell in the top bar: jobs waiting for my approval, and decisions on jobs I sent. */
export default function NotificationBell() {
  const { data, access, user, myName, ready } = useStore();
  const list = useMemo(() => notifications(data, access, user, myName), [data, access, user, myName]);
  const key = `agency-finance:seen:${user ?? ""}`;
  const [seen, setSeen] = useState(() => readSeen(key));
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Notice | null>(null);
  const [perm, setPerm] = useState(canAlert ? Notification.permission : "denied");
  const box = useRef<HTMLDivElement>(null);
  const known = useRef<Set<string> | null>(null);

  const unread = list.filter((n) => n.needsAction || !seen.has(n.id));

  // Something new arrived (from another person's change): show it, and pop a desktop alert if allowed.
  useEffect(() => {
    if (!ready) return;
    if (known.current === null) {
      known.current = new Set(list.map((n) => n.id)); // what was there when the app opened
      return;
    }
    const fresh = list.filter((n) => !known.current!.has(n.id));
    fresh.forEach((n) => known.current!.add(n.id));
    const first = fresh[0];
    if (!first) return;
    setToast(first);
    if (canAlert && Notification.permission === "granted") {
      for (const n of fresh) {
        try {
          const a = new Notification(n.title, { body: n.body, tag: n.id, icon: "brand-mark.png" });
          a.onclick = () => {
            window.focus();
            go("job", { id: n.jobId });
            a.close();
          };
        } catch {
          /* some browsers only allow alerts from a service worker */
        }
      }
    }
  }, [list, ready]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const markAllRead = () => {
    const next = new Set([...seen, ...list.map((n) => n.id)]);
    setSeen(next);
    writeSeen(key, next);
  };
  const openNotice = (n: Notice) => {
    const next = new Set([...seen, n.id]);
    setSeen(next);
    writeSeen(key, next);
    setOpen(false);
    setToast(null);
    go("job", { id: n.jobId });
  };
  const askPermission = async () => {
    if (!canAlert) return;
    setPerm(await Notification.requestPermission());
  };

  return (
    <div className="bell" ref={box}>
      <button className="icon-btn bell-btn" aria-label={`Notifications${unread.length ? ` (${unread.length} new)` : ""}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread.length > 0 && <span className="bell-count">{unread.length > 9 ? "9+" : unread.length}</span>}
      </button>
      {open && (
        <div className="bell-pop" role="menu">
          <div className="bell-head">
            <strong>Notifications</strong>
            {list.some((n) => !n.needsAction && !seen.has(n.id)) && <button className="btn ghost" onClick={markAllRead}>Mark all read</button>}
          </div>
          {list.length === 0 ? (
            <p className="muted small bell-empty">Nothing yet. You'll be told here when a job is sent to you for approval, and when your jobs are approved or rejected.</p>
          ) : (
            <ul className="bell-list">
              {list.map((n) => {
                const st = stamp(n.at);
                return (
                  <li key={n.id}>
                    <button role="menuitem" className={`bell-item ${n.needsAction ? "action" : ""} ${!n.needsAction && !seen.has(n.id) ? "unread" : ""}`} onClick={() => openNotice(n)}>
                      <span className="bell-title">{n.title}</span>
                      <span className="bell-body">{n.body}</span>
                      <span className="bell-time">{st.date} {st.time}{n.needsAction && <b> · Needs your approval</b>}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {canAlert && perm === "default" && (
            <button className="btn bell-alerts" onClick={askPermission}>Turn on desktop alerts</button>
          )}
          {canAlert && perm === "denied" && <p className="muted small bell-empty">Desktop alerts are blocked for this site in your browser settings.</p>}
        </div>
      )}
      {toast && !open && (
        <button className="bell-toast" onClick={() => openNotice(toast)} role="status">
          <strong>{toast.title}</strong>
          <span>{toast.body}</span>
        </button>
      )}
    </div>
  );
}
