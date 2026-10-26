"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { FilterButton, FilterPopup, useColumnFilters } from "../grid/ColumnFilter";
import { filterHolds, sortedDistinct } from "../grid/filter";
import type { FilterKind } from "../grid/filter";
import { FoundText } from "../grid/FoundText";
import type { GridColumn } from "../../lib/entry/types";
import { useColumnLayout } from "../grid/useColumnLayout";
import { parseDesktopDate } from "../../lib/master-program/legacy";
import { toNumber } from "../../lib/entry/calc";
import { amountText } from "./format";

/**
 * A side grid of the entry screen (slab, addon, outstanding): heading row and rows, the columns
 * as the setup sizes them; a heading's right edge drags the column wider or narrower (double-click
 * puts it back). `fill`: the columns share out the grid's width when it is wider than they are.
 *
 * Type to find: with the keyboard on the grid (not inside a cell), typing finds the first row whose first column (or `searchKey`) starts with
 * the letters, marking them; ↑ ↓ move the row; Enter puts the keyboard in that row's first open cell. With `anyColumn` the letters search the
 * column the cursor is in (← → or a click change it).
 *
 * `sortable`: a heading's text sorts the rows (ascending, descending, as they came). `filterable`: each heading has the column filter (▾).
 * The row numbers handed to `cell`, `cellClass` and `totals` are always the row's place in `rows`, whatever the sort and filters show.
 */
const TYPE_PAUSE_MS = 1200;

export function SideGrid({ columns, rows, cell, cellClass, label, style, empty, fill = false, searchKey, anyColumn = false, sortable = false, filterable = false, totals, below, onF5 }: {
  columns: readonly GridColumn[];
  rows: readonly Readonly<Record<string, string>>[];
  cell?: (row: number, column: GridColumn) => ReactNode;
  /** A cell's own class: "ent-disabled" greys a cell the row does not let the operator edit. */
  cellClass?: (row: number, column: GridColumn) => string;
  label: string;
  style: CSSProperties;
  empty?: string;
  fill?: boolean;
  /** The column typed letters search (the first column when not given). */
  searchKey?: string;
  anyColumn?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  /** Totals per column key of the rows shown (given their row numbers), in a bar just below the grid, outside it, each under its column. */
  totals?: (shown: readonly number[]) => Readonly<Record<string, string>>;
  /** Extra boxes under the totals bar (Outstanding: the entry amount and the balance), right-aligned to the grid's right edge. */
  below?: ReactNode;
  /** F5 with the keyboard on the grid (Outstanding: finish the set-off). */
  onF5?: () => void;
}) {
  const layout = useColumnLayout(columns, 0, (column) => column.width);
  const tableWidth = columns.reduce((sum, column) => sum + layout.widthOf(column), 0);
  const [current, setCurrent] = useState(0);
  const [col, setCol] = useState(0);
  const [found, setFound] = useState("");
  const [sort, setSort] = useState<{ key: string; down: boolean } | null>(null);
  const filters = useColumnFilters();
  const typed = useRef({ text: "", at: 0 });
  const box = useRef<HTMLDivElement>(null);
  const align = (column: GridColumn) => (column.align === "R" ? "right" : column.align === "C" ? "center" : "left");
  const kindOf = (column: GridColumn): FilterKind => (column.align === "R" && column.decimals > 0 ? "number" : /date/i.test(column.key) ? "date" : "text");
  const shownOf = (column: GridColumn, row: Readonly<Record<string, string>>) => (column.align === "R" && column.decimals > 0 ? amountText(row[column.key] ?? "", column.decimals) : row[column.key] ?? "");
  const findKey = anyColumn ? columns[Math.min(col, columns.length - 1)]?.key ?? "" : searchKey ?? columns[0]?.key ?? "";

  /** The rows' numbers as shown: after the column filters, in the heading's sort order. */
  const order = useMemo(() => {
    const held = (skip: string | null) => rows.map((_row, index) => index).filter((index) => columns.every((column) => {
      if (column.key === skip) return true;
      const filter = filters.filters[column.key];
      return !filter || filterHolds(kindOf(column), filter, rows[index][column.key] ?? "", shownOf(column, rows[index]));
    }));
    const kept = held(null);
    const sorted = sort ? columns.find((candidate) => candidate.key === sort.key) : undefined;
    if (!sort || !sorted) return { kept, held };
    const kind = kindOf(sorted);
    const keyOf = (index: number): number | string => {
      const raw = rows[index][sorted.key] ?? "";
      if (kind === "number") return toNumber(raw);
      if (kind === "date") return parseDesktopDate(raw)?.getTime() ?? 0;
      return raw.trim().toUpperCase();
    };
    return { kept: [...kept].sort((a, b) => {
      const left = keyOf(a);
      const right = keyOf(b);
      const diff = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true });
      return sort.down ? -diff : diff;
    }), held };
  }, [rows, columns, filters.filters, sort]);
  const shown = order.kept;
  const valuesOf = (column: GridColumn) => sortedDistinct(order.held(column.key).map((index) => shownOf(column, rows[index])));

  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const last = shown.length - 1;
    const at = Math.min(current, Math.max(0, last));
    const move = (row: number) => { event.preventDefault(); typed.current.text = ""; setFound(""); setCurrent(Math.max(0, Math.min(last, row))); };
    if (event.key === "ArrowDown") { move(at + 1); return; }
    if (event.key === "ArrowUp") { move(at - 1); return; }
    if (event.key === "F5" && onF5) { event.preventDefault(); onF5(); return; }
    if (event.key === "Home") { move(0); return; }
    if (event.key === "End") { move(last); return; }
    if (anyColumn && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      event.preventDefault(); typed.current.text = ""; setFound("");
      setCol((now) => Math.max(0, Math.min(columns.length - 1, now + (event.key === "ArrowRight" ? 1 : -1))));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      box.current?.querySelector<HTMLElement>(`tbody tr:nth-child(${at + 1}) [data-cell], tbody tr:nth-child(${at + 1}) [data-cell-wrap] input`)?.focus();
      return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    const now = Date.now();
    const text = (now - typed.current.at > TYPE_PAUSE_MS ? "" : typed.current.text) + event.key.toUpperCase();
    typed.current = { text, at: now };
    const column = columns.find((candidate) => candidate.key === findKey);
    // The search starts at the row the cursor is on and goes on down (round to the top), not from the first row each time.
    const starts = (position: number) => (column ? shownOf(column, rows[shown[position]]) : rows[shown[position]][findKey] ?? "").trim().toUpperCase().startsWith(text);
    let hit = -1;
    for (let step = 0; step < shown.length && hit < 0; step += 1) {
      const position = (at + step) % shown.length;
      if (starts(position)) hit = position;
    }
    if (hit >= 0) { setCurrent(hit); setFound(text); } else typed.current.text = text.slice(0, -1);
  };

  // The current row (found by typing, or reached with the arrow keys) is always brought into view.
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("tr.ent-grid-current")?.scrollIntoView({ block: "nearest" });
  }, [current, shown.length, sort]);
  const shownTotals = totals ? totals(shown) : null;
  return (
    <>
    {WATERMARKS[label] && <div className={`ent-watermark${label === "Outstanding" ? " ent-watermark-faint" : ""}`} style={style} aria-hidden="true">{WATERMARKS[label]}</div>}
    <div ref={box} className="ent-grid" style={style} role="grid" aria-label={label} tabIndex={0} onKeyDown={keys}>
      <table style={fill ? { width: "100%", minWidth: tableWidth } : { width: tableWidth }}>
        <colgroup>{columns.map((column) => <col key={column.key} style={{ width: layout.widthOf(column) }} />)}</colgroup>
        <thead>
          <tr>{columns.map((column, at) => (
            <th key={column.key} style={{ textAlign: align(column) }} title={column.caption} className={[filters.filters[column.key] ? "ent-filtered" : "", filterable ? "ent-th-filterable" : ""].filter(Boolean).join(" ")}>
              {sortable
                ? <button type="button" tabIndex={-1} className="ent-th-text ent-sortable" title={`${column.caption} · click to sort (ascending, descending, none)`} onClick={() => { setCol(at); setSort((now) => (now?.key !== column.key ? { key: column.key, down: false } : now.down ? null : { key: column.key, down: true })); }}>{column.caption}{sort?.key === column.key ? <span className="ent-sort-mark">{sort.down ? " ▼" : " ▲"}</span> : null}</button>
                : column.caption}
              {filterable && <FilterButton caption={column.caption} skipTab onOpen={() => filters.open(column.key, valuesOf(column))} />}
              {layout.resizeHandle(column)}
              {filterable && <FilterPopup state={filters} columnKey={column.key} caption={column.caption} kind={kindOf(column)} values={filters.openFilter === column.key ? valuesOf(column) : []} area={box} floating />}
            </th>
          ))}</tr>
        </thead>
        <tbody>
          {shown.map((index, place) => {
            const row = rows[index];
            return (
              <tr key={index} className={[place % 2 ? "ent-alt" : "", place === Math.min(current, shown.length - 1) ? "ent-grid-current" : ""].filter(Boolean).join(" ")} onMouseDown={() => { typed.current.text = ""; setFound(""); setCurrent(place); }}>
                {columns.map((column, at) => (
                  <td key={column.key} className={[cellClass?.(index, column) || (column.editable ? "ent-open" : ""), place === current && at === col ? "ent-grid-cell" : ""].filter(Boolean).join(" ")} style={{ textAlign: align(column) }} onMouseDown={() => setCol(at)}>
                    {found && place === current && column.key === findKey ? <FoundText text={shownOf(column, row)} typed={found} /> : cell ? cell(index, column) : shownOf(column, row)}
                  </td>
                ))}
              </tr>
            );
          })}
          {shown.length === 0 && empty && <tr><td colSpan={Math.max(1, columns.length)} className="ent-empty">{rows.length > 0 ? "No rows match the filters" : empty}</td></tr>}
        </tbody>
      </table>
    </div>
    {shownTotals && (
      <div className="ent-totals" style={{ left: style.left, top: Number(style.top) + Number(style.height) + 2, width: tableWidth }}>
        {columns.map((column) => <output key={column.key} className={`ent-total-box${shownTotals[column.key] === undefined ? " ent-total-none" : ""}`} style={{ width: layout.widthOf(column), textAlign: align(column) }}>{shownTotals[column.key] ?? ""}</output>)}
      </div>
    )}
    {below && <div className="ent-totals-below" style={{ left: style.left, top: Number(style.top) + Number(style.height) + 26, width: tableWidth }}>{below}</div>}
    </>
  );
}

/** The faint name behind a grid (Slab Grid, Addon Grid). */
const WATERMARKS: Readonly<Record<string, string>> = { Slab: "Slab grid", Addon: "Addon grid", Outstanding: "Outstanding grid" };
