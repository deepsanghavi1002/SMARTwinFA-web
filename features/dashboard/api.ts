import type { StartupSelection } from "../startup/StartupGate";

/** One call to /api/dashboard. Errors come back as a thrown Error with the server's message. */
export async function dashCall<T>(selection: StartupSelection, entryName: string, menuShortName: string, action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch("/api/dashboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      action,
      entryName,
      menuShortName,
      session: { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName },
      ...payload,
    }),
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok || body.error) throw new Error(body.error || `Dashboard request ${action} failed`);
  return body;
}
