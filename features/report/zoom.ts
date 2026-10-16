import { createContext, useContext } from "react";

/**
 * Zoom from a report row (Report_Combine C1_OUTPUT_KeyUp, Enter): a voucher opens in its entry program (INVOICE / VOUCHER, on the voucher's ledger key),
 * an account in its Ledger report (REPORT_LEDGER, with the account ticked and the report run).
 */
export type ZoomTarget = Readonly<{ entryName?: string; ledKey?: number; reportName?: string; acCode?: number }>;

/** Given by the main menu: opens that program in a window of its own. */
export const ZoomContext = createContext<((target: ZoomTarget) => void) | null>(null);
export const useZoom = () => useContext(ZoomContext);
