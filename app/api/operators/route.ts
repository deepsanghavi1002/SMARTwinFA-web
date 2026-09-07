import { readOperators } from "@/lib/company-menu";

export async function GET() {
  try {
    return Response.json({ operators: await readOperators() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Operator list error:", error);
    const message = error instanceof Error ? error.message : "Operator list could not be loaded";
    return Response.json({ error: message }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
