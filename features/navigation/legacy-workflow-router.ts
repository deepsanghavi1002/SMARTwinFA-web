export type LegacyWorkflowMenuItem = Readonly<{
  id: number;
  label: string;
  program: string | null;
  action: string | null;
}>;

export type LegacyWorkflowRoute =
  | Readonly<{ kind: "addon"; workflowId: "Addon Master" }>
  | Readonly<{ kind: "demo"; workflowId: string; assumed?: boolean }>;

const programRoutes: Readonly<Record<string, LegacyWorkflowRoute>> = {
  mstaccount: { kind: "demo", workflowId: "Account Master" },
  mstproduct: { kind: "demo", workflowId: "Product Master" },
  mstaddonsub: { kind: "addon", workflowId: "Addon Master" },
  mstaddonfieldinst: { kind: "addon", workflowId: "Addon Master" },
  transaction: { kind: "demo", workflowId: "Invoice" },
  voucher: { kind: "demo", workflowId: "Cash / Bank" },
  rep_daybook: { kind: "demo", workflowId: "Bank / Cash" },
  rep_journal: { kind: "demo", workflowId: "Journal" },
  rep_register: { kind: "demo", workflowId: "TRANSACTION::Register" },
  rep_ledger: { kind: "demo", workflowId: "Ledger" },
  rep_outstandingage: { kind: "demo", workflowId: "Outstanding" },
  rep_outstandclear: { kind: "demo", workflowId: "Outstanding" },
  rep_bookwise: { kind: "demo", workflowId: "Outstanding" },
  rep_masteraccount: { kind: "demo", workflowId: "Account Master" },
  rep_masteraddon: { kind: "addon", workflowId: "Addon Master" },
  rep_masterproduct: { kind: "demo", workflowId: "Product Master" },
  rep_trialbal: { kind: "demo", workflowId: "Final Report" },
  rep_topreports: { kind: "demo", workflowId: "Top Reports" },
  rep_dropanalysis: { kind: "demo", workflowId: "Drop Analysis" },
  report_piechart: { kind: "demo", workflowId: "Pie Chart" },
  rep_stock: { kind: "demo", workflowId: "Stock Reports" },
  rep_stocksummary: { kind: "demo", workflowId: "Stock Summary Report" },
  rep_daily_transaction: { kind: "demo", workflowId: "Daily Transaction" },
  rep_target: { kind: "demo", workflowId: "Target" },
  rep_ewaybill: { kind: "demo", workflowId: "E-Way Bill" },
  setupbooksetup: { kind: "demo", workflowId: "Book / Series" },
  setupbooknumber: { kind: "demo", workflowId: "Book / Series" },
  setupbooklockunlock: { kind: "demo", workflowId: "Lock / Unlock Data" },
};

const moduleLabelRoutes: Readonly<Record<string, Readonly<Record<string, LegacyWorkflowRoute>>>> = {
  report: {
    journal: { kind: "demo", workflowId: "Journal" },
    ledger: { kind: "demo", workflowId: "Ledger" },
  },
  inventory: {
    "stock reports": { kind: "demo", workflowId: "Stock Reports" },
    "stock summary report": { kind: "demo", workflowId: "Stock Summary Report" },
  },
  master: {
    account: { kind: "demo", workflowId: "Account Master" },
  },
};

function normalized(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function prototypeRoute(item: LegacyWorkflowMenuItem, moduleLabel: string): LegacyWorkflowRoute {
  const action = normalized(item.action);
  const module = normalized(moduleLabel);
  const label = normalized(item.label);
  const program = normalized(item.program);

  if (action === "master") {
    if (/addon/.test(label) || /addon/.test(program)) return { kind: "addon", workflowId: "Addon Master" };
    if (/product|price|stock|design/.test(label) || /product|price|stock|design/.test(program)) return { kind: "demo", workflowId: "Product Master", assumed: true };
    return { kind: "demo", workflowId: "Account Master", assumed: true };
  }
  if (action === "entry") return { kind: "demo", workflowId: program === "voucher" ? "Cash / Bank" : "Invoice", assumed: true };
  if (module.includes("gst") || /gst|eway|e-invoice|einvoice/.test(program + label)) return { kind: "demo", workflowId: /eway/.test(program + label) ? "E-Way Bill" : /einvoice|e-invoice/.test(program + label) ? "E-Invoice" : "GST Reports", assumed: true };
  if (module.includes("inventory") || /stock|product|production|mould|packing/.test(program + label)) return { kind: "demo", workflowId: "Stock Movement", assumed: true };
  if (module.includes("analysis") || /analysis|dashboard|chart|sale/.test(program + label)) return { kind: "demo", workflowId: "Top Reports", assumed: true };
  if (module.includes("report") || action === "report" || action.includes("report")) return { kind: "demo", workflowId: "TRANSACTION::Register", assumed: true };
  if (module.includes("setup") || module.includes("utility") || /setup|user|rights|backup|import|restore|token|transfer|repost/.test(program + label + action)) return { kind: "demo", workflowId: "Configuration", assumed: true };
  return { kind: "demo", workflowId: "TRANSACTION::Register", assumed: true };
}

/** Prefer verified source routes, then provide a real-data prototype route for every leaf. */
export function resolveLegacyWorkflow(item: LegacyWorkflowMenuItem, moduleLabel: string): LegacyWorkflowRoute | null {
  const program = normalized(item.program);
  const action = normalized(item.action);
  const byProgram = programRoutes[program];
  if (byProgram) {
    if (!((program === "transaction" || program === "voucher") && action !== "entry")) return byProgram;
  }
  return moduleLabelRoutes[normalized(moduleLabel)]?.[normalized(item.label)] ?? prototypeRoute(item, moduleLabel);
}
