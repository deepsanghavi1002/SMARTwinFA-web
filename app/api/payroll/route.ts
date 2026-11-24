import { transaction } from "@/lib/db";
import { requireOperator } from "@/lib/auth/request";
import { allowedMasterMenu } from "@/lib/master-program/access";
import { readMenuCatalog } from "@/lib/menu-catalog";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { getAttendance, getSlips, listPeriods, openPeriod, processPeriod, saveAttendance, setLock } from "@/lib/payroll/run";
import { bankSheet, listLoans, outstanding, saveLoan, statutory, untaggedReport } from "@/lib/payroll/reports";
import { candidates, createJournal, journalStatus, mapJournal, releaseJournal } from "@/lib/payroll/jv";
import { TAG_TYPES, reconcile, staffLines, tagLine, untag } from "@/lib/payroll/tag";
import { getSetup, getStaff, listComponents, listStaff, prepare, saveComponent, saveSetup, saveStaff, searchAccounts } from "@/lib/payroll/service";
import { RightsError, demandRight, neededRight, publicRights, readPayrollRights } from "@/lib/payroll/rights";
import { logError } from "@/lib/log";

/**
 * Payroll (Phase 1): the setup, the pay components and the staff payroll profile. One POST route, an action per call. The module has to be switched
 * on (smart_system.setup.menu_para holds "PAYROLL,", which puts its menu in the company's catalog) and the call must name the menu row of the screen
 * it comes from. The company's payroll tables are made on first use if scripts/payroll-setup.mts has not run for it.
 */

type Body = Readonly<{ action: string; screen: string; menuShortName?: string; session: SessionKey; [key: string]: unknown }>;

const headers = { "cache-control": "no-store" };

/** The menu program each screen runs under, and the actions each may call. */
const SCREENS: Readonly<Record<string, { program: string; actions: readonly string[] }>> = {
  setup: { program: "PAYROLL_SETUP", actions: ["get", "save", "accounts"] },
  components: { program: "PAYROLL_COMPONENTS", actions: ["list", "save"] },
  staff: { program: "PAYROLL_STAFF", actions: ["list", "get", "save", "accounts", "components"] },
  attendance: { program: "PAYROLL_ATTENDANCE", actions: ["periods", "open", "get", "save"] },
  process: { program: "PAYROLL_PROCESS", actions: ["periods", "open", "process", "lock", "unlock", "slips"] },
  register: { program: "PAYROLL_REGISTER", actions: ["periods", "slips"] },
  payslip: { program: "PAYROLL_PAYSLIP", actions: ["periods", "slips"] },
  tagging: { program: "PAYROLL_TAGGING", actions: ["staff", "lines", "tag", "untag", "periods"] },
  pending: { program: "PAYROLL_PENDING", actions: ["periods", "recon"] },
  outstanding: { program: "PAYROLL_OUTSTANDING", actions: ["report", "loans", "saveLoan", "staff"] },
  banksheet: { program: "PAYROLL_BANKSHEET", actions: ["periods", "sheet"] },
  statutory: { program: "PAYROLL_STATUTORY", actions: ["periods", "report"] },
  untagged: { program: "PAYROLL_UNTAGGED", actions: ["report"] },
  journal: { program: "PAYROLL_JOURNAL", actions: ["periods", "status", "candidates", "map", "release", "preview", "post"] },
};

export async function POST(request: Request) {
  const operator = await requireOperator(request, headers);
  if (operator instanceof Response) return operator;
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  const screen = SCREENS[String(body?.screen ?? "")];
  if (!body || !screen || typeof body.action !== "string" || !screen.actions.includes(body.action) || !body.session) {
    return Response.json({ error: "A known screen, action and session are required" }, { status: 400, headers });
  }
  const key: SessionKey = { companyId: Number(body.session.companyId), yearKey: Number(body.session.yearKey), loginName: operator };

  try {
    const result = await transaction(async (client) => {
      const session = await readSession(client, key);
      const menus = await readMenuCatalog(session.companyGroup);
      if (!allowedMasterMenu(menus, screen.program, String(body.menuShortName ?? ""), screen.program)) {
        throw new Error("Payroll is not switched on for this company");
      }
      await prepare(client, session);
      const input = (body.data ?? {}) as Record<string, unknown>;
      // The operator's Menu Book Rights for this screen: Allow, then the right the action needs, then the module / action password.
      const rights = await readPayrollRights(client, session, String(body.menuShortName ?? ""));
      const title = `Payroll ${body.screen.charAt(0).toUpperCase()}${body.screen.slice(1)}`;
      demandRight(rights, await neededRight(client, body.screen, body.action, input), title, { module: body.modulePassword, action: body.actionPassword });
      const result = await (async () => { switch (`${body.screen}.${body.action}`) {
        case "setup.get": return await getSetup(client);
        case "setup.save": return await saveSetup(client, operator, input);
        case "setup.accounts":
        case "staff.accounts": return { accounts: await searchAccounts(client, String(input.term ?? ""), body.screen === "setup") };
        case "components.list": return { components: await listComponents(client) };
        case "components.save": return { components: await saveComponent(client, input) };
        case "staff.components": return { components: await listComponents(client) };
        case "staff.list": return { staff: await listStaff(client, session) };
        case "staff.get": return await getStaff(client, session, Number(input.code));
        case "staff.save": return await saveStaff(client, session, operator, input);
        case "attendance.periods": case "process.periods": case "register.periods": case "payslip.periods": return { periods: await listPeriods(client) };
        case "attendance.open": case "process.open": return { periods: await openPeriod(client, operator, input.year, input.month) };
        case "attendance.get": return await getAttendance(client, Number(input.periodId));
        case "attendance.save": return await saveAttendance(client, operator, Number(input.periodId), input.rows);
        case "process.process": return await processPeriod(client, operator, Number(input.periodId));
        case "process.lock": return await setLock(client, Number(input.periodId), true);
        case "process.unlock": return await setLock(client, Number(input.periodId), false);
        case "process.slips": case "register.slips": case "payslip.slips": return { ...(await getSlips(client, Number(input.periodId))), companyName: session.companyName };
        case "tagging.periods": case "pending.periods": return { periods: await listPeriods(client) };
        case "tagging.staff": return { staff: await listStaff(client, session), types: TAG_TYPES };
        case "tagging.lines": return await staffLines(client, session, Number(input.code));
        case "tagging.tag": return await tagLine(client, session, operator, input);
        case "tagging.untag": return await untag(client, session, operator, Number(input.tagId));
        case "pending.recon": return { rows: await reconcile(client, session, input.periodId === null || input.periodId === undefined || input.periodId === "" ? null : Number(input.periodId)), company: session.companyName };
        case "journal.periods": return { periods: await listPeriods(client) };
        case "journal.status": return await journalStatus(client, Number(input.periodId));
        case "journal.candidates": return await candidates(client, session, Number(input.slipId));
        case "journal.map": await mapJournal(client, session, operator, input); return await journalStatus(client, Number(input.periodId));
        case "journal.release": await releaseJournal(client, session, operator, Number(input.slipId)); return await journalStatus(client, Number(input.periodId));
        case "journal.preview": return { voucher: await createJournal(client, session, operator, menus, Number(input.periodId), false) };
        case "journal.post": return { voucher: await createJournal(client, session, operator, menus, Number(input.periodId), true), ...(await journalStatus(client, Number(input.periodId))) };
        case "banksheet.periods": case "statutory.periods": return { periods: await listPeriods(client) };
        case "outstanding.report": return { rows: await outstanding(client), company: session.companyName };
        case "outstanding.loans": return { loans: await listLoans(client) };
        case "outstanding.saveLoan": return { loans: await saveLoan(client, operator, input) };
        case "outstanding.staff": return { staff: (await listStaff(client, session)).filter((x) => x.active).map((x) => ({ code: x.code, name: x.name })) };
        case "banksheet.sheet": return { ...(await bankSheet(client, Number(input.periodId))), company: session.companyName };
        case "statutory.report": return { ...(await statutory(client, session, input.periodId === null || input.periodId === undefined || input.periodId === "" ? null : Number(input.periodId))), company: session.companyName };
        case "untagged.report": return { ...(await untaggedReport(client, session)), company: session.companyName };
        default: throw new Error(`Unknown action ${body.screen}.${body.action}`);
      } })();
      return { result, rights: publicRights(rights) };
    }, { timeoutMs: 20000 });
    return Response.json({ ...result.result, rights: result.rights }, { headers });
  } catch (error) {
    // A refusal of rights is an answer, not a fault: the screen shows the message, or asks for the password and sends again.
    if (error instanceof RightsError) return Response.json({ error: error.message, needs: error.needs }, { status: 403, headers });
    const requestId = logError({ request, route: "/api/payroll", action: `Payroll ${body.screen}.${body.action}`, error, userId: operator });
    return Response.json({ error: error instanceof Error ? error.message : "The request failed", requestId }, { status: 500, headers });
  }
}
