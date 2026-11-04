import { useState } from "react";
import type { Client } from "../types";
import { useStore } from "../lib/store";
import { netRevenue } from "../lib/metrics";
import { invoiceTotals, money, uid } from "../lib/util";
import { Empty, Field, Modal, PageHeader, confirmDelete } from "../components/ui";
import { CODE_RE, clientCode, suggestCode } from "../lib/jobno";

const blank = (): Client => ({ id: uid(), name: "", contactName: "", email: "", phone: "", address: "", taxId: "", notes: "", createdAt: new Date().toISOString() });

export default function Clients() {
  const { data, upsert, remove, can, access } = useStore();
  const seeMoney = can("invoices");
  const [edit, setEdit] = useState<Client | null>(null);
  const [codeTyped, setCodeTyped] = useState(false);
  const [codeError, setCodeError] = useState("");
  const openForm = (c: Client) => { setEdit(c); setCodeTyped(!!c.code); setCodeError(""); };
  /** Problem with the admin's code, or "" when it is fine. */
  const checkCode = (c: Client) => {
    const code = (c.code ?? "").trim();
    if (!code) return "Enter a client code: 2 to 4 letters.";
    if (!CODE_RE.test(code)) return "The code must be 2 to 4 letters (A–Z), e.g. HLL or DT.";
    const clash = data.clients.find((o) => o.id !== c.id && clientCode(o) === code);
    return clash ? `${code} is already the code of ${clash.name}.` : "";
  };
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
    <div className="tab-panel">
      <PageHeader
        level={2}
        title="Clients"
        subtitle={`${data.clients.length} clients`}
        actions={
          <>
            <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn primary" onClick={() => openForm(blank())}>+ New client</button>
          </>
        }
      />
      <div className="card flush">
        {rows.length === 0 ? (
          <Empty>No clients yet.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Code</th><th>Client</th><th>Contact</th><th className="num">Jobs</th>{seeMoney && <><th className="num">Revenue</th><th className="num">Outstanding</th></>}<th /></tr>
            </thead>
            <tbody>
              {rows.map(({ c, projects, billed, due }) => (
                <tr key={c.id} className="clickable" onClick={() => openForm(c)}>
                  <td>{c.code ? <span className="code-tag">{c.code}</span> : <span className="muted small" title="Not set yet: job numbers use this suggested code until an admin sets one">{clientCode(c)} (auto)</span>}</td>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.contactName}<div className="muted small">{c.email}</div></td>
                  <td className="num">{projects}</td>
                  {seeMoney && (
                    <>
                      <td className="num">{money(billed, s)}</td>
                      <td className={`num ${due ? "warn" : ""}`}>{money(due, s)}</td>
                    </>
                  )}
                  <td className="actions">{access.admin && <button className="btn ghost danger" onClick={(e) => (e.stopPropagation(), del(c))}>Delete</button>}</td>
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
              if (access.admin) {
                const err = checkCode(edit);
                if (err) return setCodeError(err);
              }
              upsert("clients", edit);
              setEdit(null);
            }}
          >
            <Field label="Company / client name" span={2}><input required autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value, ...(access.admin && !codeTyped && { code: e.target.value.trim() ? suggestCode(e.target.value) : "" }) })} /></Field>
            <Field label="Contact person"><input value={edit.contactName} onChange={(e) => setEdit({ ...edit, contactName: e.target.value })} /></Field>
            <Field label="Email"><input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Phone"><input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Tax ID / GSTIN"><input value={edit.taxId} onChange={(e) => setEdit({ ...edit, taxId: e.target.value })} /></Field>
            <Field label="PAN"><input value={edit.pan ?? ""} onChange={(e) => setEdit({ ...edit, pan: e.target.value.toUpperCase() })} maxLength={10} /></Field>
            <Field label="Client code (2–4 letters, starts every job number)">
              {access.admin ? (
                <>
                  <input
                    required
                    value={edit.code ?? ""}
                    maxLength={4}
                    pattern="[A-Za-z]{2,4}"
                    onChange={(e) => { setCodeTyped(true); setCodeError(""); setEdit({ ...edit, code: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") }); }}
                    placeholder={suggestCode(edit.name)}
                  />
                  {codeError && <span className="bad small">{codeError}</span>}
                </>
              ) : (
                <input readOnly value={edit.code ? edit.code : `${clientCode(edit)} (until an admin sets it)`} title="Only an admin can set the client code" />
              )}
            </Field>
            <Field label="Billing address" span={2}><textarea rows={2} value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
            <Field label="Products (one per line — Product: sub-product, sub-product)" span={2}>
              <textarea
                rows={3}
                placeholder={"Detergent: Liquid, Powder\nShampoo: Anti-dandruff"}
                defaultValue={(edit.products ?? []).map((p) => (p.subProducts.length ? `${p.name}: ${p.subProducts.join(", ")}` : p.name)).join("\n")}
                onChange={(e) => setEdit({ ...edit, products: parseProducts(e.target.value) })}
              />
            </Field>
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

/** "Product: sub, sub" per line → products list (blank lines ignored, duplicates merged). */
function parseProducts(text: string) {
  const out: { name: string; subProducts: string[] }[] = [];
  for (const line of text.split("\n")) {
    const [name, subs = ""] = line.split(":");
    if (!name?.trim()) continue;
    const subProducts = subs.split(",").map((x) => x.trim()).filter(Boolean);
    const existing = out.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
    if (existing) existing.subProducts = [...new Set([...existing.subProducts, ...subProducts])];
    else out.push({ name: name.trim(), subProducts });
  }
  return out;
}
