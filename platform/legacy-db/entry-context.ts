import { legacyPool } from "./pool.ts";
import { legacyCompanySchema } from "./company-schema.ts";

const COMPANY_SCHEMA = legacyCompanySchema();

export type LegacyEntryKind = "invoice" | "voucher";

export type LegacyEntryContext = Readonly<{
  source: "legacy-postgresql";
  readOnly: true;
  kind: LegacyEntryKind;
  books: ReadonlyArray<Readonly<{ key: number; label: string }>>;
  parties: ReadonlyArray<Readonly<{ code: number; label: string; address: string | null }>>;
  products: ReadonlyArray<Readonly<{ key: number; label: string; uom: string | null; saleRate: string; stock: string }>>;
  note: string;
}>;

type BookRow = { book_key: number; label: string | null };
type PartyRow = { code: number; name: string | null; address: string | null };
type ProductRow = { prod_key: number; label: string | null; uom: string | null; sale_rate: string | null; stock: string | null };

/**
 * Lookup data for the desktop Entry form. The C# entry screen uses account,
 * address, product, UOM, price-list and product-balance data while a document
 * is being composed. The web form uses these same PostgreSQL facts and posts
 * its supported header, ledger, product and stock movements as one transaction.
 */
export async function readLegacyEntryContext(kind: LegacyEntryKind): Promise<LegacyEntryContext> {
  const client = await legacyPool().connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '20000ms'");
    const [books, parties, products] = await Promise.all([
      // Invoice entry writes prod_ledger and prod_balance, so it may only offer
      // registers the desktop flags for stock entry (stkm_stkentry = 'Y').
      // Vouchers post ledger lines only and take the remaining registers.
      client.query<BookRow>(`
        SELECT book_key, NULLIF(BTRIM(book_desc), '') AS label
        FROM ${COMPANY_SCHEMA}.book_properties
        WHERE book_key IN (4, 5, 6, 7, 8, 19)
          AND COALESCE(BTRIM(stkm_stkentry), 'N') ${kind === "invoice" ? "=" : "<>"} 'Y'
        ORDER BY book_key
      `),
      client.query<PartyRow>(`
        SELECT a.code, NULLIF(BTRIM(a.name), '') AS name,
               NULLIF(BTRIM(CONCAT_WS(', ', NULLIF(BTRIM(adr.address_1), ''), NULLIF(BTRIM(adr.address_2), ''))), '') AS address
        FROM ${COMPANY_SCHEMA}.account a
        LEFT JOIN ${COMPANY_SCHEMA}.address adr ON adr.code = a.code AND adr.address_id = 1
        WHERE COALESCE(a.a_pos, 'A') <> 'D'
        ORDER BY a.name NULLS LAST, a.code
        LIMIT 600
      `),
      kind === "invoice"
        ? client.query<ProductRow>(`
          SELECT pm.prod_key,
                 COALESCE(NULLIF(BTRIM(pm.prod_short), ''), NULLIF(BTRIM(pm.prod_desc), ''), pm.prod_key::text) AS label,
                 u.uom_short AS uom,
                 COALESCE(price.pl_srate::numeric, 0)::text AS sale_rate,
                 COALESCE(balance.clsg_pcs::numeric, 0)::text AS stock
          FROM ${COMPANY_SCHEMA}.product_master pm
          LEFT JOIN ${COMPANY_SCHEMA}.prod_uom u ON u.uom_key = pm.issuuom_id
          LEFT JOIN LATERAL (
            SELECT pl_srate FROM ${COMPANY_SCHEMA}.pricelist
            WHERE prod_id = pm.prod_key AND COALESCE(pl_pos, 'A') <> 'D' AND COALESCE(pl_srate, 0) > 0
            ORDER BY pl_wefrom DESC NULLS LAST, pl_key DESC LIMIT 1
          ) price ON true
          LEFT JOIN LATERAL (
            SELECT clsg_pcs FROM ${COMPANY_SCHEMA}.prod_balance
            WHERE prod_id = pm.prod_key AND prec_flag = 'RP'
            ORDER BY prodbal_key DESC LIMIT 1
          ) balance ON true
          WHERE COALESCE(pm.prod_pos, 'A') <> 'D'
          ORDER BY pm.prod_short NULLS LAST, pm.prod_key
          LIMIT 600
        `)
        : Promise.resolve({ rows: [] as ProductRow[] }),
    ]);
    await client.query("COMMIT");
    return {
      source: "legacy-postgresql",
      readOnly: true,
      kind,
      books: books.rows.map((row) => ({ key: row.book_key, label: row.label ?? `BOOK ${row.book_key}` })),
      parties: parties.rows.map((row) => ({ code: row.code, label: row.name ?? `ACCOUNT ${row.code}`, address: row.address })),
      products: products.rows.map((row) => ({ key: row.prod_key, label: row.label ?? `PRODUCT ${row.prod_key}`, uom: row.uom, saleRate: row.sale_rate ?? "0", stock: row.stock ?? "0" })),
      note: "Desktop lookup facts are loaded from the restored PostgreSQL tables. Supported save, cancellation, stock reversal and print-count updates are written as PostgreSQL transactions.",
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
