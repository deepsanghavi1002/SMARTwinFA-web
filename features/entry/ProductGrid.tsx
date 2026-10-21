"use client";

import { useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { EntryColumn, EntryOption } from "../../lib/entry/types";
import type { useEditorTools } from "../grid/EditorTools";
import { numberRules } from "../grid/rules";
import { useColumnLayout } from "../grid/useColumnLayout";
import { EntryCell, focusEntryCell } from "./EntryCell";
import type { CellKind } from "./EntryCell";
import { amountText } from "./format";
import type { Line } from "./lines";

/** Rows the grid always shows, filled or not. */
const SHOWN_ROWS = 7;
/** The desktop's grid holds Field_LastValue.Count() = 2000 rows (1999 numbered rows, the ones after the entered ones blank). */
const TOTAL_ROWS = 1999;
const ROW_HEIGHT = 20;
/** Blank rows drawn at a time (the others are only room, so 1999 rows stay light). */
const BLANK_WINDOW = 30;

/**
 * c1dg_Inputdata: the product rows. Columns up to Product stay put (Cols.Frozen); a heading's
 * right edge resizes its column. The Product cell opens the product help (typing searches it,
 * ↓ / F2 opens it, Enter takes the highlighted product); the other open cells take figures or a
 * list choice (Q.UOM, R.UOM, the item-wise tax %). Enter moves to the next open cell (the end of
 * a row goes to the next row's Product), ↑ / ↓ move between rows, Ctrl+Del removes the row.
 * The totals line under the grid sums the field_total columns and scrolls sideways with it.
 */
export function ProductGrid({
  columns, frozen, lines, uoms, totals, decimals, style, totalsStyle, productText, locked, tools, amountOpen, beforeLeave,
  onCell, onProductText, onProductKeys, onProductFocus, onProductBlur, onDeleteRow,
}: {
  columns: readonly EntryColumn[];
  frozen: number;
  lines: readonly Line[];
  uoms: readonly EntryOption[];
  totals: Readonly<Record<string, string>>;
  decimals: (key: string) => number;
  style: CSSProperties;
  totalsStyle: CSSProperties;
  /** The text being typed in a Product cell (searching the help), by row. */
  productText: Readonly<{ row: number; text: string }> | null;
  locked: boolean;
  tools: ReturnType<typeof useEditorTools>;
  /** An item-wise amount column: whether its cell takes input in the row (undefined for any other column). */
  amountOpen?: (column: EntryColumn, row: number) => boolean | undefined;
  /** Enter in the Qty cell: the screen may refuse to leave it (the stock check); resolves true to go on. */
  beforeLeave?: (row: number, key: string) => Promise<boolean>;
  onCell: (row: number, key: string, value: string) => void;
  onProductText: (row: number, text: string) => void;
  /** Keys in a Product cell: the screen moves the help with them; returns true when it took the key. */
  onProductKeys: (event: ReactKeyboardEvent<HTMLInputElement>, row: number) => boolean;
  /** A Product cell got the keyboard: the screen shows the product help beside it. */
  onProductFocus: (row: number) => void;
  onProductBlur: (event: React.FocusEvent<HTMLInputElement>) => void;
  onDeleteRow: (row: number) => void;
}) {
  const layout = useColumnLayout(columns, frozen, (column) => Math.max(30, column.width || 80));
  const grid = useRef<HTMLDivElement>(null);
  const totalsBox = useRef<HTMLDivElement>(null);
  const lefts = useMemo(() => {
    const out: number[] = [];
    let left = 0;
    for (let index = 0; index < frozen && index < columns.length; index += 1) { out.push(left); left += layout.widthOf(columns[index]); }
    return out;
  }, [columns, frozen, layout]);
  const rowCount = Math.max(SHOWN_ROWS, lines.length + 1);
  const [topRow, setTopRow] = useState(0);
  const blankFrom = Math.min(TOTAL_ROWS, Math.max(rowCount, topRow - 5));
  const blankUpto = Math.min(TOTAL_ROWS, Math.max(rowCount, blankFrom + BLANK_WINDOW));
  const tableWidth = columns.reduce((sum, column) => sum + layout.widthOf(column), 0);
  const isProduct = (column: EntryColumn) => column.key.toLowerCase() === "prod_key";
  const listOf = (column: EntryColumn): readonly EntryOption[] | undefined => {
    const key = column.key.toLowerCase();
    if (key === "uomentry_id" || key === "rateuom_id") return uoms;
    return column.options;
  };
  const openCell = (column: EntryColumn, row: number) => {
    if (locked) return false;
    // An item-wise amount opens (the keyboard stops there) while its % is left blank.
    const special = lines[row]?.product ? amountOpen?.(column, row) : undefined;
    if (special !== undefined) return special;
    return column.editable && (isProduct(column) ? row <= lines.length : Boolean(lines[row]?.product));
  };
  const align = (column: EntryColumn) => (column.align === "R" ? "right" : column.align === "C" ? "center" : "left");

  const focusCell = (row: number, key: string) => focusEntryCell(grid.current, `${row}:${key}`);
  const kindOf = (column: EntryColumn): CellKind => {
    const list = listOf(column);
    if (list && list.length > 0) return "combo";
    if (column.fieldType === "D") return "date";
    return column.fieldType === "N" || column.fieldType === "C" || column.align === "R" ? "number" : "text";
  };
  /** The next open cell after `key` in `row`, else the next row's Product. */
  const next = (row: number, key: string) => {
    const at = columns.findIndex((column) => column.key === key);
    const after = columns.slice(at + 1).find((column) => openCell(column, row) && !isProduct(column));
    if (after) focusCell(row, after.key);
    else { const product = columns.find(isProduct); if (product) focusCell(row + 1, product.key); }
  };
  /** Ctrl+Del removes the row; ↑ / ↓ go to the row above / below (Alt+↓ is the calendar or the list). */
  const cellKeys = (event: ReactKeyboardEvent<HTMLElement>, row: number, key: string): boolean => {
    if (event.key === "Delete" && event.ctrlKey) { event.preventDefault(); onDeleteRow(row); return true; }
    if (event.key === "Enter") {
      event.preventDefault();
      if (beforeLeave && key === "quantity") void beforeLeave(row, key).then((go) => { if (go) next(row, key); });
      else next(row, key);
      return true;
    }
    if (event.altKey) return false;
    if (event.key === "ArrowDown" && row + 1 < rowCount) { event.preventDefault(); focusCell(row + 1, key); return true; }
    if (event.key === "ArrowUp" && row > 0) { event.preventDefault(); focusCell(row - 1, key); return true; }
    return false;
  };

  const cellOf = (column: EntryColumn, row: number) => {
    const line = lines[row];
    const key = column.key;
    const lower = key.toLowerCase();
    const value = lower === "il_serial" ? String(row + 1) : line?.cells[key] ?? "";
    if (!openCell(column, row)) {
      const shown = column.align === "R" && value !== "" && lower !== "il_serial" ? amountText(value, decimals(lower)) : value;
      return <span title={shown}>{shown}</span>;
    }
    if (isProduct(column)) {
      const text = productText?.row === row ? productText.text : value;
      return (
        <input
          className="ent-cell-input" data-cell={`${row}:${column.key}`} aria-label={`Product, row ${row + 1}`} autoComplete="off" value={text}
          title="Type to search the product help · ↓ or F2 opens it · Enter takes the product · Ctrl+Del removes the row"
          onChange={(event) => onProductText(row, event.target.value)}
          onFocus={() => onProductFocus(row)}
          onBlur={onProductBlur}
          onKeyDown={(event) => { if (!onProductKeys(event, row)) cellKeys(event, row, column.key); }}
        />
      );
    }
    return (
      <EntryCell
        kind={kindOf(column)}
        cellId={`${row}:${column.key}`}
        value={value}
        onChange={(next) => onCell(row, key, next)}
        tools={tools}
        ariaLabel={`${column.caption}, row ${row + 1}`}
        align={align(column)}
        rules={{ ...numberRules(column.setup), decimals: decimals(lower) }}
        options={listOf(column)}
        onEnter={() => next(row, column.key)}
        onKeys={(event) => cellKeys(event, row, column.key)}
      />
    );
  };

  const colgroup = <colgroup>{columns.map((column) => <col key={column.key} style={{ width: layout.widthOf(column) }} />)}</colgroup>;
  return (
    <>
      <div className="ent-watermark" style={style} aria-hidden="true">Product Grid</div>
      <div ref={grid} className="ent-grid ent-product" style={style} role="grid" aria-label="Products"
        // A cell in the last two columns (the tax % and its amount): the grid scrolls to its right edge so the last column shows.
        onFocusCapture={(event) => {
          const id = (event.target as HTMLElement).closest("[data-cell], [data-cell-wrap]");
          const key = (id?.getAttribute("data-cell") ?? id?.getAttribute("data-cell-wrap") ?? "").split(":")[1];
          const at = columns.findIndex((column) => column.key === key);
          if (at >= 0 && at >= columns.length - 2 && grid.current) grid.current.scrollLeft = grid.current.scrollWidth;
        }}
        onScroll={(event) => { if (totalsBox.current) totalsBox.current.scrollLeft = event.currentTarget.scrollLeft; setTopRow(Math.floor(event.currentTarget.scrollTop / ROW_HEIGHT)); }}>
        <table style={{ width: tableWidth }}>
          {colgroup}
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th key={column.key} className={`${index < frozen ? "ent-frozen" : ""} ${column.editable ? "" : "ent-head-readonly"}`} style={{ left: lefts[index], textAlign: align(column) }} title={column.tooltip || column.caption}>
                  {column.caption}{layout.resizeHandle(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_unused, row) => (
              <tr key={row} className={row % 2 ? "ent-alt" : ""}>
                {columns.map((column, index) => (
                  <td key={column.key} className={`${index < frozen ? "ent-frozen" : ""} ${openCell(column, row) ? "ent-open" : ""}`} style={{ left: lefts[index], textAlign: align(column) }}>{cellOf(column, row)}</td>
                ))}
              </tr>
            ))}
            {rowCount < TOTAL_ROWS && blankFrom > rowCount && <tr aria-hidden="true" style={{ height: (blankFrom - rowCount) * ROW_HEIGHT }}><td colSpan={columns.length} style={{ padding: 0, border: 0 }} /></tr>}
            {Array.from({ length: Math.max(0, blankUpto - blankFrom) }, (_unused, at) => {
              const row = blankFrom + at;
              return (
                <tr key={row} aria-hidden="true" className={row % 2 ? "ent-alt" : ""}>
                  {columns.map((column, index) => (
                    <td key={column.key} className={index < frozen ? "ent-frozen" : ""} style={{ left: lefts[index], textAlign: align(column) }}>{column.key.toLowerCase() === "il_serial" ? row + 1 : ""}</td>
                  ))}
                </tr>
              );
            })}
            {blankUpto < TOTAL_ROWS && <tr aria-hidden="true" style={{ height: (TOTAL_ROWS - blankUpto) * ROW_HEIGHT }}><td colSpan={columns.length} style={{ padding: 0, border: 0 }} /></tr>}
          </tbody>
        </table>
      </div>
      <div ref={totalsBox} className="ent-totals" style={totalsStyle} aria-label="Product totals">
        <table style={{ width: tableWidth }}>
          {colgroup}
          <tbody>
            <tr>
              {columns.map((column, index) => {
                const total = totals[column.key.toLowerCase()];
                // The Sr. column's total is the number of product rows filled.
                const rowCount = column.key.toLowerCase() === "il_serial" && total === undefined ? lines.filter((line) => line.product).length : 0;
                return <td key={column.key} className={`${index < frozen ? "ent-frozen" : ""} ${total !== undefined || rowCount > 0 ? "ent-total" : ""}`} style={{ left: lefts[index] }}>{total !== undefined ? amountText(total, decimals(column.key.toLowerCase())) : rowCount > 0 ? rowCount : ""}</td>;
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
