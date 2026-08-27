"use client";

import { useEffect, useMemo, useState } from "react";
import { LegacyReportWorkflow } from "./LegacyReportWorkflow";

type EntryKind = "invoice" | "voucher";
type VoucherType = "cash-bank" | "journal" | "discount";
type Context = {
  source: "legacy-postgresql"; readOnly: true; kind: EntryKind;
  books: Array<{ key: number; label: string }>;
  parties: Array<{ code: number; label: string; address: string | null }>;
  products: Array<{ key: number; label: string; uom: string | null; saleRate: string; stock: string }>;
  note: string;
};
type ItemLine = { productKey: string; quantity: string; rate: string; partCode: string; packing: string; size: string };
type LedgerLine = { accountCode: string; debit: string; credit: string; subLedger: string };

const number = (value: string) => Number(value) || 0;
const amount = (value: number) => value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

function blankItem(): ItemLine { return { productKey: "", quantity: "", rate: "", partCode: "", packing: "", size: "" }; }
function blankLedger(): LedgerLine { return { accountCode: "", debit: "", credit: "", subLedger: "" }; }

const voucherDefinitions: Record<VoucherType, { title: string; book: number; report: "cash-bank-voucher" | "journal-voucher" | "discount-voucher" }> = {
  "cash-bank": { title: "Cash / Bank Voucher", book: 4, report: "cash-bank-voucher" },
  journal: { title: "Journal Voucher", book: 19, report: "journal-voucher" },
  discount: { title: "Discount Voucher", book: 5, report: "discount-voucher" },
};

function EntryHeader({ title, mode, setMode, status }: { title: string; mode: "entry" | "register"; setMode: (mode: "entry" | "register") => void; status: string }) {
  return <header className="desktop-entry-title"><strong>{title}</strong><nav aria-label={`${title} mode`}><button className={mode === "entry" ? "active" : ""} type="button" onClick={() => setMode("entry")}>Entry</button><button className={mode === "register" ? "active" : ""} type="button" onClick={() => setMode("register")}>Register</button></nav><span>{status}</span></header>;
}

export function LegacyEntryWorkflow({ kind, voucherType = "cash-bank" }: { kind: EntryKind; voucherType?: VoucherType }) {
  const [context, setContext] = useState<Context | null>(null);
  const [mode, setMode] = useState<"entry" | "register">("entry");
  const [outcome, setOutcome] = useState<{ key: string; error: string }>({ key: "", error: "" });
  const [status, setStatus] = useState("Loading desktop lookup data…");
  const [book, setBook] = useState(kind === "invoice" ? "8" : String(voucherDefinitions[voucherType].book));
  const [series, setSeries] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [date, setDate] = useState(today);
  const [partyCode, setPartyCode] = useState("");
  const [narration, setNarration] = useState("");
  const [creditDays, setCreditDays] = useState("");
  const [items, setItems] = useState<ItemLine[]>([blankItem()]);
  const [ledger, setLedger] = useState<LedgerLine[]>([blankLedger()]);
  const [postedKey, setPostedKey] = useState<number | null>(null);

  const definition = kind === "voucher" ? voucherDefinitions[voucherType] : null;
  const requestKey = kind;
  const loading = outcome.key !== requestKey;
  const error = outcome.key === requestKey ? outcome.error : "";
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/legacy/transaction/context?kind=${kind}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const body = await response.json() as Context | { error?: string }; if (!response.ok || !("parties" in body)) throw new Error("error" in body && body.error ? body.error : "Entry lookups could not be loaded"); return body; })
      .then((body) => { setContext(body); setStatus(`${body.parties.length.toLocaleString("en-IN")} real accounts${kind === "invoice" ? ` · ${body.products.length.toLocaleString("en-IN")} real products` : ""} available`); setOutcome({ key: requestKey, error: "" }); })
      .catch((reason: unknown) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setOutcome({ key: requestKey, error: reason instanceof Error ? reason.message : "Entry lookups could not be loaded" }); });
    return () => controller.abort();
  }, [requestKey, kind]);

  const party = context?.parties.find((candidate) => String(candidate.code) === partyCode) ?? null;
  const itemTotal = useMemo(() => items.reduce((total, line) => total + number(line.quantity) * number(line.rate), 0), [items]);
  const debit = useMemo(() => ledger.reduce((total, line) => total + number(line.debit), 0), [ledger]);
  const credit = useMemo(() => ledger.reduce((total, line) => total + number(line.credit), 0), [ledger]);
  const updateItem = (index: number, patch: Partial<ItemLine>) => setItems((lines) => lines.map((line, row) => row === index ? { ...line, ...patch } : line));
  const updateLedger = (index: number, patch: Partial<LedgerLine>) => setLedger((lines) => lines.map((line, row) => row === index ? { ...line, ...patch } : line));
  const clear = () => { setSeries(""); setDocumentNumber(""); setDate(today()); setPartyCode(""); setNarration(""); setCreditDays(""); setItems([blankItem()]); setLedger([blankLedger()]); setStatus("New desktop-style entry draft is ready. No data has been written."); };
  const print = async () => {
    if (!postedKey) return setStatus("Save the document before printing so its print count can be recorded.");
    try {
      const response = await fetch("/api/legacy/transaction/document-print", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ processKeys: [postedKey] }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Print recording failed");
      window.print(); setStatus("Print opened and the document print count was recorded.");
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "Print recording failed"); }
  };
  const guardSave = async () => {
    if (!party) return setStatus("Choose a real account before saving.");
    if (kind === "invoice" && !items.some((line) => line.productKey && number(line.quantity) > 0)) return setStatus("Add at least one real product and a quantity before saving.");
    if (kind === "voucher" && (debit === 0 || debit !== credit)) return setStatus("Voucher requires equal non-zero debit and credit totals before it can be posted.");
    setStatus("Posting to the PostgreSQL reference ledger…");
    try {
      const response = await fetch("/api/legacy/transaction/post", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, book: Number(book), date, partyCode: Number(partyCode), series, documentNumber, narration, creditDays: Number(creditDays), items: items.map((line) => ({ productKey: Number(line.productKey), quantity: number(line.quantity), rate: number(line.rate) })), ledger: ledger.map((line) => ({ accountCode: Number(line.accountCode), debit: number(line.debit), credit: number(line.credit) })) }) });
      const body = await response.json() as { documentNumber?: string; amount?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "Entry could not be posted");
      setDocumentNumber(body.documentNumber ?? documentNumber); setPostedKey(Number((body as { processKey?: number }).processKey) || null); setStatus(`Posted ${body.documentNumber} · ₹ ${body.amount}`); setMode("register");
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "Entry could not be posted"); }
  };

  if (mode === "register") return <section className="legacy-entry-screen"><EntryHeader title={kind === "invoice" ? "Sale Invoice" : definition!.title} mode={mode} setMode={setMode} status={status} /><LegacyReportWorkflow kind={kind === "invoice" ? "document-register" : definition!.report} /></section>;
  const title = kind === "invoice" ? "Sale Invoice" : definition!.title;
  return <section className="legacy-entry-screen" aria-label={`${title} entry`}>
    <EntryHeader title={title} mode={mode} setMode={setMode} status={status} />
    {loading && <div className="legacy-empty-state">Loading account, address, product, price and balance lookups from the restored database…</div>}
    {error && <div className="legacy-empty-state" role="alert"><strong>Database connection failed</strong><span>{error}</span></div>}
    {!loading && context && <main className="desktop-entry-form">
      <section className="desktop-entry-top">
        <div className="desktop-entry-document">
          <label><span>Register</span><select value={book} onChange={(event) => setBook(event.target.value)}>{context.books.filter((candidate) => kind === "invoice" ? candidate.key === 8 : true).map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.label} ({candidate.key})</option>)}</select></label>
          <label><span>Series</span><input value={series} onChange={(event) => setSeries(event.target.value)} placeholder="Series" /></label>
          <label><span>Ent. Dt.</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label><span>Ent. No.</span><input value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} placeholder="Generated on save" /></label>
          {kind === "invoice" && <><label><span>Inv. Dt.</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label><span>Inv. No.</span><input value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} placeholder="Invoice number" /></label></>}
        </div>
        <div className="desktop-entry-party">
          <label><span>* Party</span><select value={partyCode} onChange={(event) => setPartyCode(event.target.value)}><option value="">Select real account…</option>{context.parties.map((candidate) => <option key={candidate.code} value={candidate.code}>{candidate.label} · {candidate.code}</option>)}</select></label>
          <label><span>Address</span><textarea readOnly value={party?.address ?? ""} placeholder="Address is populated from the selected account" /></label>
        </div>
      </section>
      {kind === "invoice" ? <section className="desktop-entry-grid-section"><header><strong>Product details</strong><button type="button" onClick={() => setItems((rows) => [...rows, blankItem()])}>＋ Add item</button></header><div className="desktop-entry-table-wrap"><table className="desktop-entry-table invoice-entry-table"><thead><tr><th>Sr.</th><th>* Product</th><th>Qty</th><th>UOM</th><th>Rate</th><th>Value</th><th>Part code</th><th>Packing</th><th>Size</th><th>Stock</th><th /></tr></thead><tbody>{items.map((line, index) => { const product = context.products.find((candidate) => String(candidate.key) === line.productKey); return <tr key={index}><td>{index + 1}</td><td><select value={line.productKey} onChange={(event) => { const next = context.products.find((candidate) => String(candidate.key) === event.target.value); updateItem(index, { productKey: event.target.value, rate: next?.saleRate ?? "", partCode: next?.key ? String(next.key) : "" }); }}><option value="">Select product…</option>{context.products.map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.label}</option>)}</select></td><td><input inputMode="decimal" value={line.quantity} onChange={(event) => updateItem(index, { quantity: event.target.value })} /></td><td>{product?.uom ?? "—"}</td><td><input inputMode="decimal" value={line.rate} onChange={(event) => updateItem(index, { rate: event.target.value })} /></td><td>{amount(number(line.quantity) * number(line.rate))}</td><td><input value={line.partCode} onChange={(event) => updateItem(index, { partCode: event.target.value })} /></td><td><input value={line.packing} onChange={(event) => updateItem(index, { packing: event.target.value })} /></td><td><input value={line.size} onChange={(event) => updateItem(index, { size: event.target.value })} /></td><td>{product ? product.stock : "—"}</td><td><button type="button" aria-label={`Remove product row ${index + 1}`} disabled={items.length === 1} onClick={() => setItems((rows) => rows.filter((_, row) => row !== index))}>×</button></td></tr>; })}</tbody></table></div></section> : <section className="desktop-entry-grid-section"><header><strong>Account voucher details</strong><button type="button" onClick={() => setLedger((rows) => [...rows, blankLedger()])}>＋ Add ledger line</button></header><div className="desktop-entry-table-wrap"><table className="desktop-entry-table voucher-entry-table"><thead><tr><th>Sr.</th><th>* Account Head</th><th>Debit</th><th>Credit</th><th>Sub Ledger</th><th /></tr></thead><tbody>{ledger.map((line, index) => <tr key={index}><td>{index + 1}</td><td><select value={line.accountCode} onChange={(event) => updateLedger(index, { accountCode: event.target.value })}><option value="">Select real account…</option>{context.parties.map((candidate) => <option key={candidate.code} value={candidate.code}>{candidate.label}</option>)}</select></td><td><input inputMode="decimal" value={line.debit} onChange={(event) => updateLedger(index, { debit: event.target.value })} /></td><td><input inputMode="decimal" value={line.credit} onChange={(event) => updateLedger(index, { credit: event.target.value })} /></td><td><input value={line.subLedger} onChange={(event) => updateLedger(index, { subLedger: event.target.value })} /></td><td><button type="button" aria-label={`Remove ledger row ${index + 1}`} disabled={ledger.length === 1} onClick={() => setLedger((rows) => rows.filter((_, row) => row !== index))}>×</button></td></tr>)}</tbody></table></div></section>}
      <section className="desktop-entry-bottom">
        <div className="desktop-entry-totals">{kind === "invoice" ? <><span>Total quantity <strong>{items.reduce((total, line) => total + number(line.quantity), 0).toLocaleString("en-IN")}</strong></span><span>Product amount <strong>{amount(itemTotal)}</strong></span><span>Final amount <strong>{amount(itemTotal)}</strong></span></> : <><span>Total debit <strong>{amount(debit)}</strong></span><span>Total credit <strong>{amount(credit)}</strong></span><span className={debit === credit ? "balanced" : "unbalanced"}>{debit === credit ? "Balanced" : `Difference ${amount(Math.abs(debit - credit))}`}</span></>}</div>
        <label className="desktop-entry-narration"><span>Narration</span><textarea value={narration} onChange={(event) => setNarration(event.target.value)} placeholder="Narration" /></label>
        <label className="desktop-entry-credit"><span>Credit days</span><input inputMode="numeric" value={creditDays} onChange={(event) => setCreditDays(event.target.value)} /></label>
      </section>
      <aside className="desktop-entry-note"><strong>Reference posting</strong>Save posts one PostgreSQL transaction: document header, ledger rows, posting rows and (for invoices) product and stock movements.</aside>
    </main>}
    <footer className="legacy-master-actions"><button type="button" onClick={guardSave}>💾 Save</button><button type="button" onClick={() => { if (postedKey && window.confirm("Cancel the posted document and reverse its stock movement?")) fetch("/api/legacy/transaction/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ processKey: postedKey }) }).then(async (response) => { const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error); clear(); setPostedKey(null); setStatus("Posted document cancelled and database movements reversed."); }).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Cancellation failed")); else clear(); }}>✖ Cancel</button><button type="button" onClick={print}>🖨 Print</button><button type="button" onClick={() => { clear(); setPostedKey(null); }}>＋ New</button><button type="button" disabled={!postedKey} onClick={() => { if (postedKey && window.confirm("Cancel the posted document?")) fetch("/api/legacy/transaction/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ processKey: postedKey }) }).then(async (response) => { const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error); clear(); setPostedKey(null); setStatus("Posted document cancelled and database movements reversed."); }).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Cancellation failed")); }}>Delete</button></footer>
    <div className="legacy-master-status"><span>{status}</span><span>Source: PostgreSQL / ACCOUNT / ADDRESS{kind === "invoice" ? " / PRODUCT_MASTER / PRICELIST / PROD_BALANCE" : " / LEDGER"}</span><span>{party ? `AC ${party.code}` : ""}</span></div>
  </section>;
}
