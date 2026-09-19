export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawRelation = (url.searchParams.get("relation") || "").trim().toUpperCase();
  const relation = /^[A-Z]$/.test(rawRelation) ? rawRelation : null;
  try {
    const serviceUrl = process.env.LEGACY_API_URL?.trim();
    if (!serviceUrl) throw new Error("Legacy data service is not configured");
    const target = new URL("/addon-master", serviceUrl);
    if (relation) target.searchParams.set("relation", relation);
    const response = await fetch(target, { headers: { accept: "application/json" }, cache: "no-store" });
    const body = await response.text();
    return new Response(body, { status: response.status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Addon Master data could not be loaded";
    return Response.json({ error: message }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

export async function POST(request: Request) {
  try {
    const serviceUrl = process.env.LEGACY_API_URL?.trim();
    if (!serviceUrl) throw new Error("Legacy data service is not configured");
    const body = await request.text();
    if (body.length > 8192) return Response.json({ error: "Request is too large" }, { status: 413 });
    const parsed = JSON.parse(body || "{}") as { entity?: string };
    const response = await fetch(new URL(parsed.entity === "field" ? "/addon-master/field" : "/addon-master/option", serviceUrl), { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body, cache: "no-store" });
    return new Response(await response.text(), { status: response.status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Add-on value could not be saved" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
