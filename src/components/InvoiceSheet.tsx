import type { Invoice } from "../types";
import { useStore } from "../lib/store";
import { docFormat } from "../lib/util";
import { estimateType } from "../lib/doctype";
import { RichTextView } from "./SafeHtml";
import { useLandscapePrint } from "./MediaEstimate";
import { EstimateFooter, EstimateTotals, Letterhead, dmyDate, plainAmount } from "./ProductionEstimate";

/**
 * Printable TAX INVOICE (A4 landscape, black and white), laid out like the
 * agency's format: letterhead; Inv No. / AE No. / Job No. with their dates and
 * the client on the right; the lines; totals with GST and amount in words;
 * signatures; then a second page with the terms and bank details.
 */
export default function InvoiceSheet({ inv }: { inv: Invoice }) {
  useLandscapePrint();
  const { data } = useStore();
  const s = data.settings;
  const client = data.clients.find((c) => c.id === inv.clientId);
  const job = data.projects.find((p) => p.id === inv.projectId);
  const fmt = docFormat(inv.country, s);
  const media = estimateType(inv) === "media";
  const address = (inv.clientAddress ?? client?.address ?? "").trim();
  const product = inv.productLabel || [job?.product, job?.subProduct].filter(Boolean).join(" ") || inv.title || "";
  const signatures = (s.invoiceSignatureLabels || "Authorized Signatory, AE, AS, ME").split(",").map((x) => x.trim()).filter(Boolean);
  const lines = (d: string) => d.split("\n").map((l) => l.trim()).filter(Boolean);

  return (
    <article className="inv-doc print-area" aria-label={`Tax invoice ${inv.number}`}>
      <section className="inv-page">
        <Letterhead />
        <h1 className="inv-title">TAX INVOICE</h1>

        <div className="inv-meta">
          <dl className="inv-col">
            <dt>Inv No. :</dt><dd className="b">{inv.number}</dd>
            {/* AE No. and its date: reserved, details to follow */}
            <dt>AE No. :</dt><dd className="inv-blank">&nbsp;</dd>
            <dt>Job No. :</dt><dd>{job?.number ?? ""}</dd>
            <dt>Job Type :</dt><dd>{inv.jobType || job?.jobType || ""}</dd>
          </dl>
          <dl className="inv-col inv-dates">
            <dt>Date :</dt><dd className="b">{dmyDate(inv.issueDate)}</dd>
            <dt>Date :</dt><dd className="inv-blank">&nbsp;</dd>
            <dt>Date :</dt><dd>{job ? dmyDate(job.startDate) : ""}</dd>
          </dl>
          <dl className="inv-col inv-to">
            <dt>To,</dt>
            <dd className="b">
              {client?.name}
              {address && <div className="inv-addr">{address}</div>}
            </dd>
            {client?.taxId && <><dt>GSTIN:</dt><dd>{client.taxId}</dd></>}
            {client?.pan && <><dt>PAN No:</dt><dd>{client.pan}</dd></>}
          </dl>
          {product && (
            <dl className="inv-col inv-product">
              <dt>Product :</dt><dd>{product}</dd>
            </dl>
          )}
        </div>

        <RichTextView html={inv.header} className="inv-rich" />

        <table className="inv-table">
          <thead>
            {media ? (
              <tr>
                <th className="sl">Sl. No.</th><th>Channel</th><th>Beam/Region</th><th>Time Band</th><th>Spot Duration</th><th>Total Secondages</th>
                <th className="amt">Amount({fmt.currency})</th>
              </tr>
            ) : (
              <tr>
                <th className="sl">Sl. No.</th><th>Description</th><th className="num">Qty</th><th className="num">Rate</th>
                <th className="amt">Amount({fmt.currency})</th>
              </tr>
            )}
          </thead>
          <tbody>
            {inv.items.map((it, i) => {
              const sub = lines(it.description);
              return media ? (
                <tr key={it.id}>
                  <td className="sl">{i + 1}</td>
                  <td>
                    {it.platform || sub[0]}
                    {(it.platform ? sub : sub.slice(1)).map((l, k) => <div key={k} className="inv-sub">{l}</div>)}
                    {s.sacCode && <div className="inv-sub">SAC:{s.sacCode}</div>}
                  </td>
                  <td>{it.region}</td>
                  <td>{it.timeBand}</td>
                  <td>{it.unit}</td>
                  <td>{it.quantity !== 1 || !it.unit ? it.quantity : ""}</td>
                  <td className="amt">{plainAmount(it.quantity * it.rate, fmt.locale)}</td>
                </tr>
              ) : (
                <tr key={it.id}>
                  <td className="sl">{i + 1}</td>
                  <td>
                    {sub[0]}
                    {sub.slice(1).map((l, k) => <div key={k} className="inv-sub">{l}</div>)}
                    {s.sacCode && <div className="inv-sub">SAC:{s.sacCode}</div>}
                  </td>
                  <td className="num">{it.quantity}</td>
                  <td className="num">{plainAmount(it.rate, fmt.locale)}</td>
                  <td className="amt">{plainAmount(it.quantity * it.rate, fmt.locale)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="inv-totals">
          <EstimateTotals est={inv} />
        </div>
        <RichTextView html={inv.remarks} className="inv-rich" />

        <div className="inv-sign">
          {signatures.map((l) => <span key={l}>{l}</span>)}
        </div>
        <div className="inv-eoe">E &amp; OE</div>
      </section>

      <section className="inv-page inv-page-2">
        <Letterhead />
        <EstimateFooter kind="invoice" />
      </section>
    </article>
  );
}
