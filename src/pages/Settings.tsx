import { useRef } from "react";
import type { AppData } from "../types";
import { useStore } from "../lib/store";
import { emptyData, sampleData } from "../lib/seed";
import { readBrowserData } from "../lib/adapter";
import { downloadFile, today } from "../lib/util";
import { Field, PageHeader } from "../components/ui";

const CURRENCIES = [
  ["INR", "en-IN"], ["USD", "en-US"], ["EUR", "de-DE"], ["GBP", "en-GB"], ["AED", "en-AE"], ["AUD", "en-AU"], ["CAD", "en-CA"], ["SGD", "en-SG"],
];

export default function SettingsPage() {
  const { data, updateSettings, replaceAll, storageName, shared } = useStore();
  const s = data.settings;
  const file = useRef<HTMLInputElement>(null);
  const browserData = shared ? readBrowserData() : null;
  const browserCounts = browserData
    ? `${browserData.invoices.length} invoices, ${browserData.expenses.length} expenses, ${browserData.clients.length} clients`
    : "";

  const importJSON = async (f: File) => {
    try {
      const parsed = JSON.parse(await f.text()) as AppData;
      if (!parsed || !Array.isArray(parsed.invoices) || !parsed.settings) throw new Error("Not an Agency Finance backup file.");
      if (window.confirm("Replace ALL current data with this backup?")) replaceAll({ ...emptyData(), ...parsed });
    } catch (e) {
      alert(`Import failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="Agency details appear on your invoices." />
      <div className="card">
        <h3>Agency</h3>
        <div className="form">
          <Field label="Agency name"><input value={s.agencyName} onChange={(e) => updateSettings({ agencyName: e.target.value })} /></Field>
          <Field label="Billing email"><input type="email" value={s.agencyEmail} onChange={(e) => updateSettings({ agencyEmail: e.target.value })} /></Field>
          <Field label="Tax ID / GSTIN"><input value={s.taxId} onChange={(e) => updateSettings({ taxId: e.target.value })} /></Field>
          <div />
          <Field label="Address" span={2}><textarea rows={3} value={s.agencyAddress} onChange={(e) => updateSettings({ agencyAddress: e.target.value })} /></Field>
        </div>
      </div>

      <div className="card">
        <h3>Invoicing</h3>
        <div className="form">
          <Field label="Currency">
            <select
              value={s.currency}
              onChange={(e) => updateSettings({ currency: e.target.value, locale: CURRENCIES.find(([c]) => c === e.target.value)?.[1] ?? s.locale })}
            >
              {CURRENCIES.map(([c]) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Default tax rate (%)"><input type="number" min={0} step="0.01" value={s.defaultTaxRate} onChange={(e) => updateSettings({ defaultTaxRate: Number(e.target.value) })} /></Field>
          <Field label="Invoice prefix"><input value={s.invoicePrefix} onChange={(e) => updateSettings({ invoicePrefix: e.target.value })} /></Field>
          <Field label="Next invoice number"><input type="number" min={1} value={s.nextInvoiceNumber} onChange={(e) => updateSettings({ nextInvoiceNumber: Number(e.target.value) })} /></Field>
          <Field label="Payment terms (days)"><input type="number" min={0} value={s.paymentTermsDays} onChange={(e) => updateSettings({ paymentTermsDays: Number(e.target.value) })} /></Field>
        </div>
      </div>

      <div className="card">
        <h3>Data</h3>
        <p className="muted">
          Stored in: <strong>{storageName}</strong>.{" "}
          {shared
            ? "Everyone who signs in sees the same data. The server keeps daily backups for 30 days."
            : "Browser storage is per-device; download backups regularly."}
        </p>
        <div className="row gap wrap">
          <button className="btn" onClick={() => downloadFile(`agency-finance-backup-${today()}.json`, JSON.stringify(data, null, 2), "application/json")}>Download backup (JSON)</button>
          <button className="btn" onClick={() => file.current?.click()}>Restore from backup…</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importJSON(e.target.files[0])} />
          {browserData && (
            <button
              className="btn"
              title="Data saved in this browser before server storage was turned on"
              onClick={() =>
                window.confirm(`Replace the server data with the data saved in this browser (${browserCounts})? Download a backup first if unsure.`) &&
                replaceAll({ ...emptyData(), ...browserData, settings: { ...emptyData().settings, ...browserData.settings } })
              }
            >
              Use data saved in this browser…
            </button>
          )}
          <button className="btn" onClick={() => window.confirm("Replace current data with sample data?") && replaceAll(sampleData())}>Load sample data</button>
          <button className="btn danger" onClick={() => window.confirm("Erase all clients, projects, invoices and expenses? Settings are kept.") && replaceAll({ ...emptyData(), settings: { ...s, nextInvoiceNumber: 1 } })}>
            Clear all data
          </button>
        </div>
      </div>
    </div>
  );
}
