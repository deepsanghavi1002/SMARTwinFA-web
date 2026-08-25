const kinds = new Set(["invoice", "voucher"]);

export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind") || "invoice";
  if (!kinds.has(kind)) return Response.json({ error: "Unknown desktop entry kind" }, { status: 404 });
  try {
    const serviceUrl = process.env.LEGACY_API_URL?.trim();
    if (!serviceUrl) throw new Error("Legacy data service is not configured");
    const response = await fetch(new URL(`/entry-context?kind=${kind}`, serviceUrl), { headers: { accept: "application/json" }, cache: "no-store" });
    return new Response(await response.text(), { status: response.status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Desktop entry lookup data could not be loaded";
    return Response.json({ error: message }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
