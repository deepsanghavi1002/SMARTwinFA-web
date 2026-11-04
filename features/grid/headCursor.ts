import { useEffect, type RefObject } from "react";

/**
 * The heading of the column the cursor is on is coloured (globals.css, .mp-head-current), and goes back to its own colour when the
 * cursor leaves. One rule for every grid: master, small entry, entry and report.
 */
export const HEAD_CURRENT = "mp-head-current";

/** The class for a heading that is the cursor's column; for grids that hold the cursor in state. */
export const headCurrent = (on: boolean): string => (on ? HEAD_CURRENT : "");

/**
 * For table grids whose cursor is the browser's own focus (the entry grids): marks the heading above the focused cell, and clears it
 * when focus leaves the grid. The class is put on the heading directly, so no grid has to keep a column state for it.
 */
export function useFocusedHead(grid: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const box = grid.current;
    if (!box) return;
    const clear = () => box.querySelectorAll(`th.${HEAD_CURRENT}`).forEach((head) => head.classList.remove(HEAD_CURRENT));
    const mark = (event: FocusEvent) => {
      const cell = (event.target as Element | null)?.closest("td");
      const heads = cell?.closest("table")?.tHead?.rows[0]?.cells;
      if (!cell || !heads) return;
      clear();
      heads[cell.cellIndex]?.classList.add(HEAD_CURRENT);
    };
    const leave = (event: FocusEvent) => { if (!box.contains(event.relatedTarget as Node | null)) clear(); };
    box.addEventListener("focusin", mark);
    box.addEventListener("focusout", leave);
    return () => { box.removeEventListener("focusin", mark); box.removeEventListener("focusout", leave); };
  }, [grid]);
}
