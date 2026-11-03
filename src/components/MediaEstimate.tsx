import { useEffect } from "react";
import type { Estimate } from "../types";
import { useStore } from "../lib/store";
import { docFormat } from "../lib/util";
import { RichTextView } from "./SafeHtml";
import { Description, EstimateFooter, EstimateTotals, Letterhead, SignatureBlock, dmyDate, plainAmount } from "./ProductionEstimate";

/** While a media estimate is on screen, printing uses A4 landscape. */
export function useLandscapePrint() {
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-print", "landscape");
    style.textContent = "@media print { @page { size: A4 landscape; } }";
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
}

/**
 * Printable media estimate (A4 landscape), laid out like the agency's format:
 * the letterhead repeats on every page, and each line shows the platform with
 * quantity, unit and amount, then the work description underneath.
 */
export default function MediaEstimate({ est }: { est: Estimate }) {
  useLandscapePrint();
  const { data } = useStore();
  const s = data.settings;
  const client = data.clients.find((c) => c.id === est.clientId);
  const job = data.projects.find((p) => p.id === est.projectId);
  const fmt = docFormat(est.country, s);
  const product = est.productLabel || [job?.product, job?.subProduct].filter(Boolean).join(" ") || est.title || "";
  const address = (est.clientAddress ?? client?.address ?? "").trim();

  return (
    <article className="pe-doc me-doc print-area" aria-label={`Media estimate ${est.number}`}>
      <table className="me-page">
        <thead>
          <tr><td><Letterhead /></td></tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <h1 className="pe-title">MEDIA ESTIMATE</h1>

              <div className="me-meta">
                <span className="l">Est No. :</span><strong className="v">{est.number || "—"}</strong>
                <span className="l2">Date :</span><strong className="v2">{dmyDate(est.issueDate)}</strong>
                <span className="lt">To:</span>
                <span className="vt">
                  <strong>{client?.name}</strong>
                  {address && <strong className="pe-to-address">{address}</strong>}
                </span>

                <span className="l">Job No. :</span><span className="v">{job?.number ?? ""}</span>
                <span className="l2">Date :</span><span className="v2">{dmyDate(job?.startDate ?? "")}</span>
                <span className="lt">GSTIN:</span><span className="vt">{client?.taxId ?? ""}</span>

                <span className="l">Job Type :</span><span className="v wide">{est.jobType ?? ""}</span>
                <span className="lt">PAN No.:</span><span className="vt">{client?.pan ?? ""}</span>

                <span className="l">Product :</span><span className="v wide">{product}</span>
              </div>

              {est.header && <RichTextView html={est.header} className="pe-rich" />}

              <table className="me-table">
                <thead>
                  <tr>
                    <th className="me-sl">Sl. No.</th><th>Platform</th><th className="me-q">Quantity</th><th className="me-u">Unit</th>
                    <th className="pe-amt">Amount({fmt.currency})</th>
                  </tr>
                </thead>
                {est.items.map((it, i) => (
                  <tbody key={it.id} className="me-item">
                    <tr>
                      <td className="me-sl">{i + 1}</td>
                      <td>{it.platform ?? ""}</td>
                      <td className="me-q">{it.quantity}</td>
                      <td className="me-u">{it.unit || "1"}</td>
                      <td className="pe-amt">{plainAmount(it.quantity * it.rate, fmt.locale)}</td>
                    </tr>
                    <tr>
                      <td />
                      <td colSpan={3} className="me-desc"><Description text={it.description} /></td>
                      <td />
                    </tr>
                  </tbody>
                ))}
              </table>

              {est.remarks && <RichTextView html={est.remarks} className="pe-rich me-note" />}

              <div className="me-closing">
                <EstimateTotals est={est} />
                <SignatureBlock />
                <EstimateFooter />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  );
}
