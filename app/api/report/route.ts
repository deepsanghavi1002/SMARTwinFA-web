import { readMasterLog, readSmallEntryLog } from "@/lib/master-program/extras";
import { transaction } from "@/lib/db";
import { allowedMasterMenu } from "@/lib/master-program/access";
import { requireOperator } from "@/lib/auth/request";
import { verifyModulePassword } from "@/lib/master-program/extras";
import { Loader } from "@/lib/master-program/load";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { readMenuCatalog } from "@/lib/menu-catalog";
import { ReportRefusal } from "@/lib/report/generate";
import { runGroupedReport, runReport } from "@/lib/report/reportCombine";
import { loadReport, againstBookItems, formFilterItems, lostFocusItems, slabFilterItems } from "@/lib/report/setup";
import { readEntryLog } from "@/lib/report/log";
import { zoomTarget } from "@/lib/report/zoom";
import type { ReportDefinition, ReportOutput, ReportSelection } from "@/lib/report/types";
import { packedOutputStream } from "@/lib/report/wire";

/**
 * The generic report screen's server (the desktop's Report_Combine). Only a report named by a
 * REPORT row of the company's visible menu can be opened, and everything runs read-only.
 */

type Body = Readonly<{ action: string; session: SessionKey; reportName: string; menuShortName?: string; selection?: ReportSelection; password?: string; ledKey?: number; processKey?: number; masterId?: number; masterCode?: number; masterFirst?: string; masterSmall?: boolean; acCode?: number; name?: string; fields?: string[]; compareYear?: string }>;

const NAME = /^[A-Za-z0-9_]{1,64}$/;
const headers = { "cache-control": "no-store" };

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map((entry) => String(entry ?? "")).slice(0, 20000) : []);
const record = <T>(value: unknown, map: (entry: unknown) => T): Record<string, T> => (value && typeof value === "object" && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 200).map(([key, entry]) => [String(key), map(entry)]))
  : {});

/** The selection as sent, reduced to plain strings, lists and flags (planReport checks every value against setup). */
/** The year before the open one: the company of the same name and group whose year ends the day before this one starts. */
async function previousYear(client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, session: { companyKey: number; companyName: string; companyGroup: string; tarikh1: Date }): Promise<{ companyId: number; yearKey: number } | null> {
  const start = `${session.tarikh1.getFullYear()}-${String(session.tarikh1.getMonth() + 1).padStart(2, "0")}-${String(session.tarikh1.getDate()).padStart(2, "0")}`;
  const row = (await client.query(
    `SELECT n.c_id, n.c_yearid FROM smart_system.cname n JOIN smart_system.company c ON c.co_key = n.c_id WHERE btrim(c.name) = $1 AND btrim(coalesce(c.co_group, '')) = $2 AND c.co_pos = 'A' AND n.c_tarikh2::date = $3::date - 1 ORDER BY n.c_id DESC LIMIT 1`,
    [session.companyName.trim(), session.companyGroup.trim(), start])).rows[0];
  return row ? { companyId: Number(row.c_id), yearKey: Number(row.c_yearid) } : null;
}

function cleanSelection(value: ReportSelection | undefined): ReportSelection {
  const source = (value ?? {}) as Record<string, unknown>;
  return {
    firstCombo: String(source.firstCombo ?? ""),
    from: String(source.from ?? ""),
    upto: String(source.upto ?? ""),
    groups: strings(source.groups),
    ticks: record(source.ticks, strings),
    choices: record(source.choices, (entry) => String(entry ?? "")),
    columns: strings(source.columns),
    texts: record(source.texts, (entry) => String(entry ?? "").slice(0, 40)),
    checks: record(source.checks, (entry) => entry === true),
  };
}

/**
 * The program version the desktop's status bar shows (Main_Menu_New.SetWinfa_Version_No):
 * max(version_number) of smart_setup.winfa_version, 20260714 shown as 2026.07.
 */
/**
 * The value each text box of the report's selection starts with (runtime_controls' own query: the opening and closing stock amounts of the Profit / Loss come from LAST_YEAR and OS_BILLDIFF):
 * the first column of the query's first row, as a plain number, left out when there is none or it is nil.
 */
async function runtimeDefaults(client: { query: (sql: string) => Promise<{ rows: Record<string, unknown>[]; fields: { name: string }[] }> }, session: { companySchema: string; yearId: string | number }, report: ReportDefinition): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const box of report.runtime) {
    const query = box.text.trim().replace(/^"+|"+$/g, "").trim();
    if (box.type !== "T" || !/^select\b/i.test(query)) continue;
    const sql = query.split("|sys.db|").join(`${session.companySchema}.`).split("|sys.yearid|").join(String(session.yearId));
    try {
      await client.query("SAVEPOINT runtime_default");
      const found = await client.query(`SELECT * FROM (${sql}) q LIMIT 20`);
      await client.query("RELEASE SAVEPOINT runtime_default");
      // The first row with an amount (the closing stock account's, not the nil one of a stock account beside it).
      const field = found.fields[0]?.name;
      const amounts = field === undefined ? [] : found.rows.map((row) => Number(String(row[field] ?? "").replace(/[^0-9.\-]/g, ""))).filter((value) => Number.isFinite(value) && value !== 0);
      if (amounts.length > 0) out[box.name] = amounts[0].toFixed(box.decimals > 0 ? box.decimals : 2);
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT runtime_default").catch(() => undefined);
    }
  }
  return out;
}

async function winfaVersion(client: { query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }> }): Promise<string> {
  const exists = await client.query("SELECT to_regclass('smart_setup.winfa_version') IS NOT NULL AS ok");
  if (exists.rows[0]?.ok !== true) return "";
  const text = String((await client.query("SELECT max(version_number)::text AS v FROM smart_setup.winfa_version")).rows[0]?.v ?? "");
  return text.length >= 8 ? `${text.slice(0, 4)}.${text.slice(4, 6)}` : "";
}

export async function POST(request: Request) {
  const operator = await requireOperator(request, headers);
  if (operator instanceof Response) return operator;
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  if (!body || typeof body.action !== "string" || !body.session || !NAME.test(String(body.reportName ?? ""))) {
    return Response.json({ error: "action, session and reportName are required" }, { status: 400, headers });
  }
  const key: SessionKey = { companyId: Number(body.session.companyId), yearKey: Number(body.session.yearKey), loginName: operator };
  const moduleName = String(body.menuShortName ?? "");

  try {
    const used: { loader?: Loader } = {};
    const result = await transaction(async (client) => {
      const session = await readSession(client, key);
      if (!allowedMasterMenu(await readMenuCatalog(session.companyGroup), body.reportName, moduleName, "REPORT")) {
        throw new Error("The requested report and module are not in this company's visible menu");
      }
      const loader = new Loader(client, session);
      used.loader = loader;
      switch (body.action) {
        case "report": {
          const report = await loadReport(loader, body.reportName, moduleName);
          return { report, runtimeDefaults: await runtimeDefaults(client, session, report), warnings: loader.warnings, companyName: session.companyName, userName: session.loginName, version: await winfaVersion(client) };
        }
        case "generate": {
          // Compare periods > Same period last year: the same report read from the company's previous year database.
          if (body.compareYear === "previous") {
            const previous = await previousYear(client, session);
            if (!previous) throw new ReportRefusal("The company has no previous year database to compare with.", "Compare periods");
            return { output: await runReport(new Loader(client, await readSession(client, { companyId: previous.companyId, yearKey: previous.yearKey, loginName: session.loginName })), body.reportName, cleanSelection(body.selection)) };
          }
          return { output: await runReport(loader, body.reportName, cleanSelection(body.selection)) };
        }
        case "group": return { output: await runGroupedReport(loader, body.reportName, cleanSelection(body.selection), strings(body.fields).slice(0, 10)) };
        case "lostfocus": { const refilled = await lostFocusItems(loader, body.reportName, String(body.selection?.firstCombo ?? "")); return { ...refilled, warnings: loader.warnings }; }
        case "against": return await againstBookItems(loader, body.reportName, String(body.selection?.firstCombo ?? ""));
        case "slabs": return await slabFilterItems(loader, body.reportName, String(body.selection?.firstCombo ?? ""), Math.trunc(Number(String(body.selection?.choices?.cmb_AgainstBook ?? "").split("|").pop()) || 0));
        case "forms": return await formFilterItems(loader);
        case "log": if (Number(body.masterId) > 0 && body.masterSmall === true) return { log: await readSmallEntryLog(loader, Math.trunc(Number(body.masterId)), String(body.masterFirst ?? "")) }; if (Number(body.masterId) > 0) return { log: await readMasterLog(loader, Math.trunc(Number(body.masterId)), String(body.masterFirst ?? ""), Math.trunc(Number(body.masterCode) || 0)) }; return { log: await readEntryLog(loader, Math.trunc(Number(body.ledKey) || 0), Math.trunc(Number(body.processKey) || 0)) };
        case "zoom": return { zoom: await zoomTarget(loader, Math.trunc(Number(body.ledKey) || 0), Math.trunc(Number(body.processKey) || 0), Math.trunc(Number(body.acCode) || 0), String(body.name ?? "").slice(0, 200)) };
        case "module-password": return verifyModulePassword(loader, moduleName, String(body.password ?? ""));
        default: throw new Error(`Unknown action ${body.action}`);
      }
    }, { readOnlyWork: true, timeoutMs: 120000 });
    // What the report asked to be written (Update Value In Master) is done once it has run, in a transaction that can write.
    const pendingWrites = body.action === "generate" ? used.loader?.writes ?? [] : [];
    if (pendingWrites.length > 0) await transaction(async (client) => { for (const write of pendingWrites) await client.query(write.sql, write.params); });
    // A report's rows go packed and in pieces (a year's checklist can be hundreds of thousands of rows).
    if ("output" in result && result.output) return new Response(packedOutputStream(result.output as ReportOutput), { headers: { ...headers, "content-type": "application/json; charset=utf-8" } });
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof ReportRefusal) return Response.json({ refusal: { message: error.message, caption: error.caption } }, { headers });
    console.error("Report error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "The report request failed" }, { status: 500, headers });
  }
}
