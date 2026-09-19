import { replaceSysValues } from "../sys-values";
import type { SysValueContext } from "../sys-values";
import { sysValueLookups } from "../sys-values-db";
import { isNumeric, runFormula, toDecimal, toInt, toText, formatDesktopDate } from "./legacy";
import { displayValue, Loader, loadContext, prepareProgram } from "./load";
import { replaceSessionValues } from "./sql";
import { SETUP_SCHEMA } from "./session";
import type { GroupState } from "./types";

/**
 * The parts of the grid events that need the database: what C1dg_UpdateGrid_BeforeEdit,
 * BeforeRowColChange, ValidateEdit and AfterEdit (and their c1dg_MasterGrid twins) ask of
 * ReadTable while the operator types. The browser runs every other rule itself and calls
 * one of these when a setup row says a query is due.
 *
 * Each takes the row being edited as the grid holds it, so the placeholders resolve to the
 * same cells they would on the desktop.
 */

type Row = Record<string, unknown>;
const field = Loader.field;

export type RowState = Readonly<{
  /** Update grid: the whole record by lowercased column. Add grid: field_name -> field_input. */
  values: Readonly<Record<string, string>>;
  /** c1_Update_Backup for the row, or field_combovalue per field on the Add grid. */
  backup: Readonly<Record<string, string>>;
  /** The field the cursor is on (its program_body field_name). */
  fieldName: string;
  /** The open editor's text. */
  editorText: string;
}>;

export type EventRequest = Readonly<{ programName: string; group: GroupState; masterGrid: boolean; row: RowState }>;

const lower = (name: string) => name.split(".").pop()!.trim().toLowerCase();

async function context(loader: Loader, request: EventRequest): Promise<{ ctx: SysValueContext; programId: number; setupRow: Awaited<ReturnType<typeof prepareProgram>>["updateBody"][number] | undefined; prepared: Awaited<ReturnType<typeof prepareProgram>> }> {
  const prepared = await prepareProgram(loader, request.programName, request.group);
  const body = request.masterGrid ? prepared.addBody : prepared.updateBody;
  const setupRow = body.find((row) => lower(row.field_name) === lower(request.row.fieldName));
  const values = request.row.values;
  const current = values[lower(request.row.fieldName)] ?? "";
  const ctx = loadContext(loader.session, prepared.programId, request.group, {
    masterGrid: request.masterGrid,
    masterRow: { fieldInput: current, fieldComboValue: request.row.backup[lower(request.row.fieldName)] ?? "", fieldSaveNoChr: setupRow?.field_savenochr ?? 0, statusAgainstFld: setupRow?.status_against_fld ?? "" },
    updateCell: { text: current, backupValue: request.row.backup[lower(request.row.fieldName)] ?? "", propertyFieldInput: setupRow?.field_input ?? "", fieldSaveNoChr: setupRow?.field_savenochr ?? 0, code: values.code ?? "" },
    editorText: request.row.editorText,
    gridRow: { cells: ["", ...Object.values(values)], byName: Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])) },
    keyFieldName: prepared.updateBody[1]?.field_name ?? "",
  });
  return { ctx, programId: prepared.programId, setupRow, prepared };
}

async function resolve(loader: Loader, sql: string, ctx: SysValueContext): Promise<string> {
  return replaceSysValues(replaceSessionValues(sql, loader.session), ctx, sysValueLookups(loader.client, loader.session.companySchema));
}

// ---------------------------------------------------------------------------------------
// C1dg_UpdateGrid_BeforeEdit: record_exist from the five exists queries

export async function recordExist(loader: Loader, request: EventRequest): Promise<{ recordExist: "Y" | "N"; openingFound: boolean }> {
  const { ctx, programId } = await context(loader, request);
  const top = (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.program_top WHERE BTRIM(program_name) = $1`, [request.programName]))?.[0];
  const q = (column: string) => String(field(top, column) ?? "").split("|sys.db|").join(`${loader.session.companySchema}.`);
  let recExist = q("upd_rec_exist_query");
  if (recExist !== "" && programId === 2) {
    const addonFld = await loader.readTable(`SELECT fiel_entrypos, fiel_relate, fiel_enter FROM |sys.db|addon_fld WHERE fiel_key = $1`, [toInt(request.group.firstCombo.value)]);
    const entryPos = toText(field(addonFld?.[0], "fiel_entrypos"));
    const relate = toText(field(addonFld?.[0], "fiel_relate"));
    if (entryPos === "L") recExist = recExist.split("addon_data").join("addon_aentry");
    if (entryPos === "P" && relate === "P") recExist = recExist.split("addon_data").join("addon_ientry");
    if (entryPos === "P" && relate === "A") recExist = recExist.split("addon_data").join("addon_aentry");
  }
  const run = async (sql: string) => {
    const text = sql.trim() === "" ? "" : await resolve(loader, sql, ctx);
    return text === "" ? null : loader.readTable(text);
  };
  let exists: "Y" | "N" = "N";
  let openingFound = false;
  const opening = await run(q("upd_open_exist_query"));
  if (opening) {
    if (displayValue(Object.values(opening[0])[0]).length > 0) exists = "Y";
    openingFound = true;
  }
  if (exists !== "Y" && programId === 2) {
    const enter = await loader.readTable(`SELECT fiel_enter FROM |sys.db|addon_fld WHERE fiel_key = $1`, [toInt(request.group.firstCombo.value)]);
    if (toText(field(enter?.[0], "fiel_enter")) === "M" && await run(recExist)) exists = "Y";
  }
  if (exists !== "Y" && q("upd_process_rec_exist_query") !== "" && await run(q("upd_process_rec_exist_query"))) exists = "Y";
  if (exists !== "Y" && recExist !== "") {
    let sql = recExist;
    if (!openingFound && programId === 14) sql += " and doc_posting<>'L'";
    if (await run(sql)) exists = "Y";
  }
  if (exists !== "Y" && q("upd_book_code_exist_query") !== "" && await run(q("upd_book_code_exist_query"))) exists = "Y";
  if (exists !== "Y" && q("upd_expense_exist_query") !== "" && await run(q("upd_expense_exist_query"))) exists = "Y";
  return { recordExist: exists, openingFound };
}

// ---------------------------------------------------------------------------------------
// defa_against_query (BeforeRowColChange on both grids)

/** Func_ReplaceObjectVarValue with z_bl_IsString true: only |sys.thistext|, |sys.year_id|, |sys.complic|, |sys.progid|. */
function replaceObjectValue(where: string, value: string, licence: number, programId: number, yearId: string): string {
  let text = where;
  text = text.split("|sys.thistext|").join(value.replace(/'/g, "''"));
  text = text.split("|sys.year_id|").join(`'${yearId}'`);
  if (text.toLowerCase().includes("|sys.complic|")) text = text.split("|sys.complic|").join(String(licence));
  if (text.toLowerCase().includes("|sys.progid|")) text = text.split("|sys.progid|").join(String(programId));
  return text;
}

export async function defaAgainst(loader: Loader, request: EventRequest): Promise<{ value: string | null; recFound: boolean; ran: boolean }> {
  const { setupRow, programId } = await context(loader, request);
  if (!setupRow || toText(setupRow.defa_against_query) === "") return { value: null, recFound: false, ran: false };
  const against = toText(setupRow.defa_against_field) !== "" ? request.row.values[lower(setupRow.defa_against_field)] ?? "" : "";
  if (against === "") return { value: null, recFound: false, ran: false };
  const sql = replaceObjectValue(replaceSessionValues(setupRow.defa_against_query, loader.session), against, loader.session.licence, programId, loader.session.yearId);
  const rows = await loader.readTable(sql);
  return rows ? { value: displayValue(Object.values(rows[0])[0]), recFound: true, ran: true } : { value: null, recFound: false, ran: true };
}

// ---------------------------------------------------------------------------------------
// onchange_repl_value_query (AfterEdit on both grids)

export async function onChangeReplace(loader: Loader, request: EventRequest): Promise<Record<string, string>> {
  const { ctx, setupRow } = await context(loader, request);
  if (!setupRow || toText(setupRow.onchange_repl_value_query) === "") return {};
  const sql = await resolve(loader, setupRow.onchange_repl_value_query, ctx);
  // The Update grid skips a query that still holds an unresolved placeholder.
  if (!request.masterGrid && sql.includes("sys.")) return {};
  const rows = await loader.readTable(sql);
  if (!rows) return {};
  return Object.fromEntries(Object.entries(rows[0]).map(([key, value]) => [key.toLowerCase(), displayValue(value)]));
}

// ---------------------------------------------------------------------------------------
// uom_formula (AfterEdit on both grids): the next column/row gets the converted value

export async function uomFormula(loader: Loader, request: EventRequest, coreEntry: boolean): Promise<string | null> {
  const { setupRow } = await context(loader, request);
  if (!setupRow || toText(setupRow.formula_for_table) !== "uom_formula") return null;
  const rows = await loader.readTable(`SELECT * FROM |sys.db|uom_formula WHERE UPPER(uf_formula_name) = $1`, [toText(setupRow.formula_name).toUpperCase()]);
  if (!rows) return null;
  let first = request.row.values[lower(request.row.fieldName)] ?? "";
  let second = "";
  const levelFour = toText(setupRow.formula_name).toUpperCase() === "LEVEL_4";
  if (levelFour && !coreEntry) return null;
  if (!levelFour && first.toUpperCase().includes("X")) {
    second = first.slice(first.toUpperCase().indexOf("X") + 2);
    first = first.slice(0, first.toUpperCase().indexOf("X"));
  }
  let a = "";
  let b = "";
  for (const row of rows) {
    const operator = toText(field(row, "uf_operator1"));
    const figure = toDecimal(field(row, "uf_figure1"));
    if (toText(field(row, "uf_level_to_desc")).toUpperCase() === "B") b = runFormula(toDecimal(second), operator, figure, 2);
    else a = runFormula(toDecimal(first), operator, figure, 2);
  }
  return b !== "" ? `${a} X ${b}` : a;
}

// ---------------------------------------------------------------------------------------
// ValidateEdit checks that read the database

export async function duplicateQuery(loader: Loader, request: EventRequest): Promise<string> {
  const { ctx, setupRow, programId } = await context(loader, request);
  const { session } = loader;
  if (!setupRow || !setupRow.duplicate_chk || toText(setupRow.duplicate_query) === "") return "";
  if (!request.masterGrid) {
    if (!(session.flags.partyAccode || programId === 49)) return "";
    const rows = await loader.readTable(await resolve(loader, setupRow.duplicate_query, ctx));
    if (!rows) return "";
    if (toText(Object.values(rows[0])[0]) === "" && session.licence === 46) return "Compulsory Mobile No...";
    return session.licence === 46 ? "Duplicate Mobile No..." : "Duplicate Short Found...";
  }
  if (session.flags.partyAccode) {
    const rows = await loader.readTable(await resolve(loader, setupRow.duplicate_query, ctx));
    if (!rows) return "";
    if (toText(Object.values(rows[0])[0]) === "" && session.licence === 46) return "Compulsory Mobile No...";
    return session.licence === 46 ? "Duplicate Mobile No..." : "Duplicate Short Found...";
  }
  if ((session.licence === 4 && setupRow.field_name === "A_SHORT") || setupRow.field_name === "A_SHORT") return "";
  const rows = await loader.readTable(await resolve(loader, setupRow.duplicate_query, ctx));
  return rows ? "Duplicate Master Found..." : "";
}

/** sys.checkstateid on MASTER_ACCOUNT: a state may not change once the account has GST postings. */
export async function checkStateChange(loader: Loader, request: EventRequest, originalState: string): Promise<string> {
  const { session } = loader;
  const typed = request.row.editorText;
  if (originalState === "" || originalState === "0") return "";
  const crossesHomeState = (originalState === session.coStateName && session.coStateName !== typed) || (originalState !== session.coStateName && session.coStateName === typed);
  if (!crossesHomeState) return "";
  const code = toInt(request.row.values.code);
  const ledger = await loader.readTable(`SELECT led_key FROM |sys.db|ledger WHERE doc_pos='A' AND doc_posting='P' AND book IN (8,9,10,11,12,13,14,15,16) AND code = $1 LIMIT 1`, [code]);
  if (ledger) return "State Change Not Allowed";
  const process = await loader.readTable(`SELECT process_key FROM |sys.db|process WHERE il_pos='A' AND code = $1 LIMIT 1`, [code]);
  return process ? "State Change Not Allowed" : "";
}

/** sys.checkgststateid: the state code (opt_short) the GSTIN must start with. */
export async function stateShortCode(loader: Loader, stateName: string): Promise<string> {
  const rows = await loader.readTable(`SELECT opt_short FROM |sys.db|idopt_master WHERE opt_desc = $1`, [stateName]);
  return rows ? toText(field(rows[0], "opt_short")) : "";
}

// ---------------------------------------------------------------------------------------
// Add grid: BeforeRowColChange and BeforeEdit values

/** defa_fixvalue with its placeholders resolved and quotes stripped. */
export async function defaFixValue(loader: Loader, request: EventRequest): Promise<string> {
  const { ctx, setupRow } = await context(loader, request);
  if (!setupRow || toText(setupRow.defa_fixvalue) === "") return "";
  return (await resolve(loader, setupRow.defa_fixvalue, { ...ctx, masterGrid: false })).split("'").join("");
}

/** defa_add_value_query (party a/c code or product code): the next code, padded to five. */
export async function defaAddValue(loader: Loader, request: EventRequest): Promise<string | null> {
  const { ctx, setupRow } = await context(loader, request);
  const { session } = loader;
  if (!setupRow || toText(setupRow.defa_add_value_query) === "" || !(session.flags.partyAccode || session.flags.productCode) || session.licence === 46) return null;
  const rows = await loader.readTable(await resolve(loader, setupRow.defa_add_value_query, { ...ctx, masterGrid: true }));
  return rows ? displayValue(Object.values(rows[0])[0]).padStart(5, " ") : null;
}

/** C1dg_MasterGrid_BeforeEdit: the uom_entry factor and the defa_formula calculation. */
export async function addGridBeforeEdit(loader: Loader, request: EventRequest, coreEntry: boolean): Promise<string | null> {
  const { ctx, setupRow } = await context(loader, request);
  if (!setupRow) return null;
  const input = (name: string) => request.row.values[lower(name)] ?? "";
  if (toText(setupRow.formula_for_table) === "uom_entry") {
    const rows = await loader.readTable(`SELECT * FROM |sys.db|uom_entry WHERE LTRIM(RTRIM(UPPER(ue_short))) = $1`, [toText(setupRow.formula_name).toUpperCase()]);
    if (rows && toText(field(rows[0], "ue_formula")) !== "") {
      let factor = 0;
      const level2 = input("level_2").trim();
      if (level2.toUpperCase().includes("X")) {
        const after = level2.slice(level2.toUpperCase().indexOf("X") + 2);
        const before = level2.slice(0, level2.toUpperCase().indexOf("X"));
        factor = toDecimal(after) * toDecimal(before);
      }
      if (input("level_3").trim() !== "") factor *= toDecimal(input("level_3"));
      if (input("level_4").trim() !== "") factor *= toDecimal(input("level_4")) / 1000;
      if (factor > 0) return String(Math.round((factor / 10000) * 10) / 10);
    }
  }
  if (toText(setupRow.defa_formula) !== "") {
    const rows = await loader.readTable(await resolve(loader, setupRow.defa_formula, { ...ctx, masterGrid: true }));
    if (!rows) return null;
    let formula = toText(Object.values(rows[0])[0]);
    let factor = 0;
    let result: string | null = null;
    while (formula.includes("{")) {
      const open = formula.indexOf("{");
      const operator = open > 0 ? formula.charAt(open - 1) : "";
      const name = formula.slice(open + 1, formula.indexOf("}", open));
      if (!(lower(name) in request.row.values)) break;
      const value = input(name).replace(/[^0-9.-]/g, "");
      formula = formula.split(`{${name}}`).join(value);
      if (factor === 0) factor = toDecimal(value);
      else if (coreEntry && formula.includes("*") && formula.includes("/") && !formula.includes("{")) {
        // DataTable.Compute on the finished expression, rounded to 2.
        if (/^[0-9.+\-*/() ]+$/.test(formula)) factor = Math.round(Number(Function(`"use strict"; return (${formula});`)()) * 100) / 100;
      } else {
        const amount = Math.round(toDecimal(value) * 10000) / 10000;
        if (operator === "+") factor += amount;
        else if (operator === "-") factor -= amount;
        else if (operator === "*") factor *= amount;
        else if (operator === "/" && amount !== 0) factor /= amount;
      }
      result = String(factor);
    }
    return result;
  }
  return null;
}

/** Plywood sizes (level9_ext 'PL'): the uom_formula conversion into the next description. */
export async function plywoodConversion(loader: Loader, request: EventRequest, levelField: string): Promise<string | null> {
  const levelMaster = (await loader.readTable(`SELECT * FROM |sys.db|level_master WHERE prod_group = $1`, [toInt(request.group.firstCombo.value)]))?.[0];
  if (!levelMaster) return null;
  const level = toInt(levelField.slice(-1));
  const from = toText(field(levelMaster, `trf_from${level}`));
  const to = toText(field(levelMaster, `trf_to${level}`));
  const ext = toText(field(levelMaster, `level${level}_ext`));
  const value = request.row.values[lower(levelField)] ?? "";
  if (toText(field(levelMaster, "level9_ext")).toUpperCase() === "PL" && from !== "") {
    const fixed = await loader.readTable(`SELECT * FROM |sys.db|uom_formula WHERE uf_identify='X' AND uf_uomfrom=$1 AND uf_uomto=$2 AND uf_fixfrom=$3`, [from, to, value]);
    if (fixed) return toText(field(fixed[0], "uf_fixto")) + ext;
    const formula = await loader.readTable(`SELECT * FROM |sys.db|uom_formula WHERE uf_identify='F' AND uf_uomfrom=$1 AND uf_uomto=$2`, [from, to]);
    if (formula) return value.trim() === "" ? "" : runFormula(toDecimal(value), toText(field(formula[0], "uf_operator1")), toDecimal(field(formula[0], "uf_figure1")), 2) + ext;
    return null;
  }
  return ext !== "" ? value + ext.trim() : null;
}

// ---------------------------------------------------------------------------------------
// Help grid (Fill_help_grid / Help_Design)

export type HelpGrid = Readonly<{ columns: readonly { key: string; caption: string; width: number; align: string; format: string }[]; rows: readonly Record<string, string>[]; frozen: number; total: string }>;

export async function helpGrid(loader: Loader, request: Omit<EventRequest, "row">): Promise<HelpGrid | null> {
  const prepared = await prepareProgram(loader, request.programName, request.group);
  const { session } = loader;
  let list = "";
  for (const row of prepared.updateBody) {
    const help = toText(row.help_query);
    if (help !== "" && !list.includes(help)) list += `${help},`;
  }
  list = list.replace(/,$/, "");
  if (list === "") return null;
  const helpRow = (await loader.readTable(`SELECT help_query, help_col_frozen FROM ${SETUP_SCHEMA}.help_table WHERE help_prog_id = $1`, [list]))?.[0];
  if (!helpRow) return null;
  let sql = toText(field(helpRow, "help_query"));
  // "sys.fn|HELP_PRODUCT|" names another help_table row, as smart_setup.fn_gethelpquery reads it.
  if (sql.toLowerCase().startsWith("sys.fn|")) {
    const target = sql.split("|")[1];
    sql = toText(field((await loader.readTable(`SELECT help_query FROM ${SETUP_SCHEMA}.help_table WHERE help_prog_id = $1`, [target]))?.[0], "help_query")) || sql;
  }
  sql = replaceSessionValues(sql, session);
  if (list.toUpperCase() === "HELP_ADDONSUB") sql = sql.toUpperCase().replace("ORDER BY", "and addon.fiel_key=|sys.firstcombovalue| ORDER BY");
  sql = await replaceSysValues(sql, loadContext(session, prepared.programId, request.group), sysValueLookups(loader.client, session.companySchema));
  sql = sql.split("|sys.help_stock_3|,").join("");
  if (prepared.programId === 8 && [9, 89].includes(session.licence) && request.group.firstCombo.value === "81") sql = sql.toUpperCase().replace("ORDER BY PRODUCT.PROD_SHORT", "order by RIGHT(repeat(' ',10)||product.level_1,10),product.prod_short");
  if (prepared.programId === 8 && session.licence === 45) sql = sql.toUpperCase().replace("ORDER BY PRODUCT.PROD_SHORT", "order by product.prod_desc");
  const rows = await loader.readTable(sql);
  if (!rows) return { columns: [], rows: [], frozen: 0, total: "" };
  let properties = await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.help_properties WHERE help_for = 'X' AND help_name = $1`, [list]);
  if (!properties) properties = await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.help_properties WHERE help_for = 'M' AND help_name = $1`, [list]);
  const keys = Object.keys(rows[0]);
  const columns = (properties ?? []).flatMap((property: Row) => {
    const key = keys.find((candidate) => candidate.toLowerCase() === toText(field(property, "col_field")).toLowerCase());
    if (!key || field(property, "col_visible") !== true) return [];
    const type = toText(field(property, "col_type"));
    const decimals = list === "HELP_PRODUCT" && session.licence === 51 ? 0 : toInt(field(property, "col_decimal"));
    return [{
      key,
      caption: toText(field(property, "col_heading")) || key,
      width: toInt(field(property, "col_width")),
      align: toText(field(property, "col_alignment")).toUpperCase() || "L",
      format: type === "C" ? "N2" : type === "D" ? "dd/MM/yyyy" : type === "N" ? (decimals > 0 && decimals <= 4 ? `N${decimals}` : "N") : "",
    }];
  });
  return {
    columns,
    rows: rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, displayValue(value)]))),
    frozen: toInt(field(helpRow, "help_col_frozen")),
    total: `Total Help Record : ${rows.length}`,
  };
}

// ---------------------------------------------------------------------------------------
// Selected_RowDelete's database checks

export async function deleteBlocked(loader: Loader, programId: number, group: GroupState, record: Readonly<Record<string, string>>, rowIndex: number): Promise<string> {
  const { session } = loader;
  if (!(programId === 2 && session.licence === 59)) return "";
  const subCode = toInt(record.sub_code);
  if (group.firstCombo.text.toUpperCase() === "COLOR") {
    if (await loader.readTable(`SELECT 1 FROM |sys.db|party_product WHERE color_id = $1 LIMIT 1`, [subCode])) return `Entry Found For Row No.${rowIndex}, So Deletion of Master Not allowed...`;
    if (await loader.readTable(`SELECT 1 FROM |sys.db|master_link WHERE ml_color_id = $1 LIMIT 1`, [subCode])) return `Entry Found For Row No.${rowIndex}, So Deletion of Master Not allowed...`;
    return "";
  }
  const linked = await loader.readTable(
    `SELECT 1 FROM |sys.db|master_link WHERE ml_rej_id1=$1 OR ml_rej_id2=$1 OR ml_rej_id3=$1 OR ml_rej_id4=$1 OR ml_rej_id5=$1 OR ml_machine_id=$1 OR shift_id=$1 OR opteror_id=$1 OR co_part_id1=$1 OR co_part_id2=$1 LIMIT 1`,
    [subCode],
  );
  return linked ? `Entry Found For Row No.${rowIndex}, So Deletion of Master Not allowed...` : "";
}

/** The accounting year's first day, which the space key puts into a blank date. */
export const yearStart = (loader: Loader) => formatDesktopDate(loader.session.tarikh1);

export { isNumeric };
