import type { ComboOption } from "./types";

/**
 * A multi-pick field (program_body.multiple_chkbox with a combo_fixquery giving text and key):
 * several keys held in one text column as " 2, 12, 13," — a space before every key and a comma
 * after it. The entry screens look a key up with CHARINDEX(' 12,', field), so every key needs
 * that space and comma round it.
 */

/** Whether a field picks several keys (multiple_chkbox with a list query to pick from). */
export function isMultiPick(setup: { readonly multiple_chkbox: boolean; readonly combo_fixquery: string | null }): boolean {
  return setup.multiple_chkbox === true && (setup.combo_fixquery ?? "").trim() !== "";
}

/** The keys held in a stored value, in their order, once each. Reads old values however spaced (" 32,  33,", "10,11,"). */
export function parseKeyList(text: string): string[] {
  const keys: string[] = [];
  for (const part of text.split(",")) {
    const key = part.trim();
    if (key !== "" && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** The stored form of a set of keys: numbers in numeric order, each as " key,". Blank for none. */
export function keyListText(keys: readonly string[]): string {
  const unique = [...new Set(keys.map((key) => key.trim()).filter((key) => key !== ""))];
  unique.sort((a, b) => {
    const x = Number(a);
    const y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) ? x - y : a.localeCompare(b);
  });
  return unique.map((key) => ` ${key},`).join("");
}

/** Whether text is a key list the field can hold: every key one of the list's (or already held before). */
export function validKeyList(text: string, options: readonly ComboOption[], held: string): boolean {
  const known = new Set([...options.map((option) => option.value.trim()), ...parseKeyList(held)]);
  return parseKeyList(text).every((key) => known.has(key));
}

/** What the grid shows for a stored key list: the names, comma separated; a key no longer in the list shows as "#key". */
export function keyListNames(text: string, options: readonly ComboOption[] | null): string {
  const names = new Map((options ?? []).map((option) => [option.value.trim(), option.text.trim()]));
  return parseKeyList(text).map((key) => names.get(key) ?? `#${key}`).join(", ");
}
