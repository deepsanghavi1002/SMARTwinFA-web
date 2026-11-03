import type { Client } from "pg";
import type { Loader } from "../master-program/load";
import type { MasterSession } from "../master-program/session";
import { transaction } from "../db";
import { ResultTable } from "./call";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./refusal";
import { alignSequences } from "./autoBilling";
import { runReportSql } from "./run";

/**
 * 65: YEAR ENDING GENERATE (REPORT_YEAR_END, SP_FRT_RPT_YEAR_END_JV and SP_INSERT_YEAR_END_JV; TRANSACTION > Auto Entry > Year Ending Generate).
 * Not a listing: it passes the year-closing journal entries (JV, book 19, document no1 END-n) that carry the year's trading, profit and loss and
 * capital accounts into the profit account, and lists the entries it made (voucher, account, debit, credit). It first checks the year has none yet.
 *  - The accounts (balance sheet groups 01..04, and the closing stock) are taken with their balance of the year; the opening stock and the closing stock
 *    are carried from the opening figures, each group level 1..4 gets a "Profit" line of what is left to balance it, and that profit goes on to the next level.
 *  - One voucher for each of the levels' debit and credit balances (the closing of the accounts), numbered after the highest JV number of the year; the voucher
 *    numbers are used even by a level with no account (as the procedure does).
 *  - The profit is then shared to the capital accounts of the group of the first "capital" balance sheet group (09 01 .. 09 04): all to the account (01 / 04)
 *    or by the profit % of the master (02, the % must add to 100).
 * The web does the writing in a transaction of its own (the report screen's reads cannot write); amounts are worked in paise.
 * Web differences from the procedure: a line of nothing (debit and credit both 0) is not written; a loss shared among partners gives every partner his own
 * share (the procedure's stale balance would give only the last partner an amount); a year-end voucher that does not balance is refused before anything is written.
 */
const refuse = (message: string) => new ReportRefusal(message, "Year Ending");
const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const SCHEMA = /^[a-z_][a-z0-9_]*$/;

type Account = { code: number; name: string; bsId: number; level: number; opening: number; balance: number; billdiff: number; opensty: string };
type Line = { no: number; code: number; name: string; dr: number; cr: number };
export type YearEndPlan = { lines: Line[]; series: string; journal: number };

const paise = (expression: string) => `(coalesce(${expression}, 0)::numeric * 100)::bigint`;
const rupees = (value: number) => (value / 100).toFixed(2);
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });
/** value x percent (percent in hundredths), rounded to the paisa half away from zero. */
const share = (value: number, percentHundredths: number) => {
  const product = BigInt(value) * BigInt(percentHundredths);
  const magnitude = product < BigInt(0) ? -product : product;
  const rounded = Number((magnitude * BigInt(2) + BigInt(10000)) / BigInt(20000));
  return product < BigInt(0) ? -rounded : rounded;
};

export async function yearEnd(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  // The check before anything is done: the year has no year-closing JV yet.
  const done = (await runReportSql(loader, `SELECT 1 FROM ${call.database}ledger WHERE doc_pos = 'A' AND doc_date BETWEEN $1::date AND $2::date AND left(ltrim(doc_no1), 4) = 'END-' AND book = 19 AND year_id = $3 LIMIT 1`,
    [isoDay(session.tarikh1), isoDay(session.tarikh2), session.yearId])).rows.length;
  if (done) throw refuse("Financial Year Closing\nJV Entry Already Passed");
  const made = await transaction(async (client) => {
    const entries = await planYearEnd(client, session);
    await writeYearEnd(client, session, entries);
    return entries;
  }, { timeoutMs: 600000 });
  const table = new ResultTable();
  for (const column of ["jv_no", "code", "date", "doc_no", "full_docno", "name", "dr_amt", "cr_amt"]) table.addColumn(column);
  table.setKind("dr_amt", "decimal");
  table.setKind("cr_amt", "decimal");
  const [year, month, day] = isoDay(session.tarikh2).split("-");
  table.rows = made.lines.map((line) => ({ jv_no: line.no, code: line.code, date: `${day}/${month}/${year}`, doc_no: String(line.no).padStart(10), full_docno: `${made.series}/${line.no}`, name: line.name, dr_amt: line.dr / 100, cr_amt: line.cr / 100 }));
  return table;
}

/** The year-end entries as the procedure works them out (reads only). */
export async function planYearEnd(client: Client, session: MasterSession): Promise<YearEndPlan> {
  const s = session.companySchema;
  if (!SCHEMA.test(s)) throw refuse("The company's database name is not a valid schema");
  const rows = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows;

  // The top balance sheet group of each of the four levels (the procedure keeps the last of each).
  const top = [0, 0, 0, 0];
  for (const row of await rows(`SELECT bs_key, left(bs_code, 2) AS prefix FROM ${s}.balsheet WHERE left(bs_code, 2) IN ('01', '02', '03', '04') ORDER BY bs_key`)) top[Number(row.prefix) - 1] = Number(row.bs_key);
  // The capital group: the last balance sheet group 09 01 .. 09 04 that has an account.
  let boss = "01";
  let bossBsId = 0;
  for (const row of await rows(`SELECT bs_key, substring(bs_code, 3, 2) AS kind FROM ${s}.balsheet WHERE left(bs_code, 2) = '09' AND substring(bs_code, 3, 2) IN ('01', '02', '03', '04')`
    + ` AND bs_key IN (SELECT bs_id FROM ${s}.account WHERE a_pos = 'A') ORDER BY bs_key`)) { boss = String(row.kind); bossBsId = Number(row.bs_key); }

  let profit = 0; let profitName = ""; let openStock = 0; let closeStock = 0; let closeStockPl = 0; let journal = 0;
  for (const row of await rows(`SELECT code, btrim(name) AS name, book, btrim(coalesce(ac_opensty, '')) AS opensty FROM ${s}.account WHERE a_pos = 'A' AND (book = 19 OR btrim(ac_opensty) IN ('PR', 'OS', 'CB', 'CT')) ORDER BY code`)) {
    const code = Number(row.code);
    if (row.opensty === "PR") { profit = code; profitName = String(row.name); }
    else if (row.opensty === "OS") openStock = code;
    else if (row.opensty === "CB") closeStock = code;
    else if (row.opensty === "CT") closeStockPl = code;
    else if (Number(row.book) === 19) journal = code;
  }
  if (!profit) throw refuse("The profit account is not found");
  if (!journal) throw refuse("The journal book is not found");

  const accounts: Account[] = (await rows(`SELECT a.code, btrim(a.name) AS name, a.bs_id, c.bs_level, btrim(coalesce(a.ac_opensty, '')) AS opensty, ${paise("b.opening::numeric")} AS opening, ${paise("b.debit::numeric - b.credit::numeric")} AS balance, ${paise("b.os_billdiff::numeric")} AS billdiff`
    + ` FROM ${s}.account a, ${s}.ac_balance b, ${s}.balsheet c WHERE a.code = b.code AND a.a_pos <> 'D' AND a.bs_id = c.bs_key AND b.year_id = $1 AND b.a_recflag = 'AC'`
    + ` AND (btrim(a.ac_opensty) = 'CB' OR ${boss === "04" ? "a.bs_id IN ($2, $3)" : "left(c.bs_code, 2) <= '04' COLLATE \"C\""}) ORDER BY a.name`, boss === "04" ? [session.yearId, top[0], top[3]] : [session.yearId]))
    .map((row) => ({ code: Number(row.code), name: String(row.name), bsId: Number(row.bs_id), level: Number(row.bs_level), opening: Number(row.opening), balance: Number(row.balance), billdiff: Number(row.billdiff), opensty: String(row.opensty) }));

  // The closing stock is carried as the opening stock of the profit and loss.
  const stock = accounts.find((account) => account.code === closeStock)?.opening ?? 0;
  for (const account of accounts) {
    if (closeStockPl && account.code === closeStockPl) Object.assign(account, { bsId: top[0], name: "OPENING STOCK", level: 1, opening: stock });
  }
  for (const account of accounts) {
    if (closeStock && account.code === closeStock) Object.assign(account, { opening: -account.billdiff, level: 1, bsId: top[0] });
  }
  const profitLine = (level: number, opening: number): Account => ({ code: profit, name: "Profit", bsId: top[level - 1], level, opening, balance: 0, billdiff: 0, opensty: "" });

  // ---- Each level's balance, and the profit that goes on to the next level ----
  let carried = 0;
  for (let level = 1; level <= 4; level++) {
    let debit = 0; let credit = 0;
    if ((boss === "03" && level !== 4) || ((boss === "01" || boss === "02") && level <= 2)) {
      if (carried !== 0) { carried = -carried; accounts.push(profitLine(level, carried)); }
    }
    for (const account of accounts.filter((row) => row.level === level)) {
      if (account.code !== profit && account.name.toUpperCase() !== "PROFIT") {
        const total = account.code !== openStock && account.code !== closeStockPl && account.code !== closeStock ? account.balance : account.opening;
        for (const other of accounts) if (other.level === level && other.code === account.code) other.opening = total;
        if (total > 0) debit += total; else if (total < 0) credit += -total;
      } else {
        if (carried > 0) debit += carried; else if (carried < 0) credit += -carried;
        carried = 0;
      }
    }
    if (debit !== credit) {
      carried = -(debit - credit);
      accounts.push(profitLine(level, carried));
    }
  }

  // ---- The vouchers ----
  const series = String((await rows(`SELECT btrim(bn_series) AS series FROM ${s}.book_number WHERE bn_pos <> 'D' AND upper(bn_series) LIKE '%JV%' AND bn_id IN (SELECT bs_rec FROM ${s}.book_setup WHERE book_code = $1) ORDER BY bn_rec DESC LIMIT 1`, [journal]))[0]?.series ?? "");
  let number = Number((await rows(`SELECT max(nullif(regexp_replace(doc_no, '[^0-9]', '', 'g'), '')::bigint) AS top FROM ${s}.ledger WHERE book = 19 AND doc_pos <> 'D' AND upper(doc_series) LIKE '%JV%' AND doc_posting <> 'L' AND book_code = $1 AND doc_date BETWEEN $2::date AND $3::date`,
    [journal, isoDay(session.tarikh1), isoDay(session.tarikh2)]))[0]?.top) || 0;
  const next = () => { number = number === 0 ? 1 : number + 1; return number; };
  const lines: Line[] = [];
  const add = (no: number, code: number, name: string, dr: number, cr: number) => { if (dr !== 0 || cr !== 0) lines.push({ no, code, name, dr, cr }); };

  // SP_INSERT_YEAR_END_JV: the accounts of a level with a debit (opening above 0: credited) or a credit balance, and the profit line that balances them.
  const closing = (level: number, side: "<0" | ">0") => {
    const no = next();
    let balance = 0;
    for (const account of accounts.filter((row) => row.level === level && (side === "<0" ? row.opening < 0 : row.opening > 0)).sort(byName)) {
      const code = account.opensty === "CT" ? 9 : account.code;
      if (account.opening > 0) { add(no, code, account.name, 0, account.opening); balance -= account.opening; }
      else { add(no, code, account.name, -account.opening, 0); balance += -account.opening; }
    }
    if (balance !== 0) { balance = -balance; add(no, profit, profitName, balance >= 0 ? balance : 0, balance >= 0 ? 0 : -balance); }
  };
  const levels = boss === "03" ? [1, 2, 3] : boss === "04" ? [1] : [1, 2];
  for (const level of levels) { closing(level, "<0"); closing(level, ">0"); }

  // ---- The profit to the capital accounts ----
  let balance = carried;
  let counted = 0; let percent = 0; let rowCount = 0;
  let last: { code: number; name: string } | undefined;
  if (boss === "01" || boss === "02" || boss === "04") {
    const partners = bossBsId ? await rows(`SELECT code, btrim(name) AS name, a_perc FROM ${s}.account WHERE a_pos = 'A' AND bs_id = $1 ORDER BY code`, [bossBsId]) : [];
    rowCount = partners.length;
    let balanceNo = next();
    if (balance < 0) add(balanceNo, profit, profitName, 0, -balance);
    let remainder = 0;
    for (const partner of partners) {
      const code = Number(partner.code); const name = String(partner.name); const perc = Math.round(Number(partner.a_perc) * 100);
      last = { code, name };
      if (balance < 0) {
        if (boss === "01" || boss === "04") { add(balanceNo, code, name, -balance, 0); balance = 0; }
        else {
          counted++;
          if (perc > 0) {
            percent += perc;
            const part = share(carried, perc);
            balance += Math.abs(part);
            remainder = counted === rowCount ? Math.abs(part) + Math.abs(balance) : Math.abs(part);
            if (part > 0) add(balanceNo, code, name, remainder, 0); else add(balanceNo, code, name, 0, remainder);
          }
        }
      } else if (boss === "01" || boss === "04") { add(balanceNo, code, name, 0, balance); balance = 0; }
      else {
        counted++;
        if (perc > 0) {
          percent += perc;
          const part = share(carried, perc);
          balance -= part;
          remainder = counted === rowCount ? Math.abs(part) + Math.abs(balance) : Math.abs(part);
          if (part > 0) add(balanceNo, code, name, 0, remainder); else add(balanceNo, code, name, remainder, 0);
        }
      }
    }
    balanceNo = number;
    if (counted === rowCount) balance = 0;
    if (balance !== 0 && last) {
      if (balance < 0) add(balanceNo, last.code, last.name, -balance, 0);
      else add(balanceNo, last.code, last.name, 0, balance);
    }
    if ((boss === "02" || boss === "04") && Math.round(percent / 100) !== 100) throw refuse("Please Define First Profit % In Master\nBefore Saving");
  }

  // ---- Each voucher has to balance ----
  for (const no of new Set(lines.map((line) => line.no))) {
    const mine = lines.filter((line) => line.no === no);
    const debit = mine.reduce((sum, line) => sum + line.dr, 0);
    const credit = mine.reduce((sum, line) => sum + line.cr, 0);
    if (debit !== credit) throw refuse(`The year ending voucher ${series}/${no} does not balance (debit ${rupees(debit)}, credit ${rupees(credit)}); nothing was written.`);
  }
  return { lines: lines.sort((a, b) => a.no - b.no), series, journal };
}

/** The ledger rows with their postings, logs and the accounts' balances. */
async function writeYearEnd(client: Client, session: MasterSession, made: YearEndPlan) {
  const s = session.companySchema;
  const year = session.yearId;
  const user = Number(session.userNo) || 0;
  const date = isoDay(session.tarikh2);
  const step = async (label: string, sql: string, params: unknown[] = []) => {
    try { return await client.query(sql, params); }
    catch (error) { throw new Error(`Year ending stopped at "${label}": ${error instanceof Error ? error.message : String(error)}`); }
  };
  if (made.lines.length === 0) throw refuse("NO RECORD FOUND");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('smartwinfa-entry-save'))");
  await alignSequences(client, [[`${s}.ledger`, "led_key"], [`${s}.ledger_post`, "post_key"], [`${s}.log_ledger`, "lled_key"]]);
  const ledTop = Number((await step("last ledger key", `SELECT coalesce(max(led_key), 0) AS top FROM ${s}.ledger`)).rows[0].top);
  const savedTime = "to_char(now(), 'HH24:MI:SS')";

  for (const line of made.lines) {
    const debit = line.dr !== 0;
    const amount = rupees(debit ? line.dr : line.cr);
    await step("ledger", `INSERT INTO ${s}.ledger (code, doc_date, doc_no, doc_series, full_docno, doc_no1, amount, book_amt, book, book_code, ac_dbcode, narration, setoff_amt, ly_clearamt, post_bkcode, ag_book, "TYPE", int_type, chln_date, entry_type, post_date, post_amt,`
      + ` doc_posting, doc_mode, doc_lock, doc_pos, prod_amt, stkmdl, doc_remark, entry_sty, year_id, entry_no, last_savedate, last_savetime, user_id)`
      + ` VALUES ($1, $2::date, $3, $4::varchar, $5, $6, $7::numeric, 0, 19, $8, $9, '', 0, 0, null, 0, 0, 0, $2::date, '', $2::date, $7::numeric, 'P', 0, '', 'A', 0, '', '', '', $10, '', now()::date, ${savedTime}, $11)`,
    [line.code, date, String(line.no).padStart(10), made.series, `${made.series}/${line.no}`, `END-${line.no}`, amount, made.journal, debit ? 1 : 2, year, user]);
  }
  await step("ledger log", `INSERT INTO ${s}.log_ledger (lled_logdate, lled_logmode, lled_loguser, lled_id, lled_code, lled_docdate, lled_fulldocno, lled_docno1, lled_amount, lled_narration, lled_docpos, year_id, lled_logtime, lled_machine_name)`
    + ` SELECT now(), 'A', ${user}, led_key, code, doc_date, full_docno, doc_no1, amount, narration, 'A', year_id, ${savedTime}, 'WEB' FROM ${s}.ledger WHERE led_key > ${ledTop} ORDER BY led_key`);
  await step("postings", `INSERT INTO ${s}.ledger_post (led_id, post_code, post_date, post_bookcd, post_book, post_amt, post_dbcode, year_id) SELECT led_key, code, doc_date, book_code, book, amount, ac_dbcode, year_id FROM ${s}.ledger WHERE led_key > ${ledTop} ORDER BY led_key`);

  // The accounts' debit and credit totals; the capital and profit accounts have no bill difference left.
  const totals = new Map<number, [number, number]>();
  for (const line of made.lines) {
    const sums = totals.get(line.code) ?? [0, 0];
    sums[0] += line.dr; sums[1] += line.cr;
    totals.set(line.code, sums);
  }
  for (const [code, [debit, credit]] of totals) {
    await step("account balance", `UPDATE ${s}.ac_balance SET debit = debit::numeric + $2::numeric, credit = credit::numeric + $3::numeric, closing = opening::numeric + (debit::numeric + $2::numeric) - (credit::numeric + $3::numeric)`
      + ` WHERE a_recflag = 'AC' AND code = $1 AND year_id = $4`, [code, rupees(debit), rupees(credit), year]);
  }
  await step("bill difference", `UPDATE ${s}.ac_balance SET os_billdiff = 0 WHERE year_id = $1 AND a_recflag = 'AC' AND code IN (SELECT code FROM ${s}.account WHERE a_pos = 'A' AND (bs_id = 19 OR code = 6))`, [year]);
  await step("unique keys", `UPDATE ${s}.ledger l SET unique_key = m.first FROM (SELECT full_docno, min(led_key) AS first FROM ${s}.ledger WHERE led_key > ${ledTop} GROUP BY full_docno) m WHERE l.led_key > ${ledTop} AND l.full_docno = m.full_docno`);
}
