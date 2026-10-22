"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import type { AskAnswer, AskReply } from "../../lib/ask/ask";

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

export function AskAi({ minimized, onMinimize, onRestore, onClose, onOpenLedger, onOpenReport }: { minimized: boolean; onMinimize: () => void; onRestore: () => void; onClose: () => void; onOpenLedger: (code: number) => void; onOpenReport: (name: string) => void }) {
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

  const send = useCallback(async (question: string, extra: { templateId?: number; partyCode?: number; allParties?: boolean; detail?: string } = {}) => {
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
  useEffect(() => {
    if (!choosing || !selection) return;
    let live = true;
    const timer = window.setTimeout(() => {
      fetch("/api/ask", {
        method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ action: pickWhat === "product" ? "products" : "parties", term: partyName, session: { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName } }),
      }).then((response) => response.json() as Promise<{ parties?: { code: number; name: string; hint?: string }[] }>).then((body) => { if (live) setParties(body.parties ?? []); }).catch(() => { if (live) setParties([]); });
    }, 200);
    return () => { live = false; window.clearTimeout(timer); };
  }, [choosing, pickWhat, partyName, selection]);

  const ask = (question: string) => { setText(question); setLast(question); void send(question); };
  const group = (from: number, to: number) => questions.filter((item) => item.id >= from && item.id <= to);

  const answer: AskAnswer | null = reply?.kind === "answer" ? reply.answer : null;
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
        <input ref={box} value={text} maxLength={300} placeholder="Ask about your accounts, e.g. top 10 outstanding customers" aria-label="Question" onChange={(event) => setText(event.target.value)} />
        <button type="submit" disabled={busy || text.trim() === ""}>{busy ? "…" : "Ask"}</button>
      </form>
      <div className="ask-body" hidden={minimized}>
        {(reply || error) && <button type="button" className="ask-back" onClick={() => { setReply(null); setError(""); setText(""); box.current?.focus(); }}>← All questions</button>}
        {error && <p className="ask-error" role="alert">{error}</p>}
        {reply?.kind === "refuse" && (
          <div className="ask-card">
            <p>{reply.message}</p>
            <ul className="ask-list">{reply.suggestions.map((item) => <li key={item}><button type="button" onClick={() => ask(item)}>{item}</button></li>)}</ul>
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
            {answer.choices && <div className="ask-choices">{answer.choices.map((choice) => <button key={choice.label} type="button" disabled={busy} onClick={() => ask(choice.question)}>{choice.label}</button>)}</div>}
            {answer.rows.length === 0 ? (answer.report ? null : <p className="ask-empty">No records found.</p>) : (
              <div className="ask-scroll">
                <table className="ask-table">
                  <thead><tr>{answer.columns.map((column) => <th key={column.key} className={column.kind === "money" || column.kind === "int" ? "ask-num" : undefined}>{column.caption}</th>)}</tr></thead>
                  <tbody>{answer.rows.map((row, at) => {
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
                      onDoubleClick={code ? () => onOpenLedger(code) : undefined}
                      onKeyDown={code || detail ? (event) => {
                        if (event.key === "Enter") { event.preventDefault(); if (detail) open(); else onOpenLedger(code); }
                        else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                          event.preventDefault();
                          let next = event.currentTarget as Element | null;
                          do { next = event.key === "ArrowDown" ? next?.nextElementSibling ?? null : next?.previousElementSibling ?? null; } while (next && (next as HTMLElement).tabIndex < 0);
                          (next as HTMLElement | null)?.focus();
                        }
                      } : undefined}>{answer.columns.map((column) => <td key={column.key} className={column.kind === "money" || column.kind === "int" ? "ask-num" : "ask-text"} title={column.kind === "text" ? cell(column.kind, row[column.key]) : undefined}>{cell(column.kind, row[column.key])}</td>)}</tr>
                    {under && (
                      <tr className="ask-under"><td colSpan={answer.columns.length}>
                        <div className="ask-scroll ask-sub">
                          <table className="ask-table">
                            <thead><tr>{under.columns.map((column) => <th key={column.key} className={column.kind === "money" || column.kind === "int" ? "ask-num" : undefined}>{column.caption}</th>)}</tr></thead>
                            <tbody>{under.rows.length === 0 ? <tr><td colSpan={under.columns.length} className="ask-empty">No records found.</td></tr> : under.rows.map((sub, index) => {
                              const subCode = typeof sub.code === "number" && sub.code > 0 ? sub.code : 0;
                              return <tr key={index} className={subCode ? "ask-row-link" : undefined} title={subCode ? "Double-click to open the ledger" : undefined} onDoubleClick={subCode ? () => onOpenLedger(subCode) : undefined}>{under.columns.map((column) => <td key={column.key} className={column.kind === "money" || column.kind === "int" ? "ask-num" : "ask-text"}>{cell(column.kind, sub[column.key])}</td>)}</tr>;
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
            {answer.note && <p className="ask-note">{answer.note}</p>}
            {answer.rows.some((row) => typeof row.code === "number" && row.code > 0) && <p className="ask-note">Double-click a row, or press Enter on it, to open the ledger of that party.</p>}
            {answer.report && <button type="button" className="ask-open" onClick={() => onOpenReport(answer.report!.name)}>{answer.report.label}</button>}
            {answer.ledger && <button type="button" className="ask-open" onClick={() => onOpenLedger(answer.ledger!.code)}>Open ledger report</button>}
          </div>
        )}
        {!reply && !error && (
          <div className="ask-card" ref={listed}>
            <p className="ask-note">Pick a question, or type your own in plain words. Answers come straight from your data; nothing is guessed.</p>
            <h4>Accounts and outstanding</h4>
            <ul className="ask-list">{group(1, 10).map((item) => <li key={item.id}><button type="button" data-question={item.question} onClick={() => ask(item.question)}>{item.question}</button></li>)}</ul>
            <h4>Sales and purchase</h4>
            <ul className="ask-list">{group(11, 20).map((item) => <li key={item.id}><button type="button" data-question={item.question} onClick={() => ask(item.question)}>{item.question}</button></li>)}</ul>
            <h4>Inventory and stock</h4>
            <ul className="ask-list">{group(31, 40).map((item) => <li key={item.id}><button type="button" data-question={item.question} onClick={() => ask(item.question)}>{item.question}</button></li>)}</ul>
            <h4>Banking, cash and expenses</h4>
            <ul className="ask-list">{group(41, 50).map((item) => <li key={item.id}><button type="button" data-question={item.question} onClick={() => ask(item.question)}>{item.question}</button></li>)}</ul>
            <h4>Financial reports and analysis</h4>
            <ul className="ask-list">{group(51, 60).map((item) => <li key={item.id}><button type="button" data-question={item.question} onClick={() => ask(item.question)}>{item.question}</button></li>)}</ul>
          </div>
        )}
      </div>
    </aside>
  );
}
