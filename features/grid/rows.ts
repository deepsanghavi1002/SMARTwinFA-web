/**
 * Row helpers every grid screen shares: whether a row still differs from what was loaded (so a
 * value typed back, or restored with Ctrl+Z, clears the row's changed mark), and where Enter
 * takes the cursor in an entry grid.
 */

/** True when any editable column of `current` differs from `loaded`, compared as the column compares values. */
export function rowChanged<C extends { key: string; editable: boolean }>(columns: readonly C[], current: Readonly<Record<string, string>>, loaded: Readonly<Record<string, string>> | undefined, same: (column: C, a: string, b: string) => boolean): boolean {
  return columns.some((column) => column.editable && !same(column, current[column.key] ?? "", loaded?.[column.key] ?? ""));
}

/**
 * Enter in an entry grid: the next editable column of the row, and after the row's last one the
 * first editable column of the next row. null when there is nowhere to go.
 */
export function nextEntryCell(editable: readonly boolean[], row: number, col: number, rowCount: number): { row: number; col: number } | null {
  const right = editable.findIndex((open, index) => index > col && open);
  if (right >= 0) return { row, col: right };
  const first = editable.findIndex((open) => open);
  if (first < 0 || row + 1 >= rowCount) return null;
  return { row: row + 1, col: first };
}
