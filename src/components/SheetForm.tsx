import { Suspense, lazy, useState } from "react";
import {
  COUNTRIES, ESTIMATE_TYPES,
  type CountryCode, type Estimate, type EstimateStatus, type EstimateType, type Invoice, type InvoiceStatus, type SheetDoc, type SheetKind,
} from "../types";
import { useStore } from "../lib/store";
import { addDays, amountInWords, docFormat, financialYear, gstSplit, gstState, invoiceTotals, today } from "../lib/util";
import { makeInvoiceNumber } from "../lib/invoiceno";
import { estimateType, typeInfo } from "../lib/doctype";
import { EstimateFooter, Letterhead, SignatureBlock, dmyDate, plainAmount, sheetLabels } from "./ProductionEstimate";
import { AutoTextarea, Field } from "./ui";
import { newLine } from "./Doc";

// The rich-text editor (Quill) is only downloaded when a sheet form is opened.
const LazyEditor = lazy(() => import("./RichText"));
const RichTextEditor = (props: { value: string; onChange: (html: string) => void; placeholder?: string; label: string }) => (
  <Suspense fallback={<div className="rte rte-loading muted small">Loading editor…</div>}>
    <LazyEditor {...props} />
  </Suspense>
);

type Patch = Partial<Omit<Estimate, "status">> & Partial<Omit<Invoice, "status">> & { status?: EstimateStatus | InvoiceStatus };

/**
 * Full-page estimate / invoice form, laid out as the printed sheet. The side
 * panel holds what doesn't print (title, type, status, dates, country, GST).
 */
export default function SheetForm({ kind, initial, isNew, onSave, onCancel }: { kind: SheetKind; initial: SheetDoc; isNew: boolean; onSave: (d: SheetDoc) => void; onCancel: () => void }) {
  const { data } = useStore();
  const s = data.settings;
  const [est, setEst] = useState<SheetDoc>(initial);
  const inv = kind === "invoice" ? (est as Invoice) : null;
  const estimate = kind === "estimate" ? (est as Estimate) : null;
  const client = data.clients.find((c) => c.id === est.clientId);
  const job = data.projects.find((p) => p.id === est.projectId);
  const jobs = data.projects.filter((p) => p.clientId === est.clientId);
  const fmt = docFormat(est.country, s);
  const t = invoiceTotals(est);
  const type = typeInfo(estimateType(est))!;
  const split = gstSplit(gstState(s.taxId, s.stateCode), client?.taxId, est.taxRate);
  const jobTypes = [...new Set(data.estimates.map((e) => e.jobType).filter((x): x is string => !!x))].sort();
  const isMedia = estimateType(est) === "media";
  // Media lines are booked with a publication / channel / platform from the vendor lists.
  const platforms = data.vendors.filter((v) => v.active && v.category !== "suppliers").map((v) => v.name).sort();
  const removeLine = (id: string) => set({ items: est.items.filter((x) => x.id !== id) });
  const previewNo =
    kind === "invoice"
      ? makeInvoiceNumber(data, est.issueDate || today(), "branchId" in est ? est.branchId : undefined)
      : `${isMedia ? s.mediaEstimatePrefix : s.productionEstimatePrefix}/${financialYear(est.issueDate || today())}/${s.nextEstimateNumber}`;
  const labels = sheetLabels(kind, isMedia);
  const noun = kind === "invoice" ? "Invoice" : "Estimate";

  /** Keep a percentage discount in step with the lines. */
  const withDiscount = (e: SheetDoc): SheetDoc => {
    if (!e.discountPct) return e;
    const sub = invoiceTotals({ ...e, discount: 0 }).subtotal;
    return { ...e, discount: Math.round(sub * e.discountPct) / 100 };
  };
  const set = (patch: Patch) => setEst((e) => withDiscount({ ...e, ...patch } as SheetDoc));
  const setItem = (id: string, patch: Partial<Estimate["items"][number]>) =>
    set({ items: est.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });

  const pickClient = (id: string) => {
    const c = data.clients.find((x) => x.id === id);
    set({ clientId: id, projectId: "", clientAddress: c?.address ?? "" });
  };
  const pickJob = (id: string) => {
    const j = data.projects.find((p) => p.id === id);
    set({
      projectId: id,
      title: est.title || j?.name || "",
      productLabel: est.productLabel || [j?.product, j?.subProduct].filter(Boolean).join(" "),
      jobType: est.jobType || j?.jobType || "",
    });
  };
  const pickCountry = (code: CountryCode) =>
    set({ country: code, taxRate: code === "IN" ? (est.country === "IN" ? est.taxRate : s.defaultTaxRate) : 0 });

  const dirty = JSON.stringify(est) !== JSON.stringify(initial);
  const leave = () => {
    if (dirty && !window.confirm(isNew ? `Discard this new ${noun.toLowerCase()}?` : `Discard your changes to this ${noun.toLowerCase()}?`)) return;
    onCancel();
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="back-title">
          <button type="button" className="icon-btn back-btn" onClick={leave} aria-label="Back to estimates">‹</button>
          {kind === "invoice"
            ? isNew ? `Add ${isMedia ? "Media " : ""}Invoice` : `Edit ${isMedia ? "Media " : ""}Invoice ${est.number}`
            : isNew ? `Add ${type.label} Estimate` : `Edit ${type.label} Estimate ${est.number}`}
        </h1>
      </div>

      <form className="estimate-editor" onSubmit={(e) => { e.preventDefault(); onSave(est); }}>
        {/* The sheet: everything here prints, laid out like the printed estimate. */}
        <div className={`pe-doc pe-edit ${isMedia ? "me-doc me-edit" : ""}`}>
          <div className="pe-fixed" title="From Settings → Agency / Letterhead"><Letterhead /></div>

          <h1 className="pe-title">{labels.title}</h1>

          <div className="pe-meta">
            <dl className="pe-meta-left">
              <dt>{labels.no}</dt>
              <dd>
                <input
                  aria-label={`${noun} number`}
                  value={est.number}
                  onChange={(e) => set({ number: e.target.value })}
                  placeholder={`${previewNo} (auto)`}
                  title="Leave blank to get the next number in the series"
                />
              </dd>
              {kind === "invoice" && data.branches.length > 1 && (
                <>
                  <dt>Branch :</dt>
                  <dd>
                    <select aria-label="Branch" value={("branchId" in est && est.branchId) || ""} onChange={(e) => set({ branchId: e.target.value } as Patch)}>
                      {data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}{b.code ? ` (${b.code})` : ""}</option>)}
                    </select>
                  </dd>
                </>
              )}
              <dt>Date :</dt>
              <dd>
                <input required type="date" aria-label={`${noun} date`} value={est.issueDate}
                  onChange={(e) => set(inv
                    ? { issueDate: e.target.value, dueDate: isNew ? addDays(e.target.value, s.paymentTermsDays) : inv.dueDate }
                    : { issueDate: e.target.value, validUntil: isNew ? addDays(e.target.value, s.estimateValidDays) : estimate!.validUntil })} />
              </dd>
              {inv && (
                <>
                  <dt>Due Date :</dt>
                  <dd className="span3"><input required type="date" aria-label="Due date" value={inv.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></dd>
                </>
              )}
              <dt>Job No. :</dt>
              <dd>
                <select aria-label="Job" value={est.projectId} onChange={(e) => pickJob(e.target.value)} disabled={!est.clientId}>
                  <option value="">{est.clientId ? "Select…" : "Client first"}</option>
                  {jobs.map((p) => <option key={p.id} value={p.id}>{p.number ?? p.name}</option>)}
                </select>
              </dd>
              <dt>Date :</dt>
              <dd><span className="pe-auto">{job ? dmyDate(job.startDate) : "—"}</span></dd>
              <dt>Job Type :</dt>
              <dd className="span3">
                <input aria-label="Job type" list="job-types" value={est.jobType ?? ""} onChange={(e) => set({ jobType: e.target.value })} placeholder="e.g. Brochure Printing" />
                <datalist id="job-types">{jobTypes.map((x) => <option key={x} value={x} />)}</datalist>
              </dd>
              <dt>Product :</dt>
              <dd className="span3"><input aria-label="Product" value={est.productLabel ?? ""} onChange={(e) => set({ productLabel: e.target.value })} placeholder="From the job's product" /></dd>
            </dl>
            <dl className="pe-meta-right">
              <dt>To:</dt>
              <dd className="pe-to">
                <select required aria-label="Client" value={est.clientId} onChange={(e) => pickClient(e.target.value)}>
                  <option value="" disabled>Select client…</option>
                  {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <AutoTextarea aria-label="Client address" value={est.clientAddress ?? ""} onChange={(e) => set({ clientAddress: e.target.value })} placeholder="Billing address" />
              </dd>
              <dt>GSTIN:</dt><dd><span className="pe-auto">{client?.taxId || "—"}</span></dd>
              <dt>PAN No.:</dt><dd><span className="pe-auto">{client?.pan || "—"}</span></dd>
            </dl>
          </div>

          <div className="pe-rich-edit">
            <RichTextEditor label="Header (optional, prints above the table)" value={est.header ?? ""} onChange={(header) => set({ header })} placeholder="Header (optional) — prints above the table" />
          </div>

          {isMedia ? (
            <table className="me-table me-table-edit">
              <thead>
                <tr>
                  <th className="me-sl">Sl. No.</th><th>Platform</th><th className="me-q">Quantity</th><th className="me-u">Unit</th>
                  <th className="pe-amt">Amount({fmt.currency})</th><th className="pe-x" />
                </tr>
              </thead>
              {est.items.map((it, i) => (
                <tbody key={it.id} className="me-item">
                  <tr>
                    <td className="me-sl">{i + 1}</td>
                    <td><input list="media-platforms" aria-label={`Line ${i + 1} platform`} value={it.platform ?? ""} onChange={(e) => setItem(it.id, { platform: e.target.value })} placeholder="e.g. Facebook India Online Services Pvt. Ltd." /></td>
                    <td className="me-q"><input type="number" min={0} step="0.01" aria-label={`Line ${i + 1} quantity`} value={it.quantity} onChange={(e) => setItem(it.id, { quantity: Number(e.target.value) })} /></td>
                    <td className="me-u"><input aria-label={`Line ${i + 1} unit`} value={it.unit ?? ""} onChange={(e) => setItem(it.id, { unit: e.target.value })} placeholder="1" /></td>
                    <td className="pe-amt">
                      <input className="num" type="number" min={0} step="0.01" aria-label={`Line ${i + 1} amount`} value={it.rate || ""} placeholder="0.00" onChange={(e) => setItem(it.id, { rate: Number(e.target.value) })} />
                      {Number(it.quantity) !== 1 && <div className="pe-qty">× {it.quantity} = {plainAmount(it.quantity * it.rate, fmt.locale)}</div>}
                    </td>
                    <td className="pe-x" rowSpan={2}>
                      <button type="button" className="icon-btn" disabled={est.items.length === 1} onClick={() => removeLine(it.id)} aria-label={`Remove line ${i + 1}`}>×</button>
                    </td>
                  </tr>
                  <tr>
                    <td />
                    <td colSpan={3}>
                      <div className="me-extra">
                        <input aria-label={`Line ${i + 1} beam or region`} value={it.region ?? ""} onChange={(e) => setItem(it.id, { region: e.target.value })} placeholder="Beam / region (TV, radio)" />
                        <input aria-label={`Line ${i + 1} time band`} value={it.timeBand ?? ""} onChange={(e) => setItem(it.id, { timeBand: e.target.value })} placeholder="Time band, e.g. Prime Time" />
                      </div>
                      <AutoTextarea
                        required
                        aria-label={`Line ${i + 1} description`}
                        value={it.description}
                        onChange={(e) => setItem(it.id, { description: e.target.value })}
                        placeholder={"What the cost covers (prints bold)\n• detail lines start with •"}
                      />
                    </td>
                    <td />
                  </tr>
                </tbody>
              ))}
            </table>
          ) : (
          <table className="pe-table pe-table-edit">
            <thead>
              <tr><th className="pe-sl">Sl. No.</th><th>Description</th><th className="pe-amt">Amount({fmt.currency})</th><th className="pe-x" /></tr>
            </thead>
            <tbody>
              {est.items.map((it, i) => (
                <tr key={it.id}>
                  <td className="pe-sl">{i + 1}</td>
                  <td>
                    <AutoTextarea
                      required
                      aria-label={`Line ${i + 1} description`}
                      value={it.description}
                      onChange={(e) => setItem(it.id, { description: e.target.value })}
                      placeholder={"Heading of the work (prints bold)\n• detail lines start with •"}
                    />
                  </td>
                  <td className="pe-amt">
                    <input className="num" type="number" min={0} step="0.01" aria-label={`Line ${i + 1} amount`} value={it.rate || ""} placeholder="0.00" onChange={(e) => setItem(it.id, { rate: Number(e.target.value) })} />
                    <label className="pe-qty-edit">
                      Qty <input type="number" min={0} step="0.01" aria-label={`Line ${i + 1} quantity`} value={it.quantity} onChange={(e) => setItem(it.id, { quantity: Number(e.target.value) })} />
                    </label>
                    {Number(it.quantity) !== 1 && <div className="pe-qty">= {plainAmount(it.quantity * it.rate, fmt.locale)}</div>}
                  </td>
                  <td className="pe-x">
                    <button type="button" className="icon-btn" disabled={est.items.length === 1} onClick={() => set({ items: est.items.filter((x) => x.id !== it.id) })} aria-label={`Remove line ${i + 1}`}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
          <datalist id="media-platforms">{platforms.map((n) => <option key={n} value={n} />)}</datalist>
          <button type="button" className="btn ghost pe-add" onClick={() => set({ items: [...est.items, newLine()] })}>+ Add line</button>

          {isMedia && (
            <div className="pe-rich-edit me-note-edit">
              <RichTextEditor key="note" label="Note (optional, prints under the lines)" value={est.remarks ?? ""} onChange={(remarks) => set({ remarks })} placeholder="Note (optional) — e.g. Please release 60% of the grand total as part payment" />
            </div>
          )}

          <div className="pe-totals">
            <div className="pe-words">Amount in Words: {amountInWords(t.total, fmt.currency)}</div>
            <dl>
              <dt>Total:</dt><dd>{plainAmount(t.subtotal, fmt.locale)}</dd>
              <dt className="pe-inline">
                Discount
                <input type="number" min={0} max={100} step="0.01" aria-label="Discount percent" value={est.discountPct || ""} placeholder="0"
                  onChange={(e) => set({ discountPct: Number(e.target.value) || 0, ...(Number(e.target.value) ? {} : { discount: 0 }) })} />%:
              </dt>
              <dd>
                <input className="num" type="number" min={0} step="0.01" aria-label="Discount amount" value={est.discount || ""} placeholder="0.00"
                  onChange={(e) => setEst({ ...est, discount: Number(e.target.value) || 0, discountPct: 0 })} />
              </dd>
              {t.discount > 0 && <><dt>Taxable Value:</dt><dd>{plainAmount(t.net, fmt.locale)}</dd></>}
              {split === "cgst" && (
                <>
                  <dt className="pe-inline">SGST ({est.taxRate / 2}%):</dt><dd>{plainAmount(t.tax / 2, fmt.locale)}</dd>
                  <dt>CGST ({est.taxRate / 2}%):</dt><dd>{plainAmount(t.tax / 2, fmt.locale)}</dd>
                </>
              )}
              {split === "igst" && <><dt>IGST ({est.taxRate}%):</dt><dd>{plainAmount(t.tax, fmt.locale)}</dd></>}
              <dt className="pe-inline">
                <label className="pe-check"><input type="checkbox" checked={!!est.roundOff} onChange={(e) => set({ roundOff: e.target.checked })} /> Round Off:</label>
              </dt>
              <dd>{plainAmount(t.roundOff, fmt.locale)}</dd>
              <dt className="pe-grand">Grand Total:</dt><dd className="pe-grand">{plainAmount(t.total, fmt.locale)}</dd>
            </dl>
          </div>

          {!isMedia && <div className="pe-rich-edit">
            <RichTextEditor key="remarks" label="Remarks (optional, prints below the totals)" value={est.remarks ?? ""} onChange={(remarks) => set({ remarks })} placeholder="Remarks (optional) — any important message to add" />
          </div>}

          <div className="pe-fixed" title="From Settings → Letterhead & bank details">
            <SignatureBlock />
            <EstimateFooter kind={kind} />
          </div>
        </div>

        {/* Details that don't print, or that set how the sheet is worked out. */}
        <aside className="card estimate-side">
          <Field label="Title (for your lists) *"><input required value={est.title ?? ""} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. HLL Parivarthan folder" /></Field>
          <Field label="Type">
            <select value={estimateType(est)} onChange={(e) => set({ type: e.target.value as EstimateType })}>
              {ESTIMATE_TYPES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </Field>
          {estimate && (
            <Field label="Status">
              <select value={estimate.status} onChange={(e) => { const status = e.target.value as EstimateStatus; set({ status, decidedDate: status === "approved" || status === "rejected" ? estimate.decidedDate || today() : "" }); }}>
                <option value="draft">Draft</option>
                <option value="sent">Sent – awaiting approval</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                {estimate.status === "invoiced" && <option value="invoiced">Invoiced</option>}
              </select>
            </Field>
          )}
          {inv && (
            <>
              <Field label="Status">
                <select value={inv.status} onChange={(e) => { const status = e.target.value as InvoiceStatus; set({ status, paidDate: status === "paid" ? inv.paidDate || today() : "" }); }}>
                  <option value="draft">Draft</option>
                  <option value="sent">Sent – awaiting payment</option>
                  <option value="paid">Paid</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </Field>
              {inv.status === "paid" && <Field label="Paid on"><input type="date" value={inv.paidDate} onChange={(e) => set({ paidDate: e.target.value })} /></Field>}
            </>
          )}
          <Field label="Country / currency">
            <select required value={est.country ?? ""} onChange={(e) => pickCountry(e.target.value as CountryCode)}>
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label} ({c.currency})</option>)}
            </select>
          </Field>
          <Field label="GST rate (%)"><input type="number" min={0} step="0.01" value={est.taxRate} onChange={(e) => set({ taxRate: Number(e.target.value) })} /></Field>
          {estimate && <Field label="Valid until"><input required type="date" value={estimate.validUntil} onChange={(e) => set({ validUntil: e.target.value })} /></Field>}
          <p className="muted small">
            {split === "cgst" ? "Same state as you: GST is split into SGST + CGST." : split === "igst" ? "Client is in another state: IGST applies." : `No GST on this ${noun.toLowerCase()}.`}
          </p>
          <div className="estimate-side-actions">
            <button className="btn primary">{isNew ? `Save ${noun.toLowerCase()}` : "Save changes"}</button>
            <button type="button" className="btn" onClick={leave}>Cancel</button>
          </div>
        </aside>
      </form>
    </div>
  );
}
