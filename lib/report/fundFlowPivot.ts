/**
 * SP_FRT_RPT_FUND_FLOW's arithmetic, apart from the database: the receipt and payment lines of
 * the cash / bank books pivoted to a column a book, the row total, and each row's share of its
 * side. Kept free of imports so it can be tested on its own.
 */
export type FundSide = "RECEIPT" | "PAYMENT";

/** One line of TEMP_TABLE_RECPT_: a schedule's (or "  Opening") amount in one book; a payment is negative. */
export type FundLine = { side: FundSide; particular: string | null; book: string; amount: number };

export type FundRow = { PARTICULAR: string | null; SMART_SELECTED_SCHDULE: FundSide; TOTAL: number; PERC: number | null } & Record<string, string | number | null>;

const cents = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** The pivot groups on the particular the way SQL Server compares text: case and trailing spaces ignored. */
const groupKey = (side: FundSide, particular: string | null): string => `${side}\u0000${particular === null ? "\u0001" : particular.replace(/\s+$/, "").toLowerCase()}`;

/**
 * PIVOT (SUM(AMOUNT) FOR BOOK_NAME IN (books)), TOTAL = the books added, PERC = the row's TOTAL
 * over its side's total x 100 (rounded to 2 places; payments x -1, so a payment's share shows
 * negative as the desktop does). A line of a book that is not among `books` is dropped by the pivot.
 * Rows come back receipts first, then payments, each by particular as the caller sorts them.
 */
export function pivotFundFlow(books: readonly string[], lines: readonly FundLine[]): FundRow[] {
  const column = new Map(books.map((book) => [book.trim().toLowerCase(), book]));
  const groups = new Map<string, FundRow>();
  for (const line of lines) {
    const book = column.get(line.book.trim().toLowerCase());
    if (book === undefined) continue;
    const key = groupKey(line.side, line.particular);
    let row = groups.get(key);
    if (!row) {
      row = { PARTICULAR: line.particular, SMART_SELECTED_SCHDULE: line.side, ...Object.fromEntries(books.map((name) => [name, null])), TOTAL: 0, PERC: null } as FundRow;
      groups.set(key, row);
    }
    row[book] = Number(row[book] ?? 0) + line.amount;
  }
  const rows = [...groups.values()];
  for (const row of rows) {
    for (const book of books) if (row[book] !== null) row[book] = cents(Number(row[book]));
    row.TOTAL = cents(books.reduce((sum, book) => sum + Number(row[book] ?? 0), 0));
  }
  for (const side of ["RECEIPT", "PAYMENT"] as const) {
    const ofSide = rows.filter((row) => row.SMART_SELECTED_SCHDULE === side);
    const sideTotal = cents(ofSide.reduce((sum, row) => sum + row.TOTAL, 0));
    // The desktop skips a nil row and a row with no name (its update names no row); a side that nets to nothing would divide by zero there.
    if (sideTotal === 0) continue;
    for (const row of ofSide) {
      if (row.TOTAL === 0 || row.PARTICULAR === null) continue;
      const share = cents((row.TOTAL / sideTotal) * 100);
      row.PERC = side === "PAYMENT" ? share * -1 : share;
    }
  }
  return rows;
}
