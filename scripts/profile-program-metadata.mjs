/**
 * Profiles aggregate master/special program metadata. It never exports screen
 * labels, source tables, query text, validation expressions, or client rows.
 *
 * Usage: node scripts/profile-program-metadata.mjs --database smartwin_data_intake --observed-on 2026-08-21
 */
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const allowedProgramTypes = new Set(["M", "S"]);

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function count(value, label) {
  if (!Number.isInteger(Number(value)) || Number(value) < 0) throw new Error(`${label} must be a non-negative integer`);
  return Number(value);
}

/** Builds a reproducible, non-executable program/view metadata profile. */
export function buildProgramMetadataProfile({ observedOn, programTypes, facts, fieldFacts }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn) || Number.isNaN(Date.parse(`${observedOn}T00:00:00Z`))) throw new Error("observedOn must be an ISO date");
  const types = Object.fromEntries(Object.entries(programTypes).map(([type, programs]) => {
    if (!allowedProgramTypes.has(type)) throw new Error("program type is unsupported");
    return [type, count(programs, `programTypes.${type}`)];
  }));
  const normalizedFacts = Object.fromEntries(Object.entries(facts).map(([key, value]) => [key, count(value, `facts.${key}`)]));
  const normalizedFieldFacts = Object.fromEntries(Object.entries(fieldFacts).map(([key, value]) => [key, count(value, `fieldFacts.${key}`)]));
  const requiredFacts = ["programs", "updateQueryPrograms", "updateWherePrograms", "updateOrderByPrograms", "addonQueryPrograms", "addonFromPrograms", "addonWherePrograms", "addonOrderByPrograms", "orphanFieldRows", "programsWithoutFields"];
  const requiredFieldFacts = ["fields", "lookupQueryFields", "validationFields", "duplicateCheckFields", "compulsoryFields", "addActiveFields", "updateActiveFields"];
  if (requiredFacts.some((key) => normalizedFacts[key] === undefined) || requiredFieldFacts.some((key) => normalizedFieldFacts[key] === undefined)) throw new Error("all program and field profile counts are required");
  if (Object.values(types).reduce((sum, programs) => sum + programs, 0) !== normalizedFacts.programs) throw new Error("program types must reconcile to programs");
  if (normalizedFieldFacts.lookupQueryFields > normalizedFieldFacts.fields || normalizedFieldFacts.validationFields > normalizedFieldFacts.fields) throw new Error("field counts cannot exceed fields");

  const profile = {
    profileVersion: 1,
    observedOn,
    restrictedData: false,
    source: { schema: "smart_setup", tables: ["program_top", "program_body"] },
    programTypes: types,
    facts: normalizedFacts,
    fieldFacts: normalizedFieldFacts,
    integrityStatus: normalizedFacts.orphanFieldRows || normalizedFacts.programsWithoutFields ? "repair-or-exception-required" : "review-required",
    conclusion: "Program/query fragments, validation, lookup, and duplicate-check expressions are legacy source code. Only reviewed typed definitions may enter the target metadata compiler; orphan rows must be repaired or documented before program coverage can close.",
  };
  return Object.freeze({ ...profile, profileHash: sha256(JSON.stringify(profile)) });
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith("--")) throw new Error(`unexpected argument ${args[index]}`);
    const key = args[index].slice(2); const value = args[index + 1];
    if (!value || value.startsWith("--") || options[key]) throw new Error(`--${key} requires one value`);
    options[key] = value; index += 1;
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
      'programTypes', (SELECT json_object_agg(program_type, programs) FROM (SELECT btrim(program_type) AS program_type, count(*)::int AS programs FROM smart_setup.program_top GROUP BY btrim(program_type)) type_counts),
      'facts', json_build_object(
        'programs', (SELECT count(*) FROM smart_setup.program_top),
        'updateQueryPrograms', (SELECT count(*) FROM smart_setup.program_top WHERE nullif(btrim(update_query), '') IS NOT NULL),
        'updateWherePrograms', (SELECT count(*) FROM smart_setup.program_top WHERE nullif(btrim(update_where), '') IS NOT NULL),
        'updateOrderByPrograms', (SELECT count(*) FROM smart_setup.program_top WHERE nullif(btrim(update_orderby), '') IS NOT NULL),
        'addonQueryPrograms', (SELECT count(*) FROM smart_setup.program_top WHERE nullif(btrim(addon_query), '') IS NOT NULL),
        'addonFromPrograms', (SELECT count(*) FROM smart_setup.program_top WHERE nullif(btrim(addon_from), '') IS NOT NULL),
        'addonWherePrograms', (SELECT count(*) FROM smart_setup.program_top WHERE nullif(btrim(addon_where), '') IS NOT NULL),
        'addonOrderByPrograms', (SELECT count(*) FROM smart_setup.program_top WHERE nullif(btrim(addon_orderby), '') IS NOT NULL),
        'orphanFieldRows', (SELECT count(*) FROM smart_setup.program_body b WHERE NOT EXISTS (SELECT 1 FROM smart_setup.program_top p WHERE p.program_top_key = b.program_top_id)),
        'programsWithoutFields', (SELECT count(*) FROM smart_setup.program_top p WHERE NOT EXISTS (SELECT 1 FROM smart_setup.program_body b WHERE b.program_top_id = p.program_top_key))
      ),
      'fieldFacts', json_build_object(
        'fields', (SELECT count(*) FROM smart_setup.program_body),
        'lookupQueryFields', (SELECT count(*) FROM smart_setup.program_body WHERE nullif(btrim(combo_query), '') IS NOT NULL),
        'validationFields', (SELECT count(*) FROM smart_setup.program_body WHERE nullif(btrim(field_validation), '') IS NOT NULL),
        'duplicateCheckFields', (SELECT count(*) FROM smart_setup.program_body WHERE duplicate_chk),
        'compulsoryFields', (SELECT count(*) FROM smart_setup.program_body WHERE value_compulsory),
        'addActiveFields', (SELECT count(*) FROM smart_setup.program_body WHERE add_active),
        'updateActiveFields', (SELECT count(*) FROM smart_setup.program_body WHERE update_active)
      )
    );
  `);
  const profile = buildProgramMetadataProfile({ observedOn: options["observed-on"], ...facts });
  process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
