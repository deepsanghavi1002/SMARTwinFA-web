import { transaction } from "@/lib/db";
import { allowedMasterMenu, trustedDevelopmentEnabled } from "@/lib/master-program/access";
import { verifyModulePassword } from "@/lib/master-program/extras";
import { Loader } from "@/lib/master-program/load";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { readMenuCatalog } from "@/lib/menu-catalog";
import { bookContext, entryPreview, loadBook, loadInvoice, partyDetails, partyHelp, returnsChoices, seriesDefaults } from "@/lib/entry/invoice";
import { headerProblems } from "@/lib/entry/checks";
import { entryLog } from "@/lib/entry/log";
import { entryAll } from "@/lib/entry/all";
import { entryBill } from "@/lib/entry/bill";
import { masterDetails } from "@/lib/entry/details";
import { accountLedger } from "@/lib/entry/ledger";
import { isLinkRegister, linkEntries, linkLines } from "@/lib/entry/link";
import { partyStock } from "@/lib/entry/partyStock";
import { buildDelete, buildSave, runPlan } from "@/lib/entry/save";
import { tdsInfo } from "@/lib/entry/tds";
import type { SaveInput, SaveReport } from "@/lib/entry/save";
import type { HeaderField } from "@/lib/entry/checks";
import { deleteDocuments, documentFile, listDocuments, saveDocuments } from "@/lib/entry/documents";
import type { DocumentInput } from "@/lib/entry/documents";
import { partyProductKeys, productChoice, productHelp, restoreEntry, zoomRegister } from "@/lib/entry/products";
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
  // A debit / credit note's Returns panel choice travels with the register.
  const against = chosen?.against;
  if (against && Number.isInteger(against.code) && against.code > 0 && Number.isInteger(against.nature) && against.nature >= 0) return { ...option, against: { code: against.code, nature: against.nature } };
  return option;
}

/** Thrown after a dry run's report is made, so its transaction rolls back. */
class DryRun extends Error {
  constructor(readonly report: SaveReport) { super("dry run"); }
}

/**
 * Save for a new account-book invoice. The plan is always run inside a transaction; it is committed only when the
 * request asks (commit: true) AND the server allows it (SMARTWINFA_ENTRY_SAVE_COMMIT=true). Otherwise the rows are
 * numbered, written and read back, and everything is rolled back: the answer says what a save would have written.
 */
async function saveEntry(body: Body, key: SessionKey, moduleName: string) {
  const wantsCommit = body.commit === true;
  const allowed = process.env.SMARTWINFA_ENTRY_SAVE_COMMIT === "true";
  const commit = wantsCommit && allowed;
  try {
    const report = await transaction(async (client) => {
      const session = await readSession(client, key);
      if (!allowedMasterMenu(await readMenuCatalog(session.companyGroup), body.entryName, moduleName, "ENTRY")) {
        throw new Error("The requested entry and module are not in this company's visible menu");
      }
      await client.query("SET LOCAL lock_timeout = '5s'");
      const loader = new Loader(client, session);
      const def = await loadInvoice(loader, body.entryName, moduleName);
      const input = body.save as SaveInput | undefined;
      const changing = Number(input?.editKey ?? 0) > 0;
      if (def.rights.restricted && !changing && !def.rights.add) throw new Error("Invoice Entry Add Rights Not Available For User");
      if (def.rights.restricted && changing && !def.rights.edit) throw new Error("Invoice Entry Edit Rights Not Available For User");
      if (!input || typeof input !== "object") throw new Error("The entry to save is missing");
      // One save at a time, taken before the number is checked: a save waiting here then sees what the one before it committed.
      if (commit) await client.query("SELECT pg_advisory_xact_lock(hashtext('smartwinfa-entry-save'))");
      const plan = await buildSave(loader, body.entryName, chosenRegister(def, body.firstCombo), input);
      const result = await runPlan(client, loader, plan, { commit });
      if (!commit) throw new DryRun(result);
      return result;
    }, { timeoutMs: 60000 });
    return Response.json({ report, committed: true }, { headers });
  } catch (error) {
    if (error instanceof DryRun) return Response.json({ report: error.report, committed: false, commitDisabled: wantsCommit && !allowed }, { headers });
    console.error("Entry save error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "The entry could not be saved" }, { status: 500, headers });
  }
}

/** Upload Document: the window's rows applied to an opened (or just saved) entry; written only under the same condition as a save. */
async function saveDocumentsAction(body: Body, key: SessionKey, moduleName: string) {
  const allowed = process.env.SMARTWINFA_ENTRY_SAVE_COMMIT === "true";
  try {
    const result = await transaction(async (client) => {
      const session = await readSession(client, key);
      if (!allowedMasterMenu(await readMenuCatalog(session.companyGroup), body.entryName, moduleName, "ENTRY")) {
        throw new Error("The requested entry and module are not in this company's visible menu");
      }
      const loader = new Loader(client, session);
      const def = await loadInvoice(loader, body.entryName, moduleName);
      if (def.rights.restricted && !def.rights.edit) throw new Error("Invoice Entry Edit Rights Not Available For User");
      const docs = Array.isArray(body.documents) ? (body.documents as DocumentInput[]) : [];
      const counts = await saveDocuments(client, loader, body.entryName, chosenRegister(def, body.firstCombo), Number(body.uniqueKey), docs);
      if (!allowed) throw new DocumentDryRun(counts);
      return counts;
    }, { timeoutMs: 60000 });
    return Response.json({ saved: result, committed: true }, { headers });
  } catch (error) {
    if (error instanceof DocumentDryRun) return Response.json({ saved: error.counts, committed: false }, { headers });
    console.error("Entry documents error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "The documents could not be saved" }, { status: 500, headers });
  }
}

class DocumentDryRun extends Error {
  constructor(readonly counts: { inserted: number; updated: number; deleted: number }) { super("dry run"); }
}

/** Delete of a saved invoice; committed under the same two conditions as saveEntry. */
async function deleteEntry(body: Body, key: SessionKey, moduleName: string) {
  const wantsCommit = body.commit === true;
  const allowed = process.env.SMARTWINFA_ENTRY_SAVE_COMMIT === "true";
  const commit = wantsCommit && allowed;
  try {
    const report = await transaction(async (client) => {
      const session = await readSession(client, key);
      if (!allowedMasterMenu(await readMenuCatalog(session.companyGroup), body.entryName, moduleName, "ENTRY")) {
        throw new Error("The requested entry and module are not in this company's visible menu");
      }
      await client.query("SET LOCAL lock_timeout = '5s'");
      const loader = new Loader(client, session);
      const def = await loadInvoice(loader, body.entryName, moduleName);
      if (def.rights.restricted && !def.rights.delete) throw new Error("Invoice Entry Delete Rights Not Available For User");
      const uniqueKey = Number(body.uniqueKey);
      if (!Number.isInteger(uniqueKey) || uniqueKey <= 0) throw new Error("Open the invoice to delete from Find / Edit");
      const plan = await buildDelete(loader, body.entryName, chosenRegister(def, body.firstCombo), uniqueKey);
      const result = await runPlan(client, loader, plan, { commit });
      if (!commit) throw new DryRun(result);
      await deleteDocuments(client, loader, body.entryName, chosenRegister(def, body.firstCombo), uniqueKey);
      return result;
    }, { timeoutMs: 60000 });
    return Response.json({ report, committed: true }, { headers });
  } catch (error) {
    if (error instanceof DryRun) return Response.json({ report: error.report, committed: false, commitDisabled: wantsCommit && !allowed }, { headers });
    console.error("Entry delete error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "The entry could not be deleted" }, { status: 500, headers });
  }
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
  if (body.action === "save") return saveEntry(body, key, moduleName);
  if (body.action === "delete") return deleteEntry(body, key, moduleName);
  if (body.action === "doc-save") return saveDocumentsAction(body, key, moduleName);

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
          const register = chosenRegister(def, body.firstCombo);
          // A debit / credit note asks what it is against (the Returns panel) before its slab can be filled.
          if (!register.against && (await bookContext(loader, body.entryName, register)).entryFor === "DrCr") return { asksAgainst: true, warnings: loader.warnings };
          const book = await loadBook(loader, body.entryName, register, group);
          return { book: { ...book, link: isLinkRegister(loader, register) }, warnings: loader.warnings };
        }
        case "returns":
          return { returns: await returnsChoices(loader, body.entryName, chosenRegister(def, body.firstCombo)), warnings: loader.warnings };
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
          return { party: await partyDetails(loader, body.entryName, chosenRegister(def, body.firstCombo), code, String(body.date ?? "").slice(0, 20), Number.isInteger(Number(body.addressId)) ? Number(body.addressId) : 0, Number.isInteger(Number(body.editKey)) ? Number(body.editKey) : 0), warnings: loader.warnings };
        }
        case "doc-list":
          return { documents: await listDocuments(loader, body.entryName, chosenRegister(def, body.firstCombo), Number(body.uniqueKey)), warnings: loader.warnings };
        case "doc-file":
          return { file: await documentFile(loader, body.entryName, chosenRegister(def, body.firstCombo), Number(body.uniqueKey), Number(body.key)), warnings: loader.warnings };
        case "tds": {
          const code = Number(body.code);
          if (!Number.isInteger(code) || code <= 0) throw new Error("Choose a party from the help list");
          return { tds: await tdsInfo(loader, body.entryName, chosenRegister(def, body.firstCombo), code), warnings: loader.warnings };
        }
        case "party-products": {
          const code = Number(body.code);
          if (!Number.isInteger(code) || code <= 0) throw new Error("Choose a party first");
          return { keys: await partyProductKeys(loader, code), warnings: loader.warnings };
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
        case "link-entries": return { list: await linkEntries(loader, body.entryName, chosenRegister(def, body.firstCombo)), warnings: loader.warnings };
        case "link-lines": return { list: await linkLines(loader, body.entryName, chosenRegister(def, body.firstCombo), (Array.isArray(body.processKeys) ? body.processKeys : []).map(Number)), warnings: loader.warnings };
        case "link-restore": {
          const processKeys = (Array.isArray(body.processKeys) ? body.processKeys : []).map(Number).filter((key: number) => Number.isInteger(key) && key > 0);
          if (processKeys.length === 0) throw new Error("Tick an entry first");
          const ilKeys = (Array.isArray(body.ilKeys) ? body.ilKeys : []).map(Number).filter((key: number) => Number.isInteger(key) && key > 0);
          return { entry: await restoreEntry(loader, body.entryName, chosenRegister(def, body.firstCombo), 0, { processKeys, ilKeys }), warnings: loader.warnings };
        }
        case "zoom": {
          const ledKey = Number(body.ledKey);
          if (!Number.isInteger(ledKey) || ledKey <= 0) throw new Error("Choose a voucher row");
          return { zoom: await zoomRegister(loader, def.firstCombo.options, ledKey), warnings: loader.warnings };
        }
        case "check": {
          const fieldName = String(body.field ?? "") as HeaderField;
          if (!["date", "number", "chlnno", "entryno", "party"].includes(fieldName)) throw new Error("Unknown header box");
          const register = chosenRegister(def, body.firstCombo);
          const book = await bookContext(loader, body.entryName, register);
          const clip = (value: unknown, size = 40) => String(value ?? "").slice(0, size);
          const party = body.party as Record<string, unknown> | undefined;
          const problems = await headerProblems(loader, body.entryName, book, {
            field: fieldName, registerText: register.text, series: clip(body.series), date: clip(body.date, 20), number: clip(body.number), chlnNo: clip(body.chlnNo), entryNo: clip(body.entryNo),
            editKey: Number.isInteger(Number(body.editKey)) ? Number(body.editKey) : 0, editDate: clip(body.editDate, 20), taxGroup: clip(body.taxGroup, 1),
            voucher: body.voucher ? { rows: Number((body.voucher as Record<string, unknown>).rows) || 1, sideDbcode: Number((body.voucher as Record<string, unknown>).sideDbcode) || 1, bookName: clip((body.voucher as Record<string, unknown>).bookName, 100) } : undefined,
            party: party ? { code: Number(party.code) || 0, name: clip(party.name, 100), book: Number(party.book) || 0, closing: clip(party.closing, 30), limit: clip(party.limit, 30), message: clip(party.message, 500), startDate: clip(party.startDate, 20), lastDate: clip(party.lastDate, 20) } : undefined,
          });
          return { problems, warnings: loader.warnings };
        }
        case "master-details": {
          const key = Number(body.key);
          if (!Number.isInteger(key) || key <= 0 || (body.kind !== "account" && body.kind !== "product")) throw new Error("Choose an account or a product row");
          return { details: await masterDetails(loader, body.kind, key), warnings: loader.warnings };
        }
        case "party-stock": {
          const code = Number(body.code ?? 0);
          const prodKey = Number(body.prodKey ?? 0);
          if (!Number.isInteger(code) || code < 0 || !Number.isInteger(prodKey) || prodKey < 0 || (code === 0 && prodKey === 0)) throw new Error("Choose an account or a product row");
          return { stock: await partyStock(loader, code, prodKey, typeof body.date === "string" ? body.date : ""), warnings: loader.warnings };
        }
        case "ledger": {
          const code = Number(body.code);
          if (!Number.isInteger(code) || code <= 0) throw new Error("Choose an account row");
          return { ledger: await accountLedger(loader, code), warnings: loader.warnings };
        }
        case "log": {
          const uniqueKey = Number(body.uniqueKey);
          if (!Number.isInteger(uniqueKey) || uniqueKey <= 0) throw new Error("Open the entry from Find / Edit to see its log");
          return { log: await entryLog(loader, body.entryName, chosenRegister(def, body.firstCombo), uniqueKey), warnings: loader.warnings };
        }
        case "preview":
          return { preview: await entryPreview(loader, body.entryName, chosenRegister(def, body.firstCombo), String(body.series ?? "").slice(0, 40)), warnings: loader.warnings };
        case "bill": {
          // The standard bill of a saved entry (print preview).
          const uniqueKey = Number(body.uniqueKey);
          if (!Number.isInteger(uniqueKey) || uniqueKey <= 0) throw new Error("Open the entry first");
          return { bill: await entryBill(loader, body.entryName, chosenRegister(def, body.firstCombo), uniqueKey), warnings: loader.warnings };
        }
        case "preview-all":
          // Find / Edit with every field of each entry: read only when the operator asks for it.
          return { preview: await entryAll(loader, body.entryName, chosenRegister(def, body.firstCombo), String(body.series ?? "").slice(0, 40), body.withProducts !== false), warnings: loader.warnings };
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
