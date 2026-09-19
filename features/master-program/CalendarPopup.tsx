"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, HTMLAttributes, KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * The date editor's calendar, usable without a mouse: the arrow keys move the day,
 * PgUp / PgDn the month (with Shift, the year), Home / End the month's first and last
 * day, T today, Enter picks, Delete clears the field and Esc closes. The browser's own
 * date picker is not reliably keyboard-driven, so this one is drawn here.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const sameDay = (a: Date | null, b: Date | null) => Boolean(a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate());
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
/** The same day in another month, or its last day when that month is shorter. */
const addMonths = (date: Date, months: number) => {
  const last = new Date(date.getFullYear(), date.getMonth() + months + 1, 0).getDate();
  return new Date(date.getFullYear(), date.getMonth() + months, Math.min(date.getDate(), last));
};

export function CalendarPopup({ initial, onPick, onClose, style, dragHandle }: { initial: Date | null; onPick: (date: Date | null) => void; onClose: () => void; style?: CSSProperties; dragHandle?: HTMLAttributes<HTMLDivElement> }) {
  const today = new Date();
  const [focused, setFocused] = useState<Date>(initial ?? new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => { grid.current?.focus(); }, []);

  const first = new Date(focused.getFullYear(), focused.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  const cells = Array.from({ length: 42 }, (_, index) => addDays(start, index));

  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const move = (next: Date) => { event.preventDefault(); setFocused(next); };
    switch (event.key) {
      case "ArrowLeft": move(addDays(focused, -1)); return;
      case "ArrowRight": move(addDays(focused, 1)); return;
      case "ArrowUp": move(addDays(focused, -7)); return;
      case "ArrowDown": move(addDays(focused, 7)); return;
      case "PageUp": move(addMonths(focused, event.shiftKey ? -12 : -1)); return;
      case "PageDown": move(addMonths(focused, event.shiftKey ? 12 : 1)); return;
      case "Home": move(new Date(focused.getFullYear(), focused.getMonth(), 1)); return;
      case "End": move(new Date(focused.getFullYear(), focused.getMonth() + 1, 0)); return;
      case "t": case "T": move(new Date(today.getFullYear(), today.getMonth(), today.getDate())); return;
      case "Enter": case " ": event.preventDefault(); onPick(focused); return;
      case "Delete": case "Backspace": event.preventDefault(); onPick(null); return;
      case "Escape": event.preventDefault(); onClose(); return;
    }
  };

  return (
    <div className="mp-cal" role="dialog" aria-label="Calendar" style={style}>
      <div className="mp-cal-title mp-drag-handle" {...dragHandle} title="Drag to move">
        <button type="button" aria-label="Previous month (PgUp)" onClick={() => { setFocused(addMonths(focused, -1)); grid.current?.focus(); }}>‹</button>
        <b>{MONTHS[focused.getMonth()]} {focused.getFullYear()}</b>
        <button type="button" aria-label="Next month (PgDn)" onClick={() => { setFocused(addMonths(focused, 1)); grid.current?.focus(); }}>›</button>
      </div>
      <div
        ref={grid}
        className="mp-cal-grid"
        role="grid"
        tabIndex={0}
        aria-label={`${focused.getDate()} ${MONTHS[focused.getMonth()]} ${focused.getFullYear()}`}
        onKeyDown={keys}
      >
        {DAYS.map((day) => <span key={day} className="mp-cal-day-name" role="columnheader">{day}</span>)}
        {cells.map((date) => (
          <button
            key={date.toDateString()}
            type="button"
            tabIndex={-1}
            role="gridcell"
            aria-selected={sameDay(date, focused)}
            className={`mp-cal-day ${date.getMonth() !== focused.getMonth() ? "mp-cal-other" : ""} ${sameDay(date, focused) ? "mp-cal-focused" : ""} ${sameDay(date, initial) ? "mp-cal-chosen" : ""} ${sameDay(date, today) ? "mp-cal-today" : ""}`}
            onClick={() => onPick(date)}
          >
            {date.getDate()}
          </button>
        ))}
      </div>
      <div className="mp-cal-actions">
        <button type="button" onClick={() => onPick(new Date(today.getFullYear(), today.getMonth(), today.getDate()))}>Today (T)</button>
        <button type="button" onClick={() => onPick(null)}>Clear (Del)</button>
        <button type="button" onClick={onClose}>Close (Esc)</button>
      </div>
      <div className="mp-cal-hint">←→↑↓ day · PgUp/PgDn month · Shift+PgUp/PgDn year · Enter pick</div>
    </div>
  );
}
