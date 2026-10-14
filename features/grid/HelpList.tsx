"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { FoundText } from "./FoundText";

/**
 * The help list beside a field (the desktop's help grid). It scrolls under a coloured heading
 * row that stays at the top; typing a character moves to the first entry starting with what
 * has been typed; the arrow keys and PageUp / PageDown move; each column can be made wider or
 * narrower by dragging the right edge of its heading (double-click the edge to put it back).
 */
export type HelpColumn = Readonly<{ key: string; caption: string; width: number; align: string; format: string }>;
export type HelpData = Readonly<{ columns: readonly HelpColumn[]; rows: readonly Readonly<Record<string, string>>[]; total: string }>;

const ROW = 20;
/** Entries the list shows at once unless the screen asks for another number. */
const SHOWN = 15;
const OVERSCAN = 10;
const MIN_WIDTH = 30;
/** Typing pauses longer than this start a new search. */
const TYPE_PAUSE_MS = 1200;

export function HelpList({
  help, focusRow, onFocusRow, onChoose, searchKey, note, onClose, onEscape, style, dragHandle, onResetPosition, formatCell, shown = SHOWN, title, highlight = "", freezeSearch = false,
  onHeadingClick, sortMark, headingTools, filteredColumn, onKey,
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
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const typed = useRef({ text: "", at: 0 });
  /** What typing in the list has found so far: marked on the entry it landed on, as the master grid's type-to-find. */
  const [found, setFound] = useState("");
  /** The horizontal scroll bar's height, so it does not hide the last entry. */
  const [bar, setBar] = useState(0);
  /** The vertical scroll bar's width, added so the columns fit without a sideways scroll. */
  const [sideBar, setSideBar] = useState(0);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => { setBar(element.offsetHeight - element.clientHeight); setSideBar(element.offsetWidth - element.clientWidth); };
    measure();
    const observe = new ResizeObserver(measure);
    observe.observe(element);
    const table = element.querySelector("table");
    if (table) observe.observe(table);
    return () => observe.disconnect();
  }, []);

  const widthOf = (column: HelpColumn) => widths[column.key] ?? Math.max(MIN_WIDTH, column.width || 90);
  const tableWidth = help.columns.reduce((sum, column) => sum + widthOf(column), 0);
  const searchColumn = help.columns.find((column) => column.key.toLowerCase() === searchKey.toLowerCase())?.key ?? help.columns[0]?.key ?? "";
  /** Where the frozen search column sits: after the columns before it. */
  const frozenLeft = help.columns.slice(0, Math.max(0, help.columns.findIndex((column) => column.key === searchColumn))).reduce((sum, column) => sum + widthOf(column), 0);

  // Bring the highlighted entry into view, a few rows down from the top when it has to move.
  useEffect(() => {
    const element = scroller.current;
    if (!element || focusRow < 0) return;
    const top = focusRow * ROW;
    const view = element.clientHeight - ROW;
    if (top < element.scrollTop || top + ROW > element.scrollTop + view) element.scrollTop = Math.max(0, top - ROW * 3);
  }, [focusRow, help]);

  const move = (row: number) => onFocusRow(Math.min(help.rows.length - 1, Math.max(0, row)));

  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest(".mp-drag-handle, .mp-filter") || event.key === "Tab") return;
    if (onKey?.(event)) { event.stopPropagation(); return; }
    // The list sits inside the grid, whose own keys would otherwise move the grid as well.
    event.stopPropagation();
    const from = focusRow < 0 ? 0 : focusRow;
    if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", "Escape"].includes(event.key)) { typed.current.text = ""; setFound(""); }
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); move(focusRow < 0 ? 0 : from + 1); return;
      case "ArrowUp": event.preventDefault(); move(from - 1); return;
      case "PageDown": event.preventDefault(); move(from + shown); return;
      case "PageUp": event.preventDefault(); move(from - shown); return;
      case "Home": event.preventDefault(); move(0); return;
      case "End": event.preventDefault(); move(help.rows.length - 1); return;
      case "Escape": event.preventDefault(); event.stopPropagation(); typed.current.text = ""; onEscape?.(); return;
      case "Enter": if (onChoose && focusRow >= 0) { event.preventDefault(); onChoose(focusRow); } return;
      case "Backspace": event.preventDefault(); typed.current.text = typed.current.text.slice(0, -1); setFound(typed.current.text); return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    const now = Date.now();
    const text = (now - typed.current.at > TYPE_PAUSE_MS ? "" : typed.current.text) + event.key.toUpperCase();
    typed.current = { text, at: now };
    const hit = help.rows.findIndex((row) => (row[searchColumn] ?? "").trim().toUpperCase().startsWith(text));
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
  const last = Math.min(help.rows.length, first + shown + OVERSCAN * 2);
  const colSpan = help.columns.length;

  return (
    <div className="mp-help" style={style} tabIndex={0} role="listbox" aria-label={`Help: ${help.total}`} aria-activedescendant={focusRow >= 0 ? `mp-help-row-${focusRow}` : undefined} onKeyDown={keys}>
      <div className="mp-help-title mp-drag-handle" {...dragHandle} onDoubleClick={onResetPosition} title="Drag to move · double-click to put back">
        <span>{title ? <b className="mp-help-name">{title}</b> : null}{help.total}</span>
        <span className="mp-help-tip">type to search · drag a heading edge to resize</span>
        {onClose && <button type="button" onClick={onClose} aria-label="Close help">×</button>}
      </div>
      {note && <div className={`mp-help-note ${note.warn ? "mp-help-warn" : ""}`}>{note.text}</div>}
      <div className="mp-help-scroll" ref={scroller} style={{ flex: "0 1 auto", width: tableWidth + sideBar + 2, maxWidth: "100%", height: ROW * (Math.min(shown, Math.max(1, help.rows.length)) + 1) + 2 + bar }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <table style={{ width: tableWidth }}>
          <colgroup>{help.columns.map((column) => <col key={column.key} style={{ width: widthOf(column) }} />)}</colgroup>
          <thead>
            <tr>
              {help.columns.map((column) => (
                <th key={column.key} title={onHeadingClick ? `${column.caption} · click to sort` : column.caption}
                  className={[freezeSearch && column.key === searchColumn ? "mp-help-frozen" : "", column.key === searchColumn ? "mp-help-cursor" : "", onHeadingClick ? "mp-help-sortable" : "", filteredColumn?.(column) ? "mp-help-filtered" : ""].filter(Boolean).join(" ") || undefined}
                  style={freezeSearch && column.key === searchColumn ? { left: frozenLeft } : undefined}
                  onClick={onHeadingClick ? () => onHeadingClick(column) : undefined}>
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
            {help.rows.slice(first, last).map((row, offset) => {
              const index = first + offset;
              return (
                <tr key={index} id={`mp-help-row-${index}`} role="option" aria-selected={index === focusRow} className={index === focusRow ? "mp-current-row" : ""} onMouseDown={() => { typed.current.text = ""; setFound(""); onFocusRow(index); }} onDoubleClick={onChoose ? () => onChoose(index) : undefined}>
                  {help.columns.map((column) => {
                    const text = formatCell(row[column.key] ?? "", column.format);
                    const main = column.key === searchColumn;
                    return <td key={column.key} title={text} className={[freezeSearch && main ? "mp-help-frozen" : "", main ? "mp-help-cursor" : "", main && index === focusRow ? "mp-help-cursor-now" : ""].filter(Boolean).join(" ") || undefined} style={{ textAlign: column.align === "R" ? "right" : "left", ...(freezeSearch && main ? { left: frozenLeft } : {}) }}>{main && index === focusRow && found ? <FoundText text={text} typed={found} /> : main && highlight ? <FoundText text={text} typed={highlight} /> : text}</td>;
                  })}
                </tr>
              );
            })}
            {last < help.rows.length && <tr aria-hidden="true" style={{ height: (help.rows.length - last) * ROW }}><td colSpan={colSpan} /></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
