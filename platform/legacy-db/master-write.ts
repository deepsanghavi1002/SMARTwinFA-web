import { legacyPool } from "./pool.ts";
import { legacyCompanySchema } from "./company-schema.ts";
import type { PoolClient } from "pg";

const SCHEMA = legacyCompanySchema();
export type MasterKind = "account" | "product";
export type MasterCommand = Readonly<{ operation: "create" | "update" | "delete"; code?: number; version?: string; selectionKey: number; yearId: string; values?: Record<string, string> }>;

const writableColumns = {
  account: {
    account: new Set(["name", "a_short", "a_startdate", "a_lastdate", "a_dayclose", "a_posting", "a_mapcode", "credit_days", "int_perc", "grace_days", "limit", "warn_limit", "os_flag", "free_flag", "a_perc", "info", "budget_flag", "budget", "budget_perc", "ac_message", "narr_long", "transaction_code", "image_file_name"]),
    address: new Set(["address_1", "address_2", "address_3", "city", "pin_code", "tel_no", "std_code", "local_code", "mobile_no", "whatsapp_no", "whatsapp_name", "pan_no", "e_mail", "website", "contact", "aadhar_no", "gst_no", "vat_no", "cst_no", "owners_name", "owner_mobile", "owner_birthdate", "manager_name", "manager_mobile"]),
    ac_balance: new Set(["opening", "last_year"]),
  },
  product: {
    product_master: new Set(["prod_short", "prod_desc", "bill_desc", "bar_code", "hsn_code", "base_qty1", "base_qty2", "base_qty3", "base_pcs", "base_pack", "base_weight", "inventory", "prod_map", "prod_info", "start_date", "last_date", "lead_days", "rep_rate", "tax_perc", "tax_type", "prod_type", "toll_perc", "prod_message", "supply_type", "fg_costing_rate"]),
    prod_balance: new Set(["open_qty1", "open_qty2", "open_qty3", "open_pcs", "open_pack", "open_weight", "open_rate", "rep_rate"]),
    pricelist: new Set(["pl_prate", "pl_srate", "pl_mrp"]),
  },
} as const;

const sourceAliases: Record<string, string> = { acc: "account", adr: "address", acb: "ac_balance", pm: "product_master", pbal: "prod_balance", pl: "pricelist" };

export function masterWriteKey(kind: MasterKind, databaseName: string, fieldName: string) {
  const rawTable = databaseName.trim().toLowerCase(); const rawColumn = fieldName.trim().toLowerCase();
  const [prefix, namedColumn] = rawColumn.includes(".") ? rawColumn.split(".", 2) : [rawTable, rawColumn];
  const table = sourceAliases[prefix] ?? sourceAliases[rawTable] ?? rawTable;
  const column = namedColumn.replace(/[^a-z0-9_]/g, "");
  const allowed = writableColumns[kind][table as keyof typeof writableColumns[typeof kind]] as ReadonlySet<string> | undefined;
  return allowed?.has(column) ? `${table}.${column}` : undefined;
}

const fieldSets = {
  account: new Set(Object.entries(writableColumns.account).flatMap(([table, columns]) => [...columns].map((column) => `${table}.${column}`))),
  product: new Set(Object.entries(writableColumns.product).flatMap(([table, columns]) => [...columns].map((column) => `${table}.${column}`))),
};

export function validateMasterCommand(kind: MasterKind, input: unknown): MasterCommand {
  if (!input || typeof input !== "object") throw new Error("Invalid master command");
  const raw = input as Record<string, unknown>;
  if (!(["create", "update", "delete"] as unknown[]).includes(raw.operation)) throw new Error("Invalid master operation");
  const operation = raw.operation as MasterCommand["operation"];
  const selectionKey = Number(raw.selectionKey);
  if (!Number.isSafeInteger(selectionKey) || selectionKey <= 0) throw new Error("Invalid master selection");
  const yearId = typeof raw.yearId === "string" && /^\d{16}$/.test(raw.yearId) ? raw.yearId : "";
  if (!yearId) throw new Error("Invalid accounting year");
  const code = raw.code === undefined ? undefined : Number(raw.code);
  const version = typeof raw.version === "string" && /^\d+$/.test(raw.version) ? raw.version : undefined;
  if (operation !== "create" && (!Number.isSafeInteger(code) || Number(code) <= 0 || !version)) throw new Error("Reload the record before saving");
  const source = raw.values && typeof raw.values === "object" ? raw.values as Record<string, unknown> : {};
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    const canonical = kind === "account" ? ({ name: "account.name", a_short: "account.a_short" }[key] ?? key) : ({ prod_short: "product_master.prod_short", prod_desc: "product_master.prod_desc", bill_desc: "product_master.bill_desc", bar_code: "product_master.bar_code", hsn_code: "product_master.hsn_code" }[key] ?? key);
    if (!fieldSets[kind].has(canonical)) throw new Error("Field is not writable in this master contract");
    values[canonical] = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 250);
  }
  const name = kind === "account" ? values["account.name"] : values["product_master.prod_short"];
  if (operation !== "delete" && !name) throw new Error(kind === "account" ? "Account name is required" : "Product short name is required");
  return { operation, code, version, selectionKey, yearId, values };
}

function grouped(values: Record<string, string>, table: string) {
  const result: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(values)) if (key.startsWith(`${table}.`)) result.push([key.slice(table.length + 1), value]);
  return result;
}

async function updateColumns(client: PoolClient, table: string, columns: readonly [string, string][], where: string, whereValues: readonly unknown[]) {
  if (!columns.length) return;
  const assignments = columns.map(([column], index) => `${column}=$${index + 1}`).join(",");
  await client.query(`UPDATE ${SCHEMA}.${table} SET ${assignments} WHERE ${where}`, [...columns.map(([, value]) => value === "" ? null : value), ...whereValues]);
}

async function updateAddress(client: PoolClient, code: number, values: Record<string, string>) {
  const columns = grouped(values, "address"); if (!columns.length) return;
  const updated = await client.query(`UPDATE ${SCHEMA}.address SET ${columns.map(([column], index) => `${column}=$${index + 1}`).join(",")} WHERE code=$${columns.length + 1} AND address_id=1`, [...columns.map(([, value]) => value === "" ? null : value), code]);
  if (updated.rowCount) return;
  await client.query(`INSERT INTO ${SCHEMA}.address(code,address_id,address_key,a_pos,${columns.map(([column]) => column).join(",")}) SELECT $1,1,COALESCE(MAX(address_key),0)+1,'A',${columns.map((_, index) => `$${index + 2}`).join(",")} FROM ${SCHEMA}.address`, [code, ...columns.map(([, value]) => value === "" ? null : value)]);
}

async function updatePrice(client: PoolClient, code: number, values: Record<string, string>) {
  const columns = grouped(values, "pricelist"); if (!columns.length) return;
  const latest = await client.query<{ pl_key: number }>(`SELECT pl_key FROM ${SCHEMA}.pricelist WHERE prod_id=$1 AND COALESCE(pl_pos,'A')<>'D' ORDER BY pl_wefrom DESC NULLS LAST,pl_key DESC LIMIT 1`, [code]);
  if (latest.rowCount) return updateColumns(client, "pricelist", columns, `pl_key=$${columns.length + 1}`, [latest.rows[0].pl_key]);
  await client.query(`INSERT INTO ${SCHEMA}.pricelist(pl_key,prod_id,pl_pos,last_savedate,last_savetime,${columns.map(([column]) => column).join(",")}) SELECT COALESCE(MAX(pl_key),0)+1,$1,'A',CURRENT_DATE,to_char(clock_timestamp(),'HH24:MI:SS'),${columns.map((_, index) => `$${index + 2}`).join(",")} FROM ${SCHEMA}.pricelist`, [code, ...columns.map(([, value]) => value === "" ? null : value)]);
}

export async function writeLegacyMaster(kind: MasterKind, raw: unknown) {
  if (process.env.SMARTWINFA_MASTER_WRITES !== "true") throw new Error("Master writes are disabled in this environment");
  const command = validateMasterCommand(kind, raw);
  const client = await legacyPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='15000ms'");
    await client.query("SELECT pg_advisory_xact_lock($1)", [kind === "account" ? 600141141541142 : 600141141541143]);
    const values = command.values ?? {};
    let result;
    if (kind === "account") {
      const accountValues = grouped(values, "account");
      if (command.operation !== "delete") {
        const duplicate = await client.query(`SELECT 1 FROM ${SCHEMA}.account WHERE book=$1 AND lower(btrim(name))=lower($2) AND a_pos='A' AND ($3::int IS NULL OR code<>$3)`, [command.selectionKey, values["account.name"], command.code ?? null]);
        if (duplicate.rowCount) throw new Error("An active account with this name already exists in the book");
      }
      if (command.operation === "create") {
        result = await client.query<{ code: number; version: string }>(`INSERT INTO ${SCHEMA}.account(code,name,book,a_short,a_pos,int_flag,os_flag,free_flag,not2del,budget_flag,last_savedate,last_savetime) SELECT COALESCE(MAX(code),0)+1,$1,$2,$3,'A','N',$4,'N','N',$5,CURRENT_DATE,to_char(clock_timestamp(),'HH24:MI:SS') FROM ${SCHEMA}.account RETURNING code,xmin::text AS version`, [values["account.name"], command.selectionKey, values["account.a_short"] ?? "", values["account.os_flag"] || "N", values["account.budget_flag"] || "N"]);
        await client.query(`INSERT INTO ${SCHEMA}.ac_balance(acbal_key,code,year_id,a_recflag) SELECT COALESCE(MAX(acbal_key),0)+1,$1,$2,'AC' FROM ${SCHEMA}.ac_balance`, [result.rows[0].code, command.yearId]);
      } else if (command.operation === "update") {
        result = await client.query<{ code: number; version: string }>(`UPDATE ${SCHEMA}.account SET name=$3,a_short=$4,last_savedate=CURRENT_DATE,last_savetime=to_char(clock_timestamp(),'HH24:MI:SS') WHERE code=$1 AND book=$2 AND a_pos='A' AND xmin=$5::text::xid RETURNING code,xmin::text AS version`, [command.code, command.selectionKey, values["account.name"], values["account.a_short"] ?? "", command.version]);
      } else {
        result = await client.query<{ code: number; version: string }>(`UPDATE ${SCHEMA}.account SET a_pos='D',last_savedate=CURRENT_DATE,last_savetime=to_char(clock_timestamp(),'HH24:MI:SS') WHERE code=$1 AND book=$2 AND a_pos='A' AND xmin=$3::text::xid RETURNING code,xmin::text AS version`, [command.code, command.selectionKey, command.version]);
      }
      if (command.operation !== "delete" && result.rowCount) {
        await updateColumns(client, "account", accountValues, `code=$${accountValues.length + 1} AND book=$${accountValues.length + 2}`, [result.rows[0].code, command.selectionKey]);
        await updateAddress(client, result.rows[0].code, values);
        await updateColumns(client, "ac_balance", grouped(values, "ac_balance"), `code=$${grouped(values, "ac_balance").length + 1} AND year_id=$${grouped(values, "ac_balance").length + 2} AND a_recflag='AC'`, [result.rows[0].code, command.yearId]);
      }
    } else {
      const productValues = grouped(values, "product_master");
      if (command.operation !== "delete") {
        const duplicate = await client.query(`SELECT 1 FROM ${SCHEMA}.product_master WHERE prod_group=$1 AND lower(btrim(prod_short))=lower($2) AND prod_pos<>'D' AND ($3::int IS NULL OR prod_key<>$3)`, [command.selectionKey, values["product_master.prod_short"], command.code ?? null]);
        if (duplicate.rowCount) throw new Error("An active product with this short name already exists in the group");
      }
      if (command.operation === "create") {
        result = await client.query<{ code: number; version: string }>(`INSERT INTO ${SCHEMA}.product_master(prod_key,prod_short,prod_desc,bill_desc,bar_code,hsn_code,icode_type,inventory,iflag_free,iflag_dis,prod_group,prod_pos,last_savedate,last_savetime) SELECT COALESCE(MAX(prod_key),0)+1,$1,$2,$3,$4,$5,'0',$6,'N','Y',$7,'A',CURRENT_DATE,to_char(clock_timestamp(),'HH24:MI:SS') FROM ${SCHEMA}.product_master RETURNING prod_key AS code,xmin::text AS version`, [values["product_master.prod_short"], values["product_master.prod_desc"] ?? "", values["product_master.bill_desc"] ?? "", values["product_master.bar_code"] ?? "", values["product_master.hsn_code"] ?? "", values["product_master.inventory"] || "Y", command.selectionKey]);
        await client.query(`INSERT INTO ${SCHEMA}.prod_balance(prodbal_key,p_short,prod_id,year_id,prec_flag) SELECT COALESCE(MAX(prodbal_key),0)+1,$1,$2,$3,'RP' FROM ${SCHEMA}.prod_balance`, [values["product_master.prod_short"], result.rows[0].code, command.yearId]);
      } else if (command.operation === "update") {
        result = await client.query<{ code: number; version: string }>(`UPDATE ${SCHEMA}.product_master SET prod_short=$3,prod_desc=$4,bill_desc=$5,bar_code=$6,hsn_code=$7,last_savedate=CURRENT_DATE,last_savetime=to_char(clock_timestamp(),'HH24:MI:SS') WHERE prod_key=$1 AND prod_group=$2 AND prod_pos<>'D' AND xmin=$8::text::xid RETURNING prod_key AS code,xmin::text AS version`, [command.code, command.selectionKey, values["product_master.prod_short"], values["product_master.prod_desc"] ?? "", values["product_master.bill_desc"] ?? "", values["product_master.bar_code"] ?? "", values["product_master.hsn_code"] ?? "", command.version]);
      } else {
        result = await client.query<{ code: number; version: string }>(`UPDATE ${SCHEMA}.product_master SET prod_pos='D',last_savedate=CURRENT_DATE,last_savetime=to_char(clock_timestamp(),'HH24:MI:SS') WHERE prod_key=$1 AND prod_group=$2 AND prod_pos<>'D' AND xmin=$3::text::xid RETURNING prod_key AS code,xmin::text AS version`, [command.code, command.selectionKey, command.version]);
      }
      if (command.operation !== "delete" && result.rowCount) {
        await updateColumns(client, "product_master", productValues, `prod_key=$${productValues.length + 1} AND prod_group=$${productValues.length + 2}`, [result.rows[0].code, command.selectionKey]);
        const balanceValues = grouped(values, "prod_balance");
        await updateColumns(client, "prod_balance", balanceValues, `prod_id=$${balanceValues.length + 1} AND year_id=$${balanceValues.length + 2} AND prec_flag='RP'`, [result.rows[0].code, command.yearId]);
        await updatePrice(client, result.rows[0].code, values);
      }
    }
    if (!result.rowCount) throw new Error("The record changed or was deleted; reload before saving");
    await client.query("COMMIT");
    return { source: "legacy-postgresql" as const, kind, operation: command.operation, code: result.rows[0].code, version: result.rows[0].version };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
