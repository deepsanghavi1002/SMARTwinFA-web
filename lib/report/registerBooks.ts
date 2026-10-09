/**
 * The books a register covers (Form Summary's REGISTER combo): the register's own book, its cash book,
 * and the debit / credit notes and returns that go against it, as SP_STD_RPT_FORM_SUMM reads them:
 * SALE 8 with cash sale 9, debit note 11 and credit note 16; PURCHASE 13 with cash purchase 14, 11 and 16;
 * EXPENSE 15 with 10. The first combo's help lists the accounts of these books. Any other book is itself.
 */
export function registerBooks(book: number): readonly number[] {
  switch (book) {
    case 8: case 9: return [8, 9, 11, 16];
    case 13: case 14: return [13, 14, 11, 16];
    case 10: case 15: return [10, 15];
    default: return [book];
  }
}

/**
 * The account books an Agewise Outstanding BOOK lists parties of: sale (and its cash and credit note
 * books) the debtors, book 2; purchase (and cash purchase, debit note) the creditors, book 3; expense
 * the general accounts, book 1. null for any other book (every account).
 */
export function partyBooks(book: number): readonly number[] | null {
  switch (book) {
    case 8: case 9: case 16: return [2];
    case 13: case 14: case 11: return [3];
    case 10: case 15: return [1];
    default: return null;
  }
}

/** What the account help lists for a report's chosen book: null leaves every account. */
export function accountHelpBooks(reportKey: number, book: number, firstComboHelp: boolean): readonly number[] | null {
  if (reportKey === 14 && firstComboHelp) return registerBooks(book);
  if (reportKey === 5) return partyBooks(book);
  return null;
}
