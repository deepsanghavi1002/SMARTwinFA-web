export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawGroup = url.searchParams.get("group");
  const group = rawGroup && /^\d+$/.test(rawGroup) ? Number(rawGroup) : null;
  const rawYear = url.searchParams.get("year");
  const year = rawYear && /^\d{16}$/.test(rawYear) ? rawYear : null;
  const query = (url.searchParams.get("q") || "").trim().slice(0, 120);
  const rawPage = url.searchParams.get("page");
  const page = rawPage && /^\d+$/.test(rawPage) ? Math.max(1, Number(rawPage)) : 1;
  const rawPageSize = url.searchParams.get("pageSize");
  const pageSize = rawPageSize && /^\d+$/.test(rawPageSize) ? Math.min(500, Math.max(25, Number(rawPageSize))) : 250;

  try {
    const serviceUrl = process.env.LEGACY_API_URL?.trim();
    if (!serviceUrl) throw new Error("Legacy data service is not configured");
    const target = new URL("/product-master", serviceUrl);
    if (group !== null) target.searchParams.set("group", String(group));
    if (year !== null) target.searchParams.set("year", year);
    if (query) target.searchParams.set("q", query);
    target.searchParams.set("page", String(page));
    target.searchParams.set("pageSize", String(pageSize));
    const response = await fetch(target, { headers: { accept: "application/json" }, cache: "no-store" });
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Product Master data could not be loaded";
    return Response.json({ error: message }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

export async function POST(request: Request) {
  try {
    const serviceUrl = process.env.LEGACY_API_URL?.trim(); if (!serviceUrl) throw new Error("Legacy data service is not configured");
    const body = await request.text(); if (body.length > 32768) return Response.json({ error: "Request is too large" }, { status: 413 });
    const response = await fetch(new URL("/product-master/record", serviceUrl), { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body, cache: "no-store" });
    return new Response(await response.text(), { status: response.status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Product Master record could not be saved" }, { status: 503 }); }
}
