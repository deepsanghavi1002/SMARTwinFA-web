"use client";

import { useRef } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { EntryColumn } from "../../lib/entry/types";
import type { useEditorTools } from "../grid/EditorTools";
import { numberRules } from "../grid/rules";
import { useColumnLayout } from "../grid/useColumnLayout";
import { EntryCell, focusEntryCell } from "./EntryCell";
import { amountText } from "./format";

/** One account row of the voucher: the account chosen from the help, its figures, the cheque number and date. */
export type VoucherLine = Readonly<{ code: number; book: number; cells: Readonly<Record<string, string>> }>;

export const filledVoucherLines = (lines: readonly VoucherLine[]) => lines.filter((line) => line.code > 0);

const SHOWN_ROWS = 7;

/**
 * c1dg_Inputdata of the voucher style: one account per row (Account Head, Debit, Credit, and the cheque
 * number and date on a bank book). The Account cell opens the account help (typing searches it, ↓ / F2
 * opens it, Enter takes the highlighted account). Only the side the book side picks takes a figure (Cmb_Side_Leave:
 * Debit for the first side, Credit for the second); a journal book takes both. Enter moves to the next open cell,
 * the end of a row goes to the next row's Account, ↑ / ↓ move between rows, Ctrl+Del removes the row.
 */
export function VoucherGrid({
  columns, lines, debitOpen, creditOpen, style, totalsStyle, accountText, locked, tools, totals,
  onCell, onAccountText, onAccountKeys, onAccountFocus, onAccountBlur, onDeleteRow,
}: {
  columns: readonly EntryColumn[];
  lines: readonly VoucherLine[];
  debitOpen: boolean;
  creditOpen: boolean;
  style: CSSProperties;
  totalsStyle: CSSProperties;
  accountText: Readonly<{ row: number; text: string }> | null;
  locked: boolean;
  tools: ReturnType<typeof useEditorTools>;
  totals: Readonly<{ debit: string; credit: string; difference: string }>;
  onCell: (row: number, key: string, value: string) => void;
  onAccountText: (row: number, text: string) => void;
  onAccountKeys: (event: ReactKeyboardEvent<HTMLInputElement>, row: number) => boolean;
  onAccountFocus: (row: number) => void;
  onAccountBlur: (event: React.FocusEvent<HTMLInputElement>) => void;
  onDeleteRow: (row: number) => void;
}) {
  const layout = useColumnLayout(columns, 0, (column) => Math.max(30, column.width || 80));
  const grid = useRef<HTMLDivElement>(null);
  const rowCount = Math.max(SHOWN_ROWS, lines.length + 1);
  const tableWidth = columns.reduce((sum, column) => sum + layout.widthOf(column), 0);
  const isAccount = (column: EntryColumn) => column.key.toLowerCase() === "name";
  const isMoney = (column: EntryColumn) => ["debit_amt", "credit_amt"].includes(column.key.toLowerCase());
  const align = (column: EntryColumn) => (column.align === "R" || isMoney(column) ? "right" : column.align === "C" ? "center" : "left");
  const openCell = (column: EntryColumn, row: number) => {
    if (locked || !column.editable) return false;
    if (isAccount(column)) return row <= lines.length;
    if (!lines[row] || lines[row].code === 0) return false;
    const key = column.key.toLowerCase();
    return key === "debit_amt" ? debitOpen : key === "credit_amt" ? creditOpen : true;
  };
  const focusCell = (row: number, key: string) => focusEntryCell(grid.current, `${row}:${key}`);
  /** The next open cell after `key` in `row`, else the next row's Account. */
  const next = (row: number, key: string) => {
    const at = columns.findIndex((column) => column.key === key);
    const after = columns.slice(at + 1).find((column) => openCell(column, row) && !isAccount(column));
    if (after) focusCell(row, after.key);
    else { const account = columns.find(isAccount); if (account) focusCell(row + 1, account.key); }
  };
  const cellKeys = (event: ReactKeyboardEvent<HTMLElement>, row: number, key: string): boolean => {
    if (event.key === "Delete" && event.ctrlKey) { event.preventDefault(); onDeleteRow(row); return true; }
    if (event.key === "Enter") { event.preventDefault(); next(row, key); return true; }
    if (event.altKey) return false;
    if (event.key === "ArrowDown" && row + 1 < rowCount) { event.preventDefault(); focusCell(row + 1, key); return true; }
    if (event.key === "ArrowUp" && row > 0) { event.preventDefault(); focusCell(row - 1, key); return true; }
    return false;
  };

  const cellOf = (column: EntryColumn, row: number) => {
    const key = column.key;
    const lower = key.toLowerCase();
    const value = lower === "led_div" ? (lines[row]?.code ? String(row + 1) : "") : lines[row]?.cells[key] ?? "";
    if (!openCell(column, row)) {
      const shown = isMoney(column) && value !== "" ? amountText(value, 2) : value;
      return <span title={shown}>{shown}</span>;
    }
    if (isAccount(column)) {
      const text = accountText?.row === row ? accountText.text : value;
      return (
        <input
          className="ent-cell-input" data-cell={`${row}:${key}`} aria-label={`Account Head, row ${row + 1}`} autoComplete="off" value={text}
          title="Type to search the account help · ↓ or F2 opens it · Enter takes the account · Ctrl+Del removes the row"
          onChange={(event) => onAccountText(row, event.target.value)}
          onFocus={() => onAccountFocus(row)}
          onBlur={onAccountBlur}
          onKeyDown={(event) => { if (!onAccountKeys(event, row)) cellKeys(event, row, key); }}
        />
      );
    }
    return (
      <EntryCell
        kind={column.fieldType === "D" ? "date" : isMoney(column) ? "number" : "text"}
        cellId={`${row}:${key}`}
        value={value}
        onChange={(next) => onCell(row, key, next)}
        tools={tools}
        ariaLabel={`${column.caption}, row ${row + 1}`}
        align={align(column)}
        rules={isMoney(column) ? { ...numberRules(column.setup), decimals: 2, positiveOnly: true } : undefined}
        optional={column.fieldType === "D"}
        onEnter={() => next(row, key)}
        onKeys={(event) => cellKeys(event, row, key)}
      />
    );
  };

  const colgroup = <colgroup>{columns.map((column) => <col key={column.key} style={{ width: layout.widthOf(column) }} />)}</colgroup>;
  const totalOf = (column: EntryColumn) => {
    const key = column.key.toLowerCase();
    if (key === "debit_amt") return amountText(totals.debit, 2);
    if (key === "credit_amt") return amountText(totals.credit, 2);
    return isAccount(column) ? `Difference ${amountText(totals.difference, 2) || "0.00"}` : "";
  };
  return (
    <>
      <div ref={grid} className="ent-grid ent-product" style={style} role="grid" aria-label="Vouchers">
        <table style={{ width: tableWidth }}>
          {colgroup}
          <thead>
            <tr>{columns.map((column) => <th key={column.key} className={column.editable ? "" : "ent-head-readonly"} style={{ textAlign: align(column) }} title={column.tooltip || column.caption}>{column.caption}{layout.resizeHandle(column)}</th>)}</tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_unused, row) => (
              <tr key={row} className={row % 2 ? "ent-alt" : ""}>
                {columns.map((column) => <td key={column.key} className={openCell(column, row) ? "ent-open" : ""} style={{ textAlign: align(column) }}>{cellOf(column, row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ent-totals" style={totalsStyle} aria-label="Voucher totals">
        <table style={{ width: tableWidth }}>
          {colgroup}
          <tbody>
            <tr>{columns.map((column) => <td key={column.key} className={isMoney(column) ? "ent-total" : ""} style={{ textAlign: align(column) }}>{totalOf(column)}</td>)}</tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
