"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountLedger as AccountLedgerData } from "../../lib/entry/ledger";
import { HelpList } from "../grid/HelpList";
import type { HelpData } from "../grid/HelpList";
import { useDraggable } from "../grid/useDraggable";
import { useHelpView } from "../grid/useHelpView";

/**
 * The F8 window of the account help: the account's Ledger in the same window as the F1 master details (the shared help grid:
 * drag the title to move it, drag a heading edge to size a column, the filter on each heading, click a heading to sort, type to find
 * in the marked column, the search box in the title). A voucher is one line. Esc, or ×, gives the keyboard back to the help.
 */
const plain = (value: string) => value;

/** The narration takes what is left of the screen, so the whole report shows without a horizontal scroll (never narrower than 120). */
const NARRATION_WIDTH = 240;
const columnsFor = (screenWidth: number): HelpData["columns"] => {
  const fixed: HelpData["columns"] = [
    { key: "sr", caption: "Sr", width: 40, align: "R", format: "" },
    { key: "date", caption: "Date", width: 77, align: "L", format: "" },
    { key: "docNo", caption: "Doc No", width: 113, align: "L", format: "" },
    { key: "particular", caption: "Particular", width: 260, align: "L", format: "" },
    { key: "debit", caption: "Debit", width: 100, align: "R", format: "" },
    { key: "credit", caption: "Credit", width: 100, align: "R", format: "" },
    { key: "closing", caption: "Closing", width: 99, align: "R", format: "" },
    { key: "drCr", caption: "Dr/Cr", width: 25, align: "L", format: "" },
    { key: "chln", caption: "Chln", width: 90, align: "L", format: "" },
    { key: "chlnDate", caption: "Chln Date", width: 77, align: "L", format: "" },
  ];
  // The window keeps 32px off the screen, and the grid its scroll bar and border.
  const room = screenWidth - 32 - 30 - fixed.reduce((sum, column) => sum + column.width, 0);
  // A narrow screen takes the shortage from the Particular column too (down to 180) before the narration goes under 120.
  const short = Math.max(0, 120 - room);
  const columns = fixed.map((column) => (column.key === "particular" ? { ...column, width: Math.max(180, column.width - short) } : column));
  return [...columns, { key: "narration", caption: "Narration", width: Math.max(120, Math.min(NARRATION_WIDTH, room)), align: "L", format: "" }];
};

export function AccountLedger({ ledger, onClose }: { ledger: AccountLedgerData; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const drag = useDraggable();
  const [focusRow, setFocusRow] = useState(0);

  const help = useMemo((): HelpData => ({
    columns: columnsFor(typeof window === "undefined" ? 1360 : window.innerWidth),
    rows: ledger.rows.map((row, index) => ({ sr: String(index + 1), date: row.date, docNo: row.docNo, particular: row.particular, debit: row.debit, credit: row.credit, closing: row.closing, drCr: row.drCr, chln: row.chln, chlnDate: row.chlnDate, narration: row.narration })),
    total: `${ledger.title} · ${ledger.rows.length - 2} entries`,
  }), [ledger]);
  const view = useHelpView(help, plain);
  const shown = view.view ?? help;

  useEffect(() => {
    host.current?.querySelector<HTMLElement>(".mp-help")?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);

  return (
    <div className="ent-log-back" role="dialog" aria-modal="true" aria-label="LEDGER">
      <div ref={host} className="ent-details-host">
        <HelpList
          help={shown}
          focusRow={Math.min(focusRow, shown.rows.length - 1)}
          onFocusRow={setFocusRow}
          searchKey="particular"
          title="LEDGER"
          onClose={onClose}
          onEscape={onClose}
          style={{ position: "relative", right: "auto", bottom: "auto", top: "auto", left: "auto", maxHeight: "none", maxWidth: "calc(100vw - 32px)", ...(drag.style ?? {}) }}
          dragHandle={drag.handle}
          onResetPosition={drag.reset}
          formatCell={plain}
          shown={22}
          onHeadingClick={view.sortBy}
          sortMark={view.sortMark}
          headingTools={view.headingTools}
          filteredColumn={view.filteredColumn}
        />
      </div>
    </div>
  );
}
