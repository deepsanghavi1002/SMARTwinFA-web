import type { GridComboPlace } from "./GridCombo";

/**
 * Where a grid combo's list opens: under the cell (above it when there is no room below), wide
 * enough for the longest choice (tick, padding and scrollbar included) and never narrower than
 * the column; it starts at the column's left edge unless the screen runs out on the right, and
 * then moves left only as far as it has to. A multi-pick list also has a tick box, the key and
 * Clear / OK, so it needs more room. null when the cell is not on screen.
 */
export function comboPlace(cell: Element | null, texts: readonly string[], multi = false): GridComboPlace | null {
  const box = cell?.getBoundingClientRect();
  if (!box) return null;
  const rows = Math.min(10, Math.max(2, texts.length));
  const height = rows * 22 + 62;
  const below = box.bottom + height < window.innerHeight - 4;
  const width = Math.min(window.innerWidth - 8, Math.max(box.width, multi ? 320 : 200, longestText(texts) + (multi ? 110 : 64)));
  const left = Math.max(4, Math.min(box.left, window.innerWidth - width - 4));
  return { left, top: below ? box.bottom + 2 : Math.max(4, box.top - height - 2), width, rows };
}

let measure: CanvasRenderingContext2D | null = null;
/** The widest of some texts as the grid's font draws them, in pixels. */
export function longestText(texts: readonly string[]): number {
  measure ??= document.createElement("canvas").getContext("2d");
  if (!measure) return Math.max(0, ...texts.map((text) => text.length)) * 7;
  const cell = document.querySelector(".mp-grid .mp-cell");
  measure.font = `700 ${cell ? getComputedStyle(cell).fontSize : "11px"} ${cell ? getComputedStyle(cell).fontFamily : "sans-serif"}`;
  return Math.ceil(Math.max(0, ...texts.map((text) => measure!.measureText(text).width)));
}
