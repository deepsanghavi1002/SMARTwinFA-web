"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { FoundText, MarkedText } from "./FoundText";
import { HelpIcon, helpIconFor } from "./HelpIcon";

/**
 * The help list beside a field (the desktop's help grid). It scrolls under a coloured heading
 * row that stays at the top; typing a character moves to the first entry starting with what
 * has been typed in the column the keyboard is on (← → move that column, shown embossed); the search box at the top finds
 * what it is typed in any column and marks it; the arrow keys and PageUp / PageDown move; each column can be made wider or
 * narrower by dragging the right edge of its heading (double-click the edge to put it back).
 */
export type HelpColumn = Readonly<{ key: string; caption: string; width: number; align: string; format: string }>;
export type HelpData = Readonly<{ columns: readonly HelpColumn[]; rows: readonly Readonly<Record<string, string>>[]; total: string }>;

const ROW = 20;
/** Entries the list shows at once unless the screen asks for another number. */
const SHOWN = 15;
const OVERSCAN = 10;
const MIN_WIDTH = 24;
/** Typing pauses longer than this start a new search. */
const TYPE_PAUSE_MS = 1200;

export function HelpList({
  help, focusRow, onFocusRow, onChoose, searchKey, note, onClose, onEscape, style, dragHandle, onResetPosition, formatCell, shown = SHOWN, title, highlight = "", freezeSearch = false,
  onHeadingClick, sortMark, headingTools, filteredColumn, onKey, f1 = false, f7 = false, f8 = false, topSlot,
}: {
  help: HelpData;
  /** The entry to highlight and bring into view; -1 for none. */
  focusRow: number;
  onFocusRow: (row: number) => void;
  /** Enter in the list, or a double-click on an entry: take it (the entry screen's helps). */
  onChoose?: (row: number) => void;
  /** The column typed characters search; the first column when blank or unknown. */
  searchKey: string;
  note?: { text: string; warn: boolean } | null;
  onClose?: () => void;
  /** Esc inside the list: give the keyboard back to the grid. */
  onEscape?: () => void;
  style?: CSSProperties;
  dragHandle: Record<string, unknown>;
  onResetPosition: () => void;
  formatCell: (value: string, format: string) => string;
  /** How many entries the list shows at once. */
  shown?: number;
  /** The help's name in its first line (ACCOUNT HELP, PRODUCT HELP). */
  title?: string;
  /** The text typed in the field the help belongs to: marked where the search column starts with it. */
  highlight?: string;
  /** The search column stays put when the list scrolls sideways (the entry's helps). */
  freezeSearch?: boolean;
  /** Sorting and filters (useHelpView): a heading click, its ▲ / ▼, its ▾ filter, and whether a column is filtered. */
  onHeadingClick?: (column: HelpColumn) => void;
  sortMark?: (column: HelpColumn) => string;
  headingTools?: (column: HelpColumn) => ReactNode;
  filteredColumn?: (column: HelpColumn) => boolean;
  /** A key the screen takes before the list does (F5 ends the products); true when it took it. */
  onKey?: (event: ReactKeyboardEvent<HTMLDivElement>) => boolean;
  /** The help offers F1 (the master record of the row): said in the title's hint. */
  f1?: boolean;
  /** Something shown at the top of the help, under its title (the product help's product-type filter): it moves with the window. */
  topSlot?: ReactNode;
  /** The help offers F7: true is the Partywise Stock of the row's account; a text is the tag of another F7 view ("Party-Product"). */
  f7?: boolean | string;
  /** The help offers F8 (the Ledger of the row's account): said in the title's hint. */
  f8?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const typed = useRef({ text: "", at: 0 });
  /** What typing in the list has found so far: marked on the entry it landed on, as the master grid's type-to-find. */
  const [found, setFound] = useState("");
  /** The horizontal scroll bar's height, so it does not hide the last entry. */
  const [bar, setBar] = useState(0);
  /** The heading's and an entry row's real heights (a heading with filter buttons is taller than ROW), so `shown` entries show whole. */
  const [sizes, setSizes] = useState({ head: ROW, row: ROW });
  useLayoutEffect(() => {
    const head = scroller.current?.querySelector<HTMLElement>("thead")?.offsetHeight ?? 0;
    const row = scroller.current?.querySelector<HTMLElement>("tbody tr[role=option]")?.offsetHeight ?? 0;
    if (head > 0 && row > 0) setSizes((now) => (now.head === head && now.row === row ? now : { head, row }));
  });
  /** The column the keyboard is on: typing searches it (← → move it). Starts on the help's search column. */
  const [col, setCol] = useState<string | null>(null);
  /** The top search box: entries with this text in any column. */
  const [query, setQuery] = useState("");
  const searchBox = useRef<HTMLInputElement>(null);
  /** The vertical scroll bar's width, added so the columns fit without a sideways scroll. */
  const [sideBar, setSideBar] = useState(0);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    // The scroll bars' room only ever grows: the box is sized from it, and a bar that came and went with the box's own size made the list flash.
    const measure = () => { setBar((current) => Math.max(current, element.offsetHeight - element.clientHeight)); setSideBar((current) => Math.max(current, element.offsetWidth - element.clientWidth)); };
    measure();
    const observe = new ResizeObserver(measure);
    observe.observe(element);
    const table = element.querySelector("table");
    if (table) observe.observe(table);
    return () => observe.disconnect();
  }, []);

  const widthOf = (column: HelpColumn) => widths[column.key] ?? Math.max(MIN_WIDTH, column.width || 90);
  const tableWidth = help.columns.reduce((sum, column) => sum + widthOf(column), 0);
  /** The help's own main column (frozen on the entry screen); the cursor column starts here. */
  const mainColumn = help.columns.find((column) => column.key.toLowerCase() === searchKey.toLowerCase())?.key ?? help.columns[0]?.key ?? "";
  const searchColumn = help.columns.some((column) => column.key === col) ? col! : mainColumn;
  /** Where the frozen main column sits: after the columns before it. */
  const frozenLeft = help.columns.slice(0, Math.max(0, help.columns.findIndex((column) => column.key === mainColumn))).reduce((sum, column) => sum + widthOf(column), 0);
  /** With the search box in use: the entries (by their place in help.rows) that hold its text in some column. */
  const order = useMemo(() => {
    const needle = query.trim().toUpperCase();
    if (needle === "") return null;
    const hits: number[] = [];
    help.rows.forEach((row, index) => { if (help.columns.some((column) => formatCell(row[column.key] ?? "", column.format).toUpperCase().includes(needle))) hits.push(index); });
    return hits;
  }, [query, help, formatCell]);
  const count = order ? order.length : help.rows.length;
  const rowAt = (place: number) => help.rows[order ? order[place] : place];
  const originalOf = (place: number) => (order ? order[place] : place);
  const placeOf = (original: number) => (original < 0 ? -1 : order ? order.indexOf(original) : original);
  const focusPlace = placeOf(focusRow);
  // The box narrows the list: the highlighted entry must be one of those left.
  useEffect(() => {
    if (order && order.length > 0 && !order.includes(focusRow)) onFocusRow(order[0]);
  }, [order]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bring the highlighted entry into view, a few rows down from the top when it has to move.
  useEffect(() => {
    const element = scroller.current;
    if (!element || focusPlace < 0) return;
    const top = focusPlace * ROW;
    const view = element.clientHeight - ROW;
    if (top < element.scrollTop || top + ROW > element.scrollTop + view) element.scrollTop = Math.max(0, top - ROW * 3);
  }, [focusPlace, help]);
  // The column the keyboard moved to is brought into view sideways.
  useEffect(() => { scroller.current?.querySelector("th.mp-help-cursor")?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [searchColumn]);

  const move = (place: number) => { if (count > 0) onFocusRow(originalOf(Math.min(count - 1, Math.max(0, place)))); };

  const root = useRef<HTMLDivElement>(null);
  /** The search box's keys: Enter / ↓ go on to the list (its first entry found, else its first entry), Esc empties it (then leaves the list). The title's own arrow keys (move the window) must not see them. */
  const searchKeys = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter" || event.key === "ArrowDown") {
      event.preventDefault();
      if (order) onFocusRow(order.length > 0 ? order[0] : 0);
      root.current?.focus();
    } else if (event.key === "Escape") { event.preventDefault(); if (query !== "") setQuery(""); else onEscape?.(); }
  };

  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") return;
    if ((event.target as Element).closest(".mp-drag-handle, .mp-filter")) return;
    if (onKey?.(event)) { event.stopPropagation(); return; }
    // The list sits inside the grid, whose own keys would otherwise move the grid as well.
    event.stopPropagation();
    // Ctrl+F / F3: to the search box.
    if ((event.ctrlKey && event.key.toLowerCase() === "f") || event.key === "F3") { event.preventDefault(); searchBox.current?.focus(); searchBox.current?.select(); return; }
    // ← →: the cursor column (the one typing searches) moves.
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      const at = help.columns.findIndex((column) => column.key === searchColumn);
      const next = help.columns[Math.min(help.columns.length - 1, Math.max(0, at + (event.key === "ArrowRight" ? 1 : -1)))];
      if (next) { setCol(next.key); typed.current.text = ""; setFound(""); }
      return;
    }
    const from = focusPlace < 0 ? 0 : focusPlace;
    if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", "Escape"].includes(event.key)) { typed.current.text = ""; setFound(""); }
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); move(focusPlace < 0 ? 0 : from + 1); return;
      case "ArrowUp": event.preventDefault(); move(from - 1); return;
      case "PageDown": event.preventDefault(); move(from + shown); return;
      case "PageUp": event.preventDefault(); move(from - shown); return;
      case "Home": event.preventDefault(); move(0); return;
      case "End": event.preventDefault(); move(count - 1); return;
      case "Escape": event.preventDefault(); event.stopPropagation(); typed.current.text = ""; onEscape?.(); return;
      case "Enter": if (onChoose && focusRow >= 0) { event.preventDefault(); onChoose(focusRow); } return;
      case "Backspace": event.preventDefault(); typed.current.text = typed.current.text.slice(0, -1); setFound(typed.current.text); return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    const now = Date.now();
    const text = (now - typed.current.at > TYPE_PAUSE_MS ? "" : typed.current.text) + event.key.toUpperCase();
    typed.current = { text, at: now };
    const start = focusPlace < 0 ? 0 : text.length > 1 ? focusPlace : focusPlace + 1;
    const hit = Array.from({ length: count }, (_unused, step) => (start + step) % Math.max(1, count)).find((place) => (rowAt(place)?.[searchColumn] ?? "").trim().toUpperCase().startsWith(text)) ?? -1;
    if (hit >= 0) { move(hit); setFound(text); }
    else typed.current.text = text.slice(0, -1);
  };

  const startResize = (column: HelpColumn, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widthOf(column);
    const moveTo = (moveEvent: MouseEvent) => setWidths((current) => ({ ...current, [column.key]: Math.max(MIN_WIDTH, startWidth + moveEvent.clientX - startX) }));
    const up = () => { document.removeEventListener("mousemove", moveTo); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", moveTo);
    document.addEventListener("mouseup", up);
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const last = Math.min(count, first + shown + OVERSCAN * 2);
  const colSpan = help.columns.length;

  return (
    <div ref={root} className="mp-help" style={style} tabIndex={0} role="listbox" aria-label={`Help: ${help.total}`} aria-activedescendant={focusPlace >= 0 ? `mp-help-row-${focusPlace}` : undefined} onKeyDown={keys}>
      <div className="mp-help-title mp-drag-handle" {...dragHandle} onDoubleClick={onResetPosition} title="Drag to move · double-click to put back">
        <span><HelpIcon name={helpIconFor(title)} />{title ? <b className="mp-help-name">{title}</b> : null}{help.total}{order ? ` · ${order.length} found` : ""}</span>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the search box's wrapper keeps a press or double click from reaching the title bar's drag */}
        <span className="mp-help-search" onMouseDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
          <input
            ref={searchBox}
            type="search"
            aria-label="Search in any column"
            placeholder="Search in any column…"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={searchKeys}
          />
        </span>
        {f1 && <kbd className="mp-help-f1" title="F1 opens the whole master record of the highlighted entry"><b>F1</b> Master details</kbd>}
        {f7 === true && <kbd className="mp-help-f1" title="F7 opens the Partywise Stock of the highlighted account"><b>F7</b> Partywise Stock</kbd>}
        {typeof f7 === "string" && f7 !== "" && <kbd className="mp-help-f1" title={`F7 opens the ${f7} stock of the highlighted row`}><b>F7</b>-{f7}</kbd>}
        {f8 && <kbd className="mp-help-f1" title="F8 opens the Ledger of the highlighted account"><b>F8</b> Ledger</kbd>}
        <span className="mp-help-tip">type to search the marked column · ← → change column · Ctrl+F search box</span>
        {onClose && <button type="button" onClick={onClose} aria-label="Close help">×</button>}
      </div>
      {topSlot}
      {note && <div className={`mp-help-note ${note.warn ? "mp-help-warn" : ""}`}>{note.text}</div>}
      <div className="mp-help-scroll" ref={scroller} style={{ flex: "0 1 auto", width: tableWidth + sideBar + 2, maxWidth: "100%", height: sizes.head + sizes.row * Math.min(shown, Math.max(1, count)) + bar }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <table style={{ width: tableWidth }}>
          <colgroup>{help.columns.map((column) => <col key={column.key} style={{ width: widthOf(column) }} />)}</colgroup>
          <thead>
            <tr>
              {help.columns.map((column) => (
                <th key={column.key} title={onHeadingClick ? `${column.caption} · click to sort` : column.caption}
                  className={[freezeSearch && column.key === mainColumn ? "mp-help-frozen" : "", column.key === searchColumn ? "mp-help-cursor" : "", onHeadingClick ? "mp-help-sortable" : "", filteredColumn?.(column) ? "mp-help-filtered" : ""].filter(Boolean).join(" ") || undefined}
                  style={freezeSearch && column.key === mainColumn ? { left: frozenLeft } : undefined}
                  onClick={() => { setCol(column.key); typed.current.text = ""; setFound(""); onHeadingClick?.(column); }}>
                  {column.caption}
                  {sortMark?.(column) ? <span className="mp-help-sort">{sortMark(column)}</span> : null}
                  {headingTools ? <span className="mp-help-tools" role="presentation" onClick={(event) => event.stopPropagation()}>{headingTools(column)}</span> : null}
                  <span className="mp-resize" role="presentation" title="Drag to resize · double-click to put back"
                    onMouseDown={(event) => startResize(column, event)}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={() => setWidths((current) => { const copy = { ...current }; delete copy[column.key]; return copy; })} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {first > 0 && <tr aria-hidden="true" style={{ height: first * ROW }}><td colSpan={colSpan} /></tr>}
            {Array.from({ length: Math.max(0, last - first) }, (_unused, offset) => first + offset).map((index) => {
              const row = rowAt(index);
              return (
                <tr key={index} id={`mp-help-row-${index}`} role="option" aria-selected={index === focusPlace} className={[index === focusPlace ? "mp-current-row" : "", index % 2 ? "mp-help-alt" : ""].filter(Boolean).join(" ") || undefined} onMouseDown={() => { typed.current.text = ""; setFound(""); onFocusRow(originalOf(index)); }} onDoubleClick={onChoose ? () => onChoose(originalOf(index)) : undefined}>
                  {help.columns.map((column) => {
                    const text = formatCell(row[column.key] ?? "", column.format);
                    const cursor = column.key === searchColumn;
                    const frozen = freezeSearch && column.key === mainColumn;
                    return <td key={column.key} title={text} onMouseDown={() => { if (!freezeSearch) setCol(column.key); }} className={[frozen ? "mp-help-frozen" : "", cursor ? "mp-help-cursor" : "", cursor && index === focusPlace ? "mp-help-cursor-now" : ""].filter(Boolean).join(" ") || undefined} style={{ textAlign: column.align === "R" ? "right" : "left", ...(frozen ? { left: frozenLeft } : {}) }}>{cursor && index === focusPlace && found ? <FoundText text={text} typed={found} /> : query.trim() !== "" ? <MarkedText text={text} query={query} /> : column.key === mainColumn && highlight ? <FoundText text={text} typed={highlight} /> : text}</td>;
                  })}
                </tr>
              );
            })}
            {last < count && <tr aria-hidden="true" style={{ height: (count - last) * ROW }}><td colSpan={colSpan} /></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
