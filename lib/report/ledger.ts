import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import type { ResultRow } from "./call";
import { ResultTable } from "./call";
import { dateStyle112, dateStyle6, desktopDate, sqlLen, sqlServerCompare } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment, ReportRefusal } from "./generate";
import { isNumberField, money, num, runReportSql } from "./run";

/**
 * SP_REPORT_STANDARD, report 4 (the main ledger), lines 2269-3375 of the SQL Server procedure.
 *
 * The procedure builds RESULT_TABLE_<user> through a dozen INSERT / UPDATE / DELETE statements and
 * returns it ORDER BY SORTING_COL, SORTING_DATE. Here the same table is built in memory from
 * read-only queries, so a report never writes to the database; the statements that only move rows
 * about (the narration lines, the journal's contra lines, the closing and heading rows) are done on
 * the rows themselves, in the procedure's order.
 */

const SUBLED = "SUBLED";

/** Licences whose ledger keeps only some voucher series (29, 30 and 73). */
const SERIES_FILTER = " and (left(led.DOC_SERIES,2)='MS' or left(led.DOC_SERIES,2)='RD' or left(led.DOC_SERIES,2)='AI' or left(led.DOC_SERIES,2)='AL' or left(led.DOC_SERIES,2)='RG' or left(led.DOC_SERIES,2)='HC' or left(led.DOC_SERIES,3)='ADC')";

/** The fix column a ticked group's headings carry (FN_GETFIXCOLNAMEFOR, reports 1, 3, 4, 6 and 38). */
function fixColumnFor(group: string, groupsAsHeadings: boolean): { codeColumn: string; rowType: string; keyExpr: string; addon: boolean } | null {
  const dot = group.indexOf(".");
  const bare = dot >= 0 ? group.slice(dot + 1) : group;
  const alias = dot >= 0 ? group.slice(0, dot) : "";
  switch (bare.toUpperCase()) {
    case "NAME": return { codeColumn: "SMART_AC_CODE", rowType: "AC", keyExpr: "AC.CODE", addon: false };
    case "BOOK_DESC": return { codeColumn: "SMART_BOOK_CODE", rowType: "BOOK", keyExpr: "BOOKMST.BOOK_KEY", addon: false };
    case "BS_DESC": return { codeColumn: "SMART_SCHEDULE_CODE", rowType: "SCHEDULE", keyExpr: "BS.BS_KEY", addon: false };
  }
  if (bare.toUpperCase().includes("TXT_")) {
    void groupsAsHeadings;
    const name = bare.replace(/TXT_/i, "");
    return { codeColumn: "ADDON_|C|_CODE", rowType: "ADDON_|C|", keyExpr: `${alias}.KEY_${name}`, addon: true };
  }
  return null;
}

/** FN_REMOVE_ALIASES: "bookmst.book_desc" -> "book_desc". */
const removeAlias = (text: string) => (text.includes(".") ? text.slice(text.indexOf(".") + 1) : text);

/** The column a group fills on its heading and the account rows (CASE ... WHEN 'BOOK_DESC' THEN 'SMART_SELECTED_BOOK' ...). */
function smartColumnFor(group: string, addonNumber: number): string {
  switch (removeAlias(group).toUpperCase()) {
    case "NAME": return "SMART_NAME";
    case "BOOK_DESC": return "SMART_SELECTED_BOOK";
    case "BS_DESC": return "SMART_SELECTED_SCHDULE";
    case "": return "";
    default: return `SMART_SELECTED_ADDON${addonNumber + 1}`;
  }
}

/** A group's term in a sorting string: the schedule sorts by its code first. */
const sortingTerm = (group: string) => (group.toUpperCase() === "BS.BS_DESC" ? `BS.BS_CODE || ' ' || ${group}` : group);

/** SQL Server's REPLACE is case-insensitive under the database's collation. */
const replaceCI = (source: string, find: string, replacement: string) => source.replace(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), replacement);

export async function ledgerReport(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { session } = loader;
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, session.companySchema);
  const check = (name: string) => call.checkQuery.includes(`${name},`);
  const fromText = desktopDate(call.from);
  const subLedger = call.addon[0].includes(SUBLED);
  const licence = call.licence;
  const entryPara = toText(session.setup.entry_para).toUpperCase();

  // bitHideBook: licences 19, 29, 68 and 73 hide entries booked against an account whose short name says CA_ENT.
  let hideBook = true;
  if ([19, 29, 68, 73].includes(licence)) {
    const found = await runReportSql(loader, `SELECT COUNT(*) AS n FROM ${db}account WHERE a_pos <> 'D' AND POSITION('CA_ENT' IN a_short) > 0`);
    hideBook = num(found.rows[0]?.n) > 0;
  }
  const hideBookFilter = (column: string) => (!hideBook && [19, 29, 68, 73].includes(licence) ? ` AND ${column} in (select code from ${db}ACCOUNT where a_pos='A')` : "");

  let csFrom = call.from_;
  let openingFrom = call.openingFrom;
  if (subLedger) {
    csFrom = csFrom.split("|sys.sp.aentry|").join(`left join ${db}addon_aentry aentry on led.LED_KEY=aentry.aona_ledid and ledpost.POST_BOOKCD<>ledpost.POST_CODE`);
    openingFrom = openingFrom.split("|sys.sp.aentry|").join(`left join ${db}addon_aentry aentry on led.LED_KEY=aentry.aona_ledid and ledpost.POST_BOOKCD<>ledpost.POST_CODE`);
    if (fromText !== desktopDate(call.tarikh1)) throw new ReportRefusal("Between Date Not Allowed For Sub Ledger", "INTERNAL PROGRAM FAILURE");
  } else {
    csFrom = csFrom.split("|sys.sp.aentry|").join(`left join ${db}addon_aentry aentry on led.led_key=aentry.aona_ledid`);
    openingFrom = openingFrom.split("|sys.sp.aentry|").join(`left join ${db}addon_aentry aentry on ac.code=aentry.aona_accode`);
  }
  const partyKey = call.addon.map((addon) => addon.replace(" adata.txt_", " adata.key_"));

  const useUnion = call.showNarration ? call.useUnion : false;
  const reference = licence === 14 ? `,(select txt_REFERENCE from ${db}ADDON_AENTRY aent1 where aent1.aona_ledid=led.led_key limit 1) as "REFERENCE"` : "";
  const narrationColumn = useUnion ? "NARRATION1" : "NARRATION";
  const selectEnd = call.queryEnd.trim() !== "" ? `,${call.queryEnd}` : "";
  const where = call.where;
  const lineFilters = (licence === 29 || licence === 30 || licence === 73 ? SERIES_FILTER : "") + hideBookFilter("LED.BOOK_CODE");
  const orderBy = ` ORDER BY "SORTING_COL", ledpost.post_code, "SORTING_DATE", ledpost.post_dbcode, led.doc_no`;

  // The ledger lines (TEMP_TABLE_LEDGER1): the result table takes its columns from them.
  const lineSql = frag(`SELECT ${call.queryStart}${reference},LED.NARRATION AS "${narrationColumn}"${selectEnd} ${csFrom} ${where}${lineFilters}`
    + (!useUnion && (check("CHK_WLED") || check("CHK_WALED")) ? " AND AC.BOOK=2" : "")
    + (check("CHK_OPENING") ? " AND LED.BOOK <> 4" : "")
    + orderBy);
  const lines = await runReportSql(loader, lineSql);
  const table = new ResultTable();
  for (const field of lines.fields) {
    table.addColumn(field.name);
    if (isNumberField(field)) table.setKind(field.name, [20, 21, 23].includes(field.dataTypeID) ? "int" : "decimal");
  }
  const numberColumn = new Set(lines.fields.filter((field) => isNumberField(field)).map((field) => field.name.toLowerCase()));
  for (const column of ["NAME", "SMART_NAME", "ROW_DATA_TYPE", "SORTING_COL", "CLOSING_BAL", "SYSTEM_BLANK1", "SMART_AC_CODE", "SMART_SELECTED_BOOK", "SMART_SELECTED_SCHDULE", "SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2", "SMART_SELECTED_ADDON3", "SMART_SELECTED_ADDON4", "DR_CR", "DEBIT", "CREDIT", "AC_CODE", "AC_BOOK", "SELECTED_NAME", "SELECTED_DATE", "SORTING_DATE", "BOOK"]) table.addColumn(column);
  // RESULT_TABLE's ALTER COLUMNs: the amounts are money, the closing numeric(18,2).
  for (const column of ["DEBIT", "CREDIT", "CLOSING_BAL"]) table.setKind(column, "decimal");

  // Heading rows of the ticked groups other than the account (book, schedule, addon), one level at a time.
  const groupsText = replaceCI(call.unionGroups, "AC.NAME,", "");
  const groups = groupsText.split(",").map((part) => part.trim()).filter((part) => part !== "");
  const smartColumns: string[] = [];
  let addonNumber = 0;
  const sortingTerms: string[] = [];
  for (const group of groups) {
    const fix = fixColumnFor(group, call.groupsAsHeadings);
    if (!fix) throw new ReportRefusal("Finding Selected Group Failed\nPlease Check Function_FIX In Database", "INTERNAL PROGRAM FAILURE");
    const smart = smartColumnFor(group, addonNumber);
    if (smart !== "") smartColumns.push(smart);
    let codeColumn = fix.codeColumn;
    let rowType = fix.rowType;
    if (fix.addon) {
      addonNumber += 1;
      codeColumn = codeColumn.split("|C|").join(String(addonNumber));
      rowType = rowType.split("|C|").join(String(addonNumber));
    }
    sortingTerms.push(sortingTerm(group));
    const sortingSql = sortingTerms.join(" || ' ' || ");
    const smartValues = groups.slice(0, sortingTerms.length).map((part, index) => `${part} AS "s${index}"`).join(", ");
    const schedule = group.toUpperCase() === "BS.BS_DESC";
    const headingSql = frag(`SELECT DISTINCT ${fix.keyExpr} AS "k", ${smartValues}, ${group} AS "n", ${sortingSql} AS "o"${schedule ? ", BS.BS_CODE AS \"b\"" : ""} ${csFrom} ${where} ORDER BY ${schedule ? "BS.BS_CODE" : group}`);
    for (const heading of (await runReportSql(loader, headingSql)).rows) {
      const values: Record<string, unknown> = { [codeColumn]: heading.k, ROW_DATA_TYPE: rowType, NAME: heading.n, SORTING_COL: heading.o };
      smartColumns.forEach((column, index) => { values[column] = heading[`s${index}`]; });
      if (schedule) values.SYSTEM_BLANK1 = heading.b;
      for (const column of Object.keys(values)) table.addColumn(column);
      table.insert(values);
    }
  }

  // Opening balances (TABLE_NAME_OPENING, TEMP_OPENINGS), unless the ledger is an entry addon's or the operator asked for none.
  if (call.acAddonRepdefa !== "E" || subLedger) {
    if (!check("CHK_OPENING")) {
      const accountSorting = `${[...sortingTerms, subLedger ? "AC.SUB_NAME" : "AC.NAME"].join(" || ' ' || ")}`;
      const sorting = sortingTerms.length > 0 ? accountSorting : `' ' || ${subLedger ? "AC.SUB_NAME" : "AC.NAME"}`;
      const groupSelect = groups.map((part, index) => `${part} AS "g${index}"`).join(", ");
      let openingSql: string;
      if (!subLedger) {
        const fixedFrom = openingFrom.split("SYS.FIXDB").join(`${db}AC_BALANCE ACBAL LEFT JOIN ${db}ACCOUNT AC ON ACBAL.CODE = AC.Code`);
        const lic2973 = licence === 29 || licence === 73;
        const openingValue = lic2973 ? `case when acbal.opening::numeric = 0 then acbal.opening::numeric else (acbal.opening::numeric - coalesce(nullif(add1.local_code,'')::numeric,0)) end` : "ACBAL.OPENING::numeric";
        const fromPart = call.selectKey[0] === ""
          ? (lic2973 ? `${db}AC_BALANCE ACBAL LEFT JOIN ${db}ACCOUNT AC ON ACBAL.CODE = AC.Code LEFT JOIN ${db}ADDRESS ADD1 ON ACBAL.CODE = ADD1.Code and add1.address_id=1` : fixedFrom)
          : `${db}AC_BALANCE ACBAL LEFT JOIN ${db}ACCOUNT AC ON ACBAL.CODE = AC.Code left join ${db}ADDON_DATA adata on adata.code=ac.code${lic2973 ? ` LEFT JOIN ${db}ADDRESS ADD1 ON ACBAL.CODE = ADD1.Code and add1.address_id=1` : ""}`;
        openingSql = `SELECT ${sorting} AS "SORTINGCOL"${groupSelect !== "" ? `, ${groupSelect}` : ""}, AC.NAME AS "GRPNAME", ${openingValue} AS "OPENING", AC.CODE AS "AC_CODE", AC.BOOK AS "AC_BOOK", AC.NAME AS "SELECTED_NAME" FROM ${fromPart}`
          + ` WHERE AC.BOOK <> 0 AND YEAR_ID = '${call.yearId}' AND A_RECFLAG = 'AC'`
          + (call.selectKey[4] !== "" ? ` AND AC.CODE IN ${call.selectKey[4]}` : "")
          + (call.selectScheduleKey !== "" ? ` and AC.BS_ID IN ${call.selectScheduleKey}` : "")
          + (call.selectBookKey !== "" ? ` and AC.BOOK IN ${call.selectBookKey}` : "");
        if (call.selectKey[0] !== "") {
          const keyed = [0, 1, 2, 3].filter((index) => call.selectKey.slice(0, index + 1).every((key) => key !== ""));
          const depth = keyed.length;
          for (let index = 0; index < depth; index += 1) openingSql += ` and ${partyKey[index]} in ${call.selectKey[index]}`;
        }
        openingSql += ` ORDER BY "SORTINGCOL"`;
      } else {
        if (call.selectKey[0] === "") throw new ReportRefusal("Sub ledger needs its sub ledgers ticked", "INTERNAL PROGRAM FAILURE");
        openingSql = `SELECT ${replaceCI(sorting, "aentry.txt_SUBLED", "")} AS "SORTINGCOL", AC.SUB_NAME AS "GRPNAME", ACBAL.SUB_OPENING::numeric AS "OPENING", AC.SUB_CODE AS "AC_CODE", 0 AS "AC_BOOK", NULL AS "SELECTED_NAME" FROM ${db}SUB_BALANCE ACBAL LEFT JOIN ${db}ADDON_SUB AC ON ACBAL.SUB_CODE = AC.SUB_Code`
          + ` WHERE SUB_YEARID = '${call.yearId}' AND AC.SUB_CODE IN ${call.selectKey[0]} ORDER BY "SORTINGCOL"`;
      }
      const openings = (await runReportSql(loader, frag(openingSql))).rows;

      // Postings before the From date join the year's opening (only when the report does not start at the year's start).
      if (call.from.getTime() !== call.tarikh1.getTime() && !subLedger) {
        const seriesOnly = licence === 29 || licence === 30 || licence === 73;
        const seriesTest = (side: number) => (seriesOnly
          ? `LEDPOST.POST_DBCODE = ${side} and (left(led.DOC_SERIES,2)='RD' or left(led.DOC_SERIES,2)='MS' or left(led.DOC_SERIES,2)='AL' or left(led.DOC_SERIES,2)='AI' or left(led.DOC_SERIES,2)='RG'${side === 1 ? " or left(led.DOC_SERIES,2)='HC'" : ""} or left(led.DOC_SERIES,3)='ADC')`
          : `LEDPOST.POST_DBCODE = ${side}`);
        let earlier = `SELECT AC.Code AS "KEY_CODE", SUM(CASE WHEN ${seriesTest(1)} then LEDPOST.POST_AMT::numeric else 0.00 end) - SUM(CASE WHEN ${seriesTest(2)} then LEDPOST.POST_AMT::numeric else 0.00 end) AS "OPENING" ${csFrom}`;
        earlier += call.selectKey[4] !== "" ? ` WHERE AC.CODE IN ${call.selectKey[4]} and LEDPOST.post_date < '${fromText}'` : ` where LEDPOST.post_date < '${fromText}'`;
        if (call.selectScheduleKey !== "") earlier += ` and AC.BS_ID IN ${call.selectScheduleKey}`;
        if (call.selectBookKey !== "") earlier += ` and AC.BOOK IN ${call.selectBookKey}`;
        earlier += hideBookFilter("LED.BOOK_CODE");
        for (let index = 0; index < 4 && call.selectKey.slice(0, index + 1).every((key) => key !== ""); index += 1) earlier += ` and ${partyKey[index]} in ${call.selectKey[index]}`;
        earlier += " GROUP BY AC.CODE";
        const before = new Map<string, number>();
        for (const row of (await runReportSql(loader, frag(earlier))).rows) before.set(String(row.KEY_CODE), money((before.get(String(row.KEY_CODE)) ?? 0) + num(row.OPENING)));
        for (const opening of openings) {
          const add = before.get(String(opening.AC_CODE));
          if (add !== undefined) opening.OPENING = money(num(opening.OPENING) + add);
        }
      }

      const openingDate = dateStyle6(call.from);
      for (const opening of openings) {
        const amount = money(num(opening.OPENING));
        if (amount === 0) continue;
        const values: Record<string, unknown> = {
          SORTING_COL: opening.SORTINGCOL === null || opening.SORTINGCOL === undefined ? null : subLedger ? `${String(opening.SORTINGCOL).trim()}   ${opening.AC_CODE}   O` : `${opening.SORTINGCOL}${opening.AC_CODE}   O`,
          SELECTED_DATE: openingDate,
          NAME: " Opening Balance B/d ",
          AC_CODE: opening.AC_CODE,
          SMART_AC_CODE: opening.AC_CODE,
          SMART_NAME: opening.GRPNAME,
          ROW_DATA_TYPE: "OPENINGS",
          DEBIT: amount > 0 ? amount : 0,
          CREDIT: amount < 0 ? -amount : 0,
          DR_CR: amount < 0 ? "CR" : amount > 0 ? "DR" : "",
          CLOSING_BAL: amount,
        };
        if (!subLedger) { values.AC_BOOK = opening.AC_BOOK; values.SELECTED_NAME = opening.SELECTED_NAME; }
        else values.SMART_SELECTED_ADDON1 = opening.GRPNAME;
        if (!subLedger) smartColumns.forEach((column, index) => { values[column] = opening[`g${index}`]; });
        table.insert(values);
      }
    }
  }

  // The ledger lines, and (Show Narration without "In Same Line") each one's narration as rows of 40 characters.
  const lineRows: ResultRow[] = lines.rows.map((row) => ({ ...row }));
  let narrationRows: ResultRow[] = [];
  if (useUnion) {
    const narrationSql = frag(`SELECT ${call.fixCols}${call.unionQuery}${reference},LED.NARRATION AS "NARRATION1"${selectEnd} ${csFrom} ${where}${lineFilters}${check("CHK_OPENING") ? " AND LED.BOOK <> 4" : ""}${orderBy}`);
    const narration = await runReportSql(loader, narrationSql);
    const names = lines.fields.map((field) => field.name);
    const nameAt = names.findIndex((name) => name.toUpperCase() === "NAME");
    for (const source of narration.rows) {
      const cells = narration.fields.map((field) => source[field.name]);
      // NARRATION_1 is '\' + the narration; a voucher without one gives '\' (or NULL) and no rows.
      if (cells[nameAt] === null || cells[nameAt] === undefined) continue;
      const text = String(cells[nameAt]);
      if (text.trim() === "\\") continue;
      const base: ResultRow = {};
      names.forEach((name, index) => {
        const value = cells[index];
        base[name] = value === "" && numberColumn.has(name.toLowerCase()) ? 0 : value;
      });
      base[table.name("ROW_DATA_TYPE")!] = "NARRATION";
      const full = text;
      for (let chunk = 1; chunk <= 20; chunk += 1) {
        const start = (chunk - 1) * 40;
        if (chunk > 1 && sqlLen(full) <= start) break;
        const piece = chunk === 1 ? full.slice(0, 40) : `\\${full.slice(start, start + 40)}`;
        const row: ResultRow = { ...base };
        row[table.name("SORTING_COL")!] = base[table.name("SORTING_COL")!] === null ? null : `${base[table.name("SORTING_COL")!]}N${String(chunk).padStart(2, "0")}`;
        row[names[nameAt]] = piece;
        narrationRows.push(row);
      }
    }
  }

  // A journal's line (NAME 'JOURNAL') becomes its contra lines, unless the company posts multi-JVs (MULTIJV).
  if (!entryPara.includes("MULTIJV,")) {
    const journals = lineRows.filter((row) => toText(table.get(row, "NAME")) === "JOURNAL");
    if (journals.length > 0) {
      const docNos = [...new Set(journals.map((row) => toText(table.get(row, "full_docno"))))];
      const contraSql = frag(`SELECT led.led_key, led.full_docno, led.doc_date, led.amount::numeric AS amount, led.ac_dbcode, led.book, ac.name, ac.a_short FROM ${db}LEDGER led LEFT JOIN ${db}account ac ON ac.Code = led.CODE`
        + ` WHERE led.full_docno = ANY($1) AND led.doc_pos <> 'D' AND led.doc_posting <> 'L' AND ac.a_pos <> 'D'${hideBookFilter("LED.BOOK_CODE")}${check("CHK_OPENING") ? " AND LED.BOOK <> 4" : ""} ORDER BY led.led_key`);
      const contras = (await runReportSql(loader, contraSql, [docNos])).rows;
      const added: ResultRow[] = [];
      for (const journal of journals) {
        const journalDate = parseDashDate(toText(table.get(journal, "selected_date")));
        for (const contra of contras) {
          if (toText(contra.full_docno) !== toText(table.get(journal, "full_docno"))) continue;
          if (String(contra.led_key) === String(table.get(journal, "SMART_LED_KEY"))) continue;
          if (journalDate === null || !(contra.doc_date instanceof Date) || contra.doc_date.toDateString() !== journalDate.toDateString()) continue;
          if (String(table.get(journal, "post_dbcode")) === String(contra.ac_dbcode)) continue;
          const debit = num(table.get(journal, "Debit"));
          const credit = num(table.get(journal, "Credit"));
          const amount = num(contra.amount);
          const row: ResultRow = { ...journal };
          table.set(row, "SMART_LED_KEY", contra.led_key);
          table.set(row, "led_key", contra.led_key);
          table.set(row, "led_id", contra.led_key);
          table.set(row, "NAME", contra.name);
          table.set(row, "a_short", contra.a_short);
          table.set(row, "Debit", debit > 0 ? (debit > amount ? amount : debit) : 0);
          table.set(row, "Credit", credit > 0 ? (credit > amount ? amount : credit) : 0);
          added.push(row);
        }
      }
      const kept = lineRows.filter((row) => toText(table.get(row, "NAME")) !== "JOURNAL");
      lineRows.length = 0;
      lineRows.push(...kept, ...added);
    }
  }

  // CHK_WLED / CHK_WALED (WhatsApp ledgers) keep debtors (book 2) only.
  if (!useUnion && (check("CHK_WLED") || check("CHK_WALED"))) {
    if (check("CHK_WLED")) {
      const codes = new Set(lineRows.map((row) => toText(table.get(row, "SMART_AC_CODE"))));
      table.rows = table.rows.filter((row) => codes.has(toText(table.get(row, "SMART_AC_CODE"))));
    }
    table.rows = table.rows.filter((row) => toText(table.get(row, "AC_BOOK")) === "2");
    table.rows.push(...lineRows.filter((row) => toText(table.get(row, "AC_BOOK")) === "2"));
  } else {
    table.rows.push(...lineRows, ...narrationRows);
  }
  narrationRows = [];

  // Sorting "Above Amount" / "Below Amount" (|run_txt_Aboveamt|): rows on the wrong side of the amount go, openings and narration too.
  if (call.text[0] !== "" && (call.sortingText === "Above Amount" || call.sortingText === "Below Amount")) {
    const limit = num(call.text[0]);
    table.rows = table.rows.filter((row) => {
      const debit = table.get(row, "Debit");
      const credit = table.get(row, "Credit");
      // A NULL amount (a heading row) makes the DELETE's test unknown, so the row stays.
      if (debit === null || debit === undefined || credit === null || credit === undefined) return true;
      return call.sortingText === "Above Amount" ? !(num(debit) < limit && num(credit) < limit) : !(num(debit) > limit && num(credit) > limit);
    });
  }

  // Closing and account heading rows for every account the table holds.
  const accountCodes = [...new Set(table.rows.map((row) => table.get(row, "AC_CODE")).filter((code) => code !== null && code !== undefined && code !== "").map((code) => Number(code)).filter((code) => Number.isInteger(code)))];
  if (call.acAddonRepdefa !== "E") {
    const accounts = accountCodes.length === 0 ? [] : (await runReportSql(loader, `SELECT code, name, book, a_short FROM ${db}account WHERE code = ANY($1::int[])`, [accountCodes])).rows;
    for (const account of accounts) {
      table.insert({ SORTING_COL: account.name === null ? null : ` ${account.name}${account.code}z`, SORTING_DATE: dateStyle112(call.upto), SELECTED_DATE: dateStyle6(call.upto), NAME: "Closing Balance B/d", AC_CODE: account.code, SMART_NAME: account.name, BOOK: account.book, AC_BOOK: account.book, SELECTED_NAME: account.name, ROW_DATA_TYPE: "CLOSING", SMART_AC_CODE: account.code });
    }
    for (const account of accounts) {
      table.insert({ SMART_AC_CODE: String(account.code), SORTING_COL: account.name === null ? null : ` ${account.name}${account.code}   H`, NAME: account.name, AC_CODE: account.code, SMART_NAME: account.name, BOOK: account.book, AC_BOOK: account.book, SELECTED_NAME: account.name, ROW_DATA_TYPE: "AC" });
    }
  } else {
    const subCodes = [...new Set(table.rows.map((row) => table.get(row, "addon_1_code")).filter((code) => code !== null && code !== undefined && code !== "").map((code) => Number(code)).filter((code) => Number.isInteger(code)))];
    const subs = subCodes.length === 0 ? [] : (await runReportSql(loader, `SELECT sub_code, sub_name FROM ${db}addon_sub WHERE sub_code = ANY($1::int[])`, [subCodes])).rows;
    for (const sub of subs) {
      table.insert({ SORTING_COL: sub.sub_name === null ? null : `${sub.sub_name}z`, SORTING_DATE: dateStyle112(call.upto), SELECTED_DATE: dateStyle6(call.upto), NAME: "Closing Balance B/d", ADDON_1_CODE: sub.sub_code, SMART_SELECTED_ADDON1: sub.sub_name, BOOK: 0, ROW_DATA_TYPE: "CLOSING", doc_no: "z" });
    }
  }

  if (!call.jvDetailsRequired) {
    if (call.acAddonRepdefa !== "E") {
      const headingRows = (type: string) => table.rows.filter((row) => table.get(row, "ROW_DATA_TYPE") === type);
      const tail = (type: string) => (type === "AC" ? "   H" : "z");
      const concat = (...parts: unknown[]) => (parts.some((part) => part === null || part === undefined) ? null : parts.map((part) => String(part)).join(""));
      const accountOf = async (sql: string) => new Map((await runReportSql(loader, sql, [accountCodes])).rows.map((row) => [String(row.code), row]));
      if (call.selectBookKey !== "" && accountCodes.length > 0) {
        const books = await accountOf(`SELECT ac.code, bookmast.book_desc FROM ${db}account ac LEFT JOIN ${db}book_properties bookmast ON bookmast.book_key = ac.book WHERE ac.code = ANY($1::int[]) AND bookmast.book_key IN ${call.selectBookKey}`);
        for (const type of ["AC", "CLOSING"]) {
          for (const row of headingRows(type)) {
            const book = books.get(String(table.get(row, "AC_CODE")));
            if (book) table.set(row, "SMART_SELECTED_BOOK", book.book_desc);
          }
          for (const row of headingRows(type)) table.set(row, "SORTING_COL", concat(table.get(row, "SMART_SELECTED_BOOK"), " ", table.get(row, "SMART_NAME"), table.get(row, "AC_CODE"), tail(type)));
        }
      }
      if (call.selectScheduleKey !== "" && accountCodes.length > 0) {
        const schedules = await accountOf(`SELECT ac.code, bs.bs_desc, bs.bs_code FROM ${db}account ac LEFT JOIN ${db}balsheet bs ON bs.bs_key = ac.bs_id WHERE ac.code = ANY($1::int[]) AND bs.bs_key IN ${call.selectScheduleKey}`);
        for (const type of ["AC", "CLOSING"]) {
          for (const row of headingRows(type)) {
            const schedule = schedules.get(String(table.get(row, "AC_CODE")));
            if (schedule) { table.set(row, "SMART_SELECTED_SCHDULE", schedule.bs_desc); table.set(row, "SYSTEM_BLANK1", schedule.bs_code); }
          }
          for (const row of headingRows(type)) table.set(row, "SORTING_COL", concat(table.get(row, "SYSTEM_BLANK1"), " ", table.get(row, "SMART_SELECTED_SCHDULE"), " ", table.get(row, "SMART_NAME"), table.get(row, "AC_CODE"), tail(type)));
        }
      }
      for (let index = 0; index < 4; index += 1) {
        if (call.selectKey[index] === "" || accountCodes.length === 0) continue;
        const paraId = (await runReportSql(loader, `SELECT para_id FROM ${db}ADDON_SUB WHERE sub_code IN ${call.selectKey[index]} LIMIT 1`)).rows[0]?.para_id;
        const fieldName = toText((await runReportSql(loader, `SELECT fiel_save FROM ${db}ADDON_FLD WHERE fiel_key = $1`, [paraId ?? 0])).rows[0]?.fiel_save);
        if (!/^[A-Za-z0-9_]+$/.test(fieldName)) continue;
        const data = await accountOf(`SELECT code, txt_${fieldName} AS value FROM ${db}addon_data WHERE code = ANY($1::int[])`);
        for (const type of ["AC", "CLOSING"]) {
          for (const row of headingRows(type)) {
            const value = data.get(String(table.get(row, "AC_CODE")));
            if (value) table.set(row, `SMART_SELECTED_ADDON${index + 1}`, value.value);
          }
          for (const row of headingRows(type)) {
            const parts: unknown[] = [];
            for (let level = 0; level <= index; level += 1) parts.push(table.get(row, `SMART_SELECTED_ADDON${level + 1}`), " ");
            table.set(row, "SORTING_COL", concat(...parts, table.get(row, "SMART_NAME"), table.get(row, "AC_CODE"), tail(type)));
          }
        }
      }
      // An account left with only its heading and closing rows (nothing to show) goes.
      const counts = new Map<string, number>();
      for (const row of table.rows) {
        const code = num(table.get(row, "AC_CODE"));
        if (code > 0) counts.set(String(code), (counts.get(String(code)) ?? 0) + 1);
      }
      const empty = new Set([...counts].filter(([, count]) => count === 2).map(([code]) => code));
      if (empty.size > 0) table.rows = table.rows.filter((row) => !empty.has(String(num(table.get(row, "AC_CODE")))) || num(table.get(row, "AC_CODE")) <= 0);
    }
    if (check("CHK_PROD_DTL_REQ") && call.acAddonRepdefa !== "E") await productDetails(loader, plan, table, hideBookFilter);
    if ([3, 5, 7, 8, 18].includes(licence)) {
      const shorts = new Map((accountCodes.length === 0 ? [] : (await runReportSql(loader, `SELECT code, name, a_short FROM ${db}account WHERE code = ANY($1::int[])`, [accountCodes])).rows).map((row) => [String(row.code), row]));
      for (const row of table.rows.filter((candidate) => table.get(candidate, "ROW_DATA_TYPE") === "AC")) {
        const account = shorts.get(String(table.get(row, "AC_CODE")));
        if (account) table.set(row, "NAME", account.a_short === null ? null : `${account.name} - ${account.a_short}`);
      }
    }
    if (call.acAddonRepdefa === "E") for (const row of table.rows.filter((candidate) => table.get(candidate, "ROW_DATA_TYPE") === "LED")) table.set(row, "NAME", table.get(row, "SMART_NAME"));
    if (check("CHK_ACC_CNFRM") || check("CHK_TFPRINT")) throw new ReportRefusal("Account Confirmation and T - Format Print are not available in the web version yet.\nUntick them to see the ledger.", "Not ported yet");
  } else {
    throw new ReportRefusal("Show JV Details is not available in the web version yet.", "Not ported yet");
  }

  // ORDER BY SORTING_COL, SORTING_DATE (stable, as rows were added).
  const sortCol = table.name("SORTING_COL")!;
  const sortDate = table.name("SORTING_DATE")!;
  const indexed = table.rows.map((row, index) => ({ row, index }));
  indexed.sort((a, b) => sqlServerCompare(a.row[sortCol] as string | null, b.row[sortCol] as string | null)
    || sqlServerCompare(a.row[sortDate] === null || a.row[sortDate] === undefined ? null : String(a.row[sortDate]), b.row[sortDate] === null || b.row[sortDate] === undefined ? null : String(b.row[sortDate]))
    || a.index - b.index);
  table.rows = indexed.map((entry) => entry.row);
  return table;
}

/** "01-Apr-2026" (the ledger's selected_date) as a date; CONVERT(datetime, ..., 105). */
function parseDashDate(text: string): Date | null {
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(text.trim());
  if (!match) return null;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[2].toLowerCase());
  if (month < 0) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return new Date(year, month, Number(match[1]));
}

/** CHK_PROD_DTL_REQ: each voucher's products under it (TEMP_TABLE_PRODRECORD). */
async function productDetails(loader: Loader, plan: ReportPlan, table: ResultTable, hideBookFilter: (column: string) => string) {
  const { call } = plan;
  const db = call.database;
  const licence = call.licence;
  if (call.selectKey[4] === "") throw new ReportRefusal("Product Detail Require needs the accounts ticked (Account group)", "INTERNAL PROGRAM FAILURE");
  if (licence !== 32) for (const column of ["QUANTITY", "RATE", "VALUE"]) table.setKind(column, "decimal");
  const keys = call.selectKey[4];
  const addon = call.selectKey[0] !== "" ? call.addon[0].trim() : "";
  const dbcode = licence === 2 || licence === 32 || addon !== ""
    ? "CAST(led.ac_dbcode AS varchar(20))"
    : "CAST((case when led.book IN (10, 15) AND ac.bs_id <> 30 AND led.post_bkcode = AC.Code then led.bk_dbcode else led.ac_dbcode end) AS varchar(20))";
  const marker = licence === 2 || addon !== "" && licence !== 32 ? "'3' || " : "";
  const suffix = addon !== "" ? "'PRODUCT'" : licence === 2 ? "'LED'" : "'LEDP'";
  const lead = addon !== "" ? `${addon} || ' ' || ac.name` : "' ' || ac.name";
  const sorting = `${lead} || CAST(ac.code AS varchar(10)) || '   P' || to_char(led.doc_date, 'YYYYMMDD') || ${dbcode} || ${marker}led.doc_no || CAST(led.led_key AS varchar(20)) || ${suffix}`;
  const name = licence === 2 ? "product.prod_short"
    : licence === 32 ? "product.prod_desc || '.... ' || CAST(round(pled.quantity::numeric, 2) AS varchar(20)) || ' @ ' || CAST(round(pled.rate::numeric, 2) AS varchar(20)) || '=' || CAST(pled.il_value::numeric AS varchar(20))"
    : "product.prod_desc || ' ' || case when coalesce(PLED.IL_PRODCD,'')<>'' then coalesce(PLED.IL_PRODCD,'') else ' ' end";
  let sql = `SELECT ${sorting} AS sorting_col, ${name} AS name, to_char(led.doc_date, 'YYYYMMDD') AS sorting_date, ac.name AS smart_name, ${addon !== "" ? `${addon} AS addon,` : ""} pled.quantity, pled.rate, pled.il_value::numeric AS il_value`
    + ` FROM ${db}LEDGER LED LEFT JOIN ${db}ACCOUNT AC ON (ac.bs_id = 30 AND LED.CODE = AC.Code) OR (ac.bs_id <> 30 AND ((led.book IN (10, 15) AND led.post_bkcode = AC.Code) OR (led.book NOT IN (10, 15) AND LED.CODE = AC.Code)))`
    + ` left join ${db}PROD_LEDGER PLED on pled.led_id=led.led_key LEFT JOIN ${db}PRODUCT_MASTER PRODUCT ON PRODUCT.PROD_KEY = PLED.PROD_ID`
    + (addon !== "" ? ` LEFT JOIN ${db}ADDON_DATA adata ON adata.code = PLED.code` : "")
    + ` where pled.il_pos='A' and led.doc_pos='A' and ((ac.bs_id = 30 AND led.code in ${keys}) or (ac.bs_id <> 30 AND ((led.book IN (10, 15) AND led.post_bkcode in ${keys}) OR (led.book NOT IN (10, 15) AND LED.CODE in ${keys}))))`
    + hideBookFilter("PLED.BOOK_CODE")
    + " and coalesce(pled.process_id,0)=0"
    + (licence === 29 || licence === 30 || licence === 73 ? SERIES_FILTER : "")
    + ` and led.DOC_DATE >= '${desktopDate(call.from)}' and LED.DOC_DATE <= '${desktopDate(call.upto)}'`;
  if (addon !== "") sql += ` and ${addon.replace("txt", "key")} in ${call.selectKey[0]}`;
  for (const row of (await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema))).rows) {
    const values: Record<string, unknown> = { SORTING_COL: row.sorting_col, FULL_DOCNO: "   **  ", NAME: row.name, DEBIT: 0, CREDIT: 0, CLOSING_BAL: 0, SORTING_DATE: row.sorting_date, SMART_NAME: row.smart_name, ROW_DATA_TYPE: "PRODUCT" };
    if (addon !== "") values.SMART_SELECTED_ADDON1 = row.addon;
    if (licence !== 32) { values.QUANTITY = row.quantity; values.RATE = row.rate; values.VALUE = row.il_value; }
    table.insert(values);
  }
}
