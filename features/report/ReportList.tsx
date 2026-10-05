"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * A list box of the report's selection (lbchk_Group, lbox_Filter, lBox_Sorting, lBox_Formating,
 * lbchk_Col_Select): one Tab stop, as the desktop's ListBox / CheckedListBox. ↑↓ PgUp PgDn Home End
 * move; in a single list moving also chooses, in a tick list Space (or a click) ticks.
 */

export type ListEntry = { key: string; text: string; badge?: string; locked?: boolean };

const ROWS = 4;

export const ReportList = forwardRef<HTMLDivElement, {
  caption: string;
  entries: readonly ListEntry[];
  /** "pick": one is chosen; "tick": any can be ticked. */
  mode: "pick" | "tick";
  chosen: readonly string[];
  onPick?: (key: string) => void;
  onTick?: (key: string, on: boolean) => void;
  /** The entry under the cursor changed (a group shows its help grid). */
  onActive?: (key: string) => void;
  /** The list got the keyboard (its status line). */
  onEnter?: () => void;
}>(function ReportList({ caption, entries, mode, chosen, onPick, onTick, onActive, onEnter }, ref) {
  const [active, setActive] = useState(() => Math.max(0, entries.findIndex((entry) => chosen.includes(entry.key))));
  const box = useRef<HTMLDivElement | null>(null);
  const at = Math.min(active, Math.max(0, entries.length - 1));

  useEffect(() => {
    box.current?.querySelector<HTMLElement>(`[data-index="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const go = (index: number) => {
    const next = Math.max(0, Math.min(entries.length - 1, index));
    setActive(next);
    const entry = entries[next];
    if (!entry) return;
    if (mode === "pick") onPick?.(entry.key);
    onActive?.(entry.key);
  };
  const tick = (index: number) => {
    const entry = entries[index];
    if (entry && !entry.locked) onTick?.(entry.key, !chosen.includes(entry.key));
  };
  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, PageDown: at + ROWS - 1, PageUp: at - ROWS + 1, Home: 0, End: entries.length - 1 };
    if (event.key in moves) { event.preventDefault(); go(moves[event.key]); return; }
    if (event.key === " " && mode === "tick") { event.preventDefault(); tick(at); }
  };

  return (
    <div className="rp-box">
      <div className="rp-box-head" id={`rp-list-${caption}`}>{caption}</div>
      <div
        ref={(element) => { box.current = element; if (typeof ref === "function") ref(element); else if (ref) ref.current = element; }}
        className={`rp-list rp-list-${mode}`}
        role="listbox"
        aria-labelledby={`rp-list-${caption}`}
        aria-multiselectable={mode === "tick"}
        aria-activedescendant={entries[at] ? `rp-${caption}-${at}` : undefined}
        tabIndex={0}
        onKeyDown={keys}
        onFocus={() => { onEnter?.(); const entry = entries[at]; if (entry) onActive?.(entry.key); }}
      >
        {entries.map((entry, index) => {
          const on = chosen.includes(entry.key);
          return (
            <div
              key={entry.key}
              id={`rp-${caption}-${index}`}
              data-index={index}
              role="option"
              tabIndex={-1}
              aria-selected={on}
              className={`rp-item ${on ? "rp-item-on" : ""} ${index === at ? "rp-item-active" : ""} ${entry.locked ? "rp-item-locked" : ""}`}
              onMouseDown={(event) => {
                event.preventDefault();
                box.current?.focus();
                setActive(index);
                if (mode === "pick") onPick?.(entry.key); else tick(index);
                onActive?.(entry.key);
              }}
            >
              {mode === "tick" && <span className="rp-check" aria-hidden="true">{on ? "✓" : ""}</span>}
              <span className="rp-item-text">{entry.text}</span>
              {entry.badge && <small>{entry.badge}</small>}
            </div>
          );
        })}
      </div>
    </div>
  );
});
