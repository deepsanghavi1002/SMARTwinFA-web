import { trustedDevelopmentEnabled } from "@/lib/master-program/access";

/**
 * TEMPORARY, for testing only: when .env.local has SMARTWINFA_SKIP_LOGIN, the startup screen
 * skips the login form and signs in as that operator (or the first operator when the value is
 * "true"), then shows the company selection. It works only together with
 * SMARTWINFA_TRUSTED_LOCAL_MODE=true. Remove the variable (and this route) before launch.
 */
export async function GET() {
  const skip = (process.env.SMARTWINFA_SKIP_LOGIN ?? "").trim();
  const enabled = trustedDevelopmentEnabled(process.env.SMARTWINFA_TRUSTED_LOCAL_MODE) && skip !== "" && skip.toLowerCase() !== "false";
  return Response.json(
    { skip: enabled, login: enabled && skip.toLowerCase() !== "true" ? skip.slice(0, 60) : null },
    { headers: { "cache-control": "no-store" } },
  );
}
