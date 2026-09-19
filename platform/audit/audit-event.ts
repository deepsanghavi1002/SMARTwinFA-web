import { type TenantContext } from "../context/tenant-context.ts";

export type AuditOutcome = "succeeded" | "denied" | "failed";
export type AuditValue = string | number | boolean | null | readonly AuditValue[] | { readonly [key: string]: AuditValue };

export type AuditEvent = Readonly<{
  id: string;
  occurredAt: string;
  action: string;
  outcome: AuditOutcome;
  actorId: string;
  context: TenantContext;
  resource: Readonly<{ type: string; id: string }>;
  correlationId: string;
  details: Readonly<Record<string, AuditValue>>;
}>;

export class AuditEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditEventError";
  }
}

const sensitiveKey = /(password|secret|token|credential|connection|string|raw_sql|sql_text|authorization)/i;
const identifier = /^[a-z][a-z0-9_.-]{2,99}$/i;

function requireIdentifier(name: string, value: string) {
  if (!identifier.test(value)) throw new AuditEventError(`${name} is invalid`);
  return value;
}

function redact(value: AuditValue): AuditValue {
  if (Array.isArray(value)) return Object.freeze(value.map(redact));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sensitiveKey.test(key) ? "[redacted]" : redact(nested)])));
  }
  return value;
}

/** Creates an immutable event with sensitive values removed before persistence/logging. */
export function createAuditEvent(input: {
  id: string;
  occurredAt: string;
  action: string;
  outcome: AuditOutcome;
  actorId: string;
  context: TenantContext;
  resource: { type: string; id: string };
  correlationId: string;
  details?: Record<string, AuditValue>;
}): AuditEvent {
  requireIdentifier("event id", input.id);
  requireIdentifier("action", input.action);
  requireIdentifier("actor id", input.actorId);
  requireIdentifier("resource type", input.resource.type);
  requireIdentifier("resource id", input.resource.id);
  requireIdentifier("correlation id", input.correlationId);
  if (Number.isNaN(Date.parse(input.occurredAt))) throw new AuditEventError("occurredAt is invalid");

  return Object.freeze({
    id: input.id,
    occurredAt: input.occurredAt,
    action: input.action,
    outcome: input.outcome,
    actorId: input.actorId,
    context: input.context,
    resource: Object.freeze({ ...input.resource }),
    correlationId: input.correlationId,
    details: Object.freeze(redact(input.details ?? {}) as Record<string, AuditValue>),
  });
}
