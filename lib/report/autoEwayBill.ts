import type { Loader } from "../master-program/load";
import { ResultTable } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { runReportSql } from "./run";

/**
 * 147: AUTO EWAY BILL (SP_FRT_RPT_AUTO_EWAYBILL; Transaction > Auto Entry > Eway Bill Generate).
 * The sale vouchers (book 8) of the Upto date that have no E-way bill no yet (first combo "EWay Bill"), else no e-invoice acknowledgement no yet: the supply, document and
 * transport details the voucher carries, the party's first address (with its state) and the entry addon's vehicle no. The distance is the party's (the account addon's Km).
 * In voucher order. The output grid's Ctrl+I reads led_key, code and distance_km of these rows.
 */
export async function autoEwayBill(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const pending = call.fcText.trim() === "EWay Bill" ? "coalesce(led.eway_billno, '') = ''" : "coalesce(led.einv_ackno, '') = ''";
  const lines = (await runReportSql(loader, `SELECT led.led_key, led.code, led.full_docno AS doc_no,`
    + ` CASE WHEN led.supply_type = 0 THEN 'Inward' ELSE 'Outward' END AS supply_type,`
    + ` CASE led.sub_supply_type WHEN 0 THEN 'Supply' WHEN 1 THEN 'Import' WHEN 2 THEN 'Export' WHEN 3 THEN 'Job Work' WHEN 4 THEN 'For Own Use' WHEN 5 THEN 'Job work Returns' WHEN 6 THEN 'Sales Return'`
    + ` WHEN 7 THEN 'Others' WHEN 8 THEN 'SKD/CKD' WHEN 9 THEN 'Line Sales' WHEN 10 THEN 'Recipient  Not Known' ELSE 'Exhibition or Fairs' END AS sub_supply_type,`
    + ` CASE led.eway_doc_type WHEN 0 THEN 'Tax Invoice' WHEN 1 THEN 'Bill of Supply' WHEN 2 THEN 'Bill of Entry' WHEN 3 THEN 'Delivery Challan' WHEN 4 THEN 'Credit Note' ELSE 'Others' END AS eway_doc_type,`
    + ` CASE led.trp_mode WHEN 0 THEN 'Road' WHEN 1 THEN 'Rail' WHEN 2 THEN 'Air' ELSE 'Ship' END AS trp_mode, adata.input_km AS distance_km,`
    + ` CASE WHEN led.eway_veh_type = 0 THEN 'Reguler' ELSE 'Over Dimensional' END AS eway_veh_type, ac.name, addr.address_1, addr.address_2, addr.city, addr.pin_code, addr.gst_no,`
    + ` idopt.opt_desc, idopt.opt_short, led.amount, aent.input_vehno`
    + ` FROM ${db}ledger led LEFT JOIN ${db}account ac ON ac.code = led.code LEFT JOIN ${db}address addr ON addr.code = ac.code LEFT JOIN ${db}idopt_master idopt ON idopt.idopt_key = addr.state_id`
    + ` LEFT JOIN ${db}addon_aentry aent ON aent.aona_ledid = led.led_key LEFT JOIN ${db}addon_data adata ON adata.code = ac.code`
    + ` WHERE led.doc_pos <> 'D' AND addr.address_id = 1 AND ${pending} AND led.doc_date = $1::date AND led.book = 8 ORDER BY led.doc_no`, [desktopDate(call.upto)])).rows;

  const table = new ResultTable();
  const columns = ["led_key", "code", "DOC_NO", "supply_type", "sub_supply_type", "eway_doc_type", "trp_mode", "distance_km", "eway_veh_type", "name", "address_1", "address_2", "city", "pin_code", "gst_no", "opt_Desc", "opt_short", "amount", "input_vehno"];
  for (const column of columns) table.addColumn(column);
  table.setKind("amount", "decimal");
  table.rows = lines.map((row) => ({ led_key: row.led_key, code: row.code, DOC_NO: row.doc_no, supply_type: row.supply_type, sub_supply_type: row.sub_supply_type, eway_doc_type: row.eway_doc_type, trp_mode: row.trp_mode,
    distance_km: row.distance_km, eway_veh_type: row.eway_veh_type, name: row.name, address_1: row.address_1, address_2: row.address_2, city: row.city, pin_code: row.pin_code, gst_no: row.gst_no,
    opt_Desc: row.opt_desc, opt_short: row.opt_short, amount: row.amount, input_vehno: row.input_vehno }));
  return table;
}
