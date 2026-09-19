/**
 * Profiles aggregate-only legacy add-on/custom-field metadata. It never emits
 * field labels, formulas, relationship expressions, client rows, or raw SQL.
 *
 * Usage: node scripts/profile-addon-metadata.mjs --database smartwin_data_intake --observed-on 2026-08-21
 */
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function count(value, label) {
  if (!Number.isInteger(Number(value)) || Number(value) < 0) throw new Error(`${label} must be a non-negative integer`);
  return Number(value);
}

function typeHistogram(histogram) {
  if (!histogram || typeof histogram !== "object" || Array.isArray(histogram)) throw new Error("legacyTypes must be an object");
  return Object.fromEntries(Object.entries(histogram)
    .map(([type, definitions]) => {
      if (!/^[A-Z]$/.test(type)) throw new Error("legacy type code is invalid");
      return [type, count(definitions, `legacyTypes.${type}`)];
    })
    .sort(([left], [right]) => left.localeCompare(right)));
}

/** Converts aggregate-only source facts into a safe custom-field risk profile. */
export function buildAddonMetadataProfile({ observedOn, definitions, dataProjection }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn) || Number.isNaN(Date.parse(`${observedOn}T00:00:00Z`))) {
    throw new Error("observedOn must be an ISO date");
  }
  const normalizedDefinitions = {
    total: count(definitions.total, "definitions.total"),
    legacyTypes: typeHistogram(definitions.legacyTypes),
    saveMapped: count(definitions.saveMapped, "definitions.saveMapped"),
    validationMarked: count(definitions.validationMarked, "definitions.validationMarked"),
    masterScoped: count(definitions.masterScoped, "definitions.masterScoped"),
    entryScoped: count(definitions.entryScoped, "definitions.entryScoped"),
    documentPrintScoped: count(definitions.documentPrintScoped, "definitions.documentPrintScoped"),
    calculatedMarked: count(definitions.calculatedMarked, "definitions.calculatedMarked"),
    relationshipMarked: count(definitions.relationshipMarked, "definitions.relationshipMarked"),
    errorMarked: count(definitions.errorMarked, "definitions.errorMarked"),
    positionedForMaster: count(definitions.positionedForMaster, "definitions.positionedForMaster"),
    positionedForEntry: count(definitions.positionedForEntry, "definitions.positionedForEntry"),
  };
  const normalizedData = {
    rows: count(dataProjection.rows, "dataProjection.rows"),
    accountScopedRows: count(dataProjection.accountScopedRows, "dataProjection.accountScopedRows"),
    productScopedRows: count(dataProjection.productScopedRows, "dataProjection.productScopedRows"),
    dualScopedRows: count(dataProjection.dualScopedRows, "dataProjection.dualScopedRows"),
    unscopedRows: count(dataProjection.unscopedRows, "dataProjection.unscopedRows"),
    unmatchedAccountCodes: count(dataProjection.unmatchedAccountCodes, "dataProjection.unmatchedAccountCodes"),
  };
  for (const key of ["accountScopedRows", "productScopedRows", "dualScopedRows", "unscopedRows"]) {
    if (normalizedData[key] > normalizedData.rows) throw new Error(`${key} cannot exceed dataProjection.rows`);
  }

  const profile = {
    profileVersion: 1,
    observedOn,
    restrictedData: false,
    source: { schema: "rishabh_plastic27", metadataTable: "addon_fld", dataTable: "addon_data" },
    definitions: normalizedDefinitions,
    dataProjection: {
      ...normalizedData,
      model: "polymorphic-legacy-projection-review-required",
      status: normalizedData.unscopedRows || normalizedData.unmatchedAccountCodes ? "repair-or-exception-required" : "review-required",
    },
    conclusion: "Legacy add-on metadata is executable product behavior. Each source type, calculation/relationship marker, field position, save mapping, and polymorphic data association requires a reviewed typed target definition; no raw metadata expression or inferred foreign key may enter runtime.",
  };
  return Object.freeze({ ...profile, profileHash: sha256(JSON.stringify(profile)) });
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
  const facts = await readJson(options.database, `
    SELECT json_build_object(
      'definitions', json_build_object(
        'total', (SELECT count(*) FROM rishabh_plastic27.addon_fld),
        'legacyTypes', (SELECT json_object_agg(type, total) FROM (SELECT btrim(fiel_type) AS type, count(*)::int AS total FROM rishabh_plastic27.addon_fld GROUP BY btrim(fiel_type)) types),
        'saveMapped', (SELECT count(*) FROM rishabh_plastic27.addon_fld WHERE nullif(btrim(fiel_save), '') IS NOT NULL),
        'validationMarked', (SELECT count(*) FROM rishabh_plastic27.addon_fld WHERE nullif(btrim(fiel_valid), '') IS NOT NULL),
        'masterScoped', (SELECT count(*) FROM rishabh_plastic27.addon_fld WHERE nullif(btrim(fiel_inmaster), '') IS NOT NULL),
        'entryScoped', (SELECT count(*) FROM rishabh_plastic27.addon_fld WHERE nullif(btrim(fiel_entry), '') IS NOT NULL),
        'documentPrintScoped', (SELECT count(*) FROM rishabh_plastic27.addon_fld WHERE nullif(btrim(fiel_docprint), '') IS NOT NULL),
        'calculatedMarked', (SELECT count(*) FROM rishabh_plastic27.addon_fld WHERE nullif(btrim(fiel_calc), '') IS NOT NULL),
        'relationshipMarked', (SELECT count(*) FROM rishabh_plastic27.addon_fld WHERE nullif(btrim(fiel_relate), '') IS NOT NULL),
        'errorMarked', (SELECT count(*) FROM rishabh_plastic27.addon_fld WHERE nullif(btrim(fiel_err), '') IS NOT NULL),
        'positionedForMaster', (SELECT count(*) FROM rishabh_plastic27.addon_fld WHERE nullif(btrim(fiel_masterpos), '') IS NOT NULL),
        'positionedForEntry', (SELECT count(*) FROM rishabh_plastic27.addon_fld WHERE nullif(btrim(fiel_entrypos), '') IS NOT NULL)
      ),
      'dataProjection', json_build_object(
        'rows', (SELECT count(*) FROM rishabh_plastic27.addon_data),
        'accountScopedRows', (SELECT count(*) FROM rishabh_plastic27.addon_data WHERE code IS NOT NULL),
        'productScopedRows', (SELECT count(*) FROM rishabh_plastic27.addon_data WHERE prod_id IS NOT NULL),
        'dualScopedRows', (SELECT count(*) FROM rishabh_plastic27.addon_data WHERE code IS NOT NULL AND prod_id IS NOT NULL),
        'unscopedRows', (SELECT count(*) FROM rishabh_plastic27.addon_data WHERE code IS NULL AND prod_id IS NULL),
        'unmatchedAccountCodes', (SELECT count(*) FROM rishabh_plastic27.addon_data d WHERE d.code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM rishabh_plastic27.account a WHERE a.code = d.code))
      )
    );
  `);
  const profile = buildAddonMetadataProfile({ observedOn: options["observed-on"], ...facts });
  process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
