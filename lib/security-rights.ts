import type { Client } from "pg";
import type { MenuNode } from "./menu-catalog";
import { securityRead, securityWrite, toText } from "./master-program/legacy";
import { SYSTEM_SCHEMA } from "./master-program/session";
import type { MasterSession } from "./master-program/session";

/**
 * Setup > Security > Menu Book Rights (Setup_Security.cs, security entry 8).
 *
 * For one user, a row for every menu of the program (indented by depth, as the desktop's Main_Menu builds it) and every book, each with seven
 * rights - Allow, Add, Edit, Delete, View, Print, Export - and a password for each right. They are kept in smart_system.security, one row
 * for each menu or book of the user: U_MODULE is "Menu-<short name>" or "Book-<description>" and U_MODULE_ID its heading ("Menu" or "Book"),
 * both written with Security_write_pw at position 0; U_ROLL_ID is 14 characters, each right's 1 / 0 (written at the odd positions 1 to 13)
 * followed by Y / N for whether it has a password (the even positions 2 to 14); the passwords are in U_MODULE_PASS (Allow) and U_PASS_1 to
 * U_PASS_6 (Add, Edit, Delete, View, Print, Export), written at position 0. A company-wise rights set-up also keeps the company in U_CO_ID.
 * A user with no row for a menu is not stopped by it (session.ts reads them the same way).
 */

export const RIGHTS = ["Allow", "Add", "Edit", "Delete", "View", "Print", "Export"] as const;

/** The password column of each right, in the order of RIGHTS. */
const PASSWORD_COLUMNS = ["u_module_pass", "u_pass_1", "u_pass_2", "u_pass_3", "u_pass_4", "u_pass_5", "u_pass_6"] as const;

export type SecurityRow = Readonly<{
  /** "Menu" or "Book". */
  heading: string;
  /** The row's text: menus indented by four dots a level. */
  name: string;
  /** What the rights are kept under: "Menu-<short name>" or "Book-<description>". */
  module: string;
  /** The security row's key, or 0 when the user has none yet. */
  key: number;
  rights: readonly boolean[];
  /** Whether each right has a password (the passwords themselves stay on the server). */
  passwords: readonly boolean[];
}>;

export type SecurityUser = Readonly<{ name: string; no: number }>;

const SKIP = new Set(["Close", "Minimize", "Restore", "E X I T", ""]);

/** The menu rows as the desktop lists them: depth first, in menu order, indented, without the window buttons. */
export function menuRows(nodes: readonly MenuNode[], depth = 0): { name: string; module: string }[] {
  const out: { name: string; module: string }[] = [];
  for (const node of nodes) {
    const text = node.label.replace(/&/g, "").trim();
    if (SKIP.has(text)) continue;
    out.push({ name: `${".".repeat(depth * 4)}${text}`, module: `Menu-${(node.menuShortName ?? "").trim()}` });
    out.push(...menuRows(node.children, depth + 1));
  }
  return out;
}

export async function securityUsers(client: Client): Promise<SecurityUser[]> {
  const result = await client.query(`SELECT login_name, user_no FROM ${SYSTEM_SCHEMA}.user_master WHERE user_pos <> 'D' AND user_type <> 'SP' ORDER BY login_name`);
  return result.rows.map((row) => ({ name: toText(row.login_name).trim(), no: Number(row.user_no) }));
}

/** The company filter of a company-wise rights set-up. */
const companyFilter = (session: MasterSession) => (session.companyWiseRights
  ? ` AND u_co_id IS NOT NULL AND u_co_id IN (SELECT co_key FROM ${SYSTEM_SCHEMA}.company WHERE name = $2)`
  : "");

/** Every row of the grid for one user, with the rights the user already has. */
export async function loadSecurityRows(client: Client, session: MasterSession, menus: readonly MenuNode[], userNo: number): Promise<SecurityRow[]> {
  const books = (await client.query(`SELECT book_desc FROM ${session.companySchema}.book_properties WHERE stkm_pos <> 'D' ORDER BY book_key`)).rows.map((row) => toText(row.book_desc).trim());
  const list = [
    ...menuRows(menus).map((row) => ({ heading: "Menu", ...row })),
    ...books.map((book) => ({ heading: "Book", name: book, module: `Book-${book}` })),
  ];
  const params: unknown[] = [userNo];
  if (session.companyWiseRights) params.push(session.companyName);
  const saved = (await client.query(`SELECT * FROM ${SYSTEM_SCHEMA}.security WHERE u_id = $1${companyFilter(session)} ORDER BY security_key`, params)).rows;
  const byModule = new Map<string, Record<string, unknown>>();
  for (const row of saved) {
    const module = securityRead(toText(row.u_module), 0).trim().toUpperCase();
    if (module !== "" && !byModule.has(module)) byModule.set(module, row);
  }
  return list.map((entry) => {
    const row = byModule.get(entry.module.trim().toUpperCase());
    const roll = row ? toText(row.u_roll_id) : "";
    const rights = RIGHTS.map((_, at) => (roll.length > at * 2 ? securityRead(roll.charAt(at * 2), at * 2 + 1) === "1" : false));
    const passwords = PASSWORD_COLUMNS.map((column) => (row ? securityRead(toText(row[column]), 0).trim() !== "" : false));
    return { heading: entry.heading, name: entry.name, module: entry.module, key: row ? Number(row.security_key) : 0, rights, passwords };
  });
}

export type SecuritySave = Readonly<{
  userNo: number;
  /** The new user the rights are copied to (instead of being saved for `userNo`), or 0. */
  copyToNo: number;
  rows: readonly Readonly<{
    heading: string;
    module: string;
    key: number;
    rights: readonly boolean[];
    /** For each right: a new password, or "" to keep what is saved (when `keep`) or to have none. */
    typed: readonly string[];
    keep: readonly boolean[];
  }>[];
}>;

/**
 * The save (Save_Click): every row is written - updated by its key, or inserted for a user with none - and, with a copy user, inserted for
 * that user instead (refused when that user already has rights). The key of a new row is the table's highest + 1.
 */
export async function saveSecurityRows(client: Client, session: MasterSession, request: SecuritySave): Promise<{ ok: boolean; message: string }> {
  if (!Number.isInteger(request.userNo) || request.userNo <= 0) return { ok: false, message: "Select a user" };
  const copy = request.copyToNo > 0;
  if (copy) {
    const exists = await client.query(`SELECT 1 FROM ${SYSTEM_SCHEMA}.security WHERE u_id = $1 LIMIT 1`, [request.copyToNo]);
    if (exists.rows.length > 0) return { ok: false, message: "Copy New User Name Right All Ready Define" };
  }
  await client.query(`LOCK TABLE ${SYSTEM_SCHEMA}.security IN SHARE ROW EXCLUSIVE MODE`);
  let next = Number((await client.query(`SELECT COALESCE(MAX(security_key), 0) + 1 AS next FROM ${SYSTEM_SCHEMA}.security`)).rows[0].next);
  const keys = request.rows.map((row) => row.key).filter((key) => key > 0);
  const existing = new Map<number, Record<string, unknown>>();
  if (keys.length > 0) for (const row of (await client.query(`SELECT * FROM ${SYSTEM_SCHEMA}.security WHERE u_id = $1 AND security_key = ANY($2::int[])`, [request.userNo, keys])).rows) existing.set(Number(row.security_key), row);
  for (const row of request.rows) {
    if (row.rights.length !== RIGHTS.length || row.typed.length !== RIGHTS.length || row.keep.length !== RIGHTS.length) return { ok: false, message: "A row has the wrong number of rights" };
    const old = row.key > 0 ? existing.get(row.key) : undefined;
    const stored: string[] = [];
    let roll = "";
    RIGHTS.forEach((_, at) => {
      const typed = row.typed[at].trim();
      if (typed.length > 9) throw new Error("Maximum Length of Column Must be 9 Charector");
      const kept = typed === "" && row.keep[at] && old ? toText(old[PASSWORD_COLUMNS[at]]) : "";
      const value = typed !== "" ? securityWrite(typed, 0) : kept;
      stored.push(value);
      roll += securityWrite(row.rights[at] ? "1" : "0", at * 2 + 1) + securityWrite(value !== "" ? "Y" : "N", at * 2 + 2);
    });
    const moduleId = securityWrite(row.heading, 0);
    const module = securityWrite(row.module, 0);
    if (old && !copy) {
      await client.query(
        `UPDATE ${SYSTEM_SCHEMA}.security SET u_module_id = $1, u_module_pass = $2, u_pass_1 = $3, u_pass_2 = $4, u_pass_3 = $5, u_pass_4 = $6, u_pass_5 = $7, u_pass_6 = $8, u_module = $9, u_roll_id = $10 WHERE security_key = $11`,
        [moduleId, ...stored, module, roll, row.key],
      );
    } else {
      const company = session.companyWiseRights ? [session.companyKey] : [null];
      await client.query(
        `INSERT INTO ${SYSTEM_SCHEMA}.security (security_key, u_co_id, u_module_id, u_module_pass, u_pass_1, u_pass_2, u_pass_3, u_pass_4, u_pass_5, u_pass_6, u_module, u_roll_id, u_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [next, company[0], moduleId, ...stored, module, roll, copy ? request.copyToNo : request.userNo],
      );
      next += 1;
    }
  }
  return { ok: true, message: "Saved" };
}
