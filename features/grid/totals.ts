/**
 * Grid helpers every screen shares: Excel's status-bar total for selected number cells, and
 * type-to-find in the current column.
 */

/** Sum, count and average of the cells that hold a number, as Excel's status bar shows them; null when none. */
export function selectionTotals(values: Iterable<string>, places: number): string | null {
  let sum = 0;
  let count = 0;
  for (const cell of values) {
    const raw = cell.replace(/,/g, "").trim();
    if (raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    sum += value;
    count += 1;
  }
  if (count === 0) return null;
  const digits = Math.max(0, Math.min(4, places));
  const show = (value: number) => value.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `Sum: ${show(sum)}   Count: ${count}   Average: ${show(sum / count)}`;
}

/**
 * Type to find: the first row, in the order shown, whose cell in the current column starts with
 * the letters typed so far (any case). -1 when none does, so the key can be dropped.
 */
export function findTyped(rows: readonly number[], search: string, shownOf: (row: number) => string): number {
  const needle = search.toUpperCase();
  const at = rows.findIndex((row) => shownOf(row).toUpperCase().startsWith(needle));
  return at;
}
