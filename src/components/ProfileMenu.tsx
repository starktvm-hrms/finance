import { useEffect, useRef, useState, type FormEvent } from "react";
import { useStore } from "../lib/store";
import { Field, Modal } from "./ui";

const initials = (name: string) =>
  name
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** Top-right profile button: who is signed in, change password, sign out. */
export default function ProfileMenu() {
  const { user, myName, access, data, signOut, changePassword, legacy } = useStore();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

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

  const emp = data.employees.find((e) => e.id === access.employeeId);
  const dept = data.departments.find((d) => d.id === emp?.departmentId)?.name;

  return (
    <div className="profile" ref={box}>
      <button className="profile-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={`Signed in as ${user ?? myName}`}>
        <span className="avatar" aria-hidden>{initials(myName)}</span>
        <span className="profile-name">
          <strong>{myName}</strong>
          <span className="muted small">{access.roleName}</span>
        </span>
        <span className="caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="profile-pop" role="menu">
          <div className="profile-head">
            <span className="avatar big" aria-hidden>{initials(myName)}</span>
            <div>
              <strong>{myName}</strong>
              <div className="muted small">{legacy ? "Signed in with the browser pop-up login" : user}</div>
              <div className="muted small">{[access.roleName, dept].filter(Boolean).join(" · ")}</div>
            </div>
          </div>
          {!legacy && <button role="menuitem" className="profile-item" onClick={() => { setOpen(false); setPwOpen(true); }}>Change password</button>}
          <button role="menuitem" className="profile-item danger" onClick={() => { setOpen(false); signOut(); }}>Sign out</button>
        </div>
      )}
      {pwOpen && <PasswordDialog onClose={() => setPwOpen(false)} change={changePassword} />}
    </div>
  );
}

function PasswordDialog({ onClose, change }: { onClose: () => void; change: (current: string, next: string) => Promise<void> }) {
  const [pw, setPw] = useState({ current: "", next: "", repeat: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.next !== pw.repeat) return setMsg({ ok: false, text: "The new passwords do not match." });
    try {
      await change(pw.current, pw.next);
      setPw({ current: "", next: "", repeat: "" });
      setMsg({ ok: true, text: "Password changed. Your other devices have been signed out." });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };
  return (
    <Modal title="Change password" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {msg && <div className={`span2 ${msg.ok ? "notice" : "alert inline-alert"}`} role="status">{msg.text}</div>}
        <Field label="Current password" span={2}><input type="password" autoComplete="current-password" required autoFocus value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
        <Field label="New password (min 10 characters)" span={2}><input type="password" autoComplete="new-password" required minLength={10} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
        <Field label="Repeat new password" span={2}><input type="password" autoComplete="new-password" required minLength={10} value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} /></Field>
        <div className="form-actions span2">
          <button type="button" className="btn" onClick={onClose}>{msg?.ok ? "Close" : "Cancel"}</button>
          <button className="btn primary">Change password</button>
        </div>
      </form>
    </Modal>
  );
}
