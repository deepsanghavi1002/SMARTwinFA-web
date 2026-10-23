"use client";

import { useCallback, useEffect, useState } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import { useWindowCloser } from "../ui/activeWindow";
import { Icon } from "../ui/Icon";
import { messageBox } from "../ui/MessageBox";

/**
 * UTILITY > Transfer Balance (Utility_Transferbal.cs): the open year and the previous year of the same company, twelve choices (what to carry over from the
 * previous year, and what to ignore) and Ok, which asks once (and for the transfer password, as the desktop does except for licence 3), then runs
 * SP_TRANSFER_DATA on the server and closes the window as the desktop does. Ok stays off when the company has no previous year to transfer from.
 */

const CHOICES = [
  ["account", "Account Opening", "Opening balances of the accounts from the closing of the previous year."],
  ["product", "Product Opening", "Opening stock of the products from the closing of the previous year."],
  ["addonOpening", "Addon Opening", "Opening of the addon masters."],
  ["outclear", "Outstanding", "Pending bills of customers and suppliers carried into this year."],
  ["lyAddon", "Last Year Addon Copy", "Addon masters that exist only in the previous year are copied."],
  ["lyAccount", "Last Year Account Copy", "Accounts that exist only in the previous year are copied, with their addresses and balances."],
  ["lyProduct", "Last Year Product Copy", "Products that exist only in the previous year are copied, with their balances."],
  ["pendReco", "Pending Reconciliation", "Bank entries not yet reconciled are carried over."],
  ["pendOrder", "Pending Order", "Orders with a quantity still to be supplied are carried over."],
  ["osOnAccountClear", "On A/c Outstanding Clear", "Older bills are cleared against the opening balance of the account."],
  ["ignoreAccountManual", "Ignore Account Manual Opening", "Opening balances typed by hand are replaced too."],
  ["ignoreProductManual", "Ignore Product Manual Opening", "Opening stock typed by hand is replaced too."],
] as const;
type Choice = (typeof CHOICES)[number][0];

type Info = { found: boolean; message: string; from: string; to: string; prevFrom: string; prevTo: string; passwordRequired: boolean };

const show = (iso: string) => {
  if (!iso) return "";
  const [year, month, day] = iso.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day}/${names[Number(month) - 1] ?? month}/${year}`;
};

export function TransferBalance({ menuShortName, title, onClose }: { menuShortName: string; title: string; onClose: () => void }) {
  const selection = useStartupSelection();
  const [picked, setPicked] = useState<Record<Choice, boolean>>({
    account: true, product: true, addonOpening: false, outclear: true, lyAddon: false, lyAccount: false, lyProduct: false, pendReco: false, pendOrder: false, osOnAccountClear: false, ignoreAccountManual: false, ignoreProductManual: false,
  });
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const session = selection ? { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName } : null;

  useEffect(() => {
    if (!session) return;
    let live = true;
    void (async () => {
      try {
        const response = await fetch("/api/utility/transfer", { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify({ menuShortName, info: true, session }) });
        const body = await response.json() as Info & { error?: string };
        if (!live) return;
        if (!response.ok) setProblem(body.error || "The request failed");
        else setInfo(body);
      } catch (reason) {
        if (live) setProblem(reason instanceof Error ? reason.message : "The request failed");
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.companyId, selection?.yearKey, selection?.loginName, menuShortName]);

  const quit = useCallback(async () => {
    if (busy) return;
    if (await messageBox.confirm("Are You Sure Want To Quit ?", "Transfer Balance Quit")) onClose();
  }, [busy, onClose]);
  useWindowCloser(quit);

  const transfer = async () => {
    if (busy || !session || !info?.found) return;
    if (!(await messageBox.confirm("Are You Sure Want To Transfer Data ?", "Transfer Balance"))) return;
    let password = "";
    if (info.passwordRequired) {
      const typed = await messageBox.prompt("Enter Password", "Transfer Balance", { password: true });
      if (typed === null) return;
      password = typed;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/utility/transfer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ menuShortName, ...picked, password, session }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "The request failed");
      setBusy(false);
      await messageBox.alert("Transfer Balance Completed Successfully.", "Transfer Balance", "info");
      onClose();
    } catch (reason) {
      setBusy(false);
      await messageBox.alert(reason instanceof Error ? reason.message : "The request failed", "Transfer Balance", "error");
    }
  };

  // While it runs nothing else may be used: the overlay below takes every click (menus included), and the browser warns before the page is left.
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const count = CHOICES.filter(([key]) => picked[key]).length;
  const ready = info?.found === true;
  return (
    <div className="mp-screen rpd-screen" role="region" aria-label={title}>
      {busy && (
        <div className="rpd-block" role="alertdialog" aria-modal="true" aria-label="Transferring balance">
          <div className="rpd-block-box"><span className="rpd-spin rpd-spin-big" aria-hidden="true" /><b>Transferring balance…</b><small>Please wait. Nothing else can be used until it finishes.</small></div>
        </div>
      )}
      <div className={`rpd-card${busy ? " rpd-busy" : ""}`} aria-busy={busy}>
        {busy && <div className="rpd-bar" role="progressbar" aria-label="Transferring balance" />}
        <header className="rpd-head">
          <span className="rpd-icon" aria-hidden="true"><Icon name="refresh" /></span>
          <div><h2>Transfer Balance</h2><p>Carry the closing balances of the previous year into the open year.</p></div>
        </header>
        <dl className="trb-years">
          <div><dt>This year</dt><dd>{info ? `${show(info.from)} to ${show(info.to)}` : "…"}</dd></div>
          <div><dt>Previous year</dt><dd>{info?.found ? `${show(info.prevFrom)} to ${show(info.prevTo)}` : "—"}</dd></div>
        </dl>
        {(problem || (info && !info.found)) && <p className="trb-problem" role="alert">{problem || info?.message}</p>}
        <ul className="rpd-list">
          {CHOICES.map(([key, label, note]) => (
            <li key={key}>
              <label className={`rpd-option${picked[key] ? " rpd-on" : ""}`}>
                <input type="checkbox" checked={picked[key]} disabled={busy} onChange={(event) => setPicked((now) => ({ ...now, [key]: event.target.checked }))} />
                <span className="rpd-switch" aria-hidden="true" />
                <span className="rpd-text"><b>{label}</b><small>{note}</small></span>
              </label>
            </li>
          ))}
        </ul>
        <footer className="rpd-foot">
          <span className="rpd-note">{busy ? <><span className="rpd-spin" aria-hidden="true" />Transferring balance, please wait…</> : `${count} of ${CHOICES.length} selected`}</span>
          <button type="button" className="rpd-btn rpd-quit" disabled={busy} onClick={() => void quit()}><Icon name="quit" />Quit</button>
          <button type="button" className="rpd-btn rpd-ok" disabled={busy || !ready || count === 0} onClick={() => void transfer()}>{busy ? <span className="rpd-spin rpd-spin-white" aria-hidden="true" /> : <Icon name="save" />}Ok</button>
        </footer>
      </div>
    </div>
  );
}
