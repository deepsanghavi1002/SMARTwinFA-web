import { createMoney, type Money } from "../database/value-semantics.ts";

export type JournalLine = Readonly<{ accountId: string; debit: Money; credit: Money }>;
export class JournalError extends Error { constructor(message: string) { super(message); this.name = "JournalError"; } }

/** Validates double-entry balance in minor units before a posting adapter is permitted to persist. */
export function validateJournal(lines: readonly JournalLine[]): readonly JournalLine[] {
  if (lines.length < 2) throw new JournalError("journal requires at least two lines");
  const currency = lines[0]?.debit.currency;
  let debit = 0; let credit = 0;
  for (const line of lines) {
    if (!/^[a-z][a-z0-9_-]{2,99}$/i.test(line.accountId)) throw new JournalError("account id is invalid");
    if (line.debit.currency !== currency || line.credit.currency !== currency) throw new JournalError("journal currencies must match");
    if (line.debit.minorUnits < 0 || line.credit.minorUnits < 0 || (line.debit.minorUnits > 0 && line.credit.minorUnits > 0)) throw new JournalError("each journal line must be debit or credit only");
    debit += line.debit.minorUnits; credit += line.credit.minorUnits;
  }
  if (debit !== credit || debit === 0) throw new JournalError("journal must balance with a nonzero amount");
  return Object.freeze(lines.map((line) => Object.freeze({ ...line, debit: createMoney(line.debit.currency, line.debit.minorUnits), credit: createMoney(line.credit.currency, line.credit.minorUnits) })));
}
