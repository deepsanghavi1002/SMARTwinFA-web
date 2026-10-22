/**
 * The standard invoice (bill) as a printable page. Pure (no server code), so the screen builds the same HTML for the on-screen
 * preview and for the printer: what is previewed is exactly what prints. The "special" formats of the future are further functions
 * of the same Bill.
 */

export type BillParty = Readonly<{ name: string; lines: readonly string[]; gstin: string; state: string; pan: string; phone: string }>;

export type Bill = Readonly<{
  title: string;
  register: string;
  company: Readonly<{ name: string; lines: readonly string[]; gstin: string; pan: string; contact: string; state: string }>;
  header: Readonly<{ docNo: string; date: string; challanNo: string; challanDate: string; creditDays: string; narration: string }>;
  billTo: BillParty;
  /** The address the entry ships to (the billing address again when no other was picked). */
  shipTo: BillParty;
  /** The account addons marked for the bill (addon_fld fiel_docprint Y) that the entry holds a value for. */
  addons: readonly Readonly<{ label: string; value: string }>[];
  lines: readonly Readonly<{ serial: string; description: string; hsn: string; qty: string; uom: string; rate: string; rateUom: string; amount: string; discount: string; taxable: string; taxRate: string; tax: string; total: string }>[];
  totals: readonly Readonly<{ label: string; amount: string; strong?: boolean }>[];
  finalAmount: string;
  inWords: string;
}>;

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below1000(number: number): string {
  const words: string[] = [];
  if (number >= 100) { words.push(`${ONES[Math.floor(number / 100)]} Hundred`); number %= 100; }
  if (number >= 20) { words.push(TENS[Math.floor(number / 10)] + (number % 10 ? ` ${ONES[number % 10]}` : "")); }
  else if (number > 0) words.push(ONES[number]);
  return words.join(" ");
}

/** An amount in Indian words: "Rupees One Lakh Twenty Thousand and Fifty Paise Only". */
export function amountInWords(amount: number): string {
  const rupees = Math.floor(Math.abs(amount) + 1e-9);
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  const parts: string[] = [];
  let rest = rupees;
  for (const [size, name] of [[10000000, "Crore"], [100000, "Lakh"], [1000, "Thousand"]] as const) {
    if (rest >= size) { parts.push(`${below1000(Math.floor(rest / size))} ${name}`); rest %= size; }
  }
  if (rest > 0) parts.push(below1000(rest));
  const rupeeWords = parts.length ? parts.join(" ") : "Zero";
  return `Rupees ${rupeeWords}${paise > 0 ? ` and ${below1000(paise)} Paise` : ""} Only`;
}

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (value: string) => {
  const number = Number(value);
  return Number.isFinite(number) && value.trim() !== "" ? number.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value;
};

/** One "Heading: value" line of a top part; nothing when the value is blank. */
function detail(label: string, value: string, strong = false): string {
  return value.trim() === "" ? "" : `<div class="kv"><span>${escape(label)}</span><span>:</span><span>${strong ? `<b>${escape(value)}</b>` : escape(value)}</span></div>`;
}

function party(heading: string, who: BillParty): string {
  return `<div class="box"><div class="cap">${escape(heading)}</div><b>${escape(who.name)}</b>${who.lines.filter(Boolean).map((line) => `<div>${escape(line)}</div>`).join("")}`
    + `${who.state ? `<div>State: ${escape(who.state)}</div>` : ""}${who.gstin ? `<div>GSTIN: <b>${escape(who.gstin)}</b></div>` : ""}${who.pan ? `<div>PAN: ${escape(who.pan)}</div>` : ""}${who.phone ? `<div>Mobile: ${escape(who.phone)}</div>` : ""}</div>`;
}

export function standardBillHtml(bill: Bill): string {
  const rows = bill.lines.map((line) => `<tr><td class="c">${escape(line.serial)}</td><td>${escape(line.description)}</td><td class="c">${escape(line.hsn)}</td>`
    + `<td class="r">${escape(line.qty)}</td><td class="r">${money(line.rate)}</td><td class="c">${escape(line.uom)}${line.rateUom && line.rateUom !== line.uom ? ` / ${escape(line.rateUom)}` : ""}</td><td class="r">${money(line.amount)}</td>`
    + `<td class="r">${Number(line.discount) !== 0 ? money(line.discount) : ""}</td><td class="r">${money(line.taxable)}</td><td class="r">${line.taxRate ? `${escape(line.taxRate)}%` : ""}</td><td class="r">${Number(line.tax) !== 0 ? money(line.tax) : ""}</td><td class="r">${money(line.total)}</td></tr>`).join("");
  const totals = bill.totals.map((total) => `<tr class="${total.strong ? "strong" : ""}"><td>${escape(total.label)}</td><td class="r">${money(total.amount)}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(bill.title)} ${escape(bill.header.docNo)}</title><style>
@page{size:A4 portrait;margin:10mm}
*{box-sizing:border-box}
body{margin:0;padding:0;font:11px/1.35 "Segoe UI",Arial,sans-serif;color:#111;background:#fff}
.page{width:190mm;margin:0 auto;padding:4mm 0}
.top{text-align:center;border:1px solid #222;padding:6px}
.top h1{margin:0;font-size:20px;letter-spacing:.5px}
.title{margin:6px 0 4px;text-align:center;font-size:14px;font-weight:700;letter-spacing:2px}
.grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #222;border-bottom:0}
.grid .box{padding:5px 7px;border-right:1px solid #222;min-height:62px}
.grid .box:last-child{border-right:0}
.kv{display:grid;grid-template-columns:30mm 3mm 1fr}
.cap{font-size:9px;font-weight:700;text-transform:uppercase;color:#555;margin-bottom:2px}
table{width:100%;border-collapse:collapse}
table.items{border:1px solid #222}
.items th,.items td{border:1px solid #777;padding:3px 4px;vertical-align:top}
.items thead th{background:#e9eef6;font-size:10px}
.items td.c{text-align:center}.items td.r,.items th.r{text-align:right}
.bottom{display:grid;grid-template-columns:1fr 62mm;border:1px solid #222;border-top:0}
.bottom>div{padding:5px 7px}
.bottom .words{border-right:1px solid #222}
.sum td{padding:2px 0}.sum td.r{text-align:right}
.sum tr.strong td{border-top:1px solid #222;font-weight:700;font-size:13px;padding-top:4px}
.sign{display:flex;justify-content:space-between;align-items:flex-end;height:26mm;border:1px solid #222;border-top:0;padding:5px 7px}
.note{margin-top:4px;color:#555;font-size:9px}
@media print{.page{width:auto}}
</style></head><body><div class="page">
<div class="top"><h1>${escape(bill.company.name)}</h1>${bill.company.lines.filter(Boolean).map((line) => `<div>${escape(line)}</div>`).join("")}`
    + `${bill.company.contact ? `<div>${escape(bill.company.contact)}</div>` : ""}</div>
<div class="title">${escape(bill.title)}</div>
<div class="grid"><div class="box"><div class="cap">Invoice details</div>
${detail("Invoice No.", bill.header.docNo, true)}${detail("Date", bill.header.date, true)}${detail("Challan No.", bill.header.challanNo)}${detail("Challan Date", bill.header.challanDate)}${detail("Company GSTIN", bill.company.gstin, true)}${detail("State", bill.company.state)}${detail("PAN No.", bill.company.pan)}</div>
<div class="box"><div class="cap">Invoice addons</div>${bill.addons.map((item) => detail(item.label, item.value)).join("")}</div></div>
<div class="grid" style="border-bottom:0">${party("Billed to", bill.billTo)}${party("Ship to", bill.shipTo)}</div>
<table class="items"><thead><tr><th>Sr</th><th style="width:34%">Description of goods</th><th>HSN</th><th class="r">Qty</th><th class="r">Rate</th><th>UOM</th><th class="r">Amount</th><th class="r">Discount</th><th class="r">Taxable</th><th class="r">Tax %</th><th class="r">Tax</th><th class="r">Total</th></tr></thead><tbody>${rows}</tbody></table>
<div class="bottom"><div class="words"><div class="cap">Amount in words</div><b>${escape(bill.inWords)}</b>${bill.header.narration ? `<div class="note">Narration: ${escape(bill.header.narration)}</div>` : ""}</div>
<div><table class="sum">${totals}<tr class="strong"><td>Invoice total</td><td class="r">${money(bill.finalAmount)}</td></tr></table></div></div>
<div class="sign"><div class="note">Goods once sold will not be taken back. Subject to local jurisdiction. E. &amp; O.E.</div><div style="text-align:right">For <b>${escape(bill.company.name)}</b><br><br><br>Authorised Signatory</div></div>
</div></body></html>`;
}

/**
 * Several bills as one document (Range print): each bill on a sheet of its own - a page break before the next when printed, and on the
 * screen a sheet at least one A4 tall, so the preview's pages follow the bills. The styles are the first bill's.
 */
export function combineBills(htmls: readonly string[]): string {
  if (htmls.length <= 1) return htmls[0] ?? "";
  const head = htmls[0].slice(0, htmls[0].search(/<body[^>]*>/i));
  const bodies = htmls.map((html) => {
    const start = html.search(/<body[^>]*>/i);
    const open = html.slice(start).match(/<body[^>]*>/i);
    const end = html.lastIndexOf("</body>");
    return start < 0 || !open || end < 0 ? "" : html.slice(start + open[0].length, end);
  });
  const sheets = bodies.map((body, index) => `<div class="bill-sheet"${index < bodies.length - 1 ? ' style="break-after:page;page-break-after:always"' : ""}>${body}</div>`).join("\n");
  return `${head.replace("</style>", "@media screen{.bill-sheet{min-height:297mm;box-sizing:border-box}}</style>")}<body>${sheets}</body></html>`;
}
