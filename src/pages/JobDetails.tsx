import { Suspense, lazy, useRef, useState } from "react";
import { ESTIMATE_TYPES, type Estimate, type Project } from "../types";
import { useStore } from "../lib/store";
import { getAdapter } from "../lib/adapter";
import { go } from "../lib/route";
import { jobCategory } from "../lib/doctype";
import { jobTimeline, personName, stamp } from "../lib/timeline";
import { invoiceTotals, money, today, uid } from "../lib/util";
import { RichTextView, isEmpty } from "../components/SafeHtml";
import { Badge, Empty, Field, Modal } from "../components/ui";
import { PROJECT_STATUS, headLabel } from "./Projects";
import { docChecklist, jobStage, openInvoiceRequests, requiredDocs } from "../lib/workflow";
import { BillingLine, PartInvoice, useCreateInvoice } from "../components/Billing";
import { estimateBilling } from "../lib/billing";

// The rich-text editor (Quill) is only downloaded when a job is opened.
const LazyEditor = lazy(() => import("../components/RichText"));
const files = getAdapter().files;

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export default function JobDetails({ id }: { id: string }) {
  const { data, upsert, remove, can, access, user, myName, refresh } = useStore();
  const s = data.settings;
  const job = data.projects.find((p) => p.id === id);
  const [msg, setMsg] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [partOf, setPartOf] = useState<Estimate | null>(null);
  const createInvoice = useCreateInvoice();
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadKind, setUploadKind] = useState("");
  const [askInvoice, setAskInvoice] = useState<{ kind: "full" | "part"; note: string } | null>(null);
  const [headPick, setHeadPick] = useState("");

  if (!job) {
    return (
      <div className="page">
        <BackHeader />
        <div className="card"><Empty>This job doesn't exist any more, or you don't have access to it.</Empty></div>
      </div>
    );
  }

  const clientName = data.clients.find((c) => c.id === job.clientId)?.name ?? "—";
  const estimates = data.estimates.filter((e) => e.projectId === job.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const est = estimates.find((e) => e.status !== "rejected");
  const invoices = data.invoices.filter((i) => i.projectId === job.id);
  const invoice = (est && invoices.find((i) => i.id === est.invoiceId)) || invoices[0];
  const payments = data.payments.filter((p) => p.projectId === job.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Part payments are usually against the invoice that is later marked paid, so don't add the two.
  const received = Math.max(payments.reduce((t, p) => t + p.amount, 0), invoices.filter((i) => i.status === "paid").reduce((t, i) => t + invoiceTotals(i).total, 0));
  const billed = invoices.filter((i) => i.status !== "draft" && i.status !== "cancelled").reduce((t, i) => t + invoiceTotals(i).total, 0);
  const messages = data.messages.filter((m) => m.projectId === job.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const attachments = data.attachments.filter((a) => a.projectId === job.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const now = () => new Date().toISOString();

  const decideJob = (status: "approved" | "rejected") =>
    job.approval && upsert("projects", { ...job, approval: { ...job.approval, status, decidedDate: today(), decidedBy: myName, decidedAt: now() } });
  const clientApproved = (e: Estimate) => {
    upsert("estimates", { ...e, status: "approved", decidedDate: today(), decidedAt: now(), decidedBy: myName });
    if (can("jobs") && (job.status === "lead" || !job.budget))
      upsert("projects", { ...job, status: job.status === "lead" ? "active" : job.status, budget: job.budget || invoiceTotals(e).net });
    else if (job.status === "lead") window.setTimeout(refresh, 1500); // the server starts the job; pick that up
  };
  // Workflow: approval → documents → Finance → estimate → invoice request → invoice.
  const heads = [...new Set([...data.employees.filter((e) => e.isHead && e.active).map((e) => headLabel(data, e)), ...s.departmentHeads.filter(Boolean)])];
  const sendForApproval = () => {
    if (!headPick) return;
    const headEmp = data.employees.find((e) => e.isHead && headLabel(data, e) === headPick);
    upsert("projects", { ...job, approval: { head: headPick, ...(headEmp && { headId: headEmp.id }), status: "pending", decidedDate: "", askedBy: myName, askedAt: now() } });
  };
  const checklist = docChecklist(data, job);
  const docsReady = checklist.every((d) => d.files.length > 0);
  const forwardToFinance = () => docsReady && upsert("projects", { ...job, financeForward: { by: myName, at: now(), docs: checklist.map((d) => d.name) } });
  const openReqs = openInvoiceRequests(data, job);
  const requestInvoice = (kind: "full" | "part", note: string) =>
    upsert("projects", { ...job, invoiceRequests: [...(job.invoiceRequests ?? []), { id: uid(), kind, note: note.trim(), by: myName, byUser: user ?? undefined, at: now() }] });
  /** Open the file picker for one document type. */
  const pickFile = (kind: string) => {
    setUploadKind(kind);
    window.setTimeout(() => fileInput.current?.click(), 0);
  };
  const setJobStatus = (status: Project["status"]) => upsert("projects", { ...job, status });

  // What to do next, from where the job is in its life.
  const next = (() => {
    const createBtn = can("estimates") && <button className="btn good-fill" onClick={() => go("estimates", { new: job.id })}>Create Estimate</button>;
    if (job.status === "cancelled") return { title: "Job cancelled" };
    if (job.approval?.status === "pending")
      return {
        title: `Waiting for ${job.approval.head} to approve the job`,
        actions: can("jobs") && <>
          <button className="btn good-fill" onClick={() => decideJob("approved")}>Approve</button>
          <button className="btn danger" onClick={() => decideJob("rejected")}>Reject</button>
        </>,
      };
    if (job.approval?.status === "rejected")
      return { title: `${job.approval.decidedBy || job.approval.head} rejected the job`, actions: can("jobs") && <button className="btn" onClick={() => go("projects", { edit: job.id })}>Edit and ask again</button> };
    if (!est) {
      if (!job.approval)
        return {
          title: "Send the job to a department head for approval",
          actions: can("jobs") && <>
            <select aria-label="Department head" value={headPick} onChange={(e) => setHeadPick(e.target.value)}>
              <option value="">{heads.length ? "Choose the department head…" : "Tick “Department head” on employees first"}</option>
              {heads.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
            <button className="btn primary" disabled={!headPick} onClick={sendForApproval}>Send for approval</button>
          </>,
        };
      if (!job.financeForward)
        return can("jobs")
          ? {
              title: docsReady ? "Approved: forward the job to Finance" : "Approved: upload the documents, then forward the job to Finance",
              checklist: true,
              actions: <button className="btn good-fill" disabled={!docsReady} onClick={forwardToFinance} title={docsReady ? "" : "Upload every document in the list first"}>Forward to Finance</button>,
            }
          : { title: "Approved: waiting for the AE to forward the job to Finance with the documents", checklist: true };
      return { title: can("estimates") ? `${job.financeForward.by} forwarded the job to Finance: create the estimate` : "With Finance: waiting for the estimate", actions: createBtn };
    }
    if (est.status === "draft")
      return { title: `Estimate ${est.number} is a draft: send it to the client`, actions: <>
        {can("estimates") && <button className="btn primary" onClick={() => go("estimates", { open: est.id })}>Open estimate</button>}
        {can("estimates") && <button className="btn good-fill" onClick={() => clientApproved(est)}>Client Approved</button>}
      </> };
    if (est.status === "sent")
      return { title: "Create New Estimate or Approve Estimate", actions: <>
        {can("estimates") && <button className="btn good-fill" onClick={() => clientApproved(est)}>Client Approved</button>}
        {createBtn}
      </> };
    if (est.status === "approved") {
      const started = estimateBilling(data, est).started;
      const raise = can("invoices") && can("estimates") && <>
        <button className="btn primary" onClick={() => setPartOf(est)}>Part invoice</button>
        <button className="btn good-fill" onClick={() => createInvoice(est, "full")}>{started ? "Balance invoice" : "Full invoice"}</button>
      </>;
      const r = openReqs[openReqs.length - 1];
      if (r)
        return {
          title: `${r.by} requested ${r.kind === "part" ? "a part" : started ? "the balance" : "the"} invoice${r.note ? `: “${r.note}”` : ""}`,
          actions: raise || <span className="muted small">Waiting for Finance to raise the invoice.</span>,
          billing: est,
        };
      return {
        title: started ? `Estimate ${est.number} is part invoiced: request the next invoice when the work is done` : `Estimate ${est.number} approved: when the work is done, request the invoice`,
        actions: <>
          {can("jobs") && <button className="btn primary" onClick={() => setAskInvoice({ kind: "full", note: "" })}>Request invoice</button>}
          {raise}
        </>,
        billing: est,
      };
    }
    if (!invoice && est.status === "invoiced") {
      // Roles without the Invoices tab can't see the invoice itself.
      const done = [...(job.invoiceRequests ?? [])].reverse().find((r) => r.doneAt);
      return {
        title: `Finance has raised the invoice${done?.invoiceNumber ? ` ${done.invoiceNumber}` : ""}`,
        actions: can("jobs") && job.status !== "completed" && <button className="btn good-fill" onClick={() => setJobStatus("completed")}>Mark job completed</button>,
      };
    }
    if (invoice && invoice.status === "draft")
      return { title: `Invoice ${invoice.number} is a draft: send it to the client`, actions: can("invoices") && <button className="btn primary" onClick={() => go("invoices", { open: invoice.id })}>Open invoice</button> };
    if (invoice && invoice.status === "sent")
      return { title: `Collect payment for invoice ${invoice.number}`, actions: can("invoices") && <button className="btn primary" onClick={() => go("invoices", { open: invoice.id })}>Open invoice</button> };
    if (job.status !== "completed")
      return { title: "Invoice paid: close the job", actions: can("jobs") && <button className="btn good-fill" onClick={() => setJobStatus("completed")}>Mark job completed</button> };
    return { title: "Job completed" };
  })();

  const send = () => {
    if (isEmpty(msg)) return;
    upsert("messages", { id: uid(), projectId: job.id, html: msg, createdAt: now() });
    setMsg("");
    setEditorKey((k) => k + 1); // fresh, empty editor
  };

  const recordPayment = () => {
    const n = Number(amount);
    if (!(n > 0)) return;
    upsert("payments", { id: uid(), projectId: job.id, amount: n, date: today(), note: note.trim(), createdAt: now() });
    setAmount("");
    setNote("");
  };

  const upload = async (list: FileList | null) => {
    if (!files || !list?.length) return;
    setError("");
    for (const f of Array.from(list)) {
      if (f.size > files.maxBytes) {
        setError(`${f.name} is too big. Files can be up to 10 MB.`);
        continue;
      }
      setBusy(`Uploading ${f.name}…`);
      try {
        await files.upload(job.id, f, uploadKind || undefined);
      } catch (e) {
        setError(`${f.name}: ${(e as Error).message}`);
      }
    }
    setBusy("");
    if (fileInput.current) fileInput.current.value = "";
    setUploadKind("");
    refresh();
  };
  const deleteFile = async (fid: string, name: string) => {
    if (!files || !window.confirm(`Delete ${name}?`)) return;
    try {
      await files.remove(fid);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const timeline = jobTimeline(data, job);
  const product = [job.product, job.subProduct].filter(Boolean).join(" › ");
  const category = ESTIMATE_TYPES.find((t) => t.id === jobCategory(job, data.estimates))?.label;
  const dept = data.departments.find((d) => d.id === job.departmentId)?.name;
  const createdBy = personName(data, job.createdBy, job.createdById);

  return (
    <div className="page job-page">
      <BackHeader />
      <div className="job-grid">
        <section className="card job-info">
          <div className="row between">
            <h3>Job Details</h3>
            {can("jobs") && <button className="btn ghost" onClick={() => go("projects", { edit: job.id })}>Edit</button>}
          </div>
          <dl className="kv">
            <dt>Job Code:</dt><dd>{job.number || "—"}</dd>
            <dt>Title:</dt><dd>{job.name}</dd>
            {job.notes && <><dt>Description:</dt><dd className="pre">{job.notes}</dd></>}
            <dt>Client:</dt><dd>{clientName}</dd>
            {job.contactPerson && <><dt>Contact Person:</dt><dd>{job.contactPerson}</dd></>}
            {product && <><dt>Product:</dt><dd>{product}</dd></>}
            <dt>Category:</dt><dd>{category}</dd>
            {job.jobType && <><dt>Type:</dt><dd>{job.jobType}</dd></>}
            {dept && <><dt>Department:</dt><dd>{dept}</dd></>}
            <dt>Date:</dt><dd>{stamp(job.startDate).date}</dd>
            <dt>Status:</dt><dd><Badge tone={PROJECT_STATUS[job.status].tone}>{PROJECT_STATUS[job.status].label}</Badge></dd>
            <dt>Stage:</dt><dd><Badge tone={jobStage(data, job).tone}>{jobStage(data, job).label}</Badge></dd>
            {createdBy && <><dt>Created by:</dt><dd>{createdBy}</dd></>}
          </dl>
        </section>

        <section className="card job-status">
          <h3>Status</h3>
          <ol className="timeline">
            <li className="next">
              <span className="dot" />
              <div className="tl-body">
                <strong>{next.title}</strong>
                {next.actions && <div className="row gap wrap tl-actions">{next.actions}</div>}
                {"billing" in next && next.billing && <BillingLine est={next.billing} />}
                {"checklist" in next && next.checklist && (
                  <ul className="doc-check">
                    {checklist.map((d) => (
                      <li key={d.name} className={d.files.length ? "ok" : ""}>
                        <span className="doc-mark" aria-hidden>{d.files.length ? "✓" : "○"}</span>
                        <span><strong>{d.name}</strong> <span className="muted small">{d.files.length ? d.files.map((f) => f.name).join(", ") : "required"}</span></span>
                        {!d.files.length && can("jobs") && files && <button className="btn ghost small-btn" disabled={!!busy} onClick={() => pickFile(d.name)}>Upload</button>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
            {timeline.map((t, i) => {
              const st = stamp(t.at);
              return (
                <li key={i}>
                  <span className="dot" />
                  <div className="tl-body">
                    <strong>{t.text}</strong>
                    {t.note && <div className="muted small">{t.note}</div>}
                  </div>
                  <time className="tl-time" dateTime={t.at}>{st.date}{st.time && <span className="tl-hour">{st.time}</span>}</time>
                </li>
              );
            })}
          </ol>
        </section>

        {can("invoices") && (
          <section className="card job-pay">
            <h3>Part Payment</h3>
            <form className="pay-form" onSubmit={(e) => { e.preventDefault(); recordPayment(); }}>
              <label className="field"><span>Amount</span><input type="number" min={0} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
              <label className="field"><span>Note</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Cheque no., UTR…" /></label>
              <button className="btn primary">Received</button>
            </form>
            <div className="pay-sum small">
              <div className="row between"><span className="muted">Received</span><strong>{money(received, s)}</strong></div>
              {billed > 0 && <div className="row between"><span className="muted">Invoiced</span><span>{money(billed, s)}</span></div>}
              {billed > 0 && <div className="row between"><span className="muted">Balance</span><span className={billed - received > 0 ? "warn" : "good"}>{money(Math.max(0, billed - received), s)}</span></div>}
              {est && <div className="row between"><span className="muted">Estimate {est.number}</span><span>{money(invoiceTotals(est).total, s)}</span></div>}
            </div>
            {estimates.filter((e) => estimateBilling(data, e).invoices.length > 0).map((e) => (
              <div key={e.id} className="pay-est small"><span className="muted">Invoices for {e.number}</span><BillingLine est={e} /></div>
            ))}
            {payments.length > 0 && (
              <ul className="pay-list">
                {payments.map((p) => (
                  <li key={p.id}>
                    <div className="row between"><strong>{money(p.amount, s)}</strong><span className="muted small">{stamp(p.date).date}</span></div>
                    <div className="muted small">{[personName(data, p.createdBy, p.createdById), p.note].filter(Boolean).join(" · ")}
                      {access.admin && <button className="btn ghost danger small-btn" onClick={() => window.confirm("Delete this payment?") && remove("payments", p.id)}>Delete</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <div className="job-grid-2">
        <section className="card">
          <h3>Conversations</h3>
          {messages.length > 0 && (
            <ul className="messages">
              {messages.map((m) => {
                const st = stamp(m.createdAt);
                const mine = !!user && m.createdBy === user;
                return (
                  <li key={m.id} className={mine ? "mine" : ""}>
                    <div className="msg-head"><strong>{personName(data, m.createdBy, m.createdById) || "Someone"}</strong><span className="muted small">{st.date} {st.time}</span></div>
                    <RichTextView html={m.html} />
                  </li>
                );
              })}
            </ul>
          )}
          <Suspense fallback={<div className="rte rte-loading muted small">Loading editor…</div>}>
            <LazyEditor key={editorKey} value="" onChange={setMsg} label="Message" placeholder="Write a message about this job…" />
          </Suspense>
          <button className="btn primary send-btn" disabled={isEmpty(msg)} onClick={send}>Send</button>
        </section>

        <section className="card">
          <h3>Files</h3>
          {error && <div className="alert inline-alert">{error}</div>}
          {attachments.length === 0 ? <Empty>No uploads found</Empty> : (
            <ul className="files">
              {attachments.map((a) => (
                <li key={a.id}>
                  <a href={files?.url(a.id)} download={a.name}>{a.kind && <span className="doc-kind">{a.kind}</span>}{a.name}</a>
                  <span className="muted small">{fmtSize(a.size)} · {personName(data, a.createdBy, a.createdById) || "—"} · {stamp(a.createdAt).date}</span>
                  {(access.admin || (!!user && a.createdBy === user)) && files && <button className="btn ghost danger" onClick={() => deleteFile(a.id, a.name)}>Delete</button>}
                </li>
              ))}
            </ul>
          )}
          {files ? (
            <>
              <input ref={fileInput} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
              <select aria-label="Document type" className="doc-type" value={uploadKind} onChange={(e) => setUploadKind(e.target.value)}>
                <option value="">Other file</option>
                {requiredDocs(s).map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <button className="btn primary" disabled={!!busy} onClick={() => fileInput.current?.click()}>{busy || "Upload Files"}</button>
              <span className="muted small"> Up to 10 MB each.</span>
            </>
          ) : (
            <p className="muted small">File uploads work on the live site, where files are stored on the server.</p>
          )}
        </section>
      </div>
      {askInvoice && (
        <Modal title="Request the invoice from Finance" onClose={() => setAskInvoice(null)}>
          <form className="form" onSubmit={(e) => { e.preventDefault(); requestInvoice(askInvoice.kind, askInvoice.note); setAskInvoice(null); }}>
            <Field label="Invoice" span={2}>
              <select value={askInvoice.kind} onChange={(e) => setAskInvoice({ ...askInvoice, kind: e.target.value as "full" | "part" })}>
                <option value="full">{est && estimateBilling(data, est).started ? "The balance (work completed)" : "Full invoice (work completed)"}</option>
                <option value="part">A part invoice (part of the work done)</option>
              </select>
            </Field>
            <Field label={askInvoice.kind === "part" ? "Which part / how much *" : "Note for Finance"} span={2}>
              <textarea rows={3} required={askInvoice.kind === "part"} value={askInvoice.note} onChange={(e) => setAskInvoice({ ...askInvoice, note: e.target.value })} placeholder={askInvoice.kind === "part" ? "e.g. 50% on delivery of the first film" : "e.g. Campaign ran 16–25 Aug; client confirmed"} />
            </Field>
            <p className="muted small span2">Finance is notified and raises the invoice.</p>
            <div className="form-actions span2">
              <button type="button" className="btn" onClick={() => setAskInvoice(null)}>Cancel</button>
              <button className="btn primary">Send request</button>
            </div>
          </form>
        </Modal>
      )}
      {partOf && <PartInvoice est={partOf} onCancel={() => setPartOf(null)} onCreate={(amount, text) => { const e = partOf; setPartOf(null); createInvoice(e, { amount, text }); }} />}
    </div>
  );
}

function BackHeader() {
  return (
    <div className="page-head">
      <h1 className="back-title">
        <button className="icon-btn back-btn" aria-label="Back to jobs" onClick={() => (history.length > 1 ? history.back() : go("projects"))}>‹</button>
        Job Details
      </h1>
    </div>
  );
}
