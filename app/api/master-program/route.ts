import { transaction } from "@/lib/db";
import { addGridBeforeEdit, checkStateChange, defaAddValue, defaAgainst, defaFixValue, deleteBlocked, duplicateQuery, helpGrid, onChangeReplace, plywoodConversion, recordExist, stateShortCode, uomFormula } from "@/lib/master-program/events";
import type { EventRequest } from "@/lib/master-program/events";
import { productImage, readMasterLog, verifyModulePassword, zoomBook } from "@/lib/master-program/extras";
import { Loader, loadGroup, loadProgram } from "@/lib/master-program/load";
import { addSave, editSave } from "@/lib/master-program/save";
import type { AddSaveRequest, EditSaveRequest } from "@/lib/master-program/save";
import { pushToCloud } from "@/lib/master-program/replicate";
import type { CloudPush } from "@/lib/master-program/replicate";
import { readSession } from "@/lib/master-program/session";
import type { GroupState, SessionKey } from "@/lib/master-program/types";

/**
 * The generic master screen's server: one endpoint, one action per request.
 *
 * The browser names the company, year and operator it chose at startup; the session is
 * rebuilt from smart_system on every call (the Workers runtime keeps nothing between
 * requests). Reads run in a read-only transaction. A save runs in a read-write one and,
 * with dryRun, rolls back after running every statement, so a save can be proven against
 * live data without leaving anything behind.
 */

type Body = Readonly<{ action: string; session: SessionKey; programName: string; menuShortName?: string; group?: GroupState; dryRun?: boolean } & Record<string, unknown>>;

const PROGRAM = /^[A-Za-z0-9_]{1,64}$/;
const headers = { "cache-control": "no-store" };
const WRITES = new Set(["add-save", "edit-save"]);

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  if (!body || typeof body.action !== "string" || !body.session || !PROGRAM.test(String(body.programName ?? ""))) {
    return Response.json({ error: "action, session and programName are required" }, { status: 400, headers });
  }
  const key: SessionKey = { companyId: Number(body.session.companyId), yearKey: Number(body.session.yearKey), loginName: String(body.session.loginName ?? "") };
  // A dry run still executes every statement (and takes the key locks), so it needs a
  // read-write transaction; the save rolls its own savepoint back before returning.
  const writes = WRITES.has(body.action);

  try {
    const result = await transaction(async (client) => {
      const session = await readSession(client, key);
      const loader = new Loader(client, session);
      const group = body.group as GroupState;
      const event = (): EventRequest => ({ programName: body.programName, group, masterGrid: body.masterGrid === true, row: body.row as EventRequest["row"] });
      switch (body.action) {
        case "program": return { program: await loadProgram(loader, body.programName, String(body.menuShortName ?? "")), warnings: loader.warnings, yearStart: session.tarikh1.toISOString(), yearEnd: session.tarikh2.toISOString(), coStateName: session.coStateName, coGstReq: session.coGstReq, partyAccode: session.flags.partyAccode, productCode: session.flags.productCode, logFileSpecial: session.flags.logFileSpecial, companyName: session.companyName, userName: session.loginName };
        case "group": return { load: await loadGroup(loader, body.programName, group), warnings: loader.warnings };
        case "help": return { help: await helpGrid(loader, { programName: body.programName, group, masterGrid: body.masterGrid === true }), warnings: loader.warnings };
        case "record-exist": return recordExist(loader, event());
        case "defa-against": return defaAgainst(loader, event());
        case "onchange": return { values: await onChangeReplace(loader, event()) };
        case "uom-formula": return { value: await uomFormula(loader, event(), body.coreEntry === true) };
        case "duplicate-query": return { message: await duplicateQuery(loader, event()) };
        case "check-state": return { message: await checkStateChange(loader, event(), String(body.originalState ?? "")) };
        case "state-short": return { short: await stateShortCode(loader, String(body.stateName ?? "")) };
        case "defa-fixvalue": return { value: await defaFixValue(loader, event()) };
        case "defa-add-value": return { value: await defaAddValue(loader, event()) };
        case "add-before-edit": return { value: await addGridBeforeEdit(loader, event(), body.coreEntry === true) };
        case "plywood": return { value: await plywoodConversion(loader, event(), String(body.levelField ?? "")) };
        case "delete-blocked": return { message: await deleteBlocked(loader, Number(body.programId), group, body.record as Record<string, string>, Number(body.rowIndex)) };
        case "add-save": return addSave(client, loader, { ...(body as unknown as AddSaveRequest), group });
        case "edit-save": return editSave(client, loader, { ...(body as unknown as EditSaveRequest), group });
        case "module-password": return verifyModulePassword(loader, String(body.menuShortName ?? ""), String(body.password ?? ""));
        case "product-image": return { image: await productImage(loader, Number(body.prodKey)) };
        case "master-log": return { log: await readMasterLog(loader, Number(body.programId), String(body.firstComboText ?? ""), Number(body.code)) };
        case "zoom-book": return { option: await zoomBook(loader, Number(body.book)) };
        case "cloud-push": {
          const push = body.cloud as CloudPush | undefined;
          if (!push || (push.kind !== "debtor" && push.kind !== "product") || typeof push.name !== "string") throw new Error("cloud must name a debtor or product");
          // Read here, per request: the Workers runtime fills the environment only while one runs.
          return { message: await pushToCloud(loader, push, process.env.EZEONE_API_KEY) };
        }
        default: throw new Error(`Unknown action ${body.action}`);
      }
    }, { readOnlyWork: !writes, timeoutMs: 60000 });
    return Response.json(result, { headers });
  } catch (error) {
    console.error("Master program error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "The master request failed" }, { status: 500, headers });
  }
}
