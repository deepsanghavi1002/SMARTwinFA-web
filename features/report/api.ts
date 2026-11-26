import type { StartupSelection } from "../startup/StartupGate";
import type { ReportOutput } from "../../lib/report/types";
import { unpackOutput } from "../../lib/report/wire";
import type { PackedOutput } from "../../lib/report/wire";

/** A selection the desktop refuses (its message box): message and caption. */
export type Refusal = Readonly<{ message: string; caption: string }>;

/** The reply as JSON; a reply that is not JSON (a proxy's timeout or size-limit page, a crashed server) is reported with its HTTP status instead of "JSON.parse: unexpected character". */
async function readJson<B>(response: Response, action: string): Promise<B> {
  const text = await response.text();
  try { return JSON.parse(text) as B; } catch {
    const hint = response.status === 413 ? "the request was too large" : response.status === 502 || response.status === 503 || response.status === 504 ? "the server did not answer in time (the report may be too big or slow; narrow the products or dates)" : "the server returned an unexpected reply";
    throw new Error(`Request ${action} failed (HTTP ${response.status}): ${hint}.${text.trim() !== "" ? ` ${text.trim().replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
  }
}

/** One call to /api/report. Errors come back as a thrown Error; a refusal as { refusal }. */
export async function reportCall<T>(selection: StartupSelection, reportName: string, menuShortName: string, action: string, payload: Record<string, unknown> = {}): Promise<T & { refusal?: Refusal }> {
  const response = await fetch("/api/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      action,
      reportName,
      menuShortName,
      session: { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName },
      ...payload,
    }),
  });
  const body = await readJson<T & { error?: string; refusal?: Refusal; output?: ReportOutput | PackedOutput }>(response, action);
  if (!response.ok || body.error) throw new Error(body.error || `Report request ${action} failed`);
  // A report's rows come packed (lib/report/wire.ts): back to the rows the screens use.
  if (body.output) body.output = unpackOutput(body.output);
  return body;
}

/** One call to /api/report-schedules (emailing a saved view). A refusal is thrown with its own message. */
export async function emailCall<T>(selection: StartupSelection, reportName: string, menuShortName: string, action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch("/api/report-schedules", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ action, reportName, menuShortName, companyId: Number(selection.companyId), yearKey: selection.yearKey, ...payload }),
  });
  const body = await readJson<T & { error?: string; refusal?: string }>(response, action);
  if (!response.ok || body.error || body.refusal) throw new Error(body.refusal || body.error || `Email request ${action} failed`);
  return body;
}

/** One call to /api/report/views (a report's saved views). */
export async function viewsCall<T>(selection: StartupSelection, reportName: string, menuShortName: string, action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch("/api/report/views", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ action, reportName, menuShortName, session: { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName }, ...payload }),
  });
  const body = await readJson<T & { error?: string }>(response, action);
  if (!response.ok || body.error) throw new Error(body.error || `Views request ${action} failed`);
  return body;
}
