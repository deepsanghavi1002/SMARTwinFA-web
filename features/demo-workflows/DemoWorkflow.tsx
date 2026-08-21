"use client";

import { useMemo, useState } from "react";

type DemoFamily = "master" | "invoice" | "voucher" | "import" | "report" | "pdf" | "utility";

type DemoDefinition = {
  family: DemoFamily;
  title: string;
  evidence: string;
  subtitle: string;
};

export const demoWorkflowCatalog: Record<string, DemoDefinition> = {
  "Account Master": { family: "master", title: "Account Master", evidence: "Demo 2", subtitle: "Create debtors, creditors, ledgers, bank, sale, purchase, and cash books." },
  "Product Master": { family: "master", title: "Product Master", evidence: "Demo 3", subtitle: "Create product items with tax, unit, stock, and rate fields." },
  Invoice: { family: "invoice", title: "Sale Invoice", evidence: "Demo 7", subtitle: "Capture invoice header, product lines, discount/slab lines, narration, and payment days." },
  "Cash / Bank": { family: "voucher", title: "Cash / Bank Voucher", evidence: "Demo 12", subtitle: "Capture book, party, debit/credit allocation, narration, and totals." },
  Journal: { family: "voucher", title: "Journal Voucher", evidence: "Demo 12", subtitle: "Capture book, party, debit/credit allocation, narration, and totals." },
  Discount: { family: "voucher", title: "Discount Voucher", evidence: "Demo 12", subtitle: "Capture book, party, debit/credit allocation, narration, and totals." },
  "Import from Excel": { family: "import", title: "Product Import from Excel", evidence: "Demo 16", subtitle: "Preview a mapped product list before a synthetic import is confirmed." },
  "Bank / Cash": { family: "report", title: "Day Book", evidence: "Demo 17", subtitle: "Review bank, cash, and discount day-book entries by date range." },
  Ledger: { family: "report", title: "Ledger Report", evidence: "Demo 20", subtitle: "Review ledger rows and open a zoomed transaction detail." },
  Outstanding: { family: "report", title: "Outstanding Report", evidence: "Demo 21", subtitle: "Review purchase, sale, and expense outstanding balances." },
  "Final Report": { family: "report", title: "Trial Balance", evidence: "Demo 24", subtitle: "Review grouped debit and credit balances with a final total." },
  "Top Reports": { family: "report", title: "Top Report", evidence: "Demo 27", subtitle: "Rank customers, suppliers, and items by value, quantity, or invoice count." },
  "Drop Analysis": { family: "report", title: "Drop Analysis", evidence: "Demo 28", subtitle: "Compare party, item, quantity, and invoice-detail analysis." },
  "Pie Chart": { family: "report", title: "Pie Chart", evidence: "Demo 30", subtitle: "Visualize sales, purchase, expense, receipt, and payment amounts." },
  "Monthly Closing Stock": { family: "report", title: "Monthly Closing Stock", evidence: "Demo 34", subtitle: "Review monthly product quantities and closing values." },
  "Multiple Invoice PDF": { family: "pdf", title: "Multiple Invoice PDF", evidence: "Demo 29", subtitle: "Select invoices and prepare a single mock PDF job." },
  "Lock / Unlock Data": { family: "utility", title: "Lock / Unlock Data", evidence: "Demo 31", subtitle: "Lock an accounting period by selected book and date range." },
};

type MasterRecord = { id: number; name: string; group: string; code: string; tax: string; opening: string; status: string };
type InvoiceLine = { id: number; product: string; qty: string; unit: string; rate: string; discount: string };
type VoucherLine = { id: number; ledger: string; debit: string; credit: string };

const accountRecords: MasterRecord[] = [
  { id: 1, name: "CANARA BANK", group: "Bank Account", code: "BANK-001", tax: "N/A", opening: "25,500.00 Dr", status: "Active" },
  { id: 2, name: "SALES ACCOUNT", group: "Sales", code: "SALE-001", tax: "GST 18%", opening: "0.00", status: "Active" },
  { id: 3, name: "SUNDry DEBTORS", group: "Debtors", code: "DEBT-001", tax: "GST 18%", opening: "42,750.00 Dr", status: "Active" },
];

const productRecords: MasterRecord[] = [
  { id: 1, name: "HPL PLYWOOD 8X4", group: "Board", code: "PLY-008", tax: "GST 18%", opening: "18 PCS", status: "Active" },
  { id: 2, name: "LAMINATE SHEET 1 MM", group: "Laminate", code: "LAM-001", tax: "GST 18%", opening: "42 PCS", status: "Active" },
  { id: 3, name: "WOOD GLUE 1 LTR", group: "Consumable", code: "GLU-001", tax: "GST 12%", opening: "16 PCS", status: "Active" },
];

const reportRows = [
  ["01/04/2026", "Cash Sale", "SALES ACCOUNT", "12,500.00", ""],
  ["03/04/2026", "Receipt", "CANARA BANK", "", "8,750.00"],
  ["06/04/2026", "Purchase", "SUNDry CREDITORS", "22,400.00", ""],
  ["09/04/2026", "Discount", "SALES ACCOUNT", "", "1,250.00"],
];

function toNumber(value: string) {
  return Number(value.replace(/,/g, "")) || 0;
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function ScreenHeader({ definition, message }: { definition: DemoDefinition; message: string }) {
  return <header className="demo-workflow-heading">
    <div><strong>{definition.title}</strong><span>{definition.subtitle}</span></div>
    <aside><b>{definition.evidence}</b><small>Demo-derived prototype · synthetic data</small><em role="status">{message}</em></aside>
  </header>;
}

function ActionBar({ onSave, onReset, onPrint, saveLabel = "Save" }: { onSave: () => void; onReset: () => void; onPrint?: () => void; saveLabel?: string }) {
  return <footer className="demo-action-bar">
    <button type="button" onClick={onSave}>✓ {saveLabel}</button>
    <button type="button" onClick={onReset}>↩ Cancel</button>
    {onPrint && <button type="button" onClick={onPrint}>▣ Print / Preview</button>}
    <button type="button" onClick={onReset}>↻ Refresh</button>
  </footer>;
}

function MasterWorkflow({ definition }: { definition: DemoDefinition }) {
  const isProduct = definition.title === "Product Master";
  const [records, setRecords] = useState(isProduct ? productRecords : accountRecords);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [message, setMessage] = useState("Ready to add a new master record");
  const blank = () => ({ id: 0, name: "", group: isProduct ? "Product Group" : "Debtors", code: "", tax: "GST 18%", opening: "0.00", status: "Active" });
  const [draft, setDraft] = useState<MasterRecord>(blank);
  const select = (record: MasterRecord) => { setSelectedId(record.id); setDraft(record); setMessage(`Selected ${record.name}`); };
  const save = () => {
    if (!draft.name.trim() || !draft.code.trim()) return setMessage("Name and code are required");
    if (records.some((record) => record.name.toLowerCase() === draft.name.trim().toLowerCase() && record.id !== selectedId)) return setMessage("A record with this name already exists");
    const saved = { ...draft, id: selectedId ?? Math.max(0, ...records.map((record) => record.id)) + 1, name: draft.name.trim(), code: draft.code.trim() };
    setRecords((current) => selectedId ? current.map((record) => record.id === selectedId ? saved : record) : [...current, saved]);
    setSelectedId(saved.id); setDraft(saved); setMessage(`${definition.title} saved locally (mock)`);
  };
  const reset = () => { setSelectedId(null); setDraft(blank()); setMessage("Ready to add a new master record"); };
  const remove = () => {
    if (!selectedId) return setMessage("Select a record to delete");
    setRecords((current) => current.filter((record) => record.id !== selectedId)); reset(); setMessage("Record deleted locally (mock)");
  };
  return <section className="demo-workflow master-workflow"><ScreenHeader definition={definition} message={message} />
    <div className="demo-tabs"><button className={!selectedId ? "active" : ""} type="button" onClick={reset}>New (Add)</button><button className={selectedId ? "active" : ""} type="button" onClick={() => setMessage("Select a record from the grid to update or delete")}>Update / Delete</button></div>
    <div className="master-layout">
      <form className="legacy-form-grid" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <label><span>{isProduct ? "Product Name" : "Account Name"} *</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label><span>{isProduct ? "Product Group" : "Account Group"}</span><select value={draft.group} onChange={(event) => setDraft({ ...draft, group: event.target.value })}><option>{isProduct ? "Board" : "Debtors"}</option><option>{isProduct ? "Laminate" : "Creditors"}</option><option>{isProduct ? "Consumable" : "General Ledger"}</option><option>{isProduct ? "Hardware" : "Bank Account"}</option></select></label>
        <label><span>{isProduct ? "Product Code" : "Account Code"} *</span><input value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase() })} /></label>
        <label><span>{isProduct ? "Tax / GST" : "Default Tax"}</span><select value={draft.tax} onChange={(event) => setDraft({ ...draft, tax: event.target.value })}><option>GST 18%</option><option>GST 12%</option><option>GST 5%</option><option>N/A</option></select></label>
        <label><span>{isProduct ? "Opening Stock" : "Opening Balance"}</span><input value={draft.opening} onChange={(event) => setDraft({ ...draft, opening: event.target.value })} /></label>
        <label><span>Status</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option>Active</option><option>Inactive</option></select></label>
      </form>
      <div className="demo-grid-wrap"><div className="demo-grid-title">Existing {isProduct ? "products" : "accounts"}</div><table className="demo-grid"><thead><tr><th>Name</th><th>Group</th><th>Code</th><th>Tax</th><th>Opening</th></tr></thead><tbody>{records.map((record) => <tr className={record.id === selectedId ? "selected" : ""} key={record.id} onClick={() => select(record)}><td>{record.name}</td><td>{record.group}</td><td>{record.code}</td><td>{record.tax}</td><td>{record.opening}</td></tr>)}</tbody></table></div>
    </div>
    <ActionBar onSave={save} onReset={reset} onPrint={() => setMessage("Print preview prepared from synthetic master data")} />
    <button className="demo-delete" type="button" onClick={remove}>Delete selected record</button>
  </section>;
}

function InvoiceWorkflow({ definition }: { definition: DemoDefinition }) {
  const [message, setMessage] = useState("Ready for invoice entry");
  const [lines, setLines] = useState<InvoiceLine[]>([{ id: 1, product: "HPL PLYWOOD 8X4", qty: "2", unit: "PCS", rate: "1200", discount: "0" }]);
  const [party, setParty] = useState("SUNDry DEBTORS");
  const [narration, setNarration] = useState("");
  const total = useMemo(() => lines.reduce((sum, line) => sum + toNumber(line.qty) * toNumber(line.rate) * (1 - toNumber(line.discount) / 100), 0), [lines]);
  const updateLine = (id: number, key: keyof InvoiceLine, value: string) => setLines((current) => current.map((line) => line.id === id ? { ...line, [key]: value } : line));
  const addLine = () => setLines((current) => [...current, { id: Math.max(...current.map((line) => line.id)) + 1, product: "", qty: "1", unit: "PCS", rate: "0", discount: "0" }]);
  const save = () => {
    if (!party || lines.some((line) => !line.product || toNumber(line.qty) <= 0 || toNumber(line.rate) <= 0)) return setMessage("Choose a party and complete every product, quantity, and rate");
    setMessage(`Invoice ${Math.floor(1000 + total)} saved locally (mock) · total ₹${money(total)}`);
  };
  const reset = () => { setParty("SUNDry DEBTORS"); setNarration(""); setLines([{ id: 1, product: "HPL PLYWOOD 8X4", qty: "2", unit: "PCS", rate: "1200", discount: "0" }]); setMessage("Invoice entry reset"); };
  return <section className="demo-workflow invoice-workflow"><ScreenHeader definition={definition} message={message} />
    <div className="transaction-header-grid">
      <label><span>Register</span><select><option>SALE</option><option>SALE RETURN</option></select></label><label><span>Serial</span><input value="S-0426-25" readOnly /></label><label><span>Date</span><input value="06/05/2026" readOnly /></label><label><span>Book</span><select><option>SALE</option><option>CASH SALE</option></select></label>
      <label className="span-two"><span>Party</span><select value={party} onChange={(event) => setParty(event.target.value)}><option>SUNDry DEBTORS</option><option>CANARA BANK</option><option>WALK-IN CUSTOMER</option></select></label><label className="span-two"><span>Billing Address</span><textarea value="Demo billing address · synthetic fixture" readOnly /></label>
    </div>
    <div className="demo-grid-wrap invoice-lines"><div className="demo-grid-title">Invoice product details <button type="button" onClick={addLine}>+ Add product line</button></div><table className="demo-grid"><thead><tr><th>#</th><th>Product</th><th>Qty</th><th>UOM</th><th>Rate</th><th>Discount %</th><th>Value</th></tr></thead><tbody>{lines.map((line, index) => <tr key={line.id}><td>{index + 1}</td><td><input aria-label={`Product ${index + 1}`} value={line.product} onChange={(event) => updateLine(line.id, "product", event.target.value)} /></td><td><input aria-label={`Quantity ${index + 1}`} value={line.qty} onChange={(event) => updateLine(line.id, "qty", event.target.value)} /></td><td><input aria-label={`Unit ${index + 1}`} value={line.unit} onChange={(event) => updateLine(line.id, "unit", event.target.value)} /></td><td><input aria-label={`Rate ${index + 1}`} value={line.rate} onChange={(event) => updateLine(line.id, "rate", event.target.value)} /></td><td><input aria-label={`Discount ${index + 1}`} value={line.discount} onChange={(event) => updateLine(line.id, "discount", event.target.value)} /></td><td>₹{money(toNumber(line.qty) * toNumber(line.rate) * (1 - toNumber(line.discount) / 100))}</td></tr>)}</tbody></table></div>
    <div className="invoice-footer-grid"><label><span>Narration</span><textarea value={narration} onChange={(event) => setNarration(event.target.value)} placeholder="Optional invoice narration" /></label><label><span>Credit days</span><input defaultValue="30" /></label><strong>Entry final amount: ₹{money(total)}</strong></div>
    <ActionBar onSave={save} onReset={reset} onPrint={() => setMessage(`Mock invoice preview prepared for ₹${money(total)}`)} />
  </section>;
}

function VoucherWorkflow({ definition }: { definition: DemoDefinition }) {
  const [message, setMessage] = useState("Ready for voucher entry");
  const [lines, setLines] = useState<VoucherLine[]>([{ id: 1, ledger: "CANARA BANK", debit: "0", credit: "2500" }, { id: 2, ledger: "SALES ACCOUNT", debit: "2500", credit: "0" }]);
  const totalDebit = lines.reduce((sum, line) => sum + toNumber(line.debit), 0);
  const totalCredit = lines.reduce((sum, line) => sum + toNumber(line.credit), 0);
  const update = (id: number, key: keyof VoucherLine, value: string) => setLines((current) => current.map((line) => line.id === id ? { ...line, [key]: value } : line));
  const save = () => setMessage(totalDebit === totalCredit && totalDebit > 0 ? `${definition.title} saved locally (mock)` : "Voucher must have matching non-zero debit and credit totals");
  const reset = () => { setLines([{ id: 1, ledger: "", debit: "0", credit: "0" }]); setMessage("Voucher entry reset"); };
  return <section className="demo-workflow voucher-workflow"><ScreenHeader definition={definition} message={message} />
    <div className="transaction-header-grid"><label><span>Book</span><select><option>{definition.title.replace(" Voucher", "").toUpperCase()}</option><option>JOURNAL</option></select></label><label><span>Serial</span><input value="V-0426-12" readOnly /></label><label><span>Date</span><input value="08/05/2026" readOnly /></label><label><span>Reference</span><input placeholder="Optional reference" /></label><label className="span-two"><span>Party / Narration</span><input placeholder="Select party or enter narration" /></label></div>
    <div className="demo-grid-wrap"><div className="demo-grid-title">Voucher allocation <button type="button" onClick={() => setLines((current) => [...current, { id: current.length + 1, ledger: "", debit: "0", credit: "0" }])}>+ Add ledger</button></div><table className="demo-grid"><thead><tr><th>#</th><th>Ledger</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{lines.map((line, index) => <tr key={line.id}><td>{index + 1}</td><td><input value={line.ledger} aria-label={`Ledger ${index + 1}`} onChange={(event) => update(line.id, "ledger", event.target.value)} /></td><td><input value={line.debit} aria-label={`Debit ${index + 1}`} onChange={(event) => update(line.id, "debit", event.target.value)} /></td><td><input value={line.credit} aria-label={`Credit ${index + 1}`} onChange={(event) => update(line.id, "credit", event.target.value)} /></td></tr>)}</tbody><tfoot><tr><th colSpan={2}>Final totals</th><th>₹{money(totalDebit)}</th><th>₹{money(totalCredit)}</th></tr></tfoot></table></div>
    <ActionBar onSave={save} onReset={reset} onPrint={() => setMessage("Mock voucher preview prepared")} />
  </section>;
}

function ImportWorkflow({ definition }: { definition: DemoDefinition }) {
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState("Select the synthetic mapping to preview product rows");
  const rows = [["PLY-101", "PLYWOOD ARCHITECTURAL 8X4", "18", "PCS"], ["LAM-106", "LAMINATE BROWN 1 MM", "18", "PCS"], ["GLU-120", "WOOD GLUE 1 LTR", "12", "PCS"]];
  return <section className="demo-workflow import-workflow"><ScreenHeader definition={definition} message={message} />
    <div className="import-panel"><h2>Import Data From Excel</h2><label><span>Sheet</span><select><option>Product</option></select></label><label><span>Upload</span><input value="Synthetic product-import.xlsx" readOnly /></label><label><span>File mapping</span><select><option>Product code · name · GST · UOM</option></select></label><button type="button" onClick={() => { setPreview(true); setMessage("Synthetic product rows previewed; no file was read"); }}>Preview mapping</button></div>
    {preview && <div className="demo-grid-wrap"><div className="demo-grid-title">Mapped preview <button type="button" onClick={() => setMessage("3 synthetic products queued locally; no database import was performed")}>Import 3 rows</button></div><table className="demo-grid"><thead><tr><th>Code</th><th>Product</th><th>GST</th><th>UOM</th></tr></thead><tbody>{rows.map((row) => <tr key={row[0]}>{row.map((value) => <td key={value}>{value}</td>)}</tr>)}</tbody></table></div>}
  </section>;
}

function ReportWorkflow({ definition }: { definition: DemoDefinition }) {
  const [message, setMessage] = useState("Set filters and generate a synthetic result preview");
  const [generated, setGenerated] = useState(true);
  const [zoomed, setZoomed] = useState<string | null>(null);
  const [measure, setMeasure] = useState("Amount");
  const reportLabel = definition.title;
  const chart = reportLabel === "Pie Chart";
  const columns = reportLabel === "Trial Balance" ? ["Account group", "Debit", "Credit"] : reportLabel === "Monthly Closing Stock" ? ["Product", "Apr", "May", "Jun", "Closing value"] : reportLabel === "Top Report" ? ["Name", measure, "No. of invoice", "Area"] : ["Date", "Particulars", "Ledger", "Debit", "Credit"];
  const rows = reportLabel === "Trial Balance" ? [["BANK ACCOUNTS", "18,250.00", ""], ["SUNDRY DEBTORS", "42,750.00", ""], ["SALES ACCOUNT", "", "71,400.00"], ["PURCHASE ACCOUNT", "", "22,400.00"]] : reportLabel === "Monthly Closing Stock" ? [["HPL PLYWOOD 8X4", "12", "16", "18", "21,600.00"], ["LAMINATE BROWN 1 MM", "31", "28", "42", "18,900.00"], ["WOOD GLUE 1 LTR", "8", "12", "16", "5,280.00"]] : reportLabel === "Top Report" ? [["SUDESH INTERIORS", "35,420.00", "12", "MUMBAI"], ["SILK ENTERPRISE", "31,420.00", "9", "SURAT"], ["SAFETY SALES CORPORATION", "29,525.00", "8", "THANE"]] : reportRows;
  return <section className="demo-workflow report-workflow"><ScreenHeader definition={definition} message={message} />
    <div className="report-filter-bar"><label>From date<input value="01/04/2026" readOnly /></label><label>To date<input value="31/03/2027" readOnly /></label><label>Book<select><option>All books</option><option>SALE</option><option>CASH</option></select></label>{reportLabel === "Top Report" && <label>Measure<select value={measure} onChange={(event) => setMeasure(event.target.value)}><option>Amount</option><option>Quantity</option><option>No. of invoice</option></select></label>}<button type="button" onClick={() => { setGenerated(true); setMessage(`${reportLabel} generated from synthetic fixture data`); }}>Generate report</button></div>
    {chart ? <div className="chart-preview"><div className="demo-pie" aria-label="Synthetic sales analysis pie chart" /><div><h2>Sales and purchase analysis</h2><ul><li><i className="pie-sales" />Sale amount — ₹42,500.00</li><li><i className="pie-purchase" />Purchase amount — ₹31,250.00</li><li><i className="pie-expense" />Expense — ₹12,400.00</li><li><i className="pie-receipt" />Receipt — ₹18,600.00</li></ul></div></div> : generated && <div className="demo-grid-wrap"><div className="demo-grid-title">{reportLabel} result <button type="button" onClick={() => setMessage("Synthetic export prepared; no file was created")}>Export</button></div><table className="demo-grid report-grid"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row[0]}-${index}`} onDoubleClick={() => reportLabel === "Ledger Report" ? setZoomed(row[1]) : undefined}>{row.map((value) => <td key={value}>{value}</td>)}</tr>)}</tbody><tfoot><tr><th colSpan={Math.max(1, columns.length - 2)}>Final total</th><th>{reportLabel === "Trial Balance" ? "61,000.00" : ""}</th><th>{reportLabel === "Trial Balance" ? "93,800.00" : ""}</th></tr></tfoot></table></div>}
    {zoomed && <div className="report-zoom" role="dialog" aria-label="Ledger transaction detail"><div><h2>{zoomed}</h2><p>Demo 20 establishes a double-click zoom path from a ledger row into transaction detail.</p><button type="button" onClick={() => setZoomed(null)}>Close zoom</button></div></div>}
  </section>;
}

function PdfWorkflow({ definition }: { definition: DemoDefinition }) {
  const invoices = ["S-0426-21 · SUDESH INTERIORS · ₹12,500.00", "S-0426-22 · SILK ENTERPRISE · ₹8,750.00", "S-0426-23 · SAFETY SALES · ₹15,600.00"];
  const [selected, setSelected] = useState<number[]>([0, 1]);
  const [message, setMessage] = useState("Select invoices for one mock document job");
  const toggle = (index: number) => setSelected((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index]);
  return <section className="demo-workflow pdf-workflow"><ScreenHeader definition={definition} message={message} /><div className="pdf-layout"><div><h2>Multiple invoice selection</h2>{invoices.map((invoice, index) => <label className="invoice-select" key={invoice}><input type="checkbox" checked={selected.includes(index)} onChange={() => toggle(index)} />{invoice}</label>)}</div><aside><strong>{selected.length} invoices selected</strong><span>Template: Sales Invoice</span><span>Output: one PDF document</span><button type="button" onClick={() => setMessage(selected.length ? `${selected.length} invoices queued for a mock PDF job` : "Select at least one invoice")}>Generate mock PDF job</button></aside></div></section>;
}

function UtilityWorkflow({ definition }: { definition: DemoDefinition }) {
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState("Choose a book and period");
  const action = () => { setLocked((current) => !current); setMessage(locked ? "Period unlocked locally (mock)" : "Period locked locally (mock)"); };
  return <section className="demo-workflow utility-workflow"><ScreenHeader definition={definition} message={message} /><div className="lock-panel"><h2>Period Lock / Unlock</h2><label><span>Selected book</span><select><option>SALE</option><option>PURCHASE</option><option>CASH SALE</option><option>JOURNAL</option></select></label><label><span>Period lock from</span><input value="01/04/2026" readOnly /></label><label><span>Period lock up to</span><input value="31/05/2026" readOnly /></label><strong className={locked ? "locked" : "unlocked"}>{locked ? "Data locked for selected period" : "Data currently unlocked"}</strong><button type="button" onClick={action}>{locked ? "Unlock data" : "Lock data"}</button></div></section>;
}

export function hasDemoWorkflow(activeItem: string) {
  return activeItem in demoWorkflowCatalog;
}

export function DemoWorkflow({ activeItem }: { activeItem: string }) {
  const definition = demoWorkflowCatalog[activeItem];
  if (!definition) return null;
  if (definition.family === "master") return <MasterWorkflow definition={definition} />;
  if (definition.family === "invoice") return <InvoiceWorkflow definition={definition} />;
  if (definition.family === "voucher") return <VoucherWorkflow definition={definition} />;
  if (definition.family === "import") return <ImportWorkflow definition={definition} />;
  if (definition.family === "report") return <ReportWorkflow definition={definition} />;
  if (definition.family === "pdf") return <PdfWorkflow definition={definition} />;
  return <UtilityWorkflow definition={definition} />;
}
