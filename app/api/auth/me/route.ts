import { readOperator } from "@/lib/company-menu";
import { publicUser } from "@/lib/auth/public-user";
import { currentUser, signInRequired } from "@/lib/auth/request";

/**
 * The signed-in user and the operator they open the books as. `operator` is null for a platform
 * admin who has not chosen one yet, and for a user whose linked operator is missing or deleted.
 */
export async function GET(request: Request) {
  const headers = { "cache-control": "no-store" };
  try {
    const user = await currentUser(request);
    if (!user) return signInRequired(headers);
    const operator = user.operator ? await readOperator(user.operator) : null;
    const problem = !operator && user.operator
      ? `The operator ${user.operator} is not present in the company system database`
      : !operator && !user.operator && user.role !== "platform_admin"
        ? "No operator is linked to this user yet. Ask your administrator to link one."
        : null;
    return Response.json({ user: publicUser(user), operator, problem }, { headers });
  } catch (error) {
    console.error("Session read error:", error instanceof Error ? error.message : error);
    return Response.json({ error: "The session could not be read" }, { status: 503, headers });
  }
}
