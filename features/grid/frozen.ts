/**
 * Frozen columns (C1FlexGrid's Cols.Frozen): the first `frozen` columns stay put while the grid
 * scrolls sideways. Each sticks at the left edge after the row marker and the frozen ones before it.
 */

/** The row marker column at a grid's left (C1FlexGrid's fixed column), in pixels: .mp-rownum's width. */
export const ROW_MARKER_WIDTH = 16;

/** Each column's left edge from the grid's start (the row marker is `start` wide). */
export function columnLefts<C>(columns: readonly C[], widthOf: (column: C) => number, start: number): number[] {
  const lefts: number[] = [];
  columns.reduce((left, column, index) => { lefts[index] = left; return left + widthOf(column); }, start);
  return lefts;
}

/** The frozen columns' class and sticky position, for a heading or a cell. */
export function frozenCell(index: number, frozen: number, lefts: readonly number[]): { className: string; style: { left?: number } } {
  return index < frozen ? { className: "mp-frozen", style: { left: lefts[index] } } : { className: "", style: {} };
}

/**
 * Scrolls a grid sideways so the whole of a column is in sight: past the frozen columns on the
 * left, and not cut off on the right (a column wider than the view shows from its start).
 * `start` is the row marker's width.
 */
export function revealColumn<C>(element: HTMLElement, columns: readonly C[], widthOf: (column: C) => number, index: number, frozen: number, start: number) {
  if (index < 0 || index >= columns.length) return;
  const fixed = Math.min(frozen, columns.length);
  if (index < fixed) return; // a frozen column never scrolls away
  let left = start;
  for (let at = 0; at < index; at += 1) left += widthOf(columns[at]);
  const right = left + widthOf(columns[index]);
  let frozenRight = start;
  for (let at = 0; at < fixed; at += 1) frozenRight += widthOf(columns[at]);
  if (right > element.scrollLeft + element.clientWidth) element.scrollLeft = right - element.clientWidth;
  if (left < element.scrollLeft + frozenRight) element.scrollLeft = Math.max(0, left - frozenRight);
}
