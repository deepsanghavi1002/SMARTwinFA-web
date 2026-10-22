"use client";

import { useCallback, useEffect, useState } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import { useWindowCloser } from "../ui/activeWindow";
import { Icon } from "../ui/Icon";
import { messageBox } from "../ui/MessageBox";

/**
 * UTILITY > Re-Post Data (Utility_Repostdata.cs): five choices (Account Posting, Outstanding Posting, Product Entry - Conversion Recalc, Product
 * Posting, Verify Data; the first, second and fourth ticked as the desktop opens it) and Ok, which asks once and runs SP_REPOST_DATA for the open
 * company and year on the server, then closes the window as the desktop does.
 */

const CHOICES = [
  ["account", "Account Posting", "Account balances and the ledger posting of the year, again from the entries."],
  ["outstanding", "Outstanding Posting", "The bill-wise outstanding of customers and suppliers, with receipts and payments set off."],
  ["productRecalc", "Product Entry - Conversion Recalc", "Product names, levels and godown rows recalculated; entries of deleted vouchers cleared."],
  ["product", "Product Posting", "Product opening, receipt, issue and closing quantities of the year."],
  ["verify", "Verify Data", "Indexes rebuilt and the addon texts and keys made to agree."],
] as const;
type Choice = (typeof CHOICES)[number][0];

export function RepostData({ menuShortName, title, onClose }: { menuShortName: string; title: string; onClose: () => void }) {
  const selection = useStartupSelection();
  const [picked, setPicked] = useState<Record<Choice, boolean>>({ account: true, outstanding: true, productRecalc: false, product: true, verify: false });
  const [busy, setBusy] = useState(false);

  const quit = useCallback(async () => {
    if (busy) return;
    if (await messageBox.confirm("Are You Sure Want To Quit ?", "Re-Post Quit")) onClose();
  }, [busy, onClose]);
  useWindowCloser(quit);

  const post = async () => {
    if (busy || !selection) return;
    if (!(await messageBox.confirm("Are You Sure Want To Re-Post Data ?", "Re-Post"))) return;
    setBusy(true);
    try {
      const response = await fetch("/api/utility/repost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ menuShortName, ...picked, session: { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName } }),
      });
      const body = await response.json() as { primaryId?: number; error?: string };
      if (!response.ok) throw new Error(body.error || "The request failed");
      setBusy(false);
      await messageBox.alert("Re-Post Data Completed Successfully.", "Re-Post", "info");
      onClose();
    } catch (reason) {
      setBusy(false);
      await messageBox.alert(reason instanceof Error ? reason.message : "The request failed", "Re-Post Data", "error");
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
  return (
    <div className="mp-screen rpd-screen" role="region" aria-label={title}>
      {busy && (
        <div className="rpd-block" role="alertdialog" aria-modal="true" aria-label="Re-posting data">
          <div className="rpd-block-box"><span className="rpd-spin rpd-spin-big" aria-hidden="true" /><b>Re-posting data…</b><small>Please wait. Nothing else can be used until it finishes.</small></div>
        </div>
      )}
      <div className={`rpd-card${busy ? " rpd-busy" : ""}`} aria-busy={busy}>
        {busy && <div className="rpd-bar" role="progressbar" aria-label="Re-posting data" />}
        <header className="rpd-head">
          <span className="rpd-icon" aria-hidden="true"><Icon name="refresh" /></span>
          <div><h2>Re-Post Data</h2><p>Rebuild the balances and postings of the open year from the entries.</p></div>
        </header>
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
          <span className="rpd-note">{busy ? <><span className="rpd-spin" aria-hidden="true" />Re-posting data, please wait…</> : `${count} of ${CHOICES.length} selected`}</span>
          <button type="button" className="rpd-btn rpd-quit" disabled={busy} onClick={() => void quit()}><Icon name="quit" />Quit</button>
          <button type="button" className="rpd-btn rpd-ok" disabled={busy || count === 0} onClick={() => void post()}>{busy ? <span className="rpd-spin rpd-spin-white" aria-hidden="true" /> : <Icon name="save" />}Ok</button>
        </footer>
      </div>
    </div>
  );
}
