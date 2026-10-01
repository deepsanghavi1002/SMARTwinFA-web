"use client";

import { useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

/**
 * A grid's column layout as the operator sets it, for every grid: widths (drag a heading's right
 * edge; a double-click there resets it), the order (drag, Ctrl+Shift+←/→, Arrange Columns) and
 * which columns are hidden. The frozen columns always stay first, never moved or hidden.
 * Kept while the screen is open.
 */

export const MIN_COLUMN_WIDTH = 30;

type LayoutColumn = { key: string; width: number };

/**
 * `shown`: the columns the setup shows, in its order. `frozen`: how many of them, from the left,
 * are frozen. `defaultWidth`: a column's width before the operator changes it.
 */
export function useColumnLayout<C extends LayoutColumn>(shown: readonly C[], frozen: number, defaultWidth: (column: C) => number = (column) => Math.max(40, column.width || 90)) {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  /** The operator's own column order (keys); empty is the setup's order. */
  const [columnOrder, setColumnOrder] = useState<string[]>([]);

  const fixedKeys = useMemo(() => shown.slice(0, frozen).map((column) => column.key), [shown, frozen]);
  /** Every column the setup shows: the frozen ones, then the rest in the operator's order (a column the order does not name keeps its place after it). */
  const orderedColumns = useMemo(() => {
    const fixed = shown.filter((column) => fixedKeys.includes(column.key));
    const rest = shown.filter((column) => !fixedKeys.includes(column.key));
    if (columnOrder.length === 0) return [...fixed, ...rest];
    const rank = (key: string) => { const at = columnOrder.indexOf(key); return at < 0 ? Number.MAX_SAFE_INTEGER : at; };
    return [...fixed, ...rest.sort((a, b) => rank(a.key) - rank(b.key))];
  }, [shown, columnOrder, fixedKeys]);
  /** The columns on screen: the ordered ones less the hidden ones. */
  const columns = useMemo(() => orderedColumns.filter((column) => fixedKeys.includes(column.key) || !hiddenColumns.includes(column.key)), [orderedColumns, hiddenColumns, fixedKeys]);

  const widthOf = (column: C) => widths[column.key] ?? defaultWidth(column);

  /** Hides a column, unless it is frozen. */
  const hideColumn = (key: string) => { if (key && !fixedKeys.includes(key)) setHiddenColumns((current) => (current.includes(key) ? current : [...current, key])); };
  const toggleColumn = (key: string) => { if (hiddenColumns.includes(key)) setHiddenColumns((current) => current.filter((candidate) => candidate !== key)); else hideColumn(key); };
  /** Puts a column at a position in the whole list (0-based), never among the frozen ones. */
  const placeColumn = (key: string, position: number) => {
    if (fixedKeys.includes(key)) return;
    const order = orderedColumns.map((column) => column.key).filter((candidate) => candidate !== key);
    order.splice(Math.min(order.length, Math.max(fixedKeys.length, position)), 0, key);
    setColumnOrder(order);
  };
  /** Moves a column next to another one: before it, or after it. */
  const moveColumn = (key: string, target: string, after: boolean) => {
    if (key === target || fixedKeys.includes(key) || fixedKeys.includes(target)) return;
    const order = orderedColumns.map((column) => column.key).filter((candidate) => candidate !== key);
    const at = order.indexOf(target);
    if (at < 0) return;
    placeColumn(key, after ? at + 1 : at);
  };
  /** Moves a column one place left or right among the columns on screen. */
  const shiftColumn = (key: string, step: -1 | 1) => {
    const index = columns.findIndex((column) => column.key === key);
    const target = columns[index + step];
    if (index >= 0 && target) moveColumn(key, target.key, step === 1);
  };

  /** Drag on a heading's right edge to set the column's width. */
  const startResize = (column: C, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widthOf(column);
    const move = (moveEvent: MouseEvent) => setWidths((current) => ({ ...current, [column.key]: Math.max(MIN_COLUMN_WIDTH, startWidth + moveEvent.clientX - startX) }));
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  const resetWidth = (key: string) => setWidths((current) => { const copy = { ...current }; delete copy[key]; return copy; });

  /** The right-edge handle of a heading cell. */
  const resizeHandle = (column: C) => <span className="mp-resize" role="presentation" onMouseDown={(event) => startResize(column, event)} onDoubleClick={() => resetWidth(column.key)} />;

  /** The items Arrange Columns lists. */
  const arrangeItems = (captionOf: (column: C) => string) => orderedColumns.map((column) => ({ key: column.key, caption: captionOf(column) || column.key, fixed: fixedKeys.includes(column.key), shown: fixedKeys.includes(column.key) || !hiddenColumns.includes(column.key) }));

  return {
    widths, setWidths, widthOf, startResize, resetWidth, resizeHandle,
    hiddenColumns, setHiddenColumns, hideColumn, toggleColumn,
    columnOrder, setColumnOrder, placeColumn, moveColumn, shiftColumn,
    fixedKeys, orderedColumns, columns, arrangeItems,
  };
}
