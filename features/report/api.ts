import type { StartupSelection } from "../startup/StartupGate";

/** A selection the desktop refuses (its message box): message and caption. */
export type Refusal = Readonly<{ message: string; caption: string }>;

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
  const body = await response.json() as T & { error?: string; refusal?: Refusal };
  if (!response.ok || body.error) throw new Error(body.error || `Report request ${action} failed`);
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
  const body = await response.json() as T & { error?: string };
  if (!response.ok || body.error) throw new Error(body.error || `Views request ${action} failed`);
  return body;
}
