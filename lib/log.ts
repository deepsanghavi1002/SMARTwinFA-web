/**
 * One JSON line per event on stdout/stderr, so the fleet's log pipeline (Alloy -> Loki) can read the
 * level and the fields instead of guessing from words. Request bodies, cookies and credentials are
 * never passed in: callers name the route and action, and the error text is scrubbed of anything
 * that looks like a password or token before it is written.
 */
export type LogLevel = "info" | "warn" | "error";

export type LogFields = {
  route?: string;
  action?: string;
  userId?: string | number | null;
  companyKey?: string | number | null;
  requestId?: string;
  [extra: string]: unknown;
};

const MESSAGE_MAX = 1000;
const STACK_MAX = 4000;

/** A short id the 500 response carries, so a user can quote it and the line can be found. */
export function newRequestId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

/** The id the proxy or caller already put on the request, else a new one. */
export function requestIdOf(request?: Request): string {
  const given = request?.headers.get("x-request-id")?.trim();
  return given && /^[\w.-]{6,64}$/.test(given) ? given : newRequestId();
}

/** Blanks values that follow password/token-like words, and long bearer/hex secrets. */
export function scrub(text: string): string {
  return text
    .replace(/((?:pass(?:word|wd)?|pwd|token|secret|api[_-]?key|authorization|cookie)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&)}\]]+)/gi, "$1[redacted]")
    .replace(/\b(bearer|basic)\s+[\w.~+/=-]{8,}/gi, "$1 [redacted]")
    .replace(/\b[a-f0-9]{40,}\b/gi, "[redacted]");
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: clip(scrub(error.message), MESSAGE_MAX), stack: error.stack ? clip(scrub(error.stack), STACK_MAX) : undefined };
  }
  return { message: clip(scrub(typeof error === "string" ? error : safeString(error)), MESSAGE_MAX) };
}

function safeString(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Writes one event. Never throws: logging must not turn a handled error into a failed request. */
export function logEvent(level: LogLevel, message: string, fields: LogFields = {}): void {
  const line = { time: new Date().toISOString(), level, ...fields, message };
  let text: string;
  try {
    text = JSON.stringify(line);
  } catch {
    text = JSON.stringify({ time: line.time, level, message });
  }
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export type ErrorLog = LogFields & { request?: Request; error: unknown; level?: LogLevel };

/** Logs a caught error with its route/action/user/company context and returns the request id for the response. */
export function logError({ request, error, level = "error", ...fields }: ErrorLog): string {
  const requestId = fields.requestId ?? requestIdOf(request);
  const { message, stack } = describeError(error);
  logEvent(level, message, { ...fields, requestId, stack });
  return requestId;
}

export function logWarn(message: string, fields: LogFields = {}): void {
  logEvent("warn", clip(scrub(message), MESSAGE_MAX), fields);
}
