import { toText } from "./legacy";

/**
 * A master's main field: the one the operator names the record by (account name, product
 * short name, addon name ...). program_body marks it with DISPLAY_HELP and names the help
 * list it looks up in HELP_QUERY; both must be set for the help list to be shown.
 */
export function isMainField(setup: { readonly display_help: boolean; readonly help_query: string | null }): boolean {
  return setup.display_help === true && toText(setup.help_query) !== "";
}

/** A regular-expression character class over code point ranges (kept as numbers so no raw character sits in the source). */
const characterClass = (ranges: readonly (readonly [number, number])[], flags: string) =>
  new RegExp(`[${ranges.map(([from, to]) => (from === to ? String.fromCharCode(from) : `${String.fromCharCode(from)}-${String.fromCharCode(to)}`)).join("")}]`, flags);

/** Spaces a keyboard can type that look like a plain space: Alt+255 (no-break space) and the wide ones. */
const ODD_SPACE_RANGES = [[0xa0, 0xa0], [0x1680, 0x1680], [0x2000, 0x200a], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000]] as const;
/**
 * Characters that print as nothing, or as a stray mark, and so slip into a name unseen:
 * control characters, the soft hyphen, zero-width spaces and joiners, direction marks,
 * the byte-order mark, and char 255 (y with diaeresis), which old DOS habits type.
 */
const INVISIBLE_RANGES = [[0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0xff, 0xff], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]] as const;

/** Whether text holds an odd space or an invisible character. */
export function hasInvisible(text: string): boolean {
  return characterClass(INVISIBLE_RANGES, "").test(text) || characterClass(ODD_SPACE_RANGES, "").test(text);
}

/** The value a main field is stored with: odd spaces made plain, invisible characters dropped, trailing blanks cut. */
export function cleanMainValue(text: string): string {
  return text.replace(characterClass(ODD_SPACE_RANGES, "g"), " ").replace(characterClass(INVISIBLE_RANGES, "g"), "").replace(/\s+$/, "");
}
