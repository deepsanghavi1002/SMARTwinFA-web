const kinds = new Set(["invoice", "voucher"]);

export async function GET(request: Request) {
  const source = new URL(request.url);
  const kind = source.searchParams.get("kind") || "invoice";
  if (!kinds.has(kind)) return Response.json({ error: "Unknown desktop entry kind" }, { status: 404 });
  try {
    const serviceUrl = process.env.LEGACY_API_URL?.trim();
    if (!serviceUrl) throw new Error("Legacy data service is not configured");
    const target = new URL(`/entry-context?kind=${kind}`, serviceUrl);
    const query = source.searchParams.get("q")?.trim().slice(0, 100);
    if (query) target.searchParams.set("q", query);
    const response = await fetch(target, { headers: { accept: "application/json" }, cache: "no-store" });
    return new Response(await response.text(), { status: response.status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Desktop entry lookup data could not be loaded";
    return Response.json({ error: message }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
