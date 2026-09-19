export type Reconciliation = Readonly<{ expected: number; actual: number; tolerance: number; status: "matched" | "mismatched" }>;
export function reconcile(expected: number, actual: number, tolerance = 0): Reconciliation {
  if (![expected, actual, tolerance].every(Number.isSafeInteger) || tolerance < 0) throw new Error("reconciliation inputs are invalid");
  return Object.freeze({ expected, actual, tolerance, status: Math.abs(expected - actual) <= tolerance ? "matched" : "mismatched" });
}
