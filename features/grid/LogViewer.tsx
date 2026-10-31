"use client";

/**
 * ShowGridForm1, the edit-log window, for every screen that keeps a log: one row per saved
 * version of a record, a value that differs from the column before it coloured (yellow, green,
 * red in turn), and Export to EXCEL as a CSV the spreadsheet opens. Dressed as the entry's log window: it moves by its title bar and
 * resizes by its corner, each heading has the column filter and a draggable edge, and the box above keeps the rows with the text in any column.
 * The grid has a current cell: the arrows move it, and typing finds the first row whose current column starts with the text.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { FilterButton, FilterPopup, useColumnFilters } from "./ColumnFilter";
import { filterHolds, sortedDistinct } from "./filter";
import { FoundText } from "./FoundText";
import { HelpIcon } from "./HelpIcon";
import { useColumnLayout } from "./useColumnLayout";
import { useDraggable } from "./useDraggable";

/** Typing pauses longer than this start a new search. */
const TYPE_PAUSE_MS = 1200;

export type LogTable = Readonly<{ columns: readonly string[]; rows: readonly (readonly string[])[]; message: string }>;

/** gridForm.Load: each cell's colour class, by comparing it with the column before it. */
export function logColours(table: LogTable): string[][] {
  return table.rows.map((row) => {
    const colours: string[] = row.map(() => "");
    for (let at = 2; at < row.length; at += 1) {
      const current = row[at].trim();
      const previous = row[at - 1].trim();
      const numbers = current !== "" && previous !== "" && Number.isFinite(Number(current)) && Number.isFinite(Number(previous));
      const equal = numbers ? Number(current) === Number(previous) : current.toLowerCase() === previous.toLowerCase();
      if (!equal) colours[at] = colours[at - 1] === "mp-log-yellow" ? "mp-log-green" : colours[at - 1] === "mp-log-green" ? "mp-log-red" : "mp-log-yellow";
    }
    return colours;
  });
}

/** The log as a CSV file (with the BOM Excel needs for UTF-8), downloaded as `<name>.csv`. */
export function exportLog(table: LogTable, name: string) {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = [table.columns.map(quote).join(","), ...table.rows.map((row) => row.map(quote).join(","))];
  const url = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff) + lines.join(String.fromCharCode(13, 10))], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function LogViewer({ table, title, onClose }: { table: LogTable; title: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const drag = useDraggable();
  const filters = useColumnFilters();
  const [search, setSearch] = useState("");
  const colours = useMemo(() => logColours(table), [table]);
  const every = useMemo(() => table.rows.map((row, index) => ({ row, index })), [table]);
  const columns = useMemo(() => table.columns.map((name, at) => ({ key: `c${at}`, name, width: at === 0 ? 200 : 170 })), [table]);
  const layout = useColumnLayout(columns, 0, (column) => column.width);
  const valueOf = (row: readonly string[], key: string) => row[Number(key.slice(1))] ?? "";
  /** Rows after every column filter except `skip` (so a column's list offers what the others leave). */
  const filtered = (skip: string | null) => every.filter(({ row }) => columns.every((column) => {
    if (column.key === skip) return true;
    const filter = filters.filters[column.key];
    return !filter || filterHolds("text", filter, valueOf(row, column.key), valueOf(row, column.key));
  }));
  const needle = search.trim().toLowerCase();
  const narrowed = needle !== "" || Object.keys(filters.filters).length > 0;
  const shown = filtered(null).filter(({ row }) => needle === "" || row.some((value) => value.toLowerCase().includes(needle)));
  const valuesOf = (key: string) => sortedDistinct(filtered(key).map(({ row }) => valueOf(row, key)));
  const [current, setCurrent] = useState({ row: 0, column: 0 });
  const typed = useRef({ text: "", at: 0 });
  const [found, setFound] = useState("");
  const currentRow = Math.min(current.row, Math.max(0, shown.length - 1));
  const currentColumn = Math.min(current.column, Math.max(0, columns.length - 1));

  useEffect(() => {
    area.current?.querySelector(`tr[data-row="${currentRow}"]`)?.scrollIntoView({ block: "nearest" });
  }, [currentRow, shown.length]);

  useEffect(() => {
    (area.current ?? closeRef.current)?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);

  /** Arrow keys move the current cell; typing finds the first row whose current column starts with the text. */
  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("input, .mp-filter")) return;
    const last = shown.length - 1;
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
    }
    if (event.key.length !== 1 || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    const now = event.timeStamp;
    const text = (now - typed.current.at > TYPE_PAUSE_MS ? "" : typed.current.text) + event.key.toUpperCase();
    typed.current = { text, at: now };
    const key = columns[currentColumn].key;
    const hit = shown.findIndex(({ row }) => valueOf(row, key).trim().toUpperCase().startsWith(text));
    if (hit >= 0) { setCurrent((at) => ({ ...at, row: hit })); setFound(text); }
    else typed.current.text = text.slice(0, -1);
  };

  return (
    <div className="ent-log-back" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ent-log mp-help-scheme" style={drag.style}>
        <div className="mp-help-title" {...drag.handle} title="Drag to move the window">
          <span><HelpIcon name="scroll-text" /><b className="mp-help-name">{title.toUpperCase()}</b></span>
          <span className="mp-help-tip">type to search the marked column · ← → change column · drag the title to move</span>
          <button type="button" onClick={onClose} onMouseDown={(event) => event.stopPropagation()} aria-label="Close log">×</button>
        </div>
        <div className="ent-log-bar">
          <label>Search <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="text in any column" aria-label="Search the log" /></label>
          <span>{narrowed ? `${shown.length} of ${table.rows.length} rows` : ""}</span>
          {Object.keys(filters.filters).length > 0 && <button type="button" className="ent-link-button" onClick={filters.clearAll}>Clear filters</button>}
        </div>
        <div className="ent-log-scroll" ref={area} tabIndex={0} role="grid" aria-label="Log" onKeyDown={keys}>
          <table className="ent-log-table" style={{ width: columns.reduce((sum, column) => sum + layout.widthOf(column), 0) }}>
            <colgroup>{columns.map((column) => <col key={column.key} style={{ width: layout.widthOf(column) }} />)}</colgroup>
            <thead>
              <tr>
                {columns.map((column, position) => (
                  <th key={column.key} className={[filters.filters[column.key] ? "ent-filtered" : "", position === currentColumn ? "ent-log-colnow" : ""].filter(Boolean).join(" ") || undefined} onClick={() => setCurrent((at) => ({ ...at, column: position }))}>
                    {column.name}
                    <FilterButton caption={column.name} skipTab onOpen={() => filters.open(column.key, valuesOf(column.key))} />
                    {layout.resizeHandle(column)}
                    <FilterPopup state={filters} columnKey={column.key} caption={column.name} kind="text" values={filters.openFilter === column.key ? valuesOf(column.key) : []} area={area} floating />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(({ row, index }, at) => (
                <tr key={index} data-row={at} className={[/^group head:/i.test(row[0] ?? "") ? "ent-log-head" : "", at === currentRow ? "ent-log-current" : ""].filter(Boolean).join(" ") || undefined}>
                  {row.map((value, cell) => {
                    const tone = colours[index][cell] ? colours[index][cell].replace("mp-log-", "ent-log-") : "";
                    const now = at === currentRow && cell === currentColumn;
                    return <td key={cell} className={[tone, now ? "ent-log-cell" : ""].filter(Boolean).join(" ") || undefined} onMouseDown={() => { typed.current.text = ""; setFound(""); setCurrent({ row: at, column: cell }); }}>{now && found ? <FoundText text={value} typed={found} /> : value}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ent-log-foot">
          <button type="button" className="mp-btn mp-btn-blue" onClick={() => exportLog({ columns: table.columns, rows: shown.map(({ row }) => row), message: "" }, title)}>Export to EXCEL</button>
          <button type="button" ref={closeRef} className="mp-btn mp-btn-red" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
