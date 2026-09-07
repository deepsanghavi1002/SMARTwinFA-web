import { readCompanies } from "@/lib/company-menu";

export async function GET(request: Request) {
  const parameters = new URL(request.url).searchParams;
  const login = (parameters.get("login") || "").trim().slice(0, 60);
  const year = (parameters.get("year") || "").trim();
  if (!login) {
    return Response.json({ error: "An operator is required" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  if (!/^\d{1,9}$/.test(year)) {
    return Response.json({ error: "An accounting year is required" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  try {
    return Response.json({ companies: await readCompanies(login, Number(year)) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Company list error:", error);
    const message = error instanceof Error ? error.message : "Company list could not be loaded";
    return Response.json({ error: message }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
