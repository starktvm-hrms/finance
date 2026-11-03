import { useMemo, useState } from "react";
import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory } from "../types";
import { useStore } from "../lib/store";
import { downloadFile, fmtDate, money, toCSV, today, uid } from "../lib/util";
import { Badge, Empty, Field, Modal, PageHeader, confirmDelete } from "../components/ui";

export default function Expenses({ params }: { params: URLSearchParams }) {
  const { data, upsert, remove } = useStore();
  const s = data.settings;
  const [edit, setEdit] = useState<Expense | null>(null);
  const [cat, setCat] = useState<ExpenseCategory | "all">("all");
  const [month, setMonth] = useState("");
  const [q, setQ] = useState("");
  const [vendorId, setVendorId] = useState(params.get("vendor") ?? "");
  const vendorFilter = data.vendors.find((v) => v.id === vendorId);
  /** Link the expense to a vendor list entry when the payee name matches one. */
  const linkVendor = (e: Expense): Expense => {
    const match = data.vendors.find((v) => v.name.trim().toLowerCase() === e.vendor.trim().toLowerCase());
    return { ...e, vendor: match ? match.name : e.vendor.trim(), vendorId: match?.id };
  };

  const blank = (): Expense => ({ id: uid(), date: today(), vendor: "", category: "Software & Tools", amount: 0, projectId: "", description: "", recurring: false, createdAt: new Date().toISOString() });
  const projectName = (id: string) => data.projects.find((p) => p.id === id)?.name ?? "";

  const rows = useMemo(
    () =>
      data.expenses
        .filter((e) => (!vendorId || e.vendorId === vendorId) && (cat === "all" || e.category === cat) && (!month || e.date.startsWith(month)) && `${e.vendor} ${e.description}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [data.expenses, cat, month, q, vendorId],
  );
  const total = rows.reduce((s, e) => s + e.amount, 0);

  const exportCSV = () =>
    downloadFile(
      `expenses-${today()}.csv`,
      toCSV(rows.map((e) => ({ date: e.date, vendor: e.vendor, category: e.category, amount: e.amount, project: projectName(e.projectId), description: e.description, recurring: e.recurring }))),
      "text/csv",
    );

  return (
    <div className="page">
      <PageHeader
        title="Expenses"
        subtitle={`${rows.length} entries · ${money(total, s)}`}
        actions={
          <>
            <button className="btn" onClick={exportCSV} disabled={!rows.length}>Export CSV</button>
            <button className="btn primary" onClick={() => setEdit(blank())}>+ Add expense</button>
          </>
        }
      />
      <div className="filters">
        <input placeholder="Search vendor or note…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value as ExpenseCategory | "all")} aria-label="Category">
          <option value="all">All categories</option>
          {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
        {vendorFilter && <span className="badge badge-info">Vendor: {vendorFilter.name}</span>}
        {(cat !== "all" || month || q || vendorId) && <button className="btn ghost" onClick={() => { setCat("all"); setMonth(""); setQ(""); setVendorId(""); }}>Clear</button>}
      </div>
      <div className="card flush">
        {rows.length === 0 ? (
          <Empty>No expenses match.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Vendor</th><th>Category</th><th>Job</th><th className="num">Amount</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="clickable" onClick={() => setEdit(e)}>
                  <td className="nowrap">{fmtDate(e.date, s.locale)}</td>
                  <td>{e.vendor}{e.vendorId && <span className="muted small" title="In vendor list"> ✓</span>}{e.recurring && <span className="muted small"> · recurring</span>}{e.description && <div className="muted small">{e.description}</div>}</td>
                  <td><Badge tone="neutral">{e.category}</Badge></td>
                  <td className="muted">{projectName(e.projectId) || "—"}</td>
                  <td className="num">{money(e.amount, s)}</td>
                  <td className="actions">
                    <button className="btn ghost" title="Duplicate for today" onClick={(ev) => (ev.stopPropagation(), upsert("expenses", { ...e, id: uid(), date: today(), createdAt: new Date().toISOString() }))}>Repeat</button>
                    <button className="btn ghost danger" onClick={(ev) => (ev.stopPropagation(), confirmDelete("this expense") && remove("expenses", e.id))}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {edit && (
        <Modal title={data.expenses.some((x) => x.id === edit.id) ? "Edit expense" : "Add expense"} onClose={() => setEdit(null)}>
          <form className="form" onSubmit={(e) => { e.preventDefault(); upsert("expenses", linkVendor(edit)); setEdit(null); }}>
            <Field label="Vendor / payee">
              <input required autoFocus list="vendor-names" value={edit.vendor} onChange={(e) => setEdit({ ...edit, vendor: e.target.value })} />
              <datalist id="vendor-names">
                {data.vendors.filter((v) => v.active).map((v) => <option key={v.id} value={v.name} />)}
              </datalist>
            </Field>
            <Field label={`Amount (${s.currency})`}><input required type="number" min={0} step="0.01" value={edit.amount || ""} onChange={(e) => setEdit({ ...edit, amount: Number(e.target.value) })} /></Field>
            <Field label="Date"><input required type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} /></Field>
            <Field label="Category">
              <select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value as ExpenseCategory })}>
                {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Job (optional)" span={2}>
              <select value={edit.projectId} onChange={(e) => setEdit({ ...edit, projectId: e.target.value })}>
                <option value="">— Overhead / not job-specific —</option>
                {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Description" span={2}><textarea rows={2} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <label className="check span2"><input type="checkbox" checked={edit.recurring} onChange={(e) => setEdit({ ...edit, recurring: e.target.checked })} /> Recurring monthly cost</label>
            <div className="form-actions span2">
              <button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn primary">Save expense</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
