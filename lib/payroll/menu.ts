/**
 * The Payroll menu rows, added to smart_setup.menumaster (one table shared by every company and by the desktop) as the last top-level menu.
 *
 * The rows are always in menumaster once scripts/payroll-setup.mts has run; the web menu shows them only for a company whose
 * smart_system.setup.menu_para holds "PAYROLL," (lib/menu-catalog.ts). Rows are found by menushortname, so running the script again adds nothing.
 */

export const PAYROLL_TOP_SHORT_NAME = "MENU_PAYROLL";

/** A menu row whose short name is one of these belongs to Payroll and is hidden until the module is switched on. */
export function isPayrollMenuRow(shortName: string | null | undefined): boolean {
  const name = (shortName ?? "").trim().toUpperCase();
  return name === PAYROLL_TOP_SHORT_NAME || name.startsWith("PAY_");
}

export type PayrollMenuRow = Readonly<{ text: string; actionCode: string | null; shortName: string; parent: string | null }>;

/** In menu order. `parent` is the short name of the row above it (null: a top-level menu). */
export const PAYROLL_MENU: readonly PayrollMenuRow[] = [
  { text: "&PAYROLL", actionCode: null, shortName: PAYROLL_TOP_SHORT_NAME, parent: null },
  { text: "&Payroll Setup", actionCode: "PAYROLL_SETUP", shortName: "PAY_SETUP", parent: PAYROLL_TOP_SHORT_NAME },
  { text: "Pay &Components", actionCode: "PAYROLL_COMPONENTS", shortName: "PAY_COMPONENTS", parent: PAYROLL_TOP_SHORT_NAME },
  { text: "&Staff Payroll Profile", actionCode: "PAYROLL_STAFF", shortName: "PAY_STAFF", parent: PAYROLL_TOP_SHORT_NAME },
  { text: "&Attendance", actionCode: "PAYROLL_ATTENDANCE", shortName: "PAY_ATTENDANCE", parent: PAYROLL_TOP_SHORT_NAME },
  { text: "Pro&cess Payroll", actionCode: "PAYROLL_PROCESS", shortName: "PAY_PROCESS", parent: PAYROLL_TOP_SHORT_NAME },
  { text: "Salary &Register", actionCode: "PAYROLL_REGISTER", shortName: "PAY_REGISTER", parent: PAYROLL_TOP_SHORT_NAME },
  { text: "Pay&slip", actionCode: "PAYROLL_PAYSLIP", shortName: "PAY_PAYSLIP", parent: PAYROLL_TOP_SHORT_NAME },
  { text: "Voucher &Tagging", actionCode: "PAYROLL_TAGGING", shortName: "PAY_TAGGING", parent: PAYROLL_TOP_SHORT_NAME },
  { text: "Pen&ding Salary", actionCode: "PAYROLL_PENDING", shortName: "PAY_PENDING", parent: PAYROLL_TOP_SHORT_NAME },
  { text: "Salary &Journal", actionCode: "PAYROLL_JOURNAL", shortName: "PAY_JOURNAL", parent: PAYROLL_TOP_SHORT_NAME },
  { text: "Advance and &Loans", actionCode: "PAYROLL_OUTSTANDING", shortName: "PAY_OUTSTANDING", parent: PAYROLL_TOP_SHORT_NAME },
  { text: "&Bank Transfer Sheet", actionCode: "PAYROLL_BANKSHEET", shortName: "PAY_BANKSHEET", parent: PAYROLL_TOP_SHORT_NAME },
  { text: "PF / ESI / &PT Statement", actionCode: "PAYROLL_STATUTORY", shortName: "PAY_STATUTORY", parent: PAYROLL_TOP_SHORT_NAME },
  { text: "&Untagged Vouchers", actionCode: "PAYROLL_UNTAGGED", shortName: "PAY_UNTAGGED", parent: PAYROLL_TOP_SHORT_NAME },
];

type Query = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** Adds the rows menumaster lacks. Call inside a transaction. Returns the short names added. */
export async function applyPayrollMenu(client: Query, setupSchema = "smart_setup"): Promise<string[]> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(setupSchema)) throw new Error("The setup schema name is not valid");
  const table = `${setupSchema}.menumaster`;
  const existing = await client.query(`SELECT menuid, menushortname FROM ${table} WHERE menushortname = ANY($1)`, [PAYROLL_MENU.map((row) => row.shortName)]);
  const idOf = new Map(existing.rows.map((row) => [String(row.menushortname), Number(row.menuid)]));
  const added: string[] = [];
  for (const row of PAYROLL_MENU) {
    if (idOf.has(row.shortName)) continue;
    const next = (await client.query(`SELECT COALESCE(MAX(menuid), 0) + 1 AS id FROM ${table}`)).rows[0];
    const menuId = Number(next.id);
    await client.query(
      `INSERT INTO ${table} (menuid, parentid, menutext, actioncode, actionmenu, menushortname, menuhide, menuvisible, menuspecial, menudisplay)
       VALUES ($1, $2, $3, $4, $4, $5, '', '', false, false)`,
      [menuId, row.parent ? idOf.get(row.parent) ?? null : null, row.text, row.actionCode, row.shortName],
    );
    idOf.set(row.shortName, menuId);
    added.push(row.shortName);
  }
  return added;
}
