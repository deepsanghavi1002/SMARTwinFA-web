import { type TenantContext, scopedKey } from "../context/tenant-context.ts";

export type BulkRun = Readonly<{ id: string; context: TenantContext; sourceFingerprint: string; dryRun: true; status: "running" | "completed"; checkpoint: number; migratedKeys: readonly string[]; quarantined: readonly QuarantineRecord[] }>;
export type QuarantineRecord = Readonly<{ sourceKey: string; reason: "duplicate" | "invalid"; batch: number }>;
export class BulkMigrationError extends Error { constructor(message: string) { super(message); this.name = "BulkMigrationError"; } }

function id(label: string, value: string) { if (!/^[a-z][a-z0-9_-]{2,99}$/i.test(value)) throw new BulkMigrationError(`${label} is invalid`); return value; }
function fingerprint(value: string) { if (!/^[a-f0-9]{64}$/i.test(value)) throw new BulkMigrationError("source fingerprint is invalid"); return value; }

/** Starts a non-writing bulk migration run. Production persistence requires a reviewed adapter. */
export function startBulkRun(input: { id: string; context: TenantContext; sourceFingerprint: string }): BulkRun {
  id("run id", input.id); fingerprint(input.sourceFingerprint);
  return Object.freeze({ id: input.id, context: input.context, sourceFingerprint: input.sourceFingerprint, dryRun: true as const, status: "running" as const, checkpoint: 0, migratedKeys: Object.freeze([]), quarantined: Object.freeze([]) });
}

/** Applies one deterministic synthetic batch, preserving idempotency and a repair queue. */
export function processSyntheticBatch(run: BulkRun, input: { batch: number; sourceKeys: readonly string[]; invalidKeys?: readonly string[] }): BulkRun {
  if (run.status !== "running") throw new BulkMigrationError("bulk run is not active");
  if (!Number.isInteger(input.batch) || input.batch !== run.checkpoint + 1) throw new BulkMigrationError("batch must be the next checkpoint");
  const invalid = new Set(input.invalidKeys ?? []); const migrated = new Set(run.migratedKeys); const quarantined = [...run.quarantined];
  for (const sourceKey of input.sourceKeys) {
    id("source key", sourceKey);
    if (invalid.has(sourceKey)) quarantined.push(Object.freeze({ sourceKey, reason: "invalid", batch: input.batch }));
    else if (migrated.has(sourceKey)) quarantined.push(Object.freeze({ sourceKey, reason: "duplicate", batch: input.batch }));
    else migrated.add(sourceKey);
  }
  return Object.freeze({ ...run, checkpoint: input.batch, migratedKeys: Object.freeze([...migrated].sort()), quarantined: Object.freeze(quarantined) });
}

export function completeBulkRun(run: BulkRun): BulkRun {
  if (run.status !== "running") throw new BulkMigrationError("bulk run is not active");
  return Object.freeze({ ...run, status: "completed" as const });
}

/** Stable ledger identity binds every source record to the full tenant/company/year scope. */
export function migrationLedgerKey(run: BulkRun, sourceKey: string) { return scopedKey(run.context, "migration", `${run.id}:${id("source key", sourceKey)}`); }
