"use client";

import { useState } from "react";
import { formatDesktopDate } from "../../lib/master-program/legacy";
import type { useEditorTools } from "./EditorTools";
import { NO_NUMBER_RULES } from "./rules";

/**
 * A date box for a screen's header (Small_Entry's dtp_Date1-3, a report's From / Upto), typed and
 * picked exactly as a date cell of the master's grid: the short forms (2309, 23sep, 0109+5, +5),
 * the calendar (its button or Alt+↓), Ctrl+Delete to empty it. The value is always dd/MMM/yyyy;
 * text that is not a date goes back to the last good one when the box is left.
 */
export function DateField({ value, onChange, tools, ariaLabel, disabled = false, title, required = false }: {
  value: string;
  onChange: (value: string) => void;
  tools: ReturnType<typeof useEditorTools>;
  ariaLabel: string;
  disabled?: boolean;
  title?: string;
  /** A compulsory date (a report's From / Upto): no clear button, and it cannot be emptied. */
  required?: boolean;
}) {
  /** What is being typed, until it is taken (Enter, Tab, leaving the box); null when not typing. */
  const [typing, setTyping] = useState<string | null>(null);
  const shown = typing ?? value;

  /** Takes the typed text as a date when it reads as one; otherwise the box keeps its date. */
  const take = (text: string) => {
    setTyping(null);
    if (text.trim() === "") { if (!required) onChange(""); return; }
    const date = tools.typedDate(text, value);
    if (date) onChange(formatDesktopDate(date));
  };
  /** The calendar and Ctrl+Delete hand back a finished date. */
  const set = (next: string) => { setTyping(null); onChange(next); };

  return (
    <span className={`mp-editor-wrap se-date${disabled ? " se-date-disabled" : ""}`} title={title}>
      <input
        className="mp-editor"
        aria-label={ariaLabel}
        value={shown}
        disabled={disabled}
        inputMode="numeric"
        onChange={(event) => setTyping(event.target.value)}
        onBlur={() => { if (typing !== null) take(typing); }}
        onKeyDown={(event) => {
          if (tools.keys(event, "date", shown, set, NO_NUMBER_RULES, required)) return;
          if (event.key === "Enter" && typing !== null) { event.preventDefault(); take(typing); }
          if (event.key === "Escape" && typing !== null) { event.preventDefault(); event.stopPropagation(); setTyping(null); }
        }}
      />
      {!disabled && tools.buttons("date", shown, set, NO_NUMBER_RULES, required)}
    </span>
  );
}
