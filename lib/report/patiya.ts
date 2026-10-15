import type { Loader } from "../master-program/load";
import type { ResultTable } from "./call";
import type { ReportPlan } from "./generate";
import { tableFromResult } from "./library";
import { ReportRefusal } from "./refusal";
import { runReportSql } from "./run";

/**
 * 150: PATIYA (REPORT_PATIYA, SP_FRT_RP_PATIYA; SPECIAL > Extra Report (RP) > Patiya, Rishabh Plastic's dispatch slip).
 *
 * The sale vouchers (book 8) ticked in the Invoice help, a line for each product on them: voucher no, date, party (the account's name, or the
 * contact for a delivery address other than the first), city, transport, lot, description, box, loose, quantity, the transport's area and load
 * (the ADDON_SUB's LST_NO / CST_NO), the voucher's remark (LOCATION), the product's specification and mould code; in the order of area, load,
 * voucher number (right-aligned), date and mould code. "Only Pending Eway Bill Require" keeps the vouchers with no e-way bill or no e-invoice
 * number yet (or 'A'). One read.
 */
export async function patiya(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const keys = call.selectKey[4].trim();
  if (keys !== "" && !/^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(keys)) throw new ReportRefusal("Select the invoices (Invoice group)", "INTERNAL PROGRAM FAILURE");
  const sql = `SELECT ltrim(rtrim(led.doc_no)) AS full_docno, to_char(led.doc_date, 'DD-Mon-YY') AS "Date", (CASE WHEN addr.address_id = 1 THEN ac.name ELSE addr.contact END) AS name, addr.city,`
    + ` aent.txt_trans AS "Transport", prodled.lot_no, prodmas.prod_desc AS "Description", prodled.bundle AS "Box", prodled.loose_qty AS "LOOSE", prodled.quantity,`
    + ` coalesce(asub.lst_no, '') AS "Area", coalesce(asub.cst_no, '') AS "Load", coalesce(led.doc_remark, '') AS "LOCATION", coalesce(adata.input_remark, '') AS "Specification", coalesce(adata.input_mouldcode, '') AS "MOULDCODE"`
    + ` FROM ${db}ledger led LEFT JOIN ${db}account ac ON ac.code = led.code LEFT JOIN ${db}prod_ledger prodled ON prodled.led_id = led.led_key`
    + ` LEFT JOIN ${db}product_master prodmas ON prodmas.prod_key = prodled.prod_id LEFT JOIN ${db}addon_aentry aent ON aent.aona_ledid = led.led_key`
    + ` LEFT JOIN ${db}address addr ON addr.code = ac.code AND addr.address_id = led.ent_address_id LEFT JOIN ${db}addon_sub asub ON aent.key_trans = asub.sub_code`
    + ` LEFT JOIN ${db}addon_data adata ON adata.prod_id = prodled.prod_id`
    + ` WHERE led.doc_pos <> 'D' AND prodled.il_pos <> 'D' AND ac.a_pos <> 'D' AND prodmas.prod_pos <> 'D' AND led.book = 8`
    + (call.checkQuery.includes("CHK_PENDEWAY,") ? ` AND (upper(led.eway_billno) = 'A' OR coalesce(led.eway_billno, '') = '' OR upper(led.einv_irnno) = 'A' OR coalesce(led.einv_irnno, '') = '')` : "")
    + (keys !== "" ? ` AND led.led_key IN ${keys}` : "")
    + ` ORDER BY asub.lst_no, asub.cst_no, right(repeat(' ', 20) || led.doc_no, 10), led.doc_date, adata.input_mouldcode`;
  const table = tableFromResult(await runReportSql(loader, sql));
  for (const column of ["Box", "LOOSE", "quantity"]) if (table.has(column)) table.setKind(column, "decimal");
  return table;
}
