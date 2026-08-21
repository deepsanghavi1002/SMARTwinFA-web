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

  const residualTsql = {
    alterProcedureDbo: count(postgresText, /^\s*ALTER\s+PROCEDURE\s+\[dbo\]/gim),
    batchGo: count(postgresText, /^\s*GO\s*$/gim),
    dboIdentifiers: count(postgresText, /\[dbo\]/gi),
    sqlServerVariables: count(postgresText, /@@[a-z_][a-z0-9_]*/gi),
    objectIdCalls: count(postgresText, /\bOBJECT_ID\s*\(/gi),
    spExecuteSql: count(postgresText, /\bsp_executesql\b/gi),
    topClauses: count(postgresText, /\bTOP\s+(?:\(?\d+\)?|\(?[a-z_][a-z0-9_]*\)?)/gi),
    isnullCalls: count(postgresText, /\bISNULL\s*\(/gi),
    getdateCalls: count(postgresText, /\bGETDATE\s*\(/gi),
    nvarcharTypes: count(postgresText, /\bNVARCHAR\b/gi),
    sysCatalogReferences: count(postgresText, /\bsys\./gi),
    tempTableTokens: count(postgresText, /#[a-z_][a-z0-9_]*/gi),
  };
  const unresolvedMarkers = {
    todo: count(postgresText, /\bTODO(?:\([^)]*\))?/gi),
    dynamicExecute: count(postgresText, /\bEXECUTE\s+(?:\(|[_a-z])/gi),
    explicitCommit: count(postgresText, /^\s*COMMIT\s*;/gim),
    explicitRollback: count(postgresText, /^\s*ROLLBACK\s*;/gim),
    passwordReferences: count(postgresText, /\bpassword\b|u_password|modulepassword/gi),
    securityDefiner: count(postgresText, /\bSECURITY\s+DEFINER\b/gi),
    searchPathAssignments: count(postgresText, /^\s*SET\s+search_path\b/gim),
  };
  const residualCount = Object.values(residualTsql).reduce((sum, value) => sum + value, 0);

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
  const [postgresPath, sqlServerPath] = process.argv.slice(2);
  if (!postgresPath || !sqlServerPath) throw new Error("Usage: analyze-procedure-intake.mjs <postgres.sql> <sqlserver.sql>");
  process.stdout.write(`${JSON.stringify(await analyzeProcedureFiles(postgresPath, sqlServerPath), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Procedure intake analysis failed: ${error.message}`);
    process.exitCode = 1;
  });
}
