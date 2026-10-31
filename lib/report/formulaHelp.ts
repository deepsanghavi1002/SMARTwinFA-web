/**
 * The "Pick a formula" list of Add Column: every function in plain words, with an example that uses the report's own columns.
 * In an example {N1} and {N2} are the first number columns, {T1} the first text column and {D1} the first date column.
 */

export type FormulaHelp = Readonly<{ name: string; group: string; task: string; example: string; /** A name for the new column, when the box is empty. */ title?: string }>;

export const HELP_GROUPS = ["Totals and maths", "If / then", "Count and average", "Add up with conditions", "Look up", "Text", "Dates"] as const;

export const FORMULA_HELP: readonly FormulaHelp[] = [
  { name: "SUM", group: "Totals and maths", task: "Add up a whole column (one figure, on the last line)", example: "=SUM({N1})", title: "Total" },
  { name: "PRODUCT", group: "Totals and maths", task: "Multiply all the figures of a column", example: "=PRODUCT({N1})" },
  { name: "SUMPRODUCT", group: "Totals and maths", task: "Multiply two columns line by line, then add up", example: "=SUMPRODUCT({N1}, {N2})" },
  { name: "ROUND", group: "Totals and maths", task: "Round off to a number of decimals", example: "=ROUND({N1}, 2)", title: "Rounded" },
  { name: "ROUNDUP", group: "Totals and maths", task: "Always round up (1.21 becomes 1.3)", example: "=ROUNDUP({N1}, 1)" },
  { name: "ROUNDDOWN", group: "Totals and maths", task: "Always round down (1.29 becomes 1.2)", example: "=ROUNDDOWN({N1}, 1)" },
  { name: "TRUNC", group: "Totals and maths", task: "Cut off the decimals, without rounding", example: "=TRUNC({N1}, 0)" },
  { name: "INT", group: "Totals and maths", task: "Whole number below (2.9 becomes 2)", example: "=INT({N1})" },
  { name: "ABS", group: "Totals and maths", task: "Make a figure positive (drop the minus)", example: "=ABS({N1})", title: "Positive" },
  { name: "MOD", group: "Totals and maths", task: "Remainder after dividing (to find odd / even)", example: "=MOD({N1}, 2)" },
  { name: "CEILING.MATH", group: "Totals and maths", task: "Round up to a multiple (23 to 30 with 10)", example: "=CEILING.MATH({N1}, 10)" },
  { name: "FLOOR.MATH", group: "Totals and maths", task: "Round down to a multiple (23 to 20 with 10)", example: "=FLOOR.MATH({N1}, 10)" },
  { name: "SQRT", group: "Totals and maths", task: "Square root", example: "=SQRT({N1})" },
  { name: "SUBTOTAL", group: "Totals and maths", task: "Total of a column (9 = add up, 1 = average, 2 = count, 4 = highest, 5 = lowest)", example: "=SUBTOTAL(9, {N1})" },
  { name: "AGGREGATE", group: "Totals and maths", task: "Total of a column that skips the lines with errors", example: "=AGGREGATE(9, 6, {N1})" },
  { name: "LARGE", group: "Totals and maths", task: "The 2nd highest figure of a column", example: "=LARGE({N1}, 2)" },
  { name: "SMALL", group: "Totals and maths", task: "The 2nd lowest figure of a column", example: "=SMALL({N1}, 2)" },
  { name: "MAX", group: "Totals and maths", task: "Highest figure of a column", example: "=MAX({N1})" },
  { name: "MIN", group: "Totals and maths", task: "Lowest figure of a column", example: "=MIN({N1})" },
  { name: "LET", group: "Totals and maths", task: "Keep a working figure under a name, then use it again", example: "=LET(x, {N1}*10, x+100)" },

  { name: "IF", group: "If / then", task: "Show one thing if true, another if not", example: '=IF({N1}>100, "High", "Low")', title: "Status" },
  { name: "IFS", group: "If / then", task: "Several checks one after another (grades, slabs)", example: '=IFS({N1}>=1000, "A", {N1}>=100, "B", TRUE(), "C")', title: "Grade" },
  { name: "AND", group: "If / then", task: "Yes only when every check is true", example: '=IF(AND({N1}>10, {N2}<100), "Yes", "No")' },
  { name: "OR", group: "If / then", task: "Yes when any one check is true", example: '=IF(OR({N1}>10, {N2}<100), "Yes", "No")' },
  { name: "NOT", group: "If / then", task: "Turn yes into no, and no into yes", example: "=NOT({N1}>100)" },
  { name: "XOR", group: "If / then", task: "Yes when an odd number of checks are true", example: "=XOR({N1}>10, {N2}>20)" },
  { name: "IFERROR", group: "If / then", task: "Show something else when a figure cannot be worked out (divide by zero)", example: "=IFERROR({N1}/{N2}, 0)", title: "Ratio" },
  { name: "IFNA", group: "If / then", task: "Show something else when a look up finds nothing", example: '=IFNA(XLOOKUP({T1}, {T1}, {N1}), "Not found")' },
  { name: "SWITCH", group: "If / then", task: "Give a name for each value (1 = Cash, 2 = Bank)", example: '=SWITCH({T1}, "A", "Cash", "B", "Bank", "Other")' },
  { name: "CHOOSE", group: "If / then", task: "Pick the 1st, 2nd or 3rd of a list by a number", example: '=CHOOSE(1, "Cash", "Bank", "Sales")' },
  { name: "TRUE", group: "If / then", task: "The word yes, to use inside other formulas", example: "=TRUE()" },
  { name: "FALSE", group: "If / then", task: "The word no, to use inside other formulas", example: "=FALSE()" },

  { name: "COUNT", group: "Count and average", task: "How many figures a column has", example: "=COUNT({N1})" },
  { name: "COUNTA", group: "Count and average", task: "How many lines are filled in (figures or text)", example: "=COUNTA({T1})" },
  { name: "COUNTBLANK", group: "Count and average", task: "How many lines are empty", example: "=COUNTBLANK({T1})" },
  { name: "COUNTIF", group: "Count and average", task: "Count the lines that match one thing", example: '=COUNTIF({T1}, "Sales")' },
  { name: "COUNTIFS", group: "Count and average", task: "Count the lines that match several things together", example: '=COUNTIFS({T1}, "Sales", {N1}, ">1000")' },
  { name: "AVERAGE", group: "Count and average", task: "Average of a column", example: "=AVERAGE({N1})" },
  { name: "AVERAGEIF", group: "Count and average", task: "Average of the lines that match one thing", example: '=AVERAGEIF({T1}, "Sales", {N1})' },
  { name: "AVERAGEIFS", group: "Count and average", task: "Average of the lines that match several things", example: '=AVERAGEIFS({N1}, {T1}, "Sales", {N2}, ">0")' },
  { name: "MAXIFS", group: "Count and average", task: "Highest figure among the lines that match", example: '=MAXIFS({N1}, {T1}, "Sales")' },
  { name: "MINIFS", group: "Count and average", task: "Lowest figure among the lines that match", example: '=MINIFS({N1}, {T1}, "Sales")' },

  { name: "SUMIF", group: "Add up with conditions", task: "Add up the lines that match one thing (party total on every line)", example: "=SUMIF({T1}, {T1}, {N1})", title: "Party Total" },
  { name: "SUMIFS", group: "Add up with conditions", task: "Add up the lines that match several things together", example: "=SUMIFS({N1}, {T1}, {T1}, {N2}, \">0\")" },

  { name: "VLOOKUP", group: "Look up", task: "Bring a figure from another open report", example: '=VLOOKUP({T1}, "Report!A:C", 3, FALSE)' },
  { name: "XLOOKUP", group: "Look up", task: "Find a value in one column and bring the same line of another", example: '=XLOOKUP({T1}, {T1}, {N1}, "Not found")' },
  { name: "INDEX", group: "Look up", task: "The figure at a place (2nd line) of a column", example: "=INDEX({N1}, 2)" },
  { name: "MATCH", group: "Look up", task: "At which line a value is (0 = exactly this value)", example: "=MATCH({T1}, {T1}, 0)" },
  { name: "XMATCH", group: "Look up", task: "At which line a value is, in a column", example: "=XMATCH({T1}, {T1})" },
  { name: "ROW", group: "Look up", task: "The serial number of the line (1, 2, 3...)", example: "=ROW()", title: "Sr No" },
  { name: "ROWS", group: "Look up", task: "How many lines a column has", example: "=ROWS({N1})" },
  { name: "COLUMNS", group: "Look up", task: "How many columns a range has (1 for one column)", example: "=COLUMNS({N1})" },

  { name: "LEFT", group: "Text", task: "The first letters of a text", example: "=LEFT({T1}, 5)" },
  { name: "RIGHT", group: "Text", task: "The last letters of a text", example: "=RIGHT({T1}, 4)" },
  { name: "MID", group: "Text", task: "Letters from the middle of a text", example: "=MID({T1}, 3, 5)" },
  { name: "LEN", group: "Text", task: "How many letters a text has", example: "=LEN({T1})" },
  { name: "TRIM", group: "Text", task: "Take out the extra spaces", example: "=TRIM({T1})" },
  { name: "CLEAN", group: "Text", task: "Take out the hidden characters that do not print", example: "=CLEAN({T1})" },
  { name: "UPPER", group: "Text", task: "Make it CAPITAL letters", example: "=UPPER({T1})" },
  { name: "LOWER", group: "Text", task: "Make it small letters", example: "=LOWER({T1})" },
  { name: "PROPER", group: "Text", task: "Capital first letter of each word", example: "=PROPER({T1})" },
  { name: "CONCAT", group: "Text", task: "Join texts and figures together", example: '=CONCAT({T1}, " - ", {N1})' },
  { name: "TEXTJOIN", group: "Text", task: "Join a whole column into one line with a separator", example: '=TEXTJOIN(", ", TRUE(), {T1})' },
  { name: "SUBSTITUTE", group: "Text", task: "Change a word to another word", example: '=SUBSTITUTE({T1}, "Old", "New")' },
  { name: "FIND", group: "Text", task: "At which letter a character is (error when absent)", example: '=FIND("/", {T1})' },
  { name: "TEXT", group: "Text", task: "Show a figure or date in a format you choose", example: '=TEXT({N1}, "#,##0.00")' },
  { name: "TEXTBEFORE", group: "Text", task: "The text before a separator", example: '=TEXTBEFORE({T1}, "/")' },
  { name: "TEXTAFTER", group: "Text", task: "The text after a separator", example: '=TEXTAFTER({T1}, "/")' },

  { name: "TODAY", group: "Dates", task: "Today's date", example: "=TODAY()" },
  { name: "NOW", group: "Dates", task: "Today's date and time", example: "=NOW()" },
  { name: "DATE", group: "Dates", task: "Make a date from year, month and day", example: "=DATE(2026, 4, 1)" },
  { name: "DAY", group: "Dates", task: "Day of a date", example: "=DAY({D1})" },
  { name: "MONTH", group: "Dates", task: "Month of a date", example: "=MONTH({D1})" },
  { name: "YEAR", group: "Dates", task: "Year of a date", example: "=YEAR({D1})" },
  { name: "EOMONTH", group: "Dates", task: "Last date of the month", example: "=EOMONTH({D1}, 0)" },
  { name: "EDATE", group: "Dates", task: "The same date some months later (3) or earlier (-3)", example: "=EDATE({D1}, 3)" },
  { name: "DATEDIF", group: "Dates", task: "Gap between two dates: \"d\" days, \"m\" months, \"y\" years", example: '=DATEDIF({D1}, TODAY(), "d")', title: "Days Old" },
  { name: "NETWORKDAYS", group: "Dates", task: "Working days (Monday to Friday) between two dates", example: "=NETWORKDAYS({D1}, TODAY())" },
];

/** The not-available ones, said once in the list so nobody looks for them. */
export const HELP_NOT_AVAILABLE = "FILTER, SORT, SORTBY, UNIQUE, SEQUENCE, TAKE, DROP, CHOOSECOLS, CHOOSEROWS, VSTACK, HSTACK, TEXTSPLIT, LAMBDA, MAP, SCAN give a whole list, not one value for each line: use the grid's own filter, sort, Group By and Pivot buttons. DSUM, DCOUNT, DAVERAGE, HLOOKUP, OFFSET, INDIRECT have no use in a report: use SUMIFS, XLOOKUP or INDEX with MATCH.";

/** An example with the report's columns put in place of {N1} {N2} {T1} {D1}. */
export function fillExample(example: string, columns: readonly { caption: string; kind: "text" | "number" | "date" }[]): string {
  const pick = (kind: "text" | "number" | "date", at: number) => columns.filter((column) => column.kind === kind)[at]?.caption ?? columns[Math.min(at, columns.length - 1)]?.caption ?? "A";
  const name = (caption: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(caption) ? caption : `[${caption}]`);
  return example
    .replace(/\{N1\}/g, name(pick("number", 0))).replace(/\{N2\}/g, name(pick("number", 1)))
    .replace(/\{T1\}/g, name(pick("text", 0))).replace(/\{D1\}/g, name(pick("date", 0)));
}
