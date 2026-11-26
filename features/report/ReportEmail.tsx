"use client";

import { useCallback, useEffect, useState } from "react";
import { messageBox } from "../ui/MessageBox";

/**
 * Email for one saved view: format, recipients, Send Now and this user's own sends. The server checks the rights and the addresses again;
 * the mail goes out from the company's sender through the mailer program.
 */

export type EmailCall = <T>(action: string, payload?: Record<string, unknown>) => Promise<T>;

type Job = Readonly<{ id: number; name: string; status: string; queuedAt: string; finishedAt: string | null; error: string; recipients: string[]; format: string }>;
type State = Readonly<{ ownEmail: string | null; approved: string[]; canApprove: boolean; mailerRunning: boolean; history: Job[] }>;
type View = Readonly<{ from: string; upto: string; needsPassword: boolean }>;

const STATUS: Readonly<Record<string, string>> = { queued: "Waiting", running: "Sending", sent: "Sent", failed: "Failed", unknown: "Check inbox" };
const REFRESH_MS = 5000;

const messageOf = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));

export function ReportEmail({ viewName, call, onBack }: { viewName: string; call: EmailCall; onBack: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [format, setFormat] = useState<"pdf" | "xlsx">("pdf");
  const [recipients, setRecipients] = useState("");
  const [approve, setApprove] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const found = await call<View>("view", { viewName });
        const now = await call<State>("state");
        if (!live) return;
        setView(found);
        setState(now);
        setRecipients(now.ownEmail ?? "");
      } catch (failure) {
        if (live) setError(messageOf(failure));
      }
    })();
    return () => { live = false; };
  }, [call, viewName]);

  const waiting = state?.history.some((job) => job.status === "queued" || job.status === "running") ?? false;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => { call<State>("state").then(setState).catch((failure) => setError(messageOf(failure))); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [waiting, call]);

  const run = useCallback(async (action: string, payload: Record<string, unknown>) => {
    setBusy(true);
    try { setState(await call<State>(action, payload)); setError(""); return true; } catch (failure) { setError(messageOf(failure)); return false; } finally { setBusy(false); }
  }, [call]);

  const send = async () => {
    if (!view) return;
    let password = "";
    if (view.needsPassword) {
      const typed = await messageBox.prompt("Enter Module Password", "Module Password", { password: true });
      if (typed === null) return;
      password = typed;
    }
    const to = recipients.split(/[\s,;]+/).filter(Boolean);
    if (!(await messageBox.confirm(`Email the view "${viewName}"\nfor ${view.from} to ${view.upto}\nas ${format === "pdf" ? "PDF" : "Excel"} to:\n${to.join("\n") || "(no address)"}`, "Send Now"))) return;
    await run("send", { viewName, format, recipients: to, password });
  };

  return (
    <div className="rp-mail">
      <button type="button" className="mp-btn" onClick={onBack}>← Back to views</button>
      <p className="rp-chart-note"><b>Email: {viewName}</b>{view ? ` · ${view.from} to ${view.upto} (the dates saved in the view)` : ""}</p>
      {error && <p className="rp-compare-error" role="alert">{error}</p>}
      {!state || !view ? (!error && <p className="rp-chart-note">Loading…</p>) : (
        <>
          <div className="rp-mail-row" role="radiogroup" aria-label="File type">
            <label><input type="radio" name="mail-format" checked={format === "pdf"} onChange={() => setFormat("pdf")} /> PDF</label>
            <label><input type="radio" name="mail-format" checked={format === "xlsx"} onChange={() => setFormat("xlsx")} /> Excel</label>
          </div>
          <label className="rp-mail-field">Send to
            <input type="text" value={recipients} onChange={(event) => setRecipients(event.target.value)} placeholder="name@example.com, another@example.com" />
          </label>
          <p className="rp-chart-note">
            {state.ownEmail || state.approved.length > 0 ? `Allowed: ${[...new Set([...(state.ownEmail ? [state.ownEmail] : []), ...state.approved])].join(", ")}` : "No address is allowed yet: your user has no email saved and the admin has approved none."}
          </p>
          {!state.mailerRunning && <p className="rp-compare-error">The mailer program is not running, so the email will wait until it starts.</p>}
          <button type="button" className="mp-btn mp-btn-green" disabled={busy} onClick={() => void send()}>Send Now</button>
          <p className="rp-chart-note">The file has the report&apos;s own columns. Filters, column changes and added columns on screen are not included.</p>

          <b className="rp-mail-head">My sends</b>
          {state.history.length === 0 ? <p className="rp-chart-empty">Nothing sent yet.</p> : (
            <ul className="rp-mail-history">
              {state.history.map((job) => (
                <li key={job.id}>
                  <span><b>{STATUS[job.status] ?? job.status}</b> · {job.name} · {job.format === "pdf" ? "PDF" : "Excel"} · {new Date(job.finishedAt ?? job.queuedAt).toLocaleString("en-IN")}</span>
                  <small>{job.recipients.join(", ")}</small>
                  {job.error && <small className="rp-compare-error">{job.error}</small>}
                </li>
              ))}
            </ul>
          )}

          {state.canApprove && (
            <>
              <b className="rp-mail-head">Approved addresses (admin)</b>
              <div className="rp-mail-row">
                <input type="email" value={approve} onChange={(event) => setApprove(event.target.value)} placeholder="Address to approve" aria-label="Address to approve" />
                <button type="button" className="mp-btn" disabled={busy || approve.trim() === ""} onClick={() => void run("approve", { address: approve }).then((done) => { if (done) setApprove(""); })}>Approve</button>
              </div>
              <ul className="rp-views-list">
                {state.approved.map((address) => (
                  <li key={address}>
                    <span className="rp-mail-address">{address}</span>
                    <button type="button" className="rp-views-del" disabled={busy} onClick={() => void run("unapprove", { address })} aria-label={`Remove ${address}`}>×</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
