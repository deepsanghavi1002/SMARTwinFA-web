"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HelpIcon } from "../grid/HelpIcon";
import { Icon } from "../ui/Icon";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { HelpList } from "../../lib/entry/types";
import { FilterButton, FilterPopup, useColumnFilters } from "../grid/ColumnFilter";
import { filterHolds, sortedDistinct } from "../grid/filter";
import type { FilterKind } from "../grid/filter";
import { useColumnLayout } from "../grid/useColumnLayout";
import { FoundText, MarkedText } from "../grid/FoundText";
import { GridMenu } from "../grid/GridMenu";
import type { GridMenuItem, GridMenuPlace } from "../grid/GridMenu";
import { helpCell } from "./format";
import { parseDesktopDate } from "../../lib/master-program/legacy";
import { toNumber } from "../../lib/entry/calc";

type Column = HelpList["columns"][number];

/** The list as it comes, with every field of each entry ("fields"), or with every field and each entry's product lines ("products"). */
export type FindMode = "" | "fields" | "products";

/** Only the rows in (and just around) the window are drawn: 15,000 entries x 25 columns in the page at once hangs the browser. */
const ROW_HEIGHT = 20;
const HEAD_HEIGHT = 20;
const OVERSCAN = 12;

/** Typing pauses longer than this start a new search. */
const TYPE_PAUSE_MS = 1200;

/**
 * The Find / Edit tab (c1Help_EntryPreview): the register's entries in the series. Each heading
 * has the column filter (▾) and a resizable edge; typing in the list finds the first entry whose
 * value in the current column starts with what is typed (C1help_Keypress_Search); the box beside
 * the total keeps the entries with the text in any column. Enter or a double-click opens the
 * entry for editing (C1Help_EntryPreview_DoubleClick → Restore_Entry).
 */
export function FindList({ preview, style, onOpen, mode = "", onMode, outstanding = false, ticked, onTick }: { preview: HelpList | null; style: CSSProperties; onOpen: (row: Readonly<Record<string, string>>) => void; mode?: FindMode; onMode?: (next: FindMode) => void; /** A voucher: the second button is "With Outstanding" (each row's set-offs) in place of "With product". */ outstanding?: boolean; /** Range print: the entries ticked (unique keys) and the click that ticks one; the Tick column shows when given. */ ticked?: readonly number[]; onTick?: (uniqueKey: number) => void }) {
  const columns = useMemo(() => (preview?.columns ?? []).filter((column) => column.key.toLowerCase() !== "tick"), [preview]);
  const filters = useColumnFilters();
  const [search, setSearch] = useState("");
  /** The heading clicked: ascending, then descending, then the list as it came (Find / Edit headings sort). */
  const [sort, setSort] = useState<{ key: string; down: boolean } | null>(null);
  /** The cursor starts on the first row, in the document number column (the second: after the date). */
  const [current, setCurrent] = useState({ row: 0, column: 1 });
  const typed = useRef({ text: "", at: 0 });
  /** What typing in the list has found so far: marked on the cell it landed on, as the master grid's type-to-find. */
  const [found, setFound] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  /** The height that shows whole rows only (no cut row at the bottom); null until measured. */
  const [fit, setFit] = useState<number | null>(null);
  const hidden = useRef(false);
  const latest = useRef({ row: 0, column: 0 });
  const grid = useRef<HTMLDivElement>(null);
  /** The right-click menu (as the report grids have), and what the last copy said. Columns here are not moved or hidden. */
  const [menu, setMenu] = useState<(GridMenuPlace & { col: number; row: number }) | null>(null);
  const [copied, setCopied] = useState("");

  const kindOf = (column: Column): FilterKind => (column.format.startsWith("dd") ? "date" : /^N/.test(column.format) || column.align === "R" ? "number" : "text");
  const shownOf = (column: Column, row: Readonly<Record<string, string>>) => helpCell(row[column.key] ?? "", column.format);
  const allRows = useMemo(() => preview?.rows ?? [], [preview]);
  /** The hover tip of a cell: its whole value; the products column puts each product line on a line of its own. */
  const tipOf = (column: Column, row: Readonly<Record<string, string>>) => {
    const value = shownOf(column, row);
    return column.key === "products_all" ? value.split("‖").map((part) => part.trim()).join("\n") : value;
  };
  // Each column is as wide as its heading (with the filter arrow) and its longest text need, so a date shows whole; the edge still drags it.
  // Worked out once per list: the layout asks for a width on every draw, and scanning every row on each arrow key made the movement lag.
  const startWidths = useMemo(() => {
    const widths: Record<string, number> = {};
    for (const column of columns) {
      let longest = 0;
      for (const row of allRows) longest = Math.max(longest, helpCell(row[column.key] ?? "", column.format).length);
      const wanted = Math.max(column.caption.length * 7 + 34, longest * 7 + 16, column.format.startsWith("dd") ? 104 : 0);
      // A voucher's Dr/Cr holds two letters: narrower than its heading would make it (the heading still shows whole).
      if (column.key === "dr_cr") { widths[column.key] = Math.round(wanted * 0.85); continue; }
      widths[column.key] = Math.min(Math.max(280, column.width || 0), Math.max(30, column.width || 90, wanted));
    }
    return widths;
  }, [columns, allRows]);
  const layout = useColumnLayout(columns, 0, (column) => startWidths[column.key] ?? 90);
  /** The rows after every column filter except `skip` (so a column's list offers what the others leave). */
  const filtered = (skip: string | null) => allRows.filter((row) => columns.every((column) => {
    if (column.key === skip) return true;
    const filter = filters.filters[column.key];
    return !filter || filterHolds(kindOf(column), filter, row[column.key] ?? "", shownOf(column, row));
  }));
  const needle = search.trim().toUpperCase();
  const rows = useMemo(() => {
    const kept = filtered(null).filter((row) => needle === "" || columns.some((column) => shownOf(column, row).toUpperCase().includes(needle)));
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- filtered / shownOf / kindOf only read columns, allRows and the filters named here
  }, [allRows, columns, filters.filters, needle, sort]);
  const valuesOf = (column: Column) => sortedDistinct(filtered(column.key).map((row) => shownOf(column, row)));

  // A list that has just come in: the cursor goes to the first row of the document number column and the keyboard to the list.
  useEffect(() => {
    if (!preview) return;
    const docNo = columns.findIndex((column) => column.key.toLowerCase() === "doc_no");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the cursor moves with the keyboard focus, which needs the list drawn
    setCurrent({ row: 0, column: docNo >= 0 ? docNo : Math.min(1, Math.max(0, columns.length - 1)) });
    scroller.current?.focus({ preventScroll: true });
  }, [preview, columns]);
  // The current row stays on a row the filters leave.
  const currentRow = Math.min(current.row, Math.max(0, rows.length - 1));
  useEffect(() => { latest.current = { row: currentRow, column: current.column }; });
  // The window of rows drawn: where the list is scrolled to and how tall it is.
  const [frame, setFrame] = useState({ top: 0, height: 700 });
  /** Scrolls the list so the current row and column are in view. */
  const showCurrent = () => {
    const box = scroller.current;
    if (!box) return;
    const rowTop = HEAD_HEIGHT + latest.current.row * ROW_HEIGHT;
    if (rowTop < box.scrollTop + HEAD_HEIGHT) box.scrollTop = rowTop - HEAD_HEIGHT;
    else if (rowTop + ROW_HEIGHT > box.scrollTop + box.clientHeight) box.scrollTop = rowTop + ROW_HEIGHT - box.clientHeight;
  };
  const measure = () => {
    const box = scroller.current;
    const outer = wrap.current;
    if (outer && box) {
      // The tab is hidden (display none) while an entry is open: its scroll position is lost, so on showing again the current row is brought back into view.
      if (outer.clientHeight === 0) hidden.current = true;
      else {
        const extra = box.offsetHeight - box.clientHeight;
        const wanted = HEAD_HEIGHT + Math.max(1, Math.floor((outer.clientHeight - extra - HEAD_HEIGHT) / ROW_HEIGHT)) * ROW_HEIGHT + extra;
        setFit((now) => (now === wanted ? now : wanted));
        if (hidden.current) { hidden.current = false; requestAnimationFrame(() => { showCurrent(); box.focus({ preventScroll: true }); }); }
      }
    }
    if (box) setFrame((now) => (now.top === box.scrollTop && now.height === box.clientHeight ? now : { top: box.scrollTop, height: box.clientHeight }));
  };
  useEffect(() => {
    measure();
    const box = scroller.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(box);
    if (wrap.current) watch.observe(wrap.current);
    return () => watch.disconnect();
  }, []);
  // The current row stays in view (the rows are drawn from the window, so it is not looked up in the page).
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const rowTop = HEAD_HEIGHT + currentRow * ROW_HEIGHT;
    if (rowTop < box.scrollTop + HEAD_HEIGHT) box.scrollTop = rowTop - HEAD_HEIGHT;
    else if (rowTop + ROW_HEIGHT > box.scrollTop + box.clientHeight) box.scrollTop = rowTop + ROW_HEIGHT - box.clientHeight;
  }, [currentRow]);
  // The current column stays in view sideways, as in the other grids.
  const currentColumn = Math.min(current.column, Math.max(0, columns.length - 1));
  useEffect(() => {
    const box = scroller.current;
    if (!box || !columns[currentColumn]) return;
    let left = 0;
    for (let at = 0; at < currentColumn; at += 1) left += layout.widthOf(columns[at]);
    const right = left + layout.widthOf(columns[currentColumn]);
    if (left < box.scrollLeft) box.scrollLeft = left;
    else if (right > box.scrollLeft + box.clientWidth) box.scrollLeft = right - box.clientWidth + 12;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a move to another column scrolls sideways
  }, [currentColumn]);
  const first = Math.max(0, Math.floor(frame.top / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((frame.top + frame.height) / ROW_HEIGHT) + OVERSCAN);

  // ---- Copy for Excel / Word / Notepad: tab between cells, a line per row (as the report grid copies)
  const copyText = async (text: string, said: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(said); } catch { setCopied("The browser did not allow copying"); }
  };
  const cellText = (row: Readonly<Record<string, string>> | undefined, column: Column | undefined) => (row && column ? shownOf(column, row).trim() : "");
  const copyCell = (rowAt: number, colAt: number) => void copyText(cellText(rows[rowAt], columns[colAt]), "Cell copied");
  const copyColumn = (colAt: number, withHeading: boolean) => {
    const column = columns[colAt];
    if (!column) return;
    const lines = rows.map((row) => cellText(row, column));
    void copyText((withHeading ? [column.caption, ...lines] : lines).join("\n"), `Column "${column.caption}" copied (${rows.length} rows${withHeading ? ", with heading" : ""})`);
  };
  const copyRow = (rowAt: number) => void copyText(columns.map((column) => cellText(rows[rowAt], column)).join("\t"), "Row copied");
  const copyAll = () => void copyText([columns.map((column) => column.caption).join("\t"), ...rows.map((row) => columns.map((column) => cellText(row, column)).join("\t"))].join("\n"), `All ${rows.length} rows copied`);
  const menuItems = (place: { col: number; row: number }): GridMenuItem[] => {
    const caption = columns[place.col]?.caption ?? "";
    return [
      ...(rows[place.row] ? [{ label: "Copy Cell (Ctrl+C)", title: "Copy this cell", onClick: () => copyCell(place.row, place.col) }, { label: "Copy Row", title: "Copy this entry's cells, tab between them", onClick: () => copyRow(place.row) }] : []),
      { label: `Copy Column "${caption}" (Ctrl+Shift+C)`, title: "Copy the whole column with its heading to paste in Excel, Word or Notepad", onClick: () => copyColumn(place.col, true) },
      { label: `Copy Column "${caption}" (Values Only)`, title: "Copy the column's values without the heading", onClick: () => copyColumn(place.col, false) },
      { label: "Copy All Rows (with headings)", title: "Copy every column of the rows shown", onClick: copyAll },
    ];
  };
  const contextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const spot = (event.target as Element).closest("[data-col]");
    if (!spot) return;
    event.preventDefault();
    const col = Number(spot.getAttribute("data-col"));
    const rowAttr = (spot.closest("[data-row]") as HTMLElement | null)?.dataset.row;
    const row = rowAttr === undefined ? -1 : Number(rowAttr);
    if (row >= 0) setCurrent({ row, column: col });
    setMenu({ x: event.clientX, y: event.clientY, col, row });
  };

  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("input, .mp-filter")) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "c") { event.preventDefault(); if (event.shiftKey) copyColumn(current.column, true); else copyCell(currentRow, current.column); return; }
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

  const tickWidth = ticked && onTick ? 34 : 0;
  const tableWidth = tickWidth + columns.reduce((sum, column) => sum + layout.widthOf(column), 0);
  return (
    <div ref={grid} className="ent-find" style={style}>
      <div className="mp-help-title ent-find-title"><span><HelpIcon name="file-text" /><b className="mp-help-name">FIND / EDIT HELP</b></span></div>
      <div ref={wrap} className="ent-find-wrap">
      <div ref={scroller} className="ent-grid ent-find-grid" style={fit === null ? undefined : { height: fit }} tabIndex={0} role="grid" aria-label="Entries" aria-rowcount={rows.length} onKeyDown={keys} onScroll={measure} onContextMenu={contextMenu}>
        <table style={{ width: tableWidth }}>
          <colgroup>{tickWidth > 0 && <col style={{ width: tickWidth }} />}{columns.map((column) => <col key={column.key} style={{ width: layout.widthOf(column) }} />)}</colgroup>
          <thead>
            <tr>
              {tickWidth > 0 && <th className="ent-tick-head" title="Range: tick the entries to print">✓</th>}
              {columns.map((column, index) => (
                <th key={column.key} data-col={index} className={filters.filters[column.key] ? "ent-filtered" : ""} style={{ textAlign: column.align === "R" ? "right" : "left" }} title={column.caption} onClick={() => setCurrent((at) => ({ ...at, column: index }))}>
                  <button type="button" tabIndex={-1} className="ent-th-text ent-sortable" title={`${column.caption} · click to sort (ascending, descending, none)`} onClick={(event) => { event.stopPropagation(); setCurrent((at) => ({ ...at, column: index })); setSort((now) => (now?.key !== column.key ? { key: column.key, down: false } : now.down ? null : { key: column.key, down: true })); }}>{column.caption}{sort?.key === column.key ? <span className="ent-sort-mark">{sort.down ? " ▼" : " ▲"}</span> : null}</button>
                  <FilterButton caption={column.caption} skipTab onOpen={() => filters.open(column.key, valuesOf(column))} />
                  {layout.resizeHandle(column)}
                  <FilterPopup state={filters} columnKey={column.key} caption={column.caption} kind={kindOf(column)} values={filters.openFilter === column.key ? valuesOf(column) : []} area={grid} floating />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {first > 0 && <tr aria-hidden="true" style={{ height: first * ROW_HEIGHT }}><td colSpan={Math.max(1, columns.length) + (tickWidth > 0 ? 1 : 0)} style={{ padding: 0, border: 0, height: first * ROW_HEIGHT }} /></tr>}
            {rows.slice(first, last).map((row, offset) => { const index = first + offset; return (
              <tr key={`${row.unique_key ?? ""}-${index}`} data-row={index} className={index === currentRow ? "ent-find-current" : index % 2 ? "ent-alt" : ""} onMouseDown={() => setCurrent((at) => ({ ...at, row: index }))} onDoubleClick={() => onOpen(row)}>
                {tickWidth > 0 && <td className="ent-tick-cell" onMouseDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}><input type="checkbox" tabIndex={-1} aria-label="Tick for range print" checked={ticked!.includes(Number(row.unique_key))} onChange={() => onTick!(Number(row.unique_key))} /></td>}
                {columns.map((column, at) => (
                  <td key={column.key} data-col={at} title={tipOf(column, row)} className={index === currentRow && at === current.column ? "ent-find-cell" : ""} style={{ textAlign: column.align === "R" ? "right" : "left" }} onMouseDown={() => { typed.current.text = ""; setFound(""); setCurrent({ row: index, column: at }); }}>{index === currentRow && at === current.column && found ? <FoundText text={shownOf(column, row)} typed={found} /> : <MarkedText text={shownOf(column, row)} query={search} />}</td>
                ))}
              </tr>
            ); })}
            {last < rows.length && <tr aria-hidden="true" style={{ height: (rows.length - last) * ROW_HEIGHT }}><td colSpan={Math.max(1, columns.length) + (tickWidth > 0 ? 1 : 0)} style={{ padding: 0, border: 0, height: (rows.length - last) * ROW_HEIGHT }} /></tr>}
            {rows.length === 0 && <tr><td colSpan={Math.max(1, columns.length) + (tickWidth > 0 ? 1 : 0)} className="ent-empty">{preview ? "No entries" : "Loading…"}</td></tr>}
          </tbody>
        </table>
      </div>
      </div>
      <div className="ent-find-foot">
        {copied && <span className="ent-find-copied" role="status">{copied}</span>}
        <span>{preview ? `Total Records : ${rows.length}${rows.length !== allRows.length ? ` of ${allRows.length}` : ""}` : ""}</span>
        <label className="ent-find-search">Search <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="text in any column" aria-label="Search the entries" /></label>
        {onMode && <button type="button" className={`mp-btn mp-btn-blue ent-all-fields ${mode === "fields" ? "ent-all-on" : ""}`} aria-pressed={mode === "fields"} title="Show every field of each entry: slab amounts and addons (read when pressed; quicker than with product)" onClick={() => onMode(mode === "fields" ? "" : "fields")}><Icon name="list" />{mode === "fields" ? "Basic fields" : "All fields"}</button>}
        {onMode && <button type="button" className={`mp-btn mp-btn-blue ent-all-fields ${mode === "products" ? "ent-all-on" : ""}`} aria-pressed={mode === "products"} title={outstanding ? "Show every field of each entry and each row's outstanding set-offs (read when pressed; takes longer)" : "Show every field of each entry and each product line (read when pressed; takes longer)"} onClick={() => onMode(mode === "products" ? "" : "products")}><Icon name="list" />{mode === "products" ? "Basic fields" : outstanding ? "With Outstanding" : "With product"}</button>}
        {Object.keys(filters.filters).length > 0 && <button type="button" className="ent-link-button" onClick={filters.clearAll}>Clear filters</button>}
        <span className="ent-find-tip">type in the list to find · Enter / double-click opens the entry · right-click: copy</span>
      </div>
      {menu && <GridMenu at={menu} onClose={() => { setMenu(null); scroller.current?.focus(); }} items={menuItems(menu)} />}
    </div>
  );
}
