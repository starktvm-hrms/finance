import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore } from "../lib/store";
import { computeMetrics } from "../lib/metrics";
import { fmtDate, invoiceTotals, money, monthLabel, shortMoney } from "../lib/util";
import { Empty, PageHeader, Stat } from "../components/ui";

const RANGES = [
  { v: 1, label: "This month" },
  { v: 3, label: "Last 3 months" },
  { v: 6, label: "Last 6 months" },
  { v: 12, label: "Last 12 months" },
];

export default function Dashboard({ go }: { go: (p: "invoices" | "expenses") => void }) {
  const { data } = useStore();
  const s = data.settings;
  const [months, setMonths] = useState(6);
  const m = computeMetrics(data, months);
  const fm = (n: number) => money(n, s);
  const margin = m.revenue ? Math.round((m.profit / m.revenue) * 100) : 0;
  const chart = m.monthly.map((x) => ({ ...x, label: monthLabel(x.month, s.locale) }));
  const maxCat = m.byCategory[0]?.value || 1;
  const clientName = (id: string) => data.clients.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        subtitle="Cash-basis overview: revenue counts invoices when paid, excluding tax."
        actions={
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Period">
            {RANGES.map((r) => (
              <option key={r.v} value={r.v}>{r.label}</option>
            ))}
          </select>
        }
      />

      <div className="stats">
        <Stat label="Revenue" value={fm(m.revenue)} hint={`+ ${fm(m.taxCollected)} tax collected`} />
        <Stat label="Expenses" value={fm(m.spent)} hint={`${m.byCategory.length} categories`} />
        <Stat label="Net profit" value={fm(m.profit)} hint={`${margin}% margin`} tone={m.profit >= 0 ? "good" : "bad"} />
        <Stat
          label="Outstanding"
          value={fm(m.outstanding)}
          hint={m.overdue ? `${fm(m.overdue)} overdue` : "Nothing overdue"}
          tone={m.overdue ? "warn" : undefined}
        />
      </div>

      <div className="grid-2">
        <div className="card span-2">
          <h3>Income vs expenses</h3>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} width={64} tick={{ fill: "var(--muted)", fontSize: 12 }} tickFormatter={(v) => shortMoney(v, s)} />
                <Tooltip
                  formatter={(v: number) => fm(v)}
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}
                  cursor={{ fill: "var(--hover)" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="income" name="Income" fill="var(--c-income)" radius={[4, 4, 0, 0]} maxBarSize={36} />
                <Bar dataKey="expenses" name="Expenses" fill="var(--c-expense)" radius={[4, 4, 0, 0]} maxBarSize={36} />
                <Line dataKey="profit" name="Profit" stroke="var(--c-profit)" strokeWidth={2} dot={{ r: 3 }} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h3>Expenses by category</h3>
          {m.byCategory.length === 0 ? (
            <Empty>No expenses in this period.</Empty>
          ) : (
            <div className="bars">
              {m.byCategory.map((c) => (
                <div key={c.name} className="bar-row">
                  <div className="bar-label">
                    <span>{c.name}</span>
                    <span className="num">{fm(c.value)}</span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(c.value / maxCat) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3>Revenue by client</h3>
          {m.byClient.length === 0 ? (
            <Empty>No client revenue yet.</Empty>
          ) : (
            <div className="chart small" style={{ height: Math.max(140, m.byClient.length * 48 + 20) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={m.byClient} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false} tick={{ fill: "var(--text)", fontSize: 12 }} />
                  <Tooltip formatter={(v: number) => fm(v)} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }} cursor={{ fill: "var(--hover)" }} />
                  <Bar dataKey="revenue" name="Revenue" fill="var(--c-income)" radius={[0, 4, 4, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card span-2">
          <div className="row between">
            <h3>Overdue invoices</h3>
            <button className="btn ghost" onClick={() => go("invoices")}>All invoices →</button>
          </div>
          {m.overdueList.length === 0 ? (
            <Empty>No overdue invoices. 🎉</Empty>
          ) : (
            <div className="scroll-x"><table className="table">
              <thead>
                <tr><th>Invoice</th><th>Client</th><th>Due</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {m.overdueList.map((i) => (
                  <tr key={i.id}>
                    <td>{i.number}</td>
                    <td>{clientName(i.clientId)}</td>
                    <td className="bad">{fmtDate(i.dueDate, s.locale)}</td>
                    <td className="num">{fm(invoiceTotals(i).total)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      </div>
    </div>
  );
}
