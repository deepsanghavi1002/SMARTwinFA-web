import { readOperators } from "@/lib/company-menu";
import { currentUser, signInRequired } from "@/lib/auth/request";
import { canManageUsers } from "@/lib/auth/roles";
import { logError } from "@/lib/log";

/** Every active desktop operator, for admins only: a platform admin picks one to work as, admins link users to them. */
export async function GET(request: Request) {
  const headers = { "cache-control": "no-store" };
  try {
    const user = await currentUser(request);
    if (!user) return signInRequired(headers);
    if (!canManageUsers(user.role)) return Response.json({ error: "Only an administrator sees the operator list" }, { status: 403, headers });
    return Response.json({ operators: await readOperators() }, { headers });
  } catch (error) {
    const requestId = logError({ request, route: "/api/operators", action: "Operator list", error });
    const message = error instanceof Error ? error.message : "Operator list could not be loaded";
    return Response.json({ error: message, requestId }, { status: 503, headers });
  }
}
