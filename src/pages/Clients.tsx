import { useState } from "react";
import type { Client } from "../types";
import { useStore } from "../lib/store";
import { netRevenue } from "../lib/metrics";
import { invoiceTotals, money, uid } from "../lib/util";
import { Empty, Field, Modal, PageHeader, confirmDelete } from "../components/ui";

const blank = (): Client => ({ id: uid(), name: "", contactName: "", email: "", phone: "", address: "", taxId: "", notes: "", createdAt: new Date().toISOString() });

export default function Clients() {
  const { data, upsert, remove } = useStore();
  const [edit, setEdit] = useState<Client | null>(null);
  const [q, setQ] = useState("");
  const s = data.settings;

  const rows = data.clients
    .filter((c) => `${c.name} ${c.contactName} ${c.email}`.toLowerCase().includes(q.toLowerCase()))
    .map((c) => {
      const inv = data.invoices.filter((i) => i.clientId === c.id);
      return {
        c,
        projects: data.projects.filter((p) => p.clientId === c.id).length,
        billed: inv.filter((i) => i.status === "paid").reduce((s, i) => s + netRevenue(i), 0),
        due: inv.filter((i) => i.status === "sent").reduce((s, i) => s + invoiceTotals(i).total, 0),
      };
    });

  const del = (c: Client) => {
    const used = data.invoices.some((i) => i.clientId === c.id) || data.projects.some((p) => p.clientId === c.id);
    if (used) return alert("This client has projects or invoices. Remove those first.");
    if (confirmDelete(c.name)) remove("clients", c.id);
  };

  return (
    <div className="page">
      <PageHeader
        title="Clients"
        subtitle={`${data.clients.length} clients`}
        actions={
          <>
            <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn primary" onClick={() => setEdit(blank())}>+ New client</button>
          </>
        }
      />
      <div className="card flush">
        {rows.length === 0 ? (
          <Empty>No clients yet.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Client</th><th>Contact</th><th className="num">Projects</th><th className="num">Revenue</th><th className="num">Outstanding</th><th /></tr>
            </thead>
            <tbody>
              {rows.map(({ c, projects, billed, due }) => (
                <tr key={c.id} className="clickable" onClick={() => setEdit(c)}>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.contactName}<div className="muted small">{c.email}</div></td>
                  <td className="num">{projects}</td>
                  <td className="num">{money(billed, s)}</td>
                  <td className={`num ${due ? "warn" : ""}`}>{money(due, s)}</td>
                  <td className="actions"><button className="btn ghost danger" onClick={(e) => (e.stopPropagation(), del(c))}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {edit && (
        <Modal title={data.clients.some((c) => c.id === edit.id) ? "Edit client" : "New client"} onClose={() => setEdit(null)}>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              upsert("clients", edit);
              setEdit(null);
            }}
          >
            <Field label="Company / client name" span={2}><input required autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Contact person"><input value={edit.contactName} onChange={(e) => setEdit({ ...edit, contactName: e.target.value })} /></Field>
            <Field label="Email"><input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Phone"><input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Tax ID / GSTIN"><input value={edit.taxId} onChange={(e) => setEdit({ ...edit, taxId: e.target.value })} /></Field>
            <Field label="Billing address" span={2}><textarea rows={2} value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
            <Field label="Notes" span={2}><textarea rows={2} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
            <div className="form-actions span2">
              <button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn primary">Save client</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
