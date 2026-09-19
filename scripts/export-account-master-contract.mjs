/**
 * Exports the ordered Account Master field structure from the isolated intake
 * database. The export deliberately excludes captions, raw queries, formulas,
 * lookup text, defaults, client rows, and all write behavior.
 *
 * Usage: node scripts/export-account-master-contract.mjs --database smartwin_data_intake --observed-on 2026-08-21
 */
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const expectedProgramTopKey = 14;
const safeIdentifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const sensitiveIdentifier = /(pass(word)?|pwd|secret|token|credential)/i;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function assertSafeIdentifier(value, label) {
  if (typeof value !== "string" || !safeIdentifier.test(value) || sensitiveIdentifier.test(value)) {
    throw new Error(`${label} must be a non-sensitive catalog identifier`);
  }
  return value;
}

function sourceColumnMapping(value) {
  if (typeof value !== "string" || sensitiveIdentifier.test(value)) {
    throw new Error("field.sourceColumn must be a non-sensitive catalog identifier");
  }
  if (!safeIdentifier.test(value)) return { status: "expression-review-required" };
  return { status: "direct", column: value };
}

function assertChecksum(value, label) {
  if (!/^[a-f0-9]{32}$/i.test(value)) throw new Error(`${label} must be an MD5 checksum`);
  return value.toLowerCase();
}

/** Converts direct, non-executable metadata facts into a reviewable contract. */
export function buildAccountMasterFieldContract({ observedOn, source, fields }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn) || Number.isNaN(Date.parse(`${observedOn}T00:00:00Z`))) {
    throw new Error("observedOn must be an ISO date");
  }
  if (source.programTopKey !== expectedProgramTopKey) throw new Error(`expected program_top:${expectedProgramTopKey}`);

  const normalizedFields = fields.map((field) => ({
    sourceId: `program_body:${assertInteger(Number(field.programBodyKey), "field.programBodyKey")}`,
    addOrder: assertInteger(Number(field.addOrder), "field.addOrder"),
    updateOrder: assertInteger(Number(field.updateOrder), "field.updateOrder"),
    source: {
      table: assertSafeIdentifier(field.sourceTable, "field.sourceTable"),
      column: sourceColumnMapping(field.sourceColumn),
    },
    legacyType: assertSafeIdentifier(field.legacyType, "field.legacyType"),
    inputType: field.inputType === null ? null : assertSafeIdentifier(field.inputType, "field.inputType"),
    length: {
      declared: assertInteger(Number(field.declaredLength), "field.declaredLength"),
      minimum: assertInteger(Number(field.minimumLength), "field.minimumLength"),
      maximum: assertInteger(Number(field.maximumLength), "field.maximumLength"),
      decimalPlaces: assertInteger(Number(field.decimalPlaces), "field.decimalPlaces"),
    },
    modes: {
      add: Boolean(field.addActive),
      update: Boolean(field.updateActive),
      required: Boolean(field.required),
      duplicateCheck: Boolean(field.duplicateCheck),
      lookupContractRequired: Boolean(field.hasLookupQuery),
    },
    mappingStatus: "unreviewed",
  })).sort((left, right) => left.updateOrder - right.updateOrder || left.addOrder - right.addOrder || left.sourceId.localeCompare(right.sourceId));

  if (!normalizedFields.length) throw new Error("at least one field is required");
  if (new Set(normalizedFields.map(({ sourceId }) => sourceId)).size !== normalizedFields.length) throw new Error("program body keys cannot repeat");

  const contract = {
    contractVersion: 1,
    observedOn,
    restrictedData: false,
    source: {
      programTopId: `program_top:${source.programTopKey}`,
      updateDefinitionChecksum: assertChecksum(source.updateDefinitionChecksum, "source.updateDefinitionChecksum"),
      addonDefinitionChecksum: assertChecksum(source.addonDefinitionChecksum, "source.addonDefinitionChecksum"),
    },
    fields: normalizedFields,
  };

  return Object.freeze({ ...contract, contractHash: sha256(JSON.stringify(contract)) });
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith("--")) throw new Error(`unexpected argument ${args[index]}`);
    const key = args[index].slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith("--") || options[key]) throw new Error(`--${key} requires one value`);
    options[key] = value;
    index += 1;
  }
  if (!options.database || !options["observed-on"]) throw new Error("usage: --database DATABASE --observed-on YYYY-MM-DD");
  return options;
}

async function readJson(database, sql) {
  const { stdout } = await execFile("psql", ["-d", database, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql], { maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout.trim());
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const source = await readJson(options.database, `
    SELECT json_build_object(
      'programTopKey', program_top_key,
      'updateDefinitionChecksum', md5(coalesce(update_query, '')),
      'addonDefinitionChecksum', md5(coalesce(addon_query, ''))
    )
    FROM smart_setup.program_top
    WHERE program_top_key = ${expectedProgramTopKey};
  `);
  const fields = await readJson(options.database, `
    SELECT coalesce(json_agg(json_build_object(
      'programBodyKey', program_body_key,
      'addOrder', field_add_order,
      'updateOrder', field_update_order,
      'sourceTable', btrim(database_name),
      'sourceColumn', btrim(field_name),
      'legacyType', btrim(field_type),
      'inputType', nullif(btrim(input_type), ''),
      'declaredLength', field_length,
      'minimumLength', field_length_min,
      'maximumLength', field_length_max,
      'decimalPlaces', decimal_points,
      'addActive', add_active,
      'updateActive', update_active,
      'required', value_compulsory,
      'duplicateCheck', duplicate_chk,
      'hasLookupQuery', nullif(btrim(combo_query), '') IS NOT NULL
    ) ORDER BY field_update_order, field_add_order, program_body_key), '[]'::json)
    FROM smart_setup.program_body
    WHERE program_top_id = ${expectedProgramTopKey};
  `);
  const contract = buildAccountMasterFieldContract({ observedOn: options["observed-on"], source, fields });
  process.stdout.write(`${JSON.stringify(contract, null, 2)}\n`);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
