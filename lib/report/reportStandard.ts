import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import type { ResultRow } from "./call";
import type { ResultTable } from "./call";
import { dateStyle112, dateStyle6, desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { pgFragment, ReportRefusal } from "./generate";
import {
  cashBookColumns, dayBefore, dropColumn, groupFailed, groupHeadingColumns, groupList, groupSmartColumn, insertFirst, narrationPieces, numberKey,
  parseRowDate, renameColumn, replaceCI, rightAlignedKey, sortRows, tableFromFields, textKey, withEntryAddon,
} from "./library";
import { money, num, runReportSql } from "./run";

/**
 * SP_REPORT_STANDARD: the standard (unformatted) output of every report, one branch per report
 * key as in the SQL Server procedure. The procedure builds its result in TEMP_TABLE_* / RESULT_TABLE
 * tables; here the same table is built in memory from read-only queries, so a report never writes
 * to the database. What branches share is in library.ts; Report_Combine's own work before and
 * after is in generate.ts and output.ts.
 *
 * Ported branches: 1 (day book), 4 (ledger).
 */
export async function standardReport(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  switch (plan.call.reportKey) {
    case 1: return daybook(loader, plan);
    case 4: return ledger(loader, plan);
    default: throw new ReportRefusal(`Report ${plan.call.reportKey} is not available in the web version yet.`, "Not ported yet");
  }
}

/** The day book's opening (@NUM_OPENING): the account's opening for the year, plus what it took in less paid out from the year's start to `uptoBefore` (numeric(18,2)). */
export async function cashBookOpening(loader: Loader, plan: ReportPlan, csFrom: string, uptoBefore: Date): Promise<number> {
  const { call } = plan;
  const db = call.database;
  const row = (await runReportSql(loader, `SELECT opening::numeric AS opening FROM ${db}AC_BALANCE WHERE code = $1 AND year_id = $2 AND a_recflag = 'AC' LIMIT 1`, [call.fcValue, call.yearId])).rows[0];
  let opening = money(num(row?.opening));
  if (call.from.getTime() !== call.tarikh1.getTime()) {
    const sql = `SELECT coalesce(SUM(CASE WHEN BK_DBCODE = 1 THEN led.AMOUNT ELSE 0.00 END),0.00) - coalesce(SUM(CASE WHEN BK_DBCODE = 2 THEN led.AMOUNT ELSE 0.00 END),0.00) AS moved ${csFrom}`
      + ` WHERE LED.BOOK_CODE = ${Number(call.fcValue)} AND LED.DOC_POS <> 'D' AND ${call.dateField} BETWEEN '${desktopDate(call.tarikh1)}' AND '${desktopDate(uptoBefore)}'`;
    const moved = (await runReportSql(loader, pgFragment(sql, plan, loader.session.companySchema))).rows[0];
    opening = money(opening + num(moved?.moved));
  }
  return Math.round(opening * 100) / 100;
}

/** The day book's FROM with the entry addon join the procedure puts in. */
export const cashBookFrom = (plan: ReportPlan): string => withEntryAddon(plan.call.from_, `left join ${plan.call.database}addon_aentry aentry on led.led_key=aentry.aona_ledid`);

// ======================================================================================
// 1: DAYBOOK (lines 234-975)
// ======================================================================================
//
// No Account / Book / Schedule group: the account's vouchers in date order. Show Narration (not in
// the same line) adds each voucher's narration under it as rows of 40 characters; with no group and
// no filter the year's opening (and the postings before From) heads the list and a Closing Balance
// row ends it. With one of those groups (or Selected Groups As Heading): the vouchers sorted by the
// groups, a heading row per group value when Selected Groups As Heading is ticked, no opening.
// RECEIPT / PAYMENT become GIVEN / TAKEN (book 5) or DEPOSIT / WITHDRAWAL (6); the cheque number
// stays only for a bank, the short name only for licences 3, 5, 7, 8. Where the desktop fails (an
// INTO returning no rows with Show Narration unticked and a filter, a UNION of unequal halves with an
// addon group) the web returns the rows the procedure meant to.

const SHORT_LICENCES = [3, 5, 7, 8];

/** The procedure's renames and drops, the same on every path. */
function daybookColumns(plan: ReportPlan, table: ResultTable, keepCheque: boolean): void {
  const { book, licence } = plan.call;
  const [first, second] = cashBookColumns(book);
  renameColumn(table, "RECEIPT", first);
  renameColumn(table, "PAYMENT", second);
  if (!SHORT_LICENCES.includes(licence)) dropColumn(table, "short");
  if (book !== 6 && !keepCheque) dropColumn(table, "DOC_NO1");
  for (const column of ["CLOSING_BAL", "CC_AMT"]) if (table.has(column)) table.setKind(column, "decimal");
}

async function daybook(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const csFrom = cashBookFrom(plan);
  if (call.dateField === "") throw new ReportRefusal("DATE FIELD FOUND BLANKS\nPLEASE CHECK DATABASE", "INTERNAL PROGRAM FAILURE");
  const headings = call.groupsAsHeadings || call.selectKey[4] !== "" || call.selectScheduleKey !== "" || call.selectBookKey !== "";
  const useUnion = call.showNarration ? call.useUnion : false;
  const selectEnd = call.queryEnd.trim() !== "" ? `,${call.queryEnd}` : "";
  const orderBy = ` ORDER BY ${call.orderBy.trim() !== "" ? `${call.orderBy},` : ""}"SORTING_DATE",led.bk_dbcode,led.doc_no`;
  if (headings) return daybookByGroups(loader, plan, csFrom, useUnion, selectEnd, orderBy);

  // TEMP_TABLE_DAYBOOK1: the account's vouchers; ORDERCOL / ORDERCOL1 (IDENTITY, 'L') follow the narration.
  const narrationColumn = useUnion ? "NARRATION1" : "NARRATION";
  const lines = await runReportSql(loader, frag(`SELECT ${call.queryStart},LED.NARRATION AS "${narrationColumn}"${selectEnd} ${csFrom} ${call.where}${orderBy}`));
  const table = tableFromFields(lines.fields);
  if (useUnion) {
    table.columns.splice(table.columns.indexOf(table.name(narrationColumn)!) + 1, 0, "ORDERCOL", "ORDERCOL1");
    table.setKind("ORDERCOL", "int");
  }
  table.rows = lines.rows.map((row, index) => (useUnion ? { ...row, ORDERCOL: index + 1, ORDERCOL1: "L" } : { ...row }));
  const lineCount = table.rows.length;

  // TEMP_TABLE_DAYBOOK2: each voucher's narration under it (N01 .. N10); the union's halves line up by position.
  if (useUnion) {
    if (call.unionQuery === "") throw new ReportRefusal("Blank Groups For Narration\nCheck Database..OUTPUT", "INTERNAL PROGRAM FAILURE");
    const fixCols = call.fixCols.replace(`'LED' as "ROW_DATA_TYPE"`, `'NARRATION' as "ROW_DATA_TYPE"`);
    const narration = await runReportSql(loader, frag(`SELECT ${fixCols}${call.unionQuery},LED.NARRATION AS "NARRATION1" ${csFrom} ${call.where}${orderBy}`));
    const names = table.columns.filter((name) => name !== "ORDERCOL" && name !== "ORDERCOL1");
    const nameAt = names.findIndex((name) => name.toUpperCase() === "NAME");
    const numberColumns = new Set(names.filter((name) => table.kind(name) !== "text"));
    narration.rows.forEach((source, index) => {
      const cells = narration.fields.filter((field) => field.name !== "NARRATION1").map((field) => source[field.name]);
      const base: ResultRow = Object.fromEntries(table.columns.map((name) => [name, null]));
      cells.forEach((value, at) => { if (at < names.length) base[names[at]] = value === "" && numberColumns.has(names[at]) ? 0 : value; });
      base[table.name(narrationColumn)!] = source.NARRATION1;
      base.ORDERCOL = index + 1;
      const full = cells[nameAt];
      if (full === null || full === undefined || toText(full).trim() === "\\") return;
      narrationPieces(String(full), { count: 10, firstMarked: false, lastUnbounded: true })
        .forEach((piece, chunk) => table.rows.push({ ...base, [names[nameAt]]: piece, ORDERCOL1: `N${String(chunk + 1).padStart(2, "0")}` }));
    });
  }

  // The opening and closing rows: only with no group and no filter.
  const openingBlock = call.queryEnd === "" && call.unionGroups === "" && call.filterId.toUpperCase() === "NONE";
  if (openingBlock) {
    const opening = await cashBookOpening(loader, plan, csFrom, dayBefore(call.from));
    const amounts = { RECEIPT: opening > 0 ? opening : 0, PAYMENT: opening < 0 ? Math.abs(opening) : 0 };
    if (useUnion) {
      // Narration in rows: the opening and the closing come only when there is an opening.
      if (opening !== 0) {
        table.insert({ selected_date: dateStyle6(call.upto), ROW_DATA_TYPE: "LED", NAME: "Closing Balance", RECEIPT: 0, PAYMENT: 0, ORDERCOL: lineCount + 1, ORDERCOL1: "z" });
        table.insert({ SELECTED_DATE: dateStyle6(call.from), ROW_DATA_TYPE: "OPENINGS", NAME: "Opening Balance", ...amounts, ORDERCOL: 1, ORDERCOL1: "A" });
      }
    } else {
      if (opening !== 0) insertFirst(table, { selected_date: dateStyle6(call.from), ROW_DATA_TYPE: "OPENINGS", NAME: "Opening Balance", ...amounts });
      table.insert({ sorting_date: dateStyle112(call.upto), selected_date: dateStyle6(call.upto), bk_dbcode: 50, ROW_DATA_TYPE: "LED", NAME: "Closing Balance", RECEIPT: 0, PAYMENT: 0 });
      // ORDER BY SORTING_DATE, bk_dbcode, RIGHT(SPACE(10)+doc_no,10): the opening (no date) first.
      sortRows(table, [(row) => textKey(table.get(row, "SORTING_DATE")), (row) => numberKey(table.get(row, "bk_dbcode")), (row) => rightAlignedKey(table.get(row, "doc_no"))]);
    }
  }
  if (useUnion) sortRows(table, [(row) => numberKey(row.ORDERCOL), (row) => textKey(row.ORDERCOL1)]);

  daybookColumns(plan, table, !useUnion && !openingBlock && call.selectKey.slice(0, 4).some((key) => key !== "") && call.filterId.toUpperCase() === "NONE");
  return table;
}

/** With Account / Book / Schedule ticked (or Selected Groups As Heading): TEMP_TABLE_DAYBOOK3. */
async function daybookByGroups(loader: Loader, plan: ReportPlan, csFrom: string, useUnion: boolean, selectEnd: string, orderBy: string): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const frag = (sql: string) => pgFragment(sql, plan, loader.session.companySchema);
  const narrationColumn = useUnion ? "NARRATION1" : "NARRATION";
  const lines = await runReportSql(loader, frag(`SELECT ${call.queryStart},LED.NARRATION AS "${narrationColumn}"${selectEnd} ${csFrom}${call.where}${orderBy}`));
  const table = tableFromFields(lines.fields);
  for (const column of ["SMART_AC_CODE", "BOOK", "ROW_DATA_TYPE", "NAME", "SORTING_COL", "SMART_BOOK_CODE", "SMART_SCHEDULE_CODE"]) table.addColumn(column);

  // A heading row for each value of each ticked group (FN_GETFIXCOLNAMEFOR, report 1).
  if (call.unionGroups !== "" && call.checkQuery.includes("CHK_GRPASHD,")) {
    const smartColumns: string[] = [];
    const smartValues: string[] = [];
    const sorting: string[] = [];
    let addonNumber = 0;
    for (const group of groupList(call.unionGroups)) {
      smartColumns.push(groupSmartColumn(group, addonNumber));
      smartValues.push(group);
      const isAddon = removeAliasUpper(group).includes("TXT_");
      if (isAddon) addonNumber += 1;
      const fix = groupHeadingColumns(group, addonNumber);
      if (!fix) throw groupFailed();
      sorting.push(group);
      const nameValue = group.toUpperCase().includes("AC.NAME") ? "AC.NAME" : group;
      const values = [...fix.values, `'${fix.rowType}'`, ...smartValues, nameValue, sorting.join(" || ' ' || ")];
      const headingSql = frag(`SELECT DISTINCT ${values.map((value, index) => `${value} AS "c${index}"`).join(", ")} ${csFrom} ${call.where} ORDER BY "c${fix.values.length + 1 + smartValues.length}"`);
      const targets = [...fix.columns, "ROW_DATA_TYPE", ...smartColumns, "NAME", "SORTING_COL"];
      for (const heading of (await runReportSql(loader, headingSql)).rows) {
        const row: Record<string, unknown> = {};
        targets.forEach((column, index) => { row[column] = heading[`c${index}`]; });
        for (const column of Object.keys(row)) table.addColumn(column);
        table.insert(row);
      }
    }
  }

  for (const row of lines.rows) table.rows.push({ ...Object.fromEntries(table.columns.map((name) => [name, null])), ...row });

  // SORTING_COL trimmed, account headings end in "   H", SELECTED_NAME is the account.
  const sortCol = table.name("SORTING_COL")!;
  for (const row of table.rows) if (row[sortCol] !== null && row[sortCol] !== undefined) row[sortCol] = toText(row[sortCol]).trim();
  for (const row of table.rows) if (table.get(row, "ROW_DATA_TYPE") === "AC" && row[sortCol] !== null && row[sortCol] !== undefined) row[sortCol] = `${row[sortCol]}   H`;
  table.addColumn("SELECTED_NAME");
  for (const row of table.rows) row.SELECTED_NAME = table.get(row, "SMART_NAME");

  // A schedule heading sorts by the schedule's code and name.
  if (call.selectScheduleKey !== "") {
    const keys = [...new Set(table.rows.filter((row) => table.get(row, "ROW_DATA_TYPE") === "SCHEDULE").map((row) => Number(table.get(row, "SMART_SCHEDULE_CODE"))).filter((key) => Number.isInteger(key)))];
    if (keys.length > 0) {
      const schedules = new Map((await runReportSql(loader, `SELECT bs_key, bs_code, bs_desc FROM ${db}balsheet WHERE bs_key = ANY($1::int[])`, [keys])).rows.map((row) => [String(row.bs_key), row]));
      for (const row of table.rows.filter((candidate) => table.get(candidate, "ROW_DATA_TYPE") === "SCHEDULE")) {
        const schedule = schedules.get(String(table.get(row, "SMART_SCHEDULE_CODE")));
        if (schedule) row[sortCol] = schedule.bs_code === null || schedule.bs_desc === null ? null : `${schedule.bs_code} ${schedule.bs_desc}`;
      }
    }
  }

  // Narration under each voucher: SORTING_COL + P, P1 .. P9, inserted piece by piece.
  const narrationName = table.name(narrationColumn);
  if (call.showNarration && useUnion && narrationName) {
    const copy = ["SMART_LED_KEY", "SYSTEM_BLANK1", "SMART_AC_CODE", "SMART_BOOK_CODE", "SMART_SCHEDULE_CODE", "ADDON_1_CODE", "ADDON_2_CODE", "ADDON_3_CODE", "ADDON_4_CODE", "SORTING_DATE", "SYSTEM_BLANK2", "SMART_NAME", "SMART_SELECTED_BOOK", "SMART_SELECTED_SCHDULE", "SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2", "SMART_SELECTED_ADDON3", "SMART_SELECTED_ADDON4", "bk_dbcode", "led_key", "book"];
    const pieces = table.rows.map((row) => {
      const narration = row[narrationName];
      return narration === null || narration === undefined || toText(narration).trim() === "" ? [] : narrationPieces(String(narration), { count: 10, firstMarked: true, lastUnbounded: true });
    });
    const added: Record<string, unknown>[] = [];
    for (let chunk = 0; chunk < 10; chunk += 1) {
      table.rows.forEach((row, index) => {
        const piece = pieces[index][chunk];
        if (piece === undefined) return;
        const values: Record<string, unknown> = {};
        for (const column of copy) if (table.has(column)) values[column] = table.get(row, column);
        values.SORTING_COL = row[sortCol] === null || row[sortCol] === undefined ? null : `${row[sortCol]}P${chunk === 0 ? "" : chunk}`;
        values.ROW_DATA_TYPE = "NARRATION";
        values.NAME = piece;
        added.push(values);
      });
    }
    for (const values of added) table.insert(values);
    sortRows(table, [(row) => textKey(row[sortCol]), (row) => textKey(table.get(row, "ROW_DATA_TYPE"))]);
  } else {
    sortRows(table, [(row) => textKey(row[sortCol])]);
  }
  daybookColumns(plan, table, false);
  return table;
}

const removeAliasUpper = (group: string) => (group.includes(".") ? group.slice(group.indexOf(".") + 1) : group).toUpperCase();

// ======================================================================================
// 4: LEDGER (lines 2269-3375)
// ======================================================================================
//
// RESULT_TABLE_<user> is built through a dozen INSERT / UPDATE / DELETE statements and returned
// ORDER BY SORTING_COL, SORTING_DATE: heading rows of the ticked groups, each account's opening
// (with what was posted before From), the postings, their narration as rows of 40 characters, a
// journal's contra lines, the closing and account heading rows.

const SUBLED = "SUBLED";

/** Licences whose ledger keeps only some voucher series (29, 30 and 73). */
const SERIES_FILTER = " and (left(led.DOC_SERIES,2)='MS' or left(led.DOC_SERIES,2)='RD' or left(led.DOC_SERIES,2)='AI' or left(led.DOC_SERIES,2)='AL' or left(led.DOC_SERIES,2)='RG' or left(led.DOC_SERIES,2)='HC' or left(led.DOC_SERIES,3)='ADC')";

/** A group's term in a sorting string: the schedule sorts by its code first. */
const sortingTerm = (group: string) => (group.toUpperCase() === "BS.BS_DESC" ? `BS.BS_CODE || ' ' || ${group}` : group);

async function ledger(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
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

  let csFrom: string;
  let openingFrom: string;
  if (subLedger) {
    const join = `left join ${db}addon_aentry aentry on led.LED_KEY=aentry.aona_ledid and ledpost.POST_BOOKCD<>ledpost.POST_CODE`;
    csFrom = withEntryAddon(call.from_, join);
    openingFrom = withEntryAddon(call.openingFrom, join);
    if (fromText !== desktopDate(call.tarikh1)) throw new ReportRefusal("Between Date Not Allowed For Sub Ledger", "INTERNAL PROGRAM FAILURE");
  } else {
    csFrom = withEntryAddon(call.from_, `left join ${db}addon_aentry aentry on led.led_key=aentry.aona_ledid`);
    openingFrom = withEntryAddon(call.openingFrom, `left join ${db}addon_aentry aentry on ac.code=aentry.aona_accode`);
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
  const table = tableFromFields(lines.fields);
  const numberColumn = new Set(lines.fields.filter((field) => table.kind(field.name) !== "text").map((field) => field.name.toLowerCase()));
  for (const column of ["NAME", "SMART_NAME", "ROW_DATA_TYPE", "SORTING_COL", "CLOSING_BAL", "SYSTEM_BLANK1", "SMART_AC_CODE", "SMART_SELECTED_BOOK", "SMART_SELECTED_SCHDULE", "SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2", "SMART_SELECTED_ADDON3", "SMART_SELECTED_ADDON4", "DR_CR", "DEBIT", "CREDIT", "AC_CODE", "AC_BOOK", "SELECTED_NAME", "SELECTED_DATE", "SORTING_DATE", "BOOK"]) table.addColumn(column);
  // RESULT_TABLE's ALTER COLUMNs: the amounts are money, the closing numeric(18,2).
  for (const column of ["DEBIT", "CREDIT", "CLOSING_BAL"]) table.setKind(column, "decimal");

  // Heading rows of the ticked groups other than the account (book, schedule, addon), one level at a time.
  const groups = groupList(replaceCI(call.unionGroups, "AC.NAME,", ""));
  const smartColumns: string[] = [];
  let addonNumber = 0;
  const sortingTerms: string[] = [];
  for (const group of groups) {
    const smart = groupSmartColumn(group, addonNumber);
    if (smart !== "") smartColumns.push(smart);
    const fix = groupHeadingColumns(group, addonNumber + (removeAliasUpper(group).includes("TXT_") ? 1 : 0));
    if (!fix) throw groupFailed();
    if (fix.addon) addonNumber += 1;
    sortingTerms.push(sortingTerm(group));
    const sortingSql = sortingTerms.join(" || ' ' || ");
    const smartValues = groups.slice(0, sortingTerms.length).map((part, index) => `${part} AS "s${index}"`).join(", ");
    const schedule = group.toUpperCase() === "BS.BS_DESC";
    const headingSql = frag(`SELECT DISTINCT ${fix.values[0]} AS "k", ${smartValues}, ${group} AS "n", ${sortingSql} AS "o"${schedule ? ", BS.BS_CODE AS \"b\"" : ""} ${csFrom} ${where} ORDER BY ${schedule ? "BS.BS_CODE" : group}`);
    for (const heading of (await runReportSql(loader, headingSql)).rows) {
      const values: Record<string, unknown> = { [fix.columns[0]]: heading.k, ROW_DATA_TYPE: fix.rowType, NAME: heading.n, SORTING_COL: heading.o };
      smartColumns.forEach((column, index) => { values[column] = heading[`s${index}`]; });
      if (schedule) values.SYSTEM_BLANK1 = heading.b;
      for (const column of Object.keys(values)) table.addColumn(column);
      table.insert(values);
    }
  }

  // Opening balances (TABLE_NAME_OPENING, TEMP_OPENINGS), unless the ledger is an entry addon's or the operator asked for none.
  if ((call.acAddonRepdefa !== "E" || subLedger) && !check("CHK_OPENING")) {
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
        const depth = [0, 1, 2, 3].filter((index) => call.selectKey.slice(0, index + 1).every((key) => key !== "")).length;
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

  // The ledger lines, and (Show Narration without "In Same Line") each one's narration as rows of 40 characters.
  const lineRows: ResultRow[] = lines.rows.map((row) => ({ ...row }));
  const narrationRows: ResultRow[] = [];
  if (useUnion) {
    const narration = await runReportSql(loader, frag(`SELECT ${call.fixCols}${call.unionQuery}${reference},LED.NARRATION AS "NARRATION1"${selectEnd} ${csFrom} ${where}${lineFilters}${check("CHK_OPENING") ? " AND LED.BOOK <> 4" : ""}${orderBy}`));
    const names = lines.fields.map((field) => field.name);
    const nameAt = names.findIndex((name) => name.toUpperCase() === "NAME");
    const sortName = table.name("SORTING_COL")!;
    for (const source of narration.rows) {
      const cells = narration.fields.map((field) => source[field.name]);
      // NARRATION_1 is '\' + the narration; a voucher without one gives '\' (or NULL) and no rows.
      if (cells[nameAt] === null || cells[nameAt] === undefined) continue;
      const full = String(cells[nameAt]);
      if (full.trim() === "\\") continue;
      const base: ResultRow = {};
      names.forEach((name, index) => { base[name] = cells[index] === "" && numberColumn.has(name.toLowerCase()) ? 0 : cells[index]; });
      base[table.name("ROW_DATA_TYPE")!] = "NARRATION";
      narrationPieces(full, { count: 20, firstMarked: false, lastUnbounded: false }).forEach((piece, chunk) => {
        const row: ResultRow = { ...base };
        row[sortName] = base[sortName] === null ? null : `${base[sortName]}N${String(chunk + 1).padStart(2, "0")}`;
        row[names[nameAt]] = piece;
        narrationRows.push(row);
      });
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
        const journalDate = parseRowDate(toText(table.get(journal, "selected_date")));
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

  if (call.jvDetailsRequired) throw new ReportRefusal("Show JV Details is not available in the web version yet.", "Not ported yet");
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
  if (check("CHK_PROD_DTL_REQ") && call.acAddonRepdefa !== "E") await ledgerProducts(loader, plan, table, hideBookFilter);
  if ([3, 5, 7, 8, 18].includes(licence)) {
    const shorts = new Map((accountCodes.length === 0 ? [] : (await runReportSql(loader, `SELECT code, name, a_short FROM ${db}account WHERE code = ANY($1::int[])`, [accountCodes])).rows).map((row) => [String(row.code), row]));
    for (const row of table.rows.filter((candidate) => table.get(candidate, "ROW_DATA_TYPE") === "AC")) {
      const account = shorts.get(String(table.get(row, "AC_CODE")));
      if (account) table.set(row, "NAME", account.a_short === null ? null : `${account.name} - ${account.a_short}`);
    }
  }
  if (call.acAddonRepdefa === "E") for (const row of table.rows.filter((candidate) => table.get(candidate, "ROW_DATA_TYPE") === "LED")) table.set(row, "NAME", table.get(row, "SMART_NAME"));
  if (check("CHK_ACC_CNFRM") || check("CHK_TFPRINT")) throw new ReportRefusal("Account Confirmation and T - Format Print are not available in the web version yet.\nUntick them to see the ledger.", "Not ported yet");

  // ORDER BY SORTING_COL, SORTING_DATE (stable, as rows were added).
  const sortCol = table.name("SORTING_COL")!;
  const sortDate = table.name("SORTING_DATE")!;
  sortRows(table, [(row) => textKey(row[sortCol]), (row) => textKey(row[sortDate])]);
  return table;
}

/** CHK_PROD_DTL_REQ: each voucher's products under it (TEMP_TABLE_PRODRECORD). */
async function ledgerProducts(loader: Loader, plan: ReportPlan, table: ResultTable, hideBookFilter: (column: string) => string) {
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
