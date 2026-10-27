import { displayValue, Loader } from "../master-program/load";
import { formatDesktopDate, parseDesktopDate, toDecimal, toInt, toText } from "../master-program/legacy";
import { properHeading } from "../master-program/heading";
import { fixed } from "./calc";
import { amountInWords } from "./billHtml";
import type { Bill, BillParty } from "./billHtml";
import { loadBook } from "./invoice";
import { restoreEntry } from "./products";
import type { EntryOption } from "./types";

/**
 * The data of the standard bill of a saved entry: the company, the party and its address(es), each product line with its discount and tax
 * (the item-wise slab rows), the slab totals and the amount in words. Read from the saved entry the way Find / Edit opens it.
 */

type Row = Record<string, unknown>;
const field = Loader.field;
const text = (row: Row | undefined, name: string) => toText(field(row, name)).trim();

async function partyAt(loader: Loader, code: number, addressId: number, name: string): Promise<BillParty> {
  const row = (await loader.readTable(
    `SELECT a.*, o.opt_desc AS state_name FROM |sys.db|address a LEFT JOIN |sys.db|idopt_master o ON o.idopt_key = a.state_id
      WHERE a.code = $1 AND a.address_id = $2 AND a.a_pos <> 'D' LIMIT 1`, [code, addressId]))?.[0];
  const cityPin = [text(row, "city"), text(row, "pin_code")].filter(Boolean).join(" - ");
  return {
    name,
    lines: [text(row, "address_1"), text(row, "address_2"), text(row, "address_3"), cityPin],
    gstin: text(row, "gst_no"),
    state: text(row, "state_name"),
    pan: text(row, "pan_no"),
    phone: text(row, "mobile_no") || text(row, "tel_no"),
  };
}

export async function entryBill(loader: Loader, entryName: string, firstCombo: EntryOption, uniqueKey: number): Promise<Bill> {
  const { session } = loader;
  const entry = await restoreEntry(loader, entryName, firstCombo, uniqueKey);
  const screen = await loadBook(loader, entryName, firstCombo, entry.taxGroup);
  const led = (await loader.readTable(
    `SELECT amount::numeric AS amount, full_docno, doc_date, chln_date, doc_no1, narration, credit_days FROM |sys.db|ledger WHERE unique_key = $1 AND doc_pos <> 'D' LIMIT 1`, [uniqueKey]))?.[0];
  if (!led) throw new Error("The entry is not found (deleted, or not posted)");

  const companyRow = (await loader.readTable(
    `SELECT name, bill_name, bill_add, o_address1, o_address2, o_address3, o_city, o_pincode, o_tel, o_mobile, o_emailid, gst_no, panno1, state_name FROM smart_system.company WHERE co_key = $1`, [session.companyKey]))?.[0];
  const companyName = text(companyRow, "bill_name") || text(companyRow, "name") || session.companyName;
  const billAdd = text(companyRow, "bill_add");
  const companyLines = billAdd !== "" ? billAdd.split(/\r?\n|,\s{2,}/).map((line) => line.trim()).filter(Boolean)
    : [text(companyRow, "o_address1"), text(companyRow, "o_address2"), text(companyRow, "o_address3"), [text(companyRow, "o_city"), text(companyRow, "o_pincode")].filter(Boolean).join(" - ")];
  const given = (name: string) => { const value = text(companyRow, name); return value === "0" ? "" : value; };
  const contact = [given("o_tel") && `Tel: ${given("o_tel")}`, given("o_mobile") && `Mobile: ${given("o_mobile")}`, given("o_emailid") && `Email: ${given("o_emailid")}`].filter(Boolean).join("   ");

  if (entry.voucher) {
    // Voucher_Plain: the day book, the book side, each account row and the header addons (Bank Name ...) that hold a value.
    const fields = (await loader.readTable(`SELECT fiel_key, fiel_name FROM |sys.db|addon_fld WHERE fiel_relate = 'A' AND fiel_pos <> 'D' AND BTRIM(fiel_entrypos) = 'L' ORDER BY fiel_key`)) ?? [];
    const headerAddons = fields.map((item) => ({ label: properHeading(text(item, "fiel_name")), value: (entry.addon[toInt(field(item, "fiel_key"))] ?? "").trim() })).filter((item) => item.value !== "" && item.value.toLowerCase() !== "none");
    const bookSide = Number(entry.values.cmb_side);
    const side = screen.sides?.find((candidate) => candidate.acDbcode === (bookSide === 2 ? 1 : 2))?.text ?? "";
    const rows = entry.voucher.rows.map((row, index) => ({ serial: String(index + 1), account: row.name, debit: row.debit, credit: row.credit, chqNo: row.chqNo, chqDate: row.chqDate }));
    const debit = rows.reduce((sum, row) => sum + toDecimal(row.debit), 0);
    const credit = rows.reduce((sum, row) => sum + toDecimal(row.credit), 0);
    const when = parseDesktopDate(displayValue(field(led, "doc_date")));
    return {
      title: screen.bookKey === 19 ? "JOURNAL VOUCHER" : `${(side || "Voucher").toUpperCase()} VOUCHER`,
      register: firstCombo.text,
      company: { name: companyName, lines: companyLines, gstin: text(companyRow, "gst_no"), pan: text(companyRow, "panno1"), contact, state: text(companyRow, "state_name") || session.coStateName },
      header: { docNo: text(led, "full_docno"), date: when ? formatDesktopDate(when) : "", challanNo: "", challanDate: "", creditDays: "", narration: text(led, "narration") },
      billTo: { name: "", lines: [], gstin: "", state: "", pan: "", phone: "" }, shipTo: { name: "", lines: [], gstin: "", state: "", pan: "", phone: "" },
      addons: headerAddons, lines: [], totals: [],
      finalAmount: fixed(Math.max(debit, credit), 2), inWords: amountInWords(Math.max(debit, credit)),
      voucher: { daybook: firstCombo.text, side, rows, debitTotal: fixed(debit, 2), creditTotal: fixed(credit, 2), showChq: rows.some((row) => row.chqNo !== "") },
    };
  }
  const partyName = entry.values.tbx_partyname ?? "";
  const billTo = await partyAt(loader, entry.partyCode, 1, partyName);
  const shipTo = entry.addressId > 1 ? await partyAt(loader, entry.partyCode, entry.addressId, partyName) : billTo;
  // The account addons marked "print on the document" (addon_fld fiel_docprint Y), each with the value this entry holds.
  const printAddons = (await loader.readTable(`SELECT fiel_key, fiel_name FROM |sys.db|addon_fld WHERE fiel_relate = 'A' AND fiel_pos <> 'D' AND BTRIM(fiel_docprint::text) = 'Y' ORDER BY fiel_key`)) ?? [];
  const addons = printAddons.map((item) => ({ label: properHeading(text(item, "fiel_name")), value: (entry.addon[toInt(field(item, "fiel_key"))] ?? "").trim() })).filter((item) => item.value !== "");

  // Each line: its value, the item-wise discounts (less rows) off it, and the item-wise tax (add rows with a tax list) on it.
  const slabRows = screen.slabRows;
  const itemWise = slabRows.filter((row) => row.itemWise);
  const itemTotals = new Map<number, number>();
  const lines = entry.lines.map((line, index) => {
    const cells = line.cells;
    const saved = (entry as unknown as { itemSlab: Record<number, Record<number, { perc: string; amount: string }>> }).itemSlab[Number(cells._il_key)] ?? {};
    let discount = 0;
    let tax = 0;
    let taxRate = 0;
    for (const row of itemWise) {
      const hit = saved[row.key];
      if (!hit) continue;
      const amount = toDecimal(hit.amount);
      itemTotals.set(row.key, (itemTotals.get(row.key) ?? 0) + amount);
      if (row.mathOp === "L") discount += amount;
      else if (row.master) { tax += amount; taxRate += toDecimal(hit.perc); }
    }
    const value = toDecimal(cells.il_value);
    const taxable = value - discount;
    const desc = cells.prod_desc || cells.prod_key || "";
    return {
      serial: String(index + 1),
      description: desc,
      hsn: cells.hsn_code ?? "",
      qty: String(toDecimal(cells.quantity)),
      uom: cells.uomentry_id ?? "",
      rate: fixed(toDecimal(cells.rate), 2),
      rateUom: cells.rateuom_id ?? "",
      amount: fixed(value, 2),
      discount: fixed(discount, 2),
      taxable: fixed(taxable, 2),
      taxRate: taxRate > 0 ? String(Math.round(taxRate * 100) / 100) : "",
      tax: fixed(tax, 2),
      total: fixed(taxable + tax, 2),
    };
  });

  // The slab totals: an item-wise row is the sum of the lines; the others are the entry's own amounts. Zero rows are left out.
  const totals: { label: string; amount: string }[] = [];
  for (const row of slabRows) {
    const amount = row.itemWise ? itemTotals.get(row.key) ?? 0 : toDecimal((entry.slab[row.key] ?? { amount: "0" }).amount);
    if (amount === 0 && row.order !== 1) continue;
    const sign = row.mathOp === "L" ? "Less: " : "";
    totals.push({ label: `${sign}${row.desc.replace(/^\*\s*/, "").trim()}`, amount: fixed(amount, 2) });
  }
  const final = toDecimal(field(led, "amount"));
  const date = parseDesktopDate(displayValue(field(led, "doc_date")));
  const challanDate = parseDesktopDate(displayValue(field(led, "chln_date")));
  const gst = session.coGstReq && entry.taxGroup !== "V";
  return {
    title: gst ? "TAX INVOICE" : "INVOICE",
    register: firstCombo.text,
    company: { name: companyName, lines: companyLines, gstin: text(companyRow, "gst_no"), pan: text(companyRow, "panno1"), contact, state: text(companyRow, "state_name") || session.coStateName },
    header: {
      docNo: text(led, "full_docno"),
      date: date ? formatDesktopDate(date) : "",
      challanNo: text(led, "doc_no1"),
      challanDate: challanDate && challanDate.getTime() !== date?.getTime() ? formatDesktopDate(challanDate) : "",
      creditDays: String(toInt(field(led, "credit_days"))),
      narration: text(led, "narration"),
    },
    billTo,
    shipTo,
    addons,
    lines,
    totals,
    finalAmount: fixed(final, 2),
    inWords: amountInWords(final),
  };
}
