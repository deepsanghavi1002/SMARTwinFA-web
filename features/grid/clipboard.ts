import { keyListText, parseKeyList, validKeyList } from "../../lib/master-program/multi-pick";
import type { Setup } from "./rules";

/**
 * MnuCopy_Click / MnuPaste_Click and Ctrl+A, for every grid: what a copy holds, whether a paste
 * may go into a column, and the whole grid as text for the clipboard.
 */

/** A copied cell: its text, and for an addon combo (combo_value X) the id of the choice. */
export type CopiedCell = Readonly<{ value: string; addonId: string }>;

type Option = Readonly<{ text: string; value: string }>;
type Outcome<T> = Readonly<{ ok: true } & T> | Readonly<{ ok: false; message: string }>;

/** MnuCopy_Click: an addon combo's value is copied with its id, which it must already have. */
export function copyCell(value: string, setup: Pick<Setup, "combo_value">, options: readonly Option[] | null | undefined): Outcome<{ copied: CopiedCell }> {
  if (setup.combo_value.trim().toUpperCase() === "X") {
    const option = options?.find((candidate) => candidate.text === value);
    if (!option || !(Number(option.value) > 0)) return { ok: false, message: "Pl. First Enter This Column And Again Copy" };
    return { ok: true, copied: { value, addonId: option.value } };
  }
  return { ok: true, copied: { value, addonId: "0" } };
}

/**
 * MnuPaste_Click's checks for the column at the cursor, in the desktop's order: read-only, closed
 * for this row, a drop-down list (L, Q), then a multi-pick's keys and a date's form. Returns the
 * value as it goes in (a date written the way the grid writes dates).
 */
export function pasteValue(
  copied: CopiedCell,
  column: Readonly<{ caption: string; setup: Pick<Setup, "combo_value" | "field_type">; multiPick?: boolean; options?: readonly Option[] | null }>,
  state: Readonly<{ editable: boolean; disabled: boolean }>,
  date: Readonly<{ parse: (text: string) => Date | null; write: (text: string, date: Date) => string }>,
): Outcome<{ value: string }> {
  if (!state.editable) return { ok: false, message: `Column. : ${column.caption} is readonly` };
  if (state.disabled) return { ok: false, message: `Column. : ${column.caption} is disabled` };
  if (["L", "Q"].includes(column.setup.combo_value.trim().toUpperCase())) return { ok: false, message: `Column ${column.caption} isn't allow for Paste, as it is drop down column` };
  let value = copied.value;
  if (column.multiPick) {
    if (!validKeyList(value, column.options ?? [], "")) return { ok: false, message: `Value = ${copied.value} isn't a list of ${column.caption} keys` };
    value = keyListText(parseKeyList(value));
  }
  if (column.setup.field_type === "D" && value.trim() !== "") {
    const parsed = date.parse(value);
    if (!parsed) return { ok: false, message: `Value = ${copied.value} isn't valid date for Column ${column.caption}` };
    value = date.write(value, parsed);
  }
  return { ok: true, value };
}

/** Ctrl+A: the grid as tab-separated text, the headings first, for pasting into Excel. */
export function gridText(captions: readonly string[], rows: readonly (readonly string[])[]): string {
  return [captions.join("\t"), ...rows.map((row) => row.join("\t"))].join("\n");
}

/** "Pasted ... into n rows of ..." for the status row. */
export const pastedMessage = (value: string, rows: number, caption: string) => `Pasted "${value}" into ${rows} row${rows === 1 ? "" : "s"} of ${caption}`;
