/**
 * Entry Approved (Small_Entry id 32), the parts the screen and the server share: no database here,
 * so the browser can use it. The lock itself is worked out on the server (entry32.ts).
 */

export const ENTRY_APPROVED = 32;
/** The book whose parties are locked when over their credit days or limit. */
export const LOCKED_BOOK = "SALE - ORDER";
export const PARTY_STOP_MESSAGE = "Party's outstanding Over due than Credit Days or Amount Over than Limit";

/** Whether a grid row is locked for approval (its Allowed column holds "N"). */
export function isLocked(row: Readonly<Record<string, string>>): boolean {
  const key = Object.keys(row).find((candidate) => candidate.toLowerCase() === "allowed");
  return key !== undefined && (row[key] ?? "").trim().toUpperCase() === "N";
}
