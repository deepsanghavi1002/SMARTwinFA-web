import { createContext, useContext } from "react";
import type { PivotHint, SumifHint } from "../../lib/report/pivotHint";

/**
 * Zoom from a report row (Report_Combine C1_OUTPUT_KeyUp, Enter): a voucher opens in its entry program (INVOICE / VOUCHER, on the voucher's ledger key),
 * an account in its Ledger report (REPORT_LEDGER, with the account ticked and the report run).
 */
export type ZoomTarget = Readonly<{ entryName?: string; ledKey?: number; reportName?: string; acCode?: number; /** Run the report at once with its own defaults, to its output grid. */ run?: boolean; /** The dates (YYYY-MM-DD) the report is run for. */ from?: string; to?: string; /** A pivot to set up on the report once it has run. */ pivot?: PivotHint; /** The question, for the report to choose its first combo from. */ pick?: string; /** The one account to tick (a party the question named). */ party?: Readonly<{ code: number; name: string }>; /** A SUMIF asked in words, worked out on the report once it has run. */ sumif?: SumifHint; /** Choices (control name to item text) and options to tick on the report as it opens (Profit / Loss: Closing Amount, Update Value In Master). */ setup?: Readonly<{ choices: Readonly<Record<string, string>>; checks: readonly string[] }> }>;

/** Given by the main menu: opens that program in a window of its own. */
export const ZoomContext = createContext<((target: ZoomTarget) => void) | null>(null);
export const useZoom = () => useContext(ZoomContext);
