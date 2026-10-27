import { logEvent, requestIdOf, scrub } from "./log.ts";

/**
 * Browser error reports (window error, unhandled rejection, React error boundary). The route is open
 * to signed-out users so the sign-in screen can report too, which is why it is capped on every side:
 * body size, field length, and how many reports one address and the whole server accept per minute.
 */
export const MAX_BODY_BYTES = 8 * 1024;
export const PER_CLIENT_PER_MINUTE = 10;
export const PER_SERVER_PER_MINUTE = 120;

const WINDOW_MS = 60_000;
const buckets = new Map<string, { start: number; count: number }>();

function allow(key: string, limit: number, now: number): boolean {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    if (buckets.size > 2000) for (const [name, old] of buckets) if (now - old.start >= WINDOW_MS) buckets.delete(name);
    buckets.set(key, { start: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

export function resetClientLogLimits(): void {
  buckets.clear();
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? scrub(value.slice(0, max)) : "";
}

/** Strips the query string and fragment: they can carry set-password tokens. */
function pageOf(value: unknown): string {
  const raw = typeof value === "string" ? value.slice(0, 500) : "";
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return raw.split(/[?#]/)[0];
  }
}

function clientAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/** Handles one report and returns the status to answer with (204 accepted and written, or the refusal). */
export async function handleClientLog(request: Request, now = Date.now()): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return Response.json({ error: "Report too large" }, { status: 413, headers });
  if (!allow(`ip:${clientAddress(request)}`, PER_CLIENT_PER_MINUTE, now) || !allow("all", PER_SERVER_PER_MINUTE, now)) {
    return Response.json({ error: "Too many reports" }, { status: 429, headers });
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return Response.json({ error: "Report too large" }, { status: 413, headers });
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "The report is not JSON" }, { status: 400, headers });
  }
  const message = text(body.message, 1000);
  if (message === "") return Response.json({ error: "A message is required" }, { status: 400, headers });
  const view = body.view === "Modern" ? "Modern" : "Legacy";
  const width = Number(body.screenWidth);
  logEvent("error", message, {
    route: "client",
    action: text(body.source, 40) || "error",
    requestId: requestIdOf(request),
    stack: text(body.stack, 4000) || undefined,
    url: pageOf(body.url),
    view,
    userAgent: text(request.headers.get("user-agent") ?? body.userAgent, 300),
    screenWidth: Number.isFinite(width) ? Math.trunc(width) : undefined,
  });
  return new Response(null, { status: 204, headers });
}
