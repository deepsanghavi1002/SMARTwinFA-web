import type { Client } from "pg";
import { requiredEditRights } from "./access";
import type { SysValueContext } from "../sys-values";
import { isNumeric, parseDesktopDate, removeTableAlias, runFormula, securityRead, securityWrite, toDecimal, toInt, toText, writePw, formatDesktopDate, formatDesktopTime } from "./legacy";
import { displayValue, Loader, loadContext, prepareProgram, replaceControlValues, updateColumnShown } from "./load";
import type { BodyRow, PreparedProgram } from "./load";
import { columnName, replaceSessionValues } from "./sql";
import { readRights, SETUP_SCHEMA, SYSTEM_SCHEMA } from "./session";
import type { GroupState } from "./types";
import { cloudPushFor, replicateAdd, replicateEdit } from "./replicate";
import type { CloudPush } from "./replicate";
import { cleanMainValue, isMainField } from "./main-field";

/**
 * Btn_Master_AddSave_Click, Btn_Master_EditSave_Click and Selected_RowDelete.
 *
 * The desktop builds each INSERT and UPDATE as text from c1dg_SaveGrid and hands them to
 * SP_Master_Insert / SP_MASTER_UPDATE_DATA. This module builds the same statements from
 * the same setup and runs them on one connection, inside one transaction, so a save that
 * fails part way leaves nothing half written (the desktop committed table by table).
 *
 * PostgreSQL differences handled here, and only here:
 *  - The migrated tables have no IDENTITY, so a new row's key is allocated as max+1
 *    under a table lock and written explicitly.
 *  - Values typed into cells have their quotes doubled; the desktop instead refused the
 *    quote key.
 *  - The few statements the C# writes in T-SQL (TOP 1, UPDATE ... FROM JOIN, '+' to join
 *    text) are written in PostgreSQL.
 *
 * What is not ported here is listed at the bottom of the file.
 */

type Row = Record<string, unknown>;
const field = Loader.field;
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** A row of c1dg_SaveGrid. */
type SaveRow = {
  mode: "A" | "E" | "D";
  table: string;
  field: string;
  /** The setup row the value comes from; null for table_properties rows (Save_RowColNo 0). */
  source: BodyRow | null;
  fixValue: string;
  sysValue: string;
  queryString: string;
  fieldType: string;
  updFieldValue: string;
  fieldInUpdWhere: string;
  valueDependOn: string;
};

const SYSTEM_TABLE_PROGRAMS_ADD = [20, 30, 37, 52];
const SYSTEM_TABLE_PROGRAMS_EDIT = [20, 30, 34, 37, 52];

export type SaveResult = Readonly<{
  ok: boolean;
  message: string;
  /** Rights or password problem the screen must resolve before trying again. */
  needs?: "add-password" | "edit-password" | "delete-password" | "book-add-password" | "book-edit-password" | "book-delete-password";
  statements: readonly string[];
  keys?: readonly number[];
  dryRun: boolean;
  warnings: readonly string[];
  /** Licence 7: the saved master can be sent to Ezeone (the screen asks first on Add). */
  cloud?: CloudPush;
}>;

// ---------------------------------------------------------------------------------------
// Rights (MENUWISE and, for accounts, BOOKWISE)

type RightKind = "add" | "edit" | "delete";

async function checkRights(loader: Loader, programId: number, menuShortName: string, group: GroupState, kind: RightKind, passwords: Readonly<Record<string, string>>): Promise<SaveResult | null> {
  const denied = (message: string): SaveResult => ({ ok: false, message, statements: [], dryRun: false, warnings: [] });
  const position = kind === "add" ? 2 : kind === "edit" ? 4 : 6;
  const passColumn = kind === "add" ? "u_pass_1" : kind === "edit" ? "u_pass_2" : "u_pass_3";
  const label = kind === "add" ? "Add" : kind === "edit" ? "Edit" : "Delete";
  const rows = (await loader.client.query(`SELECT u_module, u_roll_id, u_pass_1, u_pass_2, u_pass_3 FROM ${SYSTEM_SCHEMA}.security WHERE u_id = $1 ORDER BY security_key`, [loader.session.userNo])).rows as Row[];
  if (rows.length === 0) return null; // dt_compmenurights is null: the desktop skips every check.

  const check = async (moduleName: string, message: string, needs: SaveResult["needs"]): Promise<SaveResult | null> => {
    const encoded = securityWrite(moduleName, 0);
    const row = rows.find((candidate) => toText(field(candidate, "u_module")) === encoded);
    const roll = toText(field(row, "u_roll_id"));
    const granted = !row || roll.length <= position || securityRead(roll.charAt(position), position + 1) !== "0";
    if (!granted) return denied(message);
    const stored = toText(field(row, passColumn));
    if (row && stored !== "") {
      const expected = securityRead(stored, 0);
      if ((passwords[needs ?? ""] ?? "") !== expected) return { ...denied(`${label} password required`), needs };
    }
    return null;
  };

  const menuRights = await readRights(loader.client, loader.session, `Menu-${menuShortName}`);
  if (!(kind === "add" ? menuRights.add : kind === "edit" ? menuRights.edit : menuRights.delete)) return denied(`Master ${label} Rights Not Available For User`);
  if (programId === 14) {
    const book = await check(`Book-${group.firstCombo.text}`, `${group.firstCombo.text} ${label} Rights Not Available For User`, `book-${kind}-password` as SaveResult["needs"]);
    if (book) return book;
  }
  return check(`Menu-${menuShortName}`, `Master ${label} Rights Not Available For User`, `${kind}-password` as SaveResult["needs"]);
}

// ---------------------------------------------------------------------------------------
// c1dg_SaveGrid

async function buildSaveGrid(loader: Loader, prepared: PreparedProgram, addTabVisible: boolean) {
  const rows: SaveRow[] = [];
  const updateTables: string[] = [];
  const addTables: string[] = [];
  const whereFields: BodyRow[] = [];

  // Setting_GridCol: Save_Mode E for field_save_update
  for (const row of prepared.updateBody) {
    if (row.field_in_upd_where) whereFields.push(row);
    if (!row.field_save_update) continue;
    const table = row.database_name.trim();
    rows.push({ mode: "E", table, field: removeTableAlias(row.field_name.trim()), source: row, fixValue: "", sysValue: "", queryString: "", fieldType: "", updFieldValue: "", fieldInUpdWhere: String(row.field_in_upd_where), valueDependOn: "" });
    if (!updateTables.includes(table)) updateTables.push(table);
  }
  // Cmb_Master_GroupFld_Leave: Save_Mode A for field_save_add
  for (const row of prepared.addBody) {
    if (!row.field_save_add) continue;
    const table = row.database_name.trim();
    rows.push({ mode: "A", table, field: removeTableAlias(row.field_name.trim()), source: row, fixValue: "", sysValue: "", queryString: "", fieldType: "", updFieldValue: "", fieldInUpdWhere: "", valueDependOn: "" });
    if (!addTables.includes(table)) addTables.push(table);
  }
  // ReadTableProperties: the columns saved without being on either grid
  for (const table of addTabVisible ? addTables : updateTables) {
    const properties = await loader.readTable(`SELECT * FROM ${SETUP_SCHEMA}.table_properties WHERE BTRIM(table_name) = $1 AND record_active`, [table]);
    for (const property of properties ?? []) {
      const tableName = toText(field(property, "table_name"));
      const column = removeTableAlias(toText(field(property, "column_name")));
      const key = `${tableName}-${column}`.toUpperCase();
      let index = rows.findIndex((row) => `${row.table}-${row.field}`.toUpperCase() === key);
      if (index >= 0 && rows[index].mode === "E") index = rows.findIndex((row, at) => at > index && `${row.table}-${row.field}`.toUpperCase() === key);
      if (index >= 0) continue;
      const base = { table: tableName, field: column, source: null, sysValue: toText(field(property, "system_value")), queryString: String(field(property, "query_value") ?? ""), fieldType: toText(field(property, "column_type")), updFieldValue: toText(field(property, "save_updfldvalue")), valueDependOn: toText(field(property, "value_depend_on")) };
      if (field(property, "add_save") === true) rows.push({ ...base, mode: "A", fixValue: toText(field(property, "add_fixvalue")), fieldInUpdWhere: "" });
      if (field(property, "update_save") === true) rows.push({ ...base, mode: "E", fixValue: toText(field(property, "update_fixvalue")), fieldInUpdWhere: String(field(property, "field_in_upd_where") === true) });
    }
  }
  return { rows, updateTables, addTables, whereFields };
}

const columnTypes = new WeakMap<Loader, Map<string, string>>();

/** information_schema's data_type for a column, cached for the request. */
async function columnType(loader: Loader, schema: string, table: string, column: string): Promise<string> {
  let cache = columnTypes.get(loader);
  if (!cache) { cache = new Map(); columnTypes.set(loader, cache); }
  const key = `${schema}.${table}.${column}`.toLowerCase();
  if (!cache.has(key)) {
    const rows = await loader.readTable("SELECT data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND LOWER(column_name) = $3", [schema, table.toLowerCase(), column.toLowerCase()]);
    cache.set(key, toText(field(rows?.[0], "data_type")));
  }
  return cache.get(key) ?? "";
}

export async function primaryKeyField(loader: Loader, table: string): Promise<string> {
  const rows = await loader.readTable(`SELECT pk_field_1 FROM ${SETUP_SCHEMA}.database_keys WHERE BTRIM(primary_table_name) = $1 AND rec_type = 'P'`, [table]);
  return toText(field(rows?.[0], "pk_field_1"));
}

/**
 * The key a new row gets. The tables came across from SQL Server without their
 * IDENTITY, so the next number is taken under a lock that stops two saves taking it twice.
 * The key column is the database_keys one, or the table's first column when it is a *_key.
 */
export async function allocateKey(client: Client, schema: string, table: string, keyField: string): Promise<{ column: string; value: number } | null> {
  let column = keyField.trim();
  if (column === "") {
    const first = (await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position LIMIT 1`, [schema, table.toLowerCase()])).rows[0];
    if (!first || !/_key$/i.test(first.column_name) || !/int/.test(first.data_type)) return null;
    column = first.column_name;
  }
  const actual = (await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND LOWER(column_name) = LOWER($3)`, [schema, table.toLowerCase(), column])).rows[0];
  if (!actual) return null;
  const name = actual.column_name === actual.column_name.toLowerCase() ? actual.column_name : `"${actual.column_name}"`;
  await client.query(`LOCK TABLE ${schema}.${table.toLowerCase()} IN SHARE ROW EXCLUSIVE MODE`);
  const next = (await client.query(`SELECT COALESCE(MAX(${name}), 0) + 1 AS next FROM ${schema}.${table.toLowerCase()}`)).rows[0];
  return { column: name, value: Number(next.next) };
}

/** Adds the allocated key to an INSERT that does not already name the key column. */
async function withAllocatedKey(loader: Loader, schema: string, table: string, keyField: string, fields: string[], values: string[]): Promise<number | null> {
  const key = await allocateKey(loader.client, schema, table, keyField);
  if (!key) return null;
  const at = fields.findIndex((name) => name.replace(/"/g, "").toLowerCase() === key.column.replace(/"/g, "").toLowerCase());
  if (at >= 0) {
    if (values[at] === "null" || values[at] === "''" || values[at] === "" || values[at] === "0") values[at] = String(key.value);
    else return toInt(values[at]);
  } else {
    fields.unshift(key.column);
    values.unshift(String(key.value));
  }
  return key.value;
}

// ---------------------------------------------------------------------------------------
// Add save

export type AddFieldInput = Readonly<{ fieldName: string; fieldInput: string; fieldComboValue: string; visible: boolean; editable: boolean }>;

export type AddSaveRequest = Readonly<{
  programName: string;
  menuShortName: string;
  group: GroupState;
  restoreMode: boolean;
  rows: readonly AddFieldInput[];
  passwords?: Readonly<Record<string, string>>;
  dryRun?: boolean;
}>;

type LogCollector = { fields: string; values: string };

function collectLog(log: LogCollector, logShort: string, value: string, pk: number) {
  const add = (column: string, text: string) => { if (!log.fields.includes(`${column},`)) { log.fields += `${column},`; log.values += `${text},`; } };
  const truncated = (limit: number) => {
    let text = value;
    if (text.length > limit) { text = text.slice(0, limit); if (text.includes("'")) text += "'"; }
    return text.includes("'") ? text : `'${text}'`;
  };
  switch (logShort.toLowerCase().trim()) {
    case "short": add("lmst_short", truncated(29)); break;
    case "name": add("lmst_name", value.includes("'") ? value : `'${value}'`); break;
    case "head": add("lmst_head", truncated(39)); break;
    case "open": add("lmst_opening", value); break;
    case "rate": case "amt": add("lmst_amount", value); break;
    case "uom": add("lmst_uomid", value); break;
    case "pkv": add("lmst_pk", isNumeric(value, true) ? value : String(pk)); break;
    default: {
      const date = /^dt([1-7])$/.exec(logShort.toLowerCase().trim());
      if (date) add(`lmst_date${date[1]}`, value.includes("'") || value.toLowerCase() === "null" ? value : `'${value}'`);
    }
  }
}

export async function addSave(client: Client, loader: Loader, request: AddSaveRequest): Promise<SaveResult> {
  const { session } = loader;
  const statements: string[] = [];
  const dryRun = request.dryRun === true;
  const prepared = await prepareProgram(loader, request.programName, request.group);
  const { programId } = prepared;
  const top = prepared.top;

  // The main field is stored without trailing blanks or characters nobody can see (Alt+255 and the like).
  const mainFields = new Set(prepared.addBody.filter(isMainField).map((row) => row.field_name.trim().toUpperCase()));
  request = { ...request, rows: request.rows.map((row) => (mainFields.has(row.fieldName.trim().toUpperCase()) ? { ...row, fieldInput: cleanMainValue(row.fieldInput) } : row)) };

  const rights = await checkRights(loader, programId, request.menuShortName, request.group, "add", request.passwords ?? {});
  if (rights) return rights;
  if (request.restoreMode) return { ok: false, message: "Master Save Not Allowed In View Mode", statements, dryRun, warnings: loader.warnings };

  const byName = new Map(request.rows.map((row) => [row.fieldName.toUpperCase(), row]));
  const inputOf = (row: BodyRow) => byName.get(row.field_name.toUpperCase());
  const findInput = (name: string) => byName.get(name.trim().toUpperCase());

  // Func_BlankFieldValidation(c1dg_MasterGrid, ..., false, "c")
  let blankMessage = "Fill The Following Fields And Try Again\n\n";
  let blank = false;
  for (const row of prepared.addBody) {
    if (!row.add_grid_visible || row.field_validation === "sys.readonly" || !row.value_compulsory) continue;
    if (toText(row.hide_by_firstcmbval) !== "" && row.hide_by_firstcmbval.includes(` ${request.group.firstCombo.value},`)) continue;
    const input = inputOf(row);
    if (input && input.fieldInput === "" && input.editable && input.visible) {
      blank = true;
      blankMessage += `- ${row.head_label.replace(/^\* /, "")}\n`;
    }
  }
  if (blank) return { ok: false, message: `${blankMessage}\n\n **TIPS**\nCompulosry Fields Can't Be Left Blank`, statements, dryRun, warnings: loader.warnings };

  const grid = await buildSaveGrid(loader, prepared, top.add_screen_hidden !== true);
  const pkTable: number[] = [];
  const log: LogCollector = { fields: "", values: "" };
  const addLogSave = top.add_log_save === true;
  let addonType = "";
  let addonName = "";
  let addonPos = "";
  let addonActMaster = "";
  let findProductName = "";
  // str_Find_party_name / str_Find_product_name, unquoted, for the company-group copies.
  let partyName = "";
  let productName = "";

  await client.query("SAVEPOINT master_add");
  try {
    for (let i = 0; i < grid.addTables.length; i += 1) {
      const table = grid.addTables[i];
      const systemTable = SYSTEM_TABLE_PROGRAMS_ADD.includes(programId);
      const schema = systemTable ? SYSTEM_SCHEMA : session.companySchema;
      const keyField = await primaryKeyField(loader, table);
      const fields: string[] = [];
      const values: string[] = [];

      for (const saveRow of grid.rows) {
        if (saveRow.table !== table || saveRow.mode !== "A") continue;
        let currentField = "";
        let currentValue = "";
        let extraField = "";
        let extraValue = "";
        const source = saveRow.source;
        if (source) {
          const input = inputOf(source) ?? { fieldName: source.field_name, fieldInput: "", fieldComboValue: "", visible: source.add_grid_visible, editable: true };
          if (input.editable || source.save_for_disable) {
            currentField = saveRow.field;
            const kind = source.combo_value.trim();
            const fixed = toText(source.defa_fixvalue);
            const typedFix = () => {
              switch (source.field_type) {
                case "T": return quote(source.defa_fixvalue);
                case "I": case "N": case "C": return source.defa_fixvalue;
                case "D": return "null";
                default: return "";
              }
            };
            if (!input.visible && fixed !== "") currentValue = typedFix();
            else if (!input.visible && kind !== "N" && kind !== "1") currentValue = fixed !== "" ? typedFix() : "null";
            else {
              switch (source.field_type) {
                case "T":
                  if (toText(source.field_save) !== "") {
                    switch (source.field_save) {
                      case "sys.left.firstcombotext":
                        currentValue = quote(request.group.firstCombo.text.slice(0, source.field_savenochr));
                        if (programId === 1) addonType = request.group.firstCombo.text.slice(0, source.field_savenochr);
                        break;
                      case "sys.firstcombovalue": currentValue = String(toInt(request.group.firstCombo.value)); break;
                      case "sys.left.thiscombotext": currentValue = quote(input.fieldInput.slice(0, source.field_savenochr)); break;
                      case "sys.thiscombotext": currentValue = quote(input.fieldInput); break;
                      case "sys.thiscombolistvalue": if (toInt(input.fieldComboValue) > 0) currentValue = input.fieldComboValue; break;
                      case "sys.thisaddoncombo":
                        if (toInt(input.fieldComboValue) > 0) {
                          currentValue = quote(input.fieldInput);
                          extraField = saveRow.field.toLowerCase().replace("txt_", "key_");
                          extraValue = input.fieldComboValue;
                        }
                        break;
                      case "sys.server.time": currentValue = quote(formatDesktopTime(new Date())); break;
                      case "sys.SOP_MOULD_KEY": currentValue = String(toInt(request.group.firstCombo.value)); break;
                    }
                    if (source.field_save.toLowerCase().includes("sys.sum_dependfld") && toText(source.status_against_fld) !== "") {
                      currentValue = quote((findInput(source.status_against_fld)?.fieldInput ?? "").trim());
                    }
                  } else {
                    currentValue = source.force_inputtype === "P" ? quote(writePw(input.fieldComboValue)) : quote(input.fieldInput);
                    if (programId === 1 && saveRow.field.trim() === "FIEL_SAVE") addonName = input.fieldInput.trim();
                    if (programId === 1 && saveRow.field.trim() === "FIEL_ENTRYPOS") addonPos = input.fieldInput.trim().slice(0, 1);
                    if (programId === 1 && saveRow.field.trim() === "FIEL_MASTERPOS") addonActMaster = input.fieldInput.trim().slice(0, 1);
                    if (saveRow.field === "PROD_DESC" && programId === 8) { findProductName = currentValue; productName = input.fieldInput; }
                    if (saveRow.field === "NAME" && programId === 14) partyName = input.fieldInput;
                  }
                  break;
                case "I":
                  if (toText(source.field_save) !== "") {
                    switch (source.field_save) {
                      case "sys.firstcombovalue": currentValue = request.group.firstCombo.value; break;
                      case "sys.company_id": if (programId === 37) currentValue = String(session.companyKey); break;
                      case "sys.thiscombolistvalue": if (toInt(input.fieldComboValue) > 0) currentValue = input.fieldComboValue; break;
                      case "sys.thisaddoncombo":
                        if (toInt(input.fieldComboValue) > 0) {
                          currentValue = quote(input.fieldInput);
                          extraField = saveRow.field.toLowerCase().replace("txt_", "key_");
                          extraValue = input.fieldComboValue;
                        }
                        break;
                      case "sys.bscode_tree": {
                        const balance = await loader.readTable(`SELECT bs_code, bs_level, bs_codelevel FROM ${schema}.balsheet WHERE bs_key = $1`, [toInt(input.fieldComboValue)]);
                        if (balance) {
                          const code = toText(field(balance[0], "bs_code"));
                          const prefix = code.slice(0, toInt(field(balance[0], "bs_codelevel")) * 2);
                          const last = await loader.readTable(`SELECT bs_code, bs_level, bs_codelevel FROM ${schema}.balsheet WHERE LEFT(bs_code, ${prefix.length}) = $1 ORDER BY bs_code DESC LIMIT 1`, [prefix]);
                          if (last) {
                            const lastCode = toText(field(last[0], "bs_code"));
                            const serial = toInt(lastCode.slice(prefix.length, prefix.length + 2)) + 1;
                            currentValue = quote(`${lastCode.slice(0, prefix.length)}${`00${serial}`.slice(-2)}${lastCode.slice(prefix.length + 2)}`);
                          }
                        }
                        break;
                      }
                      case "sys.SOP_MOULD_KEY":
                      case "sys.SOP_MOULD_CHILD_KEY": currentValue = String(pkTable[0] ?? 0); break;
                    }
                  } else currentValue = input.fieldInput;
                  break;
                case "C":
                  currentValue = input.fieldInput.replace(/,/g, "") === "" ? "0" : input.fieldInput.replace(/,/g, "");
                  break;
                case "N":
                  if (input.fieldInput.replace(/,/g, "") === "") {
                    if (source.field_save.toLowerCase().includes("sys.sum_dependfld")) {
                      if (toText(source.status_against_fld) !== "") currentValue = String(toDecimal(findInput(source.status_against_fld)?.fieldInput));
                    } else currentValue = "0";
                  } else currentValue = input.fieldInput.replace(/,/g, "");
                  break;
                case "D": {
                  const date = parseDesktopDate(input.fieldInput);
                  if (date) currentValue = quote(programId === 52 ? `${formatDesktopDate(date)} ${date.toTimeString().slice(0, 8)}` : formatDesktopDate(date));
                  else currentValue = source.field_save === "sys.server.today" ? quote(formatDesktopDate(new Date())) : "null";
                  break;
                }
              }
            }
          } else {
            if (toText(source.defa_add_disable) !== "") { currentField = saveRow.field; currentValue = source.defa_add_disable; }
            if (programId === 8 && saveRow.field.includes("LEVEL")) { currentField = saveRow.field; currentValue = input.fieldInput; }
          }
        } else {
          currentField = saveRow.field;
          if (saveRow.fixValue !== "") {
            if (saveRow.fieldType === "N" || saveRow.fieldType === "C") currentValue = saveRow.fixValue;
            else if (saveRow.fixValue.includes("sys.prog_id")) currentValue = (await replaceControlValues(loader, saveRow.fixValue, loadContext(session, programId, request.group))).trim();
            else currentValue = quote(saveRow.fixValue);
          } else if (saveRow.sysValue !== "") {
            const sys = saveRow.sysValue.toLowerCase();
            if (sys.startsWith("sys.")) {
              currentValue = await addSysValue(loader, programId, request, saveRow, findInput);
            } else if (sys.startsWith("pkv.")) {
              const at = grid.addTables.slice(0, i + 1).findIndex((name) => name.toLowerCase() === sys.slice(4));
              currentValue = at >= 0 && pkTable[at] !== undefined ? String(pkTable[at]) : "Null";
            }
          } else if (saveRow.queryString.trim() !== "") {
            const rows = await loader.readTable(saveRow.queryString);
            if (rows) {
              const first = displayValue(Object.values(rows[0])[0]).trim();
              currentValue = saveRow.fieldType === "T" || saveRow.fieldType === "D" ? quote(first) : first;
            }
          }
        }

        if (currentValue.trim() !== "" && currentField.trim() !== "") {
          fields.push(columnName(currentField));
          values.push(currentValue);
          if (source && addLogSave && toText(source.log_short) !== "") collectLog(log, source.log_short, currentValue, pkTable[0] ?? 0);
        }
        if (extraValue.trim() !== "" && extraField.trim() !== "") { fields.push(extraField); values.push(extraValue); }
      }

      const key = dryRun && fields.length === 0 ? null : await withAllocatedKey(loader, schema, table, keyField, fields, values);
      const sql = `INSERT INTO ${schema}.${table.toLowerCase()} (${fields.join(",")}) VALUES (${values.join(",")})`;
      statements.push(sql);
      await client.query(sql);
      pkTable[i] = key ?? 0;

      if (programId === 1) statements.push(...await addonFieldColumns(client, session.companySchema, addonType, addonName, addonPos, addonActMaster));
    }

    // Log store
    if (session.flags.logFileSpecial) {
      statements.push(...await specialLog(loader, programId, request, prepared, pkTable[0] ?? 0, "A"));
    } else if (addLogSave && log.fields !== "") {
      statements.push(await masterLog(loader, programId, "A", log, pkTable[0] ?? 0));
    }

    if (programId === 8) statements.push(...await productAddFollowUp(loader, request, prepared, pkTable, findProductName));
    if (programId === 2 && request.group.firstCombo.text.toUpperCase() === "GODOWN") statements.push(...await godownAddFollowUp(loader));
    if (programId === 14 && (request.group.firstCombo.text.includes("DEBTOR") || request.group.firstCombo.text.includes("CREDITOR"))) {
      for (const row of prepared.addBody) {
        if (row.database_name.toLowerCase().trim() !== "ac_balance" || !row.field_name.toLowerCase().trim().startsWith("opening")) continue;
        const amount = toDecimal(findInput(row.field_name)?.fieldInput);
        const debtor = request.group.firstCombo.text.includes("DEBTOR");
        const fields = ["out_date", "out_fulldocno", "out_entryamt", "out_setoff", "out_ly_setoff", "out_on_acamt", "out_dbcode", "out_entrybook", "code", "ref_no", "set_off", "clear_pos", "year_id"];
        const values = [quote(formatDesktopDate(session.tarikh1)), "'OPENING'", String(Math.abs(amount)), "0", "0", "0", String(amount === 0 ? (debtor ? 1 : 2) : amount < 0 ? 2 : 1), String(debtor ? 8 : 13), String(pkTable[0] ?? 0), "''", "0", "'P'", quote(session.yearId)];
        await withAllocatedKey(loader, session.companySchema, "outclear", "", fields, values);
        const sql = `INSERT INTO ${session.companySchema}.outclear (${fields.join(",")}) VALUES (${values.join(",")})`;
        statements.push(sql);
        await client.query(sql);
      }
    }

    const copy = { programId, group: request.group, partyName, productName };
    statements.push(...await replicateAdd(loader, copy));
    const cloud = dryRun ? null : await cloudPushFor(loader, copy);

    if (dryRun) await client.query("ROLLBACK TO SAVEPOINT master_add");
    else await client.query("RELEASE SAVEPOINT master_add");
    return { ok: true, message: dryRun ? "Checked: the save would succeed (nothing was written)." : "Master saved", statements, keys: pkTable, dryRun, warnings: loader.warnings, ...(cloud ? { cloud } : {}) };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT master_add");
    return { ok: false, message: `Error while Saving, Error Message ${error instanceof Error ? error.message : String(error)}`, statements, dryRun, warnings: loader.warnings };
  }
}

/** The "sys." system values of a table_properties row on the Add side. */
async function addSysValue(loader: Loader, programId: number, request: AddSaveRequest, saveRow: SaveRow, findInput: (name: string) => AddFieldInput | undefined): Promise<string> {
  const { session } = loader;
  const now = new Date();
  switch (saveRow.sysValue.toLowerCase()) {
    case "sys.firstcomboid": return request.group.firstCombo.value;
    case "sys.secondcombotext": return !request.group.secondCombo || request.group.secondCombo.text === "(blank)" ? "''" : quote(request.group.secondCombo.text);
    case "sys.usernumber": return programId === 52 ? String(session.userNo) : "''";
    case "sys.yearid": return quote(session.yearId);
    case "sys.tarikh1": return quote(formatDesktopDate(session.tarikh1));
    case "sys.today": return quote(formatDesktopDate(now));
    case "sys.server.today": return quote(formatDesktopDate(now));
    case "sys.time":
    case "sys.server.time": return quote(formatDesktopTime(now));
    case "sys.givenfieldtext": return quote(findInput(saveRow.updFieldValue)?.fieldInput ?? "");
    case "sys.update.givenfieldtext": {
      const typed = findInput(saveRow.updFieldValue)?.fieldInput ?? "";
      if (saveRow.fieldType === "N") return typed.trim() !== "" ? typed : "null";
      return quote(typed);
    }
    case "sys.blank": return "''";
    case "sys.sum_dependfld": {
      const input = findInput(saveRow.updFieldValue);
      if (saveRow.fieldType === "N" && input) return input.fieldInput !== "" ? input.fieldInput.trim() : "0";
      return input ? quote(input.fieldInput.trim()) : "0";
    }
    case "sys.multiply_dependfld": {
      const input = findInput(saveRow.updFieldValue);
      const depend = findInput(saveRow.valueDependOn);
      if (saveRow.fieldType === "N" && input) return input.fieldInput !== "" ? String(toDecimal(depend?.fieldInput) * toDecimal(input.fieldInput)) : "0";
      if (saveRow.valueDependOn !== "") return depend && depend.fieldInput.trim() !== "" ? depend.fieldInput : "0";
      return quote((input?.fieldInput ?? "").trim());
    }
    case "sys.divide_dependfld": {
      const input = findInput(saveRow.updFieldValue);
      const depend = findInput(saveRow.valueDependOn);
      if (saveRow.fieldType === "N" && input) return input.fieldInput !== "" && toDecimal(input.fieldInput) !== 0 ? runFormula(toDecimal(depend?.fieldInput), "/", toDecimal(input.fieldInput), 2) : "0";
      if (saveRow.valueDependOn !== "") return depend && depend.fieldInput.trim() !== "" ? depend.fieldInput : "0";
      return quote((input?.fieldInput ?? "").trim());
    }
    case "sys.bn_dbcode": {
      // C1dg_MasterGrid_AfterEdit sets int_dbcode from BN_SIDE for program 13.
      const side = request.rows.find((row) => row.fieldName.toUpperCase().includes("BN_SIDE"))?.fieldInput ?? "";
      return String(["P", "C", "T"].includes(side.charAt(0)) ? 2 : 1);
    }
    default: return "";
  }
}

async function addonFieldColumns(client: Client, schema: string, type: string, name: string, position: string, activeMaster: string): Promise<string[]> {
  if (name === "" || !/^[A-Za-z0-9_]+$/.test(name)) return [];
  const statements: string[] = [];
  const add = async (table: string, column: string, sqlType: string) => {
    const sql = `ALTER TABLE ${schema}.${table} ADD COLUMN IF NOT EXISTS ${column.toLowerCase()} ${sqlType} NULL`;
    statements.push(sql);
    await client.query(sql);
  };
  if (type === "M") {
    if (activeMaster === "Y") { await add("addon_data", `KEY_${name}`, "integer"); await add("addon_data", `TXT_${name}`, "varchar(100) DEFAULT ' '"); }
    if (position === "L" || position === "S") { await add("addon_aentry", `KEY_${name}`, "integer"); await add("addon_aentry", `TXT_${name}`, "varchar(100) DEFAULT ' '"); }
    if (position === "P") { await add("addon_ientry", `KEY_${name}`, "integer"); await add("addon_ientry", `TXT_${name}`, "varchar(100) DEFAULT ' '"); }
  } else {
    if (activeMaster === "Y") await add("addon_data", `INPUT_${name}`, "varchar(40) DEFAULT ' '");
    if (position === "L" || position === "S") await add("addon_aentry", `INPUT_${name}`, "varchar(40) DEFAULT ' '");
    if (position === "P") await add("addon_ientry", `INPUT_${name}`, "varchar(40) DEFAULT ' '");
  }
  return statements;
}

async function masterLog(loader: Loader, programId: number, mode: "A" | "E" | "D", log: LogCollector, pk: number): Promise<string> {
  const { session } = loader;
  const now = new Date();
  let fields = `lmst_top_id,lmst_logdate,lmst_logtime,lmst_logmode,lmst_loguser,${log.fields}lmst_logsystem,lmst_machine_name`;
  let values = `${programId},${quote(formatDesktopDate(now))},${quote(formatDesktopTime(now))},'${mode}',${session.userNo},${log.values}`;
  if (!log.fields.includes("lmst_pk,")) { fields = fields.replace("lmst_logsystem,lmst_machine_name", "lmst_pk,lmst_logsystem,lmst_machine_name"); values += `${pk},`; }
  values += "null,'WEB'";
  const fieldList = fields.split(",");
  const valueList = splitValues(values);
  await withAllocatedKey(loader, session.companySchema, "log_master", "", fieldList, valueList);
  const sql = `INSERT INTO ${session.companySchema}.log_master (${fieldList.join(",")}) VALUES (${valueList.join(",")})`;
  await loader.client.query(sql);
  return sql;
}

/** Splits a values list on commas that are not inside a quoted literal. */
function splitValues(values: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuote = false;
  for (let index = 0; index < values.length; index += 1) {
    const character = values.charAt(index);
    if (character === "'") inQuote = !inQuote;
    if (character === "," && !inQuote) { out.push(current); current = ""; } else current += character;
  }
  if (current !== "") out.push(current);
  return out;
}

/** logfile = 'S': the JSON log in <company>_BIGLOG.LOG_ALLMASTER, when that database exists. */
async function specialLog(loader: Loader, programId: number, request: { group: GroupState }, prepared: PreparedProgram, pk: number, mode: "A" | "E" | "D", record?: Readonly<Record<string, string>>): Promise<string[]> {
  const { session, client } = loader;
  const schema = `${session.companySchema}_biglog`;
  const exists = await loader.readTable("SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'log_allmaster'", [schema]);
  if (!exists) {
    loader.warnings.push(`Special log skipped: ${schema}.log_allmaster does not exist in PostgreSQL`);
    return [];
  }
  const now = new Date();
  const top = [{ [`!*${prepared.firstComboRow?.head_label ?? ""}`]: request.group.firstCombo.text, user: session.loginName, savedate: formatDesktopDate(now), savetime: formatDesktopTime(now), machine_name: "WEB" }];
  const grid: Record<string, string> = { [`!*${prepared.updateBody[0]?.database_name ?? ""}`]: String(pk), Row: mode === "A" ? "  New" : mode === "D" ? "Delete" : "Update" };
  let name = ""; let short = ""; let head = ""; let opening = "0";
  for (const row of mode === "A" ? prepared.addBody : prepared.updateBody) {
    const value = record?.[row.field_name.split(".").pop()!.toLowerCase()] ?? "";
    if ((mode === "A" ? row.add_grid_visible : row.update_grid_visible) && row.head_label !== "") grid[` ${row.head_label}`] = row.field_type === "N" && toDecimal(value) === 0 ? "" : value;
    switch (row.log_short.toLowerCase().trim()) {
      case "short": short = value.slice(0, 29); break;
      case "name": name = value.slice(0, 79); break;
      case "head": head = value.slice(0, 39); break;
      case "open": opening = String(toDecimal(value)); break;
    }
  }
  const sql = `INSERT INTO ${schema}.log_allmaster (lmaster_id,lmaster_top,lmaster_new_grid,lmaster_user,lmaster_firstname,lmaster_firstvalue,lmaster_savedate,lmaster_savetime,lmaster_machine_name,lmaster_mode,lmaster_code,lmaster_name,lmaster_short,lmaster_head,lmaster_opening) VALUES (${programId},${quote(JSON.stringify(top))},${quote(JSON.stringify([grid]))},${session.userNo},${quote(request.group.firstCombo.text)},${toInt(request.group.firstCombo.value)},${quote(formatDesktopDate(now))},${quote(formatDesktopTime(now))},'WEB','${mode}',${pk},${quote(name)},${quote(short)},${quote(head)},${opening})`;
  await client.query(sql);
  return [sql];
}

async function productAddFollowUp(loader: Loader, request: AddSaveRequest, prepared: PreparedProgram, pkTable: number[], findProductName: string): Promise<string[]> {
  const { client, session } = loader;
  const schema = session.companySchema;
  const statements: string[] = [];
  const productIndex = prepared.addBody.length;
  void productIndex; void findProductName;
  const rows = prepared.addBody;
  const inputs = new Map(request.rows.map((row) => [row.fieldName.toUpperCase(), row.fieldInput]));
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.database_name.toLowerCase().trim() !== "product_master" || !row.field_name.toLowerCase().trim().startsWith("level_")) continue;
    const code = inputs.get(row.field_name.toUpperCase()) ?? "";
    if (code.trim() === "") continue;
    const level = toInt(row.field_name.trim().charAt(6));
    const description = rows[index + 1] ? inputs.get(rows[index + 1].field_name.toUpperCase()) ?? "" : "";
    const exists = await loader.readTable(`SELECT 1 FROM ${schema}.level_desc WHERE level_no = $1 AND level_code = $2`, [level, code]);
    if (exists) continue; // the C#'s "insert ... where not exists" adds nothing when the code is there
    const fields = ["level_no", "level_code", "level_name", "level_short", "level_desc"];
    const values = [String(level), quote(code), quote(description), quote(code), quote(description)];
    await withAllocatedKey(loader, schema, "level_desc", "LEVEL_KEY", fields, values);
    const sql = `INSERT INTO ${schema}.level_desc (${fields.join(",")}) VALUES (${values.join(",")})`;
    statements.push(sql);
    await client.query(sql);
  }
  // Godown balances for the new product
  const productKey = pkTable[prepared.addBody.length > 0 ? 0 : 0] ?? 0;
  const balance = await loader.readTable(`SELECT * FROM ${schema}.prod_balance WHERE prod_id = $1`, [productKey]);
  const godowns = await loader.readTable(`SELECT fiel_key, fiel_stkmdl FROM ${schema}.addon_fld WHERE fiel_pos <> 'D' AND fiel_err = 'GODOWN,'`);
  if (balance && godowns) {
    const b = balance[0];
    for (const godown of godowns) {
      const subs = await loader.readTable(`SELECT sub_code FROM ${schema}.addon_sub WHERE para_id = $1`, [toInt(field(godown, "fiel_key"))]);
      for (const sub of subs ?? []) {
        const nullable = (column: string) => (toText(field(b, column)) === "" ? "null" : displayValue(field(b, column)));
        const fields = ["p_short", "prod_id", "i_mastcd", "i_paracd", "open_stk", "open_pcs", "open_pack", "open_weight", "open_qty1", "open_qty2", "open_qty3", "open_uom", "pcs_uom", "pack_uom", "weight_uom", "iqty1_uom", "iqty2_uom", "iqty3_uom", "clsg_pcs", "clsg_pack", "clsg_weight", "clsg_qty1", "clsg_qty2", "clsg_qty3", "open_rate", "add_pcs", "add_pack", "add_weight", "add_qty1", "add_qty2", "add_qty3", "less_pcs", "less_pack", "less_weight", "less_qty1", "less_qty2", "less_qty3", "p_level1", "p_level2", "p_level3", "p_level4", "p_level5", "p_level6", "p_level7", "p_level8", "p_level9", "p_rate", "rep_rate", "prec_flag", "year_id"];
        const values = [quote(displayValue(field(b, "p_short"))), displayValue(field(b, "prod_id")), displayValue(field(godown, "fiel_key")), displayValue(field(sub, "sub_code")), "0", "0", "0", "0", "0", "0", "0",
          nullable("open_uom"), nullable("pcs_uom"), nullable("pack_uom"), nullable("weight_uom"), nullable("iqty1_uom"), nullable("iqty2_uom"), nullable("iqty3_uom"),
          "0", "0", "0", "0", "0", "0", toText(field(b, "open_rate")) === "" ? "0" : displayValue(field(b, "open_rate")), "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0",
          ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => quote(displayValue(field(b, `p_level${level}`)))), "0", toText(field(b, "rep_rate")) === "" ? "0" : displayValue(field(b, "rep_rate")),
          quote(toText(field(godown, "fiel_stkmdl")) === "" ? "GW" : toText(field(godown, "fiel_stkmdl"))), quote(displayValue(field(b, "year_id")))];
        await withAllocatedKey(loader, schema, "prod_balance", "PRODBAL_KEY", fields, values);
        const sql = `INSERT INTO ${schema}.prod_balance (${fields.join(",")}) VALUES (${values.join(",")})`;
        statements.push(sql);
        await client.query(sql);
      }
    }
  }
  return statements;
}

async function godownAddFollowUp(loader: Loader): Promise<string[]> {
  const { client, session } = loader;
  const schema = session.companySchema;
  const statements: string[] = [];
  const newest = await loader.readTable(`SELECT * FROM ${schema}.addon_sub WHERE sub_code = (SELECT sub_code FROM ${schema}.addon_sub ORDER BY sub_code DESC LIMIT 1)`);
  const godownFields = await loader.readTable(`SELECT fiel_key, fiel_stkmdl FROM ${schema}.addon_fld WHERE fiel_mbal = 'Y' AND fiel_entrypos = 'P' AND fiel_relate = 'P' AND fiel_pos <> 'D'`);
  if (!newest || !godownFields) return statements;
  // The C# loops over the new addon_sub rows (one) and uses addon field [0..rows-1].
  for (let index = 0; index < newest.length && index < godownFields.length; index += 1) {
    const products = await loader.readTable(`SELECT prodbal.* FROM ${schema}.prod_balance prodbal LEFT JOIN ${schema}.product_master product ON product.prod_key = prodbal.prod_id WHERE prec_flag = 'RP' AND product.prod_pos <> 'D' AND year_id = $1`, [session.yearId]);
    for (const p of products ?? []) {
      const zeroIfBlank = (column: string) => (toText(field(p, column)) === "" ? "0" : displayValue(field(p, column)));
      const fields = ["p_short", "prod_id", "i_mastcd", "i_paracd", "open_stk", "open_pcs", "open_pack", "open_weight", "open_qty1", "open_qty2", "open_qty3", "open_uom", "pcs_uom", "pack_uom", "weight_uom", "iqty1_uom", "iqty2_uom", "iqty3_uom", "clsg_pcs", "clsg_pack", "clsg_weight", "clsg_qty1", "clsg_qty2", "clsg_qty3", "open_rate", "add_pcs", "add_pack", "add_weight", "add_qty1", "add_qty2", "add_qty3", "less_pcs", "less_pack", "less_weight", "less_qty1", "less_qty2", "less_qty3", "p_level1", "p_level2", "p_level3", "p_level4", "p_level5", "p_level6", "p_level7", "p_level8", "p_level9", "p_rate", "prec_flag", "year_id"];
      const values = [quote(displayValue(field(p, "p_short"))), displayValue(field(p, "prod_id")), displayValue(field(godownFields[index], "fiel_key")), displayValue(field(newest[0], "sub_code")), "0", "0", "0", "0", "0", "0", "0",
        zeroIfBlank("open_uom"), zeroIfBlank("pcs_uom"), zeroIfBlank("pack_uom"), zeroIfBlank("weight_uom"), zeroIfBlank("iqty1_uom"), zeroIfBlank("iqty2_uom"), zeroIfBlank("iqty3_uom"),
        "0", "0", "0", "0", "0", "0", zeroIfBlank("open_rate"), "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0",
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => quote(toText(field(p, `p_level${level}`)))), "0",
        quote(toText(field(godownFields[index], "fiel_stkmdl")) === "" ? "GW" : toText(field(godownFields[index], "fiel_stkmdl"))), quote(displayValue(field(p, "year_id")))];
      await withAllocatedKey(loader, schema, "prod_balance", "PRODBAL_KEY", fields, values);
      const sql = `INSERT INTO ${schema}.prod_balance (${fields.join(",")}) VALUES (${values.join(",")})`;
      statements.push(sql);
      await client.query(sql);
    }
  }
  return statements;
}

// ---------------------------------------------------------------------------------------
// Edit save (and the deletes Selected_RowDelete marks)

export type EditedRecord = Readonly<{
  /** Row_Number: the record's position when the grid was filled. */
  rowNumber: number;
  /** Every cell of the row as it stands, keyed by lowercased column name. */
  values: Readonly<Record<string, string>>;
  /** c1_Update_Backup for this row: combo ids and passwords live here. */
  backup: Readonly<Record<string, string>>;
  /** UserData "D": the row was marked for deletion. */
  deleted: boolean;
  /** Columns the operator could edit on this row (after enable/disable rules). */
  editableColumns?: readonly string[];
}>;

export type EditSaveRequest = Readonly<{
  programName: string;
  menuShortName: string;
  group: GroupState;
  records: readonly EditedRecord[];
  /** The Update grid's first record, which "sys.update.*" values read (Rows[1]). */
  firstRecord: Readonly<Record<string, string>>;
  passwords?: Readonly<Record<string, string>>;
  dryRun?: boolean;
}>;

const lower = (name: string) => name.split(".").pop()!.trim().toLowerCase();

export async function editSave(client: Client, loader: Loader, request: EditSaveRequest): Promise<SaveResult> {
  const { session } = loader;
  const statements: string[] = [];
  const dryRun = request.dryRun === true;
  const prepared = await prepareProgram(loader, request.programName, request.group);
  const { programId, top } = prepared;

  // The main field is stored without trailing blanks or characters nobody can see (Alt+255 and the like).
  const mainColumns = new Set(prepared.updateBody.filter(isMainField).map((row) => lower(row.field_name)));
  request = { ...request, records: request.records.map((record) => ({ ...record, values: Object.fromEntries(Object.entries(record.values).map(([key, value]) => [key, mainColumns.has(key) ? cleanMainValue(value) : value])) })) };

  for (const kind of requiredEditRights(request.records)) {
    const rights = await checkRights(loader, programId, request.menuShortName, request.group, kind, request.passwords ?? {});
    if (rights) return rights;
  }

  // Func_BlankFieldValidation(c1dg_UpdateGrid, ..., true, "c") over edited rows. Like the desktop,
  // only a column on screen and open for editing is checked: a column the grid hides for this
  // group (VISIBLE_AGAINST_FLD, e.g. the address and state of an addon without addresses)
  // cannot be filled, so it cannot be demanded.
  const shownSource = {
    firstCombo: { text: request.group.firstCombo.text, value: request.group.firstCombo.value, bound: true },
    fieldValue: (name: string) => request.firstRecord[lower(name)],
  };
  let blankMessage = "Fill The Following Fields And Try Again\n\n";
  let blank = false;
  request.records.forEach((record) => {
    if (record.deleted) return;
    for (const row of prepared.updateBody) {
      if (!row.value_compulsory || row.enable_for.trim() !== "" || row.disable_for.trim() !== "") continue;
      if (toText(row.hide_by_firstcmbval) !== "" && row.hide_by_firstcmbval.includes(`${request.group.firstCombo.value},`)) continue;
      if (!updateColumnShown(row, shownSource, session.businessNature)) continue;
      // Cols[..].AllowEditing: the column as the screen had it open on this row.
      const editableHere = record.editableColumns ? record.editableColumns.includes(lower(row.field_name)) : row.update_grid_editable;
      if (!editableHere) continue;
      const value = record.values[lower(row.field_name)];
      if (value !== undefined && value.trim() === "") {
        blank = true;
        blankMessage += `- ${row.head_grid.trim()} at row ${record.rowNumber}\n`;
      }
    }
  });
  if (blank) return { ok: false, message: `${blankMessage}\n\n **TIPS**\nCompulosry Fields Can't Be Left Blank`, statements, dryRun, warnings: loader.warnings };

  const grid = await buildSaveGrid(loader, prepared, top.add_screen_hidden !== true);
  const whereColumns = prepared.updateBody.filter((row) => row.field_in_upd_where);
  const updateLogSave = top.update_log_save === true;
  const lastSaveQuery = String(top.update_lastsavequery ?? "");
  const logFileY = toText(session.setup.logfile).toUpperCase() === "Y";
  const keys: number[] = [];
  let cloud: CloudPush | null = null;

  await client.query("SAVEPOINT master_edit");
  try {
    for (const record of request.records) {
      const valueOf = (name: string) => record.values[lower(name)] ?? "";
      const backupOf = (name: string) => record.backup[lower(name)] ?? "";
      const pkTable: number[] = [];
      const queries: string[] = [];
      let addonId = 0;
      let productId = 0;
      let addonName = "";
      let partyName = "";
      let productName = "";
      let firstTableHasQuery = false;
      const log: LogCollector = { fields: "", values: "" };
      let boolRunDelete = false;

      for (let i = 0; i < grid.updateTables.length; i += 1) {
        const table = grid.updateTables[i];
        const keyField = await primaryKeyField(loader, table);
        const systemTable = SYSTEM_TABLE_PROGRAMS_EDIT.includes(programId) || ["USER_MASTER", "COMPANY", "REMINDER", "COLOUR_SETUP", "CO_GSTNO", "GOOGLE_EVENT"].some((name) => table.includes(name));
        const schema = systemTable ? SYSTEM_SCHEMA : session.companySchema;
        boolRunDelete = false;
        let boolRunUpdate = true;
        let boolRunAdd = false;
        const keyValue = keyField !== "" && lower(keyField) in record.values ? valueOf(keyField) : undefined;
        if (keyValue !== undefined) {
          if (keyValue.length > 0) {
            boolRunUpdate = toInt(keyValue) > 0;
            if ([28, 36, 43, 44, 45].includes(programId) && !boolRunUpdate) boolRunAdd = true;
            if (programId === 34 && valueOf("user_no") === "9999") { boolRunUpdate = false; boolRunAdd = true; }
            if (boolRunUpdate) pkTable[i] = toInt(keyValue);
          } else if ((toInt(request.group.firstCombo.value) <= 3 && programId === 14 && !record.deleted) || programId !== 14) {
            if (record.deleted && programId === 18) { boolRunUpdate = true; boolRunAdd = false; }
            else { boolRunUpdate = false; boolRunAdd = true; }
          }
        }

        let saveTableFound = true;
        let where = " where ";
        let whereCount = 0;
        for (let w = 0; w < whereColumns.length; w += 1) {
          if (where !== " where ") continue;
          const keyRow = prepared.updateBody.find((row) => row.field_save.trim().toLowerCase() === keyField.toLowerCase() && keyField !== "");
          if (keyRow) {
            const value = valueOf(keyRow.field_name);
            if (value.trim().length === 0) continue;
            whereCount += 1;
            where += `${columnName(keyField)}=${value}`;
            if (programId === 8 && table.includes("PRODUCT_MASTER")) productId = toInt(value);
            if (programId === 2 && table.includes("ADDON_SUB")) addonId = toInt(value);
          } else {
            if (!boolRunAdd) { whereCount += 1; saveTableFound = false; }
          }
        }
        if (saveTableFound && whereCount > 0) {
          const whereColumn = whereColumns[whereCount - 1];
          if (whereColumn && valueOf(whereColumn.field_name).trim() === "") {
            if ((keyValue ?? "") !== "") { boolRunUpdate = true; boolRunAdd = false; continue; }
            boolRunUpdate = false; boolRunAdd = true;
          }
        }
        if (!saveTableFound) continue;

        const updates: string[] = [];
        const insertFields: string[] = [];
        const insertValues: string[] = [];
        const emit = (name: string, value: string) => {
          if (boolRunUpdate) {
            if (!updates.some((entry, index) => index > 0 && entry.startsWith(`${name}=`))) updates.push(`${name}=${value.trim()}`);
          } else if (!insertFields.includes(name)) {
            insertFields.push(name);
            insertValues.push(value);
          }
        };

        const modeWanted = boolRunUpdate && !boolRunAdd ? "E" : "A";
        const updateOnlyPrograms = [18, 21, 22, 23, 26, 28, 29, 32, 34, 36, 39, 41, 42, 43, 44, 45, 50, 51, 52];
        for (const saveRow of grid.rows) {
          if (saveRow.table !== table) continue;
          const matches = saveRow.mode === modeWanted
            || (!prepared.addGridVisibleFlag && (!boolRunAdd || updateOnlyPrograms.includes(programId)) && saveRow.mode === "E")
            || saveRow.mode === "D";
          if (!matches) continue;
          let fieldName = "";
          let fieldValue = "";
          let extraName = "";
          let extraValue = "";
          if (record.deleted) boolRunDelete = true;
          const source = saveRow.source ? prepared.updateBody.find((row) => lower(row.field_name) === lower(saveRow.source!.field_name)) ?? null : null;

          if (source) {
            const column = lower(source.field_name);
            const cell = valueOf(column);
            const backup = backupOf(column);
            const changed = cell !== backup;
            if (!boolRunDelete) {
              const columnEditable = record.editableColumns ? record.editableColumns.includes(column) : source.update_grid_editable;
              if (columnEditable || source.save_for_disable || toText(source.field_save) !== "") {
                fieldName = saveRow.field;
                switch (source.field_type) {
                  case "T":
                    if (toText(source.field_save) !== "") {
                      switch (source.field_save) {
                        case "sys.left.firstcombotext": fieldValue = quote(request.group.firstCombo.text.slice(0, source.field_savenochr)); break;
                        case "sys.firstcombovalue": fieldValue = request.group.firstCombo.value; break;
                        case "sys.left.thiscombotext": if (cell.length >= source.field_savenochr) fieldValue = quote(cell.slice(0, source.field_savenochr)); break;
                        case "sys.thiscombolistvalue": if (changed) fieldValue = backup; break;
                        case "sys.thisaddoncombo": if (changed) { fieldValue = quote(cell); extraName = saveRow.field.toLowerCase().replace("txt_", "key_"); extraValue = backup; } break;
                        case "sys.server.time": fieldValue = quote(formatDesktopTime(new Date())); break;
                        default: fieldValue = quote(cell);
                      }
                    } else if (source.force_inputtype === "P") {
                      fieldValue = quote(writePw(backup));
                    } else {
                      fieldValue = quote(cell);
                      if (programId === 2 && saveRow.field.includes("SUB_NAME")) addonName = fieldValue;
                      if (saveRow.field === "NAME" && programId === 14) partyName = cell;
                      if (saveRow.field === "PROD_DESC" && programId === 8) productName = cell;
                    }
                    break;
                  case "I":
                    if (cell.trim() !== "") {
                      switch (source.field_save) {
                        case "sys.firstcombovalue": fieldValue = request.group.firstCombo.value; break;
                        case "sys.thiscombolistvalue": if (changed) fieldValue = cell === "(blank)" ? "null" : backup; break;
                        case "sys.thisaddoncombo": if (changed) { fieldValue = quote(cell); extraName = saveRow.field.toLowerCase().replace("txt_", "key_"); extraValue = backup; } break;
                        case "sys.gridcode": fieldValue = Object.values(record.values)[source.field_savenochr - 1] ?? ""; break;
                        case "sys.gridcodevalue": fieldValue = String(await rateAddon(loader, programId, programId === 22 ? 3 : 2)); break;
                        case "sys.pruom": if (changed) fieldValue = backup; break;
                        case "sys.bscode_tree": {
                          const balance = await loader.readTable(`SELECT bs_code, bs_level, bs_codelevel FROM ${session.companySchema}.balsheet WHERE bs_key = $1`, [toInt(backup)]);
                          if (balance) {
                            const code = toText(field(balance[0], "bs_code"));
                            const prefix = code.slice(0, toInt(field(balance[0], "bs_codelevel")) * 2);
                            const serial = toInt(code.slice(prefix.length, prefix.length + 2)) + 1;
                            fieldValue = quote(`${code.slice(0, prefix.length)}${`00${serial}`.slice(-2)}${code.slice(prefix.length + 2)}`);
                          }
                          break;
                        }
                        case "|sys.rate_addon2|": if (programId === 50) fieldValue = String(await rateAddon(loader, programId, 2)); break;
                      }
                      if (source.field_save === "sys.pruom" && cell.trim() === "") fieldValue = "5";
                    } else if (toText(source.field_save) !== "") {
                      switch (source.field_save) {
                        case "sys.firstcombovalue": fieldValue = request.group.firstCombo.value; break;
                        case "sys.gridcode": fieldValue = Object.values(record.values)[source.field_savenochr - 1] ?? ""; break;
                        case "sys.gridcodevalue": fieldValue = String(await rateAddon(loader, programId, programId === 22 ? 3 : 2)); break;
                        case "sys.thiscombolistvalue":
                          if (toText(source.defa_value_query) !== "") {
                            const context: SysValueContext = loadContext(session, programId, request.group, { masterGrid: true });
                            const sql = await replaceControlValues(loader, replaceSessionValues(source.defa_value_query, session), context);
                            const rows = await loader.readTable(sql);
                            if (rows) fieldValue = displayValue(Object.values(rows[0])[0]);
                          } else if (changed) fieldValue = cell === "(blank)" ? "null" : backup;
                          else fieldValue = "0";
                          break;
                        case "sys.thisaddoncombo": if (changed) { fieldValue = quote(cell); extraName = saveRow.field.toLowerCase().replace("txt_", "key_"); extraValue = backup; } break;
                        case "sys.pruom": fieldValue = "5"; break;
                        case "|sys.rate_addon2|": if (programId === 50) fieldValue = String(await rateAddon(loader, programId, 2)); break;
                      }
                    } else fieldValue = quote(cell);
                    break;
                  case "C":
                  case "N":
                    if (source.field_save.toLowerCase().includes("sys.sum_dependfld")) {
                      if (toText(source.status_against_fld) !== "") {
                        const amount = toDecimal(valueOf(source.status_against_fld));
                        let text = saveRow.mode === "A" ? String(amount) : source.field_save;
                        // SQL Server adds a number to a money column; PostgreSQL wants the number cast.
                        const money = (await columnType(loader, schema, table, saveRow.field)) === "money";
                        if (text.toLowerCase().includes("sys.sum_dependfld")) text = text.split("sys.sum_dependfld").join(money ? `CAST(${amount} AS money)` : String(amount));
                        fieldValue = text;
                      }
                    } else if (source.field_save.toLowerCase().includes("sys.user_no")) fieldValue = cell.split("9999").join(String(session.userNo));
                    else if (source.field_save.toLowerCase().includes("sys.company_id")) fieldValue = cell.split("9999").join(String(session.companyKey));
                    else fieldValue = cell.trim().replace(/,/g, "") === "" ? "0" : cell.replace(/,/g, "");
                    break;
                  case "D":
                    if (cell.trim() !== "" || source.field_save === "sys.server.today") {
                      const date = source.field_save === "sys.server.today" ? new Date() : parseDesktopDate(cell);
                      fieldValue = date ? quote(programId === 52 ? `${formatDesktopDate(date)} ${date.toTimeString().slice(0, 8)}` : formatDesktopDate(date)) : "null";
                    } else fieldValue = "null";
                    break;
                }
              }
            }
          } else {
            fieldName = saveRow.field;
            if (programId === 8 && table.toUpperCase().includes("PROD_BALANCE") && (fieldName.toUpperCase().includes("CLSG_") || fieldName.toUpperCase().includes("OPEN_"))) fieldName = "";
            if (boolRunDelete && !fieldName.toUpperCase().includes("_POS")) fieldName = "";
            if (saveRow.fixValue !== "") {
              if (saveRow.fieldType === "N" || saveRow.fieldType === "C") {
                const brace = /\{([^}]*)\}/.exec(saveRow.fixValue);
                if (brace) {
                  if (brace[1].toLowerCase() in record.values) { if (valueOf(brace[1]).trim() !== "") fieldValue = saveRow.fixValue.replace(`{${brace[1]}}`, valueOf(brace[1])); }
                  else fieldValue = saveRow.fixValue;
                } else fieldValue = saveRow.fixValue;
              } else if (!boolRunDelete) {
                if (saveRow.fixValue.includes("sys.prog_id")) fieldValue = (await replaceControlValues(loader, saveRow.fixValue, loadContext(session, programId, request.group))).trim();
                else if ((programId === 29 || programId === 36) && fieldName.includes("PR_ADDLESS")) fieldValue = "'A'";
                else fieldValue = quote(saveRow.fixValue);
              } else if (fieldName !== "") fieldValue = "'D'";
            } else if (saveRow.sysValue !== "") {
              const sys = saveRow.sysValue.toLowerCase();
              if (sys.startsWith("sys.")) fieldValue = await editSysValue(loader, programId, request, record, saveRow);
              else if (sys.startsWith("pkv.")) {
                const at = grid.updateTables.slice(0, i + 1).findIndex((name) => name.toLowerCase() === sys.slice(4));
                fieldValue = at >= 0 && pkTable[at] !== undefined ? String(pkTable[at]) : "''";
              }
            } else if (saveRow.queryString.trim() !== "") {
              const rows = await loader.readTable(saveRow.queryString);
              if (rows) {
                const first = displayValue(Object.values(rows[0])[0]).trim();
                fieldValue = saveRow.fieldType === "T" || saveRow.fieldType === "D" ? quote(first) : first;
              }
            }
            if (saveRow.fieldInUpdWhere.toLowerCase() === "true") where += `${where.trim() === "" ? " where " : " and "}${saveRow.field}=${fieldValue}`;
          }

          if (fieldValue !== "" && fieldName !== "") {
            emit(columnName(fieldName), fieldValue);
            if (source && updateLogSave && logFileY && toText(source.log_short) !== "") collectLog(log, source.log_short, fieldValue, pkTable[0] ?? 0);
          }
          if (extraValue !== "") emit(extraName, extraValue);
        }

        let query = "";
        if (boolRunUpdate && !boolRunAdd && whereCount > 0) {
          if (updates.length > 0) query = `UPDATE ${schema}.${table.toLowerCase()} SET ${updates.join(",")}${where === " where " ? "" : where}`;
          else if ([20, 30, 34, 52].includes(programId)) query = `DELETE FROM ${SYSTEM_SCHEMA}.${table.toLowerCase()} WHERE ${columnName(keyField)}=${pkTable[i] ?? 0}`;
          else if ((programId === 18 || programId === 31) && boolRunDelete) query = `DELETE FROM ${session.companySchema}.${table.toLowerCase()} WHERE ${columnName(keyField)}=${pkTable[i] ?? 0}`;
        }
        if (boolRunAdd && insertFields.length > 0) {
          const insertSchema = table.includes("COLOUR_SETUP") ? SYSTEM_SCHEMA : session.companySchema;
          const allocated = await withAllocatedKey(loader, insertSchema, table, keyField, insertFields, insertValues);
          if (allocated !== null) pkTable[i] = allocated;
          query = `INSERT INTO ${insertSchema}.${table.toLowerCase()} (${insertFields.join(",")}) VALUES (${insertValues.join(",")})`;
        }
        if (query !== "") { queries[i] = query; if (i === 0) firstTableHasQuery = true; }
      }

      if (!firstTableHasQuery) continue;

      if (updateLogSave && (log.fields !== "" || record.deleted) && logFileY && !session.flags.logFileSpecial) {
        if (programId === 48 && record.deleted) queries.push(`DELETE FROM ${session.companySchema}.addon_data WHERE prod_id=${pkTable[0] ?? 0}`);
        queries.push(`__LOG__${record.deleted ? "D" : "E"}`);
      }
      if (programId === 2 && !boolRunDelete) {
        const addonFld = await loader.readTable(`SELECT fiel_save, fiel_masterpos, fiel_entrypos, fiel_relate FROM ${session.companySchema}.addon_fld WHERE fiel_key = $1`, [toInt(request.group.firstCombo.value)]);
        if (addonFld) {
          const a = addonFld[0];
          const save = toText(field(a, "fiel_save"));
          const set = (target: string) => `UPDATE ${session.companySchema}.${target} SET txt_${save.toLowerCase()}=${addonName === "" ? "''" : addonName} WHERE key_${save.toLowerCase()}=${addonId}`;
          if (toText(field(a, "fiel_masterpos")) === "Y" && request.group.firstCombo.text.toLowerCase() !== "godown") queries.push(set("addon_data"));
          if (toText(field(a, "fiel_entrypos")) === "L") queries.push(set("addon_aentry"));
          if (toText(field(a, "fiel_entrypos")) === "P" && toText(field(a, "fiel_relate")) === "P") queries.push(set("addon_ientry"));
          if (toText(field(a, "fiel_entrypos")) === "P" && toText(field(a, "fiel_relate")) === "A") queries.push(set("addon_aentry"));
        }
      }
      if (programId === 2 && request.group.firstCombo.text.toUpperCase() === "GODOWN") {
        const godownFields = await loader.readTable(`SELECT fiel_key FROM ${session.companySchema}.addon_fld WHERE fiel_mbal = 'Y' AND fiel_entrypos = 'P' AND fiel_relate = 'P' AND fiel_pos <> 'D'`);
        if (godownFields) {
          const s = session.companySchema;
          queries.push(`__ALLOC__prod_balance__INSERT INTO ${s}.prod_balance (prodbal_key,p_short,prod_id,i_mastcd,i_paracd,open_stk,open_pcs,open_pack,open_weight,open_qty1,open_qty2,open_qty3,open_uom,pcs_uom,pack_uom,weight_uom,iqty1_uom,iqty2_uom,iqty3_uom,clsg_pcs,clsg_pack,clsg_weight,clsg_qty1,clsg_qty2,clsg_qty3,open_rate,add_pcs,add_pack,add_weight,add_qty1,add_qty2,add_qty3,less_pcs,less_pack,less_weight,less_qty1,less_qty2,less_qty3,p_level1,p_level2,p_level3,p_level4,p_level5,p_level6,p_level7,p_level8,p_level9,p_rate,prec_flag,year_id) SELECT __KEY__ + ROW_NUMBER() OVER () - 1,prodbal.p_short,prodbal.prod_id,${toInt(field(godownFields[0], "fiel_key"))},${addonId},0,0,0,0,0,0,0,prodbal.open_uom,prodbal.pcs_uom,prodbal.pack_uom,prodbal.weight_uom,prodbal.iqty1_uom,prodbal.iqty2_uom,prodbal.iqty3_uom,0,0,0,0,0,0,prodbal.open_rate,0,0,0,0,0,0,0,0,0,0,0,0,prodbal.p_level1,prodbal.p_level2,prodbal.p_level3,prodbal.p_level4,prodbal.p_level5,prodbal.p_level6,prodbal.p_level7,prodbal.p_level8,prodbal.p_level9,0,'GW',prodbal.year_id FROM ${s}.product_master product LEFT JOIN ${s}.prod_balance prodbal ON prodbal.prod_id=product.prod_key WHERE product.prod_pos<>'D' AND prodbal.prec_flag='RP' AND year_id=${quote(session.yearId)} AND prod_key NOT IN (SELECT prod_id FROM ${s}.prod_balance WHERE prec_flag<>'RP' AND i_paracd=${addonId} AND year_id=${quote(session.yearId)})`);
        }
      }
      if (programId === 8 && !boolRunDelete) queries.push(...await productEditFollowUp(loader, prepared, record, productId));
      if (programId === 14 && (request.group.firstCombo.text.includes("DEBTOR") || request.group.firstCombo.text.includes("CREDITOR"))) {
        queries.push(...await accountOpeningFollowUp(loader, prepared, request, record, pkTable[0] ?? 0));
      }
      if (programId === 8 && !boolRunDelete) {
        const s = session.companySchema;
        queries.push(`UPDATE ${s}.prod_balance prodbal SET p_short=product.prod_short,p_level1=product.level_1,p_level2=product.level_2,p_level3=product.level_3,p_level4=product.level_4,p_level5=product.level_5,p_level6=product.level_6,p_level7=product.level_7,p_level8=product.level_8,p_level9=product.level_9 FROM ${s}.product_master product WHERE product.prod_key=prodbal.prod_id AND prodbal.prec_flag<>'RP' AND prodbal.prod_id=${productId} AND prodbal.year_id=${quote(session.yearId)}`);
      }

      // SP_MASTER_UPDATE_DATA: the last-save query must still find the record as it was read.
      let validation = [43, 44, 45].includes(programId) && !boolRunDelete && queries[0]?.startsWith("INSERT")
        ? `select trg_key from ${session.companySchema}.target limit 1`
        : lastSaveQuery;
      const context = loadContext(session, programId, request.group, {
        gridRow: { cells: ["", ...Object.values(record.values)], byName: Object.fromEntries(Object.entries(record.values).map(([key, value]) => [key.toLowerCase(), value])) },
        keyFieldName: prepared.updateBody[1]?.field_name ?? "",
      });
      validation = await replaceControlValues(loader, replaceSessionValues(validation, session), context);
      if (validation.trim() !== "") {
        const found = await loader.readTable(validation);
        if (!found && programId !== 22) {
          throw new Error("Master unable to Save Another User Already Save... Save not successful");
        }
      }
      for (const raw of queries) {
        if (!raw) continue;
        if (raw.startsWith("__LOG__")) {
          statements.push(await masterLog(loader, programId, raw.slice(7) as "E" | "D", log, pkTable[0] ?? 0));
          continue;
        }
        let sql = raw;
        if (raw.startsWith("__ALLOC__")) {
          const [, tableName, rest] = /^__ALLOC__([a-z_]+)__([\s\S]*)$/.exec(raw) ?? [];
          const key = await allocateKey(client, session.companySchema, tableName, "");
          sql = rest.split("__KEY__").join(String(key?.value ?? 1));
        }
        statements.push(sql);
        await client.query(sql);
      }
      if (session.flags.logFileSpecial) statements.push(...await specialLog(loader, programId, request, prepared, pkTable[0] ?? 0, record.deleted ? "D" : "E", record.values));
      if (!boolRunDelete) {
        const copy = { programId, group: request.group, partyName, productName };
        statements.push(...await replicateEdit(loader, copy));
        if (!dryRun) cloud = (await cloudPushFor(loader, copy)) ?? cloud;
      }
      keys.push(pkTable[0] ?? 0);
    }

    if (dryRun) await client.query("ROLLBACK TO SAVEPOINT master_edit");
    else await client.query("RELEASE SAVEPOINT master_edit");
    return { ok: true, message: dryRun ? "Checked: the save would succeed (nothing was written)." : "Master saved", statements, keys, dryRun, warnings: loader.warnings, ...(cloud ? { cloud } : {}) };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT master_edit");
    return { ok: false, message: `Error while Saving, Error Message ${error instanceof Error ? error.message : String(error)}`, statements, dryRun, warnings: loader.warnings };
  }
}

/** int_rate_addon2 / int_rate_addon3, as Form Load reads them from addon_fld. */
export async function rateAddon(loader: Loader, programId: number, which: 2 | 3): Promise<number> {
  const s = loader.session.companySchema;
  const first = async (where: string) => toInt(field((await loader.readTable(`SELECT fiel_key FROM ${s}.addon_fld WHERE ${where} ORDER BY fiel_key LIMIT 1`))?.[0], "fiel_key"));
  const partyRate = "((fiel_err IS NOT NULL AND POSITION('ADDONRate,' IN fiel_err) > 0) OR fiel_partyrate = 'Y')";
  if (which === 3) return programId === 22 ? first(`${partyRate} AND fiel_relate = 'P' AND fiel_pos = 'A'`) : 0;
  let value = 0;
  let found = false;
  if (programId === 22) { value = await first(`${partyRate} AND fiel_relate = 'A' AND fiel_pos = 'A'`); found = value > 0; }
  else if ([23, 26, 28, 32].includes(programId) || (programId === 36 && s.toUpperCase().includes("SHAH_TRADING"))) { value = await first(`${partyRate} AND fiel_relate = 'P' AND fiel_pos = 'A'`); found = value > 0; }
  else if (programId === 29 || programId === 36) { value = await first(`fiel_err IS NOT NULL AND POSITION('PBRFN,' IN fiel_err) > 0 AND fiel_relate = 'P' AND fiel_pos = 'A'`); found = value > 0; }
  else if (programId === 50) { value = await first(`fiel_partyrate = 'Y' AND fiel_relate = 'P' AND fiel_pos = 'A'`); found = value > 0; }
  if (!found && programId === 36) value = await first(`fiel_err IS NOT NULL AND POSITION('BRFN,' IN fiel_err) > 0 AND fiel_relate = 'P' AND fiel_pos = 'A'`);
  return value;
}

async function editSysValue(loader: Loader, programId: number, request: EditSaveRequest, record: EditedRecord, saveRow: SaveRow): Promise<string> {
  const { session } = loader;
  const now = new Date();
  const valueOf = (name: string) => record.values[lower(name)] ?? "";
  const first = (name: string) => request.firstRecord[lower(name)] ?? "";
  const secondComboPrograms = [21, 22, 23, 26, 28, 29, 32, 36, 42, 51];
  switch (saveRow.sysValue.toLowerCase()) {
    case "sys.firstcomboid": return String(toInt(request.group.firstCombo.value));
    case "sys.secendcombotext": return quote(request.group.secondCombo?.text ?? "");
    case "sys.usernumber": return "''";
    case "sys.yearid": return quote(session.yearId);
    case "sys.today":
    case "sys.server.today": return quote(formatDesktopDate(now));
    case "sys.time":
    case "sys.server.time": return quote(formatDesktopTime(now));
    case "sys.update.thisfieldtext": return quote(first(saveRow.field));
    case "sys.givenfieldtext": return quote(valueOf(saveRow.updFieldValue));
    case "sys.update.givenfieldtext":
      if (saveRow.fieldType === "N") {
        if (first(saveRow.updFieldValue) !== "") return [...secondComboPrograms, 50].includes(programId) ? valueOf(saveRow.updFieldValue) : first(saveRow.updFieldValue);
        if (valueOf(saveRow.updFieldValue) !== "") return secondComboPrograms.includes(programId) ? valueOf(saveRow.updFieldValue) : "null";
        return "";
      }
      return quote(first(saveRow.updFieldValue));
    case "sys.multiply_dependfld":
      if (saveRow.fieldType === "N") {
        if (valueOf(saveRow.updFieldValue) !== "") {
          const amount = toDecimal(valueOf(saveRow.updFieldValue));
          return valueOf(saveRow.valueDependOn).length > 0 && amount > 0 ? String(toDecimal(valueOf(saveRow.valueDependOn)) * amount) : "0.0000";
        }
        return "";
      }
      return "0";
    case "sys.divide_dependfld":
      if (saveRow.fieldType === "N") {
        if (valueOf(saveRow.updFieldValue) !== "") {
          const amount = toDecimal(valueOf(saveRow.updFieldValue));
          const kind = saveRow.updFieldValue.slice(5);
          if (valueOf(saveRow.valueDependOn).length > 0 && amount > 0) {
            return kind === "WEIGHT" && amount === 1 ? String(toDecimal(valueOf(saveRow.valueDependOn))) : runFormula(toDecimal(valueOf(saveRow.valueDependOn)) / amount, "+", 0, 0);
          }
          return "0.0000";
        }
        return "";
      }
      return "0";
    case "sys.sum_dependfld":
      if (saveRow.updFieldValue === "") return "";
      return saveRow.fieldType === "N" ? valueOf(saveRow.updFieldValue) : quote(valueOf(saveRow.updFieldValue).trim());
    case "sys.prog_id": {
      const text = await replaceControlValues(loader, saveRow.updFieldValue, loadContext(session, programId, request.group));
      return text.trim();
    }
    case "sys.bn_dbcode": {
      const side = valueOf("bn_side");
      return `${["P", "C", "T"].includes(side.charAt(0)) ? 2 : 1},`;
    }
    case "sys.blank": return "''";
    default: return "";
  }
}

async function productEditFollowUp(loader: Loader, prepared: PreparedProgram, record: EditedRecord, productId: number): Promise<string[]> {
  void productId;
  const { session } = loader;
  const s = session.companySchema;
  const out: string[] = [];
  const maxLevel = toInt(field(prepared.levelMaster ?? undefined, "div_maxlvl"));
  const levels = (count: number, column: string, separator: string) => Array.from({ length: count }, (_, index) => `${column}_${index + 1}`).join(`||'${separator}'||`);
  const allLevel = maxLevel >= 1 && maxLevel <= 6 ? levels(maxLevel, "LEVEL", "/") : "";
  const allDesc = maxLevel >= 1 && maxLevel <= 6 ? levels(maxLevel, "DESC", " ") : "";
  const rows = prepared.updateBody;
  const special = session.licence === 12 || session.licence === 28;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.database_name.toLowerCase().trim() !== "product_master" || !row.field_name.toLowerCase().trim().startsWith("level_")) continue;
    const code = record.values[lower(row.field_name)] ?? "";
    if (code.trim() === "") continue;
    const next = rows[index + 1];
    const description = next ? record.values[lower(next.field_name)] ?? "" : "";
    const level = toInt(row.field_name.trim().charAt(6));
    const existing = await loader.readTable(`SELECT level_no, level_code, level_desc FROM ${s}.level_desc WHERE level_no = $1 AND level_code = $2 LIMIT 1`, [level, code]);
    const recompute = allLevel !== "" ? `UPDATE ${s}.product_master SET prod_short=${allLevel},post_short=${allLevel},prod_map=${allLevel},prod_desc=${allDesc},bill_desc=${allDesc} WHERE level_${level}=${quote(code)}` : "";
    if (!special) {
      if (code.trim() === (record.backup[lower(row.field_name)] ?? "").trim() && maxLevel !== 1) continue;
      if (!existing) out.push(`__ALLOC__level_desc__INSERT INTO ${s}.level_desc (level_key,level_no,level_code,level_name,level_short,level_desc) VALUES (__KEY__,${level},${quote(code)},${quote(description)},${quote(code)},${quote(description)})`);
      else if (maxLevel === 1) out.push(`UPDATE ${s}.level_desc SET level_code=${quote(code)},level_name=${quote(description)},level_short=${quote(code)},level_desc=${quote(description)} WHERE level_no=${level} AND level_code=${quote(code)}`);
      // otherwise the C#'s "insert ... where not exists" adds nothing
    } else if (existing) {
      if ((record.backup[lower(next?.field_name ?? "")] ?? "") !== description) {
        out.push(`UPDATE ${s}.level_desc SET level_name=${quote(description)},level_desc=${quote(description)} WHERE level_no=${level} AND level_code=${quote(code)}`);
        out.push(`UPDATE ${s}.product_master SET desc_${level}=${quote(description)} WHERE level_${level}=${quote(code)}`);
        if (recompute) out.push(recompute);
      }
    } else {
      out.push(`__ALLOC__level_desc__INSERT INTO ${s}.level_desc (level_key,level_no,level_code,level_name,level_short,level_desc) VALUES (__KEY__,${level},${quote(code)},${quote(description)},${quote(code)},${quote(description)})`);
      out.push(`UPDATE ${s}.product_master SET desc_${level}=${quote(description)} WHERE level_${level}=${quote(code)}`);
      if (recompute) out.push(recompute);
    }
  }
  return out;
}

async function accountOpeningFollowUp(loader: Loader, prepared: PreparedProgram, request: EditSaveRequest, record: EditedRecord, code: number): Promise<string[]> {
  const { session } = loader;
  const s = session.companySchema;
  const out: string[] = [];
  const debtor = request.group.firstCombo.text.includes("DEBTOR");
  for (const row of prepared.updateBody) {
    if (row.database_name.toLowerCase().trim() !== "ac_balance" || !row.field_name.toLowerCase().trim().startsWith("opening")) continue;
    const value = record.values[lower(row.field_name)] ?? "";
    if (value.trim() === "") continue;
    const amount = toDecimal(value);
    const existing = await loader.readTable(`SELECT out_key FROM ${s}.outclear WHERE out_fulldocno = 'OPENING' AND code = $1`, [code]);
    if (!existing) {
      out.push(`__ALLOC__outclear__INSERT INTO ${s}.outclear (out_key,out_date,out_fulldocno,out_entryamt,out_setoff,out_ly_setoff,out_on_acamt,out_dbcode,out_entrybook,code,ref_no,set_off,clear_pos,year_id) VALUES (__KEY__,${quote(formatDesktopDate(session.tarikh1))},'OPENING',${amount},0,0,0,${amount < 0 ? 2 : 1},${debtor ? 8 : 13},${code},'',0,'P',${quote(session.yearId)})`);
      continue;
    }
    const settled = await loader.readTable(
      `SELECT SUM(CASE WHEN out_dbcode=${debtor ? 1 : 2} THEN out_entryamt-(CASE WHEN out_entryamt >= out_ly_setoff THEN out_ly_setoff ELSE 0 END) ELSE (out_entryamt-(CASE WHEN out_entryamt >= out_ly_setoff THEN out_ly_setoff ELSE 0 END))*-1 END) AS amount
         FROM ${s}.outclear outclr LEFT JOIN ${s}.ledger led ON led.led_key=outclr.out_ledid
        WHERE (led.led_key=led.unique_key OR led.unique_key>1) AND outclr.code=$1 AND out_date < $2`,
      [code, formatDesktopDate(session.tarikh1)],
    );
    let sql = `UPDATE ${s}.outclear SET `;
    let remaining = 0;
    if (!settled || field(settled[0], "amount") === null) sql += `out_entryamt=${amount}`;
    else {
      remaining = Math.abs(amount) - toDecimal(field(settled[0], "amount"));
      sql += `out_entryamt=${amount < 0 ? remaining * -1 : remaining}`;
    }
    sql += remaining === 0 ? `,out_dbcode=${debtor ? 1 : 2}` : `,out_dbcode=${amount < 0 ? 2 : 1}`;
    sql += ` WHERE out_key=${toInt(field(existing[0], "out_key"))}`;
    out.push(sql);
  }
  return out;
}

/*
 * The company-group copies and the Ezeone push live in replicate.ts. The desktop's Delete
 * key / right-click delete rights prompts (Z_UserPassword) are answered by the passwords a
 * request carries; the screen asks for them.
 */
