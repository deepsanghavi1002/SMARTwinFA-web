/** Source-independent session lifecycle. Password handling and persistence are deliberately out of scope. */
export type SessionStatus = "active" | "revoked" | "expired";
export type Session = Readonly<{
  id: string;
  subjectId: string;
  issuedAt: string;
  expiresAt: string;
  status: SessionStatus;
  revokedAt?: string;
}>;

export class SessionStateError extends Error {
  constructor(message: string) { super(message); this.name = "SessionStateError"; }
}

function identifier(label: string, value: string) {
  if (!/^[a-z][a-z0-9_-]{2,99}$/i.test(value)) throw new SessionStateError(`${label} is invalid`);
  return value;
}
function timestamp(label: string, value: string) {
  if (Number.isNaN(Date.parse(value))) throw new SessionStateError(`${label} is invalid`);
  return value;
}

/** Issues an immutable, server-owned session record. */
export function issueSession(input: { id: string; subjectId: string; issuedAt: string; expiresAt: string }): Session {
  identifier("session id", input.id); identifier("subject id", input.subjectId);
  timestamp("issuedAt", input.issuedAt); timestamp("expiresAt", input.expiresAt);
  if (Date.parse(input.expiresAt) <= Date.parse(input.issuedAt)) throw new SessionStateError("expiresAt must be after issuedAt");
  return Object.freeze({ ...input, status: "active" as const });
}

/** Validates the session for the current server time and required identity. */
export function requireActiveSession(session: Session, subjectId: string, now: string): Session {
  identifier("subject id", subjectId); timestamp("now", now);
  if (session.subjectId !== subjectId) throw new SessionStateError("session does not belong to this identity");
  if (session.status === "revoked") throw new SessionStateError("session is revoked");
  if (session.status === "expired" || Date.parse(session.expiresAt) <= Date.parse(now)) throw new SessionStateError("session is expired");
  return session;
}

/** Revocation is terminal and produces a separate frozen state record. */
export function revokeSession(session: Session, now: string): Session {
  timestamp("now", now);
  if (session.status !== "active") throw new SessionStateError("only active sessions can be revoked");
  return Object.freeze({ ...session, status: "revoked" as const, revokedAt: now });
}
