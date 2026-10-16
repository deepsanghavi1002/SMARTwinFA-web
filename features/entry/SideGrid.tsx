"use client";

import { useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { FoundText } from "../grid/FoundText";
import type { GridColumn } from "../../lib/entry/types";
import { useColumnLayout } from "../grid/useColumnLayout";
import { amountText } from "./format";

/**
 * A side grid of the entry screen (slab, addon, outstanding): heading row and rows, the columns
 * as the setup sizes them; a heading's right edge drags the column wider or narrower (double-click
 * puts it back). `fill`: the columns share out the grid's width when it is wider than they are.
 *
 * Type to find: with the keyboard on the grid (not inside a cell), typing finds the first row whose first column (or `searchKey`) starts with
 * the letters, marking them; ↑ ↓ move the row; Enter puts the keyboard in that row's first open cell.
 */
const TYPE_PAUSE_MS = 1200;

export function SideGrid({ columns, rows, cell, cellClass, label, style, empty, fill = false, searchKey }: {
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
}) {
  const layout = useColumnLayout(columns, 0, (column) => column.width);
  const tableWidth = columns.reduce((sum, column) => sum + layout.widthOf(column), 0);
  const [current, setCurrent] = useState(0);
  const [found, setFound] = useState("");
  const typed = useRef({ text: "", at: 0 });
  const box = useRef<HTMLDivElement>(null);
  const findKey = searchKey ?? columns[0]?.key ?? "";
  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const last = rows.length - 1;
    const at = Math.min(current, Math.max(0, last));
    const move = (row: number) => { event.preventDefault(); typed.current.text = ""; setFound(""); setCurrent(Math.max(0, Math.min(last, row))); };
    if (event.key === "ArrowDown") { move(at + 1); return; }
    if (event.key === "ArrowUp") { move(at - 1); return; }
    if (event.key === "Home") { move(0); return; }
    if (event.key === "End") { move(last); return; }
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
    const hit = rows.findIndex((row) => (row[findKey] ?? "").trim().toUpperCase().startsWith(text));
    if (hit >= 0) { setCurrent(hit); setFound(text); } else typed.current.text = text.slice(0, -1);
  };
  const align = (column: GridColumn) => (column.align === "R" ? "right" : column.align === "C" ? "center" : "left");
  return (
    <>
    {WATERMARKS[label] && <div className="ent-watermark" style={style} aria-hidden="true">{WATERMARKS[label]}</div>}
    <div ref={box} className="ent-grid" style={style} role="grid" aria-label={label} tabIndex={0} onKeyDown={keys}>
      <table style={fill ? { width: "100%", minWidth: tableWidth } : { width: tableWidth }}>
        <colgroup>{columns.map((column) => <col key={column.key} style={{ width: layout.widthOf(column) }} />)}</colgroup>
        <thead>
          <tr>{columns.map((column) => <th key={column.key} style={{ textAlign: align(column) }} title={column.caption}>{column.caption}{layout.resizeHandle(column)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={[index % 2 ? "ent-alt" : "", index === Math.min(current, rows.length - 1) ? "ent-grid-current" : ""].filter(Boolean).join(" ")} onMouseDown={() => { typed.current.text = ""; setFound(""); setCurrent(index); }}>
              {columns.map((column) => (
                <td key={column.key} className={cellClass?.(index, column) || (column.editable ? "ent-open" : "")} style={{ textAlign: align(column) }}>
                  {found && index === current && column.key === findKey ? <FoundText text={row[column.key] ?? ""} typed={found} /> : cell ? cell(index, column) : column.align === "R" && column.decimals > 0 ? amountText(row[column.key] ?? "", column.decimals) : row[column.key] ?? ""}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && empty && <tr><td colSpan={Math.max(1, columns.length)} className="ent-empty">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
    </>
  );
}

/** The faint name behind a grid (Slab Grid, Addon Grid). */
const WATERMARKS: Readonly<Record<string, string>> = { Slab: "Slab Grid", Addon: "Addon Grid" };
