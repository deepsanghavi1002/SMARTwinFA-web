import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

function decodeSql(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  if (buffer[0] === 0xfe && buffer[1] === 0xff) throw new Error("UTF-16 big-endian SQL is not supported");
  return buffer.toString("utf8");
}

function count(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function uniqueNames(matches) {
  return [...new Set(matches.map((name) => name.toLowerCase()))].sort();
}

const residualPatterns = {
  alterProcedureDbo: /^\s*ALTER\s+PROCEDURE\s+\[dbo\]/gim,
  batchGo: /^\s*GO\s*$/gim,
  dboIdentifiers: /\[dbo\]/gi,
  sqlServerVariables: /@@[a-z_][a-z0-9_]*/gi,
  objectIdCalls: /\bOBJECT_ID\s*\(/gi,
  spExecuteSql: /\bsp_executesql\b/gi,
  topClauses: /\bTOP\s+(?:\(?\d+\)?|\(?[a-z_][a-z0-9_]*\)?)/gi,
  isnullCalls: /\bISNULL\s*\(/gi,
  getdateCalls: /\bGETDATE\s*\(/gi,
  nvarcharTypes: /\bNVARCHAR\b/gi,
  sysCatalogReferences: /\bsys\./gi,
  tempTableTokens: /#[a-z_][a-z0-9_]*/gi,
};

const unresolvedPatterns = {
  todo: /\bTODO(?:\([^)]*\))?/gi,
  dynamicExecute: /\bEXECUTE\s+(?:\(|['"]|[_a-z])/gi,
  explicitCommit: /^\s*COMMIT\s*;/gim,
  explicitRollback: /^\s*ROLLBACK\s*;/gim,
  passwordReferences: /\bpassword\b|u_password|modulepassword/gi,
  securityDefiner: /\bSECURITY\s+DEFINER\b/gi,
  searchPathAssignments: /^\s*SET\s+search_path\b/gim,
};

function countPatterns(text, patterns) {
  return Object.fromEntries(Object.entries(patterns).map(([name, pattern]) => [name, count(text, pattern)]));
}

function totalCounts(counts) {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

function triagePostgresRoutines(postgresText, sqlServerSet) {
  const declarationPattern = /^\s*CREATE\s+OR\s+REPLACE\s+PROCEDURE\s+([a-z_][a-z0-9_]*)\s*\(/gim;
  const declarations = [...postgresText.matchAll(declarationPattern)];

  const routines = declarations.map((declaration, index) => {
    const name = declaration[1].toLowerCase();
    const start = declaration.index;
    const fallbackEnd = declarations[index + 1]?.index ?? postgresText.length;
    const declarationTail = postgresText.slice(start, fallbackEnd);
    const openingTag = /\bAS\s+(\$[a-z_][a-z0-9_]*\$)/i.exec(declarationTail);
    const closingTagIndex = openingTag ? declarationTail.indexOf(`${openingTag[1]};`, openingTag.index + openingTag[0].length) : -1;
    const end = closingTagIndex >= 0 ? start + closingTagIndex + openingTag[1].length + 1 : fallbackEnd;
    const body = postgresText.slice(start, end);
    const residualTsql = countPatterns(body, residualPatterns);
    const unresolvedMarkers = countPatterns(body, unresolvedPatterns);
    const blockers = [];

    if (!sqlServerSet.has(name)) blockers.push("no-source-name-match");
    if (totalCounts(residualTsql)) blockers.push("residual-tsql");
    if (unresolvedMarkers.todo) blockers.push("unresolved-todo");
    if (unresolvedMarkers.dynamicExecute) blockers.push("dynamic-sql-review");
    if (unresolvedMarkers.explicitCommit || unresolvedMarkers.explicitRollback) blockers.push("transaction-review");
    if (unresolvedMarkers.passwordReferences) blockers.push("credential-security-review");
    if (unresolvedMarkers.securityDefiner) blockers.push("privilege-review");
    if (unresolvedMarkers.searchPathAssignments) blockers.push("tenant-isolation-review");

    return {
      name,
      sourceNameMatched: sqlServerSet.has(name),
      startLine: postgresText.slice(0, start).split("\n").length,
      lines: body.split("\n").length,
      status: blockers.length ? "repair-required" : "static-candidate",
      blockers,
      residualTsql,
      unresolvedMarkers,
    };
  });

  const blockerCounts = {};
  for (const routine of routines) {
    for (const blocker of routine.blockers) blockerCounts[blocker] = (blockerCounts[blocker] ?? 0) + 1;
  }

  return {
    summary: {
      routines: routines.length,
      staticCandidates: routines.filter(({ status }) => status === "static-candidate").length,
      repairRequired: routines.filter(({ status }) => status === "repair-required").length,
      blockerCounts: Object.fromEntries(Object.entries(blockerCounts).sort(([left], [right]) => left.localeCompare(right))),
    },
    routines,
  };
}

function csvCell(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function formatRoutineTriageCsv(analysis) {
  const headings = [
    "name",
    "source_name_matched",
    "start_line",
    "lines",
    "status",
    "blockers",
    "todo",
    "dynamic_execute",
    "explicit_commit",
    "explicit_rollback",
    "password_references",
    "residual_tsql",
  ];
  const rows = analysis.routineTriage.routines.map((routine) => [
    routine.name,
    routine.sourceNameMatched,
    routine.startLine,
    routine.lines,
    routine.status,
    routine.blockers.join(";"),
    routine.unresolvedMarkers.todo,
    routine.unresolvedMarkers.dynamicExecute,
    routine.unresolvedMarkers.explicitCommit,
    routine.unresolvedMarkers.explicitRollback,
    routine.unresolvedMarkers.passwordReferences,
    totalCounts(routine.residualTsql),
  ]);

  return `${[headings, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

export function analyzeProcedureText(postgresText, sqlServerText) {
  const postgresDeclarations = [...postgresText.matchAll(/^\s*CREATE\s+OR\s+REPLACE\s+PROCEDURE\s+([a-z_][a-z0-9_]*)\s*\(/gim)].map((match) => match[1]);
  const sqlServerDeclarations = [...sqlServerText.matchAll(/^\s*(?:CREATE|ALTER)\s+PROCEDURE\s+(?:\[dbo\]\.)?\[?([a-z_][a-z0-9_]*)\]?/gim)].map((match) => match[1]);
  const postgresNames = uniqueNames(postgresDeclarations);
  const sqlServerNames = uniqueNames(sqlServerDeclarations);
  const postgresSet = new Set(postgresNames);
  const sqlServerSet = new Set(sqlServerNames);
  const missingFromPostgres = sqlServerNames.filter((name) => !postgresSet.has(name));
  const postgresOnly = postgresNames.filter((name) => !sqlServerSet.has(name));
  const matched = sqlServerNames.filter((name) => postgresSet.has(name));

  const residualTsql = countPatterns(postgresText, residualPatterns);
  const unresolvedMarkers = countPatterns(postgresText, unresolvedPatterns);
  const residualCount = totalCounts(residualTsql);
  const routineTriage = triagePostgresRoutines(postgresText, sqlServerSet);

  return {
    classification: residualCount || unresolvedMarkers.todo || missingFromPostgres.length ? "quarantined-not-deployable" : "structurally-clean-unverified",
    source: { declarations: sqlServerDeclarations.length, uniqueNames: sqlServerNames.length },
    target: { declarations: postgresDeclarations.length, uniqueNames: postgresNames.length },
    coverage: {
      matchedNames: matched.length,
      sourceNameCoveragePercent: sqlServerNames.length ? Number(((matched.length / sqlServerNames.length) * 100).toFixed(2)) : 0,
      missingFromPostgres,
      postgresOnly,
    },
    residualTsql,
    unresolvedMarkers,
    routineTriage,
  };
}

export async function analyzeProcedureFiles(postgresPath, sqlServerPath) {
  const [postgresBuffer, sqlServerBuffer] = await Promise.all([readFile(postgresPath), readFile(sqlServerPath)]);
  return {
    artifacts: {
      postgres: { path: postgresPath, bytes: postgresBuffer.length, sha256: createHash("sha256").update(postgresBuffer).digest("hex") },
      sqlServer: { path: sqlServerPath, bytes: sqlServerBuffer.length, sha256: createHash("sha256").update(sqlServerBuffer).digest("hex") },
    },
    ...analyzeProcedureText(decodeSql(postgresBuffer), decodeSql(sqlServerBuffer)),
  };
}

async function main() {
  const [postgresPath, sqlServerPath, format] = process.argv.slice(2);
  if (!postgresPath || !sqlServerPath) {
    throw new Error("Usage: analyze-procedure-intake.mjs <postgres.sql> <sqlserver.sql> [--format=csv]");
  }
  const analysis = await analyzeProcedureFiles(postgresPath, sqlServerPath);
  process.stdout.write(format === "--format=csv" ? formatRoutineTriageCsv(analysis) : `${JSON.stringify(analysis, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Procedure intake analysis failed: ${error.message}`);
    process.exitCode = 1;
  });
}
