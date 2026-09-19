import assert from "node:assert/strict";
import test from "node:test";
import { SessionStateError, issueSession, requireActiveSession, revokeSession } from "../platform/auth/session-state.ts";

const issued = issueSession({ id: "session_alice", subjectId: "user_alice", issuedAt: "2026-08-21T00:00:00.000Z", expiresAt: "2026-08-22T00:00:00.000Z" });

test("issues and validates an immutable server-owned session", () => {
  assert.equal(Object.isFrozen(issued), true);
  assert.equal(requireActiveSession(issued, "user_alice", "2026-08-21T12:00:00.000Z"), issued);
});

test("denies cross-identity, expiry, and terminal revocation", () => {
  assert.throws(() => requireActiveSession(issued, "user_bob", "2026-08-21T12:00:00.000Z"), SessionStateError);
  assert.throws(() => requireActiveSession(issued, "user_alice", "2026-08-22T00:00:00.000Z"), /expired/);
  const revoked = revokeSession(issued, "2026-08-21T13:00:00.000Z");
  assert.throws(() => requireActiveSession(revoked, "user_alice", "2026-08-21T14:00:00.000Z"), /revoked/);
});
