import { isNumberField } from "./rules";
import type { Setup } from "./rules";

/**
 * How a grid shows and keeps a cell's text, from the column's setup (program_body or
 * entry_grid_body): the status-row tooltip, decimal places, a zero editor opening blank, alignment.
 */

/** FIELD_TOOLTIPS as shown in the status row: the text without its leading "SELECT", options split by " / ". */
export function tooltipText(tooltip: string | null | undefined): string {
  const text = (tooltip ?? "").trim().replace(/^SELECT\s+/i, "");
  return text.split("|").map((part) => part.trim()).filter(Boolean).join(" / ");
}

/**
 * DECIMAL_POINTS: a number typed with more places than the field allows is rounded to them
 * (half away from zero, as the desktop's number styles show it) and written with exactly
 * that many places. Fields of type N and C only; anything that is not a number is left as is.
 */
export function roundToPlaces(text: string, setup: Pick<Setup, "field_type" | "decimal_points">): string {
  if (setup.field_type !== "N" && setup.field_type !== "C") return text;
  const raw = text.replace(/,/g, "").trim();
  if (raw === "" || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(raw)) return text;
  const places = Math.max(0, Math.min(6, setup.decimal_points || 0));
  if (setup.field_type === "C" && places === 0) return text;
  const factor = 10 ** places;
  const value = Number(raw);
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * factor + 1e-9)) / factor;
  return rounded.toFixed(places);
}

/** A number field (not a list) opens its editor blank rather than showing a zero: 0, 0.00, 0.000 ... */
export function zeroAsBlank(setup: Parameters<typeof isNumberField>[0], hasList: boolean, value: string): string {
  const text = value.trim();
  return isNumberField(setup) && !hasList && /[0-9]/.test(text) && /^-?[0-9,]*\.?[0-9]*$/.test(text) && Number(text.replace(/,/g, "")) === 0 ? "" : value;
}

/** A setup alignment code as CSS: R right, C or M centre, anything else left. */
export const alignOf = (align: string | null | undefined): "left" | "right" | "center" => {
  const code = (align ?? "").trim().toUpperCase();
  return code === "R" ? "right" : code === "C" || code === "M" ? "center" : "left";
};
