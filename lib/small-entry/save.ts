import { allocateKey, primaryKeyField } from "../master-program/save";
import { runStatement } from "../master-program/statement";
import { ENTRY_APPROVED, isLocked, LOCKED_BOOK, lockStoppedParties, PARTY_STOP_MESSAGE } from "./entry32";
import { BANK_RECO, recoDateProblem } from "./bankReco";
import { Loader } from "../master-program/load";
import { formatDesktopDate, formatDesktopTime, parseDesktopDate, removeTableAlias, toInt, toText } from "../master-program/legacy";
import { readRights, SETUP_SCHEMA } from "../master-program/session";
import { columnFor, entryNature, entryProperties, gridPlan, PORTED_ENTRIES, planColumns, replaceEntryValues } from "./load";
import type { GridPlan, SysContext } from "./load";
import { roundEven } from "./text";
import type { EditedRow, EntryControl, EntryOption, EntryState, SaveOutcome } from "./types";

/**
 * Small_Entry.Save_Click for a grid saved row by row (entry_save_properties.multiple_save),
 * with Save_MultipleLoop_forGrid building each row's statements and SP_ENTRY_SAVE running
 * them: one transaction, all or nothing.
 *
 * Only rows the operator edited are sent (the desktop's UserData "E"). A row whose key
 * column (int_AddonPK_Col) holds a key is updated where its field_in_upd_where column
 * matches; one without is inserted, the key taken as max+1 because the tables came across
 * without IDENTITY. Godown Opening then saves each godown's column group the same way.
 */

type Row = Record<string, unknown>;
const field = Loader.field;
const text = (row: Row | undefined, name: string) => toText(field(row, name));
const flag = (row: Row | undefined, name: string) => field(row, name) === true;

export type SaveRequest = Readonly<{
  entryName: string;
  menuShortName: string;
  state: EntryState;
  choices: Readonly<Record<string, EntryOption>>;
  rows: readonly EditedRow[];
  dryRun?: boolean;
  editPassword?: string;
}>;

export type EntrySaveResult = SaveOutcome & { needs?: "edit-password" };

/** int_AddonPK_Col is 1 for these entries, 2 for the rest (the grid's first data column is 1). */
const PK_IN_FIRST_COLUMN = new Set([18, 20, 21, 22, 23, 24, 25, 27, 29, 30, 32, 33, 35, 37, 38, 39, 40, 41, 43, 44, 48, 54, 56, 58, 61, 62, 103, 116]);

/** A statement to run: plain SQL, or an INSERT whose key may still need allocating. */
type Statement = Readonly<{ sql: string; insert?: Readonly<{ table: string; fields: string[]; values: string[] }> }>;

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** A number from a grid cell: "" stays "", anything that is not a number is refused. */
function numberText(value: string, label: string): string {
  const plain = value.replace(/,/g, "").trim();
  if (plain === "") return "";
  if (!/^-?\d+(\.\d+)?$/.test(plain)) throw new Error(`"${value}" is not a number (${label})`);
  return plain;
}

const decimal = (value: string) => Number(value.replace(/,/g, "").trim()) || 0;

/** The grid value of a column, whatever case the query gave its name. */
function cell(values: Readonly<Record<string, string>>, name: string): string | undefined {
  if (name in values) return values[name];
  const lower = name.toLowerCase();
  const key = Object.keys(values).find((candidate) => candidate.toLowerCase() === lower);
  return key === undefined ? undefined : values[key];
}

type LoopOptions = Readonly<{
  pkColumn: string;
  /** z_str_FieldName_1 / _2: the quantity and rate columns sys.open_* and sys.clsg_* read. */
  quantityColumn: string;
  rateColumn: string;
  context: SysContext;
}>;

/** Save_MultipleLoop_forGrid for one column group, every edited row. */
function saveLoop(rules: readonly Row[], rows: readonly EditedRow[], plan: GridPlan, keys: readonly string[], options: LoopOptions, entryNat: string, warnings: string[], savedRows: Set<number>): Statement[] {
  const statements: Statement[] = [];
  const whereRows = plan.body.filter((item) => !item.addon && flag(item.row, "field_in_upd_where"));
  const multiKey = plan.multi?.fieldKey ?? 0;

  rows.forEach((edited, rowIndex) => {
    const values = edited.values;
    const pk = toInt(cell(values, options.pkColumn));
    if (edited.deleted && pk === 0) return;
    let queryType = edited.deleted ? "D" : pk > 0 ? "U" : "I";

    // ArrInt_Upd_WhereCol: the field_in_upd_where columns, by their field type.
    const whereParts: string[] = [];
    for (const item of whereRows) {
      const name = removeTableAlias(text(item.row, "field_name"));
      let value: string;
      if (multiKey > 0 && /_key$/i.test(name)) value = String(pk);
      else {
        const raw = cell(values, item.column) ?? "";
        switch (text(item.row, "field_type").toUpperCase()) {
          case "C": case "I": case "N": value = numberText(raw, item.column) || "null"; break;
          case "D": { const date = parseDesktopDate(raw); value = date ? quote(formatDesktopDate(date)) : "null"; break; }
          default: value = quote(raw.trim());
        }
      }
      whereParts.push(`${name}=${value}`);
    }
    let where = whereParts.join(" and ");

    let table = "";
    let tableOrder = 0;
    let fields: string[] = [];
    let fieldValues: string[] = [];
    let sets: string[] = [];
    const flush = () => {
      if (table === "") return;
      if (queryType === "I") {
        if (fields.length > 0) statements.push({ sql: "", insert: { table, fields, values: fieldValues } });
      } else if (queryType === "D") {
        if (where !== "") statements.push({ sql: `Delete from ${table} where ${where}` });
      } else if (sets.length > 0 && where !== "") {
        statements.push({ sql: `Update ${table} set ${sets.join(",")} where ${where}` });
      }
      if (fields.length > 0 || sets.length > 0 || queryType === "D") savedRows.add(rowIndex);
      fields = []; fieldValues = []; sets = [];
    };

    for (const rule of rules) {
      const ruleTable = text(rule, "table_name");
      const order = toInt(field(rule, "table_order"));
      if (ruleTable.toUpperCase() !== table.toUpperCase() || (tableOrder > 0 && tableOrder !== order)) {
        if (table !== "") { flush(); queryType = text(rule, "query_update_type").toUpperCase(); }
        if (text(rule, "query_add_type").toUpperCase() === "S") { warnings.push(`Save rule ${text(rule, "entrysave_key")} (a query_add_type S statement) is not ported yet`); continue; }
        table = ruleTable.toLowerCase();
        tableOrder = order;
      }
      if ((entryNat === "A" && !flag(rule, "add_save")) || (entryNat === "U" && !flag(rule, "update_save"))) continue;
      if (text(rule, "codepost_para") !== "") { warnings.push(`Account / product posting (codepost_para) of save rule ${text(rule, "entrysave_key")} is not ported yet`); continue; }

      const queryWhere = text(rule, "query_where");
      if (queryWhere !== "") {
        where = replaceEntryValues(queryWhere, options.context).replace(/\{([^}]+)\}/g, (all, name: string) => cell(values, name) ?? all);
        if (pk > 0) where = where.replace(/@pkval_1/gi, String(pk)).replace(/\|sys\.grid_pk\|/gi, String(pk));
        where = where.replace(/^\s*where\s+/i, "");
      }
      if (queryType === "D") continue;
      const name = text(rule, "save_field_name") || text(rule, "column_name");
      if (name === "") { if (text(rule, "query_value") !== "") warnings.push(`Save rule ${text(rule, "entrysave_key")} (a query_value statement) is not ported yet`); continue; }

      const dataType = text(rule, "save_data_type").toUpperCase();
      let value = "";
      const fixed = String(field(rule, "add_fixvalue") ?? "");
      const column = text(rule, "column_name");
      const system = text(rule, "system_value");
      if (fixed.length > 0) {
        const left = toInt(field(rule, "save_leftchrno"));
        switch (dataType) {
          case "T": value = left > 0 ? quote(fixed.slice(0, left)) : fixed.startsWith("(case when ") ? fixed : quote(fixed); break;
          case "D": { const date = parseDesktopDate(fixed); value = date ? quote(formatDesktopDate(date)) : "null"; break; }
          case "C": value = cell(values, "Tick") !== undefined && cell(values, "Tick") !== "True" ? "0" : fixed; break;
          default: value = fixed;
        }
      } else if (text(rule, "save_upd_formula") !== "") {
        value = text(rule, "save_upd_formula").replace(/\{([^}]+)\}/g, (_all, source: string) => String(decimal(cell(values, source) ?? "")));
      } else if (column !== "" && cell(values, column) !== undefined) {
        const raw = cell(values, column) ?? "";
        switch (dataType) {
          case "T": { const left = toInt(field(rule, "save_leftchrno")); value = quote(left > 0 ? raw.slice(0, left) : raw); break; }
          case "I": { const key = cell(values, `${column}__key`); value = numberText(key ?? raw, column) || "null"; break; }
          case "C": case "N": value = numberText(raw, column) || "0"; break;
          case "D": {
            // A grid with a Tick column saves the date only on a ticked row; an unticked one is cleared (Save_MultipleLoop_forGrid).
            const tick = cell(values, "Tick");
            const date = parseDesktopDate(raw);
            value = tick !== undefined && tick.trim().toLowerCase() !== "true" ? "null" : date ? quote(formatDesktopDate(date)) : "null";
            break;
          }
          default: value = quote(raw);
        }
      } else if (system !== "") {
        value = systemValue(system, values, options, queryType);
        if (value === "" && system.toLowerCase().includes("sys.")) {
          value = replaceEntryValues(system.trim().startsWith("|") ? system : `|${system}|`, options.context);
          if (/\|sys\./i.test(value)) { warnings.push(`${system} is not ported yet; ${name} saved as its default`); value = ""; }
        }
      }
      if (value.trim() === "") value = dataType === "T" ? "''" : dataType === "C" || dataType === "N" ? "0" : "null";
      if ((value === "@pkval_1" || value === "|@pkval_1|") && pk > 0) value = String(pk);
      if (queryType === "I") { fields.push(name); fieldValues.push(value); } else sets.push(`${name}=${value}`);
    }
    flush();
  });
  return statements;
}

/** The sys.open_* / sys.clsg_* / sys.grid_pk values Save_MultipleLoop_forGrid works out itself. */
function systemValue(system: string, values: Readonly<Record<string, string>>, options: LoopOptions, queryType: string): string {
  const key = system.trim().toLowerCase();
  const base = (name: string) => decimal(cell(values, name) ?? "");
  const factor = () => decimal(numberText(cell(values, options.quantityColumn) ?? "", options.quantityColumn));
  const update = queryType === "U";
  if (key === "sys.grid_pk" || key === "|sys.grid_pk|") return String(toInt(cell(values, options.pkColumn)));
  if (key.startsWith("sys.open_")) {
    if (key === "sys.open_rate") return String(decimal(numberText(cell(values, options.rateColumn) ?? "", options.rateColumn)));
    const amount = factor();
    switch (key) {
      case "sys.open_pcs": return String(amount);
      case "sys.open_pack": return base("base_pack") > 0 ? roundEven(amount / base("base_pack")) : "0";
      case "sys.open_weight": return base("base_weight") > 0 ? roundEven(amount / base("base_weight")) : "0";
      case "sys.open_qty1": return roundEven(amount * base("base_qty1"));
      case "sys.open_qty2": return roundEven(amount * base("base_qty2"));
      case "sys.open_qty3": return roundEven(amount * base("base_qty3"));
    }
    return "";
  }
  if (key.startsWith("sys.clsg_")) {
    const amount = factor();
    const tail = (unit: string) => (update ? `+add_${unit}-less_${unit}` : "");
    switch (key) {
      case "sys.clsg_pcs": return `${amount}${tail("pcs")}`;
      case "sys.clsg_pack": return base("base_pack") > 0 ? `${roundEven(amount / base("base_pack"))}${tail("pack")}` : update ? "add_pack-less_pack" : "";
      case "sys.clsg_weight": return base("base_weight") > 0 ? `${roundEven(amount / base("base_weight"))}${tail("weight")}` : update ? "add_weight-less_weight" : "";
      case "sys.clsg_qty1": return `${roundEven(amount * base("base_qty1"))}${tail("qty1")}`;
      case "sys.clsg_qty2": return `${roundEven(amount * base("base_qty2"))}${tail("qty2")}`;
      case "sys.clsg_qty3": return `${roundEven(amount * base("base_qty3"))}${tail("qty3")}`;
    }
  }
  return "";
}

// ---------------------------------------------------------------------------------------
// The special log (setup.logfile = 'S'): one LOG_SMALLENTRY row per saved grid row

async function specialLog(loader: Loader, entryId: number, request: SaveRequest, controls: readonly EntryControl[], plan: GridPlan, keys: readonly string[], firstLabel: string, rows: readonly EditedRow[], savedRows: ReadonlySet<number>, pkColumn: string, queryTypeOf: (row: EditedRow) => string): Promise<string[]> {
  const { session, client } = loader;
  const schema = `${session.companySchema}_biglog`;
  const columns = new Set(((await loader.readTable("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'log_smallentry'", [schema])) ?? []).map((row) => text(row, "column_name").toLowerCase()));
  if (columns.size === 0) { loader.warnings.push(`Special log skipped: ${schema}.log_smallentry does not exist in PostgreSQL`); return []; }
  const now = new Date();
  const q = '"';
  const top = [`${q}!${firstLabel}${q}: ${q}${request.state.firstCombo?.text ?? ""}${q}`, `${q}user${q}: ${q}${session.loginName}${q}`, `${q}save date${q}: ${q}${formatDesktopDate(now)}${q}`, `${q}save time${q}: ${q}${formatDesktopTime(now)}${q}`, `${q}machine${q}: ${q}WEB${q}`];
  for (const control of controls) top.push(`${q}${control.label}${q}: ${q}${request.state.controls[control.name] ?? ""}${q}`);
  const topText = `[{${top.join(",")}}]`;
  const written: string[] = [];
  for (const [index, edited] of rows.entries()) {
    if (!savedRows.has(index)) continue;
    let start = "";
    let details = "";
    let updWhere = "";
    let updDatabase = "";
    for (const key of keys) {
      const column = columnFor(key, plan);
      const item = [...plan.body].reverse().find((candidate) => candidate.column.toLowerCase() === key.toLowerCase());
      const row = item?.row;
      const value = cell(edited.values, key) ?? "";
      const saved = flag(row, "field_save_add") || flag(row, "field_save_update");
      if (!column.visible) {
        if (flag(row, "field_in_upd_where")) {
          updDatabase = text(row, "database_name");
          updWhere += `${updWhere === "" ? "" : ","}Row: ${String(index + 1).padStart(5, "0")} - ${value}`;
          start += `[{${q}!*${text(row, "database_name")}${q}: ${q}${value}${q},${q}Row${q}: ${q}${String(index + 1).padStart(5, "0")}${q}`;
        }
        continue;
      }
      const mark = column.editable ? "** " : saved ? "** " : "";
      const shown = column.fieldType === "N" ? Number(value.replace(/,/g, "") || 0).toLocaleString("en-US", { minimumFractionDigits: Math.min(5, column.decimals), maximumFractionDigits: Math.min(5, column.decimals) }) : value;
      details += `,${q}${mark}${column.caption}${q}: ${q}${shown}${q}`;
    }
    const grid = `${start}${details}}]`;
    const pkv = toInt(cell(edited.values, pkColumn));
    const previous = columns.has("lsmall_pkv") ? await loader.readTable(`SELECT 1 FROM ${schema}.log_smallentry WHERE lsmall_smallid = $1 AND lsmall_pkv = $2 LIMIT 1`, [entryId, pkv]) : null;
    const choice = (name: string) => controls.some((control) => control.name === name) ? (request.state.controls[name] ?? "") : "";
    const date = (name: string) => { const parsed = parseDesktopDate(request.state.controls[name] ?? ""); return parsed ? formatDesktopDate(parsed) : formatDesktopDate(now); };
    const all: Record<string, unknown> = {
      lsmall_smallid: entryId, lsmall_top: topText, lsmall_grid: grid.length < 10 ? "" : grid, lsmall_addon: "", lsmall_fields: "",
      lsmall_upddatabase: updDatabase, lsmall_updwhere: updWhere,
      lsmall_user: session.userNo, lsmall_firstname: request.state.firstCombo?.text ?? "", lsmall_firstvalue: toInt(request.state.firstCombo?.value),
      lsmall_savedate: formatDesktopDate(now), lsmall_savetime: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }), lsmall_machine_name: "WEB",
      lsmall_fc_selection: request.state.firstCombo?.text ?? "", lsmall_group: choice("cmb_smallentry1"), lsmall_filter: choice("cmb_smallentry2"), lsmall_sorting: choice("cmb_smallentry3"),
      lsmall_from: date("dtp_date"), lsmall_upto: date("dtp_date2"), lsmall_pkv: pkv, lsmall_mode: previous ? (queryTypeOf(edited) === "U" ? "E" : "D") : "A",
    };
    const names = Object.keys(all).filter((name) => columns.has(name));
    await runStatement(client, `INSERT INTO ${schema}.log_smallentry (${names.join(",")}) VALUES (${names.map((_, at) => `$${at + 1}`).join(",")})`, names.map((name) => all[name]));
    written.push(`log_smallentry row for ${pkv}`);
  }
  return written;
}

// ---------------------------------------------------------------------------------------

export async function saveEntry(loader: Loader, request: SaveRequest): Promise<EntrySaveResult> {
  const { session, client } = loader;
  const warnings: string[] = [];
  const fail = (message: string, extra: Partial<EntrySaveResult> = {}): EntrySaveResult => ({ ok: false, message, statements: [], dryRun: request.dryRun === true, warnings, ...extra });

  const properties = await entryProperties(loader, request.entryName);
  const entryId = toInt(field(properties, "entry_key"));
  if (!PORTED_ENTRIES.has(entryId)) return fail(`Saving ${request.entryName} is not ported to the web yet`);

  // Rights: bl_EditRights, then the edit password (u_pass_2) when one is set.
  const rights = await readRights(client, session, `Menu-${request.menuShortName}`);
  if (!rights.edit) return fail("Entry Rights Not Available For User");
  if (rights.editPassword !== "" && (request.editPassword ?? "") !== rights.editPassword) return fail("Edit password required", { needs: "edit-password" });
  if (request.rows.length === 0) return fail("Nothing has been changed");

  // Bank Statement: a reconciliation date falls within 90 days after the entry (checked again here, not only on screen).
  if (entryId === BANK_RECO) {
    for (const row of request.rows) {
      const problem = recoDateProblem(cell(row.values, "doc_date") ?? "", cell(row.values, "reco_date") ?? "");
      if (problem !== "") return fail(`${problem} (${cell(row.values, "full_docno") ?? ""})`);
    }
  }

  // Entry Approved: an order of a locked party (over its credit days or limit) is never approved.
  // The lock is worked out again here from the database, not taken from the browser.
  if (entryId === ENTRY_APPROVED && (request.state.firstCombo?.text ?? "").trim() === LOCKED_BOOK) {
    const approving = request.rows.filter((row) => !row.deleted && (cell(row.values, "ENT_APPROVE") ?? "").trim().toUpperCase().startsWith("Y"));
    const checked = approving.map((row) => ({ ...row.values, allowed: "", lock_status: "" }));
    await lockStoppedParties(loader, checked, LOCKED_BOOK);
    const stopped = approving.find((row, at) => isLocked(row.values) || isLocked(checked[at]));
    if (stopped) return fail(`${PARTY_STOP_MESSAGE}: ${cell(stopped.values, "name") ?? ""} ${cell(stopped.values, "full_docno") ?? ""}`.trim());
  }

  const plan = await gridPlan(loader, request.entryName, request.state, request.choices);
  warnings.push(...plan.warnings);
  const keys = await planColumns(loader, plan);
  const controlRows = (await loader.readTable(`SELECT control_name, label_caption FROM ${SETUP_SCHEMA}.entry_control WHERE entry_id = $1 AND add_visible AND (add_active OR update_active) ORDER BY field_add_order`, [entryId])) ?? [];
  const controls = controlRows.map((row) => ({ name: text(row, "control_name").toLowerCase(), label: text(row, "label_caption") } as EntryControl)).filter((control) => /^(cmb_smallentry|dtp_date|tbx_text)/.test(control.name));
  const entryNat = entryNature(entryId, controls, request.state);

  const rules = (await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.entry_save_properties WHERE entrykey_id = $1 AND record_active AND ${entryNat === "A" ? "add_save" : "update_save"} ORDER BY save_order, table_order, field_order`, [entryId])) ?? [];
  if (rules.length === 0) return fail("Record Posting Base File not found... Entry saving fail...");

  const pkColumn = keys[(PK_IN_FIRST_COLUMN.has(entryId) ? 1 : 2) - 1] ?? "";
  const baseContext: SysContext = { session, entryId, state: request.state, choices: request.choices, entryNat, addonType: plan.multi?.addonType ?? "", addonColumn: null };
  const searchFields = plan.multi?.searchFields ?? [];
  const quantityColumn = keys.find((key) => key.toLowerCase() === (searchFields[0] ?? "open_pcs").toLowerCase()) ?? "open_pcs";
  const rateColumn = keys.find((key) => key.toLowerCase() === (searchFields[1] ?? "open_rate").toLowerCase()) ?? "open_rate";

  const statements: Statement[] = [];
  const savedRows = new Set<number>();
  const maxOrder = Math.max(...rules.map((rule) => toInt(field(rule, "save_order"))));
  for (let order = 1; order <= maxOrder; order += 1) {
    const group = rules.filter((rule) => toInt(field(rule, "save_order")) === order);
    if (group.length === 0 || text(group[0], "query_add_type").toUpperCase() === "S") continue;
    if (!flag(group[0], "multiple_save")) { warnings.push(`Header save rules (save_order ${order}) are not ported yet`); continue; }
    if (text(group[0], "grid_name").toLowerCase() === "c1dg_smallentrygrid") {
      statements.push(...saveLoop(group, request.rows, plan, keys, { pkColumn, quantityColumn, rateColumn, context: baseContext }, entryNat, warnings, order === 1 ? savedRows : new Set()));
    }
    if (entryId === 11 && plan.multi) {
      for (const godown of plan.multi.groups) {
        const context: SysContext = { ...baseContext, addonColumn: { fieldKey: plan.multi.fieldKey, subCode: godown.subCode } };
        statements.push(...saveLoop(group, request.rows, plan, keys, { pkColumn: godown.pk, quantityColumn: godown.qty, rateColumn: godown.rate, context }, entryNat, warnings, order === 1 ? savedRows : new Set()));
      }
    }
  }
  if (statements.length === 0) return fail("No statement to save", {});

  // SP_ENTRY_SAVE: every statement in one transaction; a dry run rolls it all back.
  const executed: string[] = [];
  await client.query("SAVEPOINT small_entry_save");
  try {
    for (const statement of statements) {
      let sql = statement.sql;
      if (statement.insert) {
        const { table, fields, values } = statement.insert;
        const keyField = await primaryKeyField(loader, table.toUpperCase());
        const has = (name: string) => fields.some((item) => item.toLowerCase() === name.toLowerCase());
        const key = keyField !== "" && has(keyField) ? null : await allocateKey(client, session.companySchema, table, keyField);
        const allFields = key && !has(key.column.replace(/"/g, "")) ? [key.column, ...fields] : fields;
        const allValues = key && !has(key.column.replace(/"/g, "")) ? [String(key.value), ...values] : values;
        sql = `Insert into ${session.companySchema}.${table} (${allFields.join(",")}) values (${allValues.join(",")})`;
      } else {
        sql = sql.replace(/^(Update|Delete from) (\w+)/i, (_all, verb: string, table: string) => `${verb} ${session.companySchema}.${table}`);
      }
      await runStatement(client, sql);
      executed.push(sql);
    }
    if (session.flags.logFileSpecial) {
      const queryTypeOf = (edited: EditedRow) => (edited.deleted ? "D" : toInt(cell(edited.values, pkColumn)) > 0 ? "U" : "I");
      executed.push(...await specialLog(loader, entryId, request, controls, plan, keys, text(properties, "first_label_caption"), request.rows, savedRows, pkColumn, queryTypeOf));
    }
    if (request.dryRun) await client.query("ROLLBACK TO SAVEPOINT small_entry_save");
    else await client.query("RELEASE SAVEPOINT small_entry_save");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT small_entry_save");
    return fail(`Entry unable to Save... Save not successful... ${error instanceof Error ? error.message : String(error)}`, { statements: executed });
  }
  warnings.push(...loader.warnings);
  return { ok: true, message: request.dryRun ? "Dry run: every statement ran and was rolled back" : `${savedRows.size} row(s) saved`, statements: executed, dryRun: request.dryRun === true, warnings };
}
