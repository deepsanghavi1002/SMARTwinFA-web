import { legacyPool } from "./pool.ts";
import { legacyCompanySchema } from "./company-schema.ts";

const COMPANY_SCHEMA = legacyCompanySchema();

export type LegacyAddonMasterPayload = Readonly<{
  source: "legacy-postgresql";
  readOnly: true;
  writesEnabled: boolean;
  relations: ReadonlyArray<Readonly<{ key: string; label: string; fields: number }>>;
  rows: ReadonlyArray<Readonly<{
    key: number; version: string;
    relation: string;
    description: string;
    shortName: string;
    storageName: string;
    type: string;
    serial: string;
    required: boolean;
    masterVisible: boolean;
    entryPosition: string;
    lookupValues: number;
  }>>;
  options: ReadonlyArray<Readonly<{ code: number; fieldKey: number; name: string; shortName: string; version: string }>>;
  storageOptions: ReadonlyArray<string>;
}>;

export type LegacyAddonOptionCommand = Readonly<{ operation: "create" | "update" | "delete"; fieldKey: number; code?: number; name?: string; shortName?: string; version?: string }>;
export type LegacyAddonFieldCommand = Readonly<{ operation: "create" | "update" | "delete"; key?: number; version?: string; relation?: string; description?: string; shortName?: string; storageName?: string; type?: string; serial?: number; required?: boolean; masterVisible?: boolean; entryPosition?: string }>;

const tidy = (value: unknown, length: number) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, length) : "";

export function validateAddonOptionCommand(input: unknown): LegacyAddonOptionCommand {
  if (!input || typeof input !== "object") throw new Error("Invalid add-on value command");
  const value = input as Record<string, unknown>;
  if (!(["create", "update", "delete"] as unknown[]).includes(value.operation)) throw new Error("Invalid add-on value operation");
  const fieldKey = Number(value.fieldKey);
  if (!Number.isSafeInteger(fieldKey) || fieldKey <= 0) throw new Error("Invalid add-on field");
  const operation = value.operation as LegacyAddonOptionCommand["operation"];
  const code = value.code === undefined ? undefined : Number(value.code);
  if (operation !== "create" && (!Number.isSafeInteger(code) || Number(code) <= 0)) throw new Error("Invalid add-on value key");
  const version = typeof value.version === "string" && /^\d+$/.test(value.version) ? value.version : undefined;
  if (operation !== "create" && !version) throw new Error("The add-on value has changed; reload it before saving");
  const name = typeof value.name === "string" ? value.name.trim().replace(/\s+/g, " ") : "";
  const shortName = typeof value.shortName === "string" ? value.shortName.trim().replace(/\s+/g, " ") : "";
  if (operation !== "delete" && (!name || name.length > 120 || shortName.length > 40)) throw new Error("Name is required and must fit the legacy field lengths");
  return { operation, fieldKey, code, name: name || undefined, shortName: shortName || undefined, version };
}

export function validateAddonFieldCommand(input: unknown): LegacyAddonFieldCommand {
  if (!input || typeof input !== "object") throw new Error("Invalid add-on field command");
  const value = input as Record<string, unknown>;
  if (!( ["create", "update", "delete"] as unknown[]).includes(value.operation)) throw new Error("Invalid add-on field operation");
  const operation = value.operation as LegacyAddonFieldCommand["operation"];
  const key = value.key === undefined ? undefined : Number(value.key);
  const version = typeof value.version === "string" && /^\d+$/.test(value.version) ? value.version : undefined;
  if (operation !== "create" && (!Number.isSafeInteger(key) || Number(key) <= 0 || !version)) throw new Error("Reload the add-on field before saving");
  const relation = tidy(value.relation, 1).toUpperCase();
  const description = tidy(value.description, 120); const shortName = tidy(value.shortName, 40);
  const storageName = tidy(value.storageName, 63).toLowerCase(); const type = tidy(value.type, 1).toUpperCase();
  const serial = Number(value.serial);
  if (operation !== "delete") {
    if (!/^[A-Z]$/.test(relation) || !description || !shortName || !/^[a-z][a-z0-9_]{0,62}$/.test(storageName)) throw new Error("Relation, description, short name, and a valid storage field are required");
    if (!new Set(["M", "T", "N", "D"]).has(type)) throw new Error("Choose a supported add-on field type");
    if (!Number.isFinite(serial) || serial < 0 || serial > 999) throw new Error("Enter a valid field serial");
  }
  return { operation, key, version, relation: relation || undefined, description: description || undefined, shortName: shortName || undefined, storageName: storageName || undefined, type: type || undefined, serial: Number.isFinite(serial) ? serial : undefined, required: Boolean(value.required), masterVisible: Boolean(value.masterVisible), entryPosition: tidy(value.entryPosition, 20) || undefined };
}

export async function writeLegacyAddonOption(raw: unknown) {
  if (process.env.SMARTWINFA_MASTER_WRITES !== "true") throw new Error("Master writes are disabled in this environment");
  const command = validateAddonOptionCommand(raw);
  const client = await legacyPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '10000ms'");
    await client.query("SELECT pg_advisory_xact_lock(600141141541141)");
    const field = await client.query(`SELECT 1 FROM ${COMPANY_SCHEMA}.addon_fld WHERE fiel_key=$1 AND fiel_pos<>'D'`, [command.fieldKey]);
    if (!field.rowCount) throw new Error("Add-on field no longer exists");
    if (command.operation !== "delete") {
      const duplicate = await client.query(`SELECT sub_code FROM ${COMPANY_SCHEMA}.addon_sub WHERE para_id=$1 AND lower(btrim(sub_name))=lower($2) AND COALESCE(sub_pos,'A')<>'D' AND ($3::int IS NULL OR sub_code<>$3) LIMIT 1`, [command.fieldKey, command.name, command.code ?? null]);
      if (duplicate.rowCount) throw new Error("An active value with this name already exists for the field");
    }
    let result;
    if (command.operation === "create") {
      result = await client.query<{ sub_code: number; version: string }>(`INSERT INTO ${COMPANY_SCHEMA}.addon_sub (sub_code,para_id,sub_name,short_name,sub_relate,sub_pos,last_savedate,last_savetime) SELECT COALESCE(MAX(sub_code),0)+1,$1,$2,$3,f.fiel_relate,'A',CURRENT_DATE,to_char(clock_timestamp(),'HH24:MI:SS') FROM ${COMPANY_SCHEMA}.addon_sub CROSS JOIN ${COMPANY_SCHEMA}.addon_fld f WHERE f.fiel_key=$1 GROUP BY f.fiel_relate RETURNING sub_code,xmin::text AS version`, [command.fieldKey, command.name, command.shortName ?? ""]);
    } else if (command.operation === "update") {
      result = await client.query<{ sub_code: number; version: string }>(`UPDATE ${COMPANY_SCHEMA}.addon_sub SET sub_name=$3,short_name=$4,last_savedate=CURRENT_DATE,last_savetime=to_char(clock_timestamp(),'HH24:MI:SS') WHERE sub_code=$1 AND para_id=$2 AND COALESCE(sub_pos,'A')<>'D' AND xmin=$5::text::xid RETURNING sub_code,xmin::text AS version`, [command.code, command.fieldKey, command.name, command.shortName ?? "", command.version]);
    } else {
      result = await client.query<{ sub_code: number; version: string }>(`UPDATE ${COMPANY_SCHEMA}.addon_sub SET sub_pos='D',last_savedate=CURRENT_DATE,last_savetime=to_char(clock_timestamp(),'HH24:MI:SS') WHERE sub_code=$1 AND para_id=$2 AND COALESCE(sub_pos,'A')<>'D' AND xmin=$3::text::xid RETURNING sub_code,xmin::text AS version`, [command.code, command.fieldKey, command.version]);
    }
    if (!result.rowCount) throw new Error("The add-on value changed or was deleted; reload before saving");
    await client.query("COMMIT");
    return { source: "legacy-postgresql" as const, operation: command.operation, code: result.rows[0].sub_code, version: result.rows[0].version };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

/** Typed replacement for the desktop add-on-field editor.  Fields are bound
 * only to pre-existing restored addon_data columns; this preserves the cloned
 * physical storage shape while still allowing a user to create, amend and
 * retire real field definitions. */
export async function writeLegacyAddonField(raw: unknown) {
  if (process.env.SMARTWINFA_MASTER_WRITES !== "true") throw new Error("Master writes are disabled in this environment");
  const command = validateAddonFieldCommand(raw);
  const client = await legacyPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '10000ms'");
    await client.query("SELECT pg_advisory_xact_lock(600141141541140)");
    let result;
    if (command.operation !== "delete") {
      const storage = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name='addon_data' AND column_name=$2`, [COMPANY_SCHEMA, command.storageName]);
      if (!storage.rowCount) throw new Error("Choose a storage field from the restored addon_data table");
      const duplicate = await client.query(`SELECT 1 FROM ${COMPANY_SCHEMA}.addon_fld WHERE lower(btrim(fiel_save))=lower($1) AND fiel_relate=$2 AND COALESCE(fiel_pos,'A')<>'D' AND ($3::int IS NULL OR fiel_key<>$3)`, [command.storageName, command.relation, command.key ?? null]);
      if (duplicate.rowCount) throw new Error("That storage field is already assigned to an active add-on definition");
    }
    if (command.operation === "create") {
      result = await client.query<{ fiel_key: number; version: string }>(`
        INSERT INTO ${COMPANY_SCHEMA}.addon_fld(
          fiel_key,fiel_type,fiel_name,fiel_short,fiel_desc,fiel_calc,fiel_entry,fiel_relate,
          fiel_docprint,fiel_repdefa,fiel_mbal,fiel_nat,fiel_pos,fiel_partyrate,fiel_serial,fiel_save,fiel_masterpos,fiel_entrypos,last_savedate,last_savetime
        ) SELECT COALESCE(MAX(fiel_key),0)+1,$1,$2,$3,$2,'0',$4,$5,'Y','M',$6,'U','A','N',$7,$8,$9,$10,CURRENT_DATE,to_char(clock_timestamp(),'HH24:MI:SS')
          FROM ${COMPANY_SCHEMA}.addon_fld
        RETURNING fiel_key,xmin::text AS version
      `, [command.type === "M" ? "M" : "I", command.description, command.shortName, command.required ? "C" : "O", command.relation, command.type === "M" ? "M" : command.type, command.serial, command.storageName, command.masterVisible ? "Y" : "N", command.entryPosition ?? ""]);
    } else if (command.operation === "update") {
      result = await client.query<{ fiel_key: number; version: string }>(`
        UPDATE ${COMPANY_SCHEMA}.addon_fld
        SET fiel_type=$2,fiel_name=$3,fiel_short=$4,fiel_desc=$3,fiel_entry=$5,fiel_relate=$6,
            fiel_mbal=$7,fiel_serial=$8,fiel_save=$9,fiel_masterpos=$10,fiel_entrypos=$11,
            last_savedate=CURRENT_DATE,last_savetime=to_char(clock_timestamp(),'HH24:MI:SS')
        WHERE fiel_key=$1 AND COALESCE(fiel_pos,'A')<>'D' AND xmin=$12::text::xid
        RETURNING fiel_key,xmin::text AS version
      `, [command.key, command.type === "M" ? "M" : "I", command.description, command.shortName, command.required ? "C" : "O", command.relation, command.type === "M" ? "M" : command.type, command.serial, command.storageName, command.masterVisible ? "Y" : "N", command.entryPosition ?? "", command.version]);
    } else {
      result = await client.query<{ fiel_key: number; version: string }>(`UPDATE ${COMPANY_SCHEMA}.addon_fld SET fiel_pos='D',last_savedate=CURRENT_DATE,last_savetime=to_char(clock_timestamp(),'HH24:MI:SS') WHERE fiel_key=$1 AND COALESCE(fiel_pos,'A')<>'D' AND xmin=$2::text::xid RETURNING fiel_key,xmin::text AS version`, [command.key, command.version]);
    }
    if (!result.rowCount) throw new Error("The add-on field changed or was deleted; reload before saving");
    await client.query("COMMIT");
    return { source: "legacy-postgresql" as const, entity: "field" as const, operation: command.operation, key: result.rows[0].fiel_key, version: result.rows[0].version };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined); throw error;
  } finally { client.release(); }
}

export async function readLegacyAddonMaster(relation: string | null): Promise<LegacyAddonMasterPayload> {
  const client = await legacyPool().connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10000ms'");
    const relations = await client.query<{ key: string; fields: string }>(`
      SELECT fiel_relate AS key, COUNT(*)::text AS fields
      FROM ${COMPANY_SCHEMA}.addon_fld
      WHERE fiel_pos <> 'D'
      GROUP BY fiel_relate
      ORDER BY fiel_relate
    `);
    const allowed = relations.rows.map((row) => row.key);
    const selected = relation && allowed.includes(relation) ? relation : "A";
    const rows = await client.query<{
      fiel_key: number; version: string; fiel_relate: string; fiel_desc: string | null; fiel_short: string | null;
      fiel_save: string | null; fiel_type: string | null; fiel_serial: string | number | null; fiel_entry: string | null;
      fiel_masterpos: string | null; fiel_entrypos: string | null; lookup_values: string;
    }>(`
      SELECT f.fiel_key, f.xmin::text AS version, f.fiel_relate, f.fiel_desc, f.fiel_short, f.fiel_save, f.fiel_type,
             f.fiel_serial, f.fiel_entry, f.fiel_masterpos, f.fiel_entrypos,
             COUNT(s.sub_code)::text AS lookup_values
      FROM ${COMPANY_SCHEMA}.addon_fld f
      LEFT JOIN ${COMPANY_SCHEMA}.addon_sub s ON s.para_id = f.fiel_key AND COALESCE(s.sub_pos, 'A') <> 'D'
      WHERE f.fiel_pos <> 'D' AND f.fiel_relate = $1
      GROUP BY f.fiel_key, f.xmin, f.fiel_relate, f.fiel_desc, f.fiel_short, f.fiel_save, f.fiel_type,
               f.fiel_serial, f.fiel_entry, f.fiel_masterpos, f.fiel_entrypos
      ORDER BY f.fiel_serial NULLS LAST, f.fiel_key
    `, [selected]);
    const fieldKeys = rows.rows.map((row) => row.fiel_key);
    const storageColumns = await client.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema=$1 AND table_name='addon_data' AND column_name NOT IN ('aon_key','code','prod_id','imp_aonkey','trf_aonkey')
      ORDER BY column_name
    `, [COMPANY_SCHEMA]);
    const options = fieldKeys.length ? await client.query<{ sub_code: number; para_id: number; sub_name: string | null; short_name: string | null; version: string }>(`
      SELECT sub_code,para_id,sub_name,short_name,xmin::text AS version
      FROM ${COMPANY_SCHEMA}.addon_sub
      WHERE para_id=ANY($1::int[]) AND COALESCE(sub_pos,'A')<>'D'
      ORDER BY para_id,sub_name,sub_code
    `, [fieldKeys]) : { rows: [] };
    await client.query("COMMIT");
    return {
      source: "legacy-postgresql",
      readOnly: true,
      writesEnabled: process.env.SMARTWINFA_MASTER_WRITES === "true",
      relations: relations.rows.map((row) => ({ key: row.key, label: row.key === "A" ? "Account fields" : row.key === "P" ? "Product fields" : `Relation ${row.key}`, fields: Number(row.fields) })),
      rows: rows.rows.map((row) => ({
        key: row.fiel_key, version: row.version,
        relation: row.fiel_relate,
        description: row.fiel_desc?.trim() || "",
        shortName: row.fiel_short?.trim() || "",
        storageName: row.fiel_save?.trim() || "",
        type: row.fiel_type?.trim() || "",
        serial: row.fiel_serial === null || row.fiel_serial === undefined ? "" : String(row.fiel_serial).trim(),
        required: row.fiel_entry?.trim().toUpperCase() === "C",
        masterVisible: row.fiel_masterpos?.trim().toUpperCase() === "Y",
        entryPosition: row.fiel_entrypos?.trim() || "",
        lookupValues: Number(row.lookup_values),
      })),
      options: options.rows.map((row) => ({ code: row.sub_code, fieldKey: row.para_id, name: row.sub_name?.trim() || "", shortName: row.short_name?.trim() || "", version: row.version })),
      storageOptions: storageColumns.rows.map((row) => row.column_name),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
