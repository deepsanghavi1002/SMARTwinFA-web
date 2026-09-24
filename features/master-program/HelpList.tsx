"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";

/**
 * The help list beside a field (the desktop's help grid). It scrolls under a coloured heading
 * row that stays at the top; typing a character moves to the first entry starting with what
 * has been typed; the arrow keys and PageUp / PageDown move; each column can be made wider or
 * narrower by dragging the right edge of its heading (double-click the edge to put it back).
 */
export type HelpColumn = { key: string; caption: string; width: number; align: string; format: string };
export type HelpData = { columns: HelpColumn[]; rows: Record<string, string>[]; total: string };

const ROW = 20;
/** Entries the list shows at once unless the screen asks for another number. */
const SHOWN = 15;
const OVERSCAN = 10;
const MIN_WIDTH = 30;
/** Typing pauses longer than this start a new search. */
const TYPE_PAUSE_MS = 1200;

export function HelpList({
  help, focusRow, onFocusRow, searchKey, note, onClose, onEscape, style, dragHandle, onResetPosition, formatCell, shown = SHOWN,
}: {
  help: HelpData;
  /** The entry to highlight and bring into view; -1 for none. */
  focusRow: number;
  onFocusRow: (row: number) => void;
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
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const typed = useRef({ text: "", at: 0 });
  /** The horizontal scroll bar's height, so it does not hide the last entry. */
  const [bar, setBar] = useState(0);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setBar(element.offsetHeight - element.clientHeight);
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
    if ((event.target as Element).closest(".mp-drag-handle") || event.key === "Tab") return;
    // The list sits inside the grid, whose own keys would otherwise move the grid as well.
    event.stopPropagation();
    const from = focusRow < 0 ? 0 : focusRow;
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); move(focusRow < 0 ? 0 : from + 1); return;
      case "ArrowUp": event.preventDefault(); move(from - 1); return;
      case "PageDown": event.preventDefault(); move(from + shown); return;
      case "PageUp": event.preventDefault(); move(from - shown); return;
      case "Home": event.preventDefault(); move(0); return;
      case "End": event.preventDefault(); move(help.rows.length - 1); return;
      case "Escape": event.preventDefault(); event.stopPropagation(); typed.current.text = ""; onEscape?.(); return;
      case "Backspace": event.preventDefault(); typed.current.text = typed.current.text.slice(0, -1); return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    const now = Date.now();
    const text = (now - typed.current.at > TYPE_PAUSE_MS ? "" : typed.current.text) + event.key.toUpperCase();
    typed.current = { text, at: now };
    const found = help.rows.findIndex((row) => (row[searchColumn] ?? "").trim().toUpperCase().startsWith(text));
    if (found >= 0) move(found);
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
        <span>{help.total}</span>
        <span className="mp-help-tip">type to search · drag a heading edge to resize</span>
        {onClose && <button type="button" onClick={onClose} aria-label="Close help">×</button>}
      </div>
      {note && <div className={`mp-help-note ${note.warn ? "mp-help-warn" : ""}`}>{note.text}</div>}
      <div className="mp-help-scroll" ref={scroller} style={{ flex: "0 1 auto", height: ROW * (Math.min(shown, Math.max(1, help.rows.length)) + 1) + 2 + bar }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <table style={{ width: tableWidth }}>
          <colgroup>{help.columns.map((column) => <col key={column.key} style={{ width: widthOf(column) }} />)}</colgroup>
          <thead>
            <tr>
              {help.columns.map((column) => (
                <th key={column.key} title={column.caption}>
                  {column.caption}
                  <span className="mp-resize" role="presentation" title="Drag to resize · double-click to put back"
                    onMouseDown={(event) => startResize(column, event)}
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
                <tr key={index} id={`mp-help-row-${index}`} role="option" aria-selected={index === focusRow} className={index === focusRow ? "mp-current-row" : ""} onMouseDown={() => onFocusRow(index)}>
                  {help.columns.map((column) => {
                    const text = formatCell(row[column.key] ?? "", column.format);
                    return <td key={column.key} title={text} style={{ textAlign: column.align === "R" ? "right" : "left" }}>{text}</td>;
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
