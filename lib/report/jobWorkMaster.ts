import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import { dateStyle6, desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { num, runReportSql } from "./run";

/**
 * 200: JOB WORK MASTER (REPORT_RPI_JOB_WORK_MASTER, SP_FRT_RPT_RPI_JOB_WORK_MASTER; SPECIAL > Extra Report (RP) > Job Work Master): each job work out entry
 * (JOB-OUT lines of the period) with the job work in entries made against it (ORDER_NO = the job out number: entry, challan, product, quantity) and the expense bills
 * (book 15) made against those (ORDER_NO = the job in number: bill, challan, quantity, amount). The right side is laid on the left line by line: the n-th job in line
 * of a job out goes on its n-th line when that line has no job in yet, else a new line (without the job out product) is added; the n-th bill line of a job in goes
 * on its n-th line, else a new line is added. The procedure's cursors and temp table are done in memory here (the same rules, including the numbering of the lines);
 * the three sides are read once each. By the sorting text (job out date and number, then job in, then bill).
 */
type Rec = {
  sr: number; sort: string; name: string; joutNo: string; joutDate: string; joutYmd: string; joutProd: string; joutQty: number; joutUom: string;
  jinNo: string; jinDate: string; chlnNo: string; chlnDate: string; jinProd: string; jinQty: number; jinUom: string;
  expNo: string; expDate: string; expChln: string; expChlnDate: string; expQty: number; expAmount: number;
};

export async function jobWorkMaster(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const parties = /^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(call.selectKey[4].trim()) ? call.selectKey[4].trim() : "";
  const filter = (column: string) => (parties !== "" ? ` AND ${column} IN ${parties}` : "");
  const style6 = (date: unknown) => (date === null || date === undefined ? "" : dateStyle6(date as Date));
  const ymd = (date: Date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const blank = (): Rec => ({ sr: 0, sort: "", name: "", joutNo: "", joutDate: "", joutYmd: "", joutProd: "", joutQty: 0, joutUom: "", jinNo: "", jinDate: "", chlnNo: "", chlnDate: "", jinProd: "", jinQty: 0, jinUom: "",
    expNo: "", expDate: "", expChln: "", expChlnDate: "", expQty: 0, expAmount: 0 });

  // Left side: the job out lines, numbered within their job out.
  const outs = (await runReportSql(loader, `SELECT joutled.il_date, joutled.full_docno, ac.name, pm.prod_desc, joutled.quantity::numeric AS qty, puom.uom_short`
    + ` FROM ${db}prod_ledger joutled LEFT JOIN ${db}account ac ON joutled.code = ac.code LEFT JOIN ${db}product_master pm ON pm.prod_key = joutled.prod_id LEFT JOIN ${db}prod_uom puom ON puom.uom_key = joutled.rateuom_id`
    + ` WHERE joutled.il_date BETWEEN $1::date AND $2::date AND joutled.stock_nat = 'L' AND joutled.inventory = 'Y' AND joutled.quantity > 0 AND btrim(joutled.trn_module) = 'JOB-OUT'${filter("joutled.code")} ORDER BY joutled.il_key`,
    [desktopDate(call.from), desktopDate(call.upto)])).rows;
  const recs: Rec[] = [];
  const byJout = new Map<string, Rec[]>();
  const bySlot = new Map<string, Rec[]>();
  const slot = (joutNo: string, sr: number) => `${joutNo}\u0000${sr}`;
  const addSlot = (rec: Rec) => { const key = slot(rec.joutNo, rec.sr); const list = bySlot.get(key) ?? []; list.push(rec); bySlot.set(key, list); };
  for (const row of outs) {
    const rec = blank();
    const date = row.il_date as Date;
    rec.joutNo = toText(row.full_docno);
    const list = byJout.get(rec.joutNo) ?? [];
    list.push(rec);
    byJout.set(rec.joutNo, list);
    rec.sr = list.length;
    rec.joutYmd = ymd(date);
    rec.sort = `${rec.joutYmd} ${rec.joutNo}`;
    rec.name = toText(row.name);
    rec.joutDate = style6(date);
    rec.joutProd = toText(row.prod_desc);
    rec.joutQty = num(row.qty);
    rec.joutUom = toText(row.uom_short);
    recs.push(rec);
    addSlot(rec);
  }
  const joutNos = [...byJout.keys()];

  // Job in lines against the job outs.
  const ins = joutNos.length === 0 ? [] : (await runReportSql(loader, `SELECT jinled.full_docno, jinled.il_date, btrim(jinprocess.entry_no) AS chln_no, jinprocess.post_date, pm1.prod_desc, jinled.quantity::numeric AS qty, puom1.uom_short, btrim(jinled.order_no) AS order_no`
    + ` FROM ${db}prod_ledger jinled LEFT JOIN ${db}process jinprocess ON jinprocess.process_key = jinled.process_id LEFT JOIN ${db}product_master pm1 ON pm1.prod_key = jinled.prod_id LEFT JOIN ${db}prod_uom puom1 ON puom1.uom_key = jinled.rateuom_id`
    + ` WHERE jinled.il_pos = 'A' AND jinled.stock_nat = 'A' AND jinled.inventory = 'Y' AND jinled.quantity > 0 AND btrim(jinled.trn_module) = 'JOB-IN' AND coalesce(jinled.order_no, '') <> ''${filter("jinled.code")}`
    + ` AND btrim(jinled.order_no) = ANY($1::text[]) ORDER BY jinled.il_key`, [joutNos])).rows;
  let counter = 0;
  for (let i = 0; i < ins.length; i++) {
    const row = ins[i];
    const order = toText(row.order_no);
    const jinNo = toText(row.full_docno);
    counter++;
    const free = (bySlot.get(slot(order, counter)) ?? []).filter((rec) => rec.jinNo === "");
    const fill = (rec: Rec) => {
      rec.jinNo = jinNo; rec.jinDate = style6(row.il_date); rec.chlnNo = toText(row.chln_no); rec.chlnDate = style6(row.post_date); rec.jinProd = toText(row.prod_desc); rec.jinQty = num(row.qty); rec.jinUom = toText(row.uom_short);
    };
    if (free.length > 0) {
      for (const rec of (bySlot.get(slot(order, counter)) ?? [])) { rec.sort = `${rec.joutYmd} ${order} z ${jinNo}`; fill(rec); }
    } else {
      const base = (byJout.get(order) ?? []).slice(-1)[0];
      const rec = blank();
      rec.sr = counter; rec.joutNo = order; rec.name = base?.name ?? ""; rec.joutDate = base?.joutDate ?? ""; rec.joutYmd = base?.joutYmd ?? "";
      rec.sort = `${rec.joutYmd} ${order} z ${jinNo}`;
      fill(rec);
      recs.push(rec);
      addSlot(rec);
    }
    if (i + 1 < ins.length && toText(ins[i + 1].order_no) !== order) counter = 0;
  }

  // Renumber the lines within their job in number (the empty one is one group), by the line number.
  const byJin = new Map<string, Rec[]>();
  for (const rec of recs) { const list = byJin.get(rec.jinNo) ?? []; list.push(rec); byJin.set(rec.jinNo, list); }
  for (const list of byJin.values()) { list.map((rec, index) => ({ rec, index })).sort((a, b) => a.rec.sr - b.rec.sr || a.index - b.index).forEach((entry, index) => { entry.rec.sr = index + 1; }); }

  // Expense bills against the job ins.
  const jinNos = [...byJin.keys()].filter((no) => no !== "");
  const bills = jinNos.length === 0 ? [] : (await runReportSql(loader, `SELECT jbillled.full_docno, jbillled.il_date, btrim(jbill.doc_no1) AS chln_no, jbill.chln_date, jbillled.quantity::numeric AS qty, jbillled.il_value::numeric AS amount, btrim(jbillled.order_no) AS order_no`
    + ` FROM ${db}prod_ledger jbillled LEFT JOIN ${db}ledger jbill ON jbill.led_key = jbillled.led_id WHERE jbill.book = 15 AND jbill.doc_pos <> 'D' AND jbillled.il_pos <> 'D' AND coalesce(jbillled.order_no, '') <> ''${filter("jbillled.code")}`
    + ` AND btrim(jbillled.order_no) = ANY($1::text[]) ORDER BY jbillled.order_no, jbillled.il_key`, [jinNos])).rows;
  counter = 0;
  for (let i = 0; i < bills.length; i++) {
    const row = bills[i];
    const order = toText(row.order_no);
    const billNo = toText(row.full_docno);
    counter++;
    const list = byJin.get(order) ?? [];
    const hit = list.filter((rec) => rec.sr === counter);
    const fill = (rec: Rec) => {
      rec.expNo = billNo; rec.expDate = style6(row.il_date); rec.expChln = toText(row.chln_no); rec.expChlnDate = style6(row.chln_date); rec.expQty = num(row.qty); rec.expAmount = num(row.amount);
    };
    if (hit.length > 0) {
      for (const rec of hit) { rec.sort = `${rec.sort} z ${billNo}`; fill(rec); }
    } else {
      const base = list.slice(-1)[0];
      const rec = blank();
      rec.sr = counter; rec.sort = base?.sort ?? ""; rec.name = base?.name ?? ""; rec.joutNo = base?.joutNo ?? ""; rec.joutDate = base?.joutDate ?? ""; rec.joutYmd = base?.joutYmd ?? ""; rec.jinNo = order;
      fill(rec);
      recs.push(rec);
      list.push(rec);
      byJin.set(order, list);
    }
    if (i + 1 < bills.length && toText(bills[i + 1].order_no) !== order) counter = 0;
  }

  const table = new ResultTable();
  for (const column of ["SR_NO", "SORTING_DATE", "Name", "JOUT_NO", "JOUT_DATE", "JOut_Prod_Desc", "JOut_Qty", "JOUT_UOM", "JIn_No", "JIn_Date", "JIN_CHLNNO", "JIN_CHLN_DATE", "JIn_Prod_Desc", "JIN_Qty", "JIN_UOM",
    "EXP_BILL_NO", "EXP_BILL_DATE", "EXP_CHLN_NO", "EXP_CHLN_DATE", "EXP_QTY", "Exp_Amount"]) table.addColumn(column);
  for (const column of ["JOut_Qty", "JIN_Qty", "EXP_QTY", "Exp_Amount"]) table.setKind(column, "decimal");
  table.setKind("SR_NO", "int");
  table.rows = recs.map((rec, index) => ({ rec, index })).sort((a, b) => a.rec.sort.toLowerCase().localeCompare(b.rec.sort.toLowerCase()) || a.index - b.index).map(({ rec }) => ({
    SR_NO: rec.sr, SORTING_DATE: rec.sort, Name: rec.name, JOUT_NO: rec.joutNo, JOUT_DATE: rec.joutDate, JOut_Prod_Desc: rec.joutProd, JOut_Qty: rec.joutQty, JOUT_UOM: rec.joutUom,
    JIn_No: rec.jinNo, JIn_Date: rec.jinDate, JIN_CHLNNO: rec.chlnNo, JIN_CHLN_DATE: rec.chlnDate, JIn_Prod_Desc: rec.jinProd, JIN_Qty: rec.jinQty, JIN_UOM: rec.jinUom,
    EXP_BILL_NO: rec.expNo, EXP_BILL_DATE: rec.expDate, EXP_CHLN_NO: rec.expChln, EXP_CHLN_DATE: rec.expChlnDate, EXP_QTY: rec.expQty, Exp_Amount: rec.expAmount,
  }));
  return table;
}
