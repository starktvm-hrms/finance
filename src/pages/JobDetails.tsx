import { Suspense, lazy, useRef, useState } from "react";
import { ESTIMATE_TYPES, type Estimate, type Project } from "../types";
import { useStore } from "../lib/store";
import { getAdapter } from "../lib/adapter";
import { go } from "../lib/route";
import { jobCategory } from "../lib/doctype";
import { jobTimeline, personName, stamp } from "../lib/timeline";
import { invoiceTotals, money, today, uid } from "../lib/util";
import { RichTextView, isEmpty } from "../components/SafeHtml";
import { Badge, Empty } from "../components/ui";
import { PROJECT_STATUS } from "./Projects";

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
  const [error, setError] = useState("");
  const financeDept = data.departments.find((d) => /finance/i.test(d.name));
  const [forwardTo, setForwardTo] = useState(financeDept?.id ?? "");
  const fileInput = useRef<HTMLInputElement>(null);

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
  const forward = () => {
    if (!forwardTo) return;
    upsert("projects", { ...job, forwards: [...(job.forwards ?? []), { departmentId: forwardTo, by: myName, at: now() }] });
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
    if (!est) return { title: "Create New Estimate", actions: createBtn, forward: true };
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
    if (est.status === "approved")
      return { title: `Estimate ${est.number} approved: raise the invoice`, actions: can("invoices") && can("estimates") && <button className="btn primary" onClick={() => go("estimates", { open: est.id })}>Raise invoice</button> };
    if (invoice && invoice.status === "draft")
      return { title: `Invoice ${invoice.number} is a draft: send it to the client`, actions: can("invoices") && <button className="btn primary" onClick={() => go("invoices", { open: invoice.id })}>Open invoice</button> };
    if (invoice && invoice.status === "sent")
      return { title: `Collect payment for invoice ${invoice.number}`, actions: can("invoices") && <button className="btn primary" onClick={() => go("invoices", { open: invoice.id })}>Open invoice</button> };
    if (job.status !== "completed")
      return { title: "Invoice paid: close the job", actions: can("jobs") && <button className="btn good-fill" onClick={() => setJobStatus("completed")}>Mark job completed</button> };
    return { title: "Job completed" };
  })();
  const canForward = next.forward && can("jobs") && data.departments.length > 0;

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
        await files.upload(job.id, f);
      } catch (e) {
        setError(`${f.name}: ${(e as Error).message}`);
      }
    }
    setBusy("");
    if (fileInput.current) fileInput.current.value = "";
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
                {canForward && (
                  <div className="row gap wrap tl-actions">
                    <select aria-label="Forward to department" value={forwardTo} onChange={(e) => setForwardTo(e.target.value)}>
                      <option value="" disabled>Forward to…</option>
                      {data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    <button className="btn" disabled={!forwardTo} onClick={forward}>Forward</button>
                  </div>
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
                  <a href={files?.url(a.id)} download={a.name}>{a.name}</a>
                  <span className="muted small">{fmtSize(a.size)} · {personName(data, a.createdBy, a.createdById) || "—"} · {stamp(a.createdAt).date}</span>
                  {(access.admin || (!!user && a.createdBy === user)) && files && <button className="btn ghost danger" onClick={() => deleteFile(a.id, a.name)}>Delete</button>}
                </li>
              ))}
            </ul>
          )}
          {files ? (
            <>
              <input ref={fileInput} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
              <button className="btn primary" disabled={!!busy} onClick={() => fileInput.current?.click()}>{busy || "Upload Files"}</button>
              <span className="muted small"> Up to 10 MB each.</span>
            </>
          ) : (
            <p className="muted small">File uploads work on the live site, where files are stored on the server.</p>
          )}
        </section>
      </div>
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
