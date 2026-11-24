import type { Client } from "pg";
import type { MasterSession } from "../master-program/session";

/**
 * Payroll Phase 3: tagging the existing vouchers of a staff ledger to a pay period and a kind of payment, and the reconciliation of what payroll
 * knows against the General Ledger. Nothing here writes to the accounts: the voucher lines are read from ledger_post / ledger, and a tag is only a
 * pointer (pay_voucher_tag) with the share of the line it covers.
 *
 * Sides follow the accounts: ledger_post.post_dbcode 1 is a debit, 2 a credit; the staff ledger's balance is opening + debits - credits, a minus is
 * money owed to the staff member. A line is identified by its voucher line (led_id) and the staff code, so a Re-post of the data (which makes new
 * ledger_post keys) does not lose the tags.
 */

export type TagType = "SAL" | "PAY" | "ADV" | "REC" | "OTH";

/** What each kind of tag is, and which side of the staff ledger it may be put on (D: a debit line, C: a credit line, B: either). */
export const TAG_TYPES: Readonly<Record<TagType, { label: string; side: "D" | "C" | "B" }>> = {
  SAL: { label: "Salary credit (JV)", side: "C" },
  PAY: { label: "Salary payout", side: "D" },
  ADV: { label: "Salary advance", side: "D" },
  REC: { label: "Advance / loan recovery", side: "C" },
  OTH: { label: "Other", side: "B" },
};

const BOOKS: Readonly<Record<number, string>> = { 4: "Cash", 5: "Discount", 6: "Bank", 19: "Journal" };

const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));
const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());
const day = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : value ? String(value).slice(0, 10) : "");
const cents = (value: number) => Math.round(value * 100) / 100;
function fail(message: string): never { throw new Error(message); }

export type Tag = Readonly<{ tagId: number; periodId: number; periodLabel: string; type: TagType; amount: number; note: string; by: string; at: string }>;
export type VoucherLine = Readonly<{
  ledId: number; date: string; docNo: string; book: string; bookNo: number; narration: string;
  side: "Dr" | "Cr"; amount: number; tagged: number; untagged: number; tags: Tag[];
  /** The line's amount is now less than what was tagged (the voucher was edited in Accounts): the tags must be fixed. */
  over: boolean;
}>;

type Lines = { ledId: number; date: string; docNo: string; narration: string; bookNo: number; net: number }[];

/** The staff ledger's posted lines for the open year, one per voucher line, as the Ledger shows them (deleted vouchers left out). */
export async function readLines(client: Client, session: MasterSession, codes: readonly number[]): Promise<Map<number, Lines>> {
  const rows = (await client.query(
    `SELECT p.post_code AS code, p.led_id, MIN(p.post_date) AS post_date, MAX(l.full_docno) AS full_docno, MAX(l.narration) AS narration, MAX(p.post_book) AS post_book,
            SUM(CASE WHEN p.post_dbcode = 1 THEN p.post_amt ELSE -p.post_amt END) AS net
       FROM ledger_post p JOIN ledger l ON l.led_key = p.led_id
      WHERE p.post_code = ANY($1) AND p.year_id = $2 AND COALESCE(l.doc_pos, '') <> 'D'
      GROUP BY p.post_code, p.led_id ORDER BY MIN(p.post_date), p.led_id`,
    [codes, session.yearId],
  )).rows;
  const out = new Map<number, Lines>();
  for (const row of rows) {
    const net = cents(num(row.net));
    if (net === 0) continue;
    const list = out.get(num(row.code)) ?? [];
    list.push({ ledId: num(row.led_id), date: day(row.post_date), docNo: text(row.full_docno), narration: text(row.narration), bookNo: num(row.post_book), net });
    out.set(num(row.code), list);
  }
  return out;
}

const periodLabel = (year: unknown, month: unknown) => `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][num(month) - 1] ?? month} ${year}`;

export async function readTags(client: Client, codes: readonly number[]) {
  const rows = (await client.query(
    `SELECT t.*, p.pay_year, p.pay_month FROM pay_voucher_tag t JOIN pay_period p ON p.period_id = t.period_id
      WHERE t.code = ANY($1) AND NOT t.reversed ORDER BY t.tag_id`,
    [codes],
  )).rows;
  return rows.map((row) => ({
    code: num(row.code), ledId: num(row.led_id),
    tag: { tagId: num(row.tag_id), periodId: num(row.period_id), periodLabel: periodLabel(row.pay_year, row.pay_month), type: text(row.tag_type) as TagType, amount: num(row.amount), note: text(row.note), by: text(row.tagged_by), at: day(row.tagged_at) } as Tag,
  }));
}

async function readOpening(client: Client, session: MasterSession, code: number) {
  return num((await client.query("SELECT opening FROM ac_balance WHERE code = $1 AND year_id = $2 AND a_recflag = 'AC' LIMIT 1", [code, session.yearId])).rows[0]?.opening);
}

/** One staff member's voucher lines with what is tagged on each: the Voucher Tagging screen. */
export async function staffLines(client: Client, session: MasterSession, code: number) {
  const profile = (await client.query("SELECT a.name FROM pay_staff_profile p JOIN account a ON a.code = p.code WHERE p.code = $1", [code])).rows[0] ?? fail("This staff member is not enrolled in payroll");
  const lines = (await readLines(client, session, [code])).get(code) ?? [];
  const tags = await readTags(client, [code]);
  const out: VoucherLine[] = lines.map((line) => {
    const mine = tags.filter((t) => t.ledId === line.ledId).map((t) => t.tag);
    const amount = Math.abs(line.net);
    const tagged = cents(mine.reduce((total, t) => total + t.amount, 0));
    return { ledId: line.ledId, date: line.date, docNo: line.docNo, bookNo: line.bookNo, book: BOOKS[line.bookNo] ?? `Book ${line.bookNo}`, narration: line.narration,
      side: line.net > 0 ? "Dr" : "Cr", amount, tagged, untagged: Math.max(0, cents(amount - tagged)), tags: mine, over: tagged > amount + 0.004 };
  });
  // Tags whose voucher line no longer exists (the voucher was deleted in Accounts) are shown apart so they can be reversed.
  const live = new Set(lines.map((l) => l.ledId));
  const orphans = tags.filter((t) => !live.has(t.ledId)).map((t) => ({ ledId: t.ledId, ...t.tag }));
  return { name: text(profile.name), opening: await readOpening(client, session, code), lines: out, orphans };
}

/** Tags part (or all) of a voucher line to a pay period. Serialised per staff member, so two people cannot over-tag the same line. */
export async function tagLine(client: Client, session: MasterSession, operator: string, input: Record<string, unknown>) {
  const code = Number(input.code), ledId = Number(input.ledId), periodId = Number(input.periodId);
  const type = text(input.tagType) as TagType;
  if (!Number.isInteger(code) || !Number.isInteger(ledId) || !Number.isInteger(periodId)) fail("Staff, voucher line and pay period are required");
  if (!(type in TAG_TYPES)) fail("Choose what the voucher is for");
  const amount = cents(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) fail("The amount to tag must be more than zero");
  const note = text(input.note);
  if (note.length > 100) fail("The note is too long (100 characters at most)");

  await client.query("SELECT 1 FROM pay_staff_profile WHERE code = $1 FOR UPDATE", [code]);
  const period = (await client.query("SELECT status FROM pay_period WHERE period_id = $1 FOR SHARE", [periodId])).rows[0] ?? fail("The pay period does not exist");
  if (text(period.status) === "L") fail("This pay period is locked; tags cannot be added to it");

  const line = ((await readLines(client, session, [code])).get(code) ?? []).find((l) => l.ledId === ledId) ?? fail("This voucher line is not in the staff ledger of the open year");
  const side = line.net > 0 ? "D" : "C";
  const allowed = TAG_TYPES[type].side;
  if (allowed !== "B" && allowed !== side) fail(`${TAG_TYPES[type].label} goes on a ${allowed === "D" ? "debit" : "credit"} line; this line is a ${side === "D" ? "debit" : "credit"}`);
  const already = num((await client.query("SELECT COALESCE(SUM(amount), 0) AS s FROM pay_voucher_tag WHERE code = $1 AND led_id = $2 AND NOT reversed", [code, ledId])).rows[0]?.s);
  const left = cents(Math.abs(line.net) - already);
  if (amount > left + 0.004) fail(left <= 0 ? "This voucher line is already fully tagged" : `Only ${left.toFixed(2)} of this voucher line is left to tag`);

  await client.query("INSERT INTO pay_voucher_tag (led_id, code, period_id, tag_type, amount, note, tagged_by) VALUES ($1,$2,$3,$4,$5,$6,$7)", [ledId, code, periodId, type, amount, note || null, operator]);
  return staffLines(client, session, code);
}

/** Reverses a tag (it stays on record, and frees its amount). Not allowed in a locked period. */
export async function untag(client: Client, session: MasterSession, operator: string, tagId: number) {
  if (!Number.isInteger(tagId)) fail("Tag is required");
  const tag = (await client.query("SELECT t.code, p.status FROM pay_voucher_tag t JOIN pay_period p ON p.period_id = t.period_id WHERE t.tag_id = $1 AND NOT t.reversed", [tagId])).rows[0] ?? fail("The tag does not exist or is already reversed");
  await client.query("SELECT 1 FROM pay_staff_profile WHERE code = $1 FOR UPDATE", [num(tag.code)]);
  if (text(tag.status) === "L") fail("This pay period is locked; its tags cannot be reversed");
  await client.query("UPDATE pay_voucher_tag SET reversed = true, reversed_by = $2, reversed_at = now() WHERE tag_id = $1", [tagId, operator]);
  return staffLines(client, session, num(tag.code));
}

export type ReconRow = Readonly<{
  code: number; name: string;
  /** Owed to the staff member at the year's start (minus: they owe the company). */
  opening: number;
  salary: number; paid: number; advance: number; recovered: number; other: number;
  /** Opening owed + tagged lines: what payroll's tags say is still to be paid. */
  pending: number;
  /** What the General Ledger says is owed (the staff ledger's closing, sign turned: plus = payable). */
  glPayable: number;
  /** GL payable not explained by tags: voucher lines still untagged. Zero means pending equals the ledger. */
  untagged: number;
  untaggedLines: number;
  /** Net pay of the slips (of the year) against the salary credits tagged. */
  earned: number; notCredited: number;
  tie: boolean;
}>;

/** Pending Salary: for every enrolled staff member, what the tags explain and what the ledger says, with the difference. */
export async function reconcile(client: Client, session: MasterSession, periodId: number | null): Promise<ReconRow[]> {
  const staff = (await client.query("SELECT p.code, a.name FROM pay_staff_profile p JOIN account a ON a.code = p.code ORDER BY p.active DESC, a.name")).rows;
  const codes = staff.map((s) => num(s.code));
  if (codes.length === 0) return [];
  const lines = await readLines(client, session, codes);
  const tags = await readTags(client, codes);
  const openings = new Map((await client.query("SELECT code, opening FROM ac_balance WHERE code = ANY($1) AND year_id = $2 AND a_recflag = 'AC'", [codes, session.yearId])).rows.map((r) => [num(r.code), num(r.opening)]));
  const earned = new Map((await client.query(
    `SELECT s.code, SUM(s.net_payable) AS net FROM pay_slip s JOIN pay_period p ON p.period_id = s.period_id
      WHERE s.code = ANY($1) AND p.to_date >= $2::date AND p.from_date <= $3::date AND ($4::int IS NULL OR p.period_id = $4) GROUP BY s.code`,
    [codes, day(session.tarikh1), day(session.tarikh2), periodId],
  )).rows.map((r) => [num(r.code), num(r.net)]));

  return staff.map((s) => {
    const code = num(s.code);
    const mine = lines.get(code) ?? [];
    const sideOf = new Map(mine.map((l) => [l.ledId, l.net > 0 ? 1 : -1]));
    const opening = openings.get(code) ?? 0;
    const sum = { SAL: 0, PAY: 0, ADV: 0, REC: 0, OTH: 0 };
    let taggedPayable = 0; // every live tag, credit +, debit -: for the tie against the ledger, whatever the period filter
    let shownPayable = 0;
    for (const t of tags.filter((x) => x.code === code)) {
      const side = sideOf.get(t.ledId);
      if (side === undefined) continue; // an orphan tag (voucher gone) explains nothing in the ledger
      taggedPayable += side > 0 ? -t.tag.amount : t.tag.amount;
      if (periodId === null || t.tag.periodId === periodId) { sum[t.tag.type] += t.tag.amount; shownPayable += side > 0 ? -t.tag.amount : t.tag.amount; }
    }
    const netAll = cents(mine.reduce((t, l) => t + l.net, 0));
    const glPayable = cents(-(opening + netAll));
    const pendingAll = cents(-opening + taggedPayable);
    const untagged = cents(glPayable - pendingAll);
    const untaggedLines = mine.filter((l) => {
      const done = tags.filter((t) => t.code === code && t.ledId === l.ledId).reduce((total, t) => total + t.tag.amount, 0);
      return cents(Math.abs(l.net) - done) > 0.004;
    }).length;
    const credited = cents(sum.SAL);
    return {
      code, name: text(s.name), opening: cents(-opening), salary: credited, paid: cents(sum.PAY), advance: cents(sum.ADV), recovered: cents(sum.REC), other: cents(sum.OTH),
      pending: periodId === null ? pendingAll : cents(shownPayable), glPayable, untagged, untaggedLines,
      earned: cents(earned.get(code) ?? 0), notCredited: cents((earned.get(code) ?? 0) - credited), tie: Math.abs(untagged) < 0.005,
    };
  });
}
