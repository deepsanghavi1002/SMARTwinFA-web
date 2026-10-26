import { readAccountingYears } from "@/lib/company-menu";
import { requireOperator } from "@/lib/auth/request";

/** The years the session's operator may open. A `login` query parameter is ignored. */
export async function GET(request: Request) {
  const headers = { "cache-control": "no-store" };
  const operator = await requireOperator(request, headers);
  if (operator instanceof Response) return operator;
  try {
    return Response.json({ years: await readAccountingYears(operator) }, { headers });
  } catch (error) {
    console.error("Accounting year list error:", error);
    const message = error instanceof Error ? error.message : "Accounting years could not be loaded";
    return Response.json({ error: message }, { status: 503, headers });
  }
}
