import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./refusal";
import { num, runReportSql } from "./run";

/**
 * 161: COLLECTION SUMMARY (REPORT_RPI_COLLECTION_SUMMARY, SP_FRT_RPT_RPI_COLLECTION_SUMMARY; SPECIAL > Extra Report (RP) > Collection Summary).
 *
 * For the debtors of the Account group (and the ticked addon groups) and the month of the first combo: what was outstanding up to the end of the
 * month before it (the procedure sets Upto from the month: January to December of the year's first month, ... April to today), how old it is,
 * and what was collected in the month.
 *  - The outstanding bills (OUTCLEAR sale lines up to Upto) are cleared in the procedure's order: bills of a party whose year has no opening
 *    and are dated up to the year's start are dropped; a credit note's amount (the first of each party) is taken off the party's oldest bills,
 *    the others of the party are dropped; the receipts set off against a bill are taken off it; the receipts on account (set off against
 *    nothing) are taken off the party's bills in turn; and what is left is cut down to the party's closing balance (oldest bills first).
 *  - THIS_MONTH_DUE is what is 60 to 90 days old, OVERDUE_90_DAYS what is older. OS_UPTO_LAST_MONTH is the party's closing balance on Upto.
 *  - COLLECTION_RECEIVED: the receipts (cash and bank vouchers, books 4 and 6) of the month number, in any year of the database, as the
 *    procedure's month() test does; a party with a collection and no bill gets a line too.
 *  - Against_os_% is the collection over the balance, Achieved_% over THIS_MONTH_DUE, SHORT_FALL the balance less the collection.
 * Lines with neither a balance nor a collection are left out. "Summary Required" sums the lines by the ticked addon groups (with no addon group
 * it changes nothing). As the procedure does, only the first credit note of a party is applied.
 * The work tables are in memory from five reads; nothing is written.
 */
type Bill = { code: number; name: string; key: number; date: Date; amount: number; addons: string[]; deleted: boolean };

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const round2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;
const dayNumber = (date: Date) => Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);

/** Upto from the month of the first combo, as the procedure sets it. */
function uptoOf(month: string, tarikh1: Date, tarikh2: Date, fallback: Date): Date {
  const y1 = tarikh1.getFullYear();
  const y2 = tarikh2.getFullYear();
  switch (month.trim().toUpperCase()) {
    case "JANUARY": return new Date(y1, 11, 31);
    case "FEBRUARY": return new Date(y2, 0, 31);
    case "MARCH": return new Date(y2, 2, 0);
    case "APRIL": return new Date();
    case "MAY": return new Date(y1, 3, 30);
    case "JUNE": return new Date(y1, 4, 31);
    case "JULY": return new Date(y1, 5, 30);
    case "AUGUST": return new Date(y1, 6, 31);
    case "SEPTEMBER": return new Date(y1, 7, 31);
    case "OCTOBER": return new Date(y1, 8, 30);
    case "NOVEMBER": return new Date(y1, 9, 31);
    case "DECEMBER": return new Date(y1, 10, 30);
    default: return fallback;
  }
}

export async function collectionSummary(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const upto = uptoOf(call.fcText, call.tarikh1, call.tarikh2, call.upto);
  const uptoText = desktopDate(upto);
  const month = call.fcValue;
  const levels = [0, 1, 2, 3].filter((at) => call.addon[at].trim() !== "");
  if (levels.some((at) => /aentry/i.test(call.addon[at]))) throw new ReportRefusal("An entry addon group is not available in the web version of this report yet.", "Not ported yet");
  const aliasOf = (at: number) => /as\s+"([^"]+)"/i.exec(call.headingAddon[at])?.[1] ?? `ADDON${at + 1}`;
  const keyOf = (at: number) => call.addon[at].trim().replace(/^(adata)\.txt_/i, "$1.key_");
  const parties = /^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(call.selectKey[4].trim()) ? call.selectKey[4].trim() : "";
  const filters = (code: string) => (parties !== "" ? ` AND ${code} IN ${parties}` : "")
    + levels.filter((at) => call.selectKey[at] !== "").map((at) => ` AND ${keyOf(at)} IN ${call.selectKey[at]}`).join("");
  const addonSelect = levels.map((at, index) => `, ${call.addon[at].trim()}::text AS a${index}`).join("");

  // The outstanding bills and the receipts set off.
  const bills: Bill[] = (await runReportSql(loader, `SELECT ac.code, btrim(ac.name) AS name, outclr.out_key, outclr.out_date,`
    + ` CASE WHEN outclr.out_entrybook = 11 THEN coalesce(outclr.out_entryamt::numeric - outclr.out_setoff::numeric - outclr.out_ly_setoff::numeric, 0) ELSE coalesce(outclr.out_entryamt::numeric - outclr.out_ly_setoff::numeric, 0) END AS amount${addonSelect}`
    + ` FROM ${db}outclear outclr LEFT JOIN ${db}account ac ON ac.code = outclr.code LEFT JOIN ${db}addon_data adata ON adata.code = ac.code`
    + ` WHERE outclr.out_date <= $1::date AND ac.book = 2 AND ac.a_pos = 'A' AND outclr.out_dbcode = 1${filters("outclr.code")} ORDER BY outclr.out_date, outclr.out_key`, [uptoText])).rows
    .map((row) => ({ code: num(row.code), name: toText(row.name), key: num(row.out_key), date: row.out_date as Date, amount: num(row.amount), addons: levels.map((_, index) => toText(row[`a${index}`])), deleted: false }));
  const receipts = (await runReportSql(loader, `SELECT btrim(ac.name) AS name, outclr.out_ag_outid,`
    + ` CASE WHEN outclr.out_setoff::numeric = 0 THEN outclr.out_entryamt::numeric ELSE CASE WHEN outclr.out_entrybook = 13 AND outclr.out_entryamt::numeric - outclr.out_setoff::numeric <> 0 THEN outclr.out_entryamt::numeric ELSE outclr.out_setoff::numeric END END AS amount`
    + ` FROM ${db}outclear outclr LEFT JOIN ${db}account ac ON ac.code = outclr.code LEFT JOIN ${db}addon_data adata ON adata.code = ac.code LEFT JOIN ${db}ledger led ON led.led_key = outclr.out_ledid`
    + ` WHERE outclr.out_date <= $1::date AND ac.a_pos = 'A' AND ac.book = 2 AND outclr.out_dbcode = 2 AND led.doc_pos = 'A'${filters("outclr.code")}`, [uptoText])).rows
    .map((row) => ({ name: toText(row.name), against: num(row.out_ag_outid), amount: num(row.amount) }));

  const live = () => bills.filter((bill) => !bill.deleted);
  const byParty = (name: string) => live().filter((bill) => sameName(bill.name, name));

  // Bills dated up to the year's start of a party that has an account with no opening.
  const noOpening = new Set((await runReportSql(loader, `SELECT DISTINCT lower(btrim(ac.name)) AS name FROM ${db}account ac LEFT JOIN ${db}ac_balance acbal ON acbal.code = ac.code WHERE ac.a_pos = 'A' AND ac.book = 2 AND acbal.opening::numeric = 0`)).rows.map((row) => toText(row.name)));
  const start = dayNumber(call.tarikh1);
  for (const bill of bills) if (dayNumber(bill.date) <= start && noOpening.has(bill.name.trim().toLowerCase())) bill.deleted = true;

  // A credit note (the first of each party) is taken off the party's oldest bills; the party's other credit notes go with it.
  for (const credit of bills.filter((bill) => bill.amount < 0)) {
    if (credit.deleted) continue;
    let open = Math.abs(credit.amount);
    for (const bill of byParty(credit.name).filter((candidate) => candidate.amount > 0)) {
      if (open >= bill.amount) { open = round2(open - bill.amount); bill.deleted = true; }
      else { bill.amount = round2(bill.amount - open); open = 0; }
      if (open === 0) break;
    }
    for (const bill of bills) if (!bill.deleted && bill.amount < 0 && sameName(bill.name, credit.name)) bill.deleted = true;
  }

  // The receipts set off against a bill.
  for (const bill of live()) {
    if (!(bill.amount > 0)) continue;
    const taken = receipts.filter((receipt) => receipt.against === bill.key && sameName(receipt.name, bill.name)).reduce((total, receipt) => total + receipt.amount, 0);
    bill.amount = round2(bill.amount - taken);
  }

  // The receipts on account, in turn on the party's bills.
  const onAccount = new Map<string, { name: string; amount: number }>();
  for (const receipt of receipts) {
    if (receipt.against !== 0) continue;
    const key = receipt.name.trim().toLowerCase();
    onAccount.set(key, { name: receipt.name, amount: (onAccount.get(key)?.amount ?? 0) + receipt.amount });
  }
  for (const { name, amount } of onAccount.values()) {
    let open = amount;
    for (const bill of byParty(name).filter((candidate) => candidate.amount > 0)) {
      const sale = bill.amount;
      if (open >= sale) { bill.amount = round2(bill.amount - sale); open = round2(open - sale); }
      else { bill.amount = round2(bill.amount - open); open = 0; }
      if (open <= 0) break;
    }
  }

  // The party's closing balance on Upto: the bills are cut down to it, oldest first.
  const codes = [...new Set(bills.map((bill) => bill.code))];
  const closing = new Map<number, number>();
  const ledgerRows = new Set<number>();
  if (codes.length > 0) {
    for (const row of (await runReportSql(loader, `SELECT ac.code, coalesce(ob.opening, 0) + coalesce(lg.dr, 0) - coalesce(lg.cr, 0) AS closing, lg.code IS NOT NULL AS has_ledger FROM ${db}account ac`
      + ` LEFT JOIN (SELECT code, sum(opening::numeric) AS opening FROM ${db}ac_balance GROUP BY code) ob ON ob.code = ac.code`
      + ` LEFT JOIN (SELECT code, sum(CASE WHEN ac_dbcode = 1 THEN amount::numeric ELSE 0 END) AS dr, sum(CASE WHEN ac_dbcode = 2 THEN amount::numeric ELSE 0 END) AS cr FROM ${db}ledger`
      + ` WHERE doc_pos <> 'D' AND doc_posting = 'P' AND doc_date <= $1::date AND code = ANY($2::int[]) GROUP BY code) lg ON lg.code = ac.code`
      + ` WHERE ac.a_pos <> 'D' AND ac.book = 2 AND ac.os_flag <> 'N' AND ac.code = ANY($2::int[])`, [uptoText, codes])).rows) {
      closing.set(num(row.code), num(row.closing));
      if (row.has_ledger === true) ledgerRows.add(num(row.code));
    }
  }
  for (const code of codes) {
    const limit = closing.get(code);
    if (limit === undefined || !(limit > 0)) continue;
    const mine = live().filter((bill) => bill.code === code && bill.amount > 0).sort((a, b) => a.date.getTime() - b.date.getTime() || a.key - b.key);
    const excess = round2(mine.reduce((total, bill) => total + bill.amount, 0) - limit);
    if (!(excess > 0)) continue;
    let cumulative = 0;
    for (const bill of mine) {
      const before = cumulative;
      cumulative = round2(cumulative + bill.amount);
      if (cumulative <= excess) bill.deleted = true;
      else if (before < excess) bill.amount = round2(cumulative - excess);
    }
    // The zero bills older than the oldest one left.
    const remaining = live().filter((bill) => bill.code === code && bill.amount > 0).sort((a, b) => a.date.getTime() - b.date.getTime() || a.key - b.key)[0];
    if (remaining) for (const bill of live()) if (bill.code === code && bill.amount === 0 && (bill.date.getTime() < remaining.date.getTime() || (bill.date.getTime() === remaining.date.getTime() && bill.key < remaining.key))) bill.deleted = true;
  }

  // The lines: a party's balance, what is 60 to 90 and over 90 days old.
  const today = dayNumber(upto);
  type Line = { name: string; os: number; due: number; overdue: number; received: number; addons: string[] };
  const lines = new Map<string, Line>();
  const keyOfLine = (name: string, os: number, addons: string[]) => [name.trim().toLowerCase(), os, ...addons].join("\u0000");
  for (const bill of live()) {
    if (!ledgerRows.has(bill.code)) continue;
    const os = round2(closing.get(bill.code) ?? 0);
    const days = today - dayNumber(bill.date);
    const key = keyOfLine(bill.name, os, bill.addons);
    const line = lines.get(key) ?? { name: bill.name, os, due: 0, overdue: 0, received: 0, addons: bill.addons };
    if (days >= 60 && days <= 90) line.due = round2(line.due + bill.amount);
    if (days >= 91) line.overdue = round2(line.overdue + bill.amount);
    lines.set(key, line);
  }

  // The collection of the month.
  const collected = (await runReportSql(loader, `SELECT ac.code, btrim(ac.name) AS name, sum(led.amount::numeric) AS amount${addonSelect} FROM ${db}ledger led LEFT JOIN ${db}account ac ON ac.code = led.code LEFT JOIN ${db}addon_data adata ON adata.code = ac.code`
    + ` WHERE extract(month FROM led.doc_date) = $1 AND led.doc_pos = 'A' AND ac.a_pos = 'A' AND led.ac_dbcode = 2 AND ac.book = 2 AND led.book IN (4, 6) AND led.doc_posting = 'P'${filters("led.code")}`
    + ` GROUP BY ac.code, ac.name${levels.map((at) => `, ${call.addon[at].trim()}`).join("")}`, [month])).rows;
  const received = new Map<string, number>();
  for (const row of collected) received.set(toText(row.name).toLowerCase(), (received.get(toText(row.name).toLowerCase()) ?? 0) + num(row.amount));
  for (const line of lines.values()) line.received = round2(received.get(line.name.trim().toLowerCase()) ?? 0);
  const known = new Set([...lines.values()].map((line) => line.name.trim().toLowerCase()));
  for (const row of collected) {
    const name = toText(row.name);
    if (known.has(name.toLowerCase())) continue;
    lines.set(`${name.toLowerCase()}\u0000receipt\u0000${lines.size}`, { name, os: 0, due: 0, overdue: 0, received: round2(num(row.amount)), addons: levels.map((_, index) => toText(row[`a${index}`])) });
  }

  // The table.
  const table = new ResultTable();
  const summary = call.checkQuery.includes("CHK_SUMMARY,") && levels.length > 0;
  const numbers = ["OS_UPTO_LAST_MONTH", "THIS_MONTH_DUE", "OVERDUE_90_DAYS", "COLLECTION_RECEIVED", "SHORT_FALL", "Against_os_%", "Achieved_%"];
  const percentages = (os: number, due: number, got: number) => ({ "Against_os_%": os > 0 && got > 0 ? round2(got / os * 100) : 0, "Achieved_%": due > 0 && got > 0 ? round2(got / due * 100) : 0 });
  const kept = [...lines.values()].filter((line) => line.os > 0 || line.received > 0);
  const compare = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase());
  if (summary) {
    for (const at of levels) table.addColumn(aliasOf(at));
    for (const at of levels) table.addColumn(`SMART_SELECTED_ADDON${at + 1}`);
    for (const column of numbers) { table.addColumn(column); table.setKind(column, "decimal"); }
    const grouped = new Map<string, Line>();
    for (const line of kept) {
      const key = line.addons.join("\u0000");
      const entry = grouped.get(key) ?? { name: "", os: 0, due: 0, overdue: 0, received: 0, addons: line.addons };
      entry.os = round2(entry.os + line.os); entry.due = round2(entry.due + line.due); entry.overdue = round2(entry.overdue + line.overdue); entry.received = round2(entry.received + line.received);
      grouped.set(key, entry);
    }
    table.rows = [...grouped.values()].filter((line) => line.os > 0 || line.received > 0).map((line): ResultRow => ({
      ...Object.fromEntries(levels.map((at, index) => [aliasOf(at), line.addons[index]])), ...Object.fromEntries(levels.map((at, index) => [`SMART_SELECTED_ADDON${at + 1}`, line.addons[index]])),
      OS_UPTO_LAST_MONTH: line.os, THIS_MONTH_DUE: line.due, OVERDUE_90_DAYS: line.overdue, COLLECTION_RECEIVED: line.received, SHORT_FALL: round2(line.os - line.received), ...percentages(line.os, line.due, line.received),
    })).sort((a, b) => { for (const at of levels) { const result = compare(toText(a[aliasOf(at)]), toText(b[aliasOf(at)])); if (result !== 0) return result; } return 0; });
    return table;
  }
  table.addColumn("Name");
  for (const column of numbers) { table.addColumn(column); table.setKind(column, "decimal"); }
  for (const at of levels) table.addColumn(aliasOf(at));
  for (const at of levels) table.addColumn(`SMART_SELECTED_ADDON${at + 1}`);
  table.rows = kept.map((line): ResultRow => ({
    Name: line.name, OS_UPTO_LAST_MONTH: line.os, THIS_MONTH_DUE: line.due, OVERDUE_90_DAYS: line.overdue, COLLECTION_RECEIVED: line.received, SHORT_FALL: round2(line.os - line.received), ...percentages(line.os, line.due, line.received),
    ...Object.fromEntries(levels.map((at, index) => [aliasOf(at), line.addons[index]])), ...Object.fromEntries(levels.map((at, index) => [`SMART_SELECTED_ADDON${at + 1}`, line.addons[index]])),
  })).sort((a, b) => {
    for (const at of levels) { const result = compare(toText(a[`SMART_SELECTED_ADDON${at + 1}`]), toText(b[`SMART_SELECTED_ADDON${at + 1}`])); if (result !== 0) return result; }
    return compare(toText(a.Name), toText(b.Name));
  });
  return table;
}
