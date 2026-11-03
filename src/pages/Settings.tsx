import { useRef, useState, type FormEvent } from "react";
import type { AppData } from "../types";
import { useStore } from "../lib/store";
import { logoSrc } from "../lib/brand";
import { TEST_MARK, fillTestTaxIds, numberJobs, removeTestTaxIds, typeJobs } from "../lib/testdata";
import { gstState } from "../lib/util";
import { emptyData, sampleData } from "../lib/seed";
import { readBrowserData } from "../lib/adapter";
import { downloadFile, today } from "../lib/util";
import { Field, PageHeader } from "../components/ui";

const CURRENCIES = [
  ["INR", "en-IN"], ["USD", "en-US"], ["EUR", "de-DE"], ["GBP", "en-GB"], ["AED", "en-AE"], ["AUD", "en-AU"], ["CAD", "en-CA"], ["SGD", "en-SG"],
];

export default function SettingsPage() {
  const { data, updateSettings, replaceAll, upsert, storageName, shared, auth, user, changePassword } = useStore();
  const [toolMsg, setToolMsg] = useState("");
  const state = gstState(data.settings.taxId, data.settings.stateCode).replace("00", "32");
  const missingTax = data.clients.filter((c) => !c.taxId?.trim() || !c.pan?.trim()).length;
  const testClients = data.clients.filter((c) => c.notes?.includes(TEST_MARK)).length;
  const unnumbered = data.projects.filter((p) => !p.number?.trim()).length;
  const untyped = data.projects.filter((p) => !p.jobType?.trim()).length;
  const runTool = (label: string, fn: () => number) => {
    const n = fn();
    setToolMsg(`${label}: ${n} updated.`);
  };
  const [pw, setPw] = useState({ current: "", next: "", repeat: "" });
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.next !== pw.repeat) return setPwMsg({ ok: false, text: "The new passwords do not match." });
    try {
      await changePassword(pw.current, pw.next);
      setPw({ current: "", next: "", repeat: "" });
      setPwMsg({ ok: true, text: "Password changed. Other devices have been signed out." });
    } catch (err) {
      setPwMsg({ ok: false, text: (err as Error).message });
    }
  };
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
              <img className="logo-preview" src={logoSrc(s)} alt="Agency logo" />
              {!s.logo && <span className="muted small">Default logo</span>}
              <button type="button" className="btn" onClick={() => logoInput.current?.click()}>Upload a different logo…</button>
              {s.logo && <button type="button" className="btn ghost" onClick={() => updateSettings({ logo: "", logoIncludesName: true })}>Use the default logo</button>}
              <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
            </div>
            {s.logo && (
              <label className="check small">
                <input type="checkbox" checked={s.logoIncludesName !== false} onChange={(e) => updateSettings({ logoIncludesName: e.target.checked })} />
                This logo already shows the agency name (don't print the name next to it)
              </label>
            )}
          </div>
          <Field label="Agency name"><input value={s.agencyName} onChange={(e) => updateSettings({ agencyName: e.target.value })} /></Field>
          <Field label="Billing email"><input type="email" value={s.agencyEmail} onChange={(e) => updateSettings({ agencyEmail: e.target.value })} /></Field>
          <Field label="Tax ID / GSTIN"><input value={s.taxId} onChange={(e) => updateSettings({ taxId: e.target.value })} /></Field>
          <div />
          <Field label="Address" span={2}><textarea rows={3} value={s.agencyAddress} onChange={(e) => updateSettings({ agencyAddress: e.target.value })} /></Field>
        </div>
      </div>

      <div className="card">
        <h3>Letterhead & bank details</h3>
        <p className="muted">Printed on estimates. Blank fields are left off.</p>
        <div className="form">
          <Field label="Phone"><input value={s.agencyPhone} onChange={(e) => updateSettings({ agencyPhone: e.target.value })} placeholder="+91-471-…" /></Field>
          <Field label="Fax"><input value={s.agencyFax} onChange={(e) => updateSettings({ agencyFax: e.target.value })} /></Field>
          <Field label="Website"><input value={s.agencyWebsite} onChange={(e) => updateSettings({ agencyWebsite: e.target.value })} placeholder="www.example.in" /></Field>
          <Field label="PAN"><input value={s.agencyPan} maxLength={10} onChange={(e) => updateSettings({ agencyPan: e.target.value.toUpperCase() })} /></Field>
          <Field label="CIN"><input value={s.agencyCin} onChange={(e) => updateSettings({ agencyCin: e.target.value.toUpperCase() })} /></Field>
          <Field label="GST state code"><input value={s.stateCode} maxLength={2} onChange={(e) => updateSettings({ stateCode: e.target.value.replace(/\D/g, "") })} placeholder={s.taxId ? `${s.taxId.slice(0, 2)} (from GSTIN)` : "e.g. 32"} /></Field>
          <Field label="Account name"><input value={s.bankAccountName} onChange={(e) => updateSettings({ bankAccountName: e.target.value })} /></Field>
          <Field label="Bank"><input value={s.bankName} onChange={(e) => updateSettings({ bankName: e.target.value })} /></Field>
          <Field label="Branch"><input value={s.bankBranch} onChange={(e) => updateSettings({ bankBranch: e.target.value })} /></Field>
          <Field label="Account no."><input value={s.bankAccountNo} onChange={(e) => updateSettings({ bankAccountNo: e.target.value })} /></Field>
          <Field label="IFSC"><input value={s.bankIfsc} onChange={(e) => updateSettings({ bankIfsc: e.target.value.toUpperCase() })} /></Field>
          <Field label="SWIFT code"><input value={s.bankSwift} onChange={(e) => updateSettings({ bankSwift: e.target.value.toUpperCase() })} /></Field>
          <Field label="Estimate terms (one per line; {days} = validity, {agency} = agency name)" span={2}>
            <textarea rows={3} value={s.estimateTerms} onChange={(e) => updateSettings({ estimateTerms: e.target.value })} />
          </Field>
          <Field label="Invoice terms (one per line; {days} = payment terms, {agency} = agency name)" span={2}>
            <textarea rows={3} value={s.invoiceTerms ?? ""} onChange={(e) => updateSettings({ invoiceTerms: e.target.value })} />
          </Field>
          <Field label="Signature labels (comma-separated)" span={2}><input value={s.signatureLabels} onChange={(e) => updateSettings({ signatureLabels: e.target.value })} /></Field>
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
          <Field label="Production estimate prefix"><input value={s.productionEstimatePrefix} onChange={(e) => updateSettings({ productionEstimatePrefix: e.target.value })} /></Field>
          <Field label="Media estimate prefix"><input value={s.mediaEstimatePrefix} onChange={(e) => updateSettings({ mediaEstimatePrefix: e.target.value })} /></Field>
          <Field label={`Next estimate number (e.g. ${s.productionEstimatePrefix}/26-27/${s.nextEstimateNumber})`}><input type="number" min={1} value={s.nextEstimateNumber} onChange={(e) => updateSettings({ nextEstimateNumber: Number(e.target.value) })} /></Field>
          <Field label="Estimates valid for (days)"><input type="number" min={1} value={s.estimateValidDays} onChange={(e) => updateSettings({ estimateValidDays: Number(e.target.value) })} /></Field>
          <Field label="Job number style">
            <select value={s.jobNumberStyle ?? "client"} onChange={(e) => updateSettings({ jobNumberStyle: e.target.value as "client" | "prefix" })}>
              <option value="client">Client code + year + month + number (e.g. HLL26100417)</option>
              <option value="prefix">Prefix + number (e.g. JOB-0001)</option>
            </select>
          </Field>
          {s.jobNumberStyle === "prefix" && <Field label="Job prefix"><input value={s.jobPrefix} onChange={(e) => updateSettings({ jobPrefix: e.target.value })} /></Field>}
          <Field label="Next job number"><input type="number" min={1} value={s.nextJobNumber} onChange={(e) => updateSettings({ nextJobNumber: Number(e.target.value) })} /></Field>
          <Field label="Other job approvers (one per line). Department heads ticked in Employees are included automatically" span={2}>
            <textarea rows={3} defaultValue={s.departmentHeads.join("\n")} placeholder={"Priya (Creative)\nRahul (Media)"}
              onChange={(e) => updateSettings({ departmentHeads: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} />
          </Field>
        </div>
      </div>

      {auth === "signed-in" && (
        <div className="card">
          <h3>Your password</h3>
          <p className="muted">Signed in as <strong>{user}</strong>. Changing it signs you out on other devices.</p>
          <form className="form" onSubmit={submitPassword}>
            <input type="text" name="username" autoComplete="username" value={user ?? ""} readOnly hidden />
            <Field label="Current password"><input type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <div />
            <Field label="New password (min 10 characters)"><input type="password" autoComplete="new-password" required minLength={10} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
            <Field label="Repeat new password"><input type="password" autoComplete="new-password" required minLength={10} value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} /></Field>
            {pwMsg && <p className={`span2 small ${pwMsg.ok ? "good" : "bad"}`} role="status">{pwMsg.text}</p>}
            <div className="form-actions span2 start"><button className="btn primary">Change password</button></div>
          </form>
          <p className="muted small">To add or remove people, run on the server: <code>sudo -u agency-finance python3 /var/www/finance.starkpeople.in/_api/api.py add-user NAME</code></p>
        </div>
      )}

      <div className="card">
        <h3>Test data &amp; tidy-up</h3>
        <p className="muted">For trying things out. Test GSTIN and PAN numbers follow the real format (state {state}) but are made up; clients that get them are marked “{TEST_MARK}” in their notes and can be cleared again.</p>
        <div className="row gap wrap">
          <button className="btn" disabled={!missingTax} onClick={() =>
            window.confirm(`Add test GSTIN and PAN to ${missingTax} client(s) that don't have them?`) &&
            runTool("Test GSTIN & PAN", () => { const cs = fillTestTaxIds(data, state); cs.forEach((c) => upsert("clients", c)); return cs.length; })}>
            Fill test GSTIN &amp; PAN ({missingTax})
          </button>
          <button className="btn" disabled={!testClients} onClick={() =>
            window.confirm(`Remove the test GSTIN and PAN from ${testClients} client(s)?`) &&
            runTool("Test GSTIN & PAN removed", () => { const cs = removeTestTaxIds(data, state); cs.forEach((c) => upsert("clients", c)); return cs.length; })}>
            Remove test GSTIN &amp; PAN ({testClients})
          </button>
          <button className="btn" disabled={!unnumbered} onClick={() =>
            runTool("Job numbers", () => { const { jobs, next } = numberJobs(data); jobs.forEach((j) => upsert("projects", j)); updateSettings({ nextJobNumber: next }); return jobs.length; })}>
            Number jobs without a Job No. ({unnumbered})
          </button>
          <button className="btn" disabled={!untyped} onClick={() =>
            runTool("Job types", () => { const jobs = typeJobs(data); jobs.forEach((j) => upsert("projects", j)); return jobs.length; })}>
            Set Type on jobs without one ({untyped})
          </button>
        </div>
        {toolMsg && <p className="good small" role="status">{toolMsg}</p>}
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
