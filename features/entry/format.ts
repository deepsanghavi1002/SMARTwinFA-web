import { toNumber } from "../../lib/entry/calc";

/** A figure as the entry screen shows it: grouped Indian style with the column's decimals; blank stays blank. */
export function amountText(value: string, decimals: number): string {
  if (value.trim() === "") return "";
  return toNumber(value).toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** A help cell: N2 money, N3 / N4 figures, the rest as they come. */
export function helpCell(value: string, format: string): string {
  if (value === "") return value;
  const places = /^N(\d)$/.exec(format);
  if (places) return amountText(value, Number(places[1]));
  return value;
}
