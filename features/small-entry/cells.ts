import type { EntryColumn } from "../../lib/small-entry/types";
import { POSITIVE_ONLY_MESSAGE } from "../grid/rules";

/**
 * C1dg_SmallEntryGrid_KeyPressEdit / ValidateEdit for the columns the ported entries edit:
 * numbers take digits, one decimal point and (unless positive-only) a leading minus; the
 * value is kept to the column's decimal places. Text passes as typed, less the single
 * quotation mark the desktop refuses everywhere.
 */

export const isNumberColumn = (column: Pick<EntryColumn, "fieldType">) => ["N", "C", "I"].includes(column.fieldType);

/** Whether the editor may change to `next` (typing, paste). */
export function typingAllowed(column: Pick<EntryColumn, "fieldType" | "positiveOnly" | "decimals">, next: string): boolean {
  if (next.includes("'")) return false;
  if (!isNumberColumn(column)) return true;
  const pattern = column.positiveOnly ? /^\d*\.?\d*$/ : /^-?\d*\.?\d*$/;
  return pattern.test(next.replace(/,/g, ""));
}

/** Half away from zero, as the desktop's number styles show a value. */
function roundTo(value: number, places: number): string {
  const factor = 10 ** places;
  const rounded = Math.sign(value) * Math.round(Math.abs(value) * factor + 1e-9) / factor;
  return places > 0 ? rounded.toFixed(places) : String(rounded);
}

export type CellCommit = Readonly<{ ok: true; value: string } | { ok: false; message: string }>;

export function commitCell(column: Pick<EntryColumn, "fieldType" | "positiveOnly" | "decimals" | "caption">, typed: string): CellCommit {
  const text = typed.trim();
  if (!isNumberColumn(column)) return text.includes("'") ? { ok: false, message: "Single Quotation Character not allowed..." } : { ok: true, value: typed };
  if (text === "") return { ok: true, value: "" };
  const plain = text.replace(/,/g, "");
  if (!/^-?\d*\.?\d+$|^-?\d+\.?$/.test(plain)) return { ok: false, message: `Only a number is allowed in ${column.caption}` };
  const value = Number(plain);
  if (column.positiveOnly && value < 0) return { ok: false, message: POSITIVE_ONLY_MESSAGE };
  const places = column.fieldType === "I" ? 0 : Math.max(0, Math.min(4, column.decimals));
  return { ok: true, value: roundTo(value, places) };
}

/** Two cell values the same for the "row changed" mark: numbers by value, text as typed. */
export function sameValue(column: Pick<EntryColumn, "fieldType">, a: string, b: string): boolean {
  if (!isNumberColumn(column)) return a === b;
  const number = (value: string) => (value.trim() === "" ? 0 : Number(value.replace(/,/g, "")));
  return number(a) === number(b);
}

/** A number cell as the grid shows it: the column's decimal places, thousands grouped. */
export function shownValue(column: Pick<EntryColumn, "fieldType" | "decimals">, value: string): string {
  if (!isNumberColumn(column) || value.trim() === "") return value;
  const number = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(number)) return value;
  const places = column.fieldType === "I" ? 0 : Math.max(0, Math.min(4, column.decimals));
  // Setting_GridCol: "#,##0.00" for decimals 1-4, "#,###" (zero shows blank) for none.
  if (places === 0 && number === 0) return "";
  return number.toLocaleString("en-IN", { minimumFractionDigits: places, maximumFractionDigits: places });
}
