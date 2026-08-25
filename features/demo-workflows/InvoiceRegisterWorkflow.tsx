"use client";

import { useEffect, useState } from "react";

type Invoice = {
  id: string; invoiceNumber: string; date: string; party: string | null; partyCode: number | null;
  amount: string; documentStatus: string | null; productLines: number; quantity: string; productValue: string;
  approved: boolean; printCount: number;
};
type InvoicePayload = {
  source: "legacy-postgresql"; readOnly: true; screen: { bookKey: 8; bookLabel: "SALE" };
  rows: Invoice[]; pagination: { page: number; pageSize: number; total: number; totalPages: number; query: string };
};

const money = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function InvoiceRegisterWorkflow() {
  const [payload, setPayload] = useState<InvoicePayload | null>(null);
  const [query, setQuery] = useState("");
  const [remoteQuery, setRemoteQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("Loading real Sale Invoice records…");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = new URLSearchParams({ page: String(page), pageSize: "100" });
    if (remoteQuery) params.set("q", remoteQuery);
    fetch(`/api/legacy/transaction/invoice?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as InvoicePayload | { error?: string };
        if (!response.ok || !("rows" in body)) throw new Error("error" in body && body.error ? body.error : "Sale Invoice data could not be loaded");
        return body;
      })
      .then((body) => { setPayload(body); setSelectedId(body.rows[0]?.id ?? null); setMessage(`${body.rows.length} real invoices shown · ${body.pagination.total.toLocaleString("en-IN")} total`); })
      .catch((reason: unknown) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Sale Invoice data could not be loaded"); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [page, remoteQuery]);

  const pagination = payload?.pagination;
  const search = () => { setPage(1); setRemoteQuery(query.trim()); };
  const refresh = () => setRemoteQuery((value) => value === query.trim() ? `${query.trim()} ` : query.trim());
  const cancel = async () => { if (!selectedId || !window.confirm("Cancel the selected invoice and restore its stock movement?")) return; try { const response = await fetch("/api/legacy/transaction/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ processKey: Number(selectedId) }) }); const body = await response.json() as { error?: string; stockLinesRestored?: number }; if (!response.ok) throw new Error(body.error || "Cancellation failed"); setMessage(`Invoice cancelled; ${body.stockLinesRestored ?? 0} stock line(s) restored.`); refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Cancellation failed"); } };
  const print = async () => { if (!selectedId) return setMessage("Select an invoice to print."); try { const response = await fetch("/api/legacy/transaction/document-print", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ processKeys: [Number(selectedId)] }) }); const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error || "Print recording failed"); window.print(); setMessage("Print opened and the document print count was recorded."); refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Print recording failed"); } };

  return <section className="legacy-master-screen invoice-register" aria-label="Real Sale Invoice register">
    <header className="legacy-master-command"><label><strong>BOOK</strong><select disabled value="8"><option>SALE (8)</option></select></label><label><strong>MODE</strong><select disabled value="register"><option value="register">Invoice Register</option></select></label><button className="legacy-new" type="button" onClick={() => setMessage("Open Sale Invoice Entry from the Transaction menu to post a new invoice.")}>＋ New Invoice</button><button className="legacy-cancel-both" type="button" onClick={cancel}>✖ Cancel Invoice</button></header>
    {loading && <div className="legacy-empty-state">Loading process, ledger, account, and product-ledger data…</div>}
    {error && <div className="legacy-empty-state" role="alert"><strong>Database connection failed</strong><span>{error}</span></div>}
    {!loading && payload && <div className="legacy-master-grid-wrap"><div className="legacy-grid-tools"><strong>SALE INVOICE REGISTER</strong><input aria-label="Search Sale Invoice" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") search(); }} placeholder="Invoice number or party"/><button type="button" onClick={search}>Search</button><span className="legacy-scroll-hint">↔ Scroll sideways using the bar below</span></div><div className="legacy-excel-grid legacy-real-data-grid"><table style={{ minWidth: 1480 }}><thead><tr><th>DATE</th><th>INVOICE NO.</th><th>PARTY</th><th>PARTY CODE</th><th>INVOICE AMOUNT</th><th>PRODUCT LINES</th><th>QUANTITY</th><th>PRODUCT VALUE</th><th>STATUS</th><th>APPROVED</th><th>PRINTS</th></tr></thead><tbody>{payload.rows.map((row) => <tr key={row.id} className={selectedId === row.id ? "selected" : ""} onClick={() => setSelectedId(row.id)}><td>{row.date}</td><td>{row.invoiceNumber}</td><td>{row.party ?? "—"}</td><td>{row.partyCode ?? "—"}</td><td>{money.format(Number(row.amount))}</td><td>{row.productLines}</td><td>{Number(row.quantity).toLocaleString("en-IN")}</td><td>{money.format(Number(row.productValue))}</td><td>{row.documentStatus ?? "—"}</td><td>{row.approved ? "Yes" : "No"}</td><td>{row.printCount}</td></tr>)}</tbody></table></div>{pagination && <nav className="legacy-grid-pagination" aria-label="Sale Invoice pages"><button type="button" disabled={pagination.page <= 1} onClick={() => setPage((current) => current - 1)}>← Previous</button><span>Page {pagination.page} of {pagination.totalPages} · {pagination.total.toLocaleString("en-IN")} invoices</span><button type="button" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next →</button></nav>}</div>}
    <footer className="legacy-master-actions"><button type="button" onClick={() => setMessage("Open Sale Invoice Entry to post a new invoice.")}>💾 New invoice</button><button type="button" onClick={print}>🖨 Print</button><button type="button" onClick={refresh}>🔄 Refresh</button><button type="button" onClick={cancel}>Cancel selected</button></footer>
    <div className="legacy-master-status"><span>{message}</span><span>Source: PostgreSQL / PROCESS / LEDGER / PROD_LEDGER</span><span>{selectedId ? `Process key ${selectedId}` : ""}</span></div>
  </section>;
}
