"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LinkList } from "../../lib/entry/link";
import { HelpList } from "../grid/HelpList";
import type { HelpData } from "../grid/HelpList";
import { useDraggable } from "../grid/useDraggable";
import { useHelpView } from "../grid/useHelpView";

/**
 * The link list of a LINK register (c1dg_LinkEntry): the pending source entries, or their lines, in the same window as the account ledger and the F1
 * details. Enter (or Space) ticks the row under the cursor, F5 takes the ticked rows, Esc leaves. The title says which list it is.
 */
const plain = (value: string) => value;

export function LinkPick({ title, list, onDone, onClose }: { title: string; list: LinkList; onDone: (rows: readonly Readonly<Record<string, string>>[]) => void; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const drag = useDraggable();
  const [focusRow, setFocusRow] = useState(0);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());

  const help = useMemo((): HelpData => ({
    columns: [{ key: "_tick", caption: "Tick", width: 44, align: "L", format: "" }, ...list.columns.map((column) => ({ key: column.key, caption: column.caption, width: column.key === "party_name" ? 300 : column.align === "R" ? 100 : 130, align: column.align, format: "" }))],
    rows: list.rows.map((row) => ({ ...row, _tick: ticked.has(row._key) ? "✓" : "" })),
    total: `${list.total} · ${ticked.size} ticked`,
  }), [list, ticked]);
  const view = useHelpView(help, plain);
  const shown = view.view ?? help;

  useEffect(() => {
    host.current?.querySelector<HTMLElement>(".mp-help")?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);

  const toggle = (index: number) => {
    const key = shown.rows[index]?._key;
    if (!key) return;
    setTicked((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  };

  return (
    <div className="ent-log-back" role="dialog" aria-modal="true" aria-label={title}>
      <div ref={host} className="ent-details-host">
        <HelpList
          help={shown}
          focusRow={Math.min(focusRow, shown.rows.length - 1)}
          onFocusRow={setFocusRow}
          onChoose={toggle}
          searchKey="party_name"
          title={title}
          note={{ text: "Enter or Space ticks the row · F5 takes the ticked rows · Esc leaves", warn: false }}
          onClose={onClose}
          onEscape={onClose}
          style={{ position: "relative", right: "auto", bottom: "auto", top: "auto", left: "auto", maxHeight: "none", maxWidth: "calc(100vw - 32px)", ...(drag.style ?? {}) }}
          dragHandle={drag.handle}
          onResetPosition={drag.reset}
          formatCell={plain}
          shown={18}
          onKey={(event) => {
            if (event.key === "F5") { event.preventDefault(); onDone(list.rows.filter((row) => ticked.has(row._key))); return true; }
            if (event.key === " ") { event.preventDefault(); toggle(Math.min(focusRow, shown.rows.length - 1)); return true; }
            return false;
          }}
          onHeadingClick={view.sortBy}
          sortMark={view.sortMark}
          headingTools={view.headingTools}
          filteredColumn={view.filteredColumn}
        />
      </div>
    </div>
  );
}
