import { transaction } from "@/lib/db";
import { allowedMasterMenu, trustedDevelopmentEnabled } from "@/lib/master-program/access";
import { verifyModulePassword } from "@/lib/master-program/extras";
import { Loader } from "@/lib/master-program/load";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { readMenuCatalog } from "@/lib/menu-catalog";
import { bookContext, entryPreview, loadBook, loadInvoice, partyDetails, partyHelp, seriesDefaults } from "@/lib/entry/invoice";
import { productChoice, productHelp, restoreEntry } from "@/lib/entry/products";
import type { EntryOption, InvoiceDefinition } from "@/lib/entry/types";

/**
 * The entry screen's server (the desktop's Comman_Entry: Transaction > Invoice), as
 * /api/small-entry is the small entry's. Read-only for now: the screen is set up (register,
 * header, grids, party) but Save is not ported yet. The register and series are checked against
 * the lists the setup offers before they reach a query.
 */

type Body = Readonly<{ action: string; session: SessionKey; entryName: string; menuShortName?: string; firstCombo?: EntryOption } & Record<string, unknown>>;

const NAME = /^[A-Za-z0-9_]{1,64}$/;
const headers = { "cache-control": "no-store" };

function chosenRegister(def: InvoiceDefinition, chosen: EntryOption | undefined): EntryOption {
  const option = def.firstCombo.options.find((candidate) => candidate.text === chosen?.text && candidate.value === chosen?.value);
  if (!option) throw new Error(`Choose a ${def.firstCombo.label} entry from its list`);
  return option;
}

export async function POST(request: Request) {
  if (!trustedDevelopmentEnabled(process.env.SMARTWINFA_TRUSTED_LOCAL_MODE)) {
    return Response.json({ error: "Entry migration is disabled until authenticated sessions are implemented. SMARTWINFA_TRUSTED_LOCAL_MODE=true is for isolated development with disposable data only." }, { status: 503, headers });
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

  try {
    const result = await transaction(async (client) => {
      const session = await readSession(client, key);
      if (!allowedMasterMenu(await readMenuCatalog(session.companyGroup), body.entryName, moduleName, "ENTRY")) {
        throw new Error("The requested entry and module are not in this company's visible menu");
      }
      const loader = new Loader(client, session);
      const def = await loadInvoice(loader, body.entryName, moduleName);
      switch (body.action) {
        case "entry":
          return { entry: def, warnings: loader.warnings, companyName: session.companyName, userName: session.loginName, yearStart: session.tarikh1.toISOString(), yearEnd: session.tarikh2.toISOString() };
        case "module-password":
          return verifyModulePassword(loader, moduleName, String(body.password ?? ""));
        case "book": {
          const group = body.taxGroup === "G" || body.taxGroup === "I" || body.taxGroup === "V" ? body.taxGroup : undefined;
          const book = await loadBook(loader, body.entryName, chosenRegister(def, body.firstCombo), group);
          return { book, warnings: loader.warnings };
        }
        case "series": {
          const register = chosenRegister(def, body.firstCombo);
          const book = await bookContext(loader, body.entryName, register);
          return { defaults: await seriesDefaults(loader, body.entryName, book, String(body.series ?? "").slice(0, 40)), warnings: loader.warnings };
        }
        case "party-help":
          return { help: await partyHelp(loader, body.entryName, chosenRegister(def, body.firstCombo), String(body.partyBooks ?? "").replace(/[^0-9,() ]/g, "")), warnings: loader.warnings };
        case "party": {
          const code = Number(body.code);
          if (!Number.isInteger(code) || code <= 0) throw new Error("Choose a party from the help list");
          return { party: await partyDetails(loader, body.entryName, chosenRegister(def, body.firstCombo), code, String(body.date ?? "").slice(0, 20)), warnings: loader.warnings };
        }
        case "product-help":
          return { help: await productHelp(loader, body.entryName, chosenRegister(def, body.firstCombo)), warnings: loader.warnings };
        case "product": {
          const prodKey = Number(body.prodKey);
          if (!Number.isInteger(prodKey) || prodKey <= 0) throw new Error("Choose a product from the help list");
          const acCode = Number.isInteger(Number(body.acCode)) ? Number(body.acCode) : 0;
          return { product: await productChoice(loader, body.entryName, chosenRegister(def, body.firstCombo), prodKey, acCode, String(body.date ?? "").slice(0, 20)), warnings: loader.warnings };
        }
        case "restore": {
          const uniqueKey = Number(body.uniqueKey);
          if (!Number.isInteger(uniqueKey) || uniqueKey <= 0) throw new Error("Choose an entry from the Find / Edit list");
          return { entry: await restoreEntry(loader, body.entryName, chosenRegister(def, body.firstCombo), uniqueKey), warnings: loader.warnings };
        }
        case "preview":
          return { preview: await entryPreview(loader, body.entryName, chosenRegister(def, body.firstCombo), String(body.series ?? "").slice(0, 40)), warnings: loader.warnings };
        default:
          throw new Error(`Unknown action ${body.action}`);
      }
    }, { readOnlyWork: true, timeoutMs: 60000 });
    return Response.json(result, { headers });
  } catch (error) {
    console.error("Entry error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "The entry request failed" }, { status: 500, headers });
  }
}
