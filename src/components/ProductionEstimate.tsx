import type { Estimate, LineItem } from "../types";
import { useStore } from "../lib/store";
import { amountInWords, docFormat, gstSplit, gstState, invoiceTotals } from "../lib/util";
import { RichTextView } from "./SafeHtml";
import { logoShowsName, logoSrc } from "../lib/brand";

const dmy = (d: string) => {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

/** Plain amount with grouping and 2 decimals, e.g. 23,600.00 (currency is in the column header). */
const amt = (n: number, locale: string) => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

/**
 * Line description: the lines before the first bullet print bold (the heading),
 * lines starting with •, - or * print as bullets, anything else as plain text.
 */
export function Description({ text }: { text: string }) {
  const lines = text.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
  const isBullet = (l: string) => /^\s*[•\-*]\s+/.test(l);
  const firstBullet = lines.findIndex(isBullet);
  const head = firstBullet < 0 ? lines : lines.slice(0, firstBullet);
  const rest = firstBullet < 0 ? [] : lines.slice(firstBullet);
  return (
    <>
      {head.length > 0 && <div className="pe-desc-head">{head.join(" ")}</div>}
      {rest.length > 0 && (
        <ul className="pe-bullets">
          {rest.map((l, i) => (isBullet(l) ? <li key={i}>{l.replace(/^\s*[•\-*]\s+/, "")}</li> : <li key={i} className="plain">{l}</li>))}
        </ul>
      )}
    </>
  );
}

export const dmyDate = dmy;
export const plainAmount = amt;

/** Letterhead, signature row and footer come from Settings; shared by the printout and the form. */
export function Letterhead() {
  const s = useStore().data.settings;
  const state = gstState(s.taxId, s.stateCode);
  const contact = [
    s.agencyPhone && `P: ${s.agencyPhone}`,
    s.agencyFax && `F: ${s.agencyFax}`,
    s.agencyEmail && `E: ${s.agencyEmail}`,
  ].filter(Boolean);
  const ids = [
    s.agencyPan && `PAN: ${s.agencyPan}`,
    s.taxId && `GSTIN: ${s.taxId}`,
    state !== "00" && `State Code: ${state}`,
    s.agencyCin && `CIN: ${s.agencyCin}`,
    s.agencyWebsite,
  ].filter(Boolean);
  return (
    <header className="pe-letterhead">
      <div className={`pe-brand ${logoShowsName(s) ? "full" : ""}`}>
        <img src={logoSrc(s)} alt={logoShowsName(s) ? s.agencyName : ""} />
        {!logoShowsName(s) && <span>{s.agencyName}</span>}
      </div>
      <p className="pe-address">
        {[s.agencyAddress.replace(/\n/g, ", "), ...contact].filter(Boolean).join("   ")}
        {ids.length > 0 && <><br />{ids.join("  ")}</>}
      </p>
    </header>
  );
}

export function SignatureBlock() {
  const s = useStore().data.settings;
  const signatures = s.signatureLabels.split(",").map((x) => x.trim()).filter(Boolean);
  return (
    <div className="pe-sign">
      <div className="pe-sign-row">
        {signatures.map((l) => <span key={l}>{l}</span>)}
        <span className="pe-approved">
          Approved
          <span className="pe-approved-lines"><span>Signature:</span><span>Name:</span><span>Date:</span></span>
        </span>
      </div>
      <div className="pe-eoe">E &amp; OE</div>
    </div>
  );
}

export function EstimateFooter() {
  const s = useStore().data.settings;
  const terms = s.estimateTerms
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/\{days\}/g, String(s.estimateValidDays)).replace(/\{agency\}/g, s.agencyName));
  const bank: [string, string][] = (
    [
      ["Account Name", s.bankAccountName],
      ["Bank", s.bankName],
      ["Branch", s.bankBranch],
      ["Account No", s.bankAccountNo],
      ["IFSC", s.bankIfsc],
      ["Swift code", s.bankSwift],
    ] as [string, string][]
  ).filter(([, v]) => v);
  return (
    <footer className="pe-footer">
      <ol>{terms.map((x) => <li key={x}>{x}</li>)}</ol>
      {bank.length > 0 && (
        <div className="pe-bank">
          {bank.map(([k, v]) => <div key={k}>{k}: {v}</div>)}
        </div>
      )}
    </footer>
  );
}

/** Printable production estimate (A4 portrait), laid out like the agency's existing format. */
export default function ProductionEstimate({ est }: { est: Estimate }) {
  const { data } = useStore();
  const s = data.settings;
  const client = data.clients.find((c) => c.id === est.clientId);
  const job = data.projects.find((p) => p.id === est.projectId);
  const fmt = docFormat(est.country, s);
  const product = est.productLabel || [job?.product, job?.subProduct].filter(Boolean).join(" ") || est.title || "";
  return (
    <article className="pe-doc print-area" aria-label={`Estimate ${est.number}`}>
      <Letterhead />

      <h1 className="pe-title">ESTIMATE</h1>

      <div className="pe-meta">
        <dl className="pe-meta-left">
          <dt>Est No. :</dt><dd><strong>{est.number || "—"}</strong></dd>
          <dt>Date :</dt><dd><strong>{dmy(est.issueDate)}</strong></dd>
          <dt>Job No. :</dt><dd>{job?.number ?? ""}</dd>
          <dt>Date :</dt><dd>{dmy(job?.startDate ?? "")}</dd>
          <dt>Job Type :</dt><dd className="span3">{est.jobType ?? ""}</dd>
          <dt>Product :</dt><dd className="span3">{product}</dd>
        </dl>
        <dl className="pe-meta-right">
          <dt>To:</dt>
          <dd>
            <strong>{client?.name}</strong>
            {(est.clientAddress ?? client?.address) && <strong className="pe-to-address">{(est.clientAddress ?? client?.address ?? "").trim()}</strong>}
          </dd>
          {client?.taxId && <><dt>GSTIN:</dt><dd>{client.taxId}</dd></>}
          {client?.pan && <><dt>PAN No.:</dt><dd>{client.pan}</dd></>}
        </dl>
      </div>

      {est.header && <RichTextView html={est.header} className="pe-rich" />}

      <table className="pe-table">
        <thead>
          <tr><th className="pe-sl">Sl. No.</th><th>Description</th><th className="pe-amt">Amount({fmt.currency})</th></tr>
        </thead>
        <tbody>
          {est.items.map((it: LineItem, i) => (
            <tr key={it.id}>
              <td className="pe-sl">{i + 1}</td>
              <td>
                <Description text={it.description} />
                {Number(it.quantity) !== 1 && (
                  <div className="pe-qty">{it.quantity} × {amt(it.rate, fmt.locale)}</div>
                )}
              </td>
              <td className="pe-amt">{amt(it.quantity * it.rate, fmt.locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <EstimateTotals est={est} />

      {est.remarks && <RichTextView html={est.remarks} className="pe-rich" />}

      <SignatureBlock />

      <EstimateFooter />
    </article>
  );
}

/** Totals with amount in words: Total, discount, SGST/CGST or IGST, round off, grand total. */
export function EstimateTotals({ est }: { est: Estimate }) {
  const { data } = useStore();
  const s = data.settings;
  const client = data.clients.find((c) => c.id === est.clientId);
  const fmt = docFormat(est.country, s);
  const t = invoiceTotals(est);
  const split = gstSplit(gstState(s.taxId, s.stateCode), client?.taxId, est.taxRate);
  const half = est.taxRate / 2;
  return (
    <div className="pe-totals">
      <div className="pe-words">Amount in Words: {amountInWords(t.total, fmt.currency)}</div>
      <dl>
        <dt>Total:</dt><dd>{amt(t.subtotal, fmt.locale)}</dd>
        {t.discount > 0 && (
          <>
            <dt>Discount{est.discountPct ? ` (${est.discountPct}%)` : ""}:</dt><dd>-{amt(t.discount, fmt.locale)}</dd>
            <dt>Taxable Value:</dt><dd>{amt(t.net, fmt.locale)}</dd>
          </>
        )}
        {split === "cgst" && (
          <>
            <dt>SGST ({half}%):</dt><dd>{amt(t.tax / 2, fmt.locale)}</dd>
            <dt>CGST ({half}%):</dt><dd>{amt(t.tax / 2, fmt.locale)}</dd>
          </>
        )}
        {split === "igst" && (<><dt>IGST ({est.taxRate}%):</dt><dd>{amt(t.tax, fmt.locale)}</dd></>)}
        <dt>Round Off:</dt><dd>{amt(t.roundOff, fmt.locale)}</dd>
        <dt className="pe-grand">Grand Total:</dt><dd className="pe-grand">{amt(t.total, fmt.locale)}</dd>
      </dl>
    </div>
  );
}
