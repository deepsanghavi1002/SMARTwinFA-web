import { displayValue, Loader } from "../master-program/load";
import { formatDesktopDate, formatDesktopTime, parseDesktopDate, toInt, toText } from "../master-program/legacy";
import { readRights, SETUP_SCHEMA } from "../master-program/session";
import type { MasterSession } from "../master-program/session";
import { replaceSessionValues } from "../master-program/sql";
import { publicSetup, toSetup } from "../master-rules";
import { properHeading } from "../master-program/heading";
import { orderByAliases, quotedAliases } from "./text";
import { ENTRY_APPROVED, lockStoppedParties } from "./entry32";
import { BANK_RECO, bankBalances } from "./bankReco";
import { entryGridSql } from "./gridSql";
import type { EntryColumn, EntryControl, EntryDefinition, EntryGrid, EntryOption, EntryState } from "./types";

/**
 * Small_Entry.cs, the one desktop form behind every SMALL_ENTRY menu, on PostgreSQL.
 *
 * The form is driven by smart_setup: entry_properties (the screen and its first combo),
 * entry_control (the header controls and the grid's fill style), control_event (the queries
 * the first combo runs when it is left), entry_grid_body (the grid's columns) and
 * entry_save_properties (what Save writes). The setup path is ported whole; the desktop's
 * many `int_Small_Entry_Id == n` branches are ported entry by entry, and an entry whose
 * branches are not ported yet opens read-only (PORTED_ENTRIES).
 */

type Row = Record<string, unknown>;
const field = Loader.field;
const text = (row: Row | undefined, name: string) => toText(field(row, name));
const flag = (row: Row | undefined, name: string) => field(row, name) === true;

/** Entries whose own branches of Small_Entry.cs are ported; the rest may be viewed, not saved. */
export const PORTED_ENTRIES: ReadonlySet<number> = new Set([BANK_RECO, 11, ENTRY_APPROVED]);

/** Small_Entry KeyUp: the Delete key removes selected rows in these entries (103 only for an AD user). */
const DELETE_ENTRIES = new Set([7, 36, 75, 100, 111]);

/** Entries whose queries name |sys.stk_module| (Small_Entry.Func_ReplaceSysVal_CtrlValue). */
const STK_MODULE_ENTRIES = new Set([32, 57, 60, 65, 68]);

/** "Select distinct" instead of "Select" for these entries' grid query. */
const DISTINCT_ENTRIES = new Set([20, 22, 27, 29, 33, 39, 70]);

// ---------------------------------------------------------------------------------------
// Setup rows

export async function entryProperties(loader: Loader, entryName: string): Promise<Row> {
  const rows = await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.entry_properties WHERE BTRIM(entry_name) = $1`, [entryName]);
  if (!rows) throw new Error(`Small entry ${entryName} is not in smart_setup.entry_properties`);
  return rows[0];
}

/** dtbl_Entry_Control: rows active for add or update, in field_add_order. */
async function entryControls(loader: Loader, entryId: number): Promise<Row[]> {
  return (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.entry_control WHERE entry_id = $1 AND (add_active OR update_active) ORDER BY field_add_order, entry_control_key`, [entryId])) ?? [];
}

/** control_event rows the first combo runs, in the order the desktop reads them. */
async function firstComboEvents(loader: Loader, entryId: number): Promise<Row[]> {
  return (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.control_event WHERE entry_properties_id = $1 AND LOWER(BTRIM(control_name)) = 'first_combo' ORDER BY control_query_sr, control_event_key`, [entryId])) ?? [];
}

/** entry_grid_body rows of one fill event, add_active, in field_add_order. */
async function eventBody(loader: Loader, eventId: number): Promise<Row[]> {
  return (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.entry_grid_body WHERE entry_control_id = $1 AND add_active ORDER BY field_add_order, entry_grid_body_key`, [eventId])) ?? [];
}

// ---------------------------------------------------------------------------------------
// Func_ReplaceSysVal_CtrlValue

export type SysContext = Readonly<{
  session: MasterSession;
  entryId: number;
  state: EntryState;
  /** Each header control's chosen option, by control name: text and value. */
  choices: Readonly<Record<string, EntryOption>>;
  entryNat: string;
  /** str_ctrl_prd_addon_type1: the addon type of a multiple-addon grid (godown: GW). */
  addonType: string;
  /** The column group being saved: RP main balance, or one addon (godown) sub code. */
  addonColumn: Readonly<{ fieldKey: number; subCode: number }> | null;
  /** Each header control's label, by control name (lbl_ComboBox2 and the like). */
  labels?: Readonly<Record<string, string>>;
  /** |sys.stk_module|: the first combo's book's stkm_short (entries 32, 57, 60, 65, 68). */
  stkModule?: string;
}>;

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

function dateOf(value: string | undefined): string {
  const date = parseDesktopDate(value ?? "");
  return date ? formatDesktopDate(date) : "";
}

/**
 * Lib_GlobalFunctions.ReplaceSysValueinQuery then Func_ReplaceSysVal_CtrlValue, for the
 * placeholders the ported entries use. Unknown ones are left in place, as the desktop does.
 */
export function replaceEntryValues(source: string, context: SysContext, now = new Date()): string {
  let sql = replaceSessionValues(source, context.session, now);
  const has = (token: string) => sql.toLowerCase().includes(token);
  const swap = (token: string, value: string) => {
    if (!has(token)) return;
    sql = sql.replace(new RegExp(token.replace(/[|.]/g, (c) => `\\${c}`), "gi"), () => value);
  };
  const choice = (name: string) => context.choices[name] ?? { text: context.state.controls[name] ?? "", value: "" };
  const first = context.state.firstCombo;
  // |sys.dt_join|: an Add lists what was entered up to Date Upto, an Update what was reconciled between the dates.
  const option = (context.state.controls.cmb_smallentry2 ?? "").toLowerCase();
  if (option.includes("add")) swap("|sys.dt_join|", " and a.doc_date <= |sys.dtp_date2| ");
  else if (option.includes("update")) swap("|sys.dt_join|", " and a.reco_date between |sys.dtp_date1| and |sys.dtp_date2| ");
  // |sys.value.cmb_smallentry2|: with an "Entry" option, Add lists the rows not reconciled yet, Update the reconciled ones
  // (isnull(a.reco_date,0) = 0 / > 0 on SQL Server, where a missing date read as 0); entries 27 and 29 take the option's value.
  if ((context.labels?.cmb_smallentry2 ?? "").toLowerCase().includes("entry")) {
    if (option.includes("add")) swap("|sys.value.cmb_smallentry2|", " and a.reco_date is null order by doc_date,doc_no");
    else if (option.includes("update")) swap("|sys.value.cmb_smallentry2|", " and a.reco_date is not null order by doc_date,doc_no");
  }
  if (context.entryId === 27 || context.entryId === 29) swap("|sys.value.cmb_smallentry2|", choice("cmb_smallentry2").value || "0");
  if (has("'|sys.left.firstcombotext|'")) swap("|sys.left.firstcombotext|", (first?.text ?? "").replace(/'/g, "''"));
  swap("|sys.left.firstcombotext|", quote(first?.text ?? ""));
  swap("|sys.firstcombovalue|", first?.value || "0");
  swap("|sys.firstcomboid|", first?.value || "0");
  for (const n of [1, 2, 3]) {
    swap(`|sys.cmb_smallentry${n}text|`, quote(choice(`cmb_smallentry${n}`).text));
    swap(`|sys.cmb_smallentry${n}|`, choice(`cmb_smallentry${n}`).value || "0");
  }
  swap("|sys.dtp_date1|", quote(dateOf(context.state.controls.dtp_date)));
  swap("|sys.dtp_date2|", quote(dateOf(context.state.controls.dtp_date2)));
  swap("|sys.dtp_date3|", quote(dateOf(context.state.controls.dtp_date3)));
  if (has("'|sys.entrynat|'")) swap("|sys.entrynat|", context.entryNat);
  swap("|sys.entrynat|", quote(context.entryNat));
  swap("|sys.ctrl_prd_addon_type|", quote(context.addonType));
  swap("|sys.prec_flag|", quote(context.addonColumn ? context.addonType : "RP"));
  swap("|sys.addonfld_key|", context.addonColumn ? String(context.addonColumn.fieldKey) : "Null");
  swap("|sys.sub_code|", context.addonColumn ? String(context.addonColumn.subCode) : "Null");
  swap("|sys.user_type|", quote(context.session.userType));
  swap("|sys.blank|", "''");
  swap("|sys.null|", "null");
  swap("|sys.last_savedate|", quote(formatDesktopDate(now)));
  swap("|sys.last_savetime|", quote(formatDesktopTime(now)));
  swap("|sys.smart_lic|", String(context.session.licence));
  swap("|sys.entry_id|", String(context.entryId));
  if (context.stkModule !== undefined) swap("|sys.stk_module|", context.stkModule.replace(/'/g, "''"));
  return sql;
}

/** Cmb_SmallEntry2_Leave: "Add" is an add; anything else (Update) an update. */
export function entryNature(entryId: number, controls: readonly EntryControl[], state: EntryState): "A" | "U" {
  if (!controls.some((control) => control.name === "cmb_smallentry2")) return "A";
  return state.controls.cmb_smallentry2 === "Add" && entryId !== 4 ? "A" : "U";
}

// ---------------------------------------------------------------------------------------
// Form load: first combo and header controls

async function queryOptions(loader: Loader, sql: string): Promise<EntryOption[]> {
  const rows = await loader.readTable(sql);
  return (rows ?? []).map((row) => {
    const values = Object.values(row);
    return { text: toText(displayValue(values[0])), value: toText(displayValue(values[1] ?? values[0])) };
  });
}

/** Small_Entry_Control_Properties: a list control's entries. */
async function controlOptions(loader: Loader, row: Row, context: SysContext): Promise<EntryOption[]> {
  switch (text(row, "combo_value").toUpperCase()) {
    case "F": {
      const fixed = (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.combo_fixvalue WHERE BTRIM(combo_prog_id) = $1 ORDER BY combo_itemvalue, cfv_key`, [text(row, "combo_fixvalueid")])) ?? [];
      const query = text(fixed[0], "combo_query");
      if (query !== "") return queryOptions(loader, replaceEntryValues(query, context));
      return fixed.map((option) => ({ text: text(option, "combo_desc"), value: toText(displayValue(field(option, "combo_itemvalue"))) }));
    }
    case "X": {
      // combo_fixquery, then its where and order by (|sys.pk_addon_fld| is an addon column's own field).
      let query = text(row, "combo_fixquery");
      if (query === "") return [];
      if (text(row, "combo_fixwhere") !== "") query += ` where ${text(row, "combo_fixwhere")}`;
      if (text(row, "combo_fixorder") !== "") query += ` order by ${text(row, "combo_fixorder")}`;
      query = query.replace(/|sys.pk_addon_fld|/gi, String(toInt(field(row, "pk_addon_fld"))));
      return queryOptions(loader, replaceEntryValues(query, context));
    }
    case "Q": {
      const query = text((await loader.readTable(`SELECT query_string FROM ${SETUP_SCHEMA}.query_table WHERE BTRIM(query_prog_id) = $1`, [text(row, "combo_query")]))?.[0], "query_string");
      return query === "" ? [] : queryOptions(loader, replaceEntryValues(query, context));
    }
    case "L":
      return text(row, "combo_list").split("|").filter((item) => item !== "").map((item) => ({ text: item, value: item }));
    default:
      return [];
  }
}

const CONTROL_TYPES: Readonly<Record<string, EntryControl["type"]>> = { cmb_smallentry1: "LB", cmb_smallentry2: "LB", cmb_smallentry3: "LB", dtp_date: "DT", dtp_date2: "DT", dtp_date3: "DT", tbx_text1: "TB", tbx_text2: "TB", tbx_text3: "TB" };

/** Small_Entry_Load's default dates (the entries not listed open on the year's first day). */
function defaultDate(entryId: number, name: string, session: MasterSession, now: Date): string {
  const today = [3, 33, 34, 35, 39, 42, 47, 48, 54, 57, 58, 60, 63, 68, 71, 72, 73, 74, 75, 77, 78, 79, 80, 81, 82, 83, 84, 85, 94, 95, 96, 99, 100, 104, 105, 106, 108, 110, 111, 115].includes(entryId);
  if (today) return formatDesktopDate(name === "dtp_date" && (entryId === 3 || entryId === 63) ? session.tarikh1 : now);
  if (name === "dtp_date2") {
    if ([32, 43, 52, 64, 65, 67, 109, 112].includes(entryId)) return formatDesktopDate(now);
    return formatDesktopDate(entryId === 76 ? session.tarikh2 : session.tarikh1);
  }
  return formatDesktopDate(session.tarikh1);
}

export async function loadEntry(loader: Loader, entryName: string, menuShortName: string, now = new Date()): Promise<EntryDefinition> {
  const { session } = loader;
  const properties = await entryProperties(loader, entryName);
  const entryId = toInt(field(properties, "entry_key"));
  const unsupported: string[] = [];
  if (!PORTED_ENTRIES.has(entryId)) unsupported.push(`Entry ${entryId} (${entryName}) has entry-specific steps that are not ported to the web yet; it opens for viewing only.`);

  // The first combo: first_combo_query + where + order by, or nothing when it is hidden.
  let firstCombo: EntryDefinition["firstCombo"] = null;
  const emptyState: EntryState = { firstCombo: null, controls: {} };
  const baseContext: SysContext = { session, entryId, state: emptyState, choices: {}, entryNat: "A", addonType: "", addonColumn: null };
  if (flag(properties, "first_combo_visible")) {
    let sql = text(properties, "first_combo_query");
    if (sql !== "") {
      const where = replaceSessionValues(text(properties, "first_combo_where"), session);
      if (where !== "") sql += ` where ${where}`;
      if (text(properties, "first_combo_orderby") !== "") sql += ` order by ${orderByAliases(sql, text(properties, "first_combo_orderby"))}`;
      let options = await queryOptions(loader, replaceEntryValues(sql, baseContext));
      if (flag(properties, "first_combo_all")) options = [{ text: "ALL", value: "-1" }, ...options];
      firstCombo = { label: text(properties, "first_label_caption"), options };
    }
  }

  // Header controls: shown when add_visible (the form opens as an add, str_EntryNat "A").
  const controls: EntryControl[] = [];
  for (const row of await entryControls(loader, entryId)) {
    const name = text(row, "control_name").toLowerCase();
    const type = CONTROL_TYPES[name];
    if (!type) continue; // the grid (c1dg_SmallEntryGrid) and anything the web has no control for
    if (!flag(row, "add_visible")) continue;
    const options = type === "LB" ? await controlOptions(loader, row, baseContext) : [];
    const initial = type === "DT" ? defaultDate(entryId, name, session, now) : type === "LB" ? (options[0]?.text ?? "") : text(row, "defa_fixvalue");
    controls.push({ name, label: text(row, "label_caption"), type, options, compulsory: flag(row, "value_compulsory"), tooltip: text(row, "field_tooltips"), initial });
  }

  const rights = await readRights(loader.client, session, `Menu-${menuShortName}`);
  return {
    entryId,
    entryName,
    caption: text(properties, "entry_caption"),
    statusHead: text(properties, "entry_status_head"),
    firstCombo,
    controls,
    rights: { restricted: rights.restricted, edit: rights.edit, editPassword: rights.editPassword !== "", modulePassword: rights.modulePassword !== "" },
    licence: session.licence,
    canDelete: DELETE_ENTRIES.has(entryId) || (entryId === 103 && session.userType.trim().toUpperCase() === "AD"),
    unsupported,
  };
}

// ---------------------------------------------------------------------------------------
// Cmb_FirstCombo_Leave: the grid query

/** A godown (or other multiple-addon) column group: one addon sub and its columns. */
export type AddonGroup = Readonly<{ subCode: number; subName: string; pk: string; qty: string; rate: string }>;

export type GridPlan = Readonly<{
  entryId: number;
  sql: string;
  balanceSql: string;
  /** dtbl_Entry_GridBody: the event rows, then the addon rows the fill added, each with the grid column it sets. */
  body: readonly Readonly<{ row: Row; column: string; addon: boolean }>[];
  /** PRDMulAdd: the addon field every group belongs to, and its type (GW for godown). */
  multi: Readonly<{ fieldKey: number; addonType: string; searchFields: readonly string[]; groups: readonly AddonGroup[] }> | null;
  warnings: readonly string[];
  /** The values the queries were filled with, for the grid's combo lists. */
  context: SysContext;
}>;

/** An alias PostgreSQL keeps exactly as written. */
const alias = (name: string) => `"${name.replace(/"/g, "")}"`;

/** entry_grid_body rows that stand for addon fields (_addon_combo, _addon_input, _addon_flag). */
async function addonBodyRows(loader: Loader, entryId: number): Promise<Row[]> {
  return (await loader.readTable(
    `SELECT * FROM ${SETUP_SCHEMA}.entry_grid_body WHERE LEFT(field_name, 7) = '_addon_' AND entry_control_id IN (SELECT fill_grid_event_id FROM ${SETUP_SCHEMA}.control_event WHERE entry_properties_id = $1) ORDER BY entry_control_id, field_add_order, entry_grid_body_key`,
    [entryId],
  )) ?? [];
}

/**
 * Addon_RecordAdd_in_Grid: one column per addon field. `onlyDisplay` (the product master's
 * addons) shows them read-only.
 */
function addonColumns(fields: readonly Row[], bodyRows: readonly Row[], addonFor: string, onlyDisplay: boolean) {
  const select: string[] = [];
  const body: { row: Row; column: string; addon: boolean }[] = [];
  let comboSerial = 0;
  for (const addon of fields) {
    const save = text(addon, "fiel_save");
    const desc = text(addon, "fiel_desc");
    const compulsory = text(addon, "fiel_entry") === "C" && !onlyDisplay;
    for (const base of bodyRows) {
      const baseName = text(base, "field_name");
      switch (text(addon, "fiel_type")) {
        case "I": {
          if (baseName !== "_addon_input") break;
          const column = `input_${save}`;
          const mbal = text(addon, "fiel_mbal");
          select.push(`${addonFor}.${column}`);
          body.push({ column, addon: true, row: { ...base, field_name: column, head_label: desc, head_grid: desc, value_compulsory: compulsory, field_type: mbal === "D" ? "D" : mbal === "N" ? "N" : "T", force_inputtype: mbal === "D" ? "D" : "I", number_positiveonly: mbal === "N", decimal_points: mbal === "N" ? 2 : 0, update_grid_align: mbal === "N" ? "R" : "L", update_grid_editable: onlyDisplay ? false : field(base, "update_grid_editable") } });
          break;
        }
        case "F": {
          if (baseName !== "_addon_flag") break;
          const column = `flag_${save}`;
          select.push(`(case when ${addonFor}.${column}='Y' then 'Yes' when ${addonFor}.${column}='N' then 'No' end) as ${column}`);
          body.push({ column, addon: true, row: { ...base, field_name: column, head_label: desc, head_grid: desc, value_compulsory: compulsory, force_inputtype: "F", combo_value: "L", combo_list: "Yes|No", update_grid_align: "L", update_grid_editable: onlyDisplay ? false : field(base, "update_grid_editable") } });
          break;
        }
        case "M": {
          if (baseName !== "_addon_combo") break;
          comboSerial += 1;
          const column = `txt_${save}`;
          select.push(`${addonFor}.${column}`);
          // The base row is field_type I, but the column holds the sub's name, which Setting_GridCol shows unformatted.
          body.push({ column, addon: true, row: { ...base, field_name: column, head_label: desc, head_grid: desc, field_type: "T", value_compulsory: compulsory, force_inputtype: "M", combo_value: onlyDisplay ? "N" : "X", update_grid_align: "L", update_grid_editable: onlyDisplay ? false : field(base, "update_grid_editable"), addon_serial: comboSerial, pk_addon_fld: field(addon, "fiel_key") } });
          break;
        }
      }
    }
  }
  return { select, body };
}

/**
 * MultiProdAddon_Add_in_Grid: for every sub of the multiple addon field (every godown), the
 * body rows of that addon type become one column each, named `<head_grid>_<sub name>`.
 */
async function multipleAddon(loader: Loader, context: SysContext, eventId: number) {
  const hidden = (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.entry_grid_body WHERE entry_control_id = $1 AND NOT add_active AND add_grid_visible ORDER BY entry_grid_body_key`, [eventId])) ?? [];
  if (hidden.length === 0) return null;
  const addonType = text(hidden[0], "field_addon_type");
  const searchFields = hidden.map((row) => text(row, "field_name"));
  const typeRows = (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.entry_grid_body WHERE entry_control_id = $1 AND BTRIM(field_addon_type) = $2 ORDER BY entry_grid_body_key`, [eventId, addonType])) ?? [];
  const names = [...new Set(typeRows.map((row) => text(row, "field_addon_name")).filter((name) => name !== ""))];
  const select: string[] = [];
  const body: { row: Row; column: string; addon: boolean }[] = [];
  const groups: AddonGroup[] = [];
  let fieldKey = 0;
  for (const name of names) {
    const addon = (await loader.readTable(`SELECT fiel_key, fiel_mbal FROM ${context.session.companySchema}.addon_fld WHERE fiel_pos <> 'D' AND fiel_err LIKE $1 ORDER BY fiel_key LIMIT 1`, [`%${name}%`]))?.[0];
    if (!addon) continue;
    if (fieldKey === 0) fieldKey = toInt(field(addon, "fiel_key"));
    const subs = (await loader.readTable(`SELECT sub_code, BTRIM(sub_name) AS sub_name FROM ${context.session.companySchema}.addon_sub WHERE sub_pos <> 'D' AND para_id = $1 ORDER BY sub_code`, [toInt(field(addon, "fiel_key"))])) ?? [];
    const mbal = text(addon, "fiel_mbal");
    for (const sub of subs) {
      const subCode = toInt(field(sub, "sub_code"));
      const subName = text(sub, "sub_name");
      const columnOf: Record<string, string> = {};
      for (const row of typeRows) {
        const restore = String(field(row, "field_restore_as") ?? "");
        if (restore.trim() === "") continue;
        const column = `${text(row, "head_grid")}_${subName}`;
        columnOf[text(row, "field_name").toLowerCase()] = column;
        let expression = restore.replace(/\|sys\.ctrl_ac_addon_type\|/gi, text(row, "field_addon_type")).replace(/\|sys\.sub_code\|/gi, String(subCode));
        expression = replaceEntryValues(expression, context);
        select.push(`${expression} as ${alias(column)}`);
        const fieldType = mbal === "D" ? "D" : mbal === "N" || mbal === "Y" ? "N" : "T";
        body.push({ column, addon: true, row: { ...row, field_name: column, head_label: column, head_grid: column, field_type: fieldType, update_grid_align: fieldType === "N" ? "R" : "L", add_active: true, update_active: true } });
      }
      groups.push({ subCode, subName, pk: columnOf.prodbal_key ?? "", qty: columnOf[searchFields[0]?.toLowerCase() ?? ""] ?? "", rate: columnOf[searchFields[1]?.toLowerCase() ?? ""] ?? "" });
    }
  }
  return { select, body, multi: { fieldKey, addonType, searchFields, groups } };
}

/** The special restores |sys.reco.cmb_smallentry3| and |sys.form.cmb_smallentry2| (bank reco, forms). */
function specialRestore(restore: string, context: SysContext): string | null {
  const key = restore.trim().toLowerCase();
  if (key !== "|sys.reco.cmb_smallentry3|" && key !== "|sys.form.cmb_smallentry2|") return null;
  if (context.entryNat === "A") return (context.state.controls.cmb_smallentry3 ?? "").startsWith("Y") ? "true as Tick" : "false as Tick";
  return key.includes("reco") ? "(a.reco_date is not null) as Tick" : "(a.form_recddate is not null) as Tick";
}

export async function gridPlan(loader: Loader, entryName: string, state: EntryState, choices: Readonly<Record<string, EntryOption>>, now = new Date()): Promise<GridPlan> {
  const { session } = loader;
  const properties = await entryProperties(loader, entryName);
  const entryId = toInt(field(properties, "entry_key"));
  const controls = await entryControls(loader, entryId);
  const gridControl = controls.find((row) => text(row, "control_name").toLowerCase() === "c1dg_smallentrygrid");
  const shownControls = controls.filter((row) => flag(row, "add_visible")).map((row) => ({ name: text(row, "control_name").toLowerCase() } as EntryControl));
  const entryNat = entryNature(entryId, shownControls, state);
  const fillStyle = text(gridControl, entryNat === "A" ? "ctrl_fill_style_add" : "ctrl_fill_style_upd");
  const warnings: string[] = [];
  const labels = Object.fromEntries(controls.map((row) => [text(row, "control_name").toLowerCase(), text(row, "label_caption")]));
  let context: SysContext = { session, entryId, state, choices, entryNat, addonType: "", addonColumn: null, labels };
  // Func_ReplaceSysVal_CtrlValue: |sys.stk_module| is the stock module of the book chosen in the first combo.
  if (STK_MODULE_ENTRIES.has(entryId)) {
    const book = (await loader.readTable(`SELECT stkm_short FROM ${session.companySchema}.book_properties WHERE stkm_pos <> 'D' AND BTRIM(book_desc) = $1 LIMIT 1`, [(state.firstCombo?.text ?? "").trim()]))?.[0];
    context = { ...context, stkModule: text(book, "stkm_short") };
  }

  let sql = "";
  let balanceSql = "";
  let body: { row: Row; column: string; addon: boolean }[] = [];
  let multi: GridPlan["multi"] = null;
  for (const event of await firstComboEvents(loader, entryId)) {
    let select = DISTINCT_ENTRIES.has(entryId) ? "Select distinct " : "Select ";
    const eventId = toInt(field(event, "fill_grid_event_id"));
    const fillFor = text(event, "fill_column_for").toLowerCase();
    const eventBodyRows: { row: Row; column: string; addon: boolean }[] = [];
    if (eventId > 0) {
      const rows = await eventBody(loader, eventId);
      if (rows.length > 0 && fillFor !== "product_addon") {
        if (!fillStyle.includes("ColDS,")) warnings.push(`Fill style "${fillStyle}" (Col+) is not ported yet`);
        for (const row of rows) {
          select += String(field(row, "defa_formula") ?? "").trim();
          const restore = String(field(row, "field_restore") ?? "").trim();
          const restoreAs = String(field(row, "field_restore_as") ?? "").trim();
          const name = text(row, "field_name");
          const special = restore !== "" ? specialRestore(restore, context) : null;
          select += `${special ?? (restore !== "" ? restore : restoreAs !== "" ? restoreAs : name)},`;
          eventBodyRows.push({ row, column: (name !== "" ? name : restore).replace(/^.*\./, ""), addon: false });
        }
        if (fillStyle.includes("PRDMulAdd,")) {
          const added = await multipleAddon(loader, context, eventId);
          if (added) {
            multi = added.multi;
            context = { ...context, addonType: added.multi.addonType };
            select += added.select.map((item) => `${item},`).join("");
            eventBodyRows.push(...added.body);
          }
        } else if (fillStyle.includes("PARTYMulFld,")) {
          warnings.push("Fill style PARTYMulFld (party folders) is not ported yet");
        }
      }
      if (fillFor === "account_addon" || entryId === 53) warnings.push("Account addon columns are not ported yet");
      if (fillFor === "product_master_addon") {
        const fields = (await loader.readTable(`SELECT * FROM ${session.companySchema}.addon_fld WHERE fiel_relate = 'P' AND fiel_type = 'M' AND fiel_masterpos = 'Y' AND fiel_pos <> 'D' AND COALESCE(fiel_stkmdl, '') = '' ORDER BY fiel_key`)) ?? [];
        const added = addonColumns(fields, await addonBodyRows(loader, entryId), "adata", true);
        select += added.select.map((item) => `${item},`).join("");
        eventBodyRows.push(...added.body);
      }
    }

    const fill = String(field(event, "fill_control_query") ?? "");
    if (fill.trim() !== "") {
      if (fill.trim().toLowerCase().startsWith("from")) select = select.trim().replace(/,$/, "");
      if (fill.trim().toLowerCase().startsWith("select")) select = "";
      select += fill;
    }
    if (!/select/i.test(select) || select.length <= 10) continue;
    // The desktop's per-entry changes to the query (dates, Add / Update filters, order): gridSql.ts.
    const changed = entryGridSql(select, { context, date: (name) => dateOf(state.controls[name]) || defaultDate(entryId, name, session, now) });
    select = changed.sql;
    for (const warning of changed.warnings) if (!warnings.includes(warning)) warnings.push(warning);
    const ready = replaceEntryValues(quotedAliases(select), context, now);
    if (text(event, "control_type").toLowerCase() === "lbl") { balanceSql = ready; continue; }
    if (!fillStyle.includes("RecDS,")) { warnings.push(`Fill style "${fillStyle}" without RecDS is not ported yet`); continue; }
    // Each event binds the grid in turn, so the last one's query is the grid.
    sql = ready;
    body = eventBodyRows;
  }
  return { entryId, sql, balanceSql, body, multi, warnings, context };
}

// ---------------------------------------------------------------------------------------
// Setting_GridCol: the columns as the grid shows them

function columnFor(key: string, plan: GridPlan): EntryColumn {
  const lower = key.toLowerCase();
  const match = [...plan.body].reverse().find((item) => item.column.toLowerCase() === lower);
  const row = match?.row;
  const compulsory = flag(row, "value_compulsory");
  const align = text(row, "update_grid_align").toUpperCase();
  const fieldType = text(row, "field_type").toUpperCase();
  return {
    key,
    caption: row ? `${compulsory ? "* " : ""}${text(row, "head_grid") || key}` : key,
    width: toInt(field(row, "update_grid_width")) || 100,
    align: align === "R" || align === "C" ? align : fieldType === "N" || fieldType === "C" ? "R" : "L",
    visible: row ? flag(row, "update_grid_visible") : false,
    editable: row ? flag(row, "update_grid_editable") : false,
    fieldType,
    decimals: toInt(field(row, "decimal_points")),
    positiveOnly: flag(row, "number_positiveonly"),
    compulsory,
    addon: match?.addon ?? false,
    tooltip: text(row, "field_tooltips"),
    setup: publicSetup(toSetup(row ?? {})),
  };
}

/** The query's column names in order, without reading its rows. */
export async function planColumns(loader: Loader, plan: GridPlan): Promise<string[]> {
  if (plan.sql === "") return [];
  const result = await loader.client.query(`SELECT * FROM (${plan.sql}) q LIMIT 0`);
  return result.fields.map((item) => item.name);
}

export async function loadEntryGrid(loader: Loader, entryName: string, state: EntryState, choices: Readonly<Record<string, EntryOption>>): Promise<EntryGrid & { warnings: string[] }> {
  const plan = await gridPlan(loader, entryName, state, choices);
  const properties = await entryProperties(loader, entryName);
  // entry_properties.no_of_col_frozen: that many visible columns, from the left, stay put while
  // the grid scrolls sideways (the master's program_top.no_of_col_frozen). None when not set.
  const frozen = Math.max(0, toInt(field(properties, "no_of_col_frozen")));
  const warnings = [...plan.warnings];
  let balance = "";
  if (plan.balanceSql !== "") {
    const rows = await loader.readTable(plan.balanceSql);
    const first = rows?.[0];
    if (first) balance = toText(displayValue(Object.values(first)[0]));
  }
  if (plan.sql === "") return { columns: [], rows: [], frozen, balance, warnings: [...warnings, ...loader.warnings] };
  const result = await loader.client.query(plan.sql);
  const keys = result.fields.map((item) => item.name);
  // A combo column the operator can edit gets its list, as Setting_GridCol gives it one (combo_value F, L, Q, X).
  const columns = await Promise.all(keys.map(async (key) => {
    // Headings show in Proper Case, as the master's do (GST, PAN and other short forms kept in capitals).
    const setupColumn = columnFor(key, plan);
    // PostgreSQL's boolean (type 16) is the desktop's bit column: a tick box.
    const isBoolean = result.fields.find((item) => item.name === key)?.dataTypeID === 16;
    const column = { ...setupColumn, caption: properHeading(setupColumn.caption), ...(isBoolean ? { boolean: true } : {}) };
    const row = [...plan.body].reverse().find((item) => item.column.toLowerCase() === key.toLowerCase())?.row;
    if (!column.editable || !row || !["F", "L", "Q", "X"].includes(text(row, "combo_value").toUpperCase())) return column;
    return { ...column, options: await controlOptions(loader, row, plan.context) };
  }));
  const rows = result.rows.map((row: Row) => Object.fromEntries(keys.map((key) => [key, toText(displayValue(row[key]))])));
  // Entry Approved: a party over its credit days or limit is locked on the SALE - ORDER book (entry32.ts).
  if (plan.entryId === ENTRY_APPROVED) await lockStoppedParties(loader, rows, state.firstCombo?.text ?? "");
  // Bank Statement: Cmb_FirstCombo_Leave's fc_lostfocus_qry gives the bank book's balance; the passbook's follows from the rows.
  let finalAmount: string | undefined;
  if (plan.entryId === BANK_RECO) {
    const query = text(properties, "fc_lostfocus_qry");
    const first = query === "" ? undefined : (await loader.readTable(replaceEntryValues(query, plan.context)))?.[0];
    if (first) {
      const balances = bankBalances(Number(Object.values(first)[0]) || 0, rows);
      balance = balances.book;
      finalAmount = balances.passbook;
    }
  }
  // Small_Entry's Arrint_TrueCol: query_condition rows of event GV, for the columns this grid has.
  const conditions = (await loader.readTable(`SELECT qc_fieldname, qc_bn_fieldname, qc_variablename, qc_systemvalue FROM ${SETUP_SCHEMA}.query_condition WHERE BTRIM(qc_control_event) = 'GV' AND BTRIM(qc_prog_id) = $1`, [String(plan.entryId)])) ?? [];
  const hasColumn = (name: string) => keys.some((key) => key.toLowerCase() === name.toLowerCase());
  const tickRules = conditions
    .map((row) => ({ field: text(row, "qc_fieldname"), target: text(row, "qc_bn_fieldname"), control: text(row, "qc_variablename").toLowerCase(), untickBlank: text(row, "qc_systemvalue").toLowerCase() === "sys.false.blank" }))
    .filter((rule) => hasColumn(rule.field) && hasColumn(rule.target));
  return { columns, rows, frozen, balance, finalAmount, tickRules, warnings: [...warnings, ...loader.warnings] };
}

export { columnFor };
