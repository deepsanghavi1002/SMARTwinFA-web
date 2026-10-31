"use client";

import { useState } from "react";
import { GridMenu } from "./GridMenu";
import type { GridMenuPlace } from "./GridMenu";

/**
 * The pen (✎) at the top of an editable grid's row-marker column: it filters the rows by whether they
 * are edited (changed on screen, not yet saved). Every editable grid (master, small entry, ...) uses
 * this one button and test, so they all behave alike; the screen decides what happens after a choice
 * (an open editor is taken first, then the first row shown opens for editing).
 */

export type RowFilter = "all" | "edited" | "unedited";

/** Whether a row passes the filter, given whether it is edited. */
export const rowFilterHolds = (filter: RowFilter, edited: boolean) => filter === "all" || (filter === "edited") === edited;

const CHOICES = [["all", "All rows"], ["edited", "Edited rows only"], ["unedited", "Rows not edited only"]] as const;

export function RowFilterButton({ value, onChange, onClosed }: { value: RowFilter; onChange: (value: RowFilter) => void; /** The menu closed: the screen takes the keyboard back. */ onClosed?: () => void }) {
  const [menu, setMenu] = useState<GridMenuPlace | null>(null);
  return (
    <div className="mp-cell mp-rownum mp-rownum-head">
      <button
        type="button"
        tabIndex={-1}
        className={`mp-rowfilter${value === "all" ? "" : " mp-rowfilter-on"}`}
        title={`Rows shown: ${value === "all" ? "all" : value === "edited" ? "only the rows edited" : "only the rows not edited"} · click to choose`}
        aria-label="Filter rows by edited"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); setMenu({ x: box.left, y: box.bottom + 2 }); }}
      >✎</button>
      {menu && (
        <GridMenu at={menu} onClose={() => { setMenu(null); onClosed?.(); }} items={CHOICES.map(([choice, label]) => ({ label: `${value === choice ? "✓ " : "   "}${label}`, onClick: () => onChange(choice) }))} />
      )}
    </div>
  );
}
