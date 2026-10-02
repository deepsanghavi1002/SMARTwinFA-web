"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import type { useColumnLayout } from "./useColumnLayout";

/**
 * A grid's right-click menu (the desktop's ContextMenuStrip), for every grid. The screen gives
 * its own items (Copy, Paste, Restore Cell Value, Delete Row ...) and the column items come from
 * the shared column layout, so every grid hides, shows and moves columns the same way.
 */

export type GridMenuItem = Readonly<{ label: string; onClick: () => void; disabled?: boolean; title?: string }>;
export type GridMenuPlace = Readonly<{ x: number; y: number }>;

export function GridMenu({ at, items, onClose }: { at: GridMenuPlace; items: readonly GridMenuItem[]; onClose: () => void }) {
  return (
    <div className="mp-menu" style={{ left: at.x, top: at.y }} onMouseLeave={onClose}>
      {items.map((item) => (
        <button key={item.label} type="button" disabled={item.disabled} title={item.title} onClick={() => { onClose(); item.onClick(); }}>{item.label}</button>
      ))}
    </div>
  );
}

/** The cell a right-click landed on, from its data-cell="row:key" mark (row as the grid numbers it). */
export function cellAt(event: ReactMouseEvent): { row: number; key: string } | null {
  const cell = (event.target as Element).closest("[data-cell]")?.getAttribute("data-cell");
  if (!cell) return null;
  const split = cell.indexOf(":");
  return { row: Number(cell.slice(0, split)), key: cell.slice(split + 1) };
}

type MenuLayout = Pick<ReturnType<typeof useColumnLayout>, "fixedKeys" | "columns" | "hiddenColumns" | "setHiddenColumns" | "columnOrder" | "setColumnOrder" | "hideColumn" | "shiftColumn">;

/** Hide / show / move / arrange columns, for the column the cursor is on. */
export function columnMenuItems(layout: MenuLayout, key: string, openArrange: () => void): GridMenuItem[] {
  const { fixedKeys, columns, hiddenColumns, setHiddenColumns, columnOrder, setColumnOrder, hideColumn, shiftColumn } = layout;
  const frozen = fixedKeys.includes(key);
  return [
    { label: "Hide Column", disabled: frozen, title: frozen ? "A frozen column cannot be hidden" : undefined, onClick: () => hideColumn(key) },
    { label: "Visible Column", disabled: hiddenColumns.length === 0, onClick: () => setHiddenColumns((current) => current.slice(0, -1)) },
    { label: "Move Column Left (Ctrl+Shift+←)", disabled: frozen || columns[fixedKeys.length]?.key === key, onClick: () => shiftColumn(key, -1) },
    { label: "Move Column Right (Ctrl+Shift+→)", disabled: frozen || columns[columns.length - 1]?.key === key, onClick: () => shiftColumn(key, 1) },
    { label: "Reset Column Order", disabled: columnOrder.length === 0, onClick: () => setColumnOrder([]) },
    { label: "Arrange Columns (Show / Hide / Move)…", onClick: openArrange },
    { label: "Show All Columns", disabled: hiddenColumns.length === 0, onClick: () => setHiddenColumns([]) },
  ];
}
