/**
 * F3 / Enter in the search box: the next cell after the cursor (going on to the following rows,
 * round to the top) whose text holds what was searched, any case.
 * `rows` are the rows in the order shown; `current` is the cursor's row among them.
 */
export function findNextCell<R, C>(rows: readonly R[], current: R, columns: readonly C[], textOf: (row: R, column: C) => string, search: string): { row: R; column: C } | null {
  const needle = search.trim().toUpperCase();
  if (needle === "" || rows.length === 0) return null;
  const start = rows.indexOf(current);
  for (let step = 1; step <= rows.length; step += 1) {
    const row = rows[(start + step) % rows.length];
    const hit = columns.find((column) => textOf(row, column).toUpperCase().includes(needle));
    if (hit !== undefined) return { row, column: hit };
  }
  return null;
}
