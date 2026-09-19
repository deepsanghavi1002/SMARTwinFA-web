/**
 * The typing rules a master column carries, as the desktop program applies them.
 *
 * Every rule here is one of the per-column settings held in smart_setup.program_body and
 * read by Master_ProgramGrid - the one form that drives every master. The desktop applies
 * them on each keystroke in C1dg_UpdateGrid_KeyPressEdit and on leaving the cell in
 * C1dg_UpdateGrid_ValidateEdit; this module is the same logic, so a column behaves the
 * same in the browser as it does in the Windows program.
 *
 * Nothing is hardcoded per client: a different installation whose program_body says
 * something else gets different behaviour without this file changing.
 */

export type FieldRules = {
  /** force_inputtype: "N" accepts digits only; "T" and "C" leave the text free. */
  forceInput?: string;
  /** allow_space: false blocks the spacebar outright. */
  allowSpace?: boolean;
  /** value_allowed: a pipe list of single characters and A-Z style ranges. Only these pass. */
  valueAllowed?: string;
  /** value_notallowed: the same shape, but these are the ones refused. */
  valueNotAllowed?: string;
  /** field_length_max: the longest the value may be. 0 (or absent) means no limit. */
  maxLength?: number;
  /** style_case: "U" upper, "L" lower, "P" proper. Anything else leaves the text alone. */
  styleCase?: string;
  /** decimal_points: a dot is only accepted when this is above zero. */
  decimals?: number;
  /** number_positiveonly: false is what lets a minus sign through. */
  positiveOnly?: boolean;
  /** value_compulsory: the column may not be left blank. */
  required?: boolean;
};

/**
 * Does a character match one of these lists?
 *
 * The desktop stores them as "A-Z|a-z|0-9|.|@|_|" - pipe separated, where an entry
 * holding a dash is a range read from its first and third characters, and any other
 * entry matches on its first character alone. The trailing empty entry is ignored.
 * This is Func_CheckKeyValuePermission's matching half, with its answer left positive.
 */
export function listMatches(list: string, character: string): boolean {
  for (const raw of list.split("|")) {
    const part = raw.trim();
    if (part === "") continue;
    if (part.length >= 3 && part[1] === "-") {
      if (character >= part[0] && character <= part[2]) return true;
    } else if (character === part[0]) {
      return true;
    }
  }
  return false;
}

/** A readable form of a pipe list, for telling the operator what a column accepts. */
function spell(list: string) {
  return list.split("|").map((part) => part.trim()).filter((part) => part !== "").join(" ");
}

/**
 * Why this character may not be typed here, or null when it may.
 *
 * The order is the desktop's: the single quote is refused everywhere because it would
 * break the SQL the master builds, then the spacebar, then the column's own allowed and
 * not-allowed lists, and finally the numeric restriction.
 */
export function charRejection(rules: FieldRules, character: string): string | null {
  if (character === "'") return "Single quotation character not allowed.";
  if (character === " " && rules.allowSpace === false) return "Space is not allowed in this column.";
  if (rules.valueAllowed && !listMatches(rules.valueAllowed, character)) {
    return `Only these are allowed here: ${spell(rules.valueAllowed)}`;
  }
  if (rules.valueNotAllowed && listMatches(rules.valueNotAllowed, character)) {
    return `This character not allowed ==> ${spell(rules.valueNotAllowed)}`;
  }
  if (rules.forceInput === "N") {
    const digit = character >= "0" && character <= "9";
    // A minus is only offered when the column is not marked positive-only, and a dot
    // only when it actually keeps decimals - both exactly as the keypress handler reads them.
    const minus = character === "-" && rules.positiveOnly === false;
    const dot = character === "." && (rules.decimals ?? 0) > 0;
    if (!digit && !minus && !dot) return "This column takes numbers only.";
  }
  return null;
}

/** style_case, applied as the operator types, the way the desktop's editor does. */
export function applyCase(rules: FieldRules, text: string): string {
  switch (rules.styleCase) {
    case "U": return text.toUpperCase();
    case "L": return text.toLowerCase();
    case "P": return text.replace(/\S+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
    default: return text;
  }
}

/**
 * Keeps only what this column accepts.
 *
 * The desktop refuses the keystroke and shows a message box; a browser cell drops the
 * character instead and hands back the first reason, which the grid shows once rather
 * than interrupting on every key. Pasted text goes through the same sieve.
 */
export function sanitise(rules: FieldRules, text: string): { text: string; reason: string } {
  let kept = "";
  let reason = "";
  const numeric = rules.forceInput === "N";
  for (const character of text) {
    const rejected = charRejection(rules, character);
    if (rejected) {
      if (reason === "") reason = rejected;
      continue;
    }
    // A character on its own can be legal while the number it would build is not, so the
    // two positional rules are kept here where the text so far is known: a number has at
    // most one decimal point, and a minus sign only leads.
    if (numeric && character === "." && kept.includes(".")) {
      if (reason === "") reason = "Only one decimal point is allowed.";
      continue;
    }
    if (numeric && character === "-" && kept !== "") {
      if (reason === "") reason = "A minus sign is only allowed at the start.";
      continue;
    }
    kept += character;
  }
  kept = applyCase(rules, kept);
  const max = rules.maxLength ?? 0;
  if (max > 0 && kept.length > max) {
    kept = kept.slice(0, max);
    if (reason === "") reason = `Maximum length of column must be ${max}.`;
  }
  return { text: kept, reason };
}

/** Why the finished value cannot be stored, or "" when it can. Checked on leaving the cell. */
export function valueProblem(rules: FieldRules, label: string, value: string): string {
  const trimmed = value.trim();
  if (rules.required && trimmed === "") return `${label} cannot be blank.`;
  const max = rules.maxLength ?? 0;
  if (max > 0 && trimmed.length > max) return `Maximum length of ${label} must be ${max}.`;
  if (rules.forceInput === "N" && trimmed !== "" && !Number.isFinite(Number(trimmed))) {
    return `${label} must be a number.`;
  }
  return "";
}
