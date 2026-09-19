import assert from "node:assert/strict";
import test from "node:test";
import { cancelJob, claimJob, completeJob, enqueueJob, failJob, JobStateError, requeueJob } from "../platform/jobs/job-state.ts";

const context = Object.freeze({ subjectId: "user_alice", membershipId: "member_alice", tenantId: "tenant_alpha", companyId: "company_alpha", accountingYearId: "year_2026" });
const start = "2026-08-21T10:00:00.000Z";

function newJob(maxAttempts = 2) {
  return enqueueJob({ id: "job_report_001", kind: "report", context, idempotencyToken: "trial-balance-2026", maxAttempts, now: start }).job;
}

test("queues, claims, and completes a scoped job with an audit trail", () => {
  const queued = newJob();
  assert.equal(queued.idempotencyKey, "job:tenant_alpha:company_alpha:year_2026:trial-balance-2026");
  const claimed = claimJob(queued, "worker_one", "2026-08-21T10:01:00.000Z", "2026-08-21T10:00:05.000Z");
  const completed = completeJob(claimed.job, "worker_one", "2026-08-21T10:00:20.000Z");

  assert.equal(claimed.event.event, "job.claimed");
  assert.equal(completed.job.status, "succeeded");
  assert.equal(completed.event.tenantId, "tenant_alpha");
  assert.equal(Object.isFrozen(completed.job), true);
});

test("denies a second worker and impossible state transitions", () => {
  const claimed = claimJob(newJob(), "worker_one", "2026-08-21T10:01:00.000Z", "2026-08-21T10:00:05.000Z").job;
  assert.throws(() => claimJob(claimed, "worker_two", "2026-08-21T10:02:00.000Z", "2026-08-21T10:00:10.000Z"), JobStateError);
  assert.throws(() => completeJob(claimed, "worker_two", "2026-08-21T10:00:20.000Z"), /claiming worker/);
  assert.throws(() => cancelJob(completeJob(claimed, "worker_one", "2026-08-21T10:00:20.000Z").job, "2026-08-21T10:00:21.000Z"), /cannot be cancelled/);
});

test("allows bounded retries and records failures", () => {
  const claimed = claimJob(newJob(), "worker_one", "2026-08-21T10:01:00.000Z", "2026-08-21T10:00:05.000Z").job;
  const failed = failJob(claimed, "worker_one", "RENDER_TIMEOUT", "2026-08-21T10:00:20.000Z");
  const retry = requeueJob(failed.job, "2026-08-21T10:00:30.000Z");
  const lastAttempt = claimJob(retry.job, "worker_two", "2026-08-21T10:02:00.000Z", "2026-08-21T10:00:35.000Z").job;
  const terminalFailure = failJob(lastAttempt, "worker_two", "RENDER_TIMEOUT", "2026-08-21T10:00:45.000Z").job;

  assert.equal(failed.event.event, "job.failed");
  assert.equal(retry.job.status, "queued");
  assert.equal(lastAttempt.attempt, 2);
  assert.throws(() => requeueJob(terminalFailure, "2026-08-21T10:00:50.000Z"), /retry limit/);
});
