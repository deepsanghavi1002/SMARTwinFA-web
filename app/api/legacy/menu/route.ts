export async function GET() {
  try {
    const serviceUrl = process.env.LEGACY_API_URL?.trim();
    if (!serviceUrl) throw new Error("Legacy data service is not configured");
    const response = await fetch(new URL("/menu-catalog", serviceUrl), { headers: { accept: "application/json" }, cache: "no-store" });
    return new Response(await response.text(), { status: response.status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Menu catalog could not be loaded";
    return Response.json({ error: message }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
