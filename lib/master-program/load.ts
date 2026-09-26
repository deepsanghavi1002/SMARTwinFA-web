import type { Client } from "pg";
import { parseMoney, PROGRAM_BODY_COLUMNS, publicSetup, toSetup } from "../master-rules";
import type { ProgramBodySetup } from "../master-rules";
import { replaceSysValues } from "../sys-values";
import type { SysValueContext } from "../sys-values";
import { sysValueLookups } from "../sys-values-db";
import { applyPermission, getPermission, toInt, toText } from "./legacy";
import { columnName, replaceSessionValues, setDataBaseName } from "./sql";
import { GST_START_DATE, readRights, SETUP_SCHEMA } from "./session";
import type { MasterSession } from "./session";
import type { AddRow, ComboKind, ComboOption, GroupLoad, GroupState, ProgramDefinition, UpdateColumn, UpdateRecord } from "./types";

/**
 * Master_ProgramGrid's loading half: Form Load, Cmb_Master_GroupFld_Leave, Fill_UpdateGrid,
 * Lib_GlobalFunctions.Setting_GridCol, Hide_ProductLevel and Addon_RecordAdd_in_Grid.
 *
 * Every query goes through ReadTable's contract: a failing or empty query yields null and
 * the load carries on, exactly as the desktop's DbConnectionManager.Query did. Failures
 * are collected so the screen can show them instead of silently hiding a column.
 */

/** Programs whose first combo is followed by cmb_Master_NewUpd. */
export const SECOND_COMBO_PROGRAMS = [21, 22, 23, 26, 28, 29, 32, 36, 42, 49, 50, 51] as const;
const hasSecondCombo = (programId: number) => (SECOND_COMBO_PROGRAMS as readonly number[]).includes(programId);

type Row = Record<string, unknown>;

export class Loader {
  readonly warnings: string[] = [];
  private savepoint = 0;

  constructor(readonly client: Client, readonly session: MasterSession) {
    // money (OID 790) arrives as locale text such as "? 1,250.00"; the grids want the number.
    client.setTypeParser(790, "text", (value: string) => parseMoney(value));
  }

  /** Master_ProgramGrid.ReadTable: |sys.db| swapped, null for no rows or an error. */
  async readTable(sql: string, params: unknown[] = []): Promise<Row[] | null> {
    const text = setDataBaseName(sql, this.session);
    if (text.trim() === "") return null;
    const name = `rt${++this.savepoint}`;
    await this.client.query(`SAVEPOINT ${name}`);
    try {
      const result = await this.client.query(text, params);
      await this.client.query(`RELEASE SAVEPOINT ${name}`);
      return result.rows.length > 0 ? result.rows : null;
    } catch (error) {
      await this.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      this.warnings.push(`${error instanceof Error ? error.message : String(error)} :: ${text.slice(0, 300)}`);
      return null;
    }
  }

  /** The column of a row whatever case PostgreSQL gave it. */
  static field(row: Row | undefined, name: string): unknown {
    if (!row) return undefined;
    if (name in row) return row[name];
    const lower = name.toLowerCase();
    const key = Object.keys(row).find((candidate) => candidate.toLowerCase() === lower);
    return key === undefined ? undefined : row[key];
  }
}

const field = Loader.field;

/** How a value reads once it is in a grid cell. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const hasTime = value.getHours() + value.getMinutes() + value.getSeconds() > 0;
    const date = `${String(value.getDate()).padStart(2, "0")}/${months[value.getMonth()]}/${value.getFullYear()}`;
    return hasTime ? `${date} ${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}:${String(value.getSeconds()).padStart(2, "0")}` : date;
  }
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value);
}

/** Func_InsertBlankRow: "(blank)" with no value, first. */
const withBlank = (options: ComboOption[]) => [{ text: "(blank)", value: "" }, ...options];

function optionsFrom(rows: Row[] | null, display?: string, value?: string): ComboOption[] {
  if (!rows) return [];
  return rows.map((row) => {
    const keys = Object.keys(row);
    const text = display ? field(row, display) : row[keys[0]];
    const id = value ? field(row, value) : row[keys[1]];
    return { text: displayValue(text), value: displayValue(id) };
  });
}

async function programTop(loader: Loader, programName: string): Promise<Row> {
  const rows = await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.program_top WHERE BTRIM(program_name) = $1`, [programName]);
  if (!rows) throw new Error(`Program ${programName} is not set up in smart_setup.program_top`);
  return rows[0];
}

const bodyColumns = Object.keys(PROGRAM_BODY_COLUMNS).map((column) => `b.${column}`).join(", ");

/** ST_SP_READ_UPDATE_PROGRAMBODY / ST_SP_READ_ADD_PROGRAMBODY / ST_SP_READ_FIRSTCOMBO, read straight from the table. */
async function programBody(loader: Loader, programName: string, which: "update" | "add" | "first"): Promise<ProgramBodySetup[]> {
  const where = which === "update"
    ? "b.update_active AND b.field_update_order > 0 ORDER BY b.field_update_order, b.program_body_key"
    : which === "add"
      ? "b.add_active AND b.field_add_order > 0 ORDER BY b.field_add_order, b.program_body_key"
      : "b.combo_value = '1' AND (b.add_active OR b.update_active) ORDER BY b.program_body_key";
  const rows = await loader.readTable(
    `SELECT ${bodyColumns} FROM ${SETUP_SCHEMA}.program_body b
      WHERE b.program_top_id = (SELECT program_top_key FROM ${SETUP_SCHEMA}.program_top WHERE BTRIM(program_name) = $1 LIMIT 1)
        AND ${where}`,
    [programName],
  );
  return (rows ?? []).map(toSetup);
}

/** The STATUS_DISPLAY the read procedures compute, which the grid shows in the status bar. */
export function statusDisplay(s: ProgramBodySetup): string {
  let out = "";
  if (s.combo_value.trim() !== "") out += "";
  else if ((s.field_type === "" || s.force_inputtype === "") && s.decimal_points === 0) out += "Number / ";
  else if (s.field_type === "I") out += "Integer / ";
  else if (s.field_type === "D") out += "Date / ";
  if ((s.field_type === "T" || s.field_type === "") && s.field_length_max === 0) out += `Length-${s.field_length} / `;
  if (s.field_length_min > 0) out += `Min.-${s.field_length_min} / `;
  if (s.field_length_max > 0) out += `Max.-${s.field_length_max} / `;
  if (s.field_carry_name !== "") out += "Carry / ";
  if (!(s.field_type !== "T" || s.force_inputtype === "")) {
    out += s.style_case === "U" ? "Upper / " : s.style_case === "L" ? "Lower / " : s.style_case === "C" ? "Camel / " : "Any Case / ";
  }
  if (!s.allow_space && s.field_type === "T") out += "No Space / ";
  if (s.date_range_from) out += `Range:${s.date_range_from.slice(0, 10).replace(/-/g, "")} to ${(s.date_range_upto ?? "").slice(0, 10).replace(/-/g, "")} / `;
  if (s.number_range_from !== 0) out += `Range:${s.number_range_from} to ${s.number_range_upto} / `;
  if (s.number_positiveonly) out += "Positive / ";
  if (s.decimal_points > 0) out += `Decimal:${s.decimal_points} / `;
  if (s.value_notallowed !== "") out += `NoChrs:${s.value_notallowed} / `;
  if (s.value_allowed !== "") out += `Chrs:${s.value_allowed} / `;
  return out;
}

/** A setup row the loader may still change, as the desktop changes its DataTable rows. */
type BodyRow = { -readonly [K in keyof ProgramBodySetup]: ProgramBodySetup[K] } & { program_top_id: number; deleted?: boolean; addon?: boolean };

const editable = (rows: ProgramBodySetup[]): BodyRow[] => rows.map((row) => ({ ...row }));

// ---------------------------------------------------------------------------------------
// Form Load

export async function loadProgram(loader: Loader, programName: string, menuShortName: string): Promise<ProgramDefinition> {
  const { session } = loader;
  const top = await programTop(loader, programName);
  const first = (await programBody(loader, programName, "first"))[0];
  let programId = toInt(field(top, "program_top_key"));
  let firstCombo: ProgramDefinition["firstCombo"] = null;

  if (first && first.head_label.trim().length > 0) {
    programId = first.program_top_id;
    const editableCombo = [9, 21, 35, 44, 76].includes(session.licence) || [21, 26, 31, 32, 42].includes(programId);
    let options: ComboOption[] = [];
    let bound = true;
    if (first.combo_query.trim() !== "") {
      const queryRow = (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.query_table WHERE query_prog_id = $1`, [first.combo_query]))?.[0];
      if (queryRow) {
        const sql = toText(field(queryRow, "query_string")).split("|sys.complic|").join(String(session.licence)).split("|sys.progid|").join(String(programId));
        const rows = await loader.readTable(sql);
        if (rows) {
          options = optionsFrom(rows, toText(field(queryRow, "combo_displaymember")), toText(field(queryRow, "combo_valuemember")));
          if (first.combo_with_blank) options = withBlank(options);
        } else if (first.combo_with_blank) {
          // Func_InsertBlankRow(null) builds a one-row name/key table.
          options = withBlank([]);
        }
      }
    } else if (first.combo_fixvalueid.trim() !== "") {
      options = optionsFrom(await loader.readTable(`SELECT combo_desc, combo_itemvalue FROM ${SETUP_SCHEMA}.combo_fixvalue WHERE combo_prog_id = $1`, [first.combo_fixvalueid]), "combo_desc", "combo_itemvalue");
    } else if (first.combo_list.trim() !== "") {
      bound = false;
      let list = first.combo_list;
      if (programId === 25) {
        list = ({ AD: "ADMIN|USER|EXECUTIVE|AUDITOR|END USER", US: "USER", EX: "EXECUTIVE", AU: "AUDITOR", EN: "END USER" } as Record<string, string>)[session.userType] ?? "";
      }
      options = list.split("|").map((text) => ({ text, value: text }));
    }
    firstCombo = { label: first.head_label, options, bound, editable: editableCombo };
  }

  const rights = await readRights(loader.client, session, `Menu-${menuShortName}`);
  return {
    programId,
    programName,
    heading: toText(field(top, "screen_heading")),
    menuShortName,
    firstCombo,
    usesSecondCombo: hasSecondCombo(programId),
    rights: { add: rights.add, edit: rights.edit, delete: rights.delete, restricted: rights.restricted },
    needsModulePassword: rights.modulePassword !== "",
    licence: session.licence,
    imageReq: session.flags.imageReq,
  };
}

// ---------------------------------------------------------------------------------------
// Func_ReplaceSysVal_CtrlValue context for loading, where no cell is under the cursor yet.

export function loadContext(session: MasterSession, programId: number, group: GroupState, extra: Partial<SysValueContext> = {}): SysValueContext {
  return {
    masterGrid: false,
    companySchema: session.companySchema,
    firstCombo: { text: group.firstCombo.text, value: group.firstCombo.value },
    secondCombo: group.secondCombo ?? { text: "(blank)", value: "" },
    programId,
    userNo: session.userNo,
    userType: session.userType,
    companyKey: session.companyKey,
    // Row 0 of the Update grid is its caption row, which is never blank, so |sys.pkv|
    // during a load replaces with that text rather than switching to the fallback query.
    gridRow: { cells: ["", "", "0", "0"], byName: {} },
    masterRow: { fieldInput: "", fieldComboValue: "", fieldSaveNoChr: 0, statusAgainstFld: "" },
    updateCell: { text: "", backupValue: "", propertyFieldInput: "", fieldSaveNoChr: 0, code: "0" },
    editorText: "",
    keyFieldName: "",
    ...extra,
  };
}

async function ctrl(loader: Loader, source: string, context: SysValueContext): Promise<string> {
  try {
    return await replaceSysValues(source, context, sysValueLookups(loader.client, loader.session.companySchema));
  } catch (error) {
    loader.warnings.push(`${error instanceof Error ? error.message : String(error)} :: ${source.slice(0, 200)}`);
    return source;
  }
}

// ---------------------------------------------------------------------------------------
// Cmb_Master_GroupFld_Leave: the second combo

async function secondComboOptions(loader: Loader, programId: number, group: GroupState): Promise<ComboOption[]> {
  const firstRow = (await programBody(loader, await programNameById(loader, programId), "first"))[0];
  const queryRow = firstRow ? (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.query_table WHERE query_prog_id = $1`, [firstRow.combo_query]))?.[0] : undefined;
  const comboLeave = toText(field(queryRow, "other_query_string"));
  const value = group.firstCombo.value;
  let temp = comboLeave;
  let temp1 = comboLeave;
  if (programId === 28) temp = temp1.split("and pr_aonsub=|sys.firstcombovalue| ").join("");
  else if (programId === 36) temp = temp1.split("and pr_accode=|sys.firstcombovalue| ").join("");
  else if (programId === 26) temp = temp1.split("|sys.firstcombovalue|").join(value);
  else temp = temp.split("|sys.firstcombovalue|").join(value);
  if (programId === 28) temp1 = temp1.split("and pr_aonsub=|sys.firstcombovalue| ").join("");
  else if (programId === 36) temp1 = temp1.split("and pr_accode=|sys.firstcombovalue| ").join("");
  else if (programId === 26) temp1 = temp1.split("|sys.firstcombovalue|").join(value);

  const context = loadContext(loader.session, programId, group, { masterGrid: true });
  let rows: Row[] | null;
  if (programId === 49) {
    const moulds = await loader.readTable(`SELECT no_of_moulds FROM |sys.db|sop_mould WHERE sop_mould_key = $1`, [toInt(value)]);
    const count = toInt(field(moulds?.[0], "no_of_moulds"));
    if (count >= 1 && count <= 15) {
      temp = Array.from({ length: count }, (_, index) => (index === 0 ? "SELECT 'SHEET1' AS date_range, 1 AS pr_key" : `SELECT 'SHEET${index + 1}', ${index + 1}`)).join(" UNION ") + " ORDER BY pr_key";
    }
    rows = await loader.readTable(temp);
    // 49 never inserts a blank row.
    return optionsFrom(rows, "date_range", "pr_key");
  }
  if (programId === 50) temp = await ctrl(loader, temp, context);
  rows = await loader.readTable(temp);
  if (rows) {
    let options = optionsFrom(rows, "date_range", programId === 50 ? "pl_key" : "pr_key");
    if (programId !== 28) options = withBlank(options);
    return options;
  }
  if ([26, 28, 36, 49, 50].includes(programId)) {
    if (programId === 28) temp1 = temp1.split("and pr_aonsub=|sys.firstcombovalue| ").join("");
    else if (programId === 50) temp1 = temp1.split("and pr_aonfiel1=|sys.firstcombovalue| ").join("");
    else temp1 = temp1.split("and pr_accode=|sys.firstcombovalue| ").join("");
    if (programId === 50) temp1 = await ctrl(loader, temp1, context);
    const other = await loader.readTable(temp1);
    if (other) {
      let options = optionsFrom(other, "date_range", "pr_key");
      // InsertBlankRow adds to the same table the combo is then bound to.
      if (programId !== 28) options = withBlank(options);
      return options;
    }
    return withBlank([]);
  }
  return withBlank([]);
}

async function programNameById(loader: Loader, programId: number): Promise<string> {
  const rows = await loader.readTable(`SELECT BTRIM(program_name) AS program_name FROM ${SETUP_SCHEMA}.program_top WHERE program_top_key = $1`, [programId]);
  return toText(field(rows?.[0], "program_name"));
}

// ---------------------------------------------------------------------------------------
// Hide_ProductLevel and the hide lists that feed it

async function levelMasterRow(loader: Loader, group: GroupState): Promise<Row | null> {
  if (toText(group.firstCombo.value) === "" || !/^-?\d+$/.test(group.firstCombo.value)) return null;
  return (await loader.readTable(`SELECT * FROM |sys.db|level_master WHERE prod_group = $1`, [toInt(group.firstCombo.value)]))?.[0] ?? null;
}

type HideTarget = "update" | "add";

/** The Hide_GridColum list Fill_UpdateGrid and Cmb_Master_GroupFld_Leave build. */
async function hideList(loader: Loader, programName: string, programId: number, group: GroupState, target: HideTarget, levelMaster: Row | null): Promise<{ list: string; levelNumber: number }> {
  const { session } = loader;
  const text = group.firstCombo.text;
  const gstYear = session.coGstReq || session.tarikh1 >= GST_START_DATE;
  let list = "";
  let levelNumber = 9;
  if (target === "update" && programName === "MASTER_PARTY_PRODUCT_ADDON") list += "-PANEL_RATE,-PANEL_DIS,";
  if (programName === "MASTER_PRODUCT") {
    if (levelMaster) {
      levelNumber = toInt(field(levelMaster, "div_maxlvl"));
      if (levelNumber > 0) list += "-LEVEL,";
    }
    if (!session.flags.colMrpActive) list += "-MRP,";
    if (gstYear) list += "-VAT CODE,";
    if (session.licence !== 30) list += "-RG PRODUCT,";
    if (![30, 28, 51, 68, 75].includes(session.licence) && !session.flags.productChildParent) list += "-TX PRODUCT,";
    if (session.licence === 30 && ["RG PRODUCT", "TX PRODUCT", "RAW PRODUCT"].includes(text)) list += "-RG PRODUCT,";
    if (session.licence === 30 && ["RG PRODUCT", "AC PRODUCT", "TX PRODUCT", "RAW PRODUCT"].includes(text)) list += "-TX PRODUCT,";
  }
  if (!session.flags.imageReq) list += "-IMAGE,";
  if (!session.flags.barcodeEntry && !session.flags.barcodeReport) list += "-BARCODE,";
  if (target === "update" && (programName === "MASTER_PRICELIST" || programName === "MASTER_ADDON_PRICELIST")) {
    if (!session.flags.colMrpActive && session.licence !== 21) list += "-MRP,";
  }
  if (target === "add" && !session.flags.productAccountPosting && programId === 8) list += "-ACCOUNT POSTING,";
  if (programName === "MASTER_ACCOUNT" && gstYear) list += "-VAT NO.,-TRANSACTION CODE,-C.S.T NO.,-Other State,-TAX CODE,";
  if (programName === "MASTER_ACCOUNT" && !session.coGstReq) list += "-GST NO.,-STATE,-REGISTER,";
  if (target === "update" && !session.flags.productAccountPosting && programId === 8) list += "-ACCOUNT POSTING,";
  return { list, levelNumber };
}

/**
 * Whether an Update grid column is shown: update_grid_visible, then VISIBLE_AGAINST_FLD /
 * HIDE_FOR_VALUE (read from the grid's first record, or the business nature), then
 * HIDE_BY_FIRSTCMBVAL. The grid builds its columns with it and the save's compulsory check
 * skips a column it hides, as the desktop's check skips a column that is not on screen.
 */
export function updateColumnShown(row: BodyRow, source: Parameters<typeof getPermission>[0], businessNature: string): boolean {
  let visible = row.update_grid_visible;
  if (row.visible_against_fld.trim() !== "") {
    if (row.visible_against_fld.includes("|sys.Business_Nature|")) {
      const hideFor = toText(row.hide_for_value);
      if (hideFor.startsWith("!")) {
        if (businessNature.toLowerCase() !== hideFor.toLowerCase().slice(1)) visible = false;
      } else if (businessNature.toLowerCase() === hideFor.toLowerCase()) {
        visible = false;
      }
    } else if (row.hide_for_value !== "") {
      const effect = applyPermission(getPermission(source, "V", row.visible_against_fld, row.hide_for_value.trim(), false, false));
      if (effect.visible !== undefined) visible = effect.visible;
    }
  }
  if (row.hide_by_firstcmbval !== "" && visible) {
    const effect = applyPermission(getPermission(source, "V", "first_combo", row.hide_by_firstcmbval.trim(), false, true));
    if (effect.visible !== undefined) visible = effect.visible;
  }
  return visible;
}

/** Master_ProgramGrid.Hide_ProductLevel. Like the C#, the first row of the table is never looked at. */
export function hideProductLevel(rows: BodyRow[], levelNumber: number, list: string, levelMaster: Row | null, licence: number, productCode: boolean): void {
  const heading = (level: number) => toText(field(levelMaster ?? undefined, `level${level}_hd`));
  const setHeads = (row: BodyRow, text: string) => { row.head_label = text; row.head_grid = text; row.head_short = text; row.head_report = text; };
  const hide = (row: BodyRow) => { row.update_grid_visible = false; row.add_grid_visible = false; };
  const clearRules = (row: BodyRow) => { hide(row); row.hide_by_firstcmbval = ""; row.enable_for = ""; row.status_against_fld = ""; };

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.deleted) continue;
    const name = row.field_name.toUpperCase().trim();
    if (name.startsWith("LEVEL_")) {
      const level = toInt(name.charAt(6));
      if (level > levelNumber) {
        hide(row);
        if (productCode) row.update_grid_editable = false;
      }
      if (levelMaster && level >= 1 && level <= 9) {
        // LEVEL4_HD is the one the C# does not trim.
        setHeads(row, `${level === 4 ? toText(field(levelMaster, "level4_hd")) : heading(level)} Code`);
        if (level === 1 && productCode) row.update_grid_editable = false;
      }
    } else if (name.startsWith("DESC_")) {
      const level = toInt(name.charAt(5));
      if (level > levelNumber) hide(row);
      if (levelMaster && level >= 1 && level <= 8) setHeads(row, `${heading(level)} Desc`);
    } else if (list.includes("-MRP,") && ["PR_MASTERRATE", "PL_MRP", "PL_MUOM"].includes(name)) hide(row);
    else if (list.includes("-LEAD,") && name === "LEAD_DAYS" && licence !== 21) hide(row);
    else if ((list.includes("-PANEL_RATE,") || list.includes("-PANEL_DIS,")) && ["PR_PRPANELRATE", "PR_PRPANELDIS"].includes(name) && licence !== 5 && licence !== 7) hide(row);
    else if (list.includes("-PR_PRFRATE,") && name === "PR_PRFRATE" && licence !== 5 && licence !== 7) hide(row);
    else if (list.includes("-IMAGE,") && name === "IMAGE_FILE_NAME") hide(row);
    else if (list.includes("-BARCODE,") && name === "BAR_CODE") hide(row);
    else if (list.includes("-RG PRODUCT,") && name === "RGPROD_ID") { hide(row); row.field_save_update = false; }
    else if (list.includes("-TX PRODUCT,") && name === "TXPROD_ID") { hide(row); row.field_save_update = false; }
    else if (list.includes("-VAT NO.,") && name === "LST_NO") clearRules(row);
    else if (list.includes("-VAT CODE,") && name === "VAT_CODE") clearRules(row);
    else if (list.includes("-TRANSACTION CODE,") && name === "TRANSACTION_CODE") clearRules(row);
    else if (list.includes("-GST NO.,") && name === "GST_NO") clearRules(row);
    else if (list.includes("-STATE,") && name === "STATE_ID") clearRules(row);
    else if (list.includes("-REGISTER,") && name === "P_REG") clearRules(row);
    else if (list.includes("-C.S.T NO.,") && name === "CST_NO") clearRules(row);
    else if (list.includes("-TAX CODE,") && name === "TAX_CODE") clearRules(row);
    else if (list.includes("-Other State,") && name === "OTHER_STATE") clearRules(row);
    else if (list.includes("-ACCOUNT POSTING,") && name === "S_CODE") clearRules(row);
  }
}

// ---------------------------------------------------------------------------------------
// Addon_RecordAdd_in_Grid

type AddonState = { body: ProgramBodySetup[] | null; fields: Row[] | null; comboSerial: number };

async function addonRecordAdd(loader: Loader, rows: BodyRow[], addon: AddonState, context: SysValueContext): Promise<void> {
  if (!addon.body || !addon.fields) return;
  for (const addonField of addon.fields) {
    for (const template of addon.body) {
      const type = toText(field(addonField, "fiel_type"));
      const save = toText(field(addonField, "fiel_save"));
      const description = toText(field(addonField, "fiel_desc"));
      const compulsory = toText(field(addonField, "fiel_entry")) === "C";
      const importRow = () => {
        const row: BodyRow = { ...template };
        rows.push(row);
        const index = rows.length - 1;
        row.field_add_order = index + 1;
        row.field_update_order = index + 1;
        row.add_active = true;
        row.update_active = true;
        row.head_label = description; row.head_grid = description; row.head_report = description; row.head_short = description;
        row.value_compulsory = compulsory;
        row.addon = true;
        return row;
      };
      if (type === "I" && template.field_name === "_addon_input") {
        const row = importRow();
        row.field_name = `input_${save}`;
        switch (toText(field(addonField, "fiel_mbal"))) {
          case "D":
            row.field_type = "D"; row.date_with_chkbox = true; row.update_grid_align = "L"; row.combo_value = "N";
            // The desktop's convert(datetime, ..., 101/103) exists to turn text into a date on SQL Server.
            row.field_restore = `input_${save} as input_${save}`;
            break;
          case "N": row.field_type = "N"; row.update_grid_align = "R"; break;
          default: row.field_type = "T"; row.update_grid_align = "L";
        }
      } else if (type === "F" && template.field_name === "_addon_flag") {
        const row = importRow();
        row.field_name = `flag_${save}`;
        row.field_savenochr = 1;
        row.field_restore = `(case when ${row.field_name}='Y' then 'Yes' when ${row.field_name}='N' then 'No' end) as ${row.field_name}`;
        row.combo_value = "L";
        row.combo_list = "Yes|No";
      } else if (type === "M" && template.field_name === "_addon_combo") {
        addon.comboSerial += 1;
        const row = importRow();
        row.field_name = `txt_${save}`;
        row.field_restore = `asub${addon.comboSerial}.sub_name as ${row.field_name}`;
        row.combo_value = "X";
        if (toText(row.combo_fixquery) !== "") {
          let sql = replaceSessionValues(row.combo_fixquery.trim(), loader.session);
          sql = await ctrl(loader, sql, { ...context, masterGrid: false });
          if (toText(row.combo_fixwhere) !== "") {
            sql += ` where ${replaceSessionValues(row.combo_fixwhere.trim(), loader.session)}`;
            sql = await ctrl(loader, sql, { ...context, masterGrid: false });
            if (sql.toLowerCase().includes("|sys.pk_addon_fld|")) sql = sql.split("|sys.pk_addon_fld|").join(toText(field(addonField, "fiel_key")));
          }
          if (toText(row.combo_fixorder) !== "") {
            sql += ` order by ${replaceSessionValues(row.combo_fixorder.trim(), loader.session)}`;
            sql = await ctrl(loader, sql, { ...context, masterGrid: false });
          }
          row.combo_fixquery = sql;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------
// Combo options (Setting_GridCol for the Update grid, Cmb_Master_GroupFld_Leave for Add)

async function comboOptions(loader: Loader, row: ProgramBodySetup, group: GroupState, target: HideTarget): Promise<{ options: ComboOption[] | null; disable: boolean; firstValue: ComboOption | null }> {
  const kind = row.combo_value.trim();
  const blank = (options: ComboOption[]) => (row.combo_with_blank ? withBlank(options) : options);
  switch (kind) {
    case "F": {
      if (row.combo_fixvalueid.trim() === "") return { options: null, disable: false, firstValue: null };
      const rows = await loader.readTable(`SELECT combo_desc, combo_itemvalue FROM ${SETUP_SCHEMA}.combo_fixvalue WHERE combo_prog_id = $1`, [row.combo_fixvalueid]);
      return { options: rows ? blank(optionsFrom(rows, "combo_desc", "combo_itemvalue")) : null, disable: false, firstValue: null };
    }
    case "L":
      return { options: row.combo_list.trim() === "" ? null : row.combo_list.split("|").map((text) => ({ text, value: text })), disable: false, firstValue: null };
    case "C": {
      if (row.combo_byfirstcombo.trim() === "") return { options: null, disable: false, firstValue: null };
      const rows = target === "update"
        ? await loader.readTable(`SELECT combo_list FROM ${SETUP_SCHEMA}.combo_runvalue WHERE combo_run_id = $1 AND UPPER(combo_run_value) = $2`, [row.combo_byfirstcombo, group.firstCombo.text.toUpperCase()])
        : await loader.readTable(`SELECT combo_list FROM ${SETUP_SCHEMA}.combo_runvalue WHERE combo_run_id = $1`, [row.combo_byfirstcombo]);
      if (!rows) return { options: null, disable: false, firstValue: null };
      const list = toText(field(rows[0], "combo_list"));
      return list.length > 0 ? { options: list.split("|").map((text) => ({ text, value: text })), disable: false, firstValue: null } : { options: null, disable: true, firstValue: null };
    }
    case "X": {
      if (row.combo_fixquery.trim() === "") return { options: null, disable: false, firstValue: null };
      let sql = replaceSessionValues(row.combo_fixquery, loader.session).split("|sys.entry_id|").join("0");
      if (target === "add") sql = await ctrl(loader, sql, loadContext(loader.session, row.program_top_id, group, { masterGrid: true }));
      const rows = await loader.readTable(sql);
      if (!rows) return { options: null, disable: false, firstValue: null };
      const options = blank(optionsFrom(rows));
      return { options, disable: false, firstValue: options[0] ?? null };
    }
    case "Q": {
      if (row.combo_query.trim() === "") return { options: null, disable: false, firstValue: null };
      const queryRow = (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.query_table WHERE query_prog_id = $1`, [row.combo_query]))?.[0];
      if (!queryRow) return { options: null, disable: false, firstValue: null };
      const sql = toText(field(queryRow, "query_string")).split("|sys.user_no|").join(String(loader.session.userNo)).split("|sys.entry_id|").join("0");
      const rows = await loader.readTable(sql);
      if (!rows) return { options: null, disable: false, firstValue: null };
      const options = blank(optionsFrom(rows, toText(field(queryRow, "combo_displaymember")), toText(field(queryRow, "combo_valuemember"))));
      return { options, disable: false, firstValue: options[0] ?? null };
    }
    case "V": {
      if (row.combo_fixquery.trim() === "") return { options: null, disable: false, firstValue: null };
      const sql = replaceSessionValues(row.combo_fixquery, loader.session).split("|sys.firstcombovalue|").join(group.firstCombo.value).split("|sys.entry_id|").join("0");
      const first = await loader.readTable(sql);
      if (!first) return { options: null, disable: false, firstValue: null };
      const queryRow = (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.query_table WHERE query_prog_id = $1`, [row.combo_byfirstcombo]))?.[0];
      if (!queryRow) return { options: null, disable: false, firstValue: null };
      const value = displayValue(Object.values(first[0])[0]);
      const rows = await loader.readTable(toText(field(queryRow, "query_string")).split("|sys.queryvalue|").join(value).split("|sys.entry_id|").join("0"));
      if (!rows) return { options: null, disable: false, firstValue: null };
      return { options: blank(optionsFrom(rows)), disable: false, firstValue: null };
    }
    default:
      return { options: null, disable: false, firstValue: null };
  }
}

const SOP_YELLOW = new Set([
  "Parent Product", "Child Product Name", "Discussion Date", "No of Moulds", "Steel Parts Remarks", "Assembly Fixtures Remarks",
  "Printing Fixtures Remarks", "Gaskets Remarks", "Colour Trial Remarks", "Metalizing Fixture Remarks", "Foils/ Printings/Remarks",
  "Art Work Remarks", "Box Remarks", "Remark  for product", "Remark  for product launching", "Target Status",
  "Standard Days for Product hand over", "Product Type", "Season", "Mould Material - Required", "No. Of Cavity - Required",
  "Product Design approval Date (PD)", "Mould design approval date ( MD )", "Trial 1 Date", "Trial 2 Date", "Trial 3 Date",
  "Mould  Actual Dispatch Date", "Standard Days for mould delivery", "Mould Remark", "Expected Trial Date From Vendor", "Mould Cost", "Vendor",
]);

/** The SOP masters (48, 49) paint these headings yellow. */
export const isSopHighlighted = (programId: number, headLabel: string) => (programId === 48 || programId === 49) && SOP_YELLOW.has(headLabel);

// ---------------------------------------------------------------------------------------
// smart_setup_change: the per-client override of program_body

async function applySetupChange(loader: Loader, programId: number, rows: BodyRow[], which: HideTarget): Promise<{ newRows: ProgramBodySetup[]; changed: boolean }> {
  if ([21, 35, 59].includes(loader.session.licence)) return { newRows: [], changed: false };
  const exists = await loader.readTable("SELECT 1 FROM information_schema.schemata WHERE schema_name = 'smart_setup_change'");
  if (!exists) return { newRows: [], changed: false };
  let changed = false;
  const overrides = await loader.readTable(`SELECT * FROM smart_setup_change.program_body WHERE program_top_id = $1 AND program_body_key <> 999999 ORDER BY program_body_key`, [programId]);
  for (const override of overrides ?? []) {
    for (const row of rows) {
      if (row.deleted || row.program_body_key !== toInt(field(override, "program_body_key"))) continue;
      for (const [column, value] of Object.entries(override)) {
        if (column === "program_body_key" || toText(value) === "" || !(column in PROGRAM_BODY_COLUMNS)) continue;
        const target = row as unknown as Record<string, unknown>;
        if (value instanceof Date) target[column] = value.getFullYear() === 1901 ? null : value.toISOString();
        else if (typeof value === "number") target[column] = String(value).trim() === "-9" ? 0 : value;
        else if (typeof value === "string") target[column] = value.trim() === "<" ? "" : value;
        else target[column] = value;
      }
      const active = which === "update" ? field(override, "update_active") : field(override, "add_active");
      if (active === false) { row.deleted = true; changed = true; }
    }
  }
  const added = await loader.readTable(`SELECT * FROM smart_setup_change.program_body WHERE program_top_id = $1 AND program_body_key = 999999 ORDER BY field_add_order, field_update_order`, [programId]);
  return { newRows: (added ?? []).map(toSetup), changed };
}

// ---------------------------------------------------------------------------------------
// Cmb_Master_GroupFld_Leave + Fill_UpdateGrid

export async function loadGroup(loader: Loader, programName: string, group: GroupState): Promise<GroupLoad> {
  const { session } = loader;
  const started = Date.now();
  const top = await programTop(loader, programName);
  const firstRow = (await programBody(loader, programName, "first"))[0];
  const programId = firstRow ? firstRow.program_top_id : toInt(field(top, "program_top_key"));

  if (hasSecondCombo(programId) && !group.secondCombo) {
    return { kind: "second-combo", label: "Select", options: await secondComboOptions(loader, programId, group) };
  }

  const context = loadContext(session, programId, group);
  let coreEntry = false;
  let levelMaster: Row | null = null;
  if (programId === 8) {
    levelMaster = await levelMasterRow(loader, group);
    coreEntry = toText(field(levelMaster ?? undefined, "stkforlvl_3")) === "CORE";
  }

  // ---- Fill_UpdateGrid
  // Stored SQL keeps its own spacing: the desktop concatenates these pieces as they are.
  const q = (column: string) => { const value = field(top, column); return value === null || value === undefined ? "" : String(value); };
  const fieldValues = ["", "", "", "", "", "", "", "", "", ""];
  let recExist = setDataBaseName(q("upd_rec_exist_query"), session);
  if (recExist !== "" && programId === 2) {
    const addonFld = await loader.readTable(`SELECT fiel_entrypos, fiel_relate FROM |sys.db|addon_fld WHERE fiel_key = $1`, [toInt(group.firstCombo.value)]);
    const entryPos = toText(field(addonFld?.[0], "fiel_entrypos"));
    const relate = toText(field(addonFld?.[0], "fiel_relate"));
    if (entryPos === "L") recExist = recExist.split("addon_data").join("addon_aentry");
    if (entryPos === "P" && relate === "P") recExist = recExist.split("addon_data").join("addon_ientry");
    if (entryPos === "P" && relate === "A") recExist = recExist.split("addon_data").join("addon_aentry");
  }
  const anyExistQuery = [recExist, q("upd_process_rec_exist_query"), q("upd_open_exist_query"), q("upd_book_code_exist_query"), q("upd_expense_exist_query")].some((text) => text !== "");
  const addDefaultQuery = setDataBaseName(q("add_defavalue_query"), session);
  if (addDefaultQuery !== "" && field(top, "add_screen_hidden") === true) {
    const sql = await ctrl(loader, replaceSessionValues(addDefaultQuery, session), { ...context, masterGrid: true });
    const rows = await loader.readTable(sql);
    if (rows) Object.values(rows[0]).slice(0, 9).forEach((value, index) => { fieldValues[index + 1] = displayValue(value); });
  }

  // Addon fields (addon_query)
  const addon: AddonState = { body: null, fields: null, comboSerial: 0 };
  let gridAddonFieldList = "";
  const addonProductSkip = session.licence === 30 && programId === 8 && group.firstCombo.text === "AC PRODUCT";
  if (q("addon_query").trim() !== "" && !addonProductSkip) {
    const body = await loader.readTable(`SELECT ${bodyColumns} FROM ${SETUP_SCHEMA}.program_body b WHERE b.program_top_id = $1 AND b.database_name = 'ADDON_DATA' AND LEFT(b.field_name, 7) = '_addon_'`, [programId]);
    addon.body = body ? body.map(toSetup) : null;
    let addonQuery = q("addon_query");
    if ((session.licence === 30 || session.licence === 75) && programId === 8) {
      addonQuery = addonQuery.split(" ORDER BY FIEL_SERIAL").join(` and PRODUCT_GROUP like '%${group.firstCombo.text.replace(/'/g, "''")}%' ORDER BY FIEL_SERIAL`);
    }
    const sql = await ctrl(loader, replaceSessionValues(replaceSessionValues(addonQuery, session), session), context);
    addon.fields = sql !== "" ? await loader.readTable(sql) : null;
    for (const addonField of addon.fields ?? []) {
      const save = toText(field(addonField, "fiel_save"));
      if (save === "") continue;
      const type = toText(field(addonField, "fiel_type"));
      if (type === "F") gridAddonFieldList += `,(case when FLAG_${save}='Y' then 'Yes' when FLAG_${save}='N' then 'No' end) as FLAG_${save}`;
      else if (toText(field(addonField, "fiel_mbal")) === "D") gridAddonFieldList += `,INPUT_${save} as INPUT_${save}`;
      else gridAddonFieldList += `,${type === "I" ? "INPUT_" : "TXT_"}${save}`;
    }
  }

  // The select list (Setup_Change_AddNewField)
  let updateBody = editable(await programBody(loader, programName, "update"));
  const updateChange = await applySetupChange(loader, programId, updateBody, "update");
  let memoField = "";
  let fieldList = "Select ";
  for (const row of updateBody) {
    if (row.deleted) continue;
    fieldList += row.field_restore.trim().length > 0 ? `${replaceSessionValues(row.field_restore.trim(), session)},` : `${columnName(row.field_name)},`;
    if (toText(row.input_mask) === "(Memo)") memoField = row.field_name;
  }
  for (const added of updateChange.newRows) fieldList += `${added.field_restore.trim() !== "" ? added.field_restore.trim() : added.field_name.trim()},`;
  fieldList = fieldList.slice(0, -1);

  let records: UpdateRecord[] = [];
  let backup: UpdateRecord[] = [];
  let updateTabVisible = field(top, "update_screen_hidden") !== true;
  const addTabVisible = field(top, "add_screen_hidden") !== true;
  const frozen = toInt(field(top, "no_of_col_frozen"));
  let rawRows: Row[] | null = null;

  const updateQuery = q("update_query");
  if (updateQuery.trim() !== "" && fieldList.trim() !== "Select") {
    const whereModified = replaceSessionValues(setDataBaseName(updateQuery, session), session);
    let from1 = whereModified;
    if (programId === 28) from1 = whereModified.split("and pr.pr_aonsub=|sys.firstcombovalue| and pr.pr_paraselect='S'").join("and pr.pr_paraselect='D'");
    else if (programId !== 32) from1 = whereModified.split("and pr.pr_accode=|sys.firstcombovalue| and pr.pr_paraselect='S'").join("and pr.pr_accode=|sys.firstcombovalue| and pr.pr_paraselect='D'");
    let from = await ctrl(loader, whereModified, context);
    from1 = await ctrl(loader, from1, context);
    let where = q("update_where").trim() !== "" ? await ctrl(loader, replaceSessionValues(q("update_where"), session), context) : "";
    if (session.licence === 21) {
      where = where.split("|sys.GROUP_KEY|").join(` and adata.key_PRODTYPE in (select sub_code from ${session.companySchema}.ADDON_SUB where upper(sub_name)='FINISH GOODS' and sub_pos='A' and para_id in (select fiel_key from ${session.companySchema}.ADDON_FLD where fiel_short='PROD_TYPE' and fiel_pos='A'))`);
    } else {
      where = where.split("|sys.GROUP_KEY|").join("");
    }
    if (programId === 45 && session.companySchema.toUpperCase().includes("RISHABH_SALES") && session.licence === 46) where = where.split("CUSTTYPE,").join("SALESMAN,");
    if (gridAddonFieldList !== "" && from !== "") {
      if (from.trimStart().toLowerCase().slice(0, 5) === "from ") from = `from ${from.trimStart().slice(5)}${setDataBaseName(q("addon_from"), session)}`;
      else from = from.toLowerCase().split("from ").join("from (") + setDataBaseName(q("addon_from"), session);
    }
    if (q("addon_where").trim() !== "" && where !== "") where += await ctrl(loader, replaceSessionValues(q("addon_where"), session), context);

    let list = await ctrl(loader, fieldList, context);
    if (gridAddonFieldList === "") list = list.split(",AON_KEY").join("");
    const existColumn = anyExistQuery ? ",'' as record_exist" : "";
    if ([26, 28, 29, 32, 36].includes(programId)) {
      const cte1Tail = programId === 28 ? " and pr.pr_aonsub is not null" : programId === 29 ? " and pr.PR_ACCODE is not null and pr_addless='A'" : " and pr.PR_ACCODE is not null";
      const cte1From = programId === 32 ? from1 : from;
      const existCte = [recExist, q("upd_process_rec_exist_query"), q("upd_open_exist_query")].some((text) => text !== "") ? ",'' as record_exist" : "";
      let sql = ` with CTE_TEMP1 as (${list} ${gridAddonFieldList} ${existCte},0 as Row_Number  ${cte1From} ${where}${cte1Tail}),`;
      sql += ` CTE_TEMP3 AS (${list} ${gridAddonFieldList} ${existCte},0 as Row_Number ${from1}`;
      sql += ` ${where} and SUB_CODE not IN (select SUB_CODE ${cte1From} ${where}${cte1Tail}))`;
      sql += " select * from CTE_TEMP1 union select * from CTE_TEMP3 order by SUB_NAME";
      rawRows = await loader.readTable(sql);
    } else {
      let orderBy = q("update_orderby");
      if ((programId === 8 && [9, 89].includes(session.licence) && group.firstCombo.value === "81") || (programId === 18 && session.licence === 9)) {
        orderBy = orderBy.split("order by pm.prod_short").join("order by RIGHT(repeat(' ',10)||pm.level_1,10),pm.prod_short");
      }
      if ((programId === 8 || programId === 18) && session.licence === 45) orderBy = orderBy.split("order by pm.prod_short").join("order by pm.prod_desc");
      if (session.licence !== 21 && programId === 22) list = list.split(",adata.txt_PRODGROUP as PROD_GROUP").join("");
      rawRows = await loader.readTable(`${list} ${gridAddonFieldList} ${existColumn},ROW_NUMBER() OVER(ORDER BY (SELECT 1)) as Row_Number ${from} ${where} ${orderBy}`);
    }
    if (!rawRows) updateTabVisible = false;
  }

  // Columns: ReadProgramUpdateBody again, then hide/addon, then Setting_GridCol
  let columns: UpdateColumn[] = [];
  if (rawRows) {
    updateBody = editable(await programBody(loader, programName, "update")).map((row) => ({ ...row, program_top_id: 0 }));
    const change = await applySetupChange(loader, programId, updateBody, "update");
    for (const added of change.newRows) updateBody.push({ ...added, program_top_id: 0 });
    if (change.changed) {
      let serial = 0;
      for (const row of updateBody) { if (row.program_top_id > 0 || row.deleted) continue; serial += 1; row.field_update_order = serial; }
    }
    const hide = await hideList(loader, programName, programId, group, "update", levelMaster ?? await levelMasterRow(loader, group));
    if (programName === "MASTER_PRODUCT" && !levelMaster) levelMaster = await levelMasterRow(loader, group);
    hideProductLevel(updateBody, programId === 8 ? hide.levelNumber : 9, hide.list, programId === 8 ? levelMaster : await levelMasterRow(loader, group), session.licence, session.flags.productCode);
    if (session.licence === 30 && programId === 8) {
      for (const row of updateBody) {
        if (!row.field_unique_name.includes("_DESCRIPTION")) continue;
        row.update_grid_visible = false;
        row.field_carry_name = toText(row.defa_against_field) !== "" ? row.defa_against_field : "PROD_SHORT";
      }
    }
    if (!addonProductSkip) await addonRecordAdd(loader, updateBody, addon, context);
    if (!(addon.fields && addon.fields.length > 0)) {
      let serial = 0;
      for (const row of updateBody) {
        if (row.field_name.trim().toUpperCase() === "AON_KEY") { row.deleted = true; continue; }
        if (row.deleted) continue;
        serial += 1;
        row.field_add_order = serial;
        row.field_update_order = serial;
      }
    }

    const resultKeys = Object.keys(rawRows[0]);
    const firstRecord = rawRows[0];
    const permissionSource = {
      firstCombo: { text: group.firstCombo.text, value: group.firstCombo.value, bound: true },
      fieldValue: (name: string) => {
        const value = field(firstRecord, name.split(".").pop() ?? name);
        return value === undefined ? undefined : displayValue(value);
      },
    };

    for (const row of updateBody) {
      if (row.deleted || row.field_update_order < 1) continue;
      const position = row.field_update_order;
      if (position > resultKeys.length) continue;
      const name = (row.field_name !== "" ? row.field_name.trim() : row.field_restore.trim()).split(".").pop()!.toLowerCase();
      const key = resultKeys.find((candidate) => candidate.toLowerCase() === name) ?? name;
      const visible = updateColumnShown(row, permissionSource, session.businessNature);
      let editableColumn = row.update_grid_editable;
      const caption = row.value_compulsory ? `* ${row.head_grid.trim()}` : row.head_grid.trim();

      if (row.enable_by_firstcmbval.trim() !== "") {
        const effect = applyPermission(getPermission(permissionSource, "E", "first_combo", row.enable_by_firstcmbval.trim(), false, false));
        if (effect.editable !== undefined) editableColumn = effect.editable;
      }

      let format = "";
      switch (row.field_type) {
        case "C": format = "N2"; break;
        case "D": format = name.includes("event_start_date") || name.includes("event_end_date") ? "dd/MMM/yyyy HH:mm:ss" : "dd/MM/yyyy"; break;
        case "M": format = "HH:mm"; break;
        case "N":
          if (row.decimal_points > 0 && row.decimal_points <= 4) format = `#,##0.${"0000".slice(0, row.decimal_points)}`;
          else if (row.decimal_points === 0) format = "#,###";
          break;
      }

      let options: ComboOption[] | null = null;
      const kind = row.combo_value.trim();
      if (kind !== "" && kind !== "N") {
        const result = await comboOptions(loader, row, group, "update");
        options = result.options;
        if (result.disable) editableColumn = false;
      }

      if (row.defa_against_field !== "" && row.defa_against_for !== "") {
        const against = row.defa_against_field.toLowerCase() === "first_combo" ? "first_combo" : row.defa_against_field;
        const answer = getPermission(permissionSource, "E", against, row.defa_against_for.trim(), true, false);
        if (answer.toLowerCase() === "e" && row.defa_value_query !== "") {
          const sql = replaceSessionValues(row.defa_value_query, session).split("|sys.firstcombovalue|").join(group.firstCombo.value).split("|sys.entry_id|").join("0");
          const rows = await loader.readTable(sql);
          if (rows && row.combo_value.toUpperCase() !== "N") options = optionsFrom(rows);
        }
      }

      if (programId === 34) editableColumn = true;
      columns.push({
        key,
        caption,
        width: row.update_grid_width,
        visible,
        editable: editableColumn,
        align: (["L", "C", "R"].includes(row.update_grid_align.trim()) ? row.update_grid_align.trim() : "") as UpdateColumn["align"],
        format,
        comboKind: kind as ComboKind,
        options,
        position,
        statusDisplay: statusDisplay(row),
        addon: row.addon === true,
        setup: publicSetup(row),
      });
    }
    // Columns the query returns that no setup row describes (record_exist, Row_Number) stay hidden.
    const described = new Set(columns.map((column) => column.key.toLowerCase()));
    for (const key of resultKeys) {
      if (described.has(key.toLowerCase())) continue;
      columns.push({ key, caption: key, width: 0, visible: false, editable: false, align: "", format: "", comboKind: "", options: null, position: resultKeys.indexOf(key) + 1, statusDisplay: "", setup: publicSetup(toSetup({ field_name: key })) });
    }
    columns = columns.sort((a, b) => a.position - b.position);

    records = rawRows.map((raw, index) => {
      const record: UpdateRecord = {};
      for (const [key, value] of Object.entries(raw)) record[key] = displayValue(value);
      const rowNumberKey = Object.keys(record).find((candidate) => candidate.toLowerCase() === "row_number");
      if (rowNumberKey) record[rowNumberKey] = String(index + 1);
      const srKey = Object.keys(record).find((candidate) => candidate.toLowerCase() === "sr_no");
      if (srKey) record[srKey] = String(index + 1);
      return record;
    });

    // Programs 43, 44, 45 (targets) overlay the saved target values onto the listed rows.
    if (programId === 43 || programId === 45) {
      const sql = programId === 43
        ? "select a.*,b.sub_name,b.para_id,b.sub_code from |sys.db|target a left join |sys.db|addon_sub b on a.trg_aaocode=b.sub_code where coalesce(trg_value,0) = 0 and b.sub_pos='A' order by trg_aaocode,trg_from,trg_upto"
        : "select a.*,b.sub_name,b.para_id,b.sub_code from |sys.db|target a left join |sys.db|addon_sub b on a.trg_aaocode=b.sub_code where coalesce(trg_perc,0) = 0 and b.sub_pos='A' order by trg_aaocode,trg_from,trg_upto";
      const targets = await loader.readTable(sql);
      for (const record of records) {
        const match = targets?.find((target) => displayValue(field(target, "sub_name")) === (record.sub_name ?? "") && displayValue(field(target, "trg_from")) === (record.trg_from ?? "") && displayValue(field(target, "trg_upto")) === (record.trg_upto ?? ""));
        if (!match || toInt(field(match, "trg_key")) <= 0) continue;
        for (const column of ["trg_key", "trg_aaocode", "trg_aaofld", "last_savedate", "last_savetime"]) record[column] = displayValue(field(match, column));
        if (programId === 43) record.trg_perc = displayValue(field(match, "trg_perc"));
        if (programId === 45) { record.trg_value = displayValue(field(match, "trg_value")); record.trg_visit = displayValue(field(match, "trg_visit")); }
      }
    }
    if (programId === 44) {
      const targets = await loader.readTable("select * from |sys.db|target where coalesce(trg_aaocode,0)=0 order by trg_from,trg_upto");
      for (const record of records) {
        const match = targets?.find((target) => displayValue(field(target, "trg_from")) === (record.trg_from ?? "") && displayValue(field(target, "trg_upto")) === (record.trg_upto ?? ""));
        if (!match || toInt(field(match, "trg_key")) <= 0) continue;
        for (const column of ["trg_key", "trg_value", "last_savedate", "last_savetime"]) record[column] = displayValue(field(match, column));
      }
    }
    backup = records.map((record) => ({ ...record }));

    // Programs 20 and 25 keep passwords masked; the real value stays on the server.
    if (programId === 20 || programId === 25) {
      const passwordColumn = columns.find((column) => column.setup.force_inputtype === "P");
      if (passwordColumn) {
        const index = columns.indexOf(passwordColumn);
        const next = columns[index + 1];
        for (let r = 0; r < records.length; r += 1) {
          records[r][passwordColumn.key] = "*********";
          backup[r][passwordColumn.key] = "*********";
          if (next && toText(records[r][next.key]) !== "") { records[r][next.key] = "*********"; backup[r][next.key] = "*********"; }
        }
      }
    }
  }

  // ---- Add grid (ReadProgramAddBody and the loop in Cmb_Master_GroupFld_Leave)
  const addRows: AddRow[] = [];
  let firstAddRow = 0;
  let lastAddRow = 0;
  const addBodyRows = editable(await programBody(loader, programName, "add"));
  if (addBodyRows.length > 0) {
    const addChange = await applySetupChange(loader, programId, addBodyRows, "add");
    for (const added of addChange.newRows) addBodyRows.push({ ...added });
    if (!addonProductSkip) await addonRecordAdd(loader, addBodyRows, { ...addon, comboSerial: 0 }, context);
    if (programName === "MASTER_PRODUCT" && !levelMaster) levelMaster = await levelMasterRow(loader, group);
    const hide = await hideList(loader, programName, programId, group, "add", levelMaster);
    hideProductLevel(addBodyRows, programId === 8 ? hide.levelNumber : 9, hide.list, programId === 8 ? levelMaster : await levelMasterRow(loader, group), session.licence, session.flags.productCode);

    const live = addBodyRows.filter((row) => !row.deleted);
    const inputs = new Map<string, { input: string; combo: string }>();
    if (addDefaultQuery !== "") {
      const sql = await ctrl(loader, replaceSessionValues(addDefaultQuery, session), { ...context, masterGrid: true });
      const rows = await loader.readTable(sql);
      if (rows) for (const [column, value] of Object.entries(rows[0])) inputs.set(column.toUpperCase(), { input: displayValue(value), combo: "" });
    }

    const valueOf = (name: string) => inputs.get(name.toUpperCase())?.input;
    const permissionSource = { firstCombo: { text: group.firstCombo.text, value: group.firstCombo.value, bound: true }, fieldValue: (name: string) => valueOf(name) ?? "" };

    for (const row of live) {
      const fieldName = row.field_name;
      const preset = inputs.get(fieldName.toUpperCase());
      let fieldInput = preset?.input ?? "";
      let fieldComboValue = "";
      let visible = row.add_grid_visible;
      let editableRow = true;
      let defaultText = "";
      let defaultValue = "";
      let carryName = row.field_carry_name;
      if (row.add_grid_visible) {
        if (firstAddRow === 0) firstAddRow = row.field_add_order;
        lastAddRow = row.field_add_order;
      }
      const headLabel = row.value_compulsory ? `* ${row.head_label.trim()}` : row.head_label;
      let styleName: AddRow["styleName"] = "";
      if (row.field_type === "C") styleName = "curr";
      else if (row.field_type === "D") styleName = "date";
      else if (row.field_type === "N") styleName = row.decimal_points > 0 && row.decimal_points <= 4 ? (`Decimal_${row.decimal_points}` as AddRow["styleName"]) : row.decimal_points === 0 ? "Pos_Integer" : "";

      let options: ComboOption[] | null = null;
      const kind = row.combo_value.trim();
      if (kind === "L" && row.combo_list !== "") {
        options = row.combo_list.split("|").map((text) => ({ text, value: text }));
        fieldInput = programId === 31 ? row.combo_list : row.combo_list.slice(0, Math.max(row.combo_list.indexOf("|"), 0));
      } else if (kind === "F" || kind === "X" || kind === "Q" || kind === "C" || kind === "V") {
        const result = await comboOptions(loader, row, group, "add");
        options = result.options;
        if (result.disable) editableRow = false;
        if ((kind === "X" || kind === "Q") && options) {
          if (options.length > 0) {
            fieldInput = options[0].text;
            if (toInt(options[0].value) > 0) fieldComboValue = options[0].value; else fieldInput = "";
          } else fieldInput = "";
          defaultText = fieldInput;
          defaultValue = fieldComboValue;
        }
        if (kind === "V") fieldInput = "";
      }

      if (session.licence === 30 && programId === 8 && row.field_unique_name.includes("_DESCRIPTION")) {
        visible = false;
        carryName = toText(row.defa_against_field) !== "" ? row.defa_against_field : "PROD_SHORT";
      }

      if (row.visible_against_fld !== "" && row.visible_against_fld.includes("|sys.Business_Nature|")) {
        const hideFor = toText(row.hide_for_value);
        if (hideFor !== "") {
          if (hideFor.startsWith("!")) { if (session.businessNature.toLowerCase() !== hideFor.toLowerCase().slice(1)) visible = false; }
          else if (session.businessNature.toLowerCase() === hideFor.toLowerCase()) visible = false;
        }
      } else if (row.visible_against_fld !== "" && toText(row.hide_for_value) !== "") {
        const effect = applyPermission(getPermission(permissionSource, "V", row.visible_against_fld, row.hide_for_value, true, false));
        if (effect.visible !== undefined) visible = effect.visible;
      }

      if (row.defa_sysvalue === "sys.update.thisfieldtext" && records[0]) {
        const key = Object.keys(records[0]).find((candidate) => candidate.toLowerCase() === fieldName.toLowerCase());
        if (key) fieldInput = records[0][key];
      }

      if (toText(row.defa_add_value_query) !== "" && (session.flags.partyAccode || session.flags.productCode) && session.licence !== 46) {
        const sql = await ctrl(loader, replaceSessionValues(row.defa_add_value_query, session), { ...context, masterGrid: true });
        const rows = await loader.readTable(sql);
        if (rows) {
          fieldInput = displayValue(Object.values(rows[0])[0]).padStart(5, " ");
          // Func_SetPermission(..., "D", true, 0, row) disables row 0, the caption row: no effect here.
        }
      }

      if (row.defa_against_field !== "" && row.defa_against_for !== "") {
        const against = row.defa_against_field.toLowerCase() === "first_combo" ? "first_combo" : row.defa_against_field;
        const answer = getPermission(permissionSource, "E", against, row.defa_against_for.trim(), true, false);
        if (answer.toLowerCase() === "e" && toText(row.defa_value_query) !== "") {
          const sql = await ctrl(loader, replaceSessionValues(row.defa_value_query, session), { ...context, masterGrid: true });
          const rows = await loader.readTable(sql);
          if (rows) {
            if (row.combo_value.toUpperCase() !== "N") options = optionsFrom(rows);
            fieldInput = displayValue(Object.values(rows[0])[0]);
          }
        }
      } else if (toText(row.enable_by_firstcmbval) !== "") {
        const answer = getPermission(permissionSource, "E", "first_combo", row.enable_by_firstcmbval.trim(), true, false);
        if (answer === "D" || (answer === "E" && !editableRow)) editableRow = answer === "E";
      }
      if (toText(row.hide_by_firstcmbval) !== "" && row.add_grid_visible) {
        const answer = getPermission(permissionSource, "V", "first_combo", row.hide_by_firstcmbval.trim(), true, true);
        if (answer === "F" || (answer === "T" && !visible)) visible = answer === "T";
      }

      inputs.set(fieldName.toUpperCase(), { input: fieldInput, combo: fieldComboValue });
      addRows.push({
        fieldName,
        headLabel,
        fieldInput,
        fieldComboValue,
        visible,
        editable: editableRow,
        comboKind: kind as ComboKind,
        options,
        defaultText,
        defaultValue,
        styleName,
        carryName,
        statusDisplay: statusDisplay(row),
        addon: row.addon === true,
        setup: publicSetup(row),
      });
    }
  }

  const seconds = Math.round((Date.now() - started) / 1000);
  return {
    kind: "grids",
    heading: q("screen_heading").trim(),
    addTabVisible,
    updateTabVisible: updateTabVisible && records.length > 0,
    addCloseOnUpdateExist: field(top, "add_close_on_upd_exist") === true,
    frozen,
    columns,
    records,
    backup,
    addRows,
    firstAddRow,
    lastAddRow,
    recordExistChecks: anyExistQuery,
    memoField,
    hotKeys: addTabVisible && records.length > 0 ? "Press F4 Key For Update Grid Vertical Display" : "",
    message: `Data generation time : ${String(Math.floor(seconds / 60)).padStart(2, "0")} Minutes ${String(seconds % 60).padStart(2, "0")} Seconds`,
    fieldValues,
    coreEntry,
    levelMaster: levelMaster ? Object.fromEntries(Object.entries(levelMaster).map(([key, value]) => [key, displayValue(value)])) : null,
    pkvKey: pkvKey(updateBody, columns),
  };
}

/** str_pkvColumn: the column of the update body row whose log_short is PKV, as the grid keys it. */
function pkvKey(updateBody: readonly BodyRow[], columns: readonly UpdateColumn[]): string {
  const row = updateBody.find((candidate) => toText(candidate.log_short).toUpperCase() === "PKV");
  if (!row) return "";
  const names = [row.field_save, row.field_name].map((name) => toText(name).split(".").pop()!.toLowerCase()).filter(Boolean);
  return columns.find((column) => names.includes(column.key.toLowerCase()))?.key ?? names[0] ?? "";
}

// ---------------------------------------------------------------------------------------
// The setup a save works from: the same rows the grids were built from.

export type PreparedProgram = Readonly<{
  programId: number;
  top: Row;
  /** c1_PropertyGrid after hiding and addon rows, in update order. */
  updateBody: readonly BodyRow[];
  /** c1dg_MasterGrid's setup rows after hiding and addon rows, in add order. */
  addBody: readonly BodyRow[];
  /** bl_AddGrid_Visible as the desktop leaves it: the last add row's add_grid_visible. */
  addGridVisibleFlag: boolean;
  levelMaster: Row | null;
  firstComboRow: ProgramBodySetup | undefined;
}>;

export async function prepareProgram(loader: Loader, programName: string, group: GroupState): Promise<PreparedProgram> {
  const { session } = loader;
  const top = await programTop(loader, programName);
  const firstComboRow = (await programBody(loader, programName, "first"))[0];
  const programId = firstComboRow ? firstComboRow.program_top_id : toInt(field(top, "program_top_key"));
  const context = loadContext(session, programId, group);
  const levelMaster = await levelMasterRow(loader, group);
  const addonProductSkip = session.licence === 30 && programId === 8 && group.firstCombo.text === "AC PRODUCT";
  const addon: AddonState = { body: null, fields: null, comboSerial: 0 };
  const addonQuery = String(field(top, "addon_query") ?? "");
  if (addonQuery.trim() !== "" && !addonProductSkip) {
    const body = await loader.readTable(`SELECT ${bodyColumns} FROM ${SETUP_SCHEMA}.program_body b WHERE b.program_top_id = $1 AND b.database_name = 'ADDON_DATA' AND LEFT(b.field_name, 7) = '_addon_'`, [programId]);
    addon.body = body ? body.map(toSetup) : null;
    let query = addonQuery;
    if ((session.licence === 30 || session.licence === 75) && programId === 8) {
      query = query.split(" ORDER BY FIEL_SERIAL").join(` and PRODUCT_GROUP like '%${group.firstCombo.text.replace(/'/g, "''")}%' ORDER BY FIEL_SERIAL`);
    }
    const sql = await ctrl(loader, replaceSessionValues(query, session), context);
    addon.fields = sql !== "" ? await loader.readTable(sql) : null;
  }

  const updateBody = editable(await programBody(loader, programName, "update")).map((row) => ({ ...row, program_top_id: 0 }));
  const change = await applySetupChange(loader, programId, updateBody, "update");
  for (const added of change.newRows) updateBody.push({ ...added, program_top_id: 0 });
  const hideUpdate = await hideList(loader, programName, programId, group, "update", levelMaster);
  hideProductLevel(updateBody, programId === 8 ? hideUpdate.levelNumber : 9, hideUpdate.list, levelMaster, session.licence, session.flags.productCode);
  if (!addonProductSkip) await addonRecordAdd(loader, updateBody, addon, context);
  if (!(addon.fields && addon.fields.length > 0)) {
    let serial = 0;
    for (const row of updateBody) {
      if (row.field_name.trim().toUpperCase() === "AON_KEY") { row.deleted = true; continue; }
      if (row.deleted) continue;
      serial += 1;
      row.field_add_order = serial;
      row.field_update_order = serial;
    }
  }

  const addBody = editable(await programBody(loader, programName, "add"));
  const addChange = await applySetupChange(loader, programId, addBody, "add");
  for (const added of addChange.newRows) addBody.push({ ...added });
  if (!addonProductSkip) await addonRecordAdd(loader, addBody, { ...addon, comboSerial: 0 }, context);
  const hideAdd = await hideList(loader, programName, programId, group, "add", levelMaster);
  hideProductLevel(addBody, programId === 8 ? hideAdd.levelNumber : 9, hideAdd.list, levelMaster, session.licence, session.flags.productCode);

  const liveAdd = addBody.filter((row) => !row.deleted);
  return {
    programId,
    top,
    updateBody: updateBody.filter((row) => !row.deleted),
    addBody: liveAdd,
    addGridVisibleFlag: liveAdd.length > 0 ? liveAdd[liveAdd.length - 1].add_grid_visible : false,
    levelMaster,
    firstComboRow,
  };
}

export { ctrl as replaceControlValues };
export type { BodyRow };
