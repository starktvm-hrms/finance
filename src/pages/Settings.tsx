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
  const logoInput = useRef<HTMLInputElement>(null);

  /** Shrink the logo to at most 400×160 so it stays small in the shared data. */
  const uploadLogo = (f: File) => {
    if (f.size > 2 * 1024 * 1024) return alert("Please choose an image under 2 MB.");
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 400 / img.width, 160 / img.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      updateSettings({ logo: canvas.toDataURL("image/png") });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => alert("That file could not be read as an image.");
    img.src = url;
  };
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
          <div className="field span2">
            <span>Logo (shown on estimates and invoices)</span>
            <div className="row gap wrap">
              {s.logo ? <img className="logo-preview" src={s.logo} alt="Agency logo" /> : <span className="muted small">No logo yet</span>}
              <button type="button" className="btn" onClick={() => logoInput.current?.click()}>{s.logo ? "Change logo…" : "Upload logo…"}</button>
              {s.logo && <button type="button" className="btn ghost danger" onClick={() => updateSettings({ logo: "" })}>Remove</button>}
              <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
            </div>
          </div>
          <Field label="Agency name"><input value={s.agencyName} onChange={(e) => updateSettings({ agencyName: e.target.value })} /></Field>
          <Field label="Billing email"><input type="email" value={s.agencyEmail} onChange={(e) => updateSettings({ agencyEmail: e.target.value })} /></Field>
          <Field label="Tax ID / GSTIN"><input value={s.taxId} onChange={(e) => updateSettings({ taxId: e.target.value })} /></Field>
          <div />
          <Field label="Address" span={2}><textarea rows={3} value={s.agencyAddress} onChange={(e) => updateSettings({ agencyAddress: e.target.value })} /></Field>
        </div>
      </div>

      <div className="card">
        <h3>Invoices & estimates</h3>
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
          <div />
          <Field label="Estimate prefix"><input value={s.estimatePrefix} onChange={(e) => updateSettings({ estimatePrefix: e.target.value })} /></Field>
          <Field label="Next estimate number"><input type="number" min={1} value={s.nextEstimateNumber} onChange={(e) => updateSettings({ nextEstimateNumber: Number(e.target.value) })} /></Field>
          <Field label="Estimates valid for (days)"><input type="number" min={1} value={s.estimateValidDays} onChange={(e) => updateSettings({ estimateValidDays: Number(e.target.value) })} /></Field>
          <Field label="Job prefix"><input value={s.jobPrefix} onChange={(e) => updateSettings({ jobPrefix: e.target.value })} /></Field>
          <Field label="Next job number"><input type="number" min={1} value={s.nextJobNumber} onChange={(e) => updateSettings({ nextJobNumber: Number(e.target.value) })} /></Field>
          <Field label="Department heads (one per line; they can approve new jobs)" span={2}>
            <textarea rows={3} defaultValue={s.departmentHeads.join("\n")} placeholder={"Priya (Creative)\nRahul (Media)"}
              onChange={(e) => updateSettings({ departmentHeads: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} />
          </Field>
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
          <button className="btn danger" onClick={() => window.confirm("Erase all clients, vendors, jobs, estimates, invoices and expenses? Settings are kept.") && replaceAll({ ...emptyData(), settings: { ...s, nextInvoiceNumber: 1, nextEstimateNumber: 1 } })}>
            Clear all data
          </button>
        </div>
      </div>
    </div>
  );
}
