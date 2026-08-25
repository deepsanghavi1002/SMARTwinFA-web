export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawBook = url.searchParams.get("book");
  const book = rawBook && /^\d+$/.test(rawBook) ? Number(rawBook) : null;
  const rawYear = url.searchParams.get("year");
  const year = rawYear && /^\d{16}$/.test(rawYear) ? rawYear : null;

  try {
    const serviceUrl = process.env.LEGACY_API_URL?.trim();
    if (!serviceUrl) throw new Error("Legacy data service is not configured");
    const target = new URL("/account-master", serviceUrl);
    if (book !== null) target.searchParams.set("book", String(book));
    if (year !== null) target.searchParams.set("year", year);
    const response = await fetch(target, { headers: { accept: "application/json" }, cache: "no-store" });
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Account Master data could not be loaded";
    return Response.json({ error: message }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

export async function POST(request: Request) {
  try {
    const serviceUrl = process.env.LEGACY_API_URL?.trim(); if (!serviceUrl) throw new Error("Legacy data service is not configured");
    const body = await request.text(); if (body.length > 32768) return Response.json({ error: "Request is too large" }, { status: 413 });
    const response = await fetch(new URL("/account-master/record", serviceUrl), { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body, cache: "no-store" });
    return new Response(await response.text(), { status: response.status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Account Master record could not be saved" }, { status: 503 }); }
}
