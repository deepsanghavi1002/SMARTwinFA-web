"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import type { AskAnswer, AskReply } from "../../lib/ask/ask";
import { pdf } from "../../lib/export/pdf";
import { cellText, download, safeFileName } from "../../lib/export/table";
import type { ExportCell, ExportColumn, ExportTable } from "../../lib/export/table";
import { xlsx } from "../../lib/export/xlsx";
import type { PivotHint, SumifHint } from "../../lib/report/pivotHint";

/**
 * Ask AI: a side panel where a question is typed (or picked from the list) and answered from the open company's own data. There is no
 * model behind it: the server matches the question to a fixed list and runs a fixed read-only query (lib/ask/ask.ts).
 */

type Question = { id: number; question: string };

const grouping = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

function cell(kind: string, value: string | number | undefined): string {
  if (value === undefined || value === "") return "";
  if (kind === "money") return typeof value === "number" ? grouping.format(value) : String(value);
  if (kind === "int") return typeof value === "number" ? whole.format(value) : String(value);
  return String(value);
}

/** An answer's table as it is exported: the columns and rows shown (after any filter), numbers as numbers, the heading lines on top. */
function exportTableOf(answer: AskAnswer, rows: readonly Readonly<Record<string, string | number>>[], company: string): ExportTable {
  const columns: ExportColumn[] = answer.columns.map((column) => {
    const numeric = column.kind === "money" || column.kind === "int";
    return { caption: column.caption, kind: numeric ? "number" : "text", decimals: column.kind === "money" ? 2 : 0, align: numeric ? "right" : "left", width: numeric ? 110 : column.caption.length > 12 ? 180 : 120 };
  });
  const body: ExportCell[][] = rows.map((row) => answer.columns.map((column): ExportCell => {
    const value = row[column.key];
    if (column.kind === "money" || column.kind === "int") return typeof value === "number" ? value : null;
    return value === undefined ? "" : String(value);
  }));
  const labelAt = answer.chart ? answer.columns.findIndex((column) => column.key === answer.chart?.label) : -1;
  const valueAt = answer.chart ? answer.columns.findIndex((column) => column.key === answer.chart?.value) : -1;
  let count = 0;
  while (answer.chart && count < answer.chart.count && count < rows.length && !isTotalRow(rows[count])) count += 1;
  const chart = labelAt >= 0 && valueAt >= 0 && count > 0 ? { label: labelAt, value: valueAt, count } : undefined;
  return { company, title: answer.title.toUpperCase(), ...(chart ? { chart } : {}), subtitle: [answer.summary ?? "", answer.note ? answer.note.split(/(?<=\.)\s/)[0] : ""].filter((line) => line !== ""), columns, rows: body, footerCenter: `${rows.length} rows` };
}

/** Excel, PDF and CSV of what an answer shows. */
function AskExport({ answer, rows, company, user }: { answer: AskAnswer; rows: readonly Readonly<Record<string, string | number>>[]; company: string; user: string }) {
  if (rows.length === 0) return null;
  const name = () => { const now = new Date(); return safeFileName(`${answer.title} - ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`); };
  const table = () => exportTableOf(answer, rows, company);
  const excel = () => download(xlsx(table(), safeFileName(answer.title).slice(0, 31) || "Answer"), `${name()}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const pdfFile = () => { const now = new Date(); download(pdf(table(), { orientation: answer.columns.length > 6 ? "landscape" : "portrait", fontSize: 9, totals: false, footer: `Printed ${cellText(now, { caption: "", kind: "date", decimals: 0, align: "left", width: 0 })} ${now.toTimeString().slice(0, 5)} by ${user}` }), `${name()}.pdf`, "application/pdf"); };
  const csv = () => {
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const built = table();
    const lines = [built.columns.map((column) => quote(column.caption)).join(","), ...built.rows.map((row) => row.map((value, at) => quote(typeof value === "number" ? String(value) : cellText(value, built.columns[at]))).join(","))];
    download(String.fromCharCode(0xfeff) + lines.join("\r\n"), `${name()}.csv`, "text/csv;charset=utf-8");
  };
  return (
    <div className="ask-export" role="group" aria-label="Export">
      <span>Export</span>
      <button type="button" onClick={excel} title="Open in Excel">Excel</button>
      <button type="button" onClick={pdfFile} title="Save as a PDF">PDF</button>
      <button type="button" onClick={csv} title="Comma separated, opens anywhere">CSV</button>
    </div>
  );
}

/** A total or summary line of an answer (its label starts with "Total"): not a row of the data, so a filter takes it away and the count under the table stands in for it. */
const isTotalRow = (row: Readonly<Record<string, string | number>>) => Object.values(row).some((value) => typeof value === "string" && /^total\b/i.test(value.trim()));

/** Whether a row meets what is typed over a column: text is found anywhere in the cell (any case); a number may also be given as > 1000, <= 500, = 0 or != 0. */
function meetsFilter(column: AskAnswer["columns"][number], row: Readonly<Record<string, string | number>>, filter: string): boolean {
  const wanted = filter.trim().toLowerCase();
  if (wanted === "") return true;
  const raw = row[column.key];
  if (column.kind === "money" || column.kind === "int") {
    const compare = /^(>=|<=|!=|<>|==|=|>|<)\s*(-?[\d,]*\.?\d+)$/.exec(wanted);
    if (compare && typeof raw === "number") {
      const right = Number(compare[2].replace(/,/g, ""));
      switch (compare[1]) {
        case ">": return raw > right;
        case "<": return raw < right;
        case ">=": return raw >= right;
        case "<=": return raw <= right;
        case "!=": case "<>": return raw !== right;
        default: return raw === right;
      }
    }
  }
  return cell(column.kind, raw).toLowerCase().includes(wanted) || String(raw ?? "").toLowerCase().includes(wanted);
}

/** The bars of an answer (net sales of each month, today and yesterday ...): drawn from the answer's own rows, so it always agrees with the table below it. */
function AskChart({ answer }: { answer: AskAnswer }) {
  const chart = answer.chart as NonNullable<AskAnswer["chart"]>;
  const bars = answer.rows.slice(0, chart.count).map((row) => ({ label: String(row[chart.label] ?? ""), value: Number(row[chart.value]) || 0 }));
  if (bars.length === 0) return null;
  const top = Math.max(0, ...bars.map((bar) => bar.value));
  const bottom = Math.min(0, ...bars.map((bar) => bar.value));
  const span = top - bottom || 1;
  const width = 640, height = 242, left = 8, right = 8, plotTop = 22, plotBottom = 50;
  const plot = height - plotTop - plotBottom;
  const slot = (width - left - right) / bars.length;
  const bar = Math.min(54, slot * 0.62);
  const zero = plotTop + (top / span) * plot;
  const short = (value: number) => (Math.abs(value) >= 1e7 ? `${(value / 1e7).toFixed(2)} Cr` : Math.abs(value) >= 1e5 ? `${(value / 1e5).toFixed(2)} L` : whole.format(value));
  return (
    <svg className="ask-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${answer.title}: bar chart`}>
      <line x1={left} x2={width - right} y1={zero} y2={zero} className="ask-chart-axis" />
      {bars.map((item, at) => {
        const x = left + slot * at + (slot - bar) / 2;
        const barHeight = Math.max(1, (Math.abs(item.value) / span) * plot);
        const y = item.value >= 0 ? zero - barHeight : zero;
        return (
          <g key={at}>
            <rect x={x} y={y} width={bar} height={barHeight} rx={3} className={item.value >= 0 ? "ask-chart-bar" : "ask-chart-bar ask-chart-neg"}><title>{`${item.label}: ${grouping.format(item.value)}`}</title></rect>
            <text x={x + bar / 2} y={item.value >= 0 ? y - 5 : y + barHeight + 12} textAnchor="middle" className="ask-chart-value">{short(item.value)}</text>
            {(item.label.includes(" (") ? [item.label.slice(0, item.label.indexOf(" (")), item.label.slice(item.label.indexOf(" (") + 1)] : [item.label]).map((line, row) => (
              <text key={row} x={x + bar / 2} y={height - plotBottom + 16 + row * 12} textAnchor="middle" className="ask-chart-label">{line.length > 14 ? `${line.slice(0, 13)}…` : line}</text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** The wait for an answer: a sliding bar, three pulsing dots, how long it has taken and shimmering lines where the answer will come. */
function AskBusy() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="ask-busy" role="status" aria-live="polite">
      <div className="ask-busy-bar" aria-hidden="true" />
      <div className="ask-busy-head">
        <span className="ask-busy-dots" aria-hidden="true"><i /><i /><i /></span>
        <b>{seconds < 8 ? "Looking through your data…" : seconds < 25 ? "Still working, this one reads a lot of entries…" : "Almost there, a large question can take a minute…"}</b>
        <small>{seconds}s</small>
      </div>
      <div className="ask-busy-lines" aria-hidden="true"><span /><span /><span /><span /></div>
    </div>
  );
}

export function AskAi({ minimized, onMinimize, onRestore, onClose, onOpenLedger, onOpenReport }: { minimized: boolean; onMinimize: () => void; onRestore: () => void; onClose: () => void; onOpenLedger: (code: number, from?: string, to?: string) => void; onOpenReport: (name: string, from?: string, to?: string, pivot?: PivotHint, pick?: string, party?: { code: number; name: string }, sumif?: SumifHint, setup?: { choices: Readonly<Record<string, string>>; checks: readonly string[] }) => void }) {
  const selection = useStartupSelection();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<AskReply | null>(null);
  const [error, setError] = useState("");
  const [partyName, setPartyName] = useState("");
  /** The party help: parties matching what is typed (all customers and suppliers by name when nothing is). */
  const [parties, setParties] = useState<{ code: number; name: string; hint?: string }[]>([]);
  const box = useRef<HTMLInputElement>(null);
  /** The panel's width: dragged from its left edge, kept for the next time; the maximize button takes it to the whole screen. */
  const [width, setWidth] = useState(() => { try { return Math.min(Math.max(Number(window.localStorage.getItem("ask-width")) || 560, 360), window.innerWidth); } catch { return 560; } });
  const [maximized, setMaximized] = useState(false);
  /** The question picked from the list last: back at the list ("All questions") the cursor is on it again. */
  const [last, setLast] = useState("");
  /** The lines of the answer opened for their parties (by the line's detail key): clicked once they open under the line, clicked again they close. */
  const [opened, setOpened] = useState<Record<string, AskAnswer>>({});
  useEffect(() => setOpened({}), [reply]);
  const listed = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reply || error || last === "") return;
    const button = Array.from(listed.current?.querySelectorAll<HTMLButtonElement>("button[data-question]") ?? []).find((item) => item.dataset.question === last);
    button?.focus();
    button?.scrollIntoView({ block: "center" });
  }, [reply, error, last, questions]);
  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const move = (at: PointerEvent) => setWidth(Math.min(Math.max(window.innerWidth - at.clientX, 360), window.innerWidth));
    const stop = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop);
      setWidth((now) => { try { window.localStorage.setItem("ask-width", String(now)); } catch { /* not kept */ } return now; });
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop);
  };

  useEffect(() => {
    box.current?.focus();
    fetch("/api/ask", { cache: "no-store" }).then((response) => response.json() as Promise<{ questions?: Question[] }>).then((body) => setQuestions(body.questions ?? [])).catch(() => setQuestions([]));
  }, []);
  useEffect(() => {
    const esc = (event: KeyboardEvent) => { if (event.key === "Escape" && !minimized && !document.querySelector(".msgbox-backdrop")) onMinimize(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [minimized, onMinimize]);

  const send = useCallback(async (question: string, extra: { templateId?: number; partyCode?: number; allParties?: boolean; detail?: string; teach?: string } = {}) => {
    if (!selection || busy || question.trim() === "") return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/ask", {
        method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ question, ...extra, session: { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName } }),
      });
      const body = await response.json() as AskReply & { error?: string };
      if (!response.ok || body.error) throw new Error(body.error || "The question could not be answered");
      setReply(body);
      setPartyName("");
    } catch (reason) {
      setReply(null);
      setError(reason instanceof Error ? reason.message : "The question could not be answered");
    } finally {
      setBusy(false);
    }
  }, [selection, busy]);

  // The party help fills while the panel is asking for a party, as the name is typed.
  const choosing = reply?.kind === "choose-party";
  const pickWhat = reply?.kind === "choose-party" ? reply.what : "party";
  /** What the party is chosen for: the list shows the parties with entries in the question's period, or a balance at its end. */
  const choiceQuestion = reply?.kind === "choose-party" ? reply.question : undefined;
  const choiceTemplate = reply?.kind === "choose-party" ? reply.templateId : undefined;
  useEffect(() => {
    if (!choosing || !selection) return;
    // The parties the question named come first (nothing typed yet): the list is those, not every party.
    if (partyName === "" && reply?.kind === "choose-party" && reply.choices.length > 0) { setParties(reply.choices.map((choice) => ({ code: choice.code, name: choice.name }))); return; }
    let live = true;
    const timer = window.setTimeout(() => {
      fetch("/api/ask", {
        method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ action: pickWhat === "product" ? "products" : "parties", term: partyName, question: choiceQuestion, templateId: choiceTemplate, session: { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName } }),
      }).then((response) => response.json() as Promise<{ parties?: { code: number; name: string; hint?: string }[] }>).then((body) => { if (live) setParties(body.parties ?? []); }).catch(() => { if (live) setParties([]); });
    }, 200);
    return () => { live = false; window.clearTimeout(timer); };
  }, [choosing, pickWhat, partyName, selection, choiceQuestion, choiceTemplate]); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = (question: string, teach?: string) => { setText(question); setLast(question); void send(question, teach ? { teach } : {}); };

  /** The operator's recent and most asked questions (kept on the server), shown on the list of questions. */
  const [memory, setMemory] = useState<{ recent: string[]; favourite: string[] }>({ recent: [], favourite: [] });
  const memoryCall = useCallback((action: "memory" | "forget", question?: string, scope?: "recent" | "favourite") => {
    if (!selection) return Promise.resolve(null);
    return fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify({ action, question, scope, session: { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName } }) })
      .then((response) => response.json() as Promise<{ recent?: string[]; favourite?: string[] }>).catch(() => null);
  }, [selection]);
  useEffect(() => {
    if (reply || error || !selection) return;
    let live = true;
    void memoryCall("memory").then((body) => { if (live && body) setMemory({ recent: body.recent ?? [], favourite: body.favourite ?? [] }); });
    return () => { live = false; };
  }, [reply, error, selection, memoryCall]);
  /** Forgets one remembered question (the x on its chip) or all of them (Clear); the lists follow at once. */
  const forgetQuestion = (question?: string, scope?: "recent" | "favourite") => {
    setMemory((now) => (question === undefined
      ? { recent: scope === "favourite" ? now.recent : [], favourite: scope === "recent" ? now.favourite : [] }
      : { recent: now.recent.filter((item) => item !== question), favourite: now.favourite.filter((item) => item !== question) }));
    void memoryCall("forget", question, scope);
  };
  const group = (from: number, to: number) => questions.filter((item) => item.id >= from && item.id <= to);
  const some = (ids: readonly number[]) => ids.map((id) => questions.find((item) => item.id === id)).filter((item): item is Question => item !== undefined);
  /** The list of questions by heading; what is typed in the box narrows it to the questions that have every word of it (in the question or its heading). */
  const sections: { title: string; list: Question[] }[] = [
    { title: "Accounts and outstanding", list: group(1, 10) }, { title: "Sales and purchase", list: [...group(11, 20), ...group(61, 69)] }, { title: "Profit, returns and costing", list: group(70, 77) },
    { title: "Collection and payments", list: some([80, 90, 91, 92, 93, 94, 95, 96]) }, { title: "Customers and suppliers", list: some([83, 84, 85, 86, 87, 88, 89, 100]) }, { title: "Entry control", list: some([81, 82, 97, 98, 99]) },
    { title: "Trends and concerns", list: some([101, 102, 103, 104, 105]) }, { title: "GST checks", list: some([106, 107, 108, 109, 110]) }, { title: "Management review and forecast", list: some([111, 112, 113, 114, 115, 116, 138, 139]) },
    { title: "Cash flow, credit and collection", list: some([117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 140]) }, { title: "Suppliers, purchase orders and stock holding", list: some([127, 128, 129, 130, 131, 132]) },
    { title: "Expenses and overheads", list: some([133, 134, 135, 136, 137]) }, { title: "Manufacturing and finished-product costing", list: some([141, 142, 143, 144, 145, 146, 147, 148, 149]) },
    { title: "Production", list: some([150, 151]) }, { title: "Expenses and salesmen", list: some([152, 153]) },
    { title: "Inventory and stock", list: group(31, 40) }, { title: "Banking, cash and expenses", list: group(41, 50) }, { title: "Financial reports and analysis", list: group(51, 60) },
  ];
  const words = text.toLowerCase().split(/[^a-z0-9%]+/).filter((word) => word !== "");
  const searching = words.length > 0;
  const searched = searching
    ? sections.map((section) => ({ title: section.title, list: section.list.filter((item) => words.every((word) => `${item.question} ${section.title}`.toLowerCase().includes(word))) })).filter((section) => section.list.length > 0)
    : sections;

  const answer: AskAnswer | null = reply?.kind === "answer" ? reply.answer : null;
  /** What is typed (or picked) over each column of the answer's table. */
  const [filters, setFilters] = useState<Record<string, string>>({});
  useEffect(() => setFilters({}), [reply]);
  const filtering = answer !== null && answer.columns.some((column) => (filters[column.key] ?? "").trim() !== "");
  const shown = answer === null ? [] : answer.rows.map((row, at) => ({ row, at })).filter(({ row }) => !filtering || (!isTotalRow(row) && answer.columns.every((column) => meetsFilter(column, row, filters[column.key] ?? ""))));
  /** A column with a few different values is filtered from a list, any other by typing. */
  const choicesOf = (column: AskAnswer["columns"][number]): string[] | null => {
    if (!answer || column.kind !== "text") return null;
    const values = new Set<string>();
    for (const row of answer.rows) { const value = String(row[column.key] ?? "").trim(); if (value !== "" && !isTotalRow(row)) values.add(value); if (values.size > 12) return null; }
    return values.size >= 2 ? [...values].sort((a, b) => a.localeCompare(b)) : null;
  };
  return (
    <aside className={`ask-panel${minimized ? " ask-min" : ""}${maximized ? " ask-max" : ""}`} style={minimized || maximized ? undefined : { width }} aria-label="Ask AI">
      {!minimized && !maximized && <div className="ask-grip" title="Drag to resize" onPointerDown={drag} onDoubleClick={() => setWidth(560)} />}
      <header>
        <strong>✨ Ask AI</strong>
        <span className="ask-head-buttons">
          <button type="button" className="ask-x" aria-label={minimized ? "Restore" : "Minimize"} title={minimized ? "Restore" : "Minimize (Esc)"} onClick={minimized ? onRestore : onMinimize}>{minimized ? "▢" : "–"}</button>
          {!minimized && <button type="button" className="ask-x" aria-label={maximized ? "Smaller" : "Bigger"} title={maximized ? "Smaller" : "Bigger"} onClick={() => setMaximized((now) => !now)}>{maximized ? "❐" : "☐"}</button>}
          <button type="button" className="ask-x" aria-label="Close" title="Close" onClick={onClose}>×</button>
        </span>
      </header>
      <form className="ask-form" hidden={minimized} onSubmit={(event) => { event.preventDefault(); void send(text); }}>
        <input ref={box} value={text} maxLength={300} placeholder="Type to search the questions, or ask, e.g. top 10 outstanding customers" aria-label="Question" onChange={(event) => setText(event.target.value)} />
        <button type="submit" disabled={busy || text.trim() === ""}>{busy ? <span className="ask-spin" aria-label="Working" /> : "Ask"}</button>
      </form>
      <div className={`ask-body${busy ? " ask-body-busy" : ""}`} hidden={minimized}>
        {busy && <AskBusy />}
        {(reply || error) && <button type="button" className="ask-back" onClick={() => { setReply(null); setError(""); setText(""); box.current?.focus(); }}>← All questions</button>}
        {error && <p className="ask-error" role="alert">{error}</p>}
        {reply?.kind === "refuse" && (
          <div className="ask-card">
            <p>{reply.message}</p>
            <p className="ask-note">Pick the nearest question: it answers now, and your wording is remembered for next time.</p>
            <ul className="ask-list">{reply.suggestions.map((item) => <li key={item}><button type="button" onClick={() => { const original = text; ask(item, original); }}>{item}</button></li>)}</ul>
          </div>
        )}
        {reply?.kind === "choose-party" && (
          <div className="ask-card">
            <p>{reply.what === "product" ? "Choose the product (type to search):" : "Choose the party (type to search):"}</p>
            {reply.allParties && <button type="button" className="ask-all" onClick={() => void send(reply.question, { templateId: reply.templateId, allParties: true })}>All parties (trial balance)</button>}
            <form className="ask-form ask-party-box" onSubmit={(event) => { event.preventDefault(); if (parties.length === 1) void send(reply.question, { templateId: reply.templateId, partyCode: parties[0].code }); }}>
              <input value={partyName} placeholder={reply.what === "product" ? "Product name" : "Party name"} aria-label={reply.what === "product" ? "Product name" : "Party name"} onChange={(event) => setPartyName(event.target.value)} ref={(element) => { if (element && !element.dataset.once) { element.dataset.once = "1"; element.focus(); } }} />
            </form>
            <ul className="ask-list ask-parties" role="listbox" aria-label="Choices">
              {parties.map((item) => <li key={item.code}><button type="button" role="option" aria-selected="false" onClick={() => void send(reply.question, { templateId: reply.templateId, partyCode: item.code })}>{item.name}{item.hint ? <small> · {item.hint}</small> : null}</button></li>)}
              {parties.length === 0 && <li className="ask-empty">Nothing found.</li>}
            </ul>
          </div>
        )}
        {answer && (
          <div className="ask-card">
            <h3>{answer.title}</h3>
            {answer.summary && <p className="ask-summary">{answer.summary}</p>}
            <AskExport answer={answer} rows={shown.map((entry) => entry.row)} company={selection?.companyName ?? ""} user={selection?.loginName ?? ""} />
            {answer.choices && <div className="ask-choices">{answer.choices.map((choice) => <button key={choice.label} type="button" disabled={busy} onClick={() => ask(choice.question)}>{choice.label}</button>)}</div>}
            {answer.chart && answer.rows.length > 0 && <AskChart answer={answer} />}
            {answer.rows.length === 0 ? (answer.report || answer.ledger ? null : <p className="ask-empty">No records found.</p>) : (
              <div className="ask-scroll">
                <table className="ask-table">
                  <thead>
                    <tr>{answer.columns.map((column) => <th key={column.key} className={column.kind === "money" || column.kind === "int" ? "ask-num" : undefined}>{column.caption}</th>)}</tr>
                    {answer.rows.length > 5 && (
                      <tr className="ask-filter">{answer.columns.map((column) => {
                        const choices = choicesOf(column);
                        return (
                          <th key={column.key}>
                            {choices ? (
                              <select aria-label={`Filter ${column.caption}`} value={filters[column.key] ?? ""} onChange={(event) => setFilters((now) => ({ ...now, [column.key]: event.target.value }))}>
                                <option value="">All</option>{choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
                              </select>
                            ) : (
                              <input aria-label={`Filter ${column.caption}`} value={filters[column.key] ?? ""} placeholder={column.kind === "money" || column.kind === "int" ? "> 1000" : "filter"} onChange={(event) => setFilters((now) => ({ ...now, [column.key]: event.target.value }))} />
                            )}
                          </th>
                        );
                      })}</tr>
                    )}
                  </thead>
                  <tbody>{shown.map(({ row, at }) => {
                    const code = typeof row.code === "number" && row.code > 0 ? row.code : 0;
                    const detail = typeof row.detail === "string" ? row.detail : "";
                    const open = () => {
                      if (opened[detail]) { setOpened(({ [detail]: _gone, ...rest }) => rest); return; }
                      if (!selection) return;
                      fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify({ question: text, templateId: answer.id, detail, session: { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName } }) })
                        .then((response) => response.json() as Promise<AskReply>).then((body) => { if (body.kind === "answer") setOpened((now) => ({ ...now, [detail]: body.answer })); }).catch(() => undefined);
                    };
                    const under = detail ? opened[detail] : undefined;
                    return (
                    <Fragment key={at}>
                    <tr className={code || detail ? "ask-row-link" : undefined} tabIndex={code || detail ? 0 : undefined} title={detail ? "Click to show the parties, click again to hide them" : code ? "Double-click or press Enter to open the ledger" : undefined}
                      onClick={detail ? open : undefined}
                      onDoubleClick={code ? () => onOpenLedger(code, answer.period?.from, answer.period?.to) : undefined}
                      onKeyDown={code || detail ? (event) => {
                        if (event.key === "Enter") { event.preventDefault(); if (detail) open(); else onOpenLedger(code, answer.period?.from, answer.period?.to); }
                        else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                          event.preventDefault();
                          let next = event.currentTarget as Element | null;
                          do { next = event.key === "ArrowDown" ? next?.nextElementSibling ?? null : next?.previousElementSibling ?? null; } while (next && (next as HTMLElement).tabIndex < 0);
                          (next as HTMLElement | null)?.focus();
                        }
                      } : undefined}>{answer.columns.map((column) => <td key={column.key} className={column.kind === "money" || column.kind === "int" ? "ask-num" : "ask-text"} title={column.kind === "text" ? cell(column.kind, row[column.key]) : undefined}>{cell(column.kind, row[column.key])}</td>)}</tr>
                    {under && (
                      <tr className="ask-under"><td colSpan={answer.columns.length}>
                        <AskExport answer={under} rows={under.rows} company={selection?.companyName ?? ""} user={selection?.loginName ?? ""} />
                        <div className="ask-scroll ask-sub">
                          <table className="ask-table">
                            <thead><tr>{under.columns.map((column) => <th key={column.key} className={column.kind === "money" || column.kind === "int" ? "ask-num" : undefined}>{column.caption}</th>)}</tr></thead>
                            <tbody>{under.rows.length === 0 ? <tr><td colSpan={under.columns.length} className="ask-empty">No records found.</td></tr> : under.rows.map((sub, index) => {
                              const subCode = typeof sub.code === "number" && sub.code > 0 ? sub.code : 0;
                              return <tr key={index} className={subCode ? "ask-row-link" : undefined} title={subCode ? "Double-click to open the ledger" : undefined} onDoubleClick={subCode ? () => onOpenLedger(subCode, answer.period?.from, answer.period?.to) : undefined}>{under.columns.map((column) => <td key={column.key} className={column.kind === "money" || column.kind === "int" ? "ask-num" : "ask-text"}>{cell(column.kind, sub[column.key])}</td>)}</tr>;
                            })}</tbody>
                          </table>
                        </div>
                      </td></tr>
                    )}
                    </Fragment>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
            {filtering && <p className="ask-note ask-filter-count">Showing {shown.length.toLocaleString("en-IN")} of {answer.rows.filter((row) => !isTotalRow(row)).length.toLocaleString("en-IN")} rows (the total line is hidden while a filter is on). <button type="button" className="ask-clear" onClick={() => setFilters({})}>Clear filters</button></p>}
            {answer.note && <p className="ask-note">{answer.note}</p>}
            {answer.rows.some((row) => typeof row.code === "number" && row.code > 0) && <p className="ask-note">Double-click a row, or press Enter on it, to open the ledger of that party.</p>}
            {answer.report && <button type="button" className="ask-open" onClick={() => onOpenReport(answer.report!.name, answer.report!.from, answer.report!.to, answer.report!.pivot, answer.report!.pick, answer.report!.party, answer.report!.sumif, answer.report!.setup)}>{answer.report.label}</button>}
            {answer.ledger && <button type="button" className="ask-open" onClick={() => onOpenLedger(answer.ledger!.code, answer.period?.from, answer.period?.to)}>Open ledger report</button>}
          </div>
        )}
        {!reply && !error && (
          <div className="ask-card" ref={listed}>
            <p className="ask-note">Pick a question, or type your own in plain words. Answers come straight from your data; nothing is guessed.</p>
            {!searching && (memory.recent.length > 0 || memory.favourite.length > 0) && (
              <div className="ask-memory">
                {([["Recently asked", memory.recent, "r"], ["Most asked", memory.favourite, "f"]] as const).map(([heading, list, tag]) => list.length > 0 && (
                  <Fragment key={tag}>
                    <h4>{heading}<button type="button" className="ask-clear" onClick={() => forgetQuestion(undefined, tag === "r" ? "recent" : "favourite")} title={tag === "r" ? "Forget the recently asked questions" : "Forget the most asked questions"}>Clear all</button></h4>
                    <div className="ask-chips">{list.map((item) => (
                      <span key={`${tag}-${item}`} className="ask-chip">
                        <button type="button" data-question={item} onClick={() => ask(item)}>{item}</button>
                        <button type="button" className="ask-chip-x" aria-label={`Forget: ${item}`} title="Forget this question" onClick={() => forgetQuestion(item)}>×</button>
                      </span>
                    ))}</div>
                  </Fragment>
                ))}
              </div>
            )}
            {searched.length === 0 && <p className="ask-note">No listed question has "{text.trim()}" in it. Press Ask to put the question in your own words.</p>}
            {searched.length > 0 && searching && <p className="ask-note">{searched.reduce((total, section) => total + section.list.length, 0)} listed questions have all of these words. Press Ask to put your own wording.</p>}
            {searched.map((section) => (
              <Fragment key={section.title}>
                <h4>{section.title}</h4>
                <ul className="ask-list">{section.list.map((item) => <li key={item.id}><button type="button" data-question={item.question} onClick={() => ask(item.question)}>{item.question}</button></li>)}</ul>
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
