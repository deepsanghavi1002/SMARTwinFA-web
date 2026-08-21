export type Money = Readonly<{ currency: string; minorUnits: number }>;
export class ValueSemanticsError extends Error { constructor(message: string) { super(message); this.name = "ValueSemanticsError"; } }

/** Uses integer minor units to avoid floating-point accounting arithmetic. */
export function createMoney(currency: string, minorUnits: number): Money {
  if (!/^[A-Z]{3}$/.test(currency)) throw new ValueSemanticsError("currency is invalid");
  if (!Number.isSafeInteger(minorUnits)) throw new ValueSemanticsError("minor units must be a safe integer");
  return Object.freeze({ currency, minorUnits });
}
export function addMoney(left: Money, right: Money): Money {
  if (left.currency !== right.currency) throw new ValueSemanticsError("currencies must match");
  return createMoney(left.currency, left.minorUnits + right.minorUnits);
}
/** Requires UTC ISO timestamps for target event records; local legacy timestamps need an approved conversion policy. */
export function requireUtcTimestamp(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) throw new ValueSemanticsError("timestamp must be a valid UTC ISO value");
  return value;
}
export function requireCanonicalId(value: string): string {
  if (!/^[a-z][a-z0-9_-]{2,99}$/i.test(value)) throw new ValueSemanticsError("canonical id is invalid");
  return value;
}
