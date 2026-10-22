"use client";

/**
 * ShowGridForm1, the edit-log window, for every screen that keeps a log: one row per saved
 * version of a record, a value that differs from the column before it coloured (yellow, green,
 * red in turn), and Export to EXCEL as a CSV the spreadsheet opens. Dressed as the entry's log window: it moves by its title bar and
 * resizes by its corner, each heading has the column filter and a draggable edge, and the box above keeps the rows with the text in any column.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { FilterButton, FilterPopup, useColumnFilters } from "./ColumnFilter";
import { filterHolds, sortedDistinct } from "./filter";
import { HelpIcon } from "./HelpIcon";
import { useColumnLayout } from "./useColumnLayout";
import { useDraggable } from "./useDraggable";

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
  const [currentRow, setCurrentRow] = useState(0);

  useEffect(() => {
    (area.current ?? closeRef.current)?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);

  return (
    <div className="ent-log-back" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ent-log mp-help-scheme" style={drag.style}>
        <div className="mp-help-title" {...drag.handle} title="Drag to move the window">
          <span><HelpIcon name="scroll-text" /><b className="mp-help-name">{title.toUpperCase()}</b></span>
          <span className="mp-help-tip">drag the title to move · drag the corner to resize</span>
          <button type="button" onClick={onClose} onMouseDown={(event) => event.stopPropagation()} aria-label="Close log">×</button>
        </div>
        <div className="ent-log-bar">
          <label>Search <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="text in any column" aria-label="Search the log" /></label>
          <span>{narrowed ? `${shown.length} of ${table.rows.length} rows` : ""}</span>
          {Object.keys(filters.filters).length > 0 && <button type="button" className="ent-link-button" onClick={filters.clearAll}>Clear filters</button>}
        </div>
        <div className="ent-log-scroll" ref={area} tabIndex={0} role="grid" aria-label="Log">
          <table className="ent-log-table" style={{ width: columns.reduce((sum, column) => sum + layout.widthOf(column), 0) }}>
            <colgroup>{columns.map((column) => <col key={column.key} style={{ width: layout.widthOf(column) }} />)}</colgroup>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key} className={filters.filters[column.key] ? "ent-filtered" : undefined}>
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
                <tr key={index} className={[/^group head:/i.test(row[0] ?? "") ? "ent-log-head" : "", at === currentRow ? "ent-log-current" : ""].filter(Boolean).join(" ") || undefined} onMouseDown={() => setCurrentRow(at)}>
                  {row.map((value, cell) => <td key={cell} className={colours[index][cell] ? colours[index][cell].replace("mp-log-", "ent-log-") : undefined}>{value}</td>)}
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
