import type { Client } from "pg";
import { securityRead, securityWrite, toText } from "../master-program/legacy";
import { SYSTEM_SCHEMA, readRights } from "../master-program/session";
import type { MasterSession } from "../master-program/session";

/**
 * Per-user rights for the Payroll screens, from the same Menu Book Rights the rest of the program uses (Setup > Security > Menu Book Rights,
 * smart_system.security, one row per user and menu "Menu-<short name>"): Allow, Add, Edit, Delete, View, Print, Export, and the module / add / edit /
 * delete passwords. As everywhere else, an operator with no security rows at all, or no row for the menu, is not limited, and an AD user has every right
 * (a password kept on the module still applies).
 *
 * The server enforces Allow, View, Add, Edit and Delete and the module / add / edit / delete passwords on every call. Print and Export are handed to the
 * screen, which switches those buttons off: the data a report shows is the data View already allows, so the server cannot tell an export from a view.
 * View, Print and Export passwords are not asked for (no screen of this program asks them).
 */

export type Need = "view" | "add" | "edit" | "delete";

export type PayrollRights = Readonly<{
  allow: boolean; view: boolean; add: boolean; edit: boolean; delete: boolean; print: boolean; export: boolean;
  modulePassword: string; addPassword: string; editPassword: string; deletePassword: string;
}>;

/** What a screen is told: the rights, never the passwords. */
export function publicRights(rights: PayrollRights) {
  return { view: rights.view, add: rights.add, edit: rights.edit, delete: rights.delete, print: rights.print, export: rights.export };
}

/** A refusal. `needs` names the password the screen should ask for and send again; absent, there is nothing to ask. */
export class RightsError extends Error {
  constructor(message: string, readonly needs?: "module-password" | "add-password" | "edit-password" | "delete-password") { super(message); }
}

export async function readPayrollRights(client: Client, session: MasterSession, menuShortName: string): Promise<PayrollRights> {
  const moduleName = `Menu-${menuShortName}`;
  const base = await readRights(client, session, moduleName);
  const admin = session.userType.trim().toUpperCase() === "AD";
  // View (position 8), Print (10) and Export (12) are not in readRights: read them from the same u_roll_id, as Report_Combine does.
  const params: unknown[] = [session.userNo, securityWrite(moduleName, 0)];
  let companyFilter = "";
  if (session.companyWiseRights) {
    params.push(session.companyName);
    companyFilter = `AND u_co_id IN (SELECT co_key FROM ${SYSTEM_SCHEMA}.company WHERE name = $3)`;
  }
  const row = (await client.query(`SELECT u_roll_id FROM ${SYSTEM_SCHEMA}.security WHERE u_id = $1 AND u_module = $2 ${companyFilter} ORDER BY security_key LIMIT 1`, params)).rows[0];
  const at = (position: number) => {
    if (admin || !row) return true;
    const roll = toText(row.u_roll_id);
    return roll.length > position ? securityRead(roll.charAt(position), position + 1) === "1" : true;
  };
  return {
    allow: base.entry, view: at(8), add: base.add, edit: base.edit, delete: base.delete, print: at(10), export: at(12),
    modulePassword: base.modulePassword, addPassword: base.addPassword, editPassword: base.editPassword, deletePassword: base.deletePassword,
  };
}

const LABEL: Readonly<Record<Need, string>> = { view: "View", add: "Add", edit: "Edit", delete: "Delete" };

/**
 * Throws when the operator may not do what the call needs: no Allow right, no right of the kind, a module password not typed, or the add / edit /
 * delete password of the action not typed. A wrong password is refused the same way as a missing one, so the screen asks again.
 */
export function demandRight(rights: PayrollRights, need: Need, screenTitle: string, typed: { module?: unknown; action?: unknown }) {
  if (!rights.allow) throw new RightsError(`${screenTitle} Rights Not Available For User`);
  if (!rights[need]) throw new RightsError(`${screenTitle} ${LABEL[need]} Rights Not Available For User`);
  const given = (value: unknown) => (typeof value === "string" ? value : "");
  if (rights.modulePassword !== "" && given(typed.module) !== rights.modulePassword) {
    throw new RightsError(given(typed.module) === "" ? "Module password required" : "Incorrect Password... Enter Again", "module-password");
  }
  const password = need === "add" ? rights.addPassword : need === "edit" ? rights.editPassword : need === "delete" ? rights.deletePassword : "";
  if (password !== "" && given(typed.action) !== password) {
    throw new RightsError(given(typed.action) === "" ? `${LABEL[need]} password required` : "Incorrect Password... Enter Again", `${need as "add" | "edit" | "delete"}-password`);
  }
}

/** The right each action needs. Reads need View; a change needs Add (something new), Edit (something that exists) or Delete (something taken away). */
export async function neededRight(client: Client, screen: string, action: string, input: Record<string, unknown>): Promise<Need> {
  const key = `${screen}.${action}`;
  switch (key) {
    case "setup.save": case "attendance.save": case "process.process": case "process.lock": case "process.unlock": return "edit";
    case "attendance.open": case "process.open": case "tagging.tag": case "journal.map": case "journal.post": return "add";
    case "tagging.untag": case "journal.release": return "delete";
    case "components.save": return input.id === undefined || input.id === null ? "add" : "edit";
    case "outstanding.saveLoan": return input.id === undefined || input.id === null ? "add" : "edit";
    case "staff.save": {
      const code = Number(input.code);
      const exists = Number.isInteger(code) && (await client.query("SELECT 1 FROM pay_staff_profile WHERE code = $1", [code])).rowCount !== 0;
      return exists ? "edit" : "add";
    }
    default: return "view";
  }
}
