import { transaction } from "@/lib/db";
import { allowedMasterMenu, trustedDevelopmentEnabled } from "@/lib/master-program/access";
import { verifyModulePassword } from "@/lib/master-program/extras";
import { Loader } from "@/lib/master-program/load";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { readMenuCatalog } from "@/lib/menu-catalog";
import { loadEntry, loadEntryGrid } from "@/lib/small-entry/load";
import { saveEntry } from "@/lib/small-entry/save";
import type { EditedRow, EntryDefinition, EntryOption, EntryState } from "@/lib/small-entry/types";

/**
 * The generic small-entry screen's server, as /api/master-program is the master screen's.
 * Header choices are checked against the options the setup offers before any of them reaches
 * a query, so the browser can only pick what the desktop would have listed.
 */

type Body = Readonly<{ action: string; session: SessionKey; entryName: string; menuShortName?: string; state?: EntryState; rows?: EditedRow[]; dryRun?: boolean } & Record<string, unknown>>;

const NAME = /^[A-Za-z0-9_]{1,64}$/;
const headers = { "cache-control": "no-store" };

/** The header as chosen, reduced to options the definition lists; and each control's option. */
function checkedState(def: EntryDefinition, state: EntryState | undefined): { state: EntryState; choices: Record<string, EntryOption> } {
  const chosenFirst = state?.firstCombo ?? null;
  const firstCombo = def.firstCombo ? def.firstCombo.options.find((option) => option.text === chosenFirst?.text && option.value === chosenFirst?.value) ?? null : null;
  if (def.firstCombo && !firstCombo) throw new Error(`Choose a ${def.firstCombo.label || "first combo"} entry from its list`);
  const controls: Record<string, string> = {};
  const choices: Record<string, EntryOption> = {};
  for (const control of def.controls) {
    const value = String(state?.controls?.[control.name] ?? control.initial);
    if (control.type === "LB") {
      const option = control.options.find((candidate) => candidate.text === value);
      if (!option) throw new Error(`Choose a ${control.label} entry from its list`);
      choices[control.name] = option;
    }
    controls[control.name] = value.slice(0, 200);
  }
  return { state: { firstCombo, controls }, choices };
}

export async function POST(request: Request) {
  if (!trustedDevelopmentEnabled(process.env.SMARTWINFA_TRUSTED_LOCAL_MODE)) {
    return Response.json({ error: "Small entry migration is disabled until authenticated sessions are implemented. SMARTWINFA_TRUSTED_LOCAL_MODE=true is for isolated development with disposable data only." }, { status: 503, headers });
  }
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  if (!body || typeof body.action !== "string" || !body.session || !NAME.test(String(body.entryName ?? ""))) {
    return Response.json({ error: "action, session and entryName are required" }, { status: 400, headers });
  }
  const key: SessionKey = { companyId: Number(body.session.companyId), yearKey: Number(body.session.yearKey), loginName: String(body.session.loginName ?? "") };
  const moduleName = String(body.menuShortName ?? "");
  const writes = body.action === "save";

  try {
    const result = await transaction(async (client) => {
      const session = await readSession(client, key);
      if (!allowedMasterMenu(await readMenuCatalog(session.companyGroup), body.entryName, moduleName, "SMALL_ENTRY")) {
        throw new Error("The requested small entry and module are not in this company's visible menu");
      }
      const loader = new Loader(client, session);
      switch (body.action) {
        case "entry": {
          const entry = await loadEntry(loader, body.entryName, moduleName);
          return { entry, warnings: loader.warnings, companyName: session.companyName, userName: session.loginName, yearStart: session.tarikh1.toISOString() };
        }
        case "grid": {
          const def = await loadEntry(loader, body.entryName, moduleName);
          const { state, choices } = checkedState(def, body.state);
          return { grid: await loadEntryGrid(loader, body.entryName, state, choices) };
        }
        case "save": {
          const def = await loadEntry(loader, body.entryName, moduleName);
          const { state, choices } = checkedState(def, body.state);
          const rows = Array.isArray(body.rows) ? body.rows.map((row) => ({ values: Object.fromEntries(Object.entries(row?.values ?? {}).map(([name, value]) => [String(name), String(value ?? "")])), deleted: row?.deleted === true })) : [];
          return saveEntry(loader, { entryName: body.entryName, menuShortName: moduleName, state, choices, rows, dryRun: body.dryRun === true, editPassword: typeof body.editPassword === "string" ? body.editPassword : undefined });
        }
        case "module-password": return verifyModulePassword(loader, moduleName, String(body.password ?? ""));
        default: throw new Error(`Unknown action ${body.action}`);
      }
    }, { readOnlyWork: !writes, timeoutMs: 60000 });
    return Response.json(result, { headers });
  } catch (error) {
    console.error("Small entry error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "The small entry request failed" }, { status: 500, headers });
  }
}
