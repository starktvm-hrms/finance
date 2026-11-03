import { useState } from "react";
import { VENDOR_CATEGORIES, type Vendor, type VendorCategory } from "../types";
import { useStore } from "../lib/store";
import { go } from "../lib/route";
import { money, today, uid } from "../lib/util";
import { Badge, Empty, Field, Modal, PageHeader, confirmDelete } from "../components/ui";

export const vendorCategory = (id: string | null) => VENDOR_CATEGORIES.find((c) => c.id === id) ?? VENDOR_CATEGORIES[0];

/** One page for every vendor list (Publications, Suppliers, Channels, …). */
export default function Vendors({ params }: { params: URLSearchParams }) {
  const { data, upsert, remove } = useStore();
  const s = data.settings;
  const cat = vendorCategory(params.get("category"));
  const [edit, setEdit] = useState<Vendor | null>(null);
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const blank = (): Vendor => ({
    id: uid(), category: cat.id, name: "", contactName: "", email: "", phone: "", address: "", taxId: "",
    paymentTermsDays: s.paymentTermsDays, notes: "", active: true, createdAt: new Date().toISOString(),
  });

  const year = today().slice(0, 4);
  const spendOf = (v: Vendor) => {
    const mine = data.expenses.filter((e) => e.vendorId === v.id);
    return {
      total: mine.reduce((t, e) => t + e.amount, 0),
      thisYear: mine.filter((e) => e.date.startsWith(year)).reduce((t, e) => t + e.amount, 0),
      count: mine.length,
    };
  };

  const all = data.vendors.filter((v) => v.category === cat.id);
  const rows = all
    .filter((v) => (showInactive || v.active) && `${v.name} ${v.contactName} ${v.email} ${v.address}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const del = (v: Vendor) => {
    const linked = data.expenses.filter((e) => e.vendorId === v.id);
    const msg = linked.length
      ? `Delete ${v.name}? Its ${linked.length} expense(s) are kept, with the name as plain text.`
      : null;
    if (msg ? !window.confirm(msg) : !confirmDelete(v.name)) return;
    linked.forEach((e) => upsert("expenses", { ...e, vendorId: undefined }));
    remove("vendors", v.id);
  };

  const isNew = edit ? !data.vendors.some((v) => v.id === edit.id) : false;
  const inactiveCount = all.filter((v) => !v.active).length;

  return (
    <div className="page">
      <PageHeader
        title={cat.label}
        subtitle={`${cat.hint} · ${all.length} ${all.length === 1 ? "entry" : "entries"}`}
        actions={
          <>
            <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn primary" onClick={() => setEdit(blank())}>+ New {cat.one}</button>
          </>
        }
      />
      {inactiveCount > 0 && (
        <label className="check muted small">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show {inactiveCount} inactive
        </label>
      )}
      <div className="card flush">
        {rows.length === 0 ? (
          <Empty>{all.length ? "Nothing matches." : `No ${cat.label.toLowerCase()} yet. Add your first ${cat.one}.`}</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Contact</th><th>Location</th><th className="num">Spend {year}</th><th className="num">Total spend</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const sp = spendOf(v);
                return (
                  <tr key={v.id} className="clickable" onClick={() => setEdit(v)}>
                    <td><strong>{v.name}</strong>{!v.active && <> <Badge tone="muted">Inactive</Badge></>}{v.taxId && <div className="muted small">GSTIN {v.taxId}</div>}</td>
                    <td>{v.contactName}<div className="muted small">{[v.phone, v.email].filter(Boolean).join(" · ")}</div></td>
                    <td className="muted">{v.address || "—"}</td>
                    <td className="num">{money(sp.thisYear, s)}</td>
                    <td className="num">
                      {sp.count ? (
                        <button className="btn ghost" title="Show expenses" onClick={(e) => (e.stopPropagation(), go("expenses", { vendor: v.id }))}>{money(sp.total, s)}</button>
                      ) : money(0, s)}
                    </td>
                    <td className="actions"><button className="btn ghost danger" onClick={(e) => (e.stopPropagation(), del(v))}>Delete</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {edit && (
        <Modal title={isNew ? `New ${edit ? vendorCategory(edit.category).one : ""}` : `Edit ${edit.name}`} onClose={() => setEdit(null)}>
          <form className="form" onSubmit={(e) => { e.preventDefault(); upsert("vendors", { ...edit, name: edit.name.trim() }); setEdit(null); }}>
            <Field label="Name" span={2}><input required autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="List">
              <select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value as VendorCategory })}>
                {VENDOR_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Contact person"><input value={edit.contactName} onChange={(e) => setEdit({ ...edit, contactName: e.target.value })} /></Field>
            <Field label="Phone"><input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Email"><input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Tax ID / GSTIN"><input value={edit.taxId} onChange={(e) => setEdit({ ...edit, taxId: e.target.value })} /></Field>
            <Field label="Payment terms (days)"><input type="number" min={0} value={edit.paymentTermsDays} onChange={(e) => setEdit({ ...edit, paymentTermsDays: Number(e.target.value) })} /></Field>
            <Field label="Address / location" span={2}><textarea rows={2} value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
            <Field label="Notes (rates, editions, slots…)" span={2}><textarea rows={2} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
            <label className="check span2"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
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
