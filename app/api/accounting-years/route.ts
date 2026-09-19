import { readAccountingYears } from "@/lib/company-menu";

export async function GET(request: Request) {
  const login = (new URL(request.url).searchParams.get("login") || "").trim().slice(0, 60);
  if (!login) {
    return Response.json({ error: "An operator is required" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  try {
    return Response.json({ years: await readAccountingYears(login) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Accounting year list error:", error);
    const message = error instanceof Error ? error.message : "Accounting years could not be loaded";
    return Response.json({ error: message }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
