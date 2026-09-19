import type { StartupSelection } from "../startup/StartupGate";
import type { GroupState } from "../../lib/master-program/types";

/** One call to /api/master-program. Errors come back as thrown Error with the server's message. */
export async function masterCall<T>(selection: StartupSelection, programName: string, action: string, payload: Record<string, unknown> = {}, group?: GroupState): Promise<T> {
  const response = await fetch("/api/master-program", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      action,
      programName,
      session: { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName },
      group,
      ...payload,
    }),
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok || body.error) throw new Error(body.error || `Master request ${action} failed`);
  return body;
}
