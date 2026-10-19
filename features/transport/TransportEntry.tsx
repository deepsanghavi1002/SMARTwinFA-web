"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import { useWindowActive, useWindowCloser } from "../ui/activeWindow";
import { Icon } from "../ui/Icon";
import { messageBox } from "../ui/MessageBox";
import { checkEntryDate } from "../../lib/transport-entry";
import type { BillRow, SaveResult, TransportOptions } from "../../lib/transport-entry";

/**
 * Transaction > Transport Entry (Entry_Transport.cs): choose a transport and the dates, list its open bills, type the freight against each
 * bill and save the total as one expense entry (see lib/transport-entry.ts for what the save writes).
 */

type Selection = { companyId: string | number; yearKey: number; loginName: string };

async function transportCall<T>(selection: Selection, menuShortName: string, action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch("/api/transport-entry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ action, menuShortName, session: { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName }, ...payload }),
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok || body.error) throw new Error(body.error || `Request ${action} failed`);
  return body;
}

const pad = (value: number) => String(value).padStart(2, "0");
const isoOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const number = (text: string) => { const parsed = Number(text.replace(/,/g, "").trim()); return Number.isFinite(parsed) ? parsed : 0; };
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const MAX_DOCUMENTS = 5;

type Document = { file: File | null; remark: string };
const emptyDocuments = (): Document[] => Array.from({ length: MAX_DOCUMENTS }, () => ({ file: null, remark: "" }));

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read"));
    reader.readAsDataURL(file);
  });
}

export function TransportEntry({ menuShortName, title, onClose }: { menuShortName: string; title: string; onClose: () => void }) {
  const selection = useStartupSelection();
  const active = useWindowActive();
  const [options, setOptions] = useState<TransportOptions | null>(null);
  const [busy, setBusy] = useState("Loading");

  const [transportKey, setTransportKey] = useState(0);
  const [subLedgerKey, setSubLedgerKey] = useState(0);
  const [expNatureKey, setExpNatureKey] = useState(0);
  const [expNameCode, setExpNameCode] = useState(0);
  const [reverse, setReverse] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [uptoDate, setUptoDate] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [amount, setAmount] = useState("");
  const [tds, setTds] = useState("");
  const [narration, setNarration] = useState("");
  const [bills, setBills] = useState<BillRow[] | null>(null);
  const [freight, setFreight] = useState<string[]>([]);
  const [documents, setDocuments] = useState<Document[]>(emptyDocuments);
  const root = useRef<HTMLDivElement>(null);
  const transportBox = useRef<HTMLSelectElement>(null);
  const amountBox = useRef<HTMLInputElement>(null);
  const invoiceBox = useRef<HTMLInputElement>(null);

  const say = useCallback((text: string, heading = "Warning") => messageBox.alert(text, heading), []);
  const ask = useCallback((text: string, heading: string, defaultButton: "Yes" | "No" = "No") => messageBox.ask(text, heading, ["Yes", "No"], { defaultButton }), []);
  const fail = useCallback((error: unknown) => say(error instanceof Error ? error.message : String(error), "INTERNAL PROGRAM FAILURE"), [say]);

  // Today, or the year's nearest end (GetValidDate).
  const validToday = useCallback((opts: TransportOptions) => {
    const today = isoOf(new Date());
    return today < opts.yearFrom ? opts.yearFrom : today > opts.yearTo ? opts.yearTo : today;
  }, []);

  const resetEntry = useCallback(() => {
    setAmount(""); setInvoiceNo(""); setTds(""); setBills(null); setFreight([]);
    setDocuments(emptyDocuments());
    requestAnimationFrame(() => transportBox.current?.focus());
  }, []);

  useEffect(() => {
    if (!selection) return;
    let live = true;
    transportCall<TransportOptions>(selection, menuShortName, "options")
      .then((result) => {
        if (!live) return;
        setOptions(result);
        const day = validToday(result);
        setFromDate(day); setUptoDate(day); setInvoiceDate(day); setEntryDate(day);
        setTransportKey(result.transports[0]?.key ?? 0);
        setSubLedgerKey(result.subLedgers[0]?.key ?? 0);
        setExpNatureKey(result.expNatures[0]?.key ?? 0);
        setExpNameCode(result.expNames[0]?.key ?? 0);
        setBusy("");
      })
      .catch((error: unknown) => { if (live) { setBusy(""); void fail(error); } });
    return () => { live = false; };
  }, [selection, menuShortName, validToday, fail]);

  const quit = useCallback(async () => {
    if ((await ask("Are You Sure Want To Quit ?", "Transport Entry Quit")) === "Yes") onClose();
  }, [ask, onClose]);
  useWindowCloser(quit);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!active.current || event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector(".msgbox-backdrop")) return;
      event.preventDefault();
      void quit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, quit]);

  const cancel = async () => {
    if ((await ask("Are you sure Want to Cancel Entry?", "Transport Entry Cancel")) === "Yes") resetEntry();
  };

  // dtp_*_Leave: a date outside the year is refused and put back to today.
  const checkYearDate = async (value: string, set: (day: string) => void) => {
    if (!options || value === "") return;
    if (value < options.yearFrom || value > options.yearTo) {
      await say(`Date Should be Allowed Only from ${options.yearFrom} to... ${options.yearTo}`);
      set(validToday(options));
    }
  };
  const checkEntry = async () => {
    if (!options || entryDate === "") return;
    const problem = checkEntryDate(options, entryDate);
    if (problem === "") return;
    await say(problem, problem.startsWith("Period") ? "Entry Date Lock Warning" : "Warning");
    setEntryDate(options.openFrom !== null && options.openFrom <= options.yearTo ? options.openFrom : options.yearFrom);
  };

  const transportName = useMemo(() => options?.transports.find((item) => item.key === transportKey)?.name ?? "", [options, transportKey]);

  // tbx_Narration_Leave: the list is read once, when the narration is left with no list yet.
  const loadBills = async () => {
    if (!selection || bills !== null || transportKey <= 0 || busy !== "") return;
    setBusy("Loading");
    try {
      const result = await transportCall<{ bills: BillRow[] }>(selection, menuShortName, "bills", { transportKey, from: fromDate, to: uptoDate });
      if (result.bills.length === 0) {
        await say("No Record Found....");
        transportBox.current?.focus();
        return;
      }
      setBills(result.bills);
      setFreight(result.bills.map(() => ""));
    } catch (error) {
      await fail(error);
    } finally {
      setBusy("");
    }
  };

  // txt_Amount_Leave: the TDS of the amount.
  const amountLeft = async () => {
    const value = number(amount);
    if (!selection || value <= 0 || transportKey <= 0) return;
    try {
      const result = await transportCall<{ rate: number; tds: number }>(selection, menuShortName, "tds", { transportKey, amount: value });
      if (result.tds > 0) setTds(String(result.tds));
    } catch (error) {
      await fail(error);
    }
  };

  // txt_InvoiceNo_Leave: the same transport cannot have the number twice in the year.
  const invoiceLeft = async () => {
    const typed = invoiceNo.trim();
    if (!selection || typed === "" || transportKey <= 0) return;
    try {
      const result = await transportCall<{ duplicate: boolean }>(selection, menuShortName, "duplicate", { transportKey, invoiceNo: typed });
      if (result.duplicate) {
        await say("Duplicate number...", "Dulpicate Number Warning");
        setInvoiceNo("");
        requestAnimationFrame(() => invoiceBox.current?.focus());
      }
    } catch (error) {
      await fail(error);
    }
  };

  const rowTotal = money(freight.reduce((sum, text) => sum + Math.max(number(text), 0), 0));

  const save = async () => {
    if (!selection || !options) return;
    const gross = money(number(amount));
    if ((await ask("Are you sure Want to Save Entry?", "Confirmation")) !== "Yes") return;
    if (!(gross > 0)) {
      await say("Amount Blank Not Allowed......");
      amountBox.current?.focus();
      return;
    }
    if (rowTotal !== gross) {
      await say("Entry Rows Amount Not Match Gross Amount......");
      amountBox.current?.focus();
      return;
    }
    const problem = checkEntryDate(options, entryDate);
    if (problem !== "") { await say(problem, "Entry Date Lock Warning"); return; }
    setBusy("Saving");
    try {
      const rows = (bills ?? []).map((bill, index) => ({ ledId: bill.ledId, processId: bill.processId, amount: money(number(freight[index] ?? "")) })).filter((row) => row.amount > 0);
      const files = documents.filter((document) => document.file !== null);
      const uploads = await Promise.all(files.map(async (document) => ({ name: document.file!.name, remark: document.remark.trim(), base64: await readBase64(document.file!) })));
      const result = await transportCall<SaveResult>(selection, menuShortName, "save", {
        entry: { transportKey, subLedgerKey, expNatureKey, expNameCode, reverse, entryDate, invoiceDate, invoiceNo: invoiceNo.trim(), narration, amount: gross, tds: money(number(tds)), rows, documents: uploads },
      });
      const extra = result.warnings.length > 0 ? `\n${result.warnings.join("\n")}` : "";
      await messageBox.alert(`Entry Save Successfully.....\n${result.fullDocNo}${extra}`, "Save Entry");
      resetEntry();
    } catch (error) {
      await fail(error);
    } finally {
      setBusy("");
    }
  };

  // Enter moves to the next box, except in the narration (Shift+Enter is a new line there) and on buttons.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.tagName === "BUTTON" || (target.tagName === "TEXTAREA" && event.shiftKey) || target.getAttribute("type") === "file") return;
    event.preventDefault();
    const fields = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-te-field]:not(:disabled)") ?? []);
    const at = fields.indexOf(target);
    if (at >= 0 && at < fields.length - 1) fields[at + 1].focus();
    else if (at === fields.length - 1) document.getElementById("te-update")?.focus();
  };

  if (!options) return <div className="mp-screen te-screen" role="region" aria-label={title}>{busy !== "" && <p className="sec-empty">{busy}…</p>}</div>;

  const choose = (value: number, set: (key: number) => void, list: readonly { key: number; name: string }[]) => (
    <select data-te-field value={value} onChange={(event) => set(Number(event.target.value))}>
      {list.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
    </select>
  );
  const dateMin = options.yearFrom;
  const dateMax = options.yearTo;

  return (
    <div className="mp-screen te-screen" role="region" aria-label={title} ref={root} onKeyDown={onKeyDown}>
      <div className="te-form">
        <label>Transport »»
          <select data-te-field ref={transportBox} autoFocus disabled={bills !== null} value={transportKey} onChange={(event) => { setTransportKey(Number(event.target.value)); setBills(null); setFreight([]); }}>
            {options.transports.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
          </select>
        </label>
        <label>From Date »»<input data-te-field type="date" min={dateMin} max={dateMax} value={fromDate} disabled={bills !== null} onChange={(event) => setFromDate(event.target.value)} onBlur={() => void checkYearDate(fromDate, setFromDate)} /></label>
        <label>Upto Date »»<input data-te-field type="date" min={dateMin} max={dateMax} value={uptoDate} disabled={bills !== null} onChange={(event) => setUptoDate(event.target.value)} onBlur={() => void checkYearDate(uptoDate, setUptoDate)} /></label>
        <label>Inv Date »»<input data-te-field type="date" min={dateMin} max={dateMax} value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} onBlur={() => void checkYearDate(invoiceDate, setInvoiceDate)} /></label>
        <label>Invoice No »»<input data-te-field ref={invoiceBox} value={invoiceNo} maxLength={20} onChange={(event) => setInvoiceNo(event.target.value)} onBlur={() => void invoiceLeft()} /></label>
        <label>RCM »»<select data-te-field value={reverse ? "Yes" : "No"} onChange={(event) => setReverse(event.target.value === "Yes")}><option value="No">No</option><option value="Yes">Yes</option></select></label>
        <label>Entry Date »»<input data-te-field type="date" min={dateMin} max={dateMax} value={entryDate} onChange={(event) => setEntryDate(event.target.value)} onBlur={() => void checkEntry()} /></label>
        <label>Exp Name »»{choose(expNameCode, setExpNameCode, options.expNames)}</label>
        <label>Sub Ledger »»{choose(subLedgerKey, setSubLedgerKey, options.subLedgers)}</label>
        <label>Exp Nature »»{choose(expNatureKey, setExpNatureKey, options.expNatures)}</label>
        <label>Amount »»<input data-te-field ref={amountBox} className="te-num" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} onBlur={() => void amountLeft()} /></label>
        <label>TDS Amt »»<input data-te-field className="te-num" inputMode="decimal" value={tds} onChange={(event) => setTds(event.target.value)} /></label>
        <label className="te-wide">Narration »»<textarea data-te-field rows={2} value={narration} onChange={(event) => setNarration(event.target.value)} onBlur={() => void loadBills()} /></label>
        {busy !== "" && <span className="mp-busy">{busy}…</span>}
        <span className="mp-heading">{title.toUpperCase()}</span>
      </div>
      <div className="sec-body te-grid-body">
        {bills === null ? (
          <p className="sec-empty">Choose the transport and dates, then leave the narration to list its open bills ({transportName || "no transport"}).</p>
        ) : (
          <table className="sec-grid">
            <thead>
              <tr><th>Party</th><th>Doc No</th><th>Inv No</th><th>LR No</th><th>Doc Date</th><th>Amount</th><th>Ent Amount</th></tr>
            </thead>
            <tbody>
              {bills.map((bill, index) => (
                <tr key={`${bill.ledId}-${bill.processId}`} className={index % 2 ? "sec-alt" : ""}>
                  <td className="sec-name">{bill.party}</td>
                  <td>{bill.docNo}</td>
                  <td>{bill.invNo}</td>
                  <td>{bill.lrNo}</td>
                  <td>{bill.docDate}</td>
                  <td className="te-right">{bill.amount.toFixed(2)}</td>
                  <td className="sec-pass"><input data-te-field className="te-num" inputMode="decimal" aria-label={`Freight for ${bill.docNo}`} value={freight[index] ?? ""} onChange={(event) => setFreight((current) => current.map((text, at) => (at === index ? event.target.value : text)))} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={6} className="te-right"><strong>Total</strong></td><td className="te-right"><strong>{rowTotal.toFixed(2)}</strong></td></tr></tfoot>
          </table>
        )}
      </div>
      <details className="te-docs">
        <summary>Upload Documents (optional)</summary>
        {documents.map((document, index) => (
          <div key={index} className="te-doc">
            <input type="file" accept="image/*,application/pdf" aria-label={`Document ${index + 1}`} onChange={(event) => { const file = event.target.files?.[0] ?? null; setDocuments((current) => current.map((item, at) => (at === index ? { ...item, file } : item))); }} />
            <input placeholder="Remark" value={document.remark} onChange={(event) => { const remark = event.target.value; setDocuments((current) => current.map((item, at) => (at === index ? { ...item, remark } : item))); }} />
          </div>
        ))}
      </details>
      <div className="mp-buttons sec-buttons">
        <button type="button" id="te-update" className="mp-btn mp-btn-green" disabled={busy !== ""} onClick={() => void save()}><Icon name="save" />Update</button>
        <button type="button" className="mp-btn mp-btn-red" disabled={busy !== ""} onClick={() => void cancel()}><Icon name="cancel" />Cancel</button>
        <button type="button" className="mp-btn mp-btn-red" onClick={() => void quit()}><Icon name="quit" />Quit</button>
      </div>
    </div>
  );
}
