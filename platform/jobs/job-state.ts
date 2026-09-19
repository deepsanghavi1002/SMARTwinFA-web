import { type TenantContext, scopedKey } from "../context/tenant-context.ts";

export type JobKind = "report" | "print" | "import" | "export" | "migration";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type DurableJob = Readonly<{
  id: string;
  kind: JobKind;
  status: JobStatus;
  context: TenantContext;
  idempotencyKey: string;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  workerId?: string;
  leaseExpiresAt?: string;
  failureCode?: string;
}>;

export type JobAuditEvent = Readonly<{
  event: "job.queued" | "job.claimed" | "job.succeeded" | "job.failed" | "job.requeued" | "job.cancelled";
  jobId: string;
  tenantId: string;
  companyId: string;
  accountingYearId: string;
  at: string;
}>;

export class JobStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobStateError";
  }
}

function validTimestamp(value: string) {
  return !Number.isNaN(Date.parse(value));
}

function requireTimestamp(value: string) {
  if (!validTimestamp(value)) throw new JobStateError("timestamp is invalid");
  return value;
}

function requireId(name: string, value: string) {
  if (!/^[a-z][a-z0-9_-]{2,99}$/i.test(value)) throw new JobStateError(`${name} is invalid`);
  return value;
}

function audit(job: DurableJob, event: JobAuditEvent["event"], at: string): JobAuditEvent {
  return Object.freeze({ event, jobId: job.id, tenantId: job.context.tenantId, companyId: job.context.companyId, accountingYearId: job.context.accountingYearId, at });
}

function update(job: DurableJob, patch: Partial<DurableJob>): DurableJob {
  return Object.freeze({ ...job, ...patch });
}

export function enqueueJob(input: {
  id: string;
  kind: JobKind;
  context: TenantContext;
  idempotencyToken: string;
  maxAttempts: number;
  now: string;
}): { job: DurableJob; event: JobAuditEvent } {
  requireId("job id", input.id);
  requireTimestamp(input.now);
  if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 10) throw new JobStateError("maxAttempts must be between 1 and 10");
  const job = Object.freeze({
    id: input.id,
    kind: input.kind,
    status: "queued" as const,
    context: input.context,
    idempotencyKey: scopedKey(input.context, "job", input.idempotencyToken),
    attempt: 0,
    maxAttempts: input.maxAttempts,
    createdAt: input.now,
    updatedAt: input.now,
  });
  return { job, event: audit(job, "job.queued", input.now) };
}

export function claimJob(job: DurableJob, workerId: string, leaseExpiresAt: string, now: string): { job: DurableJob; event: JobAuditEvent } {
  requireId("worker id", workerId);
  requireTimestamp(leaseExpiresAt);
  requireTimestamp(now);
  if (job.status !== "queued") throw new JobStateError("only queued jobs can be claimed");
  if (Date.parse(leaseExpiresAt) <= Date.parse(now)) throw new JobStateError("job lease must end after claim time");
  const claimed = update(job, { status: "running", workerId, leaseExpiresAt, attempt: job.attempt + 1, updatedAt: now, failureCode: undefined });
  return { job: claimed, event: audit(claimed, "job.claimed", now) };
}

export function completeJob(job: DurableJob, workerId: string, now: string): { job: DurableJob; event: JobAuditEvent } {
  requireTimestamp(now);
  if (job.status !== "running" || job.workerId !== workerId) throw new JobStateError("only the claiming worker can complete a running job");
  const completed = update(job, { status: "succeeded", updatedAt: now, leaseExpiresAt: undefined });
  return { job: completed, event: audit(completed, "job.succeeded", now) };
}

export function failJob(job: DurableJob, workerId: string, failureCode: string, now: string): { job: DurableJob; event: JobAuditEvent } {
  requireTimestamp(now);
  if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(failureCode)) throw new JobStateError("failureCode is invalid");
  if (job.status !== "running" || job.workerId !== workerId) throw new JobStateError("only the claiming worker can fail a running job");
  const failed = update(job, { status: "failed", failureCode, updatedAt: now, leaseExpiresAt: undefined });
  return { job: failed, event: audit(failed, "job.failed", now) };
}

export function requeueJob(job: DurableJob, now: string): { job: DurableJob; event: JobAuditEvent } {
  requireTimestamp(now);
  if (job.status !== "failed") throw new JobStateError("only failed jobs can be requeued");
  if (job.attempt >= job.maxAttempts) throw new JobStateError("job retry limit has been reached");
  const queued = update(job, { status: "queued", workerId: undefined, leaseExpiresAt: undefined, updatedAt: now });
  return { job: queued, event: audit(queued, "job.requeued", now) };
}

export function cancelJob(job: DurableJob, now: string): { job: DurableJob; event: JobAuditEvent } {
  requireTimestamp(now);
  if (job.status === "succeeded" || job.status === "cancelled") throw new JobStateError("completed or cancelled jobs cannot be cancelled");
  const cancelled = update(job, { status: "cancelled", updatedAt: now, leaseExpiresAt: undefined });
  return { job: cancelled, event: audit(cancelled, "job.cancelled", now) };
}
