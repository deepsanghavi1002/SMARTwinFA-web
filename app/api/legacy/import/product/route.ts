export async function POST(request: Request) {
  try {
    const serviceUrl = process.env.LEGACY_API_URL?.trim();
    if (!serviceUrl) throw new Error("Legacy data service is not configured");
    const body = await request.text();
    if (body.length > 262144) return Response.json({ error: "Import request is too large" }, { status: 413 });
    const response = await fetch(new URL("/product-import", serviceUrl), { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body, cache: "no-store" });
    return new Response(await response.text(), { status: response.status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Product import could not be completed" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
