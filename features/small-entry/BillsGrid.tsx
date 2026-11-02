"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEditorTools } from "../grid/EditorTools";
import { selectionTotals } from "../grid/totals";
import { activeScope } from "../ui/activeWindow";
import { FilterButton, FilterPopup, useColumnFilters } from "../grid/ColumnFilter";
import { filterHolds, sortedDistinct } from "../grid/filter";
import type { FilterKind } from "../grid/filter";
import { FoundText } from "../grid/FoundText";
import { findPosition, typedBuffer } from "../grid/typeFind";
import { useColumnLayout } from "../grid/useColumnLayout";
import { parseDesktopDate } from "../../lib/master-program/legacy";

/**
 * Small_Entry's c1dg_SmallEntryDataGrid for Outstanding Allocation (19): the account's pending
 * bills under the receipts grid. The operator types how much of the receipt chosen above goes
 * against each bill; together they may not be more than the receipt (AfterEdit's check, which
 * the screen makes as each figure is typed and Save makes again), and a figure may not be more than its bill.
 *
 * The standard grid controls: a heading's text sorts (ascending, descending, as they came), each heading has the column filter (▾),
 * its right edge drags the width, and with the keyboard on the grid (not in a Set Off box) typing finds a row in the current column
 * from the row the cursor is on; ← → change the column, ↑ ↓ the row, Enter goes into that row's Set Off box. Shift+↑ ↓ (or Shift+click, or dragging
 * over the cells) selects rows of a column, and the status bar below shows the Sum, Count and Average of an Amount or Set Off selection. A Set Off
 * box has the calculator (+ - * / % =) and takes a positive amount only.
 */

type Bill = Readonly<Record<string, string>>;

const amountOf = (value: string | undefined) => Number((value ?? "").replace(/,/g, "").trim()) || 0;
const shown = (value: number) => value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const keyOf = (bill: Bill) => bill.led_key ?? bill.LED_KEY ?? "";

type BillColumn = Readonly<{ key: string; caption: string; width: number; kind: FilterKind }>;
const COLUMNS: readonly BillColumn[] = [
  { key: "Date", caption: "Date", width: 120, kind: "date" },
  { key: "Bill_No", caption: "Bill No", width: 220, kind: "text" },
  { key: "AMOUNT", caption: "Amount", width: 140, kind: "number" },
  { key: "setoff", caption: "Set Off", width: 140, kind: "number" },
];
/** The calculator's answer for a Set Off: two places, positive. */
const SETOFF_RULES = { decimals: 2, positiveOnly: true, rangeFrom: 0, rangeUpto: 0 } as const;

export function BillsGrid({ bills, setoffs, receiptAmount, receiptLabel, onChange, onRefused, onDone }: {
  bills: readonly Bill[];
  setoffs: Readonly<Record<string, string>>;
  receiptAmount: number;
  receiptLabel: string;
  onChange: (key: string, value: string) => void;
  /** Says the message; the screen's answer comes back when the operator presses OK. */
  onRefused: (message: string) => Promise<unknown> | void;
  /** The set-offs add up to the receipt (nothing left), or F5: the keyboard goes to the Save button. */
  onDone: () => void;
}) {
  const total = Object.values(setoffs).reduce((sum, value) => sum + amountOf(value), 0);
  const layout = useColumnLayout(COLUMNS, 0, (column) => column.width);
  const filters = useColumnFilters();
  const [sort, setSort] = useState<{ key: string; down: boolean } | null>(null);
  const [current, setCurrent] = useState(0);
  const [col, setCol] = useState(1);
  const [found, setFound] = useState("");
  /** The row where a selection started (its place in the rows shown); the selection runs from it to the cursor row, in the current column. */
  const [selFrom, setSelFrom] = useState<number | null>(null);
  /** The row a drag over the cells started on (null when no drag). */
  const dragging = useRef<number | null>(null);
  const [warn, setWarn] = useState("");
  const tools = useEditorTools(null, { altCalculator: false });
  const typed = useRef({ text: "", at: 0 });
  const box = useRef<HTMLDivElement>(null);
  const align = (column: BillColumn) => (column.kind === "number" ? "right" : "left");
  /** What a cell holds (for sorting and filtering) and as it shows. */
  const rawOf = (bill: Bill, column: BillColumn) => (column.key === "setoff" ? setoffs[keyOf(bill)] ?? "" : column.key === "AMOUNT" ? bill.AMOUNT ?? "" : column.key === "Date" ? bill.Date ?? "" : bill.Bill_No ?? "");
  const shownOf = (bill: Bill, column: BillColumn) => {
    if (column.kind !== "number") return rawOf(bill, column);
    const value = amountOf(rawOf(bill, column));
    return column.key === "setoff" && value === 0 ? "" : shown(value);
  };

  /** The bills' places as shown: after the column filters, in the heading's sort order (else as the bills came: date, bill no). */
  const order = useMemo(() => {
    const held = (skip: string | null) => bills.map((_bill, index) => index).filter((index) => COLUMNS.every((column) => {
      if (column.key === skip) return true;
      const filter = filters.filters[column.key];
      return !filter || filterHolds(column.kind, filter, rawOf(bills[index], column), shownOf(bills[index], column));
    }));
    const kept = held(null);
    const sorted = sort ? COLUMNS.find((candidate) => candidate.key === sort.key) : undefined;
    if (!sort || !sorted) return { kept, held };
    const keyFor = (index: number): number | string => {
      const raw = rawOf(bills[index], sorted);
      return sorted.kind === "number" ? amountOf(raw) : sorted.kind === "date" ? parseDesktopDate(raw)?.getTime() ?? 0 : raw.trim().toUpperCase();
    };
    return { kept: [...kept].sort((a, b) => {
      const left = keyFor(a);
      const right = keyFor(b);
      const diff = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true });
      return sort.down ? -diff : diff;
    }), held };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, setoffs, filters.filters, sort]);
  const rows = order.kept;
  const valuesOf = (column: BillColumn) => sortedDistinct(order.held(column.key).map((index) => shownOf(bills[index], column)));

  /** Puts the keyboard back in a bill's Set Off box (after a message's OK), the cell empty and selected. */
  const focusSetoff = (key: string) => {
    const again = () => {
      const input = box.current?.querySelector<HTMLInputElement>(`input[data-bill="${CSS.escape(key)}"]`);
      input?.focus();
      input?.select();
    };
    again();
    setTimeout(again, 0);
  };
  /** After the box's own value is kept (a tick later, as the screen redraws first). */
  const finish = () => { setTimeout(onDone, 0); };
  const commit = async (key: string, value: string) => {
    const plain = value.replace(/,/g, "").trim();
    const refuse = async (message: string) => { onChange(key, ""); await onRefused(message); focusSetoff(key); };
    if (plain !== "" && !/^\d+(\.\d{0,2})?$/.test(plain)) { await refuse("Only a positive amount is allowed"); return; }
    const bill = bills.find((candidate) => keyOf(candidate) === key);
    if (bill && amountOf(plain) > amountOf(bill.AMOUNT) + 1e-9) { await refuse(`Setoff Amount greater than Bill Amount ${shown(amountOf(bill.AMOUNT))} Not Allowed`); return; }
    const others = total - amountOf(setoffs[key]);
    if (others + amountOf(plain) > receiptAmount + 1e-9) { await refuse(`Setoff Amount greater than equal ${receiptAmount} Not Allowed`); return; }
    onChange(key, plain);
    // Nothing left of the receipt: the set-off is complete, on to Save.
    if (amountOf(plain) > 0 && Number((receiptAmount - others - amountOf(plain)).toFixed(2)) === 0) finish();
  };
  /** The Set Off box lost the keyboard: checked then, unless it went to the calculator opened from the box. */
  const leave = (key: string, value: string) => {
    setTimeout(() => {
      if (document.activeElement?.closest(".mp-calc-backdrop") || activeScope().querySelector(".mp-calc-backdrop")) return;
      void commit(key, value);
    }, 0);
  };
  /** In a Set Off box: Enter and ↓ go to the next row's box, ↑ the one before, Esc gives the keyboard back to the grid. */
  const inputKeys = (event: ReactKeyboardEvent<HTMLInputElement>, key: string) => {
    if (tools.keys(event, "number", setoffs[key] ?? "", (value) => onChange(key, value), SETOFF_RULES, false, undefined, true)) return;
    // As the Outstanding grid of the entry screen: F4 puts the bill's pending amount in the box, F8 the balance of the receipt (not more than the bill).
    if (event.key === "F4" || event.key === "F8") {
      event.preventDefault();
      const bill = bills.find((candidate) => keyOf(candidate) === key);
      const pending = amountOf(bill?.AMOUNT);
      const left = Number((receiptAmount - (total - amountOf(setoffs[key]))).toFixed(2));
      // F4: the pending amount, or the balance of the receipt when that is less; F8: the balance, not more than the bill.
      const amount = event.key === "F4" ? Math.min(pending, left) : Math.min(left, pending);
      if (amount > 0) {
        onChange(key, amount.toFixed(2));
        setWarn("");
        if (Number((receiptAmount - (total - amountOf(setoffs[key])) - amount).toFixed(2)) === 0) finish();
      } else setWarn(pending <= 0 ? "No pending amount on this bill" : "Nothing is left of the receipt");
      return;
    }
    if (event.key === "F5") { event.preventDefault(); finish(); return; }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); box.current?.focus(); return; }
    if (event.key !== "Enter" && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const inputs = [...(event.currentTarget.closest("table")?.querySelectorAll<HTMLInputElement>("input") ?? [])];
    const at = inputs.indexOf(event.currentTarget);
    inputs[event.key === "ArrowUp" ? Math.max(0, at - 1) : Math.min(inputs.length - 1, at + 1)]?.focus();
  };
  /** With the keyboard on the grid itself: the standard moves and the type to find. */
  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const last = rows.length - 1;
    const at = Math.min(current, Math.max(0, last));
    // Shift with a move extends the selection (from where it began, else from this row); a plain move clears it.
    const move = (row: number) => {
      event.preventDefault(); typed.current.text = ""; setFound("");
      setSelFrom(event.shiftKey ? selFrom ?? at : null);
      setCurrent(Math.max(0, Math.min(last, row)));
    };
    if (event.ctrlKey && event.key.toLowerCase() === "a") { event.preventDefault(); setSelFrom(0); setCurrent(Math.max(0, last)); return; }
    if (event.key === "ArrowDown") { move(at + 1); return; }
    if (event.key === "ArrowUp") { move(at - 1); return; }
    if (event.key === "Home") { move(0); return; }
    if (event.key === "End") { move(last); return; }
    if (event.key === "Escape" && selFrom !== null) { event.preventDefault(); event.stopPropagation(); setSelFrom(null); return; }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault(); typed.current.text = ""; setFound(""); setSelFrom(null);
      setCol((now) => Math.max(0, Math.min(COLUMNS.length - 1, now + (event.key === "ArrowRight" ? 1 : -1))));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      box.current?.querySelector<HTMLElement>(`tbody tr:nth-child(${at + 1}) input`)?.focus();
      return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    const now = Date.now();
    const text = typedBuffer(typed.current, now, event.key);
    typed.current = { text, at: now };
    const column = COLUMNS[Math.min(col, COLUMNS.length - 1)];
    const match = findPosition(rows.length, (position) => shownOf(bills[rows[position]], column), text, column.kind, at);
    if (match.at >= 0 || match.empty) { if (match.at >= 0) setCurrent(match.at); setFound(text); } else typed.current.text = text.slice(0, -1);
  };
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("tr.ent-grid-current")?.scrollIntoView({ block: "nearest" });
  }, [current, rows.length, sort]);
  // A new list of rows (a filter, a sort, another account) ends a selection.
  useEffect(() => { setSelFrom(null); }, [filters.filters, sort, bills]);

  const column = COLUMNS[Math.min(col, COLUMNS.length - 1)];
  const lastRow = Math.max(0, rows.length - 1);
  const from = selFrom === null ? -1 : Math.min(selFrom, lastRow);
  const low = from < 0 ? -1 : Math.min(from, Math.min(current, lastRow));
  const high = from < 0 ? -1 : Math.max(from, Math.min(current, lastRow));
  /** Sum, count and average of the selected rows of an Amount or Set Off column. */
  const totals = from >= 0 && column.kind === "number" ? selectionTotals(rows.slice(low, high + 1).map((index) => rawOf(bills[index], column)), 2) : null;
  /** The status bar's hint for the cell the cursor is on. */
  const hint = warn !== "" ? warn : column.key === "setoff" ? "Set Off · Positive only · Not more than the bill Amount · F4 Pending · F8 Balance of receipt · + - * / % = Calculator · F5 Save · Esc Grid" : `${column.caption} · type to find · Shift+↑↓ select ${column.kind === "number" ? "(Sum / Average)" : ""}`;

  return (
    <section className="se-bills" aria-label="Pending bills">
      <div className="se-bills-head">
        <b>Pending bills</b>
        <span>Receipt {receiptLabel}: {shown(receiptAmount)} · Set off: {shown(total)} · Left: {shown(receiptAmount - total)}</span>
      </div>
      <div ref={box} className="ent-grid se-bills-scroll" role="grid" aria-label="Pending bills" tabIndex={0} onKeyDown={keys}>
        <table>
          <colgroup>{COLUMNS.map((column) => <col key={column.key} style={{ width: layout.widthOf(column) }} />)}</colgroup>
          <thead>
            <tr>{COLUMNS.map((column, at) => (
              <th key={column.key} style={{ textAlign: align(column) }} title={column.caption} className={["ent-th-filterable", filters.filters[column.key] ? "ent-filtered" : ""].filter(Boolean).join(" ")}>
                <button type="button" tabIndex={-1} className="ent-th-text ent-sortable" title={`${column.caption} · click to sort (ascending, descending, none)`} onClick={() => { setCol(at); setSort((now) => (now?.key !== column.key ? { key: column.key, down: false } : now.down ? null : { key: column.key, down: true })); }}>{column.caption}{sort?.key === column.key ? <span className="ent-sort-mark">{sort.down ? " ▼" : " ▲"}</span> : null}</button>
                <FilterButton caption={column.caption} skipTab onOpen={() => filters.open(column.key, valuesOf(column))} />
                {layout.resizeHandle(column)}
                <FilterPopup state={filters} columnKey={column.key} caption={column.caption} kind={column.kind} values={filters.openFilter === column.key ? valuesOf(column) : []} area={box} floating />
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.map((index, place) => {
              const bill = bills[index];
              const key = keyOf(bill);
              return (
                <tr key={key} className={[place % 2 ? "ent-alt" : "", amountOf(setoffs[key]) > 0 ? "se-bill-set" : "", place === Math.min(current, rows.length - 1) ? "ent-grid-current" : ""].filter(Boolean).join(" ")} onMouseDown={() => { typed.current.text = ""; setFound(""); }}>
                  {COLUMNS.map((column, at) => (
                    <td
                      key={column.key}
                      className={[column.kind === "number" ? "se-num" : "", place === current && at === col ? "ent-grid-cell" : "", from >= 0 && at === col && place >= low && place <= high ? "se-sel" : ""].filter(Boolean).join(" ")}
                      onMouseDown={(event) => {
                        // Shift+click selects from the row the cursor was on; a plain click starts a selection a drag can stretch.
                        setCol(at);
                        if (event.shiftKey) { setSelFrom((now) => now ?? current); box.current?.focus({ preventScroll: true }); event.preventDefault(); }
                        else { setSelFrom(null); dragging.current = place; }
                        setCurrent(place);
                      }}
                      onMouseEnter={(event) => { if (dragging.current !== null && event.buttons === 1 && dragging.current !== place) { setSelFrom(dragging.current); setCurrent(place); } }}
                      onMouseUp={() => { dragging.current = null; }}
                    >
                      {column.key === "setoff" ? (
                        <input
                          aria-label={`Set off against ${bill.Bill_No}`}
                          inputMode="decimal"
                          data-bill={key}
                          value={setoffs[key] ?? ""}
                          onFocus={() => { setCurrent(place); setCol(at); setSelFrom(null); setWarn(""); }}
                          onChange={(event) => {
                            // Positive only: a sign or a letter is not taken.
                            if (!/^[\d.,]*$/.test(event.target.value)) { setWarn("Only a positive amount is allowed"); return; }
                            setWarn("");
                            onChange(key, event.target.value);
                          }}
                          onBlur={(event) => leave(key, event.target.value)}
                          onKeyDown={(event) => inputKeys(event, key)}
                          onMouseDown={(event) => { if (event.shiftKey) { event.preventDefault(); setCol(at); setSelFrom((now) => now ?? current); setCurrent(place); } }}
                        />
                      ) : found && place === current && at === col ? <FoundText text={shownOf(bill, column)} typed={found} kind={column.kind} /> : shownOf(bill, column)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={COLUMNS.length}>{bills.length > 0 ? "No bills match the filters" : "No pending bills for this account"}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="se-bills-foot" role="status">
        <span>{hint}</span>
        {totals && <span className="mp-sel-totals" title={`Selected rows of ${column.caption}`}>{totals}</span>}
      </div>
      {tools.popups}
    </section>
  );
}
