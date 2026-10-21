"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import { useWindowCloser } from "../ui/activeWindow";
import { Icon } from "../ui/Icon";
import { messageBox } from "../ui/MessageBox";
import type { GstDetail } from "../../lib/gst-check";

/**
 * UTILITY > Check Gst No Online (Utility_Check_Gstno.cs): type a GST number, Send looks it up at the e-invoice gateway (on the server, with the
 * company's own e-invoice login) and shows the trade name, legal name, address, state, pin code, tax payer type and status.
 */

const EMPTY: GstDetail = { name: "", legalName: "", address1: "", address2: "", address3: "", street: "", location: "", stateCode: "", pinCode: "", taxPayerType: "", status: "" };

const FIELDS: ReadonlyArray<readonly [keyof GstDetail, string]> = [
  ["name", "Name"], ["legalName", "Legal Name"], ["address1", "Address 1"], ["address2", "Address 2"], ["address3", "Address 3"], ["street", "Street"],
  ["location", "Location"], ["stateCode", "State Code"], ["pinCode", "Pin Code"], ["taxPayerType", "Tax Payer Type"], ["status", "Status"],
];

export function CheckGstNo({ menuShortName, title, onClose }: { menuShortName: string; title: string; onClose: () => void }) {
  const selection = useStartupSelection();
  const [gstNo, setGstNo] = useState("");
  const [detail, setDetail] = useState<GstDetail>(EMPTY);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => { box.current?.focus(); }, []);

  const quit = useCallback(async () => {
    if (await messageBox.confirm("Are You Sure Want To Quit ?", "Check Gst No Quit")) onClose();
  }, [onClose]);
  useWindowCloser(quit);

  const cancel = () => { setGstNo(""); setDetail(EMPTY); box.current?.focus(); };

  const send = async () => {
    if (busy || !selection) return;
    if (gstNo.trim() === "") {
      await messageBox.alert("Please Input GST NO For Get Detail....", "Online Check: GST Detail", "warning");
      box.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/gst-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ menuShortName, gstNo, session: { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName } }),
      });
      const body = await response.json() as { detail?: GstDetail; error?: string };
      if (!response.ok || !body.detail) throw new Error(body.error || "The request failed");
      setDetail(body.detail);
    } catch (reason) {
      setDetail(EMPTY);
      await messageBox.alert(reason instanceof Error ? reason.message : "The request failed", "Online Check: GST Detail", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mp-screen te-screen np-screen" role="region" aria-label={title}>
      <div className="mp-combos sec-combos">
        <label className="sec-combo"><span>GST NO</span>
          <input ref={box} className="np-name" aria-label="GST number" maxLength={15} value={gstNo} onChange={(event) => setGstNo(event.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ""))}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void send(); } }} />
        </label>
        {busy && <span className="mp-busy">Checking…</span>}
        <span className="mp-heading">{title.toUpperCase()}</span>
      </div>
      <div className="sec-body te-form">
        {FIELDS.map(([field, label]) => (
          <label key={field}>{label} »»<input readOnly tabIndex={-1} aria-label={label} value={detail[field]} /></label>
        ))}
      </div>
      <div className="mp-buttons sec-buttons">
        <button type="button" className="mp-btn mp-btn-green" disabled={busy} onClick={() => void send()}><Icon name="save" />Send</button>
        <button type="button" className="mp-btn mp-btn-red" disabled={busy} onClick={cancel}><Icon name="cancel" />Cancel</button>
        <button type="button" className="mp-btn mp-btn-red" onClick={() => void quit()}><Icon name="quit" />Quit</button>
      </div>
    </div>
  );
}
