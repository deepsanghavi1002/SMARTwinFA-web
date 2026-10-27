import { transaction } from "@/lib/db";
import { readOperator } from "@/lib/company-menu";
import { currentUser, signInRequired } from "@/lib/auth/request";
import { activeOperatorLogin, audit, setSessionOperator } from "@/lib/auth/store";
import { logError } from "@/lib/log";

/** A platform admin chooses which legacy operator this session opens the books as. Nobody else may. */
export async function POST(request: Request) {
  const headers = { "cache-control": "no-store" };
  let body: { operator?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  try {
    const user = await currentUser(request);
    if (!user) return signInRequired(headers);
    if (user.role !== "platform_admin") return Response.json({ error: "Only a platform admin chooses the operator" }, { status: 403, headers });
    const wanted = typeof body?.operator === "string" ? body.operator.trim().slice(0, 60) : "";
    if (!wanted) return Response.json({ error: "Choose an operator" }, { status: 400, headers });
    const login = await transaction(async (client) => {
      const found = await activeOperatorLogin(client, wanted);
      if (!found) return null;
      await setSessionOperator(client, user.sessionHash, found);
      await audit(client, user.id, "operator.chosen", user.id, { operator: found });
      return found;
    }, { timeoutMs: 5000 });
    if (!login) return Response.json({ error: `The operator ${wanted} is not present in the company system database` }, { status: 400, headers });
    return Response.json({ operator: await readOperator(login) }, { headers });
  } catch (error) {
    const requestId = logError({ request, route: "/api/auth/operator", action: "Operator choice", error });
    return Response.json({ error: "The operator could not be chosen right now", requestId }, { status: 503, headers });
  }
}
