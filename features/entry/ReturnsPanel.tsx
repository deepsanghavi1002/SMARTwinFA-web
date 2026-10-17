"use client";

/* The panel takes Enter and Esc for itself, as the other windows of the program do. */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */

import { useEffect, useRef, useState } from "react";
import type { ReturnsChoices } from "../../lib/entry/invoice";
import { useDraggable } from "../grid/useDraggable";

/**
 * panelReturns: a debit / credit note first asks what it is against - the sale or purchase account (cmb_Ag_Book) and the nature of the
 * note (lbx_Ag_Nature: damage, goods returns, rate difference ...). Its slab and postings follow the book of the account chosen.
 * Enter takes the choice (Lbx_Ag_Nature_Leave); Esc leaves the note unstarted.
 */
export type ReturnsChoice = { code: number; nature: number; accountName: string; natureText: string };

export function ReturnsPanel({ choices, onDone }: { choices: ReturnsChoices; onDone: (choice: ReturnsChoice | null) => void }) {
  const [code, setCode] = useState(choices.defaultCode);
  const [nature, setNature] = useState(choices.natures[0]?.value ?? 0);
  const drag = useDraggable();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.querySelector<HTMLElement>("[data-first]")?.focus(); }, []);

  const accept = () => {
    const account = choices.accounts.find((candidate) => candidate.code === code);
    const kind = choices.natures.find((candidate) => candidate.value === nature);
    if (!account) return;
    onDone({ code: account.code, nature: kind?.value ?? 0, accountName: account.name, natureText: kind?.text ?? "" });
  };
  const keys = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onDone(null); }
    else if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); event.stopPropagation(); accept(); }
  };

  return (
    <div className="ent-print-back" role="dialog" aria-modal="true" aria-label="Against" ref={box} onKeyDown={keys}>
      <div className="ent-print-choose ent-returns" style={drag.style}>
        <div className="ent-print-title mp-drag-handle" {...drag.handle} onDoubleClick={drag.reset} title="Drag to move · double-click to put back">Against</div>
        <label className="ent-returns-row">Book
          <select data-first value={code} onChange={(event) => setCode(Number(event.target.value))}>
            {choices.accounts.map((account) => <option key={account.code} value={account.code}>{account.name}</option>)}
          </select>
        </label>
        <div className="ent-returns-row">Nature
          <ul role="listbox" aria-label="Nature" tabIndex={0} onKeyDown={(event) => {
            const at = choices.natures.findIndex((candidate) => candidate.value === nature);
            if (event.key === "ArrowDown") { event.preventDefault(); setNature(choices.natures[Math.min(choices.natures.length - 1, at + 1)]?.value ?? nature); }
            if (event.key === "ArrowUp") { event.preventDefault(); setNature(choices.natures[Math.max(0, at - 1)]?.value ?? nature); }
          }}>
            {choices.natures.map((candidate) => (
              <li key={candidate.value} role="option" aria-selected={candidate.value === nature} className={candidate.value === nature ? "ent-returns-on" : ""} onClick={() => setNature(candidate.value)} onDoubleClick={accept}>{candidate.text}</li>
            ))}
          </ul>
        </div>
        <div className="ent-print-actions">
          <button type="button" className="mp-btn mp-btn-green" onClick={accept}>Ok</button>
          <button type="button" className="mp-btn mp-btn-red" onClick={() => onDone(null)}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
