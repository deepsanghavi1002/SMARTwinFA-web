import { transaction } from "@/lib/db";
import { allowedMasterMenu, trustedDevelopmentEnabled } from "@/lib/master-program/access";
import { verifyModulePassword } from "@/lib/master-program/extras";
import { Loader } from "@/lib/master-program/load";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { readMenuCatalog } from "@/lib/menu-catalog";
import { ReportRefusal } from "@/lib/report/generate";
import { runGroupedReport, runReport } from "@/lib/report/reportCombine";
import { loadReport, lostFocusItems } from "@/lib/report/setup";
import { readEntryLog } from "@/lib/report/log";
import type { ReportSelection } from "@/lib/report/types";

/**
 * The generic report screen's server (the desktop's Report_Combine). Only a report named by a
 * REPORT row of the company's visible menu can be opened, and everything runs read-only.
 */

type Body = Readonly<{ action: string; session: SessionKey; reportName: string; menuShortName?: string; selection?: ReportSelection; password?: string; ledKey?: number; processKey?: number; fields?: string[] }>;

const NAME = /^[A-Za-z0-9_]{1,64}$/;
const headers = { "cache-control": "no-store" };

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map((entry) => String(entry ?? "")).slice(0, 20000) : []);
const record = <T>(value: unknown, map: (entry: unknown) => T): Record<string, T> => (value && typeof value === "object" && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 200).map(([key, entry]) => [String(key), map(entry)]))
  : {});

/** The selection as sent, reduced to plain strings, lists and flags (planReport checks every value against setup). */
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
async function winfaVersion(client: { query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }> }): Promise<string> {
  const exists = await client.query("SELECT to_regclass('smart_setup.winfa_version') IS NOT NULL AS ok");
  if (exists.rows[0]?.ok !== true) return "";
  const text = String((await client.query("SELECT max(version_number)::text AS v FROM smart_setup.winfa_version")).rows[0]?.v ?? "");
  return text.length >= 8 ? `${text.slice(0, 4)}.${text.slice(4, 6)}` : "";
}

export async function POST(request: Request) {
  if (!trustedDevelopmentEnabled(process.env.SMARTWINFA_TRUSTED_LOCAL_MODE)) {
    return Response.json({ error: "Reports are disabled until authenticated sessions are implemented. SMARTWINFA_TRUSTED_LOCAL_MODE=true is for isolated development with disposable data only." }, { status: 503, headers });
  }
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  if (!body || typeof body.action !== "string" || !body.session || !NAME.test(String(body.reportName ?? ""))) {
    return Response.json({ error: "action, session and reportName are required" }, { status: 400, headers });
  }
  const key: SessionKey = { companyId: Number(body.session.companyId), yearKey: Number(body.session.yearKey), loginName: String(body.session.loginName ?? "") };
  const moduleName = String(body.menuShortName ?? "");

  try {
    const result = await transaction(async (client) => {
      const session = await readSession(client, key);
      if (!allowedMasterMenu(await readMenuCatalog(session.companyGroup), body.reportName, moduleName, "REPORT")) {
        throw new Error("The requested report and module are not in this company's visible menu");
      }
      const loader = new Loader(client, session);
      switch (body.action) {
        case "report": {
          const report = await loadReport(loader, body.reportName, moduleName);
          return { report, warnings: loader.warnings, companyName: session.companyName, userName: session.loginName, version: await winfaVersion(client) };
        }
        case "generate":
          return { output: await runReport(loader, body.reportName, cleanSelection(body.selection)) };
        case "group": return { output: await runGroupedReport(loader, body.reportName, cleanSelection(body.selection), strings(body.fields).slice(0, 10)) };
        case "lostfocus": { const refilled = await lostFocusItems(loader, body.reportName, String(body.selection?.firstCombo ?? "")); return { ...refilled, warnings: loader.warnings }; }
        case "log": return { log: await readEntryLog(loader, Math.trunc(Number(body.ledKey) || 0), Math.trunc(Number(body.processKey) || 0)) };
        case "module-password": return verifyModulePassword(loader, moduleName, String(body.password ?? ""));
        default: throw new Error(`Unknown action ${body.action}`);
      }
    }, { readOnlyWork: true, timeoutMs: 120000 });
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof ReportRefusal) return Response.json({ refusal: { message: error.message, caption: error.caption } }, { headers });
    console.error("Report error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "The report request failed" }, { status: 500, headers });
  }
}
