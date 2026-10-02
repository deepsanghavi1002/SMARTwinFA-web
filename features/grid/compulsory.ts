/**
 * Func_BlankFieldValidation over the edited rows, before a save: a compulsory column left blank.
 * As the master's Update grid: only a column on screen and open for editing on that row is
 * checked (a hidden or closed column cannot be filled, so it cannot be demanded), and a row
 * marked for deletion is not checked at all.
 */

export type CompulsoryColumn = Readonly<{ key: string; caption: string; compulsory: boolean }>;

/** The message to show, or "" when every compulsory field is filled. `rowNumber` is 1-based, as shown. */
export function blankCompulsory<C extends CompulsoryColumn>(
  rows: readonly Readonly<{ rowNumber: number; deleted?: boolean; valueOf: (key: string) => string | undefined }>[],
  columns: readonly C[],
  open: (row: number, column: C) => boolean,
): string {
  const blanks: string[] = [];
  for (const row of rows) {
    if (row.deleted) continue;
    for (const column of columns) {
      if (!column.compulsory || !open(row.rowNumber, column)) continue;
      const value = row.valueOf(column.key);
      if (value !== undefined && value.trim() === "") blanks.push(`- ${column.caption.replace(/^\*\s*/, "").trim()} at row ${row.rowNumber}`);
    }
  }
  return blanks.length === 0 ? "" : `Fill The Following Fields And Try Again\n\n${blanks.join("\n")}\n\n\n **TIPS**\nCompulosry Fields Can't Be Left Blank`;
}

/** The heading of the message box blankCompulsory's message shows in. */
export const BLANK_COMPULSORY_TITLE = "Empty Fields Found!!";
