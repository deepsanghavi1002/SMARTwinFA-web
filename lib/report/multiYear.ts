import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { money } from "./run";

/**
 * Multi Year Account Balance (report 103, SP_FRT_RPT_MULTI_YEAR_ACCOUNT_SUMMARY_REP): the accounts of the company's years side by side,
 * apart from the database so it can be tested on its own. The queries that feed it are multiYearAccounts in reportFormating.ts.
 *
 * The rows start from the last year's accounts of the chosen book (1: the general accounts, not 2, 3 or 19; 2: debtors; 3: creditors), each
 * matched to the earlier years' live account of the same name and book. A year's columns are its opening (Op_), what was posted to the
 * account in the year (Dr_ / Cr_) and the closing (Cl_ = Op + Dr - Cr). Debit Credit Only (DRCR) gives Dr_ / Cr_ alone. With None:
 *  - the general accounts: an account opened as Sundry Debtors (ac_opensty SD in the first year) shows what all the debtors had posted, SC
 *    all the creditors, every year; and every year's closing is worked out;
 *  - each earlier year adds the accounts the rows do not have yet (by name and book), with that year's figures only; then the rows with
 *    nothing posted that year take the year's opening from the account of their name and book (blank when the year has none) and its
 *    closing is worked out again.
 * As the procedure: the last year's closing is only worked out for the general accounts (0.00 otherwise), the first year's re-reading
 * passes over rows added in later years (their first-year columns stay blank), and names compare without regard to case.
 */

export type YearAccount = Readonly<{ code: number; name: string; book: number; live: boolean; openSty: string; opening: number | null }>;
export type YearTotals = Readonly<{ dr: number; cr: number }>;
export type YearData = Readonly<{
  /** "2025_2026": the year of its first day and of its last. */
  label: string;
  accounts: readonly YearAccount[];
  /** What was posted to each account code in the year. */
  posts: ReadonlyMap<number, YearTotals>;
  /** What all the live debtors (book 2) / creditors (book 3) had posted in the year. */
  debtors: YearTotals;
  creditors: YearTotals;
}>;

const keyOf = (name: string, book: number) => `${name.toUpperCase()}\u0001${book}`;

/** The first combo's where on an account: 1 the general accounts, 2 debtors, 3 creditors (live ones); any other value keeps every account. */
function inBook(account: YearAccount, combo: number): boolean {
  if (combo === 1) return account.book !== 2 && account.book !== 3 && account.book !== 19 && account.live;
  if (combo === 2 || combo === 3) return account.book === combo && account.live;
  return true;
}

const add = (a: number | null, b: number | null) => (a === null || b === null ? null : money(a + b));

export function multiYearAccounts(years: readonly YearData[], combo: number, debitCreditOnly: boolean): ResultTable {
  const table = new ResultTable();
  table.addColumn("NAME");
  for (const year of years) {
    for (const part of debitCreditOnly ? ["Dr", "Cr"] : ["Op", "Dr", "Cr", "Cl"]) table.setKind(`${part}_${year.label}`, "decimal");
  }
  if (years.length === 0) return table;
  const last = years[years.length - 1];
  const postsOf = (year: YearData, code: number | undefined) => (code === undefined ? undefined : year.posts.get(code));

  // Each year's accounts by name and book, read once (a year has thousands of accounts; scanning them for every row took seconds).
  type YearIndex = { first: Map<string, YearAccount>; firstLive: Map<string, YearAccount>; liveOpening: Map<string, number> };
  const indexOf = new Map<YearData, YearIndex>();
  for (const year of years) {
    const index: YearIndex = { first: new Map(), firstLive: new Map(), liveOpening: new Map() };
    for (const account of year.accounts) {
      const key = keyOf(account.name, account.book);
      if (!index.first.has(key)) index.first.set(key, account);
      if (!account.live) continue;
      if (!index.firstLive.has(key)) index.firstLive.set(key, account);
      if (account.opening !== null) index.liveOpening.set(key, money((index.liveOpening.get(key) ?? 0) + account.opening));
    }
    indexOf.set(year, index);
  }
  const indexed = (year: YearData) => indexOf.get(year)!;
  type Row = { name: string; book: number; values: Map<string, number | null> };
  const rows: Row[] = [];

  // The last year's accounts of the book, each with the earlier years' live account of its name and book.
  for (const account of last.accounts.filter((candidate) => inBook(candidate, combo))) {
    const values = new Map<string, number | null>();
    const key = keyOf(account.name, account.book);
    for (const year of years) {
      const match = year === last ? account : indexed(year).firstLive.get(key);
      const posted = postsOf(year, match?.code);
      if (!debitCreditOnly) {
        // OUTER APPLY: the openings of the year's live accounts of that name and book.
        values.set(`Op_${year.label}`, match ? indexed(year).liveOpening.get(key) ?? 0 : 0);
      }
      values.set(`Dr_${year.label}`, posted?.dr ?? 0);
      values.set(`Cr_${year.label}`, posted?.cr ?? 0);
      if (!debitCreditOnly) values.set(`Cl_${year.label}`, 0);
    }
    rows.push({ name: account.name, book: account.book, values });
  }

  if (!debitCreditOnly) {
    const closing = (row: Row, label: string) => {
      const dr = row.values.get(`Dr_${label}`) ?? null;
      const cr = row.values.get(`Cr_${label}`) ?? null;
      row.values.set(`Cl_${label}`, add(add(row.values.get(`Op_${label}`) ?? null, dr), cr === null ? null : -cr));
    };
    // The general accounts: Sundry Debtors / Creditors accounts (by the first year's account of the name) take every debtor's / creditor's postings.
    if (combo === 1) {
      const stylesByName = new Map<string, string[]>();
      for (const account of years[0].accounts) {
        const name = account.name.toUpperCase();
        stylesByName.set(name, [...(stylesByName.get(name) ?? []), account.openSty.toUpperCase()]);
      }
      for (const year of years) {
        for (const row of rows) {
          const styles = stylesByName.get(row.name.toUpperCase()) ?? [];
          if (styles.includes("SD")) { row.values.set(`Dr_${year.label}`, year.debtors.dr); row.values.set(`Cr_${year.label}`, year.debtors.cr); }
          if (styles.includes("SC")) { row.values.set(`Dr_${year.label}`, year.creditors.dr); row.values.set(`Cr_${year.label}`, year.creditors.cr); }
        }
        for (const row of rows) closing(row, year.label);
      }
    }
    // Each earlier year: the accounts not in the rows yet, then the rows with nothing posted that year re-read from it.
    years.slice(0, -1).forEach((year, index) => {
      const label = year.label;
      const known = new Set(rows.map((row) => keyOf(row.name, row.book)));
      for (const account of year.accounts) {
        if (known.has(keyOf(account.name, account.book)) || !inBook(account, combo)) continue;
        const posted = postsOf(year, account.code);
        const values = new Map<string, number | null>();
        values.set(`Op_${label}`, account.opening);
        values.set(`Dr_${label}`, posted?.dr ?? 0);
        values.set(`Cr_${label}`, posted?.cr ?? 0);
        values.set(`Cl_${label}`, add(account.opening, money((posted?.dr ?? 0) - (posted?.cr ?? 0))));
        rows.push({ name: account.name, book: account.book, values });
      }
      for (const row of rows) {
        const dr = row.values.get(`Dr_${label}`);
        const cr = row.values.get(`Cr_${label}`);
        // The first year compares the cells as they are (a blank one is not 0); the later years take a blank as 0.
        const nothing = index === 0 ? dr === 0 && cr === 0 : (dr ?? 0) === 0 && (cr ?? 0) === 0;
        if (!nothing) continue;
        const match = indexed(year).first.get(keyOf(row.name, row.book));
        const posted = postsOf(year, match?.code);
        row.values.set(`Op_${label}`, match?.opening ?? null);
        row.values.set(`Dr_${label}`, posted?.dr ?? 0);
        row.values.set(`Cr_${label}`, posted?.cr ?? 0);
      }
      for (const row of rows) closing(row, label);
    });
  }

  table.rows = rows
    .map((row, index) => ({ row, index, key: row.name.toUpperCase() }))
    .sort((a, b) => (a.key === b.key ? a.index - b.index : a.key < b.key ? -1 : 1))
    .map(({ row }) => {
      const values: ResultRow = { NAME: row.name };
      for (const column of table.columns.slice(1)) values[column] = row.values.has(column) ? row.values.get(column) : null;
      return values;
    });
  return table;
}
