"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { EntryLog as EntryLogData } from "../../lib/entry/log";
import { FilterButton, FilterPopup, useColumnFilters } from "../grid/ColumnFilter";
import { filterHolds, sortedDistinct } from "../grid/filter";
import { FoundText } from "../grid/FoundText";
import { HelpIcon } from "../grid/HelpIcon";
import { useColumnLayout } from "../grid/useColumnLayout";
import { useDraggable } from "../grid/useDraggable";

/**
 * The Log window of an entry (ShowGridForm): each save of the entry in its own column, the
 * Add first. A cell that differs from the one before it is coloured the way the desktop does:
 * yellow for a first change, green when the cell before was yellow, red when it was green.
 * Dressed as the helps are (title bar with icon, charcoal headings, aqua current row). The window moves by its title bar and
 * resizes by its corner; each heading has the column filter and a draggable edge; typing in the grid finds the first row whose
 * current column starts with the text (as the helps do); the box above keeps the rows with the text in any column.
 */

type Tone = "" | "yellow" | "green" | "red";

const same = (current: string, previous: string) => {
  const a = Number(current.trim());
  const b = Number(previous.trim());
  if (current.trim() !== "" && previous.trim() !== "" && Number.isFinite(a) && Number.isFinite(b)) return a === b;
  return current.trim().toLowerCase() === previous.trim().toLowerCase();
};

/** DataGridView's cell colours for one row. */
function tones(cells: readonly string[]): Tone[] {
  const out: Tone[] = cells.map(() => "");
  for (let index = 1; index < cells.length; index += 1) {
    if (cells[index] === "" || cells[index - 1] === "" || same(cells[index], cells[index - 1])) continue;
    out[index] = out[index - 1] === "yellow" ? "green" : out[index - 1] === "green" ? "red" : "yellow";
  }
  return out;
}

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
/** Typing pauses longer than this start a new search. */
const TYPE_PAUSE_MS = 1200;

export function EntryLog({ log, title, docNo = "", onClose }: { log: EntryLogData; title: string; /** The invoice number, added at the end of the exported file's name. */ docNo?: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const heading = (index: number) => (index === 0 ? "Add Value" : `Edit Value ${index}`);
  const everyRow = useMemo(() => log.rows.map((row) => ({ row, tone: tones(row.cells) })), [log]);
  const filters = useColumnFilters();
  const [search, setSearch] = useState("");
  const drag = useDraggable();
  const area = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState({ row: 0, column: 0 });
  const typed = useRef({ text: "", at: 0 });
  const [found, setFound] = useState("");
  const columns = useMemo(() => [{ key: "section", width: 110 }, { key: "name", width: 190 }, ...log.versions.map((_v, index) => ({ key: `v${index}`, width: 170 }))], [log]);
  const layout = useColumnLayout(columns, 0, (column) => column.width);
  const caption = (key: string) => (key === "section" ? "Group" : key === "name" ? "Field" : heading(Number(key.slice(1))));
  const valueOf = (row: EntryLogData["rows"][number], key: string) => (key === "section" ? (row.kind === "head" ? "" : row.section) : key === "name" ? row.name : row.cells[Number(key.slice(1))] ?? "");
  /** Field rows after every column filter except `skip` (so a column's list offers what the others leave). */
  const fieldRows = (skip: string | null) => everyRow.filter(({ row }) => row.kind === "field" && columns.every((column) => {
    if (column.key === skip) return true;
    const filter = filters.filters[column.key];
    return !filter || filterHolds("text", filter, valueOf(row, column.key), valueOf(row, column.key));
  }));
  const needle = search.trim().toLowerCase();
  const narrowed = needle !== "" || Object.keys(filters.filters).length > 0;
  const shown = useMemo(() => {
    if (!narrowed) return everyRow;
    const kept = fieldRows(null).filter(({ row }) => needle === "" || [row.section, row.name, ...row.cells].some((text) => text.toLowerCase().includes(needle)));
    const keptRows = new Set(kept.map((item) => item.row));
    const sections = new Set(kept.map(({ row }) => row.section));
    return everyRow.filter(({ row }) => (row.kind === "head" ? sections.has(row.section) : keptRows.has(row)));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fieldRows only reads everyRow, columns and the filters named here
  }, [everyRow, columns, filters.filters, needle, narrowed]);
  const valuesOf = (key: string) => sortedDistinct(fieldRows(key).map(({ row }) => valueOf(row, key)));

  const currentRow = Math.min(current.row, Math.max(0, shown.length - 1));
  const currentColumn = Math.min(current.column, columns.length - 1);
  useEffect(() => {
    area.current?.querySelector(`tr[data-row="${currentRow}"]`)?.scrollIntoView({ block: "nearest" });
  }, [currentRow, shown]);

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
    const hit = shown.findIndex(({ row }) => row.kind === "field" && valueOf(row, key).trim().toUpperCase().startsWith(text));
    if (hit >= 0) { setCurrent((at) => ({ ...at, row: hit })); setFound(text); }
    else typed.current.text = text.slice(0, -1);
  };

  /** Export: a CSV the spreadsheet opens (the desktop's Excel file keeps the colours; a CSV cannot). */
  const exportCsv = () => {
    const lines = [["Group", "Field", ...log.versions.map((_v, index) => heading(index))].map(csvCell).join(",")];
    for (const { row } of shown) lines.push([row.kind === "head" ? "" : row.section, row.name, ...row.cells].map(csvCell).join(","));
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${`${title} Log ${log.docNo || docNo}`.replace(/[\\/:*?"<>|]+/g, " ").trim()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="ent-log-back" role="dialog" aria-modal="true" aria-label={`${title} Log`}>
      <div className="ent-log mp-help-scheme" style={drag.style}>
        <div className="mp-help-title" {...drag.handle} title="Drag to move the window">
          <span><HelpIcon name="scroll-text" /><b className="mp-help-name">{`${title} Log`.toUpperCase()}</b></span>
          <span className="mp-help-tip">type to search the marked column · ← → change column · drag the title to move</span>
          <button type="button" onClick={onClose} onMouseDown={(event) => event.stopPropagation()} aria-label="Close log">×</button>
        </div>
        <div className="ent-log-bar">
          <label>Search <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="text in any column" aria-label="Search the log" /></label>
          <span>{narrowed ? `${shown.filter(({ row }) => row.kind === "field").length} of ${log.rows.filter((row) => row.kind === "field").length} fields` : ""}</span>
          {Object.keys(filters.filters).length > 0 && <button type="button" className="ent-link-button" onClick={filters.clearAll}>Clear filters</button>}
        </div>
        {log.rows.length === 0 ? <p className="ent-log-empty">No log records for this entry.</p> : (
          <div className="ent-log-scroll" ref={area} tabIndex={0} role="grid" aria-label="Log" onKeyDown={keys}>
            <table className="ent-log-table" style={{ width: columns.reduce((sum, column) => sum + layout.widthOf(column), 0) }}>
              <colgroup>{columns.map((column) => <col key={column.key} style={{ width: layout.widthOf(column) }} />)}</colgroup>
              <thead>
                <tr>
                  {columns.map((column, index) => {
                    const version = column.key.startsWith("v") ? log.versions[Number(column.key.slice(1))] : undefined;
                    return (
                      <th key={column.key} className={`${filters.filters[column.key] ? "ent-filtered" : ""} ${index === currentColumn ? "ent-log-colnow" : ""}`} title={version ? `${version.user}  ${version.machine}` : caption(column.key)} onClick={() => setCurrent((at) => ({ ...at, column: index }))}>
                        {caption(column.key)}
                        {version && <small>{version.user} · {version.savedate} {version.savetime}</small>}
                        <FilterButton caption={caption(column.key)} skipTab onOpen={() => filters.open(column.key, valuesOf(column.key))} />
                        {layout.resizeHandle(column)}
                        <FilterPopup state={filters} columnKey={column.key} caption={caption(column.key)} kind="text" values={filters.openFilter === column.key ? valuesOf(column.key) : []} area={area} floating />
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {shown.map(({ row, tone }, index) => (
                  <tr key={index} data-row={index} className={[row.kind === "head" ? "ent-log-head" : "", index === currentRow ? "ent-log-current" : ""].filter(Boolean).join(" ") || undefined}>
                    {columns.map((column, at) => {
                      const text = column.key === "section" ? (row.kind === "head" ? "" : row.section) : column.key === "name" ? row.name : row.cells[at - 2] ?? "";
                      const toneClass = at >= 2 && tone[at - 2] ? `ent-log-${tone[at - 2]}` : "";
                      const now = index === currentRow && at === currentColumn;
                      return (
                        <td key={column.key} className={[toneClass, now ? "ent-log-cell" : ""].filter(Boolean).join(" ") || undefined} onMouseDown={() => { typed.current.text = ""; setFound(""); setCurrent({ row: index, column: at }); }}>
                          {now && found ? <FoundText text={text} typed={found} /> : text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="ent-log-foot">
          <button type="button" className="mp-btn mp-btn-blue" disabled={log.rows.length === 0} onClick={exportCsv}>Export to CSV</button>
          <button type="button" ref={closeRef} className="mp-btn mp-btn-red" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
