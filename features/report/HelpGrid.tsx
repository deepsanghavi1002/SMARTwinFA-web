"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { parseDesktopDate } from "../../lib/master-program/legacy";
import type { HelpColumn, HelpGrid as HelpGridData } from "../../lib/report/types";
import { FilterButton, FilterPopup, useColumnFilters } from "../grid/ColumnFilter";
import { filterHolds, kindOfFieldType, sortedDistinct } from "../grid/filter";
import { FoundText } from "../grid/FoundText";
import { selectionTotals } from "../grid/totals";
import { useColumnLayout } from "../grid/useColumnLayout";
import { messageBox } from "../ui/MessageBox";

/**
 * A selection help grid of the report screen (C1HelpAccount, C1HelpBook, C1HelpSchedule,
 * C1HelpAddon ..., and the Report Options): the rows the group can be limited to, each with a
 * TICK. As on the desktop the ticks can be changed only while the group is ticked (Enable_Tick);
 * Space or Enter ticks the current row, F4 ticks or unticks every row shown (by the first row's
 * tick), F6 inverts them, and typing finds the next row whose text in the current column starts
 * with what was typed (C1help_Keypress_Search), marked as the master grid marks it.
 *
 * As every grid of the web version (features/grid): a heading click sorts, ▾ filters, the heading's
 * right edge sets the width, and Shift+click / Shift+↑↓ on a number column totals the selected rows.
 * The search box above narrows the rows to those whose main column (the first after Tick)
 * contains the text; with `freezeMain` Tick and the main column stay put while the grid scrolls.
 */

const ROW = 22;
const TICK_WIDTH = 42;

type Row = Readonly<Record<string, string>>;

/** A heading as proper text: "add_remark" → "Add Remark", "CURR TYPE" → "Curr Type"; mixed case is kept ("Closing Bal."). */
export function properCaption(caption: string): string {
  return caption.replace(/_/g, " ").replace(/\s+/g, " ").trim().split(" ").map((word) => {
    if (word !== word.toUpperCase() && word !== word.toLowerCase()) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(" ");
}

/** A cell with every place the search text appears marked. */
function Marked({ text, needle }: { text: string; needle: string }) {
  if (needle === "") return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
    parts.push(text.slice(from, at), <mark key={at} className="mp-found">{text.slice(at, at + needle.length)}</mark>);
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

export function HelpGrid({ help, enabled, ticked, rowKey, filter, rowDisabled, onTicks, focusKey, hidden, disabledText, freezeMain = false, onTabOut, findSlot, groupName, onStatus }: {
  help: HelpGridData;
  enabled: boolean;
  /** Keys of the ticked rows. */
  ticked: ReadonlySet<string>;
  /** A row's tick key (the addon grid's is fiel_key|sub_code). */
  rowKey: (row: Row) => string;
  /** Rows shown (the addon grid shows the chosen addon's subs only). */
  filter?: (row: Row) => boolean;
  /** A row whose tick cannot be changed (an option the setup disables). */
  rowDisabled?: (row: Row) => boolean;
  onTicks: (next: Set<string>) => void;
  /** Changing it puts the keyboard in the grid. */
  focusKey: number;
  /** Kept mounted but not shown, so its sort, filters and widths stay while another tab is open. */
  hidden?: boolean;
  disabledText?: string;
  /** Tick and the main column stay put while the grid scrolls sideways. */
  freezeMain?: boolean;
  /** Tab (or Shift+Tab) leaves the grid: the screen moves the keyboard on. */
  onTabOut?: (back: boolean) => void;
  /** Where the search box goes (the help tabs' line); without one it is not shown. */
  findSlot?: HTMLElement | null;
  /** The group's name for the status line ("Account"). */
  groupName?: string;
  /** The status line while the grid has the keyboard (DoHelpGridStatusSettings): hot keys, message, error. */
  onStatus?: (hotKeys: string, message: string, error: boolean) => void;
}) {
  const baseRows = useMemo(() => (filter ? help.rows.filter(filter) : help.rows), [help.rows, filter]);
  const shownColumns = useMemo(() => help.columns.filter((column) => column.visible && column.key.toLowerCase() !== "tick"), [help.columns]);
  const layout = useColumnLayout(shownColumns, freezeMain ? 1 : 0, (column) => Math.max(40, column.width || 90));
  const columns = layout.columns;
  const mainKey = shownColumns[0]?.key ?? "";
  const columnFilters = useColumnFilters();
  const { filters } = columnFilters;
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [cursor, setCursor] = useState(0);
  const [col, setCol] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  /** Type to find: the letters typed so far, in the current column. */
  const [typed, setTyped] = useState("");
  /** The search box: rows whose main column contains it. */
  const [find, setFind] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const searchAt = useRef(0);
  const findInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (focusKey > 0 && !hidden) box.current?.focus(); }, [focusKey, hidden]);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { if (element.clientHeight > 0) setHeight(element.clientHeight); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const kindOf = (column: HelpColumn) => kindOfFieldType(column.type);
  /** A cell as shown: numbers with Indian grouping and the column's decimals, as the desktop's format string. */
  const shown = (column: HelpColumn, value: string) => {
    if (kindOf(column) !== "number" || value.trim() === "") return value;
    const number = Number(value.replace(/,/g, ""));
    if (!Number.isFinite(number)) return value;
    const places = column.type === "I" ? 0 : column.decimals || (value.includes(".") ? value.split(".")[1].length : 0);
    return number.toLocaleString("en-IN", { minimumFractionDigits: places, maximumFractionDigits: places });
  };
  const needle = find.trim().toLowerCase();
  /** Whether a row passes the search box and every column filter but `except` (the one whose list is being opened). */
  const passes = (row: Row, except?: string) => (needle === "" || (row[mainKey] ?? "").toLowerCase().includes(needle)) && Object.entries(filters).every(([key, columnFilter]) => {
    if (key === except) return true;
    const column = shownColumns.find((candidate) => candidate.key === key);
    const value = row[key] ?? "";
    return !column || filterHolds(kindOf(column), columnFilter, value.replace(/,/g, ""), shown(column, value));
  });
  const rows = useMemo(() => {
    let list = baseRows.filter((row) => passes(row));
    if (sort) {
      const column = shownColumns.find((candidate) => candidate.key === sort.key);
      const kind = column ? kindOfFieldType(column.type) : "text";
      const value = (row: Row) => row[sort.key] ?? "";
      list = [...list].sort((a, b) => {
        const order = kind === "number" ? Number(value(a).replace(/,/g, "") || 0) - Number(value(b).replace(/,/g, "") || 0)
          : kind === "date" ? (parseDesktopDate(value(a))?.getTime() ?? 0) - (parseDesktopDate(value(b))?.getTime() ?? 0)
          : value(a).localeCompare(value(b), undefined, { numeric: true, sensitivity: "base" });
        return sort.dir === "asc" ? order : -order;
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- passes reads filters, the search and shownColumns
  }, [baseRows, filters, sort, shownColumns, needle, mainKey]);
  const valuesOf = (column: HelpColumn) => sortedDistinct(baseRows.filter((row) => passes(row, column.key)).map((row) => shown(column, row[column.key] ?? "")));

  const at = Math.min(cursor, Math.max(0, rows.length - 1));
  const atCol = Math.min(col, Math.max(0, columns.length - 1));
  const lefts: number[] = [];
  columns.reduce((left, column, index) => { lefts[index] = left; return left + layout.widthOf(column); }, TICK_WIDTH);
  const frozenCount = freezeMain ? 1 : 0;
  const frozenStyle = (index: number) => (index < frozenCount ? { position: "sticky" as const, left: lefts[index] } : {});

  const reveal = (index: number) => {
    const element = box.current;
    if (!element) return;
    const top = (index + 1) * ROW;
    if (top < element.scrollTop + ROW) element.scrollTop = top - ROW;
    else if (top + ROW > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW - element.clientHeight;
    setScrollTop(element.scrollTop); // the rows to draw follow at once, not on the next scroll event
  };
  const revealColumn = (index: number) => {
    const element = box.current;
    const column = columns[index];
    if (!element || !column || index < frozenCount) return;
    const frozenRight = frozenCount > 0 ? lefts[0] + layout.widthOf(columns[0]) : TICK_WIDTH;
    const left = lefts[index];
    const right = left + layout.widthOf(column);
    if (right > element.scrollLeft + element.clientWidth) element.scrollLeft = right - element.clientWidth;
    if (left < element.scrollLeft + frozenRight) element.scrollLeft = Math.max(0, left - frozenRight);
  };
  const moveCol = (index: number) => { const next = Math.max(0, Math.min(columns.length - 1, index)); setCol(next); setTyped(""); revealColumn(next); };
  const move = (index: number, extend = false) => {
    const next = Math.max(0, Math.min(rows.length - 1, index));
    if (extend) setSelectionEnd(next);
    else { setSelectionEnd(null); setCursor(next); }
    reveal(next);
  };
  const canTick = (row: Row) => enabled && !(rowDisabled?.(row) ?? false);
  /** The row a tick last landed on: Shift+click ticks from it to the row clicked. */
  const tickAnchor = useRef<number | null>(null);
  /** Ticks (or unticks, as the first of them was) rows from..upto, those that can be ticked. */
  const tickRange = (from: number, upto: number, on: boolean) => {
    const next = new Set(ticked);
    for (let index = Math.min(from, upto); index <= Math.max(from, upto); index += 1) {
      const row = rows[index];
      if (!row || !canTick(row)) continue;
      if (on) next.add(rowKey(row)); else next.delete(rowKey(row));
    }
    onTicks(next);
  };
  const toggle = (index: number, range = false) => {
    const row = rows[index];
    if (!row || !canTick(row)) return;
    const on = !ticked.has(rowKey(row));
    const anchor = tickAnchor.current;
    tickAnchor.current = index;
    if (range && anchor !== null && anchor !== index) tickRange(anchor, index, on);
    else tickRange(index, index, on);
  };

  const keys = async (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab" && onTabOut) { event.preventDefault(); onTabOut(event.shiftKey); return; }
    if (event.ctrlKey && event.key.toLowerCase() === "f") { event.preventDefault(); findInput.current?.focus(); return; }
    if (rows.length === 0) return;
    const page = Math.max(1, Math.floor(height / ROW) - 2);
    const end = selectionEnd ?? at;
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); if (event.shiftKey) move(end + 1, true); else move(at + 1); setTyped(""); return;
      case "ArrowUp": event.preventDefault(); if (event.shiftKey) move(end - 1, true); else move(at - 1); setTyped(""); return;
      case "ArrowLeft": event.preventDefault(); moveCol(atCol - 1); return;
      case "ArrowRight": event.preventDefault(); moveCol(atCol + 1); return;
      case "PageDown": event.preventDefault(); move(at + page); setTyped(""); return;
      case "PageUp": event.preventDefault(); move(at - page); setTyped(""); return;
      case "Home": if (event.ctrlKey) { event.preventDefault(); move(0); } return;
      case "End": if (event.ctrlKey) { event.preventDefault(); move(rows.length - 1); } return;
      case " ":
      case "Enter": {
        event.preventDefault();
        // With rows selected (Shift+click or Shift+↑↓) Space ticks them all, as the cursor row goes.
        if (event.key === " " && selectionEnd !== null && selectionEnd !== at) { const row = rows[at]; if (row && canTick(row)) tickRange(at, selectionEnd, !ticked.has(rowKey(row))); }
        else toggle(at, event.shiftKey);
        if (event.key === "Enter") move(at + 1);
        setTyped("");
        return;
      }
      case "F4":
      case "F6": {
        event.preventDefault();
        if (!enabled) { await messageBox.alert(event.key === "F4" ? "Select All Failed..\nPlease Check / Select Appropriate Group Field" : "Invert Selection Failed..\nPlease Check / Select Appropriate Group Field", "Operation Failed!"); return; }
        const next = new Set(ticked);
        const firstTicked = ticked.has(rowKey(rows[0]));
        for (const row of rows) {
          if (!canTick(row)) continue;
          const key = rowKey(row);
          const on = event.key === "F4" ? !firstTicked : !ticked.has(key);
          if (on) next.add(key); else next.delete(key);
        }
        onTicks(next);
        return;
      }
      case "Backspace": event.preventDefault(); setTyped((text) => text.slice(0, -1)); return;
      case "Escape": setTyped(""); setSelectionEnd(null); return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      const text = (typed + event.key).toUpperCase();
      const column = columns[atCol];
      if (!column) return;
      const cellText = (row: Row) => shown(column, row[column.key] ?? "").trimStart().toUpperCase();
      const start = typed === "" ? at : searchAt.current;
      const found = rows.findIndex((row, index) => index >= start && cellText(row).startsWith(text));
      const index = found >= 0 ? found : rows.findIndex((row) => cellText(row).startsWith(text));
      if (index >= 0) { searchAt.current = index; move(index); setTyped(text); }
    }
  };

  const mouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    const rowElement = target.closest("[data-row]");
    if (!rowElement) return;
    const index = Number(rowElement.getAttribute("data-row"));
    const cell = target.closest("[data-col]");
    if (cell) { setCol(Number(cell.getAttribute("data-col"))); setTyped(""); }
    if (target.closest(".rp-tick")) { if (event.shiftKey) event.preventDefault(); else { setSelectionEnd(null); setCursor(index); } return; }
    if (event.shiftKey) { event.preventDefault(); setSelectionEnd(index); return; }
    setSelectionEnd(null);
    setCursor(index);
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW) - 5);
  const last = Math.min(rows.length, first + Math.ceil(height / ROW) + 10);
  const tickCount = baseRows.reduce((count, row) => count + (ticked.has(rowKey(row)) ? 1 : 0), 0);
  const align = (value: string) => (value === "R" ? "right" : value === "C" ? "center" : "left");
  const cellAlign = (column: HelpColumn) => (kindOf(column) === "number" && column.align === "L" ? "right" : align(column.align));
  const low = selectionEnd === null ? at : Math.min(at, selectionEnd);
  const high = selectionEnd === null ? at : Math.max(at, selectionEnd);
  const totalColumn = columns[atCol];
  const totals = selectionEnd !== null && high > low && totalColumn && kindOf(totalColumn) === "number"
    ? selectionTotals(rows.slice(low, high + 1).map((row) => row[totalColumn.key] ?? ""), totalColumn.decimals || 2)
    : null;
  const filtered = Object.keys(filters).length > 0;
  const width = TICK_WIDTH + columns.reduce((sum, column) => sum + layout.widthOf(column), 0);
  const name = groupName || help.grid.replace("C1Help", "");
  const tellStatus = () => {
    if (!onStatus) return;
    if (baseRows.length === 0) onStatus("", `No records found for : ${name}`, true);
    else if (!enabled) onStatus("", `Tick ${name} in Groups to begin selection`, true);
    else onStatus(`F6 : Invert Selection / F4 : ${ticked.has(rowKey(baseRows[0])) ? "Deselect All" : "Select All"} / Shift+Click : Tick Range / Ctrl+F : Search`, `Selected ${name} will only be taken`, false);
  };
  const caption = (column: HelpColumn) => (column.key === mainKey ? column.caption.replace(/_/g, " ").toUpperCase() : properCaption(column.caption));
  const mainCaption = shownColumns[0] ? caption(shownColumns[0]) : "";

  return (
    <div className="rp-help" hidden={hidden}>
      {findSlot && !hidden && createPortal(
      <div className="rp-help-find">
        <span className="rp-help-find-icon" aria-hidden="true">⌕</span>
        <input
          ref={findInput}
          type="search"
          tabIndex={-1}
          placeholder={`Search ${mainCaption.toLowerCase()}…  (Ctrl+F)`}
          aria-label={`Search ${mainCaption}`}
          value={find}
          onChange={(event) => { setFind(event.target.value); setTyped(""); setCursor(0); setSelectionEnd(null); if (box.current) box.current.scrollTop = 0; }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); if (find !== "") setFind(""); else box.current?.focus(); }
            if (event.key === "ArrowDown" || event.key === "Enter") { event.preventDefault(); box.current?.focus(); }
          }}
        />
      </div>, findSlot)}
      <div ref={box} className={`mp-scroll rp-help-scroll ${enabled ? "" : "rp-help-off"}`} tabIndex={-1} role="grid" aria-label={help.grid} onFocus={tellStatus} onKeyDown={(event) => void keys(event)} onMouseDown={mouseDown} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <div className="mp-grid" style={{ height: (rows.length + 1) * ROW, minWidth: width }}>
          <div className="mp-row mp-head" style={{ top: 0 }}>
            <div className={`mp-cell rp-tick ${freezeMain ? "mp-frozen" : ""}`} style={freezeMain ? { position: "sticky", left: 0 } : undefined}><span className="mp-head-label">Tick</span></div>
            {columns.map((column, index) => (
              <div key={column.key} className={`mp-cell ${index < frozenCount ? "mp-frozen" : ""} ${filters[column.key] ? "mp-filtered" : ""} ${index === atCol ? "rp-head-on" : ""}`} style={{ width: layout.widthOf(column), textAlign: align(column.align), ...frozenStyle(index) }} title={`${caption(column)} · click to sort · ▾ to filter`}>
                <button type="button" tabIndex={-1} className="mp-head-label" onClick={() => setSort((current) => (current?.key === column.key && current.dir === "asc" ? { key: column.key, dir: "desc" } : current?.key === column.key ? null : { key: column.key, dir: "asc" }))}>
                  {caption(column)}{sort?.key === column.key && <i>{sort.dir === "asc" ? " ▲" : " ▼"}</i>}
                </button>
                <FilterButton caption={caption(column)} onOpen={() => columnFilters.open(column.key, valuesOf(column))} skipTab />
                {layout.resizeHandle(column)}
                <FilterPopup state={columnFilters} columnKey={column.key} caption={caption(column)} kind={kindOf(column)} values={columnFilters.openFilter === column.key ? valuesOf(column) : []} area={box} />
              </div>
            ))}
          </div>
          {rows.slice(first, last).map((row, offset) => {
            const index = first + offset;
            const on = ticked.has(rowKey(row));
            const selected = selectionEnd !== null && index >= low && index <= high;
            return (
              <div key={index} className={`mp-row ${index % 2 ? "mp-alt" : ""} ${index === at ? "mp-current-row" : ""} ${selected ? "mp-selected" : ""} ${on ? "rp-row-ticked" : ""}`} style={{ top: (index + 1) * ROW }} data-row={index}>
                <div className={`mp-cell rp-tick ${freezeMain ? "mp-frozen" : ""}`} style={freezeMain ? { position: "sticky", left: 0 } : undefined}><input type="checkbox" checked={on} disabled={!canTick(row)} onChange={() => undefined} onClick={(event) => toggle(index, event.shiftKey)} aria-label="Tick" tabIndex={-1} title="Click to tick · Shift+Click ticks every row from the last one ticked" /></div>
                {columns.map((column, columnIndex) => {
                  const text = shown(column, row[column.key] ?? "");
                  const here = index === at && columnIndex === atCol;
                  return (
                    <div key={column.key} data-col={columnIndex} className={`mp-cell ${columnIndex < frozenCount ? "mp-frozen" : ""} ${here ? "rp-cell-on" : ""}`} style={{ width: layout.widthOf(column), textAlign: cellAlign(column), ...frozenStyle(columnIndex) }}>
                      {here && typed ? <FoundText text={text} typed={typed} /> : column.key === mainKey ? <Marked text={text} needle={needle} /> : text}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="rp-help-bar">
        {typed && <span className="rp-help-search">Find in {columns[atCol] ? caption(columns[atCol]) : ""}: {typed}</span>}
        <span>{tickCount} of {baseRows.length} ticked{filtered || needle || rows.length !== baseRows.length ? ` · ${rows.length} shown` : ""}</span>
        {(filtered || needle) && <button type="button" tabIndex={-1} className="rp-link" onClick={() => { columnFilters.clearAll(); setFind(""); }}>Clear filters</button>}
        {totals && <span className="mp-sel-totals" title={`Selected rows of ${totalColumn ? caption(totalColumn) : ""}`}>{totals}</span>}
        {!enabled && <span className="rp-help-keys">{disabledText ?? "Tick the group to select from this list"}</span>}
      </div>
    </div>
  );
}
