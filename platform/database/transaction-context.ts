import { postgresContextSettings, type TenantContext } from "../context/tenant-context.ts";

export type ScopedTransaction = Readonly<{ context: TenantContext; settings: Readonly<Record<string, string>>; state: "active" | "committed" | "rolled_back" }>;
export class ScopedTransactionError extends Error { constructor(message: string) { super(message); this.name = "ScopedTransactionError"; } }

/** Binds a transaction to all three server-owned scope dimensions before any database work. */
export function beginScopedTransaction(context: TenantContext): ScopedTransaction {
  return Object.freeze({ context, settings: Object.freeze(postgresContextSettings(context)), state: "active" as const });
}

/** Prevents callers from reusing a transaction with another tenant/company/year context. */
export function requireTransactionScope(transaction: ScopedTransaction, context: TenantContext): ScopedTransaction {
  if (transaction.state !== "active") throw new ScopedTransactionError("transaction is not active");
  if (transaction.context.tenantId !== context.tenantId || transaction.context.companyId !== context.companyId || transaction.context.accountingYearId !== context.accountingYearId) throw new ScopedTransactionError("transaction scope does not match request context");
  return transaction;
}

export function closeScopedTransaction(transaction: ScopedTransaction, outcome: "committed" | "rolled_back"): ScopedTransaction {
  if (transaction.state !== "active") throw new ScopedTransactionError("transaction is not active");
  return Object.freeze({ ...transaction, state: outcome });
}
