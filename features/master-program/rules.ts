import { applyStyleCase, getPermission, isNumeric, keyRefused, parseDesktopDate, toDecimal, toText, validateContactNumber } from "../../lib/master-program/legacy";
import type { PublicProgramBodySetup } from "../../lib/master-rules";
import { duplicateKey, hasInvisible } from "../../lib/master-program/main-field";

/**
 * The grid events of Master_ProgramGrid that need no database, for both grids.
 *
 * Update grid: C1dg_UpdateGrid_KeyPressEdit, SetupEditor, ValidateEdit, Duplicate_checking,
 * Func_CheckValuePresence, Func_GetCarryString. Add grid: the C1dg_MasterGrid versions,
 * which differ in small ways the functions take as a flag. Anything that reads a table is
 * asked of /api/master-program by the screen; these return what the C# decides from the
 * cells alone.
 */

export type Setup = PublicProgramBodySetup;

export type KeyContext = Readonly<{
  setup: Setup;
  masterGrid: boolean;
  programId: number;
  licence: number;
  /** The cell's stored value and the editor text before this key. */
  cellValue: string;
  editorText: string;
  /** tarikh1 as dd/MMM/yyyy. */
  yearStart: string;
  /** The editor text that stays once this key replaces the selected part (defaults to editorText). */
  remainingText?: string;
}>;

export type KeyOutcome = Readonly<{
  /** e.Handled: the key does not reach the editor. */
  refused: boolean;
  /** A message box the desktop shows for this key. */
  message?: string;
  /** Text the editor (and cell) is set to instead. */
  replaceWith?: string;
  /** Ctrl+Z: restore the backup value. */
  restore?: boolean;
}>;

/**
 * C1dg_UpdateGrid_KeyPressEdit / C1dg_MasterGrid_KeyPressEdit for one typed character.
 * The two differ: the Add grid checks the input type before the allowed lists, blanks a
 * filled date on space without asking whether it is compulsory, and has no Ctrl+Z.
 */
export function keyPress(context: KeyContext, key: string): KeyOutcome {
  const { setup } = context;
  let refused = false;
  let message: string | undefined;
  let replaceWith: string | undefined;
  let restore = false;

  if (key === "'") {
    message = "Single Quotation Character not allowed...";
    refused = true;
  }
  if (key === " " && !setup.allow_space) {
    if (setup.field_type === "D") {
      if (context.masterGrid) {
        if (context.cellValue.trim() !== "" && context.editorText !== "") replaceWith = "";
        else if (context.cellValue.trim() === "") replaceWith = context.yearStart;
      } else if (context.cellValue.trim() !== "") {
        replaceWith = setup.value_compulsory ? context.yearStart : "";
      } else {
        replaceWith = context.yearStart;
      }
    }
    refused = true;
  }
  if (!context.masterGrid && key === "\u001a") {
    restore = true;
    refused = true;
  }

  // A number takes one decimal point only ("123.12.14" cannot be typed).
  if (key === "." && isNumberField(setup) && (context.remainingText ?? context.editorText).includes(".")) refused = true;
  if (key === "-" && setup.number_positiveonly) refused = true;

  const numericRefusal = () => {
    if (setup.force_inputtype !== "N") return false;
    const allowMinus = !setup.number_positiveonly && key === "-";
    const allowDot = setup.decimal_points > 0 && key === ".";
    const digit = key >= "0" && key <= "9";
    return !(digit || allowMinus || allowDot || key === "\u007f" || key === "\b");
  };
  const lists = () => {
    if (toText(setup.value_allowed) !== "" && keyRefused(setup.value_allowed, key, true, context.programId)) refused = true;
    if (toText(setup.value_notallowed) !== "" && keyRefused(setup.value_notallowed, key, false, context.programId)) {
      message = `This Character not allowed ==> ${setup.value_notallowed.split("|").join("")}`;
      refused = true;
    }
  };
  if (context.masterGrid) {
    if (numericRefusal()) refused = true;
    lists();
  } else {
    lists();
    if (numericRefusal()) refused = true;
  }
  return { refused, message, replaceWith, restore };
}

/**
 * A letter typed in the case value_allowed does not list, when the other case is allowed
 * (MOBILE NO. allows A-Z only): the letter is taken in the allowed case instead of refused.
 */
export function fitCase(setup: Pick<Setup, "value_allowed" | "value_notallowed">, text: string, programId: number): string {
  const allowed = toText(setup.value_allowed);
  if (allowed === "") return text;
  const refused = (character: string) => keyRefused(allowed, character, true, programId)
    || (toText(setup.value_notallowed) !== "" && keyRefused(setup.value_notallowed, character, false, programId));
  return [...text].map((character) => {
    const other = character === character.toUpperCase() ? character.toLowerCase() : character.toUpperCase();
    return other !== character && refused(character) && !refused(other) ? other : character;
  }).join("");
}

/**
 * Trailing blanks on a field that takes no space: older rows hold them as padding
 * (Invoice Slab SHORT DESC "ADD_LESS  "), and they cannot be typed, so they go on commit
 * instead of failing the value_allowed check.
 */
export function dropPadding(setup: Pick<Setup, "allow_space">, text: string): string {
  return setup.allow_space ? text : text.trimEnd();
}

/** A field that holds a number: type N or C, or forced to numeric input. */
export function isNumberField(setup: Pick<Setup, "field_type" | "force_inputtype">): boolean {
  return setup.field_type === "N" || setup.field_type === "C" || setup.force_inputtype === "N";
}

/**
 * An e-mail or web-site field: value_allowed lets "@" in, or the field is named for mail or
 * a web site (not the mail password, SMTP server or "mail required" flag).
 */
export function isAddressField(setup: Pick<Setup, "field_name" | "value_allowed">): boolean {
  const name = toText(setup.field_name).toUpperCase();
  if (/PASS|SMTP|_REQ/.test(name)) return false;
  return toText(setup.value_allowed).split("|").includes("@") || /MAIL|WEB/.test(name);
}

/** More than one "@" in one address; several addresses are split by ";", "," or a space. */
const doubleAt = (text: string) => text.split(/[;,\s]+/).some((address) => (address.match(/@/g)?.length ?? 0) > 1);

/** The typing rules a whole editor text must keep; each entry is broken when true. */
function brokenRules(setup: Setup, text: string) {
  return [
    hasInvisible(text),
    isAddressField(setup) && doubleAt(text),
    isNumberField(setup) && (text.match(/\./g)?.length ?? 0) > 1,
    Boolean(setup.number_positiveonly) && text.includes("-"),
    setup.force_inputtype === "N" && /[^0-9.,-]/.test(text),
    setup.force_inputtype === "N" && setup.decimal_points <= 0 && text.includes("."),
  ];
}

/**
 * Whether an editor may change from `before` to `after`. The key checks above see ordinary
 * typing, but text can also arrive without a key the page sees: Alt+45 on the number pad, a
 * paste, a drop, an input method. Any change that breaks a rule the text kept until now is
 * refused, so a value that was already stored that way can still be corrected.
 */
export function typingAllowed(setup: Setup, before: string, after: string): boolean {
  const was = brokenRules(setup, before);
  return brokenRules(setup, after).every((broken, index) => !broken || was[index]);
}

/** SetupEditor and AfterEdit's style_case, which the web applies as the value is committed. */
export function styleCase(setup: Setup, value: string, licence: number): string {
  return applyStyleCase(setup.style_case, value, licence, setup.combo_value);
}

export type ValidateContext = Readonly<{
  setup: Setup;
  masterGrid: boolean;
  programId: number;
  licence: number;
  coGstReq: boolean;
  /** Head label for messages (Add grid) or the column heading (Update grid). */
  label: string;
  /** The value of another field on the same record: previous Add row / column by name. */
  fieldValue(name: string): string;
  /** The Add grid's previous row input (e.Row - 1), which P_REG and GST read. */
  previousInput?: string;
  /** Update grid column caption by field name, for Func_CheckValuePresence's messages. */
  captionOf?(name: string): string;
  /** Every value of a column in the Update grid, for Func_CheckValuePresence. */
  columnValues?(name: string): readonly string[];
  /** The row the edit is on in the Update grid (1-based), for the "same as" rule. */
  rowIndex?: number;
}>;

export type ValidateOutcome = Readonly<{ ok: boolean; message?: string; title?: string; replaceWith?: string }>;

const fail = (message: string, title: string): ValidateOutcome => ({ ok: false, message, title });

/**
 * C1dg_UpdateGrid_ValidateEdit / C1dg_MasterGrid_ValidateEdit, the checks that read only
 * the grid. The screen asks the server for sys.checkstateid, sys.checkgststateid, the
 * duplicate_query and the duplicate checks against the help grid, in the order the C#
 * runs them, after these pass.
 */
export function validate(context: ValidateContext, typed: string): ValidateOutcome {
  const { setup } = context;
  const text = typed;

  if (toText(setup.must_contain) !== "" && text.length > 0) {
    for (const character of setup.must_contain) {
      if (!text.includes(character)) return fail(`${context.masterGrid ? "Row" : "Column"} Must Contain ==> ${setup.must_contain}`, "Must Contain following Character");
    }
  }

  if (context.masterGrid && setup.field_validation === "sys.checkpresence" && text !== "" && toText(setup.value_search_infld) !== "") {
    const message = checkValuePresence(context, text.toUpperCase(), setup.value_search_infld.trim(), setup.database_name.trim(), undefined);
    if (message !== "") return fail(message, `Error In ${setup.database_name.trim()}`);
  }

  // The desktop checks these only as keys are typed; a value that arrives whole (the
  // calculator, a paste) is checked here too, so it cannot slip past them.
  // A list column (combo_value L, Q or X) shows a choice's name ("E - DIRECT EXPENSES") while it
  // stores the choice's id: the number rules are for the id, never the name.
  const listColumn = ["L", "Q", "X"].includes(toText(setup.combo_value).trim().toUpperCase());
  if (!listColumn) {
    if (setup.number_positiveonly && (text.includes("-") || (text.trim() !== "" && isNumeric(text.replace(/,/g, "").trim(), true) && toDecimal(text.replace(/,/g, "")) < 0))) {
      return fail("Only positive value allowed in this column", "Positive Value Only");
    }
    if (isNumberField(setup) && (text.match(/\./g)?.length ?? 0) > 1) {
      return fail("Only one decimal point is allowed in a number", "Invalid Number");
    }
  }
  for (const character of text) {
    const notAllowed = toText(setup.value_notallowed) !== "" && keyRefused(setup.value_notallowed, character, false, context.programId);
    const notInAllowed = toText(setup.value_allowed) !== "" && keyRefused(setup.value_allowed, character, true, context.programId);
    if (notAllowed || notInAllowed) return fail(`This Character not allowed ==> ${character === " " ? "(space)" : character}`, "Character Not Allowed");
  }

  if (setup.field_validation.toLowerCase() === "sys.validcontactnumber" && text.length > 0) {
    // The desktop splits a name off with ':' on the Add grid and ';' on the Update grid, while
    // value_allowed lets only one of them be typed; either one is read as the separator here.
    const result = validateContactNumber(text.replace(/:/g, ";"), setup.field_length_min, ";", ",", setup.head_label);
    if (!result.ok) return fail(result.message, "Invalid Contact Info");
  }

  if (setup.value_compulsory) {
    const blank = text.trim() === "";
    if (context.masterGrid) {
      if ((blank && setup.combo_value.trim() !== "L") || (text === "0" && setup.combo_value.trim() !== "L" && setup.combo_value.trim() !== "X")) return fail("Compulsory Column", "Compulsory Column");
    } else if (blank && setup.combo_value.trim() !== "L") {
      return fail("Compulsory Column", "Compulsory Column");
    }
  }

  const min = setup.field_length_min;
  if (min > 0 && (context.masterGrid ? text.length : text.trim().length) > 0 && (context.masterGrid ? text.length : text.trim().length) < min) {
    return fail(`Minimum Length of Column Must be ${min}`, "Minimum Length");
  }

  const registerCheck = () => {
    if (context.programId === 14 && setup.field_name === "P_REG" && context.coGstReq && text.length > 0) {
      if (toText(context.previousInput) === "" && text === "REGISTER") return fail("If GST No Blank Than Select Other Than REGISTER", "Register Selection");
    }
    return null;
  };
  const maxCheck = () => {
    const max = setup.field_length_max;
    if (max > 0 && (context.masterGrid ? text.length : text.trim().length) > max) return fail(`Maximum Length of Column Must be ${max}`, "Maximum Length");
    return null;
  };
  // The Update grid checks the maximum before P_REG, the Add grid after it.
  const ordered = context.masterGrid ? [registerCheck, maxCheck] : [maxCheck, registerCheck];
  for (const check of ordered) {
    const outcome = check();
    if (outcome) return outcome;
  }

  if (setup.number_range_upto > 0 && text.trim().length > 0 && toDecimal(text) > setup.number_range_upto) {
    return fail(`Range ${setup.number_range_from} To ${setup.number_range_upto}`, "Validation");
  }

  if (!context.masterGrid && setup.field_validation === "sys.checkpresence" && text !== "" && toText(setup.value_search_infld) !== "") {
    const message = checkValuePresence(context, text, setup.value_search_infld.trim(), setup.database_name.trim(), context.rowIndex);
    if (message !== "") return fail(message, `Error In ${setup.database_name.trim()}`);
  }

  return { ok: true };
}

/** Master_ProgramGrid.Func_CheckValuePresence against the Update grid. */
export function checkValuePresence(context: ValidateContext, value: string, searchField: string, formName: string, rowIndex: number | undefined): string {
  const values = context.columnValues?.(searchField);
  if (!values) return "";
  const found = values.findIndex((candidate) => candidate === value);
  const caption = context.captionOf?.(searchField) ?? searchField;
  if (found === -1) return `${caption} : ${value} Wasn't Found In ${formName}`;
  if (rowIndex !== undefined && found + 1 === rowIndex) return `You Can't Use ${context.label} Same As ${caption}`;
  return "";
}

/** sys.checkgststateid: the first two characters must be the state's opt_short. */
export function gstStateMismatch(typed: string, stateShort: string): { mismatch: boolean; corrected: string } {
  if (typed.length < 2 || !isNumeric(typed.slice(0, 2), true) || stateShort === "") return { mismatch: false, corrected: typed };
  if (stateShort === typed.slice(0, 2)) return { mismatch: false, corrected: typed };
  return { mismatch: true, corrected: typed.split(typed.slice(0, 2)).join(stateShort) };
}

/**
 * Func_GetCarryString. On the Update grid the fields are columns of one record; on the Add
 * grid they are rows, read by field name. A single field without "|" is the value as is.
 */
export function carryString(carryFields: string, separator: string, valueOf: (name: string) => string | undefined): string {
  const sep = separator === "" ? " " : separator;
  if (carryFields.includes("|")) {
    let carry = "";
    for (const name of carryFields.split("|")) {
      if (name === "") continue;
      const value = valueOf(name);
      if (value !== undefined && value !== "") carry += value + sep;
    }
    return carry === "" ? "" : carry.slice(0, -1);
  }
  return carryFields !== "" ? (valueOf(carryFields) ?? "").trim() !== "" ? valueOf(carryFields) ?? "" : "" : "";
}

/**
 * A group value without the tree prefix a list may show before the name: BALSHEET_LIST gives
 * "A -- FIXED ASSETS" (type letter, one dash per level) while the grid restores "FIXED ASSETS".
 */
const groupName = (value: string) => value.trim().replace(/^[A-Z] -* +/, "").toUpperCase();

/** Two values of a group field (duplichk_fldname2/3) read as the same group: trimmed, any case, no tree prefix. */
export const sameGroup = (a: string, b: string) => groupName(a) === groupName(b);

/**
 * Master_ProgramGrid.Duplicate_checking on the Update grid: another row with the same value in
 * duplichk_fldname1 (compared by duplicateKey: any case, spacing ignored). duplichk_fldname2 and
 * duplichk_fldname3 are group fields: a row counts only when it holds the same value in them as
 * the current row (Option master: a description may repeat under another option).
 * duplichk_pkfldname, when set, leaves out the row holding the current row's key.
 *
 * The desktop read the group fields off the help grid by row number, which only lined up while
 * help and grid held the same rows; no setup used them, so they are read off the grid here.
 * Returns true when the desktop says "Duplicate Master Found...".
 */
export function duplicateInGrid(
  records: readonly Readonly<Record<string, string>>[],
  currentIndex: number,
  text: string,
  setup: Setup,
): boolean {
  const search = duplicateKey(text);
  if (search === "" || toText(setup.duplichk_fldname1) === "") return false;
  const f1 = setup.duplichk_fldname1.toLowerCase();
  const groups = [toText(setup.duplichk_fldname2), toText(setup.duplichk_fldname3)].map((name) => name.toLowerCase()).filter((name) => name !== "");
  const pk = toText(setup.duplichk_pkfldname).toLowerCase();
  const pick = (row: Readonly<Record<string, string>> | undefined, name: string) => {
    if (!row) return "";
    const key = Object.keys(row).find((candidate) => candidate.toLowerCase() === name);
    return key ? row[key] : "";
  };
  const current = records[currentIndex];
  return records.some((row, index) => {
    if (index === currentIndex || duplicateKey(pick(row, f1)) !== search) return false;
    if (!groups.every((name) => sameGroup(pick(row, name), pick(current, name)))) return false;
    return pk === "" || pick(row, pk) !== pick(current, pk);
  });
}

/**
 * Add grid: another Update grid record already holds this value in duplichk_fldname1. With a
 * group (duplichk_fldname2), only records of the same group count.
 */
export function duplicateAgainstUpdate(
  records: readonly Readonly<Record<string, string>>[],
  fieldName: string,
  text: string,
  restoreRow: number | null,
  group: Readonly<{ field: string; value: string }> | null = null,
): boolean {
  const pick = (record: Readonly<Record<string, string>>, name: string) => {
    const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    return key === undefined ? undefined : record[key];
  };
  const search = duplicateKey(text);
  return records.some((record, index) => {
    const value = pick(record, fieldName);
    if (value === undefined || duplicateKey(value) !== search || index === restoreRow) return false;
    return group === null || sameGroup(pick(record, group.field) ?? "", group.value);
  });
}

/**
 * Paired fields (value_diff_than names the partner): only one of the two may hold a value, as
 * Addon Field's "Enable For Book No" / "Disable For Book No". A field is closed while its partner
 * holds a value and it is itself blank; when both already hold one (older records) both stay
 * open, so either can be cleared.
 */
export function pairedClosed(partner: string, own: string, valueOf: (name: string) => string): boolean {
  return partner !== "" && own.trim() === "" && valueOf(partner).trim() !== "";
}

/** The refusal when a value is entered while the partner field still holds one. */
export function pairedMessage(own: string, partner: string): string {
  return `Only one of "${own.trim()}" and "${partner.trim()}" may be filled. Clear "${partner.trim()}" first.`;
}

/** "Date should be allowed only Within Accounting year" (BeforeRowColChange, Update grid, blank group). */
export function dateOutsideYear(value: string, yearStart: string, yearEnd: string): boolean {
  const date = parseDesktopDate(value);
  const from = parseDesktopDate(yearStart);
  const to = parseDesktopDate(yearEnd);
  if (!date || !from || !to) return false;
  return date > to || date < from;
}

export { getPermission };
export { shorthandDate } from "../grid/dates";
