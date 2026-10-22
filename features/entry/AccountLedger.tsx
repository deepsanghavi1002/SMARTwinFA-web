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

const COLUMNS: HelpData["columns"] = [
  { key: "date", caption: "Date", width: 90, align: "L", format: "" },
  { key: "docNo", caption: "Doc No", width: 140, align: "L", format: "" },
  { key: "particular", caption: "Particular", width: 260, align: "L", format: "" },
  { key: "debit", caption: "Debit", width: 100, align: "R", format: "" },
  { key: "credit", caption: "Credit", width: 100, align: "R", format: "" },
  { key: "closing", caption: "Closing", width: 110, align: "R", format: "" },
  { key: "drCr", caption: "Dr/Cr", width: 50, align: "L", format: "" },
  { key: "chln", caption: "Chln", width: 90, align: "L", format: "" },
  { key: "chlnDate", caption: "Chln Date", width: 90, align: "L", format: "" },
  { key: "narration", caption: "Narration", width: 240, align: "L", format: "" },
];

export function AccountLedger({ ledger, onClose }: { ledger: AccountLedgerData; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const drag = useDraggable();
  const [focusRow, setFocusRow] = useState(0);

  const help = useMemo((): HelpData => ({
    columns: COLUMNS,
    rows: ledger.rows.map((row) => ({ date: row.date, docNo: row.docNo, particular: row.particular, debit: row.debit, credit: row.credit, closing: row.closing, drCr: row.drCr, chln: row.chln, chlnDate: row.chlnDate, narration: row.narration })),
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
