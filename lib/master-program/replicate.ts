import { toInt, toText } from "./legacy";
import { Loader } from "./load";
import { allocateKey, primaryKeyField } from "./save";
import { SYSTEM_SCHEMA } from "./session";
import type { CloudPush, GroupState } from "./types";

export type { CloudPush };

/**
 * The licence-specific copies Btn_Master_AddSave_Click and Btn_Master_EditSave_Click make
 * into the group's other company databases once a master is saved:
 *
 *  - Licence 7, 22, 92 (SURFACE_SDIPL_, SHAH_TRADING_INV, JAIN_LAM, KITOX_HARDWARE): a new
 *    debtor is copied to every company open for the same year, and an edited one updates
 *    the copies (account, address, addon data).
 *  - Licence 7 (SURFACE_SDIPL_): the same for creditors, without addon data.
 *  - Licence 21 (RISHABH_PLASTIC): a new FINISH GOODS product is copied to the RPI group.
 *  - Licence 7, 9, 19, 34, 92: a new product is copied with its group mapped by name and
 *    the level_desc rows the group's level count needs.
 *  - Licence 28, 51, 68, 75 or PROD_CHILD_PARENT: txprod_id defaults to the product's key.
 *
 * On SQL Server each company is a database named by CO_DATANAME; here it is the schema of
 * that name, lowercased. Values are passed as parameters instead of being pasted into the
 * text, and new keys are allocated as max+1 under a lock because the migrated tables have
 * no IDENTITY. Everything runs in the save's transaction, so a failed copy undoes the save.
 */

type Row = Record<string, unknown>;
const field = Loader.field;
const identifier = /^[a-z_][a-z0-9_]*$/;

export type Replication = { statements: string[] };

/** A readable form of a parameterised statement for the save's statement list. */
function render(sql: string, params: readonly unknown[]): string {
  return sql.replace(/\$(\d+)/g, (_, index: string) => {
    const value = params[Number(index) - 1];
    if (value === null || value === undefined) return "null";
    if (typeof value === "number") return String(value);
    if (value instanceof Date) return `'${value.toISOString()}'`;
    return `'${String(value).replace(/'/g, "''")}'`;
  });
}

const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

type TableColumns = Map<string, string>;
const columnCache = new WeakMap<Loader, Map<string, TableColumns>>();

/** Actual column names of a table, keyed lowercase; empty when the table is missing. */
async function columnsOf(loader: Loader, schema: string, table: string): Promise<TableColumns> {
  let cache = columnCache.get(loader);
  if (!cache) { cache = new Map(); columnCache.set(loader, cache); }
  const key = `${schema}.${table}`.toLowerCase();
  if (!cache.has(key)) {
    const rows = (await loader.client.query("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2", [schema, table.toLowerCase()])).rows as { column_name: string }[];
    cache.set(key, new Map(rows.map((row) => [row.column_name.toLowerCase(), row.column_name])));
  }
  return cache.get(key)!;
}

const quoted = (name: string) => (name === name.toLowerCase() && identifier.test(name) ? name : `"${name.replace(/"/g, '""')}"`);

/**
 * INSERT one row. Columns the target table lacks are left out (a company created on an
 * older setup may not have every column), and the table's key is allocated when the row
 * does not carry it. Returns the key written, or 0 when the table has none.
 */
async function insertRow(loader: Loader, out: Replication, schema: string, table: string, values: Readonly<Record<string, unknown>>): Promise<number> {
  const columns = await columnsOf(loader, schema, table);
  if (columns.size === 0) { loader.warnings.push(`${schema}.${table} is missing; the copy skipped it`); return 0; }
  const names: string[] = [];
  const params: unknown[] = [];
  for (const [name, value] of Object.entries(values)) {
    const actual = columns.get(name.toLowerCase());
    if (!actual || names.includes(quoted(actual))) continue;
    names.push(quoted(actual));
    params.push(value);
  }
  let key = 0;
  const allocated = await allocateKey(loader.client, schema, table, await primaryKeyField(loader, table.toUpperCase()));
  if (allocated && !names.some((name) => name.replace(/"/g, "").toLowerCase() === allocated.column.replace(/"/g, "").toLowerCase())) {
    names.unshift(allocated.column);
    params.unshift(allocated.value);
    key = allocated.value;
  }
  const sql = `INSERT INTO ${schema}.${table.toLowerCase()} (${names.join(",")}) VALUES (${params.map((_, index) => `$${index + 1}`).join(",")})`;
  out.statements.push(render(sql, params));
  await loader.client.query(sql, params);
  return key;
}

/** UPDATE one table; columns the target lacks are left out. */
async function updateRows(loader: Loader, out: Replication, schema: string, table: string, values: Readonly<Record<string, unknown>>, where: string, whereParams: readonly unknown[]) {
  const columns = await columnsOf(loader, schema, table);
  if (columns.size === 0) { loader.warnings.push(`${schema}.${table} is missing; the copy skipped it`); return; }
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [name, value] of Object.entries(values)) {
    const actual = columns.get(name.toLowerCase());
    if (!actual) continue;
    params.push(value);
    sets.push(`${quoted(actual)}=$${params.length}`);
  }
  if (sets.length === 0) return;
  const shifted = where.replace(/\$(\d+)/g, (_, index: string) => `$${Number(index) + params.length}`);
  const all = [...params, ...whereParams];
  const sql = `UPDATE ${schema}.${table.toLowerCase()} SET ${sets.join(",")} WHERE ${shifted}`;
  out.statements.push(render(sql, all));
  await loader.client.query(sql, all);
}

async function first(loader: Loader, sql: string, params: readonly unknown[]): Promise<Row | undefined> {
  return (await loader.client.query(sql, [...params])).rows[0] as Row | undefined;
}

/** Every column of a row, keyed lowercase, restricted to the names given. */
function pick(row: Row | undefined, names: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of names) out[name] = field(row, name) ?? null;
  return out;
}

type TargetFilter = Readonly<{ coGroup?: string; coGroupName?: string; excludeContaining?: string }>;

/**
 * The other companies open for exactly the same accounting year (CNAME c_tarikh1 and
 * c_tarikh2 on the same days), optionally narrowed to a group. Companies whose schema is
 * not in this database are reported and skipped.
 */
async function targetSchemas(loader: Loader, filter: TargetFilter): Promise<string[]> {
  const { session } = loader;
  const params: unknown[] = [session.companySchema, localDate(session.tarikh1), localDate(session.tarikh2)];
  let extra = "";
  if (filter.coGroup !== undefined) { params.push(filter.coGroup); extra += ` AND BTRIM(co_group) = $${params.length}`; }
  if (filter.coGroupName !== undefined) { params.push(filter.coGroupName); extra += ` AND BTRIM(co_group_name) = $${params.length}`; }
  if (filter.excludeContaining !== undefined) { params.push(filter.excludeContaining.toLowerCase()); extra += ` AND STRPOS(LOWER(co_dataname), $${params.length}) = 0`; }
  const rows = (await loader.client.query(
    `SELECT DISTINCT LOWER(BTRIM(co_dataname)) AS schema_name
       FROM ${SYSTEM_SCHEMA}.company
      WHERE co_pos = 'A' AND LOWER(BTRIM(co_dataname)) <> $1${extra}
        AND co_key IN (SELECT c_id FROM ${SYSTEM_SCHEMA}.cname WHERE c_tarikh1::date = $2::date AND c_tarikh2::date = $3::date)
      ORDER BY 1`,
    params,
  )).rows as { schema_name: string }[];
  const out: string[] = [];
  for (const { schema_name: schema } of rows) {
    if (!identifier.test(schema)) continue;
    const exists = (await loader.client.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = $1", [schema])).rowCount;
    if (exists) out.push(schema);
    else loader.warnings.push(`Company database ${schema} is not in this installation; the copy skipped it`);
  }
  return out;
}

const has = (schema: string, text: string) => schema.toUpperCase().includes(text);

// ---------------------------------------------------------------------------------------
// Addon sub-ledgers and addon data

const ADDON_SUB_COLUMNS = ["para_id", "sub_name", "address_1", "address_2", "address_3", "city", "pin_code", "tel_no", "std_code", "lst_no", "cst_no", "autho_no", "e_mail", "website", "mobile_no", "contact", "local_code", "add_remark", "fax", "sub_relate", "district", "sub_pos", "last_savedate", "last_savetime"];

/**
 * The target's ADDON_SUB code for a name, created (with its SUB_BALANCE row) when the
 * target does not have it yet: a copy of the source sub-ledger when there is one, else a
 * blank one relating to `fallbackRelate`.
 */
async function targetSubCode(loader: Loader, out: Replication, target: string, paraId: number, name: string, fallbackRelate: string, balanceRelate: string): Promise<number> {
  const { session } = loader;
  const existing = await first(loader, `SELECT sub_code FROM ${target}.addon_sub WHERE sub_name = $1 AND sub_pos = 'A' AND para_id = $2`, [name, paraId]);
  if (existing) return toInt(field(existing, "sub_code"));
  const source = await first(loader, `SELECT * FROM ${session.companySchema}.addon_sub WHERE sub_name = $1 AND sub_pos = 'A' AND para_id = $2`, [name, paraId]);
  const now = new Date();
  const values = source
    ? { ...pick(source, ADDON_SUB_COLUMNS), sub_name: name }
    : { ...Object.fromEntries(ADDON_SUB_COLUMNS.map((column) => [column, ""])), para_id: paraId, sub_name: name, sub_relate: fallbackRelate, sub_pos: "A", last_savedate: localDate(now), last_savetime: now.toTimeString().slice(0, 8) };
  let code = await insertRow(loader, out, target, "addon_sub", values);
  if (code === 0) code = toInt(field(await first(loader, `SELECT MAX(sub_code) AS sub_code FROM ${target}.addon_sub`, []), "sub_code"));
  await insertRow(loader, out, target, "sub_balance", {
    sub_code: code, sub_yearid: session.yearId, sub_opening: 0, sub_debit: 0, sub_credit: 0, sub_closing: 0,
    sub_oqty1: 0, sub_aqty1: 0, sub_lqty1: 0, sub_cqty1: 0, sub_oqty2: 0, sub_aqty2: 0, sub_lqty2: 0, sub_cqty2: 0, sub_relate: balanceRelate,
  });
  return code;
}

type AddonCopy = Readonly<{
  relate: "A" | "P";
  owner: "code" | "prod_id";
  sourceId: number;
  targetId: number;
  /** Extra ADDON_FLD condition the desktop adds for this copy. */
  fieldFilter: string;
  fallbackRelate: string;
  balanceRelate: string;
  /** Edit: UPDATE the target's row instead of inserting one. */
  update?: boolean;
}>;

async function copyAddonData(loader: Loader, out: Replication, target: string, copy: AddonCopy) {
  const { session } = loader;
  const source = await first(loader, `SELECT * FROM ${session.companySchema}.addon_data WHERE ${copy.owner} = $1`, [copy.sourceId]);
  if (!source) return;
  const fields = (await loader.client.query(
    `SELECT fiel_key, BTRIM(fiel_save) AS fiel_save FROM ${target}.addon_fld
      WHERE fiel_type = 'M' AND fiel_relate = $1 AND fiel_masterpos = 'Y' AND fiel_pos = 'A'${copy.fieldFilter} ORDER BY fiel_serial`,
    [copy.relate],
  )).rows as { fiel_key: number; fiel_save: string }[];
  if (fields.length === 0) return;
  const values: Record<string, unknown> = {};
  for (const addon of fields) {
    const save = addon.fiel_save.toLowerCase();
    const name = toText(field(source, `txt_${save}`));
    const code = await targetSubCode(loader, out, target, toInt(addon.fiel_key), name, copy.fallbackRelate, copy.balanceRelate);
    // An edit leaves the target's own price group, collection, salesman and lock alone,
    // except in SHAH_TRADING companies.
    if (copy.update && /PRICEGRP|COLLECTION|SALESMAN|PLOCK/.test(save.toUpperCase()) && !has(target, "SHAH_TRADING")) continue;
    values[`txt_${save}`] = name;
    values[`key_${save}`] = code;
  }
  if (copy.update) await updateRows(loader, out, target, "addon_data", values, `${copy.owner} = $1`, [copy.targetId]);
  else await insertRow(loader, out, target, "addon_data", { [copy.owner]: copy.targetId, ...values });
}

// ---------------------------------------------------------------------------------------
// Accounts (program 14)

const ACCOUNT_COLUMNS = ["name", "book", "a_pos", "a_dayclose", "a_posting", "a_mapcode", "a_short", "credit_days", "int_perc", "grace_days", "int_flag", "limit", "warn_limit", "os_flag", "free_flag", "a_perc", "not2del", "budget_flag", "budget", "budget_perc", "bs_id", "ac_opensty", "ac_message", "narr_long", "last_savedate", "last_savetime", "exp_flag", "other_state", "transaction_code", "image_file_name"];
const INT_MASTER_COLUMNS = ["year_id", "int_recflag", "int_rperc", "int_pperc", "int_rround", "int_pround", "ly_loan", "ly_int", "tds_req", "tds_rate", "tds_round", "tds_cert", "tds_limit", "days_base"];
const OUTCLEAR_COLUMNS = ["out_date", "out_fulldocno", "out_entryamt", "out_setoff", "out_ly_setoff", "out_on_acamt", "out_dbcode", "out_entrybook", "ref_no", "clear_pos"];
const ADDRESS_COLUMNS = ["address_1", "address_2", "address_3", "city", "pin_code", "tel_no", "std_code", "lst_no", "cst_no", "autho_no", "pan_no", "e_mail", "website", "mobile_no", "pager_no", "contact", "local_code", "add_remark", "fax", "p_reg", "lbt_no", "gst_no", "dlic_no", "dlic_no1", "defa_add", "owners_name", "owner_mobile", "manager_name", "manager_mobile"];
const SDIPL_ADDRESS_COLUMNS = ["tel_no1", "acc_name", "accname_mob"];
const ACCOUNT_EDIT_COLUMNS = ["a_dayclose", "a_posting", "a_mapcode", "a_short", "ac_message", "int_perc", "int_flag", "limit", "warn_limit", "os_flag", "free_flag", "a_perc", "not2del", "budget_flag", "budget_perc", "ac_opensty", "exp_flag", "other_state", "transaction_code"];

/** The target's state key with the same OPT_DESC as the source's STATE_ID. */
async function targetState(loader: Loader, target: string, stateId: unknown): Promise<number | null> {
  const row = await first(loader, `SELECT idopt_key FROM ${target}.idopt_master WHERE idopt_flag = 'ST' AND opt_desc IN (SELECT opt_desc FROM ${loader.session.companySchema}.idopt_master WHERE idopt_flag = 'ST' AND idopt_key = $1) LIMIT 1`, [toInt(stateId)]);
  return row ? toInt(field(row, "idopt_key")) : null;
}

function accountCopyRule(schema: string, licence: number, groupText: string): "debtor" | "creditor" | null {
  if (groupText === "DEBTORS LEDGER" && [7, 22, 92].includes(licence) && ["SURFACE_SDIPL_", "SHAH_TRADING_INV", "JAIN_LAM", "KITOX_HARDWARE"].some((name) => has(schema, name))) return "debtor";
  if (groupText === "CREDITOR LEDGER" && licence === 7 && has(schema, "SURFACE_SDIPL_")) return "creditor";
  return null;
}

async function copyNewAccount(loader: Loader, out: Replication, kind: "debtor" | "creditor", partyName: string) {
  const { session } = loader;
  const book = kind === "debtor" ? 2 : 3;
  const sdipl = has(session.companySchema, "SURFACE_SDIPL_");
  const account = await first(loader, `SELECT * FROM ${session.companySchema}.account WHERE book = $1 AND a_pos = 'A' AND name = $2 LIMIT 1`, [book, partyName]);
  if (!account) return;
  const sourceCode = toInt(field(account, "code"));
  for (const target of await targetSchemas(loader, {})) {
    if (await first(loader, `SELECT 1 FROM ${target}.account WHERE book = $1 AND a_pos = 'A' AND name = $2`, [book, partyName])) continue;
    let code = await insertRow(loader, out, target, "account", pick(account, ACCOUNT_COLUMNS));
    if (code === 0) code = toInt(field(await first(loader, `SELECT code FROM ${target}.account WHERE a_pos = 'A' AND book = $1 AND name = $2 ORDER BY code DESC LIMIT 1`, [book, partyName]), "code"));
    await insertRow(loader, out, target, "ac_balance", { code, year_id: session.yearId, a_recflag: "AC", opening: 0, debit: 0, credit: 0, closing: 0, last_year: 0, os_billdiff: 0 });
    const interest = await first(loader, `SELECT * FROM ${session.companySchema}.int_master WHERE code = $1 LIMIT 1`, [sourceCode]);
    if (interest) await insertRow(loader, out, target, "int_master", { code, ...pick(interest, INT_MASTER_COLUMNS) });
    const outclear = await first(loader, `SELECT * FROM ${session.companySchema}.outclear WHERE code = $1 LIMIT 1`, [sourceCode]);
    if (outclear) await insertRow(loader, out, target, "outclear", { code, year_id: session.yearId, ...pick(outclear, OUTCLEAR_COLUMNS), set_off: 0 });
    const address = await first(loader, `SELECT * FROM ${session.companySchema}.address WHERE address_id = 1 AND code = $1 LIMIT 1`, [sourceCode]);
    if (address) {
      await insertRow(loader, out, target, "address", {
        code, address_id: field(address, "address_id"), ...pick(address, ADDRESS_COLUMNS), a_pos: field(address, "a_pos"), designation: field(address, "designation"),
        state_id: (await targetState(loader, target, field(address, "state_id"))) ?? 0,
        ...(sdipl ? pick(address, SDIPL_ADDRESS_COLUMNS) : {}),
      });
    }
    if (kind === "debtor") {
      await copyAddonData(loader, out, target, { relate: "A", owner: "code", sourceId: sourceCode, targetId: code, fieldFilter: " AND fiel_short <> 'SUB_LEDGER'", fallbackRelate: "A", balanceRelate: "A" });
    }
  }
}

async function copyEditedAccount(loader: Loader, out: Replication, kind: "debtor" | "creditor", partyName: string) {
  const { session } = loader;
  const book = kind === "debtor" ? 2 : 3;
  const sdipl = has(session.companySchema, "SURFACE_SDIPL_");
  const account = await first(loader, `SELECT * FROM ${session.companySchema}.account WHERE a_pos = 'A' AND book = $1 AND name = $2 LIMIT 1`, [book, partyName]);
  if (!account) return;
  const sourceCode = toInt(field(account, "code"));
  for (const target of await targetSchemas(loader, {})) {
    const copy = await first(loader, `SELECT code FROM ${target}.account WHERE book = $1 AND a_pos = 'A' AND name = $2 LIMIT 1`, [book, partyName]);
    if (!copy) continue;
    const code = toInt(field(copy, "code"));
    const accountValues = pick(account, ACCOUNT_EDIT_COLUMNS);
    if (kind === "creditor") accountValues.name = field(account, "name");
    if (kind === "debtor" && has(target, "SHAH_TRADING")) accountValues.narr_long = field(account, "narr_long");
    await updateRows(loader, out, target, "account", accountValues, "code = $1", [code]);
    const address = await first(loader, `SELECT * FROM ${session.companySchema}.address WHERE address_id = 1 AND code = $1 LIMIT 1`, [sourceCode]);
    if (address) {
      const values: Record<string, unknown> = pick(address, ADDRESS_COLUMNS);
      const state = await targetState(loader, target, field(address, "state_id"));
      if (state !== null) values.state_id = state;
      if (sdipl) Object.assign(values, pick(address, SDIPL_ADDRESS_COLUMNS));
      await updateRows(loader, out, target, "address", values, "code = $1", [code]);
    }
    if (kind === "debtor") {
      await copyAddonData(loader, out, target, { relate: "A", owner: "code", sourceId: sourceCode, targetId: code, fieldFilter: " AND fiel_short <> 'SUB_LEDGER'", fallbackRelate: "A", balanceRelate: "A", update: true });
    }
  }
}

// ---------------------------------------------------------------------------------------
// Products (program 8)

const PRODUCT_COLUMNS = ["prod_short", "post_short", "prod_desc", "bill_desc", "base_qty1", "base_qty2", "base_qty3", "base_pcs", "base_pack", "base_weight", "open_uom", "pcs_uom", "pack_uom", "weight_uom", "qty1_uom", "qty2_uom", "qty3_uom", "rep1_uom", "rep2_uom", "min_qty", "minuom_id", "max_qty", "maxuom_id", "icode_type", "inventory", "recduom_id", "issuuom_id", "prod_group", "level_1", "level_2", "level_3", "level_4", "level_5", "level_6", "level_7", "level_8", "level_9", "desc_1", "desc_2", "desc_3", "desc_4", "desc_5", "desc_6", "desc_7", "desc_8", "desc_9", "iflag_tax", "value_calc", "round_up", "iflag_free", "ivltype", "prod_map", "iflag_dis", "prod_pos", "lead_days", "re_order", "reserve_stk", "rep_rate", "factor_calc", "last_savedate", "last_savetime", "recdrateuom_id", "issurateuom_id", "image_file_name", "bar_code", "hsn_code", "tax_perc", "supply_type", "tax_type"];

/** The product row a copy inserts: opening stock and rate start at nothing in the other company. */
function productValues(product: Row, group: unknown): Record<string, unknown> {
  return {
    ...pick(product, PRODUCT_COLUMNS),
    // The desktop writes BASE_QTY1 into BASE_QTY2 as well; the copy keeps each quantity.
    open_stk: 0, open_pcs: 0, open_pack: 0, open_weight: 0, open_qty1: 0, open_qty2: 0, open_qty3: 0, open_rate: 0,
    prod_group: group,
    imp_prodkey: field(product, "prod_key"),
  };
}

function balanceValues(product: Row, prodId: number, yearId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const zero = Object.fromEntries(["open_stk", "open_pcs", "open_pack", "open_weight", "open_qty1", "open_qty2", "open_qty3", "clsg_pcs", "clsg_pack", "clsg_weight", "clsg_qty1", "clsg_qty2", "clsg_qty3", "open_rate", "add_pcs", "add_pack", "add_weight", "add_qty1", "add_qty2", "add_qty3", "less_pcs", "less_pack", "less_weight", "less_qty1", "less_qty2", "less_qty3", "p_rate"].map((name) => [name, 0]));
  return {
    p_short: field(product, "prod_short"), prod_id: prodId, ...zero,
    open_uom: field(product, "open_uom"), pcs_uom: field(product, "pcs_uom"), pack_uom: field(product, "pack_uom"), weight_uom: field(product, "weight_uom"),
    iqty1_uom: field(product, "qty1_uom"), iqty2_uom: field(product, "qty2_uom"), iqty3_uom: field(product, "qty3_uom"),
    ...Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`p_level${index + 1}`, field(product, `level_${index + 1}`)])),
    prec_flag: "RP", year_id: yearId, ...extra,
  };
}

async function ensureLevelDesc(loader: Loader, out: Replication, target: string, product: Row, levels: number) {
  for (let level = 1; level <= levels; level += 1) {
    const code = toText(field(product, `level_${level}`));
    if (await first(loader, `SELECT 1 FROM ${target}.level_desc WHERE level_no = $1 AND level_code = $2`, [level, code])) continue;
    const description = toText(field(product, `desc_${level}`));
    await insertRow(loader, out, target, "level_desc", { level_no: level, level_code: code, level_name: description, level_short: code, level_desc: description });
  }
}

async function insertProduct(loader: Loader, out: Replication, target: string, product: Row, group: unknown): Promise<number> {
  let key = await insertRow(loader, out, target, "product_master", productValues(product, group));
  if (key === 0) key = toInt(field(await first(loader, `SELECT MAX(prod_key) AS prod_key FROM ${target}.product_master`, []), "prod_key"));
  await insertRow(loader, out, target, "prod_balance", balanceValues(product, key, loader.session.yearId));
  return key;
}

/** Licence 21: a FINISH GOODS product goes to the other RPI companies. */
async function copyRishabhProduct(loader: Loader, out: Replication, productName: string) {
  const { session } = loader;
  const product = await first(loader, `SELECT prodmas.*, adata.txt_prodtype AS prodtype FROM ${session.companySchema}.product_master prodmas LEFT JOIN ${session.companySchema}.addon_data adata ON adata.prod_id = prodmas.prod_key WHERE prod_pos = 'A' AND prod_desc = $1 LIMIT 1`, [productName]);
  if (!product || toText(field(product, "prodtype")).toUpperCase() !== "FINISH GOODS") return;
  for (const target of await targetSchemas(loader, { coGroup: "RPI" })) {
    if (await first(loader, `SELECT 1 FROM ${target}.product_master WHERE prod_pos = 'A' AND prod_desc = $1`, [productName])) continue;
    const key = await insertProduct(loader, out, target, product, field(product, "prod_group"));
    await copyAddonData(loader, out, target, { relate: "P", owner: "prod_id", sourceId: toInt(field(product, "prod_key")), targetId: key, fieldFilter: "", fallbackRelate: "P", balanceRelate: "A" });
    await ensureLevelDesc(loader, out, target, product, 1);
  }
}

function productGroupRule(schema: string, licence: number): TargetFilter | null {
  if (has(schema, "SHAH_TRADING") || has(schema, "SHAH_TECH_INV")) return null;
  if (licence === 7 && has(schema, "SURFACE_SDIPL_")) return { coGroup: "SURF", excludeContaining: "SHAH_TECH_INV" };
  if (licence === 34 && has(schema, "MUDRA_FOODS")) return { coGroupName: "MUDRA" };
  if (licence === 19 && has(schema, "AKSHAT_DECOR")) return { coGroupName: "AKSHAT" };
  if (licence === 92 && has(schema, "KITOX_HARDWARE")) return {};
  // The desktop also lists licence 9 (co_group JITUBHAI), but its outer condition never admits it.
  return null;
}

/** Licence 7, 19, 34, 92: the product goes to the group with its product group matched by name. */
async function copyGroupProduct(loader: Loader, out: Replication, filter: TargetFilter, productName: string) {
  const { session } = loader;
  const product = await first(loader, `SELECT prodmas.*, idopt.opt_desc FROM ${session.companySchema}.product_master prodmas LEFT JOIN ${session.companySchema}.idopt_master idopt ON idopt.idopt_key = prodmas.prod_group WHERE prod_pos = 'A' AND prod_desc = $1 LIMIT 1`, [productName]);
  if (!product) return;
  for (const target of await targetSchemas(loader, filter)) {
    const group = await first(loader, `SELECT idopt_key, div_maxlvl FROM ${target}.idopt_master idopt LEFT JOIN ${target}.level_master lvlmst ON lvlmst.prod_group = idopt.idopt_key WHERE idopt_pos = 'A' AND opt_desc = $1 LIMIT 1`, [toText(field(product, "opt_desc"))]);
    if (!group) continue;
    await ensureLevelDesc(loader, out, target, product, Math.min(9, toInt(field(group, "div_maxlvl"))));
    if (await first(loader, `SELECT 1 FROM ${target}.product_master WHERE prod_pos = 'A' AND prod_desc = $1`, [productName])) continue;
    const key = await insertProduct(loader, out, target, product, toInt(field(group, "idopt_key")));
    if (session.licence === 7) {
      const godowns = (await loader.client.query(`SELECT sub_code FROM ${target}.addon_sub WHERE sub_pos = 'A' AND para_id = 9`)).rows as Row[];
      for (const godown of godowns) {
        await insertRow(loader, out, target, "prod_balance", balanceValues(product, key, session.yearId, { prec_flag: "GW", i_mastcd: 9, i_paracd: toInt(field(godown, "sub_code")) }));
      }
    }
    await copyAddonData(loader, out, target, { relate: "P", owner: "prod_id", sourceId: toInt(field(product, "prod_key")), targetId: key, fieldFilter: " AND fiel_enter = 'M'", fallbackRelate: "P", balanceRelate: "P" });
  }
}

// ---------------------------------------------------------------------------------------
// Entry points

export type ReplicateRequest = Readonly<{
  programId: number;
  group: GroupState;
  /** str_Find_party_name / str_Find_product_name, as typed (not quoted). */
  partyName: string;
  productName: string;
}>;

/** After Btn_Master_AddSave_Click has written the new master. */
export async function replicateAdd(loader: Loader, request: ReplicateRequest): Promise<string[]> {
  const { session } = loader;
  const out: Replication = { statements: [] };
  if (request.programId === 14 && request.partyName !== "") {
    const kind = accountCopyRule(session.companySchema, session.licence, request.group.firstCombo.text);
    if (kind) await copyNewAccount(loader, out, kind, request.partyName);
  }
  if (request.programId === 8 && request.productName !== "") {
    if ([28, 51, 68, 75].includes(session.licence) || session.flags.productChildParent) {
      const sql = `UPDATE ${session.companySchema}.product_master SET txprod_id = prod_key WHERE prod_pos = 'A' AND COALESCE(txprod_id, 0) = 0 AND prod_desc = $1`;
      out.statements.push(render(sql, [request.productName]));
      await loader.client.query(sql, [request.productName]);
    }
    if (session.licence === 21 && has(session.companySchema, "RISHABH_PLASTIC")) await copyRishabhProduct(loader, out, request.productName);
    const filter = productGroupRule(session.companySchema, session.licence);
    if (filter) await copyGroupProduct(loader, out, filter, request.productName);
  }
  return out.statements;
}

/** After an edited (not deleted) record of Btn_Master_EditSave_Click is written. */
export async function replicateEdit(loader: Loader, request: ReplicateRequest): Promise<string[]> {
  const { session } = loader;
  const out: Replication = { statements: [] };
  if (request.programId === 14 && request.partyName !== "") {
    const kind = accountCopyRule(session.companySchema, session.licence, request.group.firstCombo.text);
    if (kind) await copyEditedAccount(loader, out, kind, request.partyName);
  }
  return out.statements;
}

// ---------------------------------------------------------------------------------------
// Ezeone cloud (licence 7, SURFACE_SDIPL_)

/** Whether a saved master is one the desktop sends to Ezeone, and so the screen should offer it. */
export async function cloudPushFor(loader: Loader, request: ReplicateRequest): Promise<CloudPush | null> {
  const { session } = loader;
  if (session.licence !== 7 || !has(session.companySchema, "SURFACE_SDIPL")) return null;
  if (request.programId === 14 && request.group.firstCombo.text === "DEBTORS LEDGER" && request.partyName !== "") return { kind: "debtor", name: request.partyName };
  if (request.programId === 8 && request.productName !== "" && !has(session.companySchema, "SHAH_TRADING") && !has(session.companySchema, "SHAH_TECH_INV")) {
    const arts = has(session.companySchema, "SURFACE_ARTS");
    const product = await first(loader, `SELECT prod_group FROM ${session.companySchema}.product_master WHERE prod_pos = 'A' AND prod_desc = $1 LIMIT 1`, [request.productName]);
    const group = toInt(field(product, "prod_group"));
    if (group === 15 || (group === 82 && !arts)) return { kind: "product", name: request.productName };
  }
  return null;
}

const EZEONE = "https://surfacedecor.ezeone.tech/api/integration";

/** The JSON the desktop writes to EWAYJSON and posts, built from the saved rows. */
export async function cloudPayload(loader: Loader, push: CloudPush): Promise<Record<string, string> | null> {
  const { session } = loader;
  const s = session.companySchema;
  const text = (row: Row | undefined, name: string) => toText(field(row, name)).trim();
  if (push.kind === "debtor") {
    const account = await first(loader, `SELECT * FROM ${s}.account WHERE a_pos = 'A' AND book = 2 AND name = $1 LIMIT 1`, [push.name]);
    if (!account) return null;
    const code = toInt(field(account, "code"));
    const address = await first(loader, `SELECT * FROM ${s}.address WHERE address_id = 1 AND code = $1 LIMIT 1`, [code]);
    const addon = await first(loader, `SELECT * FROM ${s}.addon_data WHERE code = $1 LIMIT 1`, [code]);
    return {
      companyName: text(account, "name"), companyCode: text(account, "a_short"),
      addressline1: text(address, "address_1"), addressline2: text(address, "address_2"), addressline3: text(address, "address_3"),
      city: text(address, "city"), pincode: text(address, "pin_code"), mobileNo: text(address, "mobile_no"), whatsapp_no: text(address, "whatsapp_no"),
      email: text(address, "e_mail"), pancard: text(address, "pan_no"), credit_period: text(account, "credit_days"), gst: text(address, "gst_no"),
      owner_name: text(address, "owners_name"), owner_mobile: text(address, "owner_mobile"), account_name: text(address, "acc_name"), account_mobile: text(address, "accname_mob"),
      area: text(addon, "txt_area"), group: text(addon, "txt_group"), sales_man: text(addon, "txt_salesman"), collection_days: text(addon, "txt_collection"),
      state: text(addon, "txt_state"), district: text(address, "city"), commision_group: text(addon, "txt_commgrp"), price_group: text(addon, "txt_pricegrp"),
      monthly_scheme_required: text(addon, "txt_month_sch"), yearly_scheme_required: text(addon, "txt_year_sch"), sales_ho: text(addon, "txt_sales_ho"),
      area_group: text(addon, "txt_areagrp"), warehouse_contact: text(addon, "txt_areagrp"),
    };
  }
  // Addon columns are read through jsonb so a company without one sends it empty.
  const addon = (name: string) => `COALESCE(to_jsonb(adata)->>'${name}', '')`;
  const product = await first(loader, `SELECT prodmas.desc_1, prodmas.desc_2, prodmas.desc_3, prodmas.desc_4, prodmas.level_6, prodmas.prod_short, prodmas.hsn_code, prodmas.tax_perc,
      ${addon("txt_prodstat")} AS prod_state, ${addon("txt_prodbran")} AS prod_brand, ${has(s, "SURFACE_ARTS") ? "'None'" : addon("txt_prodfinish")} AS prod_finish,
      ${addon("txt_prodthick")} AS prod_thick, ${addon("txt_prodgroup")} AS prod_group, ${addon("txt_prodbrfn")} AS prod_brfn, ${addon("txt_billdesc")} AS prod_prndesc, ${addon("txt_mainbran")} AS main_brand
    FROM ${s}.product_master prodmas LEFT JOIN ${s}.addon_data adata ON adata.prod_id = prodmas.prod_key WHERE prod_pos = 'A' AND prod_desc = $1 LIMIT 1`, [push.name]);
  if (!product) return null;
  return {
    operation_type: "I", design_code: text(product, "desc_1"), panel_code: text(product, "desc_2"), brand_finish_code: text(product, "desc_3"),
    thickness_desc: text(product, "desc_4"), status_code: text(product, "prod_state"), company_code: text(product, "level_6"), product_short: text(product, "prod_short"),
    hsn_code: text(product, "hsn_code"), tax: text(product, "tax_perc"), brand: text(product, "prod_brand"), main_brand: text(product, "main_brand"),
    product_finish: text(product, "prod_finish"), product_thickness: text(product, "prod_thick"), product_group: text(product, "prod_group"),
    brfn: text(product, "prod_brfn"), print_description: text(product, "prod_prndesc"),
  };
}

/**
 * Posts a debtor or product to Ezeone. The desktop embeds the API key in its source; here
 * it comes from the EZEONE_API_KEY secret, read when the request runs.
 */
export async function pushToCloud(loader: Loader, push: CloudPush, apiKey: string | undefined): Promise<string> {
  const { session } = loader;
  if (session.licence !== 7 || !has(session.companySchema, "SURFACE_SDIPL")) return "This company does not send masters to Ezeone.";
  if (!apiKey) return "Ezeone is not configured on this server (EZEONE_API_KEY is not set); the master was saved but not sent to the cloud.";
  const data = await cloudPayload(loader, push);
  if (!data) return "The saved master was not found, so nothing was sent to the cloud.";
  const url = `${EZEONE}/${push.kind === "debtor" ? "create-surface-decor-direct-dealer" : "create-surface-decor-product"}`;
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "*/*" }, body: JSON.stringify({ api_auth_key: apiKey, data }), redirect: "manual" });
  return await response.text();
}
