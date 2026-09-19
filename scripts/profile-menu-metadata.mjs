/**
 * Profiles aggregate menu/action metadata without exporting menu text, action
 * codes, visibility/hidden marker values, user rights, or client rows.
 *
 * Usage: node scripts/profile-menu-metadata.mjs --database smartwin_data_intake --observed-on 2026-08-21
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

/** Converts aggregate menu facts into a safe hierarchy/action profile. */
export function buildMenuMetadataProfile({ observedOn, facts }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn) || Number.isNaN(Date.parse(`${observedOn}T00:00:00Z`))) {
    throw new Error("observedOn must be an ISO date");
  }
  const normalized = Object.fromEntries(Object.entries(facts).map(([key, value]) => [key, count(value, `facts.${key}`)]));
  const required = ["menuRows", "rootRows", "actionCodeRows", "actionMenuRows", "programLinkRows", "shortcutRows", "visibleMarkerRows", "hiddenMarkerRows", "specialRows", "displayRows", "duplicateMenuIdGroups", "orphanParentRows"];
  if (required.some((key) => normalized[key] === undefined)) throw new Error("all menu profile counts are required");
  if (normalized.rootRows > normalized.menuRows || normalized.actionCodeRows > normalized.menuRows || normalized.programLinkRows > normalized.menuRows) {
    throw new Error("menu count cannot exceed menuRows");
  }

  const profile = {
    profileVersion: 1,
    observedOn,
    restrictedData: false,
    source: { schema: "smart_setup", table: "menumaster" },
    facts: normalized,
    hierarchyStatus: normalized.duplicateMenuIdGroups || normalized.orphanParentRows ? "repair-or-exception-required" : "review-required",
    authorizationStatus: "blocked-on-smart_system-and-running-legacy-verification",
    conclusion: "Menu labels, actions, program links, and marker values are metadata source, not web runtime permissions. The target needs a reviewed role/permission/action registry from smart_system and behavior evidence before any menu item is enabled.",
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
      'menuRows', count(*),
      'rootRows', count(*) FILTER (WHERE parentid IS NULL OR parentid = 0),
      'actionCodeRows', count(*) FILTER (WHERE nullif(btrim(actioncode), '') IS NOT NULL),
      'actionMenuRows', count(*) FILTER (WHERE nullif(btrim(actionmenu), '') IS NOT NULL),
      'programLinkRows', count(*) FILTER (WHERE nullif(btrim(menuprogname), '') IS NOT NULL),
      'shortcutRows', count(*) FILTER (WHERE nullif(btrim(shortcutkey), '') IS NOT NULL),
      'visibleMarkerRows', count(*) FILTER (WHERE nullif(btrim(menuvisible), '') IS NOT NULL),
      'hiddenMarkerRows', count(*) FILTER (WHERE nullif(btrim(menuhide), '') IS NOT NULL),
      'specialRows', count(*) FILTER (WHERE menuspecial),
      'displayRows', count(*) FILTER (WHERE menudisplay),
      'duplicateMenuIdGroups', (SELECT count(*) FROM (SELECT menuid FROM smart_setup.menumaster GROUP BY menuid HAVING count(*) > 1) duplicate_groups),
      'orphanParentRows', (SELECT count(*) FROM smart_setup.menumaster child WHERE child.parentid IS NOT NULL AND child.parentid <> 0 AND NOT EXISTS (SELECT 1 FROM smart_setup.menumaster parent WHERE parent.menukey = child.parentid))
    ) FROM smart_setup.menumaster;
  `);
  const profile = buildMenuMetadataProfile({ observedOn: options["observed-on"], facts });
  process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
