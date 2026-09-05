import { createServer } from "node:http";
import { readLegacyAccountMaster } from "../../platform/legacy-db/account-master.ts";
import { readLegacyProductMaster } from "../../platform/legacy-db/product-master.ts";
import { readLegacyAddonMaster, writeLegacyAddonField, writeLegacyAddonOption } from "../../platform/legacy-db/addon-master.ts";
import { readLegacyStartupContext } from "../../platform/legacy-db/startup-context.ts";
import { readLegacyInvoiceRegister } from "../../platform/legacy-db/invoice-register.ts";
import { readLegacyEntryContext, type LegacyEntryKind } from "../../platform/legacy-db/entry-context.ts";
import { readLegacyReport, type LegacyReportKind } from "../../platform/legacy-db/report-register.ts";
import { readLegacyMenuCatalog } from "../../platform/legacy-db/menu-catalog.ts";
import { writeLegacyMaster } from "../../platform/legacy-db/master-write.ts";
import { importLegacyProducts } from "../../platform/legacy-db/product-import.ts";
import { postLegacyEntry } from "../../platform/legacy-db/entry-post.ts";
import { changeLegacyBookLock } from "../../platform/legacy-db/book-lock.ts";
import { cancelLegacyEntry } from "../../platform/legacy-db/entry-cancel.ts";
import { recordLegacyDocumentPrint } from "../../platform/legacy-db/document-print.ts";

const port = Number(process.env.PORT || 8080);

function json(response: import("node:http").ServerResponse, status: number, body: unknown) {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(serialized),
    "cache-control": "no-store",
  });
  response.end(serialized);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "legacy-api"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    return json(response, 200, { status: "ok", service: "smartwinfa-legacy-api" });
  }
  if (request.method === "POST" && url.pathname === "/addon-master/option") {
    try {
      let raw = "";
      for await (const chunk of request) { raw += chunk; if (raw.length > 8192) throw new Error("Request is too large"); }
      return json(response, 200, await writeLegacyAddonOption(JSON.parse(raw || "{}")));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Add-on value could not be saved";
      return json(response, /changed|exists|Invalid|required|disabled|longer exists/.test(message) ? 409 : 503, { error: message });
    }
  }
  if (request.method === "POST" && url.pathname === "/addon-master/field") {
    try {
      let raw = "";
      for await (const chunk of request) { raw += chunk; if (raw.length > 8192) throw new Error("Request is too large"); }
      return json(response, 200, await writeLegacyAddonField(JSON.parse(raw || "{}")));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Add-on field could not be saved";
      return json(response, /changed|assigned|Invalid|required|disabled|Choose|Reload|supported|valid/.test(message) ? 409 : 503, { error: message });
    }
  }
  const masterWrite = /^\/(account|product)-master\/record$/.exec(url.pathname);
  if (request.method === "POST" && masterWrite) {
    try {
      let raw = ""; for await (const chunk of request) { raw += chunk; if (raw.length > 32768) throw new Error("Request is too large"); }
      return json(response, 200, await writeLegacyMaster(masterWrite[1] as "account" | "product", JSON.parse(raw || "{}")));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Master record could not be saved";
      return json(response, /changed|exists|Invalid|required|disabled|Reload|writable/.test(message) ? 409 : 503, { error: message });
    }
  }
  if (request.method === "POST" && url.pathname === "/product-import") {
    try {
      let raw = ""; for await (const chunk of request) { raw += chunk; if (raw.length > 262144) throw new Error("Import request is too large"); }
      return json(response, 200, await importLegacyProducts(JSON.parse(raw || "{}")));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Product import could not be completed";
      return json(response, /exists|Invalid|required|Select|Import|disabled|Duplicate/.test(message) ? 409 : 503, { error: message });
    }
  }
  if (request.method === "POST" && url.pathname === "/entry/post") {
    try {
      let raw = ""; for await (const chunk of request) { raw += chunk; if (raw.length > 131072) throw new Error("Request is too large"); }
      return json(response, 200, await postLegacyEntry(JSON.parse(raw || "{}")));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Entry could not be posted";
      return json(response, /required|exists|balance|disabled|no longer|active|Invalid/.test(message) ? 409 : 503, { error: message });
    }
  }
  if (request.method === "POST" && url.pathname === "/book-lock") {
    try { let raw = ""; for await (const chunk of request) { raw += chunk; if (raw.length > 8192) throw new Error("Request is too large"); } return json(response, 200, await changeLegacyBookLock(JSON.parse(raw || "{}"))); }
    catch (error) { const message = error instanceof Error ? error.message : "Lock change failed"; return json(response, 409, { error: message }); }
  }
  if (request.method === "POST" && url.pathname === "/entry/cancel") {
    try { let raw = ""; for await (const chunk of request) raw += chunk; return json(response, 200, await cancelLegacyEntry(JSON.parse(raw || "{}"))); }
    catch (error) { return json(response, 409, { error: error instanceof Error ? error.message : "Cancellation failed" }); }
  }
  if (request.method === "POST" && url.pathname === "/document/print") {
    try { let raw = ""; for await (const chunk of request) raw += chunk; return json(response, 200, await recordLegacyDocumentPrint(JSON.parse(raw || "{}"))); }
    catch (error) { return json(response, 409, { error: error instanceof Error ? error.message : "Print recording failed" }); }
  }
  if (request.method !== "GET") {
    return json(response, 404, { error: "Not found" });
  }

  if (url.pathname === "/menu-catalog") {
    try {
      return json(response, 200, await readLegacyMenuCatalog());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Menu catalog could not be loaded";
      return json(response, 503, { error: message });
    }
  }

  if (url.pathname === "/entry-context") {
    const kind = url.searchParams.get("kind");
    if (kind !== "invoice" && kind !== "voucher") return json(response, 404, { error: "Unknown desktop entry kind" });
    try {
      return json(response, 200, await readLegacyEntryContext(kind as LegacyEntryKind, (url.searchParams.get("q") || "").trim().slice(0, 100)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Desktop entry lookup data could not be loaded";
      return json(response, 503, { error: message });
    }
  }

  const reportMatch = /^\/report\/(daybook|ledger|outstanding|trial-balance|closing-stock|top-sales|cash-bank-voucher|journal-voucher|discount-voucher|lock-status|stock-movement|partywise-stock|daily-transaction|target-register|book-series|opening-balance|tax-setup|document-register|e-invoice-register|e-way-bill-register|configuration|sales-distribution)$/.exec(url.pathname);
  if (reportMatch) {
    try {
      const from = url.searchParams.get("from") || undefined;
      const upto = url.searchParams.get("upto") || undefined;
      const query = (url.searchParams.get("q") || "").trim().slice(0, 120) || undefined;
      const variant = (url.searchParams.get("variant") || "").trim().slice(0, 40) || undefined;
      return json(response, 200, await readLegacyReport(reportMatch[1] as LegacyReportKind, { from, upto, query, variant }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Report data could not be loaded";
      return json(response, 503, { error: message });
    }
  }
  if (!["/account-master", "/product-master", "/addon-master", "/startup-context", "/invoice-register"].includes(url.pathname)) return json(response, 404, { error: "Not found" });

  if (url.pathname === "/startup-context") {
    try {
      return json(response, 200, await readLegacyStartupContext());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Startup data could not be loaded";
      return json(response, 503, { error: message });
    }
  }

  if (url.pathname === "/invoice-register") {
    const query = (url.searchParams.get("q") || "").trim().slice(0, 120);
    const rawPage = url.searchParams.get("page");
    const page = rawPage && /^\d+$/.test(rawPage) ? Math.max(1, Number(rawPage)) : 1;
    const rawPageSize = url.searchParams.get("pageSize");
    const pageSize = rawPageSize && /^\d+$/.test(rawPageSize) ? Math.min(250, Math.max(25, Number(rawPageSize))) : 100;
    try {
      return json(response, 200, await readLegacyInvoiceRegister({ query, page, pageSize }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sale Invoice data could not be loaded";
      return json(response, 503, { error: message });
    }
  }

  if (url.pathname === "/addon-master") {
    const rawRelation = (url.searchParams.get("relation") || "").trim().toUpperCase();
    const relation = /^[A-Z]$/.test(rawRelation) ? rawRelation : null;
    try {
      return json(response, 200, await readLegacyAddonMaster(relation));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Addon Master data could not be loaded";
      return json(response, 503, { error: message });
    }
  }

  if (url.pathname === "/product-master") {
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
      return json(response, 200, await readLegacyProductMaster({ group, year, query, page, pageSize }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Product Master data could not be loaded";
      return json(response, 503, { error: message });
    }
  }

  const rawBook = url.searchParams.get("book");
  const book = rawBook && /^\d+$/.test(rawBook) ? Number(rawBook) : null;
  const rawYear = url.searchParams.get("year");
  const year = rawYear && /^\d{16}$/.test(rawYear) ? rawYear : null;
  try {
    return json(response, 200, await readLegacyAccountMaster(book, year));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Account Master data could not be loaded";
    return json(response, 503, { error: message });
  }
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`smartwinfa-legacy-api listening on ${port}\n`);
});
