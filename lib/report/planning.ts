/**
 * Planning figures of a cash, discount or bank account (pure calculation, no database; the
 * reading is library.readCashPlanning). Kept apart so it can be tested on its own.
 */

/** What the planning cards show for a cash, discount or bank account as of the report's Upto date. */
export type CashPlanning = Readonly<{
  account: string;
  book: number;
  asOf: string;
  opening: number;
  receipts: number;
  payments: number;
  closing: number;
  /** Payments per day over the last `windowDays` days (30), or, when none were paid in them, over the year so far. */
  averageDailyPayment: number;
  windowDays: number;
  /** Whole days the closing balance covers at that rate; null when there is no cash (overdrawn) or nothing is being paid out. */
  daysOfCash: number | null;
  /** The account master's limit (a bank CC's); 0 when none is set. */
  limit: number;
  /** What is drawn on a limit (an overdrawn balance) and what is left of it. */
  utilised: number;
  available: number;
  utilisation: number;
  /** Entries to accounts named "Interest ..." (not TDS / TCS) from the report's From to Upto date. */
  interest: number;
  months: readonly Readonly<{ month: string; receipts: number; payments: number; closing: number }>[];
}>;

/** The planning figures from the year's opening, each month's receipts and payments, and the last days' payments. */
export function planCash(input: Readonly<{
  account: string; book: number; asOf: string; opening: number; months: readonly { month: string; receipts: number; payments: number }[];
  recentPayments: number; windowDays: number; limit: number; interest: number;
}>): CashPlanning {
  let running = input.opening;
  const months = input.months.map((item) => { running = Math.round((running + item.receipts - item.payments) * 100) / 100; return { ...item, closing: running }; });
  const receipts = input.months.reduce((sum, item) => sum + item.receipts, 0);
  const payments = input.months.reduce((sum, item) => sum + item.payments, 0);
  const closing = Math.round((input.opening + receipts - payments) * 100) / 100;
  const average = input.windowDays > 0 ? input.recentPayments / input.windowDays : 0;
  const utilised = closing < 0 ? -closing : 0;
  const limit = input.limit > 0 ? input.limit : 0;
  return {
    account: input.account, book: input.book, asOf: input.asOf, opening: input.opening, receipts, payments, closing,
    averageDailyPayment: Math.round(average * 100) / 100, windowDays: input.windowDays,
    daysOfCash: closing > 0 && average > 0 ? Math.floor(closing / average) : null,
    limit, utilised, available: limit > 0 ? Math.round((limit - utilised) * 100) / 100 : 0, utilisation: limit > 0 ? utilised / limit : 0,
    interest: input.interest, months,
  };
}

/** One account's budget (the account master's) against what it did in the report's period. */
export type BudgetUse = Readonly<{
  code: number;
  name: string;
  /** 2 debtors (sales books), 3 creditors (purchase books). */
  book: number;
  budget: number;
  actual: number;
  /** Actual less budget (negative: still to use). */
  variance: number;
  /** Actual as a share of the budget (1 = used up, above 1 = over). */
  used: number;
}>;

export function budgetUse(input: Readonly<{ code: number; name: string; book: number; budget: number; actual: number }>): BudgetUse {
  const budget = Math.round(input.budget * 100) / 100;
  const actual = Math.round(input.actual * 100) / 100;
  return { ...input, budget, actual, variance: Math.round((actual - budget) * 100) / 100, used: budget === 0 ? 0 : actual / budget };
}
