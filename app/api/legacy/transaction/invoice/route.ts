export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim().slice(0, 120);
  const rawPage = url.searchParams.get("page");
  const page = rawPage && /^\d+$/.test(rawPage) ? Math.max(1, Number(rawPage)) : 1;
  const rawPageSize = url.searchParams.get("pageSize");
  const pageSize = rawPageSize && /^\d+$/.test(rawPageSize) ? Math.min(250, Math.max(25, Number(rawPageSize))) : 100;
  try {
    const serviceUrl = process.env.LEGACY_API_URL?.trim();
    if (!serviceUrl) throw new Error("Legacy data service is not configured");
    const target = new URL("/invoice-register", serviceUrl);
    if (query) target.searchParams.set("q", query);
    target.searchParams.set("page", String(page));
    target.searchParams.set("pageSize", String(pageSize));
    const response = await fetch(target, { headers: { accept: "application/json" }, cache: "no-store" });
    return new Response(await response.text(), { status: response.status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sale Invoice data could not be loaded";
    return Response.json({ error: message }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
