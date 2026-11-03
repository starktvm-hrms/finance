import { useCallback, useEffect, useState } from "react";
import { getAdapter, type Login, type Role } from "../lib/adapter";
import { useStore } from "../lib/store";
import { AREAS } from "../lib/access";
import { Badge, Empty, Field, Modal, PageHeader } from "../components/ui";

const api = getAdapter().auth;

/** A readable random password: 4 groups of letters/digits, e.g. "k7mq-2xfa-9pde-r4tn". */
function randomPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("").replace(/(.{4})(?=.)/g, "$1-");
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "role";

/** Admin-only: who can sign in, and which tabs each role can open. */
export default function Access() {
  const { data, user, auth } = useStore();
  const [logins, setLogins] = useState<Login[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [savedRoles, setSavedRoles] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [edit, setEdit] = useState<(Login & { password: string; create: boolean }) | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!api) return;
    try {
      const a = await api.access();
      setLogins(a.users);
      setRoles(a.roles);
      setSavedRoles(JSON.stringify(a.roles));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (!api || auth !== "signed-in") {
    return (
      <div className="tab-panel">
        <PageHeader level={2} title="Logins & access" />
        <div className="card">
          <p className="muted">Logins and roles are managed on the live site, where people sign in. Here everyone has full access.</p>
        </div>
      </div>
    );
  }

  const roleName = (id: string) => (id === "admin" ? "Admin" : roles.find((r) => r.id === id)?.name ?? id);
  const employeeName = (id: string) => data.employees.find((e) => e.id === id)?.name ?? "";
  const rolesDirty = JSON.stringify(roles) !== savedRoles;
  const run = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      await load();
      return true;
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      return false;
    }
  };

  const toggle = (roleId: string, area: string) =>
    setRoles((rs) => rs.map((r) => (r.id !== roleId ? r : { ...r, areas: r.areas.includes(area) ? r.areas.filter((a) => a !== area) : [...r.areas, area] })));
  const addRole = () => {
    const name = window.prompt("Name of the new role (e.g. Media planner)")?.trim();
    if (!name) return;
    let id = slug(name);
    while (id === "admin" || roles.some((r) => r.id === id)) id += "_2";
    setRoles((rs) => [...rs, { id, name, areas: ["dashboard"] }]);
  };
  const removeRole = (r: Role) => {
    if (logins.some((l) => l.role === r.id)) return setMsg({ ok: false, text: `Move the logins with the ${r.name} role to another role first.` });
    if (window.confirm(`Remove the ${r.name} role?`)) setRoles((rs) => rs.filter((x) => x.id !== r.id));
  };

  const newLogin = () => setEdit({ username: "", role: roles[0]?.id ?? "admin", employeeId: "", password: randomPassword(), create: true });
  const pickEmployee = (id: string) => {
    const emp = data.employees.find((e) => e.id === id);
    if (!edit) return;
    const suggested = emp?.email ? emp.email.split("@")[0] : emp?.name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "") ?? "";
    setEdit({ ...edit, employeeId: id, username: edit.create && !edit.username ? suggested : edit.username });
  };

  return (
    <div className="tab-panel">
      {msg && <div className={msg.ok ? "notice" : "alert"} role="status">{msg.text}</div>}

      <PageHeader
        level={2}
        title="Logins"
        subtitle="Who can sign in, and with which role. Only admins see this tab."
        actions={<button className="btn primary" onClick={newLogin}>+ New login</button>}
      />
      <div className="card flush">
        {loading ? <Empty>Loading…</Empty> : (
          <table className="table">
            <thead><tr><th>Username</th><th>Employee</th><th>Role</th><th /></tr></thead>
            <tbody>
              {logins.map((l) => (
                <tr key={l.username} className="clickable" onClick={() => setEdit({ ...l, password: "", create: false })}>
                  <td><strong>{l.username}</strong>{l.username === user && <span className="muted small"> (you)</span>}</td>
                  <td>{employeeName(l.employeeId) || <span className="muted">—</span>}</td>
                  <td><Badge tone={l.role === "admin" ? "info" : "neutral"}>{roleName(l.role)}</Badge></td>
                  <td className="actions" onClick={(e) => e.stopPropagation()}>
                    <button className="btn ghost" onClick={() => setEdit({ ...l, password: "", create: false })}>Edit</button>
                    {l.username !== user && (
                      <button className="btn ghost danger" onClick={() => window.confirm(`Delete the login ${l.username}? They will be signed out.`) && run(() => api.deleteLogin(l.username), `Deleted ${l.username}.`)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <PageHeader
        level={2}
        title="Roles & tab access"
        subtitle="Tick the tabs each role can open. Admins always have every tab, plus this one."
        actions={
          <>
            <button className="btn" onClick={addRole}>+ New role</button>
            <button className="btn primary" disabled={!rolesDirty} onClick={() => run(() => api.saveRoles(roles), "Roles saved. Changes apply straight away.")}>
              Save roles
            </button>
          </>
        }
      />
      <div className="card flush">
        <table className="table access-table">
          <thead>
            <tr>
              <th>Role</th>
              {AREAS.map((a) => <th key={a.id} className="center">{a.label}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Admin</strong><div className="muted small">Full access</div></td>
              {AREAS.map((a) => <td key={a.id} className="center"><input type="checkbox" checked disabled aria-label={`Admin: ${a.label}`} /></td>)}
              <td />
            </tr>
            {roles.map((r) => (
              <tr key={r.id}>
                <td>
                  <input className="role-name" aria-label="Role name" value={r.name} onChange={(e) => setRoles((rs) => rs.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)))} />
                  <div className="muted small">{logins.filter((l) => l.role === r.id).length} login(s)</div>
                </td>
                {AREAS.map((a) => (
                  <td key={a.id} className="center">
                    <input type="checkbox" checked={r.areas.includes(a.id)} onChange={() => toggle(r.id, a.id)} aria-label={`${r.name}: ${a.label}`} />
                  </td>
                ))}
                <td className="actions"><button className="btn ghost danger" onClick={() => removeRole(r)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rolesDirty && <p className="warn small">You have unsaved changes to roles.</p>}

      {edit && (
        <Modal title={edit.create ? "New login" : `Edit login ${edit.username}`} onClose={() => setEdit(null)}>
          <form
            className="form"
            onSubmit={async (ev) => {
              ev.preventDefault();
              const ok = await run(
                () => api.saveLogin({ username: edit.username.trim(), role: edit.role, employeeId: edit.employeeId, password: edit.password || undefined, create: edit.create }),
                edit.create ? `Login ${edit.username} created. Share the password with them securely.` : edit.password ? `Saved. ${edit.username}'s password was reset and they were signed out.` : "Saved.",
              );
              if (ok) setEdit(null);
            }}
          >
            <Field label="Employee" span={2}>
              <select value={edit.employeeId} onChange={(e) => pickEmployee(e.target.value)}>
                <option value="">— Not linked —</option>
                {data.employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.name}{e.email ? ` (${e.email})` : ""}</option>)}
              </select>
            </Field>
            <Field label="Username *">
              <input required readOnly={!edit.create} value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value.replace(/\s/g, "") })} autoComplete="off" />
            </Field>
            <Field label="Role *">
              <select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} disabled={!edit.create && edit.username === user}>
                <option value="admin">Admin (full access)</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label={edit.create ? "Password * (min 10 characters)" : "New password (leave blank to keep)"} span={2}>
              <span className="row gap">
                <input required={edit.create} minLength={10} value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} autoComplete="new-password" />
                <button type="button" className="btn" onClick={() => setEdit({ ...edit, password: randomPassword() })}>Generate</button>
              </span>
            </Field>
            {edit.role !== "admin" && (
              <p className="muted small span2">
                Can open: {AREAS.filter((a) => roles.find((r) => r.id === edit.role)?.areas.includes(a.id)).map((a) => a.label).join(", ") || "nothing yet"}
              </p>
            )}
            <div className="form-actions span2">
              <button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn primary">{edit.create ? "Create login" : "Save"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
