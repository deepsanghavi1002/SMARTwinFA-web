"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HelpIcon } from "../grid/HelpIcon";
import { Icon } from "../ui/Icon";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { HelpList } from "../../lib/entry/types";
import { FilterButton, FilterPopup, useColumnFilters } from "../grid/ColumnFilter";
import { filterHolds, sortedDistinct } from "../grid/filter";
import type { FilterKind } from "../grid/filter";
import { useColumnLayout } from "../grid/useColumnLayout";
import { FoundText, MarkedText } from "../grid/FoundText";
import { helpCell } from "./format";
import { parseDesktopDate } from "../../lib/master-program/legacy";
import { toNumber } from "../../lib/entry/calc";

type Column = HelpList["columns"][number];

/** Typing pauses longer than this start a new search. */
const TYPE_PAUSE_MS = 1200;

/**
 * The Find / Edit tab (c1Help_EntryPreview): the register's entries in the series. Each heading
 * has the column filter (▾) and a resizable edge; typing in the list finds the first entry whose
 * value in the current column starts with what is typed (C1help_Keypress_Search); the box beside
 * the total keeps the entries with the text in any column. Enter or a double-click opens the
 * entry for editing (C1Help_EntryPreview_DoubleClick → Restore_Entry).
 */
export function FindList({ preview, style, onOpen, allFields = false, onAllFields }: { preview: HelpList | null; style: CSSProperties; onOpen: (row: Readonly<Record<string, string>>) => void; allFields?: boolean; onAllFields?: () => void }) {
  const columns = useMemo(() => (preview?.columns ?? []).filter((column) => column.key.toLowerCase() !== "tick"), [preview]);
  const filters = useColumnFilters();
  const [search, setSearch] = useState("");
  /** The heading clicked: ascending, then descending, then the list as it came (Find / Edit headings sort). */
  const [sort, setSort] = useState<{ key: string; down: boolean } | null>(null);
  const [current, setCurrent] = useState({ row: 0, column: 0 });
  const typed = useRef({ text: "", at: 0 });
  /** What typing in the list has found so far: marked on the cell it landed on, as the master grid's type-to-find. */
  const [found, setFound] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  const kindOf = (column: Column): FilterKind => (column.format.startsWith("dd") ? "date" : /^N/.test(column.format) || column.align === "R" ? "number" : "text");
  const shownOf = (column: Column, row: Readonly<Record<string, string>>) => helpCell(row[column.key] ?? "", column.format);
  const allRows = useMemo(() => preview?.rows ?? [], [preview]);
  /** The hover tip of a cell: its whole value; the products column puts each product line on a line of its own. */
  const tipOf = (column: Column, row: Readonly<Record<string, string>>) => {
    const value = shownOf(column, row);
    return column.key === "products_all" ? value.split("‖").map((part) => part.trim()).join("\n") : value;
  };
  // Each column is as wide as its heading (with the filter arrow) and its longest text need, so a date shows whole; the edge still drags it.
  const layout = useColumnLayout(columns, 0, (column) => {
    const longest = allRows.reduce((most, row) => Math.max(most, shownOf(column, row).length), 0);
    const wanted = Math.max(column.caption.length * 7 + 34, longest * 7 + 16, column.format.startsWith("dd") ? 104 : 0);
    return Math.min(Math.max(280, column.width || 0), Math.max(30, column.width || 90, wanted));
  });
  /** The rows after every column filter except `skip` (so a column's list offers what the others leave). */
  const filtered = (skip: string | null) => allRows.filter((row) => columns.every((column) => {
    if (column.key === skip) return true;
    const filter = filters.filters[column.key];
    return !filter || filterHolds(kindOf(column), filter, row[column.key] ?? "", shownOf(column, row));
  }));
  const needle = search.trim().toUpperCase();
  const kept = filtered(null).filter((row) => needle === "" || columns.some((column) => shownOf(column, row).toUpperCase().includes(needle)));
  const rows = (() => {
    const column = sort ? columns.find((candidate) => candidate.key === sort.key) : undefined;
    if (!sort || !column) return kept;
    const kind = kindOf(column);
    const keyOf = (row: Readonly<Record<string, string>>): number | string => {
      const raw = row[column.key] ?? "";
      if (kind === "number") return toNumber(raw);
      if (kind === "date") return (parseDesktopDate(raw) ?? parseDesktopDate(shownOf(column, row)))?.getTime() ?? 0;
      return shownOf(column, row).trim().toUpperCase();
    };
    return [...kept].sort((a, b) => {
      const left = keyOf(a);
      const right = keyOf(b);
      const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true });
      return sort.down ? -order : order;
    });
  })();
  const valuesOf = (column: Column) => sortedDistinct(filtered(column.key).map((row) => shownOf(column, row)));

  // The current row stays on a row the filters leave.
  const currentRow = Math.min(current.row, Math.max(0, rows.length - 1));
  useEffect(() => {
    scroller.current?.querySelector<HTMLElement>(`[data-row="${currentRow}"]`)?.scrollIntoView({ block: "nearest" });
  }, [currentRow]);

  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("input, .mp-filter")) return;
    const last = rows.length - 1;
    const move = (row: number) => { event.preventDefault(); setCurrent((at) => ({ ...at, row: Math.max(0, Math.min(last, row)) })); };
    if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", "ArrowRight", "ArrowLeft"].includes(event.key)) { typed.current.text = ""; setFound(""); }
    switch (event.key) {
      case "ArrowDown": move(currentRow + 1); return;
      case "ArrowUp": move(currentRow - 1); return;
      case "PageDown": move(currentRow + 15); return;
      case "PageUp": move(currentRow - 15); return;
      case "Home": move(0); return;
      case "End": move(last); return;
      case "ArrowRight": event.preventDefault(); setCurrent((at) => ({ ...at, column: Math.min(columns.length - 1, at.column + 1) })); return;
      case "ArrowLeft": event.preventDefault(); setCurrent((at) => ({ ...at, column: Math.max(0, at.column - 1) })); return;
      case "Enter": event.preventDefault(); if (rows[currentRow]) onOpen(rows[currentRow]); return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    const now = event.timeStamp;
    const text = (now - typed.current.at > TYPE_PAUSE_MS ? "" : typed.current.text) + event.key.toUpperCase();
    typed.current = { text, at: now };
    const column = columns[current.column];
    if (!column) return;
    const hit = rows.findIndex((row) => shownOf(column, row).trim().toUpperCase().startsWith(text));
    if (hit >= 0) { setCurrent((at) => ({ ...at, row: hit })); setFound(text); }
    else typed.current.text = text.slice(0, -1);
  };

  const tableWidth = columns.reduce((sum, column) => sum + layout.widthOf(column), 0);
  return (
    <div ref={grid} className="ent-find" style={style}>
      <div className="mp-help-title ent-find-title"><span><HelpIcon name="file-text" /><b className="mp-help-name">FIND / EDIT HELP</b></span></div>
      <div ref={scroller} className="ent-grid ent-find-grid" tabIndex={0} role="grid" aria-label="Entries" aria-rowcount={rows.length} onKeyDown={keys}>
        <table style={{ width: tableWidth }}>
          <colgroup>{columns.map((column) => <col key={column.key} style={{ width: layout.widthOf(column) }} />)}</colgroup>
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th key={column.key} className={filters.filters[column.key] ? "ent-filtered" : ""} style={{ textAlign: column.align === "R" ? "right" : "left" }} title={column.caption} onClick={() => setCurrent((at) => ({ ...at, column: index }))}>
                  <button type="button" tabIndex={-1} className="ent-th-text ent-sortable" title={`${column.caption} · click to sort (ascending, descending, none)`} onClick={(event) => { event.stopPropagation(); setCurrent((at) => ({ ...at, column: index })); setSort((now) => (now?.key !== column.key ? { key: column.key, down: false } : now.down ? null : { key: column.key, down: true })); }}>{column.caption}{sort?.key === column.key ? <span className="ent-sort-mark">{sort.down ? " ▼" : " ▲"}</span> : null}</button>
                  <FilterButton caption={column.caption} skipTab onOpen={() => filters.open(column.key, valuesOf(column))} />
                  {layout.resizeHandle(column)}
                  <FilterPopup state={filters} columnKey={column.key} caption={column.caption} kind={kindOf(column)} values={filters.openFilter === column.key ? valuesOf(column) : []} area={grid} floating />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.unique_key ?? ""}-${index}`} data-row={index} className={index === currentRow ? "ent-find-current" : index % 2 ? "ent-alt" : ""} onMouseDown={() => setCurrent((at) => ({ ...at, row: index }))} onDoubleClick={() => onOpen(row)}>
                {columns.map((column, at) => (
                  <td key={column.key} title={tipOf(column, row)} className={index === currentRow && at === current.column ? "ent-find-cell" : ""} style={{ textAlign: column.align === "R" ? "right" : "left" }} onMouseDown={() => { typed.current.text = ""; setFound(""); setCurrent({ row: index, column: at }); }}>{index === currentRow && at === current.column && found ? <FoundText text={shownOf(column, row)} typed={found} /> : <MarkedText text={shownOf(column, row)} query={search} />}</td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={Math.max(1, columns.length)} className="ent-empty">{preview ? "No entries" : "Loading…"}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="ent-find-foot">
        <span>{preview ? `Total Records : ${rows.length}${rows.length !== allRows.length ? ` of ${allRows.length}` : ""}` : ""}</span>
        <label className="ent-find-search">Search <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="text in any column" aria-label="Search the entries" /></label>
        {onAllFields && <button type="button" className={`mp-btn mp-btn-blue ent-all-fields ${allFields ? "ent-all-on" : ""}`} aria-pressed={allFields} title="Show every field of each entry: slab amounts, addons and each product line (read when pressed)" onClick={onAllFields}><Icon name="list" />{allFields ? "Basic fields" : "All fields"}</button>}
        {Object.keys(filters.filters).length > 0 && <button type="button" className="ent-link-button" onClick={filters.clearAll}>Clear filters</button>}
        <span className="ent-find-tip">type in the list to find · Enter / double-click opens the entry</span>
      </div>
    </div>
  );
}
