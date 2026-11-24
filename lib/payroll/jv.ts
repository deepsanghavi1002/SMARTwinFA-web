import type { Client } from "pg";
import { Loader } from "../master-program/load";
import { formatDesktopDate } from "../master-program/legacy";
import type { MasterSession } from "../master-program/session";
import { bookContext, loadBook, loadInvoice, seriesDefaults } from "../entry/invoice";
import { buildSave, runPlan } from "../entry/save";
import type { VoucherSaveInput } from "../entry/save";
import type { EntryOption } from "../entry/types";
import type { MenuNode } from "../menu-catalog";
import { getSetup } from "./service";
import { staffLines, tagLine, untag } from "./tag";

/**
 * Payroll Phase 4: how the salary gets into the staff ledgers. Two ways, chosen in Payroll Setup (A, B or both):
 *
 *  B - Map: the accountant already posted the salary journal. A credit line of the staff ledger is mapped to the slip: payroll adds a "salary credit" tag
 *      for the period (Phase 3) and links the line to the slip. Nothing is written to the accounts.
 *  A - Create: payroll makes one journal for the month through the program's own voucher save (lib/entry/save.ts, the same code as Transaction > Voucher):
 *      debit the salary expense account, credit each staff ledger with the slip's net. It is first run as a dry run that rolls back and shows the voucher;
 *      it is written only when the server allows entry saves (SMARTWINFA_ENTRY_SAVE_COMMIT=true, the same switch as the entry screens) and the person confirms.
 *
 * Either way each slip then carries the voucher line (pay_slip.jv_led_key), and a slip that has one is no longer re-processed.
 */

const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));
const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());
const cents = (value: number) => Math.round(value * 100) / 100;
function fail(message: string): never { throw new Error(message); }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The voucher entry's program name and the menu name it is found under. */
const VOUCHER = "VOUCHER";

export const postingAllowed = () => process.env.SMARTWINFA_ENTRY_SAVE_COMMIT === "true";

export type SlipJournal = Readonly<{
  slipId: number; code: number; name: string; net: number;
  /** Salary credit tagged for this staff member and period. */
  credited: number; jvLedKey: number | null; jvMode: "A" | "B" | null; jvDoc: string;
}>;

export async function journalStatus(client: Client, periodId: number) {
  const period = (await client.query("SELECT * FROM pay_period WHERE period_id = $1", [periodId])).rows[0] ?? fail("The pay period does not exist");
  const rows = (await client.query(
    `SELECT s.slip_id, s.code, a.name, s.net_payable, s.jv_led_key, s.jv_mode, s.jv_doc,
            COALESCE((SELECT SUM(t.amount) FROM pay_voucher_tag t WHERE t.code = s.code AND t.period_id = s.period_id AND t.tag_type = 'SAL' AND NOT t.reversed), 0) AS credited
       FROM pay_slip s JOIN account a ON a.code = s.code WHERE s.period_id = $1 ORDER BY a.name`,
    [periodId],
  )).rows;
  const { setup, salaryExpName } = await getSetup(client);
  return {
    period: { id: num(period.period_id), year: num(period.pay_year), month: num(period.pay_month), status: text(period.status) as "O" | "P" | "L" },
    mode: setup.jvMode, salaryExpCode: setup.salaryExpCode, salaryExpName, canPost: postingAllowed(),
    slips: rows.map((row): SlipJournal => ({
      slipId: num(row.slip_id), code: num(row.code), name: text(row.name), net: num(row.net_payable), credited: cents(num(row.credited)),
      jvLedKey: row.jv_led_key === null ? null : num(row.jv_led_key), jvMode: row.jv_mode ? (text(row.jv_mode) as "A" | "B") : null, jvDoc: text(row.jv_doc),
    })),
  };
}

/* ------------------------------------------------------------------ B: map */

/** The credit lines of the slip's staff ledger with something left to tag, journals first: the candidates for the salary credit. */
export async function candidates(client: Client, session: MasterSession, slipId: number) {
  const slip = (await client.query("SELECT code, net_payable, period_id FROM pay_slip WHERE slip_id = $1", [slipId])).rows[0] ?? fail("The slip does not exist");
  const view = await staffLines(client, session, num(slip.code));
  const lines = view.lines.filter((l) => l.side === "Cr" && l.untagged > 0).sort((a, b) => Number(b.bookNo === 19) - Number(a.bookNo === 19) || a.date.localeCompare(b.date));
  return { net: num(slip.net_payable), lines };
}

export async function mapJournal(client: Client, session: MasterSession, operator: string, input: Record<string, unknown>) {
  const { setup } = await getSetup(client);
  if (!setup.jvMode.includes("B")) fail("Mapping an existing journal is not switched on in Payroll Setup");
  const slipId = Number(input.slipId), ledId = Number(input.ledId);
  const slip = (await client.query("SELECT s.*, p.status FROM pay_slip s JOIN pay_period p ON p.period_id = s.period_id WHERE s.slip_id = $1 FOR UPDATE OF s", [slipId])).rows[0] ?? fail("The slip does not exist");
  if (text(slip.status) === "L") fail("This pay period is locked");
  if (slip.jv_mode && text(slip.jv_mode) === "A") fail("This slip's journal was made by payroll");
  const code = num(slip.code), periodId = num(slip.period_id);
  const credited = num((await client.query("SELECT COALESCE(SUM(amount), 0) AS s FROM pay_voucher_tag WHERE code = $1 AND period_id = $2 AND tag_type = 'SAL' AND NOT reversed", [code, periodId])).rows[0]?.s);
  const needed = cents(num(slip.net_payable) - credited);
  const amount = input.amount === undefined || input.amount === null || input.amount === "" ? needed : cents(Number(input.amount));
  if (!(amount > 0)) fail(needed <= 0 ? "This slip's salary is already fully credited" : "The amount to map must be more than zero");
  if (amount > needed + 0.004) fail(`Only ${needed.toFixed(2)} of this slip's net pay is still to be credited`);
  await tagLine(client, session, operator, { code, ledId, periodId, tagType: "SAL", amount, note: "Salary journal" });
  const doc = (await client.query("SELECT MAX(full_docno) AS d FROM ledger WHERE led_key = $1", [ledId])).rows[0]?.d;
  await client.query("UPDATE pay_slip SET jv_led_key = COALESCE(jv_led_key, $2), jv_mode = 'B', jv_doc = COALESCE(jv_doc, $3) WHERE slip_id = $1", [slipId, ledId, text(doc) || null]);
}

/** Takes a mapped journal off a slip: reverses its salary-credit tags and clears the link. A journal payroll made itself is removed in Accounts, not here. */
export async function releaseJournal(client: Client, session: MasterSession, operator: string, slipId: number) {
  const slip = (await client.query("SELECT s.*, p.status FROM pay_slip s JOIN pay_period p ON p.period_id = s.period_id WHERE s.slip_id = $1 FOR UPDATE OF s", [slipId])).rows[0] ?? fail("The slip does not exist");
  if (text(slip.status) === "L") fail("This pay period is locked");
  if (text(slip.jv_mode) === "A") fail("This journal was made by payroll; delete the voucher in Transaction > Voucher instead");
  const tags = (await client.query("SELECT tag_id FROM pay_voucher_tag WHERE code = $1 AND period_id = $2 AND tag_type = 'SAL' AND NOT reversed", [num(slip.code), num(slip.period_id)])).rows;
  for (const tag of tags) await untag(client, session, operator, num(tag.tag_id));
  await client.query("UPDATE pay_slip SET jv_led_key = NULL, jv_mode = NULL, jv_doc = NULL WHERE slip_id = $1", [slipId]);
}

/* ---------------------------------------------------------------- A: create */

function findVoucherMenu(nodes: readonly MenuNode[]): string | null {
  for (const node of nodes) {
    if (node.actionCode?.toUpperCase() === "ENTRY" && node.actionMenu?.toUpperCase() === VOUCHER && node.menuShortName) return node.menuShortName;
    const inner = findVoucherMenu(node.children);
    if (inner) return inner;
  }
  return null;
}

export type JvPreview = Readonly<{
  committed: boolean; docNo: string; date: string; total: number; expense: string; narration: string;
  rows: { name: string; debit: number; credit: number }[]; warnings: string[];
}>;

/** Thrown inside the dry run so its savepoint rolls back; it carries the voucher the person is shown. */
class Rollback extends Error { constructor(readonly preview: JvPreview) { super("dry run"); } }

/**
 * Makes the period's salary journal. With commit false it runs the real save inside a savepoint and rolls it back, so the person sees the voucher that
 * would be written; with commit true (and the server's entry-save switch on) it is written and every slip is linked to its credit line and tagged.
 */
export async function createJournal(client: Client, session: MasterSession, operator: string, menus: readonly MenuNode[], periodId: number, commit: boolean): Promise<JvPreview> {
  const { setup, salaryExpName } = await getSetup(client);
  if (!setup.jvMode.includes("A")) fail("Creating the salary journal is not switched on in Payroll Setup");
  if (setup.salaryExpCode === null) fail("Choose the salary expense account in Payroll Setup first");
  if (commit && !postingAllowed()) fail("This server does not allow entry saves (SMARTWINFA_ENTRY_SAVE_COMMIT is not true), so the journal cannot be posted");

  const period = (await client.query("SELECT * FROM pay_period WHERE period_id = $1 FOR UPDATE", [periodId])).rows[0] ?? fail("The pay period does not exist");
  if (text(period.status) !== "P") fail(text(period.status) === "L" ? "This pay period is locked" : "Process the payroll for this period first");
  const slips = (await client.query("SELECT s.slip_id, s.code, s.net_payable, s.jv_led_key, a.name FROM pay_slip s JOIN account a ON a.code = s.code WHERE s.period_id = $1 ORDER BY a.name", [periodId])).rows;
  if (slips.length === 0) fail("There are no slips to post");
  if (slips.some((s) => s.jv_led_key !== null)) fail("Some slips of this period already have a salary journal; release or finish them first");
  const credited = (await client.query("SELECT 1 FROM pay_voucher_tag WHERE period_id = $1 AND tag_type = 'SAL' AND NOT reversed LIMIT 1", [periodId])).rowCount;
  if (credited) fail("Salary credit tags already exist for this period; remove them first");
  const rows = slips.filter((s) => num(s.net_payable) > 0);
  const total = cents(rows.reduce((t, s) => t + num(s.net_payable), 0));
  if (total <= 0) fail("There is no net pay to post");

  const menuShortName = findVoucherMenu(menus) ?? fail("The Voucher entry is not in this company's menu");
  const loader = new Loader(client, session);
  const def = await loadInvoice(loader, VOUCHER, menuShortName);
  if (def.rights.restricted && !def.rights.add) fail("Voucher Entry Add Rights Not Available For User");
  let journal: EntryOption | undefined;
  for (const option of def.firstCombo.options) {
    if ((await bookContext(loader, VOUCHER, option)).values.bookKey === 19) { journal = option; break; }
  }
  if (!journal) fail("This company has no Journal book to post the salary in");
  const screen = await loadBook(loader, VOUCHER, journal, "V");
  // The plain journal series (JV) when the book has it; else the book's first series. The preview shows which one the voucher gets.
  const seriesBox = screen.controls.find((c) => c.name === "cmb_series");
  const series = seriesBox?.options?.find((o) => o.text.trim().toUpperCase() === "JV")?.text ?? seriesBox?.initial ?? "";
  if (series === "") fail("The Journal book has no series");
  const defaults = series === seriesBox?.initial ? screen.defaults : await seriesDefaults(loader, VOUCHER, await bookContext(loader, VOUCHER, journal), series);

  // The journal is dated the period's last day, kept inside the open year.
  const last = period.to_date instanceof Date ? period.to_date : new Date(`${text(period.to_date).slice(0, 10)}T00:00:00`);
  let date = new Date(last.getFullYear(), last.getMonth(), last.getDate());
  if (date > session.tarikh2) date = session.tarikh2;
  if (date < session.tarikh1) date = session.tarikh1;
  const dateText = formatDesktopDate(date);
  const narration = `Salary for ${MONTHS[num(period.pay_month) - 1]} ${num(period.pay_year)}`;
  const input: VoucherSaveInput = {
    values: { cmb_series: series, tbx_number: defaults.number, dtp_date: dateText, dtp_entrydate: dateText, tbx_entryno: "", tbx_narration: narration, cmb_rev_entry: "" },
    rows: [
      { ledKey: 0, code: setup.salaryExpCode, debit: total.toFixed(2), credit: "", chqNo: "", chqDate: "" },
      ...rows.map((s) => ({ ledKey: 0, code: num(s.code), debit: "", credit: num(s.net_payable).toFixed(2), chqNo: "", chqDate: "" })),
    ],
  };

  await client.query("SAVEPOINT pay_jv");
  try {
    if (commit) await client.query("SELECT pg_advisory_xact_lock(hashtext('smartwinfa-entry-save'))");
    const plan = await buildSave(loader, VOUCHER, journal, input);
    const report = await runPlan(client, loader, plan, { commit });
    const preview: JvPreview = {
      committed: commit, docNo: plan.summary.fullDocNo, date: dateText, total, expense: salaryExpName, narration, warnings: plan.warnings,
      rows: [{ name: salaryExpName || `#${setup.salaryExpCode}`, debit: total, credit: 0 }, ...rows.map((s) => ({ name: text(s.name), debit: 0, credit: num(s.net_payable) }))],
    };
    if (!commit) throw new Rollback(preview);

    // Link every slip to its credit line in the journal just written, and tag it as the period's salary credit.
    const written = report.rows.filter((r) => r.table.toLowerCase() === "ledger").map((r) => ({ ledKey: num(r.row.led_key), code: num(r.row.code), side: num(r.row.ac_dbcode) }));
    for (const s of rows) {
      const line = written.find((w) => w.code === num(s.code) && w.side === 2) ?? fail(`The journal line of ${text(s.name)} was not found after saving`);
      await tagLine(client, session, operator, { code: num(s.code), ledId: line.ledKey, periodId, tagType: "SAL", amount: num(s.net_payable), note: "Salary journal" });
      await client.query("UPDATE pay_slip SET jv_led_key = $2, jv_mode = 'A', jv_doc = $3 WHERE slip_id = $1", [num(s.slip_id), line.ledKey, plan.summary.fullDocNo]);
    }
    await client.query("RELEASE SAVEPOINT pay_jv");
    return preview;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT pay_jv");
    if (error instanceof Rollback) {
      await client.query("RELEASE SAVEPOINT pay_jv");
      return error.preview;
    }
    throw error;
  }
}
