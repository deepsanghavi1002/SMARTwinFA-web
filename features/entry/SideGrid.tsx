"use client";

import type { CSSProperties, ReactNode } from "react";
import type { GridColumn } from "../../lib/entry/types";
import { useColumnLayout } from "../grid/useColumnLayout";
import { amountText } from "./format";

/**
 * A side grid of the entry screen (slab, addon, outstanding): heading row and rows, the columns
 * as the setup sizes them; a heading's right edge drags the column wider or narrower (double-click
 * puts it back). `fill`: the columns share out the grid's width when it is wider than they are.
 */
export function SideGrid({ columns, rows, cell, cellClass, label, style, empty, fill = false }: {
  columns: readonly GridColumn[];
  rows: readonly Readonly<Record<string, string>>[];
  cell?: (row: number, column: GridColumn) => ReactNode;
  /** A cell's own class: "ent-disabled" greys a cell the row does not let the operator edit. */
  cellClass?: (row: number, column: GridColumn) => string;
  label: string;
  style: CSSProperties;
  empty?: string;
  fill?: boolean;
}) {
  const layout = useColumnLayout(columns, 0, (column) => column.width);
  const tableWidth = columns.reduce((sum, column) => sum + layout.widthOf(column), 0);
  const align = (column: GridColumn) => (column.align === "R" ? "right" : column.align === "C" ? "center" : "left");
  return (
    <div className="ent-grid" style={style} role="grid" aria-label={label}>
      <table style={fill ? { width: "100%", minWidth: tableWidth } : { width: tableWidth }}>
        <colgroup>{columns.map((column) => <col key={column.key} style={{ width: layout.widthOf(column) }} />)}</colgroup>
        <thead>
          <tr>{columns.map((column) => <th key={column.key} style={{ textAlign: align(column) }} title={column.caption}>{column.caption}{layout.resizeHandle(column)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={index % 2 ? "ent-alt" : ""}>
              {columns.map((column) => (
                <td key={column.key} className={cellClass?.(index, column) || (column.editable ? "ent-open" : "")} style={{ textAlign: align(column) }}>
                  {cell ? cell(index, column) : column.align === "R" && column.decimals > 0 ? amountText(row[column.key] ?? "", column.decimals) : row[column.key] ?? ""}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && empty && <tr><td colSpan={Math.max(1, columns.length)} className="ent-empty">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
