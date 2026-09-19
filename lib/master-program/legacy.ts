/**
 * Lib_GlobalFunctions and Master_ProgramGrid helpers that touch no database and no
 * control, ported one for one so the browser and the server reach the same answer the
 * desktop does.
 *
 * Each function names its C# original. Where the C# would throw (a Substring past the
 * end, a Convert of a non-number) the port returns the value the desktop's caller would
 * have been left with instead, and says so.
 */

/** Lib_GlobalFunctions.FieldValueTrfToString: null and blanks become "", anything else is trimmed. */
export function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** Lib_GlobalFunctions.FieldValueTrfToDecimal, forgiving: text that is not a number is 0. */
export function toDecimal(value: unknown): number {
  const text = toText(value).replace(/,/g, "");
  if (text === "") return 0;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Lib_GlobalFunctions.FieldValueTrfToInt32, forgiving in the same way. */
export function toInt(value: unknown): number {
  return Math.trunc(toDecimal(value));
}

/** Lib_GlobalFunctions.IsNumeric. With allowDotMinus, at most one dot and one minus anywhere. */
export function isNumeric(value: string, allowDotMinus: boolean): boolean {
  if (value === "") return false;
  let dots = 0;
  let minus = 0;
  for (const character of value.trim()) {
    const digit = character >= "0" && character <= "9";
    if (!digit && character !== "." && character !== "-") return false;
    if (character === "." || character === "-") {
      if (!allowDotMinus) return false;
      if (character === ".") dots += 1; else minus += 1;
      if (dots > 1 || minus > 1) return false;
    }
  }
  return true;
}

/**
 * Lib_GlobalFunctions.ConvertForOperation. "(>=)8" gives ">=" and leaves "8"; text with
 * no bracket is an equality test. The C# hands the remainder back through a ref.
 */
export function convertForOperation(condition: string): { op: string; rest: string } {
  if (!condition.includes("(")) return { op: "=", rest: condition };
  const afterOpen = condition.slice(condition.indexOf("(") + 1);
  const close = afterOpen.indexOf(")");
  const op = close < 0 ? afterOpen : afterOpen.slice(0, close);
  const rest = close < 0 ? "" : afterOpen.slice(close + 1);
  return { op: op === "" ? "=" : op, rest };
}

/** Lib_GlobalFunctions.FormulaValidation. Unparseable numbers make the test false rather than throw. */
export function formulaValidation(condition: string, first: string, second: string, numeric: boolean): boolean {
  const number = (text: string) => Number(text.trim().replace(/ /g, ""));
  switch (condition.trim()) {
    case "=": return first === second;
    case "!":
    case "!=": return first !== second;
    case "<": return numeric && number(first) < number(second);
    case ">": return numeric && Number.isFinite(number(first)) && number(first) > number(second);
    case "<=": return numeric && number(first) <= number(second);
    case ">=": return numeric && number(first) >= number(second);
    case "IN":
      if (second.includes(",") && second.indexOf(",") !== second.lastIndexOf(",")) return second.includes(first);
      return first.includes(second);
    default: return false;
  }
}

/**
 * The part of Func_GetPermission that is only arithmetic: turn the setting ("(>=)8",
 * "IN 1,2,", "EMPTY") into an operator and a value to compare against.
 */
export function permissionCondition(setting: string): { op: string; value: string } {
  let value = setting.trim().toUpperCase();
  let op: string;
  if (setting.trim().toUpperCase().startsWith("IN")) {
    op = "IN";
  } else {
    const parsed = convertForOperation(value);
    op = parsed.op;
    value = parsed.rest;
  }
  if (op !== "") value = value.split(op).join("");
  if (value === "EMPTY") value = "";
  return { op, value };
}

/** Where Func_GetPermission reads the value it tests. */
export type PermissionSource = Readonly<{
  /** cmb_Master_GroupFld: its text, and its value when it is bound to a list. */
  firstCombo: Readonly<{ text: string; value: string; bound: boolean }>;
  /** The value of another field on the same record (grid column or add-grid row). */
  fieldValue(fieldName: string): string | undefined;
}>;

/**
 * Lib_GlobalFunctions.Func_GetPermission.
 *
 * kind "V" answers "T"/"F" (visible), "E" answers "E"/"D" (enabled), "C" answers "C"/"O"
 * (compulsory/optional); "" means the rule did not apply. `masterGrid` and `reverse` are
 * the C#'s z_bl_Is_MasterGrid and z_bl_ReverseCheck and change the answer the same way.
 */
export function getPermission(
  source: PermissionSource,
  kind: "V" | "E" | "C",
  againstField: string,
  setting: string,
  masterGrid: boolean,
  reverse: boolean,
): string {
  const { op, value } = permissionCondition(setting);
  const numeric = (a: string, b: string) => isNumeric(a, true) && isNumeric(b, true);
  const combo = source.firstCombo.bound ? source.firstCombo.value : source.firstCombo.text;

  switch (kind) {
    case "V": {
      if (againstField.toLowerCase() === "first_combo") {
        const inGrid = op.trim().toUpperCase() === "IN" ? ` ${combo},` : combo;
        const pass = formulaValidation(op, value, inGrid, numeric(inGrid, value));
        return pass ? (reverse ? "F" : "T") : (reverse ? "T" : "F");
      }
      const inGrid = source.fieldValue(againstField);
      if (inGrid === undefined) return "";
      const data = masterGrid ? inGrid.trim().toUpperCase() : inGrid.trim().toUpperCase();
      return formulaValidation(op, data, value, numeric(value, data)) ? "F" : "";
    }
    case "E": {
      if (againstField === "first_combo") {
        // The C# tests IsNumeric on its still-empty "data in grid" here, so this
        // comparison is never numeric; kept as it is.
        return formulaValidation(op, combo, value, false) ? "E" : "D";
      }
      const inGrid = source.fieldValue(againstField);
      if (inGrid === undefined) return "";
      const data = inGrid.trim().toUpperCase();
      return (value === "" && !reverse) || formulaValidation(op, data, value, numeric(data, value)) ? "E" : "D";
    }
    case "C": {
      const inGrid = source.fieldValue(againstField);
      if (inGrid === undefined) return "";
      return formulaValidation(op, inGrid, value, numeric(inGrid, value)) ? "C" : "O";
    }
  }
}

/** What Func_SetPermission does with an answer, as flags rather than grid changes. */
export function applyPermission(answer: string): { visible?: boolean; editable?: boolean; compulsory?: boolean } {
  const upper = answer.toUpperCase();
  const result: { visible?: boolean; editable?: boolean; compulsory?: boolean } = {};
  if (upper.includes("T")) result.visible = true;
  if (upper.includes("F")) result.visible = false;
  if (upper.includes("E")) result.editable = true;
  if (upper.includes("D")) result.editable = false;
  if (upper.includes("C")) result.compulsory = true;
  return result;
}

/**
 * Master_ProgramGrid.Func_CheckKeyValuePermission. True means the key is refused.
 * `allow` true reads the list as value_allowed, false as value_notallowed.
 */
export function keyRefused(list: string, key: string, allow: boolean, programId: number): boolean {
  let correct = !allow;
  const matches = (entry: string) => {
    if (entry.includes("-")) return key >= entry.charAt(0) && key <= entry.charAt(2);
    return toText(entry) !== "" && key === entry.charAt(0);
  };
  if (list.includes("|")) {
    for (const entry of list.trim().split("|")) {
      if (entry.includes("-") || toText(entry) !== "") {
        if (matches(entry)) { correct = allow; break; }
      }
    }
  } else if (list !== "" && matches(list)) {
    correct = allow;
  }
  if (key === "\b" || key === "\u007f" || (key === " " && programId === 1)) correct = true;
  return !correct;
}

/** CultureInfo.TextInfo.ToTitleCase(text.ToLower()): every word capitalised, the rest lower. */
export function titleCase(text: string): string {
  return text.toLowerCase().replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/** Master_ProgramGrid.MakeStringProper. */
export function makeStringProper(value: string): string {
  const text = value.trim();
  if (text.includes(" ")) {
    return text.split(" ").map((word) => (word === "" ? "" : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())).join(" ").trim();
  }
  return text === "" ? "" : text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/**
 * style_case as C1dg_UpdateGrid_AfterEdit applies it: U upper (licence 71 with a plain
 * column gets title case instead), L lower, P proper. "A" and anything else is left alone.
 */
export function applyStyleCase(styleCase: string, value: string, licence: number, comboValue: string): string {
  if (value.trim() === "") return value;
  switch (styleCase.toUpperCase()) {
    case "U": return licence === 71 && comboValue.trim() === "N" ? titleCase(value) : value.toUpperCase();
    case "L": return value.toLowerCase();
    case "P": return titleCase(value);
    default: return value;
  }
}

/** Master_ProgramGrid.Func_ValidateContactNumber. Returns the verdict and the message the desktop builds. */
export function validateContactNumber(typed: string, digits: number, nameSep = ";", valuesSep = ",", label = ""): { ok: boolean; message: string } {
  let ok = true;
  let invalid = 1;
  let name = "";
  const tips = `\n\n *TIPS*\n1. See that Minimum Length Of Contact Number Is : ${digits}\n2. All The Numbers Are Digit\n3. Numbers Are Not Missing ie., There Is A Number After Comma\n4. Check If You Haven't Forgot To Type Contact Details After A Comma`;
  let message = `The Following ${label} Seems To Be Invalid\n`;
  const bad = (number: string) => number.length !== digits || !isNumeric(number, false);

  if (typed.includes(valuesSep)) {
    let position = 0;
    for (const raw of typed.split(valuesSep)) {
      const current = raw.trim();
      if (current.includes(nameSep)) {
        position = 0;
        const index = current.indexOf(nameSep);
        name = current.slice(0, index).trim();
        const number = current.slice(index + 1).trim();
        position += 1;
        if (bad(number)) {
          ok = false;
          message += number.length === 0
            ? `${invalid++} ) Number Missing At Position ${position} For Person ==> ${name}\n`
            : `${invalid++} ) Invalid Number ==> ${number} For Person ==> ${name}\n`;
        }
      } else {
        const number = current.trim();
        position += 1;
        if (bad(number)) {
          ok = false;
          if (name !== "") {
            message += number.length === 0
              ? `${invalid++} ) Number Missing At Position ${position} For Person ==> ${name}\n`
              : `${invalid++} ) Invalid Number ==> ${current} For Person ==> ${name}\n`;
          } else {
            message += number.length === 0
              ? `${invalid++} ) Number Missing At Position ==> ${position} \n`
              : `${invalid++} ) Invalid Number ==> ${current}\n`;
          }
        }
      }
    }
  } else {
    let number: string;
    if (typed.includes(nameSep)) {
      const index = typed.indexOf(nameSep);
      name = typed.slice(0, index).trim();
      number = typed.slice(index + 1).trim();
    } else {
      number = typed.trim();
    }
    if (bad(number)) {
      ok = false;
      if (name !== "") message += `${invalid++} ) Invalid Number ==> ${number} For Person ==> ${name}\n`;
      else message += number.length === 0 ? `${invalid++} ) Number Missing At Position ==> 1 \n` : `${invalid++} ) Invalid Number ==> ${number}\n`;
    }
  }
  return { ok, message: message + tips };
}

/** Lib_GlobalFunctions.Run_Formula. Math.Round(decimal, n) rounds a tie to even, and so does this. */
export function runFormula(value: number, operator: string, figure: number, round: number): string {
  const factor = 10 ** round;
  // Math.Round(decimal, n) uses banker's rounding; the tie case is reproduced here.
  const bankers = (x: number) => {
    const scaled = x * factor;
    const floor = Math.floor(scaled);
    const diff = scaled - floor;
    const rounded = Math.abs(diff - 0.5) < 1e-9 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(scaled);
    return String(rounded / factor);
  };
  switch (operator) {
    case "*": return bankers(value * figure);
    case "/": return figure === 0 ? "" : bankers(value / figure);
    case "+": return bankers(value + figure);
    case "-": return bankers(value - figure);
    default: return "";
  }
}

/** Lib_GlobalFunctions.Security_read_pw: each character shifted down by 129 + position. */
export function securityRead(stored: string, position: number): string {
  let out = "";
  for (const character of stored.trim()) out += String.fromCharCode(character.charCodeAt(0) - 129 - position);
  return out;
}

/** Lib_GlobalFunctions.Security_write_pw: the inverse. */
export function securityWrite(plain: string, position: number): string {
  let out = "";
  for (const character of plain.trim()) out += String.fromCharCode(character.charCodeAt(0) + 129 + position);
  return out;
}

/** Lib_GlobalFunctions.RemoveTableAliasfromFieldName: "asub.SUB_CODE" -> "SUB_CODE". */
export function removeTableAlias(field: string): string {
  return field.indexOf(".") > 0 ? field.slice(field.indexOf(".") + 1) : field;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** DateTime.ToString("dd/MMM/yyyy"), the format every desktop date literal uses. */
export function formatDesktopDate(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")}/${MONTHS[date.getMonth()]}/${date.getFullYear()}`;
}

/** DateTime.ToLongTimeString() on an en-IN desktop: "h:mm:ss AM". */
export function formatDesktopTime(date: Date): string {
  const hours = date.getHours();
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

/**
 * Convert.ToDateTime on what a grid cell holds: "dd/MMM/yyyy", "dd/MM/yyyy", ISO text, or a
 * Date that came back from PostgreSQL. Null when it is not a date.
 */
export function parseDesktopDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (text === "") return null;
  let match = /^(\d{1,2})[/-]([A-Za-z]{3})[/-](\d{4})/.exec(text);
  if (match) {
    const month = MONTHS.findIndex((name) => name.toLowerCase() === match![2].toLowerCase());
    if (month >= 0) return new Date(Number(match[3]), month, Number(match[1]));
  }
  match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The accounting year id "ddmmyyyyddmmyyyy" as the desktop's tarikh1 and tarikh2. */
export function yearDates(yearId: string): { from: Date; to: Date } | null {
  if (!/^\d{16}$/.test(yearId)) return null;
  const at = (offset: number) => new Date(Number(yearId.slice(offset + 4, offset + 8)), Number(yearId.slice(offset + 2, offset + 4)) - 1, Number(yearId.slice(offset, offset + 2)));
  return { from: at(0), to: at(8) };
}

/** Master_ProgramGrid.Write_pw: the obfuscation user passwords are stored in. Throws past 9 characters, as the C# does. */
export function writePw(plain: string): string {
  const text = plain.trim();
  if (text === "") return "";
  if (text.length > 9) throw new Error("A password longer than 9 characters cannot be stored by Write_pw");
  let out = String.fromCharCode(174) + String.fromCharCode(String(text.length).charCodeAt(0) + 129);
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    const code = character.charCodeAt(0);
    if (character.trim() === "" || code <= 15) continue;
    const tail = text.length - index + 1;
    if (code >= 65 && code <= 90) out += String.fromCharCode(160 + index + 1) + String.fromCharCode(code + 129 + 10 + tail);
    else if (code >= 97 && code <= 122) out += String.fromCharCode(170 + index + 1) + String.fromCharCode(code + 129 - 20 + tail);
    else if (code >= 48 && code <= 57) out += String.fromCharCode(180 + index + 1) + String.fromCharCode(code + 129 + 15 + tail);
    else out += String.fromCharCode(190 + index + 1) + String.fromCharCode(code + 129 + tail);
  }
  return out;
}

/** Lib_GlobalFunctions.Read_pw, the inverse of Write_pw. */
export function readPw(stored: string): string {
  const text = stored.trim();
  if (text.length < 2) return "";
  const length = Number(String.fromCharCode(text.charCodeAt(1) - 129));
  if (!Number.isFinite(length)) return "";
  let out = "";
  let count = 0;
  for (let index = 2; index <= text.length - 1; index += 2) {
    count += 1;
    const marker = text.charCodeAt(index);
    const next = index + 1 < text.length ? text.charCodeAt(index + 1) : 0;
    if (text.charAt(index).trim() === "" || marker <= 15) continue;
    if (marker >= 161 && marker <= 170) out += String.fromCharCode(next - 129 - 10 - length + count - 2);
    else if (marker >= 171 && marker <= 180) out += String.fromCharCode(next - 129 + 20 - length + count - 2);
    else if (marker >= 181 && marker <= 190) out += String.fromCharCode(next - 129 - 15 - length + count - 2);
    else out += String.fromCharCode(next - 129 - length + count - 2);
  }
  return out;
}
