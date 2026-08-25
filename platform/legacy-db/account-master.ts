import type { PoolClient } from "pg";
import { legacyPool } from "./pool.ts";
import { legacyCompanySchema } from "./company-schema.ts";
import { masterWriteKey } from "./master-write.ts";

const SETUP_SCHEMA = "smart_setup";
const COMPANY_SCHEMA = legacyCompanySchema();
const ACCOUNT_MASTER_PROGRAM_KEY = 14;

type JsonRow = Record<string, unknown>;

export type LegacyMasterField = Readonly<{
  id: string;
  label: string;
  source: "standard" | "addon";
  type: "text" | "number" | "date" | "boolean" | "lookup";
  required: boolean;
  gridVisible: boolean;
  editable: boolean;
  order: number;
  options?: ReadonlyArray<Readonly<{ value: string; label: string }>>;
  writeKey?: string;
}>;

export type LegacyAccountMasterPayload = Readonly<{
  source: "legacy-postgresql";
  readOnly: true;
  screen: Readonly<{ programKey: 14; programName: string; heading: string }>;
  selection: Readonly<{ bookKey: number; yearId: string }>;
  books: ReadonlyArray<Readonly<{ key: number; label: string; accounts: number }>>;
  years: readonly string[];
  fields: readonly LegacyMasterField[];
  writesEnabled: boolean;
  rows: ReadonlyArray<Readonly<{ id: string; code: number; version: string; values: Readonly<Record<string, string | number | boolean | null>> }>>;
}>;

type BodyDefinition = {
  program_body_key: number;
  database_name: string;
  field_name: string;
  head_grid: string | null;
  head_label: string | null;
  field_type: string | null;
  field_update_order: number | null;
  update_active: boolean | null;
  update_grid_visible: boolean | null;
  update_grid_editable: boolean | null;
  value_compulsory: boolean | null;
  combo_value: string | null;
};

type AddonDefinition = {
  fiel_key: number;
  fiel_type: string;
  fiel_desc: string | null;
  fiel_short: string | null;
  fiel_save: string;
  fiel_entry: string | null;
  fiel_mbal: string | null;
  fiel_serial: string | number | null;
};

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function typeFor(fieldType: string | null, comboValue: string | null): LegacyMasterField["type"] {
  if (comboValue && !["N", ""].includes(comboValue.trim().toUpperCase())) return "lookup";
  if (fieldType?.trim().toUpperCase() === "N") return "number";
  if (fieldType?.trim().toUpperCase() === "D") return "date";
  return "text";
}

function standardFieldId(definition: BodyDefinition) {
  return `standard:${definition.program_body_key}`;
}

function directValue(definition: BodyDefinition, row: JsonRow): unknown {
  const table = definition.database_name.trim().toLowerCase();
  let column = definition.field_name.trim().toLowerCase();
  if (column === "acc.code") column = "code";

  const lookupAliases: Record<string, string> = {
    "account.bs_id": "balance_sheet_text",
    "address.designation": "designation_text",
    "address.p_reg": "register_text",
    "address.state_id": "state_text",
    "account.nature_pay": "nature_payment_text",
    "account.type_deduct": "deduction_type_text",
    "account.tax_code": "tax_text",
    "book_properties.book_or_ledger_head": "book_text",
  };
  const lookup = lookupAliases[`${table}.${column}`];
  if (lookup) return row[lookup];
  if (column === "sr_no") return row.row_number;

  const source = row[table];
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  return (source as JsonRow)[column] ?? null;
}

function addonValue(definition: AddonDefinition, row: JsonRow): unknown {
  const source = row.addon_data;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const prefix = definition.fiel_type.trim().toUpperCase() === "I" ? "input_" : definition.fiel_type.trim().toUpperCase() === "F" ? "flag_" : "txt_";
  const value = (source as JsonRow)[`${prefix}${definition.fiel_save.trim().toLowerCase()}`];
  if (definition.fiel_type.trim().toUpperCase() === "F") {
    if (value === "Y") return "Yes";
    if (value === "N") return "No";
  }
  return value ?? null;
}

async function resolveSelection(client: PoolClient, requestedBook: number | null, requestedYear: string | null) {
  const years = await client.query<{ year_id: string }>(`
    SELECT DISTINCT year_id
    FROM ${COMPANY_SCHEMA}.ac_balance
    WHERE a_recflag = 'AC' AND year_id IS NOT NULL
    ORDER BY year_id DESC
  `);
  const yearIds = years.rows.map((row) => row.year_id);
  if (!yearIds.length) throw new Error("No Account Master accounting year is available");
  const yearId = requestedYear && yearIds.includes(requestedYear) ? requestedYear : yearIds[0];

  const books = await client.query<{ key: number; label: string; accounts: string }>(`
    SELECT b.book_key AS key,
           COALESCE(NULLIF(BTRIM(b.book_desc), ''), 'BOOK ' || b.book_key::text) AS label,
           COUNT(a.code)::text AS accounts
    FROM ${COMPANY_SCHEMA}.book_properties b
    JOIN ${COMPANY_SCHEMA}.account a ON a.book = b.book_key AND a.a_pos = 'A'
    JOIN ${COMPANY_SCHEMA}.ac_balance ab ON ab.code = a.code AND ab.a_recflag = 'AC' AND ab.year_id = $1
    GROUP BY b.book_key, b.book_desc
    ORDER BY b.book_key
  `, [yearId]);
  if (!books.rows.length) throw new Error("No Account Master books are available");
  const bookKey = requestedBook && books.rows.some((book) => book.key === requestedBook)
    ? requestedBook
    : (books.rows.find((book) => book.key === 2)?.key ?? books.rows[0].key);
  return {
    yearId,
    yearIds,
    bookKey,
    books: books.rows.map((book) => ({ key: book.key, label: book.label, accounts: Number(book.accounts) })),
  };
}

async function loadAddonDefinitions(client: PoolClient, bookKey: number) {
  const result = await client.query<AddonDefinition>(`
    SELECT fiel_key, fiel_type, fiel_desc, fiel_short, fiel_save, fiel_entry, fiel_mbal, fiel_serial
    FROM ${COMPANY_SCHEMA}.addon_fld
    WHERE fiel_relate = 'A'
      AND fiel_pos <> 'D'
      AND fiel_masterpos = 'Y'
      AND COALESCE(fiel_inmaster, '') LIKE $1
      AND COALESCE(fiel_outmaster, '') NOT LIKE $1
      AND fiel_save ~ '^[A-Za-z0-9_]+$'
    ORDER BY fiel_serial, fiel_key
  `, [`% ${bookKey},%`]);
  return result.rows;
}

async function loadAddonOptions(client: PoolClient, definitions: readonly AddonDefinition[]) {
  const lookupIds = definitions.filter((field) => field.fiel_type.trim().toUpperCase() === "M").map((field) => field.fiel_key);
  if (!lookupIds.length) return new Map<number, Array<{ value: string; label: string }>>();
  const result = await client.query<{ para_id: number; sub_code: number; sub_name: string }>(`
    SELECT para_id, sub_code, sub_name
    FROM ${COMPANY_SCHEMA}.addon_sub
    WHERE para_id = ANY($1::int[]) AND COALESCE(sub_pos, 'A') <> 'D'
    ORDER BY para_id, sub_name
  `, [lookupIds]);
  const options = new Map<number, Array<{ value: string; label: string }>>();
  for (const row of result.rows) {
    const list = options.get(row.para_id) ?? [];
    list.push({ value: String(row.sub_code), label: row.sub_name });
    options.set(row.para_id, list);
  }
  return options;
}

export async function readLegacyAccountMaster(requestedBook: number | null, requestedYear: string | null): Promise<LegacyAccountMasterPayload> {
  const client = await legacyPool().connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15000ms'");

    const program = await client.query<{ program_name: string; screen_heading: string }>(`
      SELECT program_name, screen_heading
      FROM ${SETUP_SCHEMA}.program_top
      WHERE program_top_key = $1 AND program_name = 'MASTER_ACCOUNT'
    `, [ACCOUNT_MASTER_PROGRAM_KEY]);
    if (program.rowCount !== 1) throw new Error("Account Master program metadata is missing");

    const selection = await resolveSelection(client, requestedBook, requestedYear);
    const [body, addonDefinitions] = await Promise.all([
      client.query<BodyDefinition>(`
        SELECT program_body_key, database_name, field_name, head_grid, head_label, field_type,
               field_update_order, update_active, update_grid_visible, update_grid_editable,
               value_compulsory, combo_value
        FROM ${SETUP_SCHEMA}.program_body
        WHERE program_top_id = $1 AND update_active = true
        ORDER BY field_update_order, program_body_key
      `, [ACCOUNT_MASTER_PROGRAM_KEY]),
      loadAddonDefinitions(client, selection.bookKey),
    ]);
    const addonOptions = await loadAddonOptions(client, addonDefinitions);

    const records = await client.query<JsonRow>(`
      SELECT ROW_NUMBER() OVER (ORDER BY acc.name, acc.code) AS row_number,
             acc.code,
             acc.xmin::text AS version,
             to_jsonb(acc) AS account,
             to_jsonb(adr) AS address,
             to_jsonb(acb) AS ac_balance,
             to_jsonb(b) AS book_properties,
             to_jsonb(bs) AS balsheet,
             to_jsonb(intmst) AS int_master,
             to_jsonb(adata) AS addon_data,
             b.book_desc AS book_text,
             bs.bs_desc AS balance_sheet_text,
             opt_dg.opt_desc AS designation_text,
             opt_rg.opt_desc AS register_text,
             opt_sta.opt_desc AS state_text,
             opt_np.nature_of_payment AS nature_payment_text,
             opt_td.opt_desc AS deduction_type_text,
             tm.tax_desc AS tax_text
      FROM ${COMPANY_SCHEMA}.account acc
      LEFT JOIN ${COMPANY_SCHEMA}.address adr ON acc.code = adr.code AND adr.address_id = 1
      LEFT JOIN ${COMPANY_SCHEMA}.ac_balance acb ON acc.code = acb.code
      LEFT JOIN ${COMPANY_SCHEMA}.book_properties b ON acc.book = b.book_key
      LEFT JOIN ${COMPANY_SCHEMA}.idopt_master opt_dg ON opt_dg.idopt_key = adr.designation AND opt_dg.idopt_flag = 'DG'
      LEFT JOIN ${COMPANY_SCHEMA}.idopt_master opt_rg ON opt_rg.idopt_key = adr.p_reg AND opt_rg.idopt_flag = 'PR'
      LEFT JOIN ${COMPANY_SCHEMA}.idopt_master opt_sta ON opt_sta.idopt_key = adr.state_id AND opt_sta.idopt_flag = 'ST'
      LEFT JOIN ${SETUP_SCHEMA}.tds_chart opt_np ON opt_np.tds_key = acc.nature_pay
      LEFT JOIN ${COMPANY_SCHEMA}.idopt_master opt_td ON opt_td.idopt_key = acc.type_deduct AND opt_td.idopt_flag = 'TD'
      LEFT JOIN ${COMPANY_SCHEMA}.balsheet bs ON acc.bs_id = bs.bs_key
      LEFT JOIN ${COMPANY_SCHEMA}.int_master intmst ON intmst.code = acc.code AND intmst.year_id = $1
      LEFT JOIN ${COMPANY_SCHEMA}.tax_master tm ON acc.tax_code = tm.tax_rec
      LEFT JOIN ${COMPANY_SCHEMA}.addon_data adata ON acc.code = adata.code
      WHERE acc.a_pos = 'A' AND acb.a_recflag = 'AC' AND acb.year_id = $1 AND acc.book = $2
      ORDER BY acc.name, acc.code
    `, [selection.yearId, selection.bookKey]);

    const standardDefinitions = body.rows.filter((field) => field.database_name !== "ADDON_DATA");
    const fields: LegacyMasterField[] = standardDefinitions.map((field) => ({
      id: standardFieldId(field),
      label: text(field.head_grid) || text(field.head_label) || field.field_name.trim(),
      source: "standard",
      type: typeFor(field.field_type, field.combo_value),
      required: Boolean(field.value_compulsory),
      gridVisible: Boolean(field.update_grid_visible),
      editable: Boolean(field.update_grid_editable),
      order: field.field_update_order ?? 0,
      ...(masterWriteKey("account", field.database_name, field.field_name) ? { writeKey: masterWriteKey("account", field.database_name, field.field_name) } : {}),
    }));
    fields.push(...addonDefinitions.map((field, index): LegacyMasterField => ({
      id: `addon:${field.fiel_key}`,
      label: text(field.fiel_desc) || text(field.fiel_short) || field.fiel_save,
      source: "addon",
      type: field.fiel_type.trim().toUpperCase() === "M" ? "lookup" : field.fiel_mbal?.trim().toUpperCase() === "N" ? "number" : "text",
      required: field.fiel_entry?.trim().toUpperCase() === "C",
      gridVisible: true,
      editable: true,
      order: 1000 + index,
      ...(addonOptions.get(field.fiel_key)?.length ? { options: addonOptions.get(field.fiel_key) } : {}),
    })));

    const rows = records.rows.map((record, index) => {
      const values: Record<string, string | number | boolean | null> = {};
      for (const definition of standardDefinitions) values[standardFieldId(definition)] = text(directValue(definition, record));
      for (const definition of addonDefinitions) values[`addon:${definition.fiel_key}`] = text(addonValue(definition, record));
      return { id: `${record.code}:${index}`, code: Number(record.code), version: String(record.version), values };
    });

    await client.query("COMMIT");
    return {
      source: "legacy-postgresql",
      readOnly: true,
      writesEnabled: process.env.SMARTWINFA_MASTER_WRITES === "true",
      screen: { programKey: 14, programName: program.rows[0].program_name, heading: program.rows[0].screen_heading },
      selection: { bookKey: selection.bookKey, yearId: selection.yearId },
      books: selection.books,
      years: selection.yearIds,
      fields,
      rows,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
