"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PartyStock as PartyStockData } from "../../lib/entry/partyStock";
import { HelpList } from "../grid/HelpList";
import type { HelpData } from "../grid/HelpList";
import { useDraggable } from "../grid/useDraggable";
import { useHelpView } from "../grid/useHelpView";

/**
 * The F7 window of the account help (Partywise Stock): the party's stock lines in the same window as the F8 ledger and the F1
 * details (move, size the columns, heading filter and sort, type to find, the search box in the title). The slab and addon columns
 * are the ones the party's data has. Esc, or ×, gives the keyboard back to the help.
 */
const plain = (value: string) => value;
const WIDTH: Record<string, number> = { date: 90, docNo: 140, product: 260, addQty: 90, lessQty: 90, rate: 90, value: 110 };

export function PartyStock({ stock, onClose }: { stock: PartyStockData; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const drag = useDraggable();
  const [focusRow, setFocusRow] = useState(0);

  const help = useMemo((): HelpData => ({
    columns: stock.columns.map((column) => ({ key: column.key, caption: column.caption, width: WIDTH[column.key] ?? 100, align: column.align, format: "" })),
    rows: stock.rows,
    total: `${stock.title} · ${stock.rows.length} lines`,
  }), [stock]);
  const view = useHelpView(help, plain);
  const shown = view.view ?? help;

  useEffect(() => {
    host.current?.querySelector<HTMLElement>(".mp-help")?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);

  return (
    <div className="ent-log-back" role="dialog" aria-modal="true" aria-label="PARTYWISE STOCK">
      <div ref={host} className="ent-details-host">
        <HelpList
          help={shown}
          focusRow={Math.min(focusRow, shown.rows.length - 1)}
          onFocusRow={setFocusRow}
          searchKey="product"
          title="PARTYWISE STOCK"
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
