const kinds = new Set(["daybook", "ledger", "outstanding", "trial-balance", "closing-stock", "top-sales", "cash-bank-voucher", "journal-voucher", "discount-voucher", "lock-status", "stock-movement", "partywise-stock", "daily-transaction", "target-register", "book-series", "opening-balance", "tax-setup", "document-register", "e-invoice-register", "e-way-bill-register", "configuration", "sales-distribution"]);

export async function GET(request: Request, context: { params: Promise<{ kind: string }> }) {
  const { kind } = await context.params;
  if (!kinds.has(kind)) return Response.json({ error: "Unknown legacy report" }, { status: 404 });
  try {
    const serviceUrl = process.env.LEGACY_API_URL?.trim();
    if (!serviceUrl) throw new Error("Legacy data service is not configured");
    const target = new URL(`/report/${kind}`, serviceUrl);
    const source = new URL(request.url);
    for (const key of ["from", "upto", "q", "variant"]) {
      const value = source.searchParams.get(key);
      if (value) target.searchParams.set(key, value);
    }
    const response = await fetch(target, { headers: { accept: "application/json" }, cache: "no-store" });
    return new Response(await response.text(), { status: response.status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report data could not be loaded";
    return Response.json({ error: message }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
