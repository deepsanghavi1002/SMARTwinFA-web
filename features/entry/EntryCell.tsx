"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { EntryOption } from "../../lib/entry/types";
import { comboPlace } from "../grid/comboPlace";
import { DateField } from "../grid/DateField";
import type { useEditorTools } from "../grid/EditorTools";
import { GridCombo } from "../grid/GridCombo";
import type { GridComboPlace } from "../grid/GridCombo";
import { NO_NUMBER_RULES } from "../grid/rules";
import type { NumberRules } from "../grid/rules";

export type CellKind = "text" | "number" | "date" | "combo";

/** Puts the keyboard on an entry cell by its data-cell (a date cell's box sits inside its wrapper). */
export function focusEntryCell(root: ParentNode | null | undefined, cellId: string): boolean {
  const id = CSS.escape(cellId);
  const target = root?.querySelector<HTMLElement>(`[data-cell="${id}"]`) ?? root?.querySelector<HTMLElement>(`[data-cell-wrap="${id}"] input`);
  target?.focus();
  return Boolean(target);
}

/**
 * An open cell of the entry grids (product, slab, addon), with the master grid's controls: a
 * figure has the calculator (its button, Alt+C, or typing + * / =), a date the calendar (its
 * button or Alt+↓) and the short date forms, a list the master's combo (its ▾, Alt+↓ / F4, or a
 * letter typed on it opens the searchable list). No clear (cancel) button: Ctrl+Del still empties
 * a figure. Enter is the screen's (it moves on); `onKeys` sees every other key first.
 */
export function EntryCell({ kind, cellId, value, onChange, tools, ariaLabel, align = "left", rules = NO_NUMBER_RULES, options, positiveInteger = false, optional = false, clearable = false, onEnter, onKeys }: {
  kind: CellKind;
  /** data-cell: how the screen finds the cell to move to it. */
  cellId: string;
  value: string;
  onChange: (value: string) => void;
  tools: ReturnType<typeof useEditorTools>;
  ariaLabel: string;
  align?: "left" | "right" | "center";
  rules?: NumberRules;
  options?: readonly EntryOption[];
  /** Whole positive numbers only (credit days). */
  positiveInteger?: boolean;
  /** A date cell that may stay empty (an addon date that is not compulsory). */
  optional?: boolean;
  /** A figure with the clear (cancel) button after the calculator (the E-Way distance); the grids leave it out. */
  clearable?: boolean;
  onEnter: () => void;
  onKeys?: (event: ReactKeyboardEvent<HTMLElement>) => boolean;
}) {
  const [combo, setCombo] = useState<{ place: GridComboPlace | null; startWith: string } | null>(null);
  const cell = useRef<HTMLButtonElement>(null);

  if (kind === "combo") {
    const list = options ?? [];
    const open = (startWith = "") => setCombo({ place: comboPlace(cell.current, list.map((option) => option.text)), startWith });
    if (combo) {
      return (
        <GridCombo
          options={list}
          current={value}
          startWith={combo.startWith}
          place={combo.place}
          onPick={(text, step) => { onChange(text); setCombo(null); if (step === 1) onEnter(); else setTimeout(() => focusEntryCell(document, cellId), 0); }}
          onCancel={() => { setCombo(null); setTimeout(() => focusEntryCell(document, cellId), 0); }}
        />
      );
    }
    return (
      <button
        ref={cell}
        type="button"
        className="ent-combo-cell mp-combo-cell"
        data-cell={cellId}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        title="Show the list (Alt+↓ or F4, or type a letter)"
        onClick={() => open()}
        onKeyDown={(event) => {
          if (onKeys?.(event)) return;
          if (event.key === "Enter") { event.preventDefault(); onEnter(); return; }
          if ((event.altKey && event.key === "ArrowDown") || event.key === "F4" || event.key === " ") { event.preventDefault(); open(); return; }
          if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) { event.preventDefault(); open(event.key); }
        }}
      >
        <span className="ent-combo-text">{value}</span>
        <span className="mp-combo-arrow" role="presentation"><svg className="ui-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg></span>
      </button>
    );
  }

  if (kind === "date") {
    return (
      <span className="ent-cell-date" data-cell-wrap={cellId}
        onKeyDownCapture={(event) => {
          if (onKeys?.(event)) return;
          // DateField takes a typed date on Enter; the screen then moves on.
          if (event.key === "Enter") setTimeout(onEnter, 0);
        }}>
        <DateField ariaLabel={ariaLabel} value={value} tools={tools} required={!optional} onChange={onChange} />
      </span>
    );
  }

  const set = (next: string) => onChange(next);
  const clean = (text: string) => {
    if (positiveInteger) return text.split(".")[0].replace(/\D/g, "");
    if (kind !== "number") return text;
    let out = text.replace(rules.positiveOnly ? /[^0-9.]/g : /[^0-9.-]/g, "");
    // One minus, at the front; one decimal point only; no more decimal figures than the setup allows.
    const minus = !rules.positiveOnly && out.startsWith("-") ? "-" : "";
    out = out.replace(/-/g, "");
    const dot = out.indexOf(".");
    if (dot >= 0) out = out.slice(0, dot + 1) + out.slice(dot + 1).replace(/\./g, "");
    if (rules.decimals === 0) out = out.replace(/\..*$/, "");
    else if (dot >= 0) out = out.slice(0, out.indexOf(".") + 1 + rules.decimals);
    return minus + out;
  };
  /** Leaving a figure: rounded to the setup's decimal places (decimal_points) and shown with them. */
  const round = () => {
    if (kind !== "number" || positiveInteger) return;
    const text = value.trim();
    if (text === "" || text === "-" || text === ".") return;
    const number = Number(text);
    if (!Number.isFinite(number)) return;
    const places = Math.max(0, rules.decimals);
    const factor = 10 ** places;
    const rounded = Math.sign(number) * Math.round(Math.abs(number) * factor + 1e-9) / factor;
    const shown = rounded.toFixed(places);
    if (shown !== value) set(shown);
  };
  return (
    <span className="mp-editor-wrap ent-cell-wrap">
      <input
        className="mp-editor ent-cell-input"
        data-cell={cellId}
        data-own-alt-keys={kind === "number" ? "c" : undefined}
        aria-label={ariaLabel}
        inputMode={kind === "number" || positiveInteger ? "decimal" : undefined}
        style={{ textAlign: align }}
        value={value}
        onFocus={(event) => event.target.select()}
        onChange={(event) => set(clean(event.target.value))}
        onBlur={round}
        onKeyDown={(event) => {
          if (event.key === "Enter") round();
          if (onKeys?.(event)) return;
          if (kind === "number" && tools.keys(event, "number", value, set, rules)) return;
          if (event.key === "Enter") { event.preventDefault(); onEnter(); }
        }}
      />
      {kind === "number" && tools.buttons("number", value, set, rules, !clearable)}
    </span>
  );
}
