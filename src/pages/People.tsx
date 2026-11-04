import { useState } from "react";
import type { Branch, Department, Employee } from "../types";
import { branchCode, makeInvoiceNumber } from "../lib/invoiceno";
import { useStore } from "../lib/store";
import { go } from "../lib/route";
import { uid } from "../lib/util";
import { Badge, Empty, Field, Modal, PageHeader, confirmDelete } from "../components/ui";
import Access from "./Access";

const TABS = [
  { id: "employees", label: "Employees" },
  { id: "departments", label: "Departments" },
  { id: "branches", label: "Branches" },
  { id: "access", label: "Logins & access" }, // admins only
] as const;

/** Employees page: one page, a tab per list (#/people?tab=departments). */
export default function People({ params }: { params: URLSearchParams }) {
  const { data, access } = useStore();
  const tabs = TABS.filter((t) => t.id !== "access" || access.admin);
  const tab = tabs.some((t) => t.id === params.get("tab")) ? (params.get("tab") as (typeof TABS)[number]["id"]) : "employees";
  const count: Record<string, number | null> = { employees: data.employees.length, departments: data.departments.length, branches: data.branches.length, access: null };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Employees</h1>
          <p className="muted">Your team, departments and branches.</p>
        </div>
      </div>
      <div className="tabs directory-tabs" role="tablist" aria-label="Lists">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => go("people", t.id === "employees" ? undefined : { tab: t.id })}>
            {t.label}
            {count[t.id] !== null && <span className="tab-count">{count[t.id]}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "employees" && <Employees />}
        {tab === "departments" && <Departments />}
        {tab === "branches" && <Branches />}
        {tab === "access" && <Access />}
      </div>
    </div>
  );
}

function Employees() {
  const { data, upsert, remove } = useStore();
  const [edit, setEdit] = useState<Employee | null>(null);
  const [bulk, setBulk] = useState<{ names: string; departmentId: string; branchId: string } | null>(null);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const deptName = (id: string) => data.departments.find((d) => d.id === id)?.name ?? "";
  const branchName = (id: string) => data.branches.find((b) => b.id === id)?.name ?? "";
  const blank = (): Employee => ({
    id: uid(), name: "", email: "", phone: "", designation: "", departmentId: dept, branchId: data.branches.length === 1 ? data.branches[0].id : "",
    isHead: false, active: true, createdAt: new Date().toISOString(),
  });
  const rows = data.employees
    .filter((e) => (!dept || e.departmentId === dept) && `${e.name} ${e.email} ${e.designation} ${deptName(e.departmentId)} ${branchName(e.branchId)}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const isNew = edit ? !data.employees.some((e) => e.id === edit.id) : false;

  const saveBulk = () => {
    if (!bulk) return;
    const now = new Date().toISOString();
    const existing = new Set(data.employees.map((e) => e.name.trim().toLowerCase()));
    const names = [...new Set(bulk.names.split("\n").map((n) => n.trim()).filter(Boolean))].filter((n) => !existing.has(n.toLowerCase()));
    names.forEach((name) => upsert("employees", { id: uid(), name, email: "", phone: "", designation: "", departmentId: bulk.departmentId, branchId: bulk.branchId, isHead: false, active: true, createdAt: now }));
    setBulk(null);
  };

  return (
    <div className="tab-panel">
      <PageHeader
        level={2}
        title="Employees"
        subtitle={`${data.employees.filter((e) => e.active).length} active · department heads can approve new jobs`}
        actions={
          <>
            <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
              <option value="">All departments</option>
              {[...data.departments].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((d) => <option key={d.id} value={d.id}>{d.name} ({data.employees.filter((e) => e.departmentId === d.id).length})</option>)}
            </select>
            <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn" onClick={() => setBulk({ names: "", departmentId: dept, branchId: "" })}>Add several…</button>
            <button className="btn primary" onClick={() => setEdit(blank())}>+ New employee</button>
          </>
        }
      />
      <div className="card flush">
        {rows.length === 0 ? (
          <Empty>{data.employees.length ? "Nobody matches." : "No employees yet. Add them one by one, or paste a list with “Add several…”."}</Empty>
        ) : (
          <table className="table">
            <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Department</th><th>Branch</th><th /></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="clickable" onClick={() => setEdit(e)}>
                  <td>
                    <strong>{e.name}</strong> {e.isHead && <Badge tone="info">Head</Badge>} {!e.active && <Badge tone="muted">Inactive</Badge>}
                    {e.designation && <div className="muted small">{e.designation}</div>}
                  </td>
                  <td>{e.email ? <a href={`mailto:${e.email}`} onClick={(ev) => ev.stopPropagation()}>{e.email}</a> : <span className="muted">—</span>}</td>
                  <td className="nowrap">{e.phone || <span className="muted">—</span>}</td>
                  <td>{deptName(e.departmentId) || <span className="muted">—</span>}</td>
                  <td>{branchName(e.branchId) || <span className="muted">—</span>}</td>
                  <td className="actions"><button className="btn ghost danger" onClick={(ev) => (ev.stopPropagation(), confirmDelete(e.name) && remove("employees", e.id))}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {edit && (
        <Modal title={isNew ? "New employee" : `Edit ${edit.name}`} onClose={() => setEdit(null)}>
          <form className="form" onSubmit={(ev) => { ev.preventDefault(); upsert("employees", { ...edit, name: edit.name.trim(), email: edit.email.trim() }); setEdit(null); }}>
            <Field label="Name *" span={2}><input required autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Email"><input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} placeholder="name@stark.in" /></Field>
            <Field label="Phone"><input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Department">
              <select value={edit.departmentId} onChange={(e) => setEdit({ ...edit, departmentId: e.target.value })}>
                <option value="">—</option>
                {[...data.departments].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Branch">
              <select value={edit.branchId} onChange={(e) => setEdit({ ...edit, branchId: e.target.value })}>
                <option value="">—</option>
                {data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Designation" span={2}><input value={edit.designation} onChange={(e) => setEdit({ ...edit, designation: e.target.value })} placeholder="e.g. Account Executive" /></Field>
            <label className="check span2"><input type="checkbox" checked={edit.isHead} onChange={(e) => setEdit({ ...edit, isHead: e.target.checked })} /> Department head (can approve new jobs)</label>
            <label className="check span2"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
            <div className="form-actions span2">
              <button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn primary">Save</button>
            </div>
          </form>
        </Modal>
      )}

      {bulk && (
        <Modal title="Add several employees" onClose={() => setBulk(null)}>
          <form className="form" onSubmit={(ev) => { ev.preventDefault(); saveBulk(); }}>
            <Field label="Names (one per line)" span={2}>
              <textarea required autoFocus rows={8} value={bulk.names} onChange={(e) => setBulk({ ...bulk, names: e.target.value })} placeholder={"Name one\nName two"} />
            </Field>
            <Field label="Department">
              <select value={bulk.departmentId} onChange={(e) => setBulk({ ...bulk, departmentId: e.target.value })}>
                <option value="">—</option>
                {[...data.departments].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Branch">
              <select value={bulk.branchId} onChange={(e) => setBulk({ ...bulk, branchId: e.target.value })}>
                <option value="">—</option>
                {data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <p className="muted small span2">Names already in the list are skipped. Add emails and phone numbers afterwards by clicking each person.</p>
            <div className="form-actions span2">
              <button type="button" className="btn" onClick={() => setBulk(null)}>Cancel</button>
              <button className="btn primary">Add {new Set(bulk.names.split("\n").map((n) => n.trim().toLowerCase()).filter(Boolean)).size || ""} employees</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Departments() {
  const { data, upsert, remove } = useStore();
  const [edit, setEdit] = useState<Department | null>(null);
  const [q, setQ] = useState("");
  const staff = (id: string) => data.employees.filter((e) => e.departmentId === id);
  // In the order they were added (the defaults first: Admin, Finance, …)
  const ordered = [...data.departments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const rows = ordered.filter((d) => `${d.name} ${d.description}`.toLowerCase().includes(q.toLowerCase()));
  const del = (d: Department) => {
    const people = staff(d.id);
    if (!window.confirm(people.length ? `Delete ${d.name}? Its ${people.length} employee(s) will have no department.` : `Delete ${d.name}?`)) return;
    people.forEach((e) => upsert("employees", { ...e, departmentId: "" }));
    remove("departments", d.id);
  };
  return (
    <div className="tab-panel">
      <PageHeader
        level={2}
        title="Departments"
        subtitle="How work is divided"
        actions={
          <>
            <input placeholder="Search departments…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn primary" onClick={() => setEdit({ id: uid(), name: "", description: "", createdAt: new Date().toISOString() })}>+ New department</button>
          </>
        }
      />
      <div className="card flush">
        {rows.length === 0 ? <Empty>No departments.</Empty> : (
          <table className="table">
            <thead><tr><th className="num" style={{ width: 48 }}>#</th><th>Name</th><th>Description</th><th>Heads</th><th className="num">Employees</th><th /></tr></thead>
            <tbody>
              {rows.map((d, i) => (
                <tr key={d.id} className="clickable" onClick={() => setEdit(d)}>
                  <td className="num muted">{i + 1}</td>
                  <td><strong>{d.name}</strong></td>
                  <td className="muted">{d.description || "—"}</td>
                  <td>{staff(d.id).filter((e) => e.isHead).map((e) => e.name).join(", ") || <span className="muted">—</span>}</td>
                  <td className="num">{staff(d.id).length}</td>
                  <td className="actions"><button className="btn ghost danger" onClick={(ev) => (ev.stopPropagation(), del(d))}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edit && (
        <Modal title={data.departments.some((x) => x.id === edit.id) ? `Edit ${edit.name}` : "New department"} onClose={() => setEdit(null)}>
          <form className="form" onSubmit={(ev) => { ev.preventDefault(); upsert("departments", { ...edit, name: edit.name.trim() }); setEdit(null); }}>
            <Field label="Name *" span={2}><input required autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Description" span={2}><textarea rows={3} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <div className="form-actions span2">
              <button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn primary">Save</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Branches() {
  const { data, upsert, remove } = useStore();
  const [edit, setEdit] = useState<Branch | null>(null);
  const staff = (id: string) => data.employees.filter((e) => e.branchId === id);
  const del = (b: Branch) => {
    const people = staff(b.id);
    if (!window.confirm(people.length ? `Delete ${b.name}? Its ${people.length} employee(s) will have no branch.` : `Delete ${b.name}?`)) return;
    people.forEach((e) => upsert("employees", { ...e, branchId: "" }));
    remove("branches", b.id);
  };
  return (
    <div className="tab-panel">
      <PageHeader
        level={2}
        title="Branches"
        subtitle="Offices and locations"
        actions={<button className="btn primary" onClick={() => setEdit({ id: uid(), name: "", address: "", phone: "", createdAt: new Date().toISOString() })}>+ New branch</button>}
      />
      <div className="card flush">
        {data.branches.length === 0 ? <Empty>No branches yet. Add your offices, e.g. Thiruvananthapuram (head office).</Empty> : (
          <table className="table">
            <thead><tr><th>Code</th><th>Name</th><th>Address</th><th>Phone</th><th className="num">Employees</th><th /></tr></thead>
            <tbody>
              {data.branches.map((b) => (
                <tr key={b.id} className="clickable" onClick={() => setEdit(b)}>
                  <td>{b.code ? <span className="code-tag">{b.code}</span> : <span className="muted small">{branchCode(b)} (auto)</span>}</td>
                  <td><strong>{b.name}</strong></td>
                  <td className="muted pre">{b.address || "—"}</td>
                  <td className="nowrap">{b.phone || <span className="muted">—</span>}</td>
                  <td className="num">{staff(b.id).length}</td>
                  <td className="actions"><button className="btn ghost danger" onClick={(ev) => (ev.stopPropagation(), del(b))}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edit && (
        <Modal title={data.branches.some((x) => x.id === edit.id) ? `Edit ${edit.name}` : "New branch"} onClose={() => setEdit(null)}>
          <form className="form" onSubmit={(ev) => { ev.preventDefault(); upsert("branches", { ...edit, name: edit.name.trim() }); setEdit(null); }}>
            <Field label="Name *" span={2}><input required autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Thiruvananthapuram (HO)" /></Field>
            <Field label="Address" span={2}><textarea rows={3} value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
            <Field label="Phone"><input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Branch code (starts invoice numbers)">
              <input value={edit.code ?? ""} maxLength={6} pattern="[A-Za-z]{2,6}" onChange={(e) => setEdit({ ...edit, code: e.target.value.replace(/[^A-Za-z]/g, "").toLowerCase() })} placeholder="e.g. tvpm" title="2–6 letters" />
            </Field>
            <p className="muted small span2">Invoices from this branch are numbered {makeInvoiceNumber({ ...data, branches: [{ ...edit, code: edit.code || branchCode(edit) }] }, new Date().toISOString().slice(0, 10), edit.id)} and so on.</p>
            <div className="form-actions span2">
              <button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn primary">Save</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
