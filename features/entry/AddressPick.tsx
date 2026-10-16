"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { HelpList as HelpData } from "../../lib/entry/types";
import { HelpList } from "../grid/HelpList";
import { useDraggable } from "../grid/useDraggable";

/**
 * c1help_Address: a party with several addresses shows them in the same help window as the account and product helps
 * (movable by its title, a search box for any column with the text marked, columns that can be made wider or narrower, column lines).
 * A tick marks the address the entry has now (the one last selected, so an entry opened for edit shows it); Enter or a
 * double-click takes the address, Esc keeps the ticked one. The address id is not shown.
 */
const COLUMNS: readonly [string, string, number][] = [
  ["address_1", "Address 1", 160], ["address_2", "Address 2", 140], ["address_3", "Address 3", 120],
  ["city", "City", 90], ["pin_code", "PIN", 64], ["tel_no", "Tel", 90], ["mobile_no", "Mobile", 90], ["contact", "Contact", 110],
];
const CHAR = 7;

export function AddressPick({ name, rows, current, onChoose, onEscape }: {
  name: string;
  rows: readonly Readonly<Record<string, string>>[];
  current: number;
  onChoose: (id: number) => void;
  onEscape: () => void;
}) {
  const drag = useDraggable();
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(Math.max(0, rows.findIndex((row) => Number(row.address_id) === current)));
  // Each column as wide as its longest text needs (up to 260), so nothing needs to scroll sideways.
  const help = useMemo((): HelpData => ({
    columns: [
      { key: "tick", caption: "✓", width: 30, align: "C", format: "" },
      ...COLUMNS.map(([key, caption, least]) => ({
        key, caption, align: "L", format: "",
        width: Math.min(260, Math.max(least, caption.length * CHAR + 24, ...rows.map((row) => (row[key] ?? "").length * CHAR + 14))),
      })),
    ],
    rows: rows.map((row) => ({ ...row, tick: Number(row.address_id) === current ? "✔" : "" })),
    frozen: 0,
    total: `${rows.length} addresses`,
  }), [rows, current]);
  useEffect(() => { box.current?.querySelector<HTMLElement>(".mp-help")?.focus(); }, []);
  return (
    <div className="ent-addrpick-back" ref={box}>
      <HelpList
        help={help}
        focusRow={at}
        onFocusRow={setAt}
        onChoose={(index) => onChoose(Number(rows[index]?.address_id) || 1)}
        searchKey="address_1"
        onEscape={onEscape}
        title={`SELECT ADDRESS · ${name}`}
        style={{ top: 70, left: 40, right: "auto", bottom: "auto", maxWidth: "calc(100% - 80px)", maxHeight: "none", zIndex: 45, ...(drag.style ?? {}) }}
        dragHandle={drag.handle}
        onResetPosition={drag.reset}
        formatCell={(value) => value}
        shown={Math.min(10, Math.max(3, rows.length))}
      />
    </div>
  );
}
