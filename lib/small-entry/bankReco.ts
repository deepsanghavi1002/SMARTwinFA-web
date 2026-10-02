import { formatDesktopDate, parseDesktopDate } from "../master-program/legacy";

/**
 * Bank Statement (Small_Entry id 3, Bank Reconciliation): the rule of its own that the screen and
 * the save both apply. No database here, so the browser can use it.
 */

export const BANK_RECO = 3;
/** How many days after the entry a bank may clear it (Small_Entry AfterEdit). */
export const RECO_WINDOW_DAYS = 90;

/**
 * A reconciliation date must fall on or after the entry's date and within 90 days of it. Returns the
 * desktop's message when it does not, else "" (a blank date, which un-reconciles, is always allowed).
 */
export function recoDateProblem(docDate: string, recoDate: string): string {
  const reco = parseDesktopDate(recoDate);
  const entry = parseDesktopDate(docDate);
  if (!reco || !entry) return "";
  const last = new Date(entry);
  last.setDate(last.getDate() + RECO_WINDOW_DAYS);
  if (reco >= entry && reco <= last) return "";
  return `Reco. date should be more than ${formatDesktopDate(entry)} and Reco. date should be less than ${formatDesktopDate(last)} Allowed`;
}

/** An amount as the balance labels show it: two places, Indian grouping, Dr when positive and Cr otherwise. */
export function drCr(amount: number): string {
  const text = Math.abs(amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${text} ${amount > 0 ? "Dr" : "Cr"}`;
}

/**
 * The two labels of Small_Entry for Bank Statement: the bank book's balance (lbl_Book_Balance, from
 * the book's first-combo query) and the passbook's (tbx_Final_Amt): the book balance, plus each
 * withdrawal listed, less each deposit listed (a row with no withdrawal counts its deposit).
 */
export function bankBalances(bookBalance: number, rows: readonly Readonly<Record<string, string>>[]): { book: string; passbook: string } {
  const amount = (row: Readonly<Record<string, string>>, name: string) => {
    const key = Object.keys(row).find((candidate) => candidate.toLowerCase() === name);
    return Number((key ? row[key] : "").replace(/,/g, "")) || 0;
  };
  let passbook = bookBalance;
  for (const row of rows) {
    const withdrawal = amount(row, "withdrawals");
    passbook += withdrawal > 0 ? withdrawal : -amount(row, "deposit");
  }
  return { book: `Balance As Per Bank Book : ${drCr(bookBalance)}`, passbook: `Balance As Per Passbook : ${drCr(passbook)}` };
}
