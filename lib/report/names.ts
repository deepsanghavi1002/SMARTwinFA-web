import type { OutputColumn, ReportOutput } from "./types";

/**
 * The names the side panels (Chart, Growth, Compare ...) show for a report's columns and groups: what the operator ticked
 * (Area, Account, Product ...), not the system's (SMART_SELECTED_ADDON1, SMART_NAME, PARTICULARS).
 * The report's headings say it: ADDON_1 is the first addon group (its caption is the field's name, e.g. Area), AC is the account,
 * and the innermost group is what the Particulars column holds (an account in a ledger, a product in a stock report).
 */

type Naming = Pick<ReportOutput, "headingCaptions" | "headingLevels">;

/** The heading types of the ticked groups, outermost first: by their level, else addon groups in order and the account last. */
export function orderedHeadingTypes(output: Naming): string[] {
  const levels = output.headingLevels ?? {};
  const known = Object.keys(levels).filter((type) => output.headingCaptions[type]);
  if (known.length > 0) return known.sort((x, y) => levels[x] - levels[y]);
  const rank = (type: string) => (type === "AC" ? 1000 : /^ADDON_(\d+)$/.exec(type) ? Number(/^ADDON_(\d+)$/.exec(type)?.[1]) : 500);
  return Object.keys(output.headingCaptions).filter((type) => output.headingCaptions[type]).sort((x, y) => rank(x) - rank(y));
}

/** The name of each group level (0 the outermost); "" where the report names none. */
export function groupCaptions(output: Naming): string[] {
  return orderedHeadingTypes(output).map((type) => output.headingCaptions[type] ?? "");
}

/** A column as the panels call it: an addon column by its group's name, the Particulars by what it holds (Account, Product ...), any other as it is. */
export function columnCaption(output: Naming, column: Pick<OutputColumn, "key" | "caption">): string {
  const addon = /SELECTED_ADDON(\d+)$/i.exec(column.key);
  if (addon) {
    const named = output.headingCaptions[`ADDON_${addon[1]}`];
    if (named) return named;
  }
  // "SELECTED AREA(S)": the column of a group the operator ticked, called by its field.
  const selected = /^SELECTED[\s_]+(.+?)(?:\(S\))?$/i.exec(column.caption.trim());
  if (selected && selected[1].trim() !== "") return selected[1].trim().toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
  if (/particular/i.test(`${column.key} ${column.caption}`)) {
    const types = orderedHeadingTypes(output);
    const inner = types.length > 0 ? output.headingCaptions[types[types.length - 1]] : "";
    if (inner) return inner;
  }
  return column.caption;
}
