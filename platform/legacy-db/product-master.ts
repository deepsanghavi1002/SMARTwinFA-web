import type { PoolClient } from "pg";
import type { LegacyMasterField } from "./account-master.ts";
import { legacyPool } from "./pool.ts";
import { legacyCompanySchema } from "./company-schema.ts";
import { masterWriteKey } from "./master-write.ts";

const SETUP_SCHEMA = "smart_setup";
const COMPANY_SCHEMA = legacyCompanySchema();
const PRODUCT_MASTER_PROGRAM_KEY = 8;

type JsonRow = Record<string, unknown>;
type BodyDefinition = {
  program_body_key: number;
  database_name: string;
  field_name: string;
  head_grid: string | null;
  head_label: string | null;
  field_type: string | null;
  field_update_order: number | null;
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

export type LegacyProductMasterPayload = Readonly<{
  source: "legacy-postgresql";
  readOnly: true;
  screen: Readonly<{ programKey: 8; programName: string; heading: string }>;
  selection: Readonly<{ groupKey: number; yearId: string; query: string }>;
  groups: ReadonlyArray<Readonly<{ key: number; label: string; products: number }>>;
  years: readonly string[];
  fields: readonly LegacyMasterField[];
  writesEnabled: boolean;
  rows: ReadonlyArray<Readonly<{ id: string; code: number; version: string; values: Readonly<Record<string, string | null>> }>>;
  pagination: Readonly<{ page: number; pageSize: number; total: number; totalPages: number }>;
}>;

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
  const column = definition.field_name.trim().toLowerCase();
  if (column === "sr_no") return row.row_number;

  const lookupAliases: Record<string, string> = {
    "idopt_master.book_or_ledger_head": "group_text",
    "product_master.recduom_id": "received_uom_text",
    "product_master.recdrateuom_id": "received_rate_uom_text",
    "product_master.issuuom_id": "issued_uom_text",
    "product_master.issurateuom_id": "issued_rate_uom_text",
    "product_master.minuom_id": "minimum_uom_text",
    "product_master.maxuom_id": "maximum_uom_text",
    "product_master.rep1_uom": "report_uom_1_text",
    "product_master.rep2_uom": "report_uom_2_text",
    "product_master.vat_code": "tax_text",
    "product_master.rgprod_id": "rg_product_text",
    "product_master.txprod_id": "tx_product_text",
    "product_master.s_code": "account_text",
    "prod_balance.open_uom": "opening_uom_text",
    "prod_balance.rep_uom": "balance_report_uom_text",
    "pricelist.pl_puom": "purchase_price_uom_text",
    "pricelist.pl_suom": "sale_price_uom_text",
    "pricelist.pl_muom": "mrp_uom_text",
  };
  const alias = lookupAliases[`${table}.${column}`];
  if (alias) return row[alias];

  const source = row[table];
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  return (source as JsonRow)[column] ?? null;
}

function addonValue(definition: AddonDefinition, row: JsonRow): unknown {
  const source = row.addon_data;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const kind = definition.fiel_type.trim().toUpperCase();
  const prefix = kind === "I" ? "input_" : kind === "F" ? "flag_" : "txt_";
  const value = (source as JsonRow)[`${prefix}${definition.fiel_save.trim().toLowerCase()}`];
  if (kind === "F") return value === "Y" ? "Yes" : value === "N" ? "No" : value;
  return value ?? null;
}

async function resolveSelection(client: PoolClient, requestedGroup: number | null, requestedYear: string | null) {
  const years = await client.query<{ year_id: string }>(`
    SELECT DISTINCT year_id
    FROM ${COMPANY_SCHEMA}.prod_balance
    WHERE prec_flag = 'RP' AND year_id IS NOT NULL
    ORDER BY year_id DESC
  `);
  const yearIds = years.rows.map((row) => row.year_id);
  if (!yearIds.length) throw new Error("No Product Master accounting year is available");
  const yearId = requestedYear && yearIds.includes(requestedYear) ? requestedYear : yearIds[0];

  const groups = await client.query<{ key: number; label: string; products: string }>(`
    SELECT pm.prod_group AS key,
           COALESCE(NULLIF(BTRIM(opt.opt_desc), ''), 'GROUP ' || pm.prod_group::text) AS label,
           COUNT(*)::text AS products
    FROM ${COMPANY_SCHEMA}.product_master pm
    LEFT JOIN ${COMPANY_SCHEMA}.idopt_master opt
      ON opt.idopt_key = pm.prod_group AND opt.idopt_flag = 'PG' AND opt.idopt_pos <> 'D'
    WHERE pm.prod_pos <> 'D'
    GROUP BY pm.prod_group, opt.opt_desc
    ORDER BY label, pm.prod_group
  `);
  if (!groups.rows.length) throw new Error("No Product Master groups are available");
  const groupKey = requestedGroup && groups.rows.some((group) => group.key === requestedGroup)
    ? requestedGroup
    : groups.rows[0].key;
  return {
    yearId,
    yearIds,
    groupKey,
    groups: groups.rows.map((group) => ({ key: group.key, label: group.label, products: Number(group.products) })),
  };
}

async function loadAddonDefinitions(client: PoolClient) {
  const result = await client.query<AddonDefinition>(`
    SELECT fiel_key, fiel_type, fiel_desc, fiel_short, fiel_save, fiel_entry, fiel_mbal, fiel_serial
    FROM ${COMPANY_SCHEMA}.addon_fld
    WHERE fiel_relate = 'P'
      AND fiel_pos <> 'D'
      AND fiel_masterpos = 'Y'
      AND (fiel_err <> 'GODOWN,' OR fiel_err IS NULL)
      AND fiel_save ~ '^[A-Za-z0-9_]+$'
    ORDER BY fiel_serial::numeric NULLS LAST, fiel_key
  `);
  return result.rows;
}

async function loadAddonOptions(client: PoolClient, definitions: readonly AddonDefinition[]) {
  const ids = definitions.filter((field) => field.fiel_type.trim().toUpperCase() === "M").map((field) => field.fiel_key);
  const options = new Map<number, Array<{ value: string; label: string }>>();
  if (!ids.length) return options;
  const result = await client.query<{ para_id: number; sub_code: number; sub_name: string }>(`
    SELECT para_id, sub_code, sub_name
    FROM ${COMPANY_SCHEMA}.addon_sub
    WHERE para_id = ANY($1::int[]) AND COALESCE(sub_pos, 'A') <> 'D'
    ORDER BY para_id, sub_name
  `, [ids]);
  for (const row of result.rows) {
    const list = options.get(row.para_id) ?? [];
    list.push({ value: String(row.sub_code), label: row.sub_name });
    options.set(row.para_id, list);
  }
  return options;
}

export async function readLegacyProductMaster(input: {
  group: number | null;
  year: string | null;
  query: string;
  page: number;
  pageSize: number;
}): Promise<LegacyProductMasterPayload> {
  const client = await legacyPool().connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '20000ms'");

    const program = await client.query<{ program_name: string; screen_heading: string }>(`
      SELECT program_name, screen_heading
      FROM ${SETUP_SCHEMA}.program_top
      WHERE program_top_key = $1 AND program_name = 'MASTER_PRODUCT'
    `, [PRODUCT_MASTER_PROGRAM_KEY]);
    if (program.rowCount !== 1) throw new Error("Product Master program metadata is missing");

    const selection = await resolveSelection(client, input.group, input.year);
    const [body, addonDefinitions] = await Promise.all([
      client.query<BodyDefinition>(`
        SELECT program_body_key, database_name, field_name, head_grid, head_label, field_type,
               field_update_order, update_grid_visible, update_grid_editable, value_compulsory, combo_value
        FROM ${SETUP_SCHEMA}.program_body
        WHERE program_top_id = $1 AND update_active = true
        ORDER BY field_update_order, program_body_key
      `, [PRODUCT_MASTER_PROGRAM_KEY]),
      loadAddonDefinitions(client),
    ]);
    const addonOptions = await loadAddonOptions(client, addonDefinitions);
    const search = input.query.trim();
    const count = await client.query<{ total: string }>(`
      SELECT COUNT(*)::text AS total
      FROM ${COMPANY_SCHEMA}.product_master pm
      WHERE pm.prod_pos <> 'D' AND pm.prod_group = $1
        AND ($2 = '' OR pm.prod_short ILIKE '%' || $2 || '%' OR pm.prod_desc ILIKE '%' || $2 || '%'
          OR pm.bill_desc ILIKE '%' || $2 || '%' OR pm.bar_code ILIKE '%' || $2 || '%')
    `, [selection.groupKey, search]);
    const total = Number(count.rows[0].total);
    const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
    const page = Math.min(input.page, totalPages);
    const offset = (page - 1) * input.pageSize;

    const records = await client.query<JsonRow>(`
      SELECT ROW_NUMBER() OVER (ORDER BY pm.prod_short, pm.prod_key) + $5::int AS row_number,
             pm.prod_key,
             pm.xmin::text AS version,
             to_jsonb(pm) AS product_master,
             to_jsonb(pbal) AS prod_balance,
             to_jsonb(pl) AS pricelist,
             to_jsonb(adata) AS addon_data,
             opt.opt_desc AS group_text,
             recduom.uom_short AS received_uom_text,
             recdrateuom.uom_short AS received_rate_uom_text,
             issuuom.uom_short AS issued_uom_text,
             issurateuom.uom_short AS issued_rate_uom_text,
             minuom.uom_short AS minimum_uom_text,
             maxuom.uom_short AS maximum_uom_text,
             rep1.uom_short AS report_uom_1_text,
             rep2.uom_short AS report_uom_2_text,
             openuom.uom_short AS opening_uom_text,
             balrepuom.uom_short AS balance_report_uom_text,
             plpuom.uom_short AS purchase_price_uom_text,
             plsuom.uom_short AS sale_price_uom_text,
             plmuom.uom_short AS mrp_uom_text,
             tm.tax_desc AS tax_text,
             rg.prod_short AS rg_product_text,
             tx.prod_short AS tx_product_text,
             acc.name AS account_text
      FROM ${COMPANY_SCHEMA}.product_master pm
      LEFT JOIN ${COMPANY_SCHEMA}.idopt_master opt ON opt.idopt_key = pm.prod_group AND opt.idopt_flag = 'PG'
      LEFT JOIN LATERAL (
        SELECT pb.* FROM ${COMPANY_SCHEMA}.prod_balance pb
        WHERE pb.prod_id = pm.prod_key AND pb.year_id = $1 AND pb.prec_flag = 'RP'
        ORDER BY pb.prodbal_key DESC LIMIT 1
      ) pbal ON true
      LEFT JOIN LATERAL (
        SELECT price.* FROM ${COMPANY_SCHEMA}.pricelist price
        WHERE price.prod_id = pm.prod_key AND price.pl_pos = 'A'
        ORDER BY price.pl_wefrom DESC NULLS LAST, price.pl_key DESC LIMIT 1
      ) pl ON true
      LEFT JOIN LATERAL (
        SELECT ad.* FROM ${COMPANY_SCHEMA}.addon_data ad
        WHERE ad.prod_id = pm.prod_key ORDER BY ad.aon_key LIMIT 1
      ) adata ON true
      LEFT JOIN ${COMPANY_SCHEMA}.prod_uom recduom ON recduom.uom_key = pm.recduom_id
      LEFT JOIN ${COMPANY_SCHEMA}.prod_uom recdrateuom ON recdrateuom.uom_key = pm.recdrateuom_id
      LEFT JOIN ${COMPANY_SCHEMA}.prod_uom issuuom ON issuuom.uom_key = pm.issuuom_id
      LEFT JOIN ${COMPANY_SCHEMA}.prod_uom issurateuom ON issurateuom.uom_key = pm.issurateuom_id
      LEFT JOIN ${COMPANY_SCHEMA}.prod_uom minuom ON minuom.uom_key = pm.minuom_id
      LEFT JOIN ${COMPANY_SCHEMA}.prod_uom maxuom ON maxuom.uom_key = pm.maxuom_id
      LEFT JOIN ${COMPANY_SCHEMA}.prod_uom rep1 ON rep1.uom_key = pm.rep1_uom
      LEFT JOIN ${COMPANY_SCHEMA}.prod_uom rep2 ON rep2.uom_key = pm.rep2_uom
      LEFT JOIN ${COMPANY_SCHEMA}.prod_uom openuom ON openuom.uom_key = pbal.open_uom
      LEFT JOIN ${COMPANY_SCHEMA}.prod_uom balrepuom ON balrepuom.uom_key = pbal.rep_uom
      LEFT JOIN ${COMPANY_SCHEMA}.prod_uom plpuom ON plpuom.uom_key = pl.pl_puom
      LEFT JOIN ${COMPANY_SCHEMA}.prod_uom plsuom ON plsuom.uom_key = pl.pl_suom
      LEFT JOIN ${COMPANY_SCHEMA}.prod_uom plmuom ON plmuom.uom_key = pl.pl_muom
      LEFT JOIN ${COMPANY_SCHEMA}.tax_master tm ON tm.tax_rec = pm.vat_code
      LEFT JOIN ${COMPANY_SCHEMA}.product_master rg ON rg.prod_key = pm.rgprod_id
      LEFT JOIN ${COMPANY_SCHEMA}.product_master tx ON tx.prod_key = pm.txprod_id
      LEFT JOIN ${COMPANY_SCHEMA}.account acc ON acc.code = pm.s_code
      WHERE pm.prod_pos <> 'D' AND pm.prod_group = $2
        AND ($3 = '' OR pm.prod_short ILIKE '%' || $3 || '%' OR pm.prod_desc ILIKE '%' || $3 || '%'
          OR pm.bill_desc ILIKE '%' || $3 || '%' OR pm.bar_code ILIKE '%' || $3 || '%')
      ORDER BY pm.prod_short, pm.prod_key
      LIMIT $4 OFFSET $5
    `, [selection.yearId, selection.groupKey, search, input.pageSize, offset]);

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
      ...(masterWriteKey("product", field.database_name, field.field_name) ? { writeKey: masterWriteKey("product", field.database_name, field.field_name) } : {}),
    }));
    fields.push(...addonDefinitions.map((field, index): LegacyMasterField => ({
      id: `addon:${field.fiel_key}`,
      label: text(field.fiel_desc) || text(field.fiel_short) || field.fiel_save,
      source: "addon",
      type: field.fiel_type.trim().toUpperCase() === "M" ? "lookup" : field.fiel_mbal?.trim().toUpperCase() === "N" ? "number" : field.fiel_mbal?.trim().toUpperCase() === "D" ? "date" : "text",
      required: field.fiel_entry?.trim().toUpperCase() === "C",
      gridVisible: true,
      editable: true,
      order: 1000 + index,
      ...(addonOptions.get(field.fiel_key)?.length ? { options: addonOptions.get(field.fiel_key) } : {}),
    })));

    const rows = records.rows.map((record) => {
      const values: Record<string, string | null> = {};
      for (const definition of standardDefinitions) values[standardFieldId(definition)] = text(directValue(definition, record));
      for (const definition of addonDefinitions) values[`addon:${definition.fiel_key}`] = text(addonValue(definition, record));
      return { id: String(record.prod_key), code: Number(record.prod_key), version: String(record.version), values };
    });

    await client.query("COMMIT");
    return {
      source: "legacy-postgresql",
      readOnly: true,
      writesEnabled: process.env.SMARTWINFA_MASTER_WRITES === "true",
      screen: { programKey: 8, programName: program.rows[0].program_name, heading: program.rows[0].screen_heading },
      selection: { groupKey: selection.groupKey, yearId: selection.yearId, query: search },
      groups: selection.groups,
      years: selection.yearIds,
      fields,
      rows,
      pagination: { page, pageSize: input.pageSize, total, totalPages },
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
