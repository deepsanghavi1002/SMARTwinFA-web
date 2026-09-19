/**
 * Master_ProgramGrid.Func_ReplaceSysVal_CtrlValue, ported.
 *
 * program_body keeps its queries as SQL text with |sys.xxx| placeholders in it -
 * duplicate_query, onchange_repl_value_query, combo_fixquery, the record-exists queries
 * and more. Before the desktop runs one it passes the text through this function, which
 * swaps each placeholder for a value from the screen: the two group combos, the cell the
 * cursor is on, the row being saved, the operator and company.
 *
 * The browser has no WinForms controls to read, so the caller hands over a snapshot of
 * them as a SysValueContext, and the three placeholders that need a lookup ask for it
 * through SysValueLookups. That keeps this file free of the database and testable.
 *
 * The desktop's order of replacement, and its quirks, are kept deliberately; where the
 * port differs, the comment at that spot says so and why. The main difference is
 * quoting. The C# pastes values in raw because its keypress handler already refuses a
 * single quote. Values here arrive over HTTP, so every one taken from a cell or a combo
 * text has its quotes doubled, and every id that sits unquoted in the SQL must be a
 * whole number. A value the desktop would have pasted in cleanly comes out the same.
 *
 * Lib_GlobalFunctions.ReplaceSysValueinQuery, which the desktop always runs first, is a
 * separate function and is not part of this file.
 */

export type ComboChoice = Readonly<{
  /** cmb.Text - "(blank)" when the combo's blank row is chosen. */
  text: string;
  /** cmb.SelectedValue, as text. */
  value: string;
}>;

export type SysValueContext = Readonly<{
  /** z_MasterGrid: true on the Add (vertical) grid, false on the Update grid. */
  masterGrid: boolean;
  /** The company's schema - the desktop's const_Database without its trailing dot. */
  companySchema: string;
  /** cmb_Master_GroupFld. */
  firstCombo: ComboChoice;
  /** cmb_Master_NewUpd. */
  secondCombo?: ComboChoice;
  /** The Add grid's current row (c1dg_MasterGrid.Rows[c1dg_MasterGrid.Row]). */
  masterRow?: Readonly<{
    fieldInput: string;
    fieldComboValue: string;
    fieldSaveNoChr: number;
    statusAgainstFld: string;
  }>;
  /** The Update grid cell under the cursor (c1dg_UpdateGrid.Row / .Col). */
  updateCell?: Readonly<{
    /** c1dg_UpdateGrid.Rows[Row][Col]. */
    text: string;
    /** c1_Update_Backup.Rows[Row][Col] - for a combo column, the id behind the text. */
    backupValue: string;
    /** c1_PropertyGrid.Rows[Col]["field_input"]. */
    propertyFieldInput: string;
    /** c1_PropertyGrid.Rows[Col]["field_savenochr"]. */
    fieldSaveNoChr: number;
    /** c1dg_UpdateGrid.Rows[Row]["code"]. */
    code: string;
  }>;
  /** The open cell editor's text (grid.Editor.Text). */
  editorText?: string;
  /** The Update grid row the query is for (z_GridCurRow). */
  gridRow?: Readonly<{
    /** Cell text by the grid's column position, desktop numbering: 2 is the key, 3 the grid key. */
    cells: readonly string[];
    /** Cell text by column name, lowercased. */
    byName: Readonly<Record<string, string>>;
  }>;
  /** c1_PropertyGrid.Rows[2]["field_name"] - the key column's name. */
  keyFieldName?: string;
  rateAddon2?: number;
  rateAddon3?: number;
  /** fld_value_1 .. fld_value_9, at indexes 1 to 9. */
  fieldValues?: readonly (string | null | undefined)[];
  programId: number;
  userNo: number;
  userType: string;
  companyKey: number;
}>;

export type SysValueLookups = Readonly<{
  /** addon_fld where fiel_relate='A' and fiel_pos<>'D' and account_help=1. */
  accountHelpAddons(): Promise<readonly Readonly<{ save: string; short: string }>[]>;
  /** addon_fld.fiel_save for this fiel_key, or null when there is none. */
  addonSaveByKey(fielKey: string): Promise<string | null>;
  /** addon_fld.fiel_save of the addon that owns this addon_sub.sub_code, or null. */
  addonSaveBySubCode(subCode: string): Promise<string | null>;
}>;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Doubles single quotes, so a value cannot close the literal it is pasted into. */
const literal = (value: string) => value.replace(/'/g, "''");

/** An id that sits unquoted in the SQL: anything but a whole number is refused. */
function wholeNumber(token: string, value: string | number): string {
  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) throw new Error(`${token} needs a whole number, got "${text}"`);
  return text;
}

/** C# String.Replace: ordinal, case-sensitive, every occurrence. */
const replaceAll = (source: string, token: string, value: string) => source.split(token).join(value);

/** The C# checks with ToLower().Contains(), so detection ignores case even though Replace does not. */
const has = (source: string, token: string) => source.toLowerCase().includes(token);

function need<T>(value: T | undefined, what: string, token: string): T {
  if (value === undefined) throw new Error(`${token} needs ${what}, which was not supplied`);
  return value;
}

/** Convert.ToDateTime(x).ToString("dd/MMM/yyyy"). */
function desktopDate(value: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (iso) return `${iso[3]}/${MONTHS[Number(iso[2]) - 1]}/${iso[1]}`;
  if (/^\d{2}\/[A-Za-z]{3}\/\d{4}$/.test(value.trim())) return value.trim();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`|sys.last_savedate| is not a date: "${value}"`);
  return `${String(parsed.getDate()).padStart(2, "0")}/${MONTHS[parsed.getMonth()]}/${parsed.getFullYear()}`;
}

/**
 * The column name in a |sys.pkv.NAME| or |sys.col.NAME| placeholder. Like the C#, only
 * the first such placeholder is resolved; every copy of that one is replaced.
 */
function namedToken(source: string, prefix: string): string {
  const start = source.toLowerCase().indexOf(prefix) + prefix.length;
  const rest = source.slice(start);
  const end = rest.indexOf("|");
  if (end < 0) throw new Error(`${prefix} has no closing |`);
  return rest.slice(0, end);
}

function cellByName(context: SysValueContext, name: string, token: string): string {
  const row = need(context.gridRow, "the grid row", token);
  const value = row.byName[name.toLowerCase()];
  if (value === undefined) throw new Error(`${token} names a column the grid does not have: ${name}`);
  return value;
}

export async function replaceSysValues(
  source: string | null | undefined,
  context: SysValueContext,
  lookups: SysValueLookups,
): Promise<string> {
  if (source === null || source === undefined) return "";
  let sql = source;
  const schema = context.companySchema;
  if (!/^[A-Za-z0-9_]+$/.test(schema)) throw new Error("The company schema name is not valid");

  if (has(sql, "|sys.replace_acaddon|,")) {
    const addons = await lookups.accountHelpAddons();
    const list = addons.map((addon) => `txt_${addon.save.trim()} as ${addon.short.trim()},`).join("");
    sql = replaceAll(sql, "|sys.replace_acaddon|,", list);
  }

  if (has(sql, "|sys.replace_prodaddon|,")) {
    sql = replaceAll(sql, "|sys.replace_prodaddon|,", "");
  }

  if (has(sql, "|sys.keyname|")) {
    const save = await lookups.addonSaveByKey(wholeNumber("|sys.keyname|", context.firstCombo.value));
    sql = replaceAll(sql, "|sys.keyname|", save === null ? "" : `key_${save.trim()}`);
  }

  if (has(sql, "|sys.keyfldname|")) {
    const save = await lookups.addonSaveBySubCode(wholeNumber("|sys.keyfldname|", context.firstCombo.value));
    sql = replaceAll(sql, "|sys.keyfldname|", save === null ? "" : `key_${save.trim()}`);
  }

  // The C# Substring throws when the count is longer than the text; slice stops at the end.
  if (has(sql, "|sys.left.firstcombotext|")) {
    const count = context.masterGrid
      ? need(context.masterRow, "the Add grid row", "|sys.left.firstcombotext|").fieldSaveNoChr
      : need(context.updateCell, "the Update grid cell", "|sys.left.firstcombotext|").fieldSaveNoChr;
    sql = replaceAll(sql, "|sys.left.firstcombotext|", literal(context.firstCombo.text.slice(0, count)));
  }

  if (has(sql, "|sys.firstcombotext|")) {
    const text = context.firstCombo.text === "(blank)" ? "" : context.firstCombo.text;
    sql = replaceAll(sql, "|sys.firstcombotext|", literal(text));
  }

  if (has(sql, "|sys.secondcombotext|")) {
    const second = need(context.secondCombo, "the second combo", "|sys.secondcombotext|");
    sql = replaceAll(sql, "|sys.secondcombotext|", literal(second.text === "(blank)" ? "" : second.text));
  }

  if (has(sql, "|sys.firstcombovalue|")) {
    const value = context.firstCombo.text === "(blank)" ? "0" : wholeNumber("|sys.firstcombovalue|", context.firstCombo.value);
    sql = replaceAll(sql, "|sys.firstcombovalue|", value);
  }

  if (has(sql, "|sys.secondcombovalue|")) {
    const second = need(context.secondCombo, "the second combo", "|sys.secondcombovalue|");
    sql = replaceAll(sql, "|sys.secondcombovalue|", second.text === "(blank)" ? "0" : wholeNumber("|sys.secondcombovalue|", second.value));
  }

  // Unlike its neighbours, the desktop does not turn "(blank)" into 0 for this one.
  if (has(sql, "|sys.achelpbook|")) {
    sql = replaceAll(sql, "|sys.achelpbook|", wholeNumber("|sys.achelpbook|", context.firstCombo.value));
  }

  if (has(sql, "|sys.firstcomboid|")) {
    const value = context.firstCombo.text === "(blank)" ? "0" : wholeNumber("|sys.firstcomboid|", context.firstCombo.value);
    sql = replaceAll(sql, "|sys.firstcomboid|", value);
  }

  if (has(sql, "|sys.thiscombolistvalue|")) {
    const value = context.masterGrid
      ? need(context.masterRow, "the Add grid row", "|sys.thiscombolistvalue|").fieldInput
      : need(context.updateCell, "the Update grid cell", "|sys.thiscombolistvalue|").propertyFieldInput;
    sql = replaceAll(sql, "|sys.thiscombolistvalue|", literal(value));
  }

  if (has(sql, "|sys.thiscombolistid|")) {
    if (context.masterGrid) {
      const id = need(context.masterRow, "the Add grid row", "|sys.thiscombolistid|").fieldComboValue;
      sql = replaceAll(sql, "|sys.thiscombolistid|", id.trim() === "" ? "" : wholeNumber("|sys.thiscombolistid|", id));
    } else {
      // Only replaced when the backup holds digits alone (an empty value counts, as
      // All() is true of no characters); otherwise the placeholder is left in place.
      const backup = need(context.updateCell, "the Update grid cell", "|sys.thiscombolistid|").backupValue;
      if (/^\d*$/.test(backup)) sql = replaceAll(sql, "|sys.thiscombolistid|", backup);
    }
  }

  if (has(sql, "|sys.thiscombotext|")) {
    const value = context.masterGrid
      ? need(context.masterRow, "the Add grid row", "|sys.thiscombotext|").fieldInput
      : need(context.updateCell, "the Update grid cell", "|sys.thiscombotext|").text;
    sql = replaceAll(sql, "|sys.thiscombotext|", `'${literal(value)}'`);
  }

  if (has(sql, "|sys.left.thiscombotext|")) {
    const value = context.masterGrid
      ? (() => { const row = need(context.masterRow, "the Add grid row", "|sys.left.thiscombotext|"); return row.fieldInput.slice(0, row.fieldSaveNoChr); })()
      : (() => { const cell = need(context.updateCell, "the Update grid cell", "|sys.left.thiscombotext|"); return cell.text.slice(0, cell.fieldSaveNoChr); })();
    sql = replaceAll(sql, "|sys.left.thiscombotext|", literal(value));
  }

  if (has(sql, "|sys.thistext|")) {
    const value = context.masterGrid
      ? need(context.masterRow, "the Add grid row", "|sys.thistext|").fieldInput
      : need(context.updateCell, "the Update grid cell", "|sys.thistext|").text;
    sql = replaceAll(sql, "|sys.thistext|", literal(value));
  }

  if (has(sql, "|sys.input_text|")) {
    sql = replaceAll(sql, "|sys.input_text|", literal(need(context.editorText, "the editor text", "|sys.input_text|")));
  }

  if (has(sql, "|sys.accode|")) {
    if (context.masterGrid) {
      // A new account has no code yet, so the "not this account" condition is dropped.
      sql = replaceAll(sql, "and code<>|sys.accode|", "");
    } else {
      const code = need(context.updateCell, "the Update grid cell", "|sys.accode|").code;
      sql = replaceAll(sql, "|sys.accode|", literal(code));
    }
  }

  if (has(sql, "|sys.rate_addon2|")) {
    sql = replaceAll(sql, "|sys.rate_addon2|", wholeNumber("|sys.rate_addon2|", context.rateAddon2 ?? 0));
  }
  if (has(sql, "|sys.rate_addon3|")) {
    sql = replaceAll(sql, "|sys.rate_addon3|", wholeNumber("|sys.rate_addon3|", context.rateAddon3 ?? 0));
  }

  if (has(sql, "|sys.pkv|") && !context.masterGrid) {
    const key = need(context.gridRow, "the grid row", "|sys.pkv|").cells[2] ?? "";
    if (key.trim().length > 0) {
      sql = replaceAll(sql, "|sys.pkv|", literal(key));
    } else {
      // A row not saved yet has no key. The desktop answers with a query that always
      // finds one row, so a price list record can still be inserted; the rest of the
      // original text is discarded, exactly as it is there.
      sql = `Select code from ${schema}.account where code=1`;
    }
  }

  if (has(sql, "|sys.gridpkv|") && !context.masterGrid) {
    const key = need(context.gridRow, "the grid row", "|sys.gridpkv|").cells[3] ?? "";
    sql = replaceAll(sql, "|sys.gridpkv|", literal(key));
  }

  if (has(sql, "|sys.pkv.") && !context.masterGrid) {
    const name = namedToken(sql, "|sys.pkv.");
    sql = replaceAll(sql, `|sys.pkv.${name}|`, literal(cellByName(context, name, "|sys.pkv.|")));
  }

  if (has(sql, "|sys.pkvfield.value|")) {
    const key = context.masterGrid ? "" : (need(context.gridRow, "the grid row", "|sys.pkvfield.value|").cells[2] ?? "");
    if (key.trim().length > 0) {
      const field = need(context.keyFieldName, "the key field name", "|sys.pkvfield.value|");
      if (!/^[A-Za-z0-9_.]+$/.test(field)) throw new Error(`|sys.pkvfield.value| key field name is not valid: ${field}`);
      sql = replaceAll(sql, "|sys.pkvfield.value|", ` and ${field}<>${literal(key)}`);
    } else {
      sql = replaceAll(sql, "|sys.pkvfield.value|", "");
    }
  }

  // The C# guards null only for 1 and 2 and throws for 3 to 9; here all nine read a
  // missing value as blank, which is what 1 and 2 already do.
  for (let index = 1; index <= 9; index += 1) {
    const token = `|sys.fld_value_${index}|`;
    if (!has(sql, token)) continue;
    const value = context.fieldValues?.[index];
    sql = replaceAll(sql, token, value === null || value === undefined || value.trim().length === 0 ? "null" : `'${literal(value)}'`);
  }

  if (has(sql, "|sys.col.") && !context.masterGrid) {
    const name = namedToken(sql, "|sys.col.");
    sql = replaceAll(sql, `|sys.col.${name}|`, literal(cellByName(context, name, "|sys.col.|")));
  }

  if (has(sql, "|sys.last_savedate|") && !context.masterGrid) {
    const saved = cellByName(context, "last_savedate", "|sys.last_savedate|");
    sql = saved.trim() !== ""
      ? replaceAll(sql, "|sys.last_savedate|", `'${desktopDate(saved)}'`)
      : replaceAll(sql, " and last_savedate=|sys.last_savedate|", "");
  }

  if (has(sql, "|sys.last_savetime|") && !context.masterGrid) {
    const saved = cellByName(context, "last_savetime", "|sys.last_savetime|");
    sql = saved.trim() !== ""
      ? replaceAll(sql, "|sys.last_savetime|", `'${literal(saved)}'`)
      : replaceAll(sql, " and last_savetime=|sys.last_savetime|", "");
  }

  if (has(sql, "|sys.sum_dependfld|") && context.masterGrid) {
    const status = need(context.masterRow, "the Add grid row", "|sys.sum_dependfld|").statusAgainstFld;
    if (status.trim() !== "") {
      const amount = Number(status);
      if (!Number.isFinite(amount)) throw new Error(`|sys.sum_dependfld| is not a number: "${status}"`);
      // Kept as the desktop has it: the amount replaces |sys.left.thiscombotext|, not
      // |sys.sum_dependfld|, and that placeholder is already gone by now, so this changes
      // nothing. The desktop marks the feature as pending.
      sql = replaceAll(sql, "|sys.left.thiscombotext|", status.trim());
    }
  }

  if (has(sql, "|sys.prog_id|")) sql = replaceAll(sql, "|sys.prog_id|", wholeNumber("|sys.prog_id|", context.programId));
  if (has(sql, "|sys.user_no|")) sql = replaceAll(sql, "|sys.user_no|", wholeNumber("|sys.user_no|", context.userNo));
  if (has(sql, "|sys.user_type|")) sql = replaceAll(sql, "|sys.user_type|", literal(context.userType));
  if (has(sql, "|sys.co_id|")) sql = replaceAll(sql, "|sys.co_id|", wholeNumber("|sys.co_id|", context.companyKey));

  return sql;
}
