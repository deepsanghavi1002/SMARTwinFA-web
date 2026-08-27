"use client";

import { useEffect, useMemo, useState } from "react";

export type ReportKind = "daybook" | "ledger" | "outstanding" | "trial-balance" | "closing-stock" | "top-sales" | "cash-bank-voucher" | "journal-voucher" | "discount-voucher" | "lock-status" | "stock-movement" | "partywise-stock" | "daily-transaction" | "target-register" | "book-series" | "opening-balance" | "tax-setup" | "document-register" | "e-invoice-register" | "e-way-bill-register" | "configuration" | "sales-distribution";
export type ReportRow = Record<string, string | number | null>;
export type ReportPayload = { source: "legacy-postgresql"; readOnly: true; report: { kind: ReportKind; title: string; note: string }; columns: string[]; rows: ReportRow[]; total: number };
export type ReportFilter = { from?: string; upto?: string; query?: string; variant?: string };

const numeric = new Set(["Debit", "Credit", "Entry Amount", "Setoff", "Prior Setoff", "Pending", "Opening", "Closing", "Reporting Rate", "Closing Value", "Invoice Amount", "Quantity", "Rate", "Value", "Target Quantity", "Target Value", "Target %", "Share %", "Amount"]);
const visualOptions: Partial<Record<ReportKind, { selection: string; choices: string[]; measure: string; measures: string[]; zoom?: boolean }>> = {
  ledger: { selection: "Account", choices: ["All accounts", "Account-wise", "Book-wise"], measure: "View", measures: ["Ledger", "Narration", "Document"], zoom: true },
  outstanding: { selection: "Outstanding", choices: ["All", "Sale", "Purchase", "Expense"], measure: "Ageing", measures: ["All days", "30 days", "60 days", "90 days"], zoom: true },
  "trial-balance": { selection: "Group", choices: ["Account", "Schedule", "Area"], measure: "Format", measures: ["Summary", "Detailed", "With opening"], zoom: true },
  "top-sales": { selection: "Select", choices: ["Customer", "Supplier", "Item"], measure: "Order", measures: ["Value", "Quantity", "Invoices"], zoom: true },
  "partywise-stock": { selection: "Analysis", choices: ["Party", "Item", "Quantity", "Invoice count"], measure: "View", measures: ["Value", "Quantity", "Details"], zoom: true },
  "closing-stock": { selection: "Stock", choices: ["Closing stock", "Pieces", "Packs", "Value"], measure: "Period", measures: ["Current", "Month-end", "Financial year"], zoom: true },
  "sales-distribution": { selection: "Select", choices: ["Sale amount", "Sale quantity", "Purchase amount", "Purchase quantity", "Expense", "Receipt", "Payment"], measure: "Chart", measures: ["Pie", "Legend", "Table"], zoom: true },
  daybook: { selection: "Book", choices: ["Bank", "Cash", "Discount", "All books"], measure: "Format", measures: ["Detailed", "Summary"], zoom: true },
};
const pieColors = ["#20acc3", "#f08855", "#f1cc4f", "#7b71c5", "#77b871", "#d36589"];

function format(column: string, value: string | number | null) {
  if (value === null || value === "") return "—";
  if (numeric.has(column)) return Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(value);
}

function rowKey(row: ReportRow, index: number) {
  return String(row.Key ?? row["Document Key"] ?? row["Line Key"] ?? row["Target Key"] ?? row["Setup Key"] ?? row.Code ?? index);
}

function detailEntries(row: ReportRow) {
  return Object.entries(row).filter(([, value]) => value !== null && value !== "");
}

function textValue(row: ReportRow, ...keys: string[]) {
  return keys.map((key) => String(row[key] ?? "")).find(Boolean) ?? "";
}

function numericValue(row: ReportRow, ...keys: string[]) {
  for (const key of keys) {
    const raw = row[key]; const value = raw === null || raw === "" || raw === undefined ? Number.NaN : Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

/** Apply the desktop selector choices to the already-authoritative report rows.
 * The SQL endpoint remains the date/text source of truth; these are the display
 * grouping and ordering actions users perform after the grid is loaded. */
function presentRows(kind: ReportKind, source: ReportRow[], selection: string, measure: string) {
  let rows = [...source];
  if (kind === "daybook" && selection !== "All books") rows = rows.filter((row) => textValue(row, "Book").toLowerCase().includes(selection.toLowerCase()));
  if (kind === "outstanding" && selection !== "All") rows = rows.filter((row) => textValue(row, "Book", "Type").toLowerCase().includes(selection.toLowerCase()));
  const primary = kind === "ledger" ? (selection === "Book-wise" ? ["Book", "Account"] : ["Account", "Book"])
    : kind === "trial-balance" ? (selection === "Area" ? ["Area", "Account"] : selection === "Schedule" ? ["Schedule", "Account"] : ["Account", "Group"])
      : kind === "partywise-stock" ? (selection === "Item" ? ["Product", "Party"] : ["Party", "Product"])
        : kind === "closing-stock" ? ["Product"] : ["Party", "Account", "Product"];
  const numericOrder = measure === "Quantity" || selection === "Quantity" ? ["Quantity", "Closing", "Value"]
    : measure === "Invoices" || selection === "Invoice count" ? ["Invoice Count", "Documents", "Quantity"]
      : measure === "Value" || selection.includes("amount") || selection === "Value" ? ["Invoice Amount", "Value", "Amount", "Closing Value"] : [];
  rows.sort((left, right) => numericOrder.length
    ? numericValue(right, ...numericOrder) - numericValue(left, ...numericOrder)
    : textValue(left, ...primary).localeCompare(textValue(right, ...primary), "en-IN", { numeric: true, sensitivity: "base" }));
  return rows;
}

function downloadCsv(title: string, columns: string[], rows: ReportRow[]) {
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [columns.map(quote).join(","), ...rows.map((row) => columns.map((column) => quote(row[column])).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "report"}.csv`; anchor.click(); URL.revokeObjectURL(url);
}

export function useLegacyReport(kind: ReportKind, filter: ReportFilter = {}) {
  const [result, setResult] = useState<{ key: string; payload: ReportPayload | null; error: string }>({ key: "", payload: null, error: "" });
  const [reload, setReload] = useState(0);
  const requestKey = `${kind}|${reload}|${filter.from ?? ""}|${filter.upto ?? ""}|${filter.query ?? ""}|${filter.variant ?? ""}`;
  const settled = result.key === requestKey;
  const payload = result.payload;
  const loading = !settled;
  const error = settled ? result.error : "";
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (filter.from) params.set("from", filter.from);
    if (filter.upto) params.set("upto", filter.upto);
    if (filter.query) params.set("q", filter.query);
    if (filter.variant) params.set("variant", filter.variant);
    fetch(`/api/legacy/report/${kind}${params.size ? `?${params}` : ""}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as ReportPayload | { error?: string };
        if (!response.ok || !("rows" in body)) throw new Error("error" in body && body.error ? body.error : "Report could not be loaded");
        return body;
      })
      .then((body) => setResult({ key: requestKey, payload: body, error: "" }))
      .catch((reason: unknown) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setResult((current) => ({ key: requestKey, payload: current.payload, error: reason instanceof Error ? reason.message : "Report could not be loaded" })); });
    return () => controller.abort();
  }, [requestKey, kind, filter.from, filter.upto, filter.query, filter.variant]);
  return { payload, loading, error, refresh: () => setReload((value) => value + 1) };
}

export function LegacyReportWorkflow({ kind }: { kind: ReportKind }) {
  const definition = visualOptions[kind];
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [uptoDate, setUptoDate] = useState("");
  const [applied, setApplied] = useState<ReportFilter>({});
  const [selection, setSelection] = useState(definition?.choices[0] ?? "All");
  const [measure, setMeasure] = useState(definition?.measures[0] ?? "Detailed");
  const [selectedKey, setSelectedKey] = useState("");
  const [zoom, setZoom] = useState(false);
  const [renderedKind, setRenderedKind] = useState(kind);
  const { payload, loading, error, refresh } = useLegacyReport(kind, applied);

  if (renderedKind !== kind) {
    // Reset the per-report view state during render rather than in an effect (react.dev/learn/you-might-not-need-an-effect).
    setRenderedKind(kind);
    setSelection(visualOptions[kind]?.choices[0] ?? "All");
    setMeasure(visualOptions[kind]?.measures[0] ?? "Detailed");
    setSelectedKey("");
    setZoom(false);
  }

  const rows = useMemo(() => presentRows(kind, payload?.rows ?? [], selection, measure), [kind, payload?.rows, selection, measure]);
  const selected = rows.find((row, index) => rowKey(row, index) === selectedKey) ?? null;
  const distribution = useMemo(() => rows.slice(0, 6).map((row) => ({ label: String(row.Party ?? row.Account ?? row.Product ?? "—"), value: Number(row["Invoice Amount"] ?? row.Amount ?? row.Quantity ?? row.Value ?? 0) })).filter((item) => item.value > 0), [rows]);
  const distributionTotal = distribution.reduce((total, item) => total + item.value, 0);
  const pie = distributionTotal > 0 ? `conic-gradient(${distribution.map((item, index) => { const start = distribution.slice(0, index).reduce((total, entry) => total + entry.value, 0) / distributionTotal * 100; const end = distribution.slice(0, index + 1).reduce((total, entry) => total + entry.value, 0) / distributionTotal * 100; return `${pieColors[index % pieColors.length]} ${start}% ${end}%`; }).join(", ")})` : "#c3d9e8";
  const clear = () => { setQuery(""); setFromDate(""); setUptoDate(""); setApplied({}); setSelectedKey(""); setZoom(false); };

  return <section className="legacy-master-screen invoice-register legacy-video-report" aria-label="Real legacy report">
    <header className="legacy-master-command legacy-report-command legacy-video-report-command">
      <label><strong>REPORT</strong><select disabled value={kind}><option value={kind}>Real data · {payload?.report.title ?? "loading"}</option></select></label>
      <label><strong>From</strong><input aria-label="Report from date" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
      <label><strong>Upto</strong><input aria-label="Report upto date" type="date" value={uptoDate} onChange={(event) => setUptoDate(event.target.value)} /></label>
      {definition && <label><strong>{definition.selection}</strong><select aria-label={`${definition.selection} selector`} value={selection} onChange={(event) => setSelection(event.target.value)}>{definition.choices.map((choice) => <option key={choice}>{choice}</option>)}</select></label>}
      {definition && <label><strong>{definition.measure}</strong><select aria-label={`${definition.measure} selector`} value={measure} onChange={(event) => setMeasure(event.target.value)}>{definition.measures.map((choice) => <option key={choice}>{choice}</option>)}</select></label>}
      <button className="legacy-new" type="button" onClick={() => setApplied({ query: query.trim(), from: fromDate, upto: uptoDate, ...((kind === "sales-distribution" || kind === "top-sales") ? { variant: selection } : {}) })}>Show</button>
      <button className="legacy-cancel-both" type="button" onClick={clear}>Clear</button>
    </header>
    {loading && <div className="legacy-empty-state">Loading report rows from the restored database…</div>}
    {error && <div className="legacy-empty-state" role="alert"><strong>Database connection failed</strong><span>{error}</span></div>}
    {!loading && payload && <div className={`legacy-master-grid-wrap ${zoom ? "with-report-zoom" : ""}`}>
      <div className="legacy-grid-tools"><strong>{payload.report.title}</strong><input aria-label={`${payload.report.title} search`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter loaded real rows"/><button type="button" disabled={!selected || !definition?.zoom} onClick={() => setZoom(true)}>F4 Zoom</button><span className="legacy-scroll-hint">↔ Scroll sideways using the bar below</span></div>
      <p className="legacy-report-note">{payload.report.note} <b>View:</b> {selection} · {measure}</p>
      {kind === "sales-distribution" && <section className="legacy-pie-panel" aria-label="Sales distribution pie chart"><div className="legacy-pie" style={{ background: pie }} /><div>{distribution.map((item, index) => <span key={`${item.label}-${index}`}><i style={{ background: pieColors[index % pieColors.length] }} />{item.label} · {item.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>)}</div></section>}
      <div className="legacy-excel-grid legacy-real-data-grid"><table style={{ minWidth: Math.max(1060, payload.columns.length * 150) }}><thead><tr>{payload.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr className={rowKey(row, index) === selectedKey ? "selected" : ""} key={rowKey(row, index)} onClick={() => setSelectedKey(rowKey(row, index))} onDoubleClick={() => definition?.zoom && setZoom(true)}>{payload.columns.map((column) => <td key={column}>{format(column, row[column])}</td>)}</tr>)}</tbody></table></div>
      {zoom && selected && <aside className="legacy-report-zoom" aria-label="Selected report detail"><header><strong>Zoom · selected real row</strong><button type="button" onClick={() => setZoom(false)}>×</button></header>{detailEntries(selected).map(([key, value]) => <label key={key}><span>{key}</span><b>{format(key, value)}</b></label>)}<footer><button type="button" onClick={() => window.print()}>Print selected</button><button type="button" onClick={() => setZoom(false)}>Close</button></footer></aside>}
    </div>}
    <footer className="legacy-master-actions"><button type="button" disabled={!selected || !definition?.zoom} onClick={() => setZoom(true)}>🔎 Zoom selected</button><button type="button" onClick={() => window.print()}>🖨 Print</button><button type="button" disabled={!payload} onClick={() => payload && downloadCsv(payload.report.title, payload.columns, rows)}>⇩ Export CSV</button><button type="button" onClick={refresh}>🔄 Refresh real data</button><button type="button" onClick={clear}>Reset filters</button></footer>
    <div className="legacy-master-status"><span>{payload ? `${rows.length.toLocaleString("en-IN")} of ${payload.total.toLocaleString("en-IN")} loaded real source rows` : ""}</span><span>Source: PostgreSQL / restored legacy tables</span></div>
  </section>;
}
