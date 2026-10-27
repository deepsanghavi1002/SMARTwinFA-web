import { readCompanies } from "@/lib/company-menu";
import { requireOperator } from "@/lib/auth/request";
import { logError } from "@/lib/log";

/** The companies the session's operator may open in one year. A `login` query parameter is ignored. */
export async function GET(request: Request) {
  const headers = { "cache-control": "no-store" };
  const operator = await requireOperator(request, headers);
  if (operator instanceof Response) return operator;
  const year = (new URL(request.url).searchParams.get("year") || "").trim();
  if (!/^\d{1,9}$/.test(year)) {
    return Response.json({ error: "An accounting year is required" }, { status: 400, headers });
  }
  try {
    return Response.json({ companies: await readCompanies(operator, Number(year)) }, { headers });
  } catch (error) {
    const requestId = logError({ request, route: "/api/companies", action: "Company list", error, userId: operator });
    const message = error instanceof Error ? error.message : "Company list could not be loaded";
    return Response.json({ error: message, requestId }, { status: 503, headers });
  }
}
