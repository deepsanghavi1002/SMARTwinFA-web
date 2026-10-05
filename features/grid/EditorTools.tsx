"use client";

import { useCallback, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { formatDesktopDate, parseDesktopDate } from "../../lib/master-program/legacy";
import { Calculator } from "./Calculator";
import type { NumberRules } from "./rules";
import { CalendarPopup } from "./CalendarPopup";
import { shorthandDate } from "./dates";
import { useDraggable } from "./useDraggable";

/**
 * The helpers of a grid cell's editor, for every grid: a calendar for dates (Alt+↓), a
 * calculator for amounts and quantities (Alt+C, or typing + * / =), and Ctrl+Delete to empty
 * the field; plus the short ways to type a date (2309, 23sep, 0109+5). The editor that opens
 * a tool passes the setter the answer goes back to.
 */

export type EditorKind = "number" | "date" | "text";

/** A field type as the tools read it: D a date; N, C a number (I is a whole key, no calculator). */
export const editorKindOf = (fieldType: string): EditorKind => (fieldType === "D" ? "date" : fieldType === "N" || fieldType === "C" ? "number" : "text");

type CalcState = { initial: string; rules: NumberRules; caretAtEnd?: boolean; set: (value: string) => void };
type CalendarState = { initial: string; left: number; top: number; set: (value: string) => void; required: boolean };

/** Puts the keyboard back in the open editor once a tool closes. */
const refocusEditor = () => {
  const focus = () => document.querySelector<HTMLInputElement>(".mp-editor")?.focus();
  focus();
  setTimeout(focus, 0);
};

export function useEditorTools(yearStart: Date | null) {
  const [calc, setCalc] = useState<CalcState | null>(null);
  const [calendar, setCalendar] = useState<CalendarState | null>(null);
  const calcDrag = useDraggable();
  const calendarDrag = useDraggable();

  /**
   * A date as typed in a date field: short forms (2309, 23sep, 0109+5, +5) take their year
   * from the accounting year; +n / -n alone count from the date the field already had.
   */
  const typedDate = useCallback((text: string, before: string) => {
    const start = yearStart && !Number.isNaN(yearStart.getTime()) ? yearStart : null;
    return shorthandDate(text, start, parseDesktopDate(before));
  }, [yearStart]);

  /** Opens the calendar just under the open editor (above it when there is no room below). */
  /** `anchor`: the box the calendar opens under (else the focused editor, else the first one). */
  const openCalendar = (value: string, set: (value: string) => void, required = false, anchor?: Element | null) => {
    const active = document.activeElement?.closest(".mp-editor-wrap, .mp-editor");
    const box = (anchor ?? active ?? document.querySelector(".mp-editor"))?.getBoundingClientRect();
    const width = 236;
    const height = 290;
    const left = box ? Math.min(Math.max(4, box.left), window.innerWidth - width - 4) : (window.innerWidth - width) / 2;
    const top = box ? (box.bottom + height + 4 < window.innerHeight ? box.bottom + 2 : Math.max(4, box.top - height - 2)) : (window.innerHeight - height) / 2;
    calendarDrag.reset();
    setCalendar({ initial: value, left, top, set, required });
  };

  /**
   * The tools from the keyboard; true when the key was theirs. rules (rules.ts numberRules of
   * the column's setup) give the calculator its places and what answer it may hand back.
   */
  const keys = (event: ReactKeyboardEvent, kind: EditorKind, value: string, set: (value: string) => void, rules: NumberRules, required = false): boolean => {
    if (event.ctrlKey && event.key === "Delete") { event.preventDefault(); if (!required) set(""); return true; }
    if (kind === "date" && event.altKey && event.key === "ArrowDown") { event.preventDefault(); openCalendar(value, set, required); return true; }
    if (kind === "number" && event.altKey && event.key.toLowerCase() === "c") { event.preventDefault(); setCalc({ initial: value, rules, set }); return true; }
    if (kind === "number" && !event.ctrlKey && !event.altKey && !event.metaKey && ["+", "*", "/", "="].includes(event.key)) {
      event.preventDefault();
      setCalc({ initial: event.key === "=" ? value : `${value}${event.key}`, rules, caretAtEnd: event.key !== "=", set });
      return true;
    }
    return false;
  };

  const clearButton = (set: (value: string) => void, what: string) => (
    <button
      type="button"
      className="mp-mini mp-mini-clear"
      tabIndex={-1}
      title={`Clear the ${what} (Ctrl+Delete)`}
      aria-label={`Clear the ${what}`}
      onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onClick={(event) => { event.stopPropagation(); set(""); event.currentTarget.closest(".mp-editor-wrap")?.querySelector<HTMLInputElement>(".mp-editor")?.focus(); }}
    >
      <svg className="mp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  );

  /** The small buttons inside the editor: calendar or calculator, and clear (none for a compulsory value). */
  const buttons = (kind: EditorKind, value: string, set: (value: string) => void, rules: NumberRules, required = false) => (
    <>
      {kind === "date" && (
        <button type="button" className="mp-mini" tabIndex={-1} title="Calendar (Alt+↓)" aria-label="Open calendar" onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); openCalendar(value, set, required, event.currentTarget.closest(".mp-editor-wrap")); }}>
          <svg className="mp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v14H4zM4 10h16M8 3v5M16 3v5" /></svg>
        </button>
      )}
      {kind === "date" && !required && clearButton(set, "date")}
      {kind === "number" && (
        <button type="button" className="mp-mini" tabIndex={-1} title="Calculator (Alt+C, or type + * / =)" aria-label="Open calculator" onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); setCalc({ initial: value, rules, set }); }}>
          <svg className="mp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01" /></svg>
        </button>
      )}
      {kind === "number" && !required && clearButton(set, "figure")}
    </>
  );

  /** The status-bar hint while such an editor is open. */
  const hint = (kind: EditorKind) => (kind === "date" ? "Alt+↓ Calendar · Ctrl+Del Clear" : kind === "number" ? "Alt+C or + * / = Calculator · Ctrl+Del Clear" : "");

  /** The calendar and calculator windows; render once, anywhere in the screen. */
  const popups = (
    <>
      {calendar && (
        <div className="mp-calc-backdrop mp-cal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setCalendar(null); refocusEditor(); } }}>
          <CalendarPopup
            initial={parseDesktopDate(calendar.initial)}
            style={calendarDrag.style ?? { position: "fixed", left: calendar.left, top: calendar.top }}
            dragHandle={calendarDrag.handle}
            canClear={!calendar.required}
            onClose={() => { setCalendar(null); refocusEditor(); }}
            onPick={(date) => { calendar.set(date ? formatDesktopDate(date) : ""); setCalendar(null); refocusEditor(); }}
          />
        </div>
      )}
      {calc && (
        <div className="mp-calc-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCalc(null); }}>
          <Calculator
            style={calcDrag.style}
            dragHandle={calcDrag.handle}
            initial={calc.initial}
            caretAtEnd={calc.caretAtEnd}
            rules={calc.rules}
            onClose={() => { setCalc(null); document.querySelector<HTMLInputElement>(".mp-editor")?.focus(); }}
            onUse={(value) => { calc.set(value); setCalc(null); document.querySelector<HTMLInputElement>(".mp-editor")?.focus(); }}
          />
        </div>
      )}
    </>
  );

  return { keys, buttons, hint, popups, typedDate, open: calc !== null || calendar !== null };
}
