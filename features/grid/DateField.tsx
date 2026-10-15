"use client";

import { useRef, useState } from "react";
import { formatDesktopDate } from "../../lib/master-program/legacy";
import type { DateRange } from "./CalendarPopup";
import type { useEditorTools } from "./EditorTools";
import { NO_NUMBER_RULES } from "./rules";

/**
 * A date box for a screen's header (Small_Entry's dtp_Date1-3, a report's From / Upto), typed and
 * picked exactly as a date cell of the master's grid: the short forms (2309, 23sep, 0109+5, +5),
 * the calendar (its button or Alt+↓), Ctrl+Delete to empty it. The value is always dd/MMM/yyyy;
 * text that is not a date goes back to the last good one when the box is left.
 */
export function DateField({ value, onChange, tools, ariaLabel, disabled = false, title, required = false, range, onRefuse }: {
  value: string;
  onChange: (value: string) => void;
  tools: ReturnType<typeof useEditorTools>;
  ariaLabel: string;
  disabled?: boolean;
  title?: string;
  /** A compulsory date (a report's From / Upto): no clear button, and it cannot be emptied. */
  required?: boolean;
  /** The days the calendar offers; a typed date outside it is refused (the box keeps its date) and `onRefuse` says why. */
  range?: DateRange;
  onRefuse?: (date: Date) => unknown;
}) {
  /** What is being typed, until it is taken (Enter, Tab, leaving the box); null when not typing. */
  const [typing, setTyping] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const shown = typing ?? value;

  /** Takes the typed text as a date when it reads as one; otherwise the box keeps its date. */
  const take = (text: string) => {
    setTyping(null);
    if (text.trim() === "") { if (!required) onChange(""); return; }
    const date = tools.typedDate(text, value);
    if (!date) return;
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const outside = (range?.min && day < new Date(range.min.getFullYear(), range.min.getMonth(), range.min.getDate()).getTime()) || (range?.max && day > new Date(range.max.getFullYear(), range.max.getMonth(), range.max.getDate()).getTime());
    if (outside) {
      // After the message is answered the keyboard goes back into this box (the dialog gives the focus back to what had it before).
      void Promise.resolve(onRefuse?.(date)).then(() => setTimeout(() => { input.current?.focus(); input.current?.select(); }, 50));
      return;
    }
    onChange(formatDesktopDate(date));
  };
  /** The calendar and Ctrl+Delete hand back a finished date. */
  const set = (next: string) => { setTyping(null); onChange(next); };

  return (
    <span className={`mp-editor-wrap se-date${disabled ? " se-date-disabled" : ""}`} title={title}>
      <input
        ref={input}
        className="mp-editor"
        aria-label={ariaLabel}
        value={shown}
        disabled={disabled}
        inputMode="numeric"
        onChange={(event) => setTyping(event.target.value)}
        onBlur={() => { if (typing !== null) take(typing); }}
        onKeyDown={(event) => {
          if (tools.keys(event, "date", shown, set, NO_NUMBER_RULES, required, range)) return;
          if (event.key === "Enter" && typing !== null) { event.preventDefault(); take(typing); }
          if (event.key === "Escape" && typing !== null) { event.preventDefault(); event.stopPropagation(); setTyping(null); }
        }}
      />
      {!disabled && tools.buttons("date", shown, set, NO_NUMBER_RULES, required, range)}
    </span>
  );
}
