"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MasterDetails as MasterDetailsData } from "../../lib/entry/details";
import { HelpList } from "../grid/HelpList";
import type { HelpData } from "../grid/HelpList";
import { useDraggable } from "../grid/useDraggable";
import { useHelpView } from "../grid/useHelpView";

/**
 * The F1 window of the account and product helps: the whole master record, one field to a row (group, field name, value). It is the
 * same grid as every help: the Excel-like filter on each heading (▾), a click on a heading to sort, type to find in the column the
 * cursor is on (← → move it) with the typed letters marked, and the search box in the title for any column. Esc, or ×, gives the
 * keyboard back to the help.
 */
const plain = (value: string) => value;

export function MasterDetails({ details, kind, onClose }: { details: MasterDetailsData; kind: "account" | "product"; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const drag = useDraggable();
  const [focusRow, setFocusRow] = useState(0);

  const help = useMemo((): HelpData => ({
    columns: [
      { key: "group", caption: "Group", width: 110, align: "L", format: "" },
      { key: "name", caption: "Field", width: 240, align: "L", format: "" },
      { key: "value", caption: "Value", width: 420, align: "L", format: "" },
    ],
    rows: details.rows.map((row) => ({ group: row.group, name: row.name, value: row.value })),
    total: `${details.title} · ${details.rows.length} fields`,
  }), [details]);
  const view = useHelpView(help, plain);
  const shown = view.view ?? help;

  useEffect(() => {
    host.current?.querySelector<HTMLElement>(".mp-help")?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);

  return (
    <div className="ent-log-back" role="dialog" aria-modal="true" aria-label={kind === "account" ? "ACCOUNT DETAILS" : "PRODUCT DETAILS"}>
      <div ref={host} className="ent-details-host">
        <HelpList
          help={shown}
          focusRow={Math.min(focusRow, shown.rows.length - 1)}
          onFocusRow={setFocusRow}
          searchKey="name"
          title={kind === "account" ? "ACCOUNT DETAILS" : "PRODUCT DETAILS"}
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
