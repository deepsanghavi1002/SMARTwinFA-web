/**
 * Level styling of a grouped output grid (reports; any grid that has headings, subtotals and a
 * final total). Four levels, each with its own light colour; a heading and the subtotal that
 * closes it are the same level, so they share a colour:
 *
 *   level 0 light purple · 1 light pink · 2 light blue · 3 light yellow (deeper levels reuse 3)
 *
 * Headings and subheadings are indented by level, subtotal captions sit to the right, the final
 * total is drawn apart (light red, double line), and the details between them carry no tint (the grid's
 * own alternate-row colour shows).
 *
 * Pure: it only says how a row looks. The grid draws it.
 */

export const LEVEL_COUNT = 4;

/** A level's fill, the text on it, and its rule colour. */
export type LevelColour = Readonly<{ fill: string; text: string; rule: string }>;

export const LEVEL_COLOURS: readonly LevelColour[] = [
  { fill: "#e5ddf7", text: "#3f2a7a", rule: "#b3a0e4" }, // light purple
  { fill: "#fbdbe7", text: "#6d1f3f", rule: "#e69ab8" }, // light pink
  { fill: "#d6e8fb", text: "#0c3a6b", rule: "#7fb0e6" }, // light blue
  { fill: "#fdf3c4", text: "#5c4608", rule: "#e3c95a" }, // light yellow
];

export const GRAND_TOTAL_COLOUR: LevelColour = { fill: "#f9c9c9", text: "#6b1212", rule: "#d96b6b" };

/** What a user's own screen colour is changed to when it is one of the four (provision, see resolveLevelColours). */
export const LIGHT_RED: LevelColour = { fill: "#fbd9d9", text: "#6b1212", rule: "#e48a8a" };

/**
 * PROVISION, not yet used by any screen. The package is meant to let the user choose a colour theme
 * for the screen; when the chosen screen colour is the same as one of the four level colours, that
 * level is drawn light red instead so it still stands out. The screens pass NO_SCREEN_COLOUR
 * until a theme choice exists, and then pass the user's chosen colour (any CSS #rrggbb).
 */
export const NO_SCREEN_COLOUR = "";

export function resolveLevelColours(screenColour: string = NO_SCREEN_COLOUR): readonly LevelColour[] {
  const chosen = screenColour.trim().toLowerCase();
  if (chosen === "") return LEVEL_COLOURS;
  return LEVEL_COLOURS.map((colour) => (colour.fill.toLowerCase() === chosen ? LIGHT_RED : colour));
}

/** The level a row is drawn at: 0 to 3 (a deeper group draws as 3). */
export const clampLevel = (level: number) => Math.min(LEVEL_COUNT - 1, Math.max(0, level));

/** Pixels a heading or subheading is indented per level. */
export const LEVEL_INDENT = 14;

export type RowLook = Readonly<{
  /** Fill, text colour and the weight, for the row's cells. */
  background?: string;
  color?: string;
  bold: boolean;
  /** A rule on top of the row's cells: thick for a heading, thin for a subtotal, double for the final total. */
  borderTop?: string;
  borderBottom?: string;
  /** Indent of a heading's text, in px (details start at the column's own edge). */
  indent: number;
  /** A subtotal's caption is right-aligned over the columns it spans. */
  captionRight: boolean;
}>;

export type RowKind = "heading" | "subtotal" | "total" | "detail";

/** How one row looks. `level` is the heading's or subtotal's level (ignored for a detail and the total). */
export function rowLook(kind: RowKind, level: number, colours: readonly LevelColour[] = LEVEL_COLOURS): RowLook {
  if (kind === "detail") return { bold: false, indent: 0, captionRight: false };
  if (kind === "total") {
    return { background: GRAND_TOTAL_COLOUR.fill, color: GRAND_TOTAL_COLOUR.text, bold: true, borderTop: `3px double ${GRAND_TOTAL_COLOUR.rule}`, borderBottom: `1px solid ${GRAND_TOTAL_COLOUR.rule}`, indent: 0, captionRight: true };
  }
  const at = clampLevel(level);
  const colour = colours[at] ?? LEVEL_COLOURS[at];
  if (kind === "heading") {
    return { background: colour.fill, color: colour.text, bold: true, borderTop: `2px solid ${colour.rule}`, indent: at * LEVEL_INDENT, captionRight: false };
  }
  return { background: colour.fill, color: colour.text, bold: true, borderTop: `1px solid ${colour.rule}`, indent: 0, captionRight: true };
}

/**
 * The level of each heading row type (AC, BOOK, ADDON_1 ...): the report's own (`byType`, the
 * position of the group the subtotals break on), else the order the groups were ticked in.
 */
export function headingLevelOf(rowType: string, byType: Readonly<Record<string, number>> | undefined, tickOrder: readonly string[]): number {
  const own = byType?.[rowType];
  if (own !== undefined) return own;
  const ticked = tickOrder.indexOf(rowType);
  return ticked >= 0 ? ticked : 0;
}

/**
 * The subtotal that closes a heading: the first subtotal of the heading's level after it whose
 * group starts at or before the heading. -1 when the heading has none (it cannot be folded).
 */
export function closingSubtotal(rows: readonly { kind: string; level: number }[], headingAt: number, level: number, groupStart: ReadonlyMap<number, number>): number {
  for (let at = headingAt + 1; at < rows.length; at += 1) {
    const row = rows[at];
    if (row.kind !== "subtotal" || row.level !== level) continue;
    return (groupStart.get(at) ?? at) <= headingAt ? at : -1;
  }
  return -1;
}
