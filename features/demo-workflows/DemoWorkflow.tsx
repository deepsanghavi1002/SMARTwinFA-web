"use client";

import { LegacyMasterWorkflow } from "./LegacyMasterWorkflow";
import { LegacyEntryWorkflow } from "./LegacyEntryWorkflow";
import { LegacyReportWorkflow } from "./LegacyReportWorkflow";
import { LockUnlockWorkflow, MultipleInvoicePdfWorkflow, ProductExcelImportWorkflow } from "./LegacyUtilityWorkflows";

type WorkflowFamily = "master" | "invoice" | "voucher" | "import" | "report" | "pdf" | "utility";
type WorkflowDefinition = { family: WorkflowFamily; title: string; evidence: string; subtitle: string };

export const workflowCatalog: Record<string, WorkflowDefinition> = {
  "Account Master": { family: "master", title: "Account Master", evidence: "Program 14", subtitle: "Real account, address, balance, lookup, and add-on data." },
  "Product Master": { family: "master", title: "Product Master", evidence: "Program 8", subtitle: "Real product, stock balance, price, UOM, tax, group, account, and add-on data." },
  Invoice: { family: "invoice", title: "Sale Invoice", evidence: "PROCESS / LEDGER / PROD_LEDGER", subtitle: "Real PostgreSQL entry, stock posting, cancellation and print-count flow." },
  "Cash / Bank": { family: "voucher", title: "Cash / Bank Voucher", evidence: "LEDGER / BOOKS 4, 6, 7", subtitle: "Real balanced voucher entry, cancellation and print-count flow." },
  Journal: { family: "voucher", title: "Journal Voucher", evidence: "LEDGER / BOOK 19", subtitle: "Real balanced journal entry, cancellation and print-count flow." },
  Discount: { family: "voucher", title: "Discount Voucher", evidence: "LEDGER / BOOK 5", subtitle: "Real balanced discount entry, cancellation and print-count flow." },
  "Import from Excel": { family: "import", title: "Product Import from Excel", evidence: "PRODUCT_MASTER / PROD_BALANCE", subtitle: "Real XLSX/CSV validation, UOM, rate, opening-stock and product creation flow." },
  "Bank / Cash": { family: "report", title: "Day Book", evidence: "PROCESS / LEDGER", subtitle: "Real day-book register from restored ledger data." },
  Ledger: { family: "report", title: "Ledger Report", evidence: "LEDGER / ACCOUNT", subtitle: "Real posted ledger register from restored data." },
  Outstanding: { family: "report", title: "Outstanding Report", evidence: "OUTCLEAR / LEDGER", subtitle: "Real pending balances using the desktop setoff formula." },
  "Final Report": { family: "report", title: "Trial Balance", evidence: "AC_BALANCE", subtitle: "Real account-balance source register." },
  "Top Reports": { family: "report", title: "Top Sales Parties", evidence: "PROCESS / ACCOUNT", subtitle: "Real ranking from restored Sale Invoice headers." },
  "Drop Analysis": { family: "report", title: "Drop Analysis", evidence: "Product-ledger analysis", subtitle: "Real party/product movement analysis is available while the exact desktop comparison parameters are reconciled." },
  "Pie Chart": { family: "report", title: "Pie Chart", evidence: "Sale PROCESS / ACCOUNT", subtitle: "Real sale-party distribution is available while the desktop chart layout contract is reconciled." },
  "Monthly Closing Stock": { family: "report", title: "Monthly Closing Stock", evidence: "PROD_BALANCE / PRODUCT_MASTER", subtitle: "Real current product balance register." },
  "Stock Reports": { family: "report", title: "Current Stock", evidence: "PROD_BALANCE / PRODUCT_MASTER", subtitle: "Real current product balance register." },
  "Multiple Invoice PDF": { family: "pdf", title: "Multiple Invoice PDF", evidence: "PROCESS / PRINT_COUNT", subtitle: "Real selection, recorded print-count updates and browser PDF dialog." },
  "Lock / Unlock Data": { family: "utility", title: "Lock / Unlock Data", evidence: "BOOK_SETUP", subtitle: "Live book and date-lock state with PostgreSQL lock/unlock updates." },
  "Stock Voucher": { family: "report", title: "Stock Movement", evidence: "PROD_LEDGER", subtitle: "Real product movement register from restored data." },
  "Stock Summary Report": { family: "report", title: "Stock Summary", evidence: "PROD_BALANCE", subtitle: "Real current product-balance register from restored data." },
  "Partywise Stock": { family: "report", title: "Partywise Stock", evidence: "PROD_LEDGER / ACCOUNT", subtitle: "Real party/product movement aggregate from restored data." },
  "Challan": { family: "report", title: "Document Register", evidence: "PROCESS", subtitle: "Real document-header register; exact challan actions are still being mapped." },
  Order: { family: "report", title: "Document Register", evidence: "PROCESS", subtitle: "Real document-header register; exact order actions are still being mapped." },
  "Stock Movement": { family: "report", title: "Stock Movement", evidence: "PROD_LEDGER", subtitle: "Real product movement register from restored data." },
  "Daily Transaction": { family: "report", title: "Daily Transaction", evidence: "LEDGER / BOOK", subtitle: "Real daily debit/credit summary from restored data." },
  Target: { family: "report", title: "Target", evidence: "TARGET", subtitle: "Real target setup rows from restored data." },
  "Book / Series": { family: "report", title: "Book / Series", evidence: "BOOK_SETUP / BOOK_NUMBER", subtitle: "Real book and document-series setup register." },
  "Opening Balance": { family: "report", title: "Opening Balance", evidence: "AC_BALANCE", subtitle: "Real opening-balance source register." },
  "GST Reports": { family: "report", title: "GST / Tax Setup", evidence: "TAX_MASTER", subtitle: "Real tax setup register from restored data." },
  "E-Invoice": { family: "report", title: "E-Invoice Register", evidence: "PROCESS", subtitle: "Real e-invoice acknowledgement and IRN register." },
  "E-Way Bill": { family: "report", title: "E-Way Bill Register", evidence: "PROCESS", subtitle: "Real e-way bill register." },
  Configuration: { family: "report", title: "Configuration", evidence: "SETUP", subtitle: "Real application setup parameter register." },
  "Last Year Detail": { family: "report", title: "Last Year Detail", evidence: "AC_BALANCE", subtitle: "Real balance rows across restored accounting years." },
  "Entry Approved": { family: "report", title: "Approved Entries", evidence: "PROCESS", subtitle: "Real document-header register including approval state." },
  Register: { family: "report", title: "Register", evidence: "PROCESS / LEDGER", subtitle: "The selected module determines whether the document or accounting register is shown." },
  Master: { family: "report", title: "Master", evidence: "Restored legacy masters", subtitle: "The selected module determines the relevant source master register." },
  "Extra Report": { family: "report", title: "Extra Report", evidence: "Report metadata pending", subtitle: "The desktop report definition still needs typed source-contract extraction." },
  "GST Utilities": { family: "utility", title: "GST Utilities", evidence: "Statutory workflow pending", subtitle: "Live tax setup is available; statutory utility actions remain contract-gated." },
  "Quick Data": { family: "utility", title: "Quick Data", evidence: "Desktop action contract pending", subtitle: "The desktop quick-entry action and its data effects are being traced before activation." },
  "Tick Option": { family: "utility", title: "Tick Option", evidence: "Desktop action contract pending", subtitle: "This desktop option has not yet been mapped to a safe web action contract." },
  "Extra Entry": { family: "utility", title: "Extra Entry", evidence: "Entry contract pending", subtitle: "The desktop extra-entry posting and reversal behavior are being traced before activation." },
  Company: { family: "utility", title: "Company", evidence: "Startup context", subtitle: "The restored company context is live; company-management writes require authoritative control-plane data." },
  "Financial Year": { family: "utility", title: "Financial Year", evidence: "Startup context / AC_BALANCE", subtitle: "Restored accounting-year data is live; create/open/close actions require the fiscal-year contract." },
  "Users & Rights": { family: "utility", title: "Users & Rights", evidence: "smart_system control plane unavailable", subtitle: "The intake lacks authoritative security records, so user and permission edits remain unavailable." },
  "Export to Tally": { family: "utility", title: "Export to Tally", evidence: "Tally export contract pending", subtitle: "The source export file layout, idempotency, delivery, and audit rules are being converted before activation." },
  "Backup Data": { family: "utility", title: "Backup Data", evidence: "Operational recovery contract pending", subtitle: "Backup actions remain unavailable until an approved recovery, authorization, retention, and restore workflow is implemented." },
  "Software Videos": { family: "utility", title: "Software Videos", evidence: "Legacy video inventory", subtitle: "The source training-video catalogue still needs a safe web delivery mapping." },
  "About SMARTwinFA": { family: "utility", title: "About SMARTwinFA", evidence: "Application metadata", subtitle: "Product and build metadata are being consolidated from the desktop source." },
  Support: { family: "utility", title: "Support", evidence: "Support routing pending", subtitle: "The legacy support routing and escalation path are being mapped." },
};

function activeLabel(activeItem: string) {
  return activeItem.includes("::") ? activeItem.slice(activeItem.lastIndexOf("::") + 2) : activeItem;
}

function PendingRealWorkflow({ definition }: { definition: WorkflowDefinition }) {
  return <section className="real-workflow-pending" aria-label={`${definition.title} migration status`}>
    <header><strong>{definition.title}</strong><span>{definition.evidence}</span></header>
    <div><h2>Real-data conversion in progress</h2><p>{definition.subtitle}</p><p>No sample records or simulated save results are shown. This screen will activate after its desktop query, permission, validation, and side-effect contract is connected to PostgreSQL.</p></div>
  </section>;
}

export function hasDemoWorkflow(activeItem: string) {
  return activeLabel(activeItem) in workflowCatalog;
}

export function DemoWorkflow({ activeItem }: { activeItem: string }) {
  const label = activeLabel(activeItem);
  const definition = workflowCatalog[label];
  if (activeItem === "TRANSACTION::Register") return <LegacyReportWorkflow kind="document-register" />;
  if (activeItem === "REPORT::Register") return <LegacyReportWorkflow kind="daybook" />;
  if (activeItem === "REPORT::Journal") return <LegacyReportWorkflow kind="journal-voucher" />;
  if (activeItem === "REPORT::Master") return <LegacyMasterWorkflow kind="account" />;
  if (activeItem === "INVENTORY::Master") return <LegacyMasterWorkflow kind="product" />;
  if (definition.family === "master") return <LegacyMasterWorkflow kind={definition.title === "Product Master" ? "product" : "account"} />;
  if (label === "Invoice") return <LegacyEntryWorkflow kind="invoice" />;
  if (label === "Cash / Bank") return <LegacyEntryWorkflow kind="voucher" voucherType="cash-bank" />;
  if (label === "Journal") return <LegacyEntryWorkflow kind="voucher" voucherType="journal" />;
  if (label === "Discount") return <LegacyEntryWorkflow kind="voucher" voucherType="discount" />;
  if (label === "Import from Excel") return <ProductExcelImportWorkflow />;
  if (label === "Multiple Invoice PDF") return <MultipleInvoicePdfWorkflow />;
  if (label === "Lock / Unlock Data") return <LockUnlockWorkflow />;
  if (label === "Bank / Cash") return <LegacyReportWorkflow kind="daybook" />;
  if (label === "Ledger") return <LegacyReportWorkflow kind="ledger" />;
  if (label === "Outstanding") return <LegacyReportWorkflow kind="outstanding" />;
  if (label === "Final Report") return <LegacyReportWorkflow kind="trial-balance" />;
  if (label === "Monthly Closing Stock" || label === "Stock Reports") return <LegacyReportWorkflow kind="closing-stock" />;
  if (label === "Top Reports") return <LegacyReportWorkflow kind="top-sales" />;
  if (label === "Drop Analysis") return <LegacyReportWorkflow kind="partywise-stock" />;
  if (label === "Pie Chart") return <LegacyReportWorkflow kind="sales-distribution" />;
  if (label === "Stock Voucher" || label === "Stock Movement") return <LegacyReportWorkflow kind="stock-movement" />;
  if (label === "Stock Summary Report") return <LegacyReportWorkflow kind="closing-stock" />;
  if (label === "Partywise Stock") return <LegacyReportWorkflow kind="partywise-stock" />;
  if (label === "Challan" || label === "Order" || label === "Entry Approved") return <LegacyReportWorkflow kind="document-register" />;
  if (label === "Daily Transaction") return <LegacyReportWorkflow kind="daily-transaction" />;
  if (label === "Target") return <LegacyReportWorkflow kind="target-register" />;
  if (label === "Book / Series") return <LegacyReportWorkflow kind="book-series" />;
  if (label === "Opening Balance" || label === "Last Year Detail") return <LegacyReportWorkflow kind="opening-balance" />;
  if (label === "GST Reports") return <LegacyReportWorkflow kind="tax-setup" />;
  if (label === "E-Invoice") return <LegacyReportWorkflow kind="e-invoice-register" />;
  if (label === "E-Way Bill") return <LegacyReportWorkflow kind="e-way-bill-register" />;
  if (label === "Configuration") return <LegacyReportWorkflow kind="configuration" />;
  return <PendingRealWorkflow definition={definition} />;
}
