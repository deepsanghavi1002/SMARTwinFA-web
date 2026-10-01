"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { HotkeyLabel } from "../ui/hotkeys";

/**
 * The Arrange Columns screen: every column of the Update grid in its order, numbered. A column
 * is picked by clicking it (or with the arrow keys) and moved with the buttons, by typing the
 * number it should go to, with Ctrl+Up / Ctrl+Down, or by dragging it in the list. The tick
 * shows or hides it. Frozen columns stay first: they cannot be moved or hidden.
 */
export type ArrangeItem = Readonly<{ key: string; caption: string; fixed: boolean; shown: boolean }>;

export function ArrangeColumns({
  items, changed, onMove, onToggle, onShowAll, onResetOrder, onClose,
}: {
  items: readonly ArrangeItem[];
  /** The order differs from the setup's. */
  changed: boolean;
  /** Puts a column at a 0-based position in the whole list. */
  onMove: (key: string, position: number) => void;
  onToggle: (key: string) => void;
  onShowAll: () => void;
  onResetOrder: () => void;
  onClose: () => void;
}) {
  const fixedCount = items.filter((item) => item.fixed).length;
  const firstMovable = items.find((item) => !item.fixed)?.key ?? null;
  const [picked, setPicked] = useState<string | null>(firstMovable);
  const [target, setTarget] = useState("");
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dragged = useRef<string | null>(null);
  const list = useRef<HTMLUListElement>(null);

  const index = items.findIndex((item) => item.key === picked);
  const pickedItem = index >= 0 ? items[index] : null;
  const canMove = pickedItem !== null && !pickedItem.fixed;
  const shownCount = items.filter((item) => item.shown).length;

  // The list takes the keyboard as the screen opens.
  useEffect(() => { list.current?.focus(); }, []);
  // Keep the picked column in view as it moves.
  useEffect(() => {
    list.current?.querySelector(".mp-arrange-picked")?.scrollIntoView({ block: "nearest" });
  }, [picked, index]);

  const move = (position: number) => {
    if (!canMove || !picked) return;
    onMove(picked, Math.min(items.length - 1, Math.max(fixedCount, position)));
  };
  const moveToNumber = () => {
    const number = Number.parseInt(target, 10);
    if (Number.isFinite(number)) move(number - 1);
    setTarget("");
  };

  const keys = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    const ctrl = event.ctrlKey || event.metaKey;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const step = event.key === "ArrowUp" ? -1 : 1;
      if (ctrl) move(index + step);
      else setPicked(items[Math.min(items.length - 1, Math.max(0, index + step))]?.key ?? picked);
    } else if (event.key === " " && pickedItem && !pickedItem.fixed) {
      event.preventDefault();
      if (!(pickedItem.shown && shownCount === 1)) onToggle(pickedItem.key);
    }
  };

  return (
    <div className="mp-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="mp-dialog mp-columns mp-arrange" role="dialog" aria-modal="true" aria-label="Arrange columns">
        <strong>Arrange Columns</strong>
        <p className="mp-arrange-tip">Click a column, then move it with the buttons or type the number it should go to. Tick to show, untick to hide.{fixedCount > 0 ? " Frozen columns (🔒) stay first." : ""}</p>
        <div className="mp-arrange-body">
          <ul ref={list} role="listbox" aria-label="Columns in order" tabIndex={0} aria-activedescendant={picked ? `mp-arrange-${index}` : undefined} onKeyDown={keys}>
            {items.map((item, at) => {
              const last = item.shown && shownCount === 1;
              return (
                <li
                  key={item.key}
                  id={`mp-arrange-${at}`}
                  role="option"
                  aria-selected={item.key === picked}
                  draggable={!item.fixed}
                  className={`${item.key === picked ? "mp-arrange-picked" : ""} ${item.fixed ? "mp-arrange-fixed" : ""} ${dragOver === at ? "mp-arrange-drop" : ""}`}
                  onMouseDown={() => setPicked(item.key)}
                  onDragStart={(event) => { dragged.current = item.key; setPicked(item.key); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.caption); }}
                  onDragOver={(event) => { if (dragged.current && at >= fixedCount) { event.preventDefault(); setDragOver(at); } }}
                  onDrop={(event) => { event.preventDefault(); if (dragged.current) onMove(dragged.current, Math.max(fixedCount, at)); dragged.current = null; setDragOver(null); }}
                  onDragEnd={() => { dragged.current = null; setDragOver(null); }}
                >
                  <span className="mp-arrange-no">{at + 1}</span>
                  <input type="checkbox" aria-label={`Show ${item.caption}`} checked={item.shown} disabled={item.fixed || last} onChange={() => onToggle(item.key)} />
                  <span className="mp-arrange-name">{item.caption}</span>
                  {item.fixed && <span className="mp-arrange-lock" title="Frozen column: cannot be moved or hidden">🔒</span>}
                </li>
              );
            })}
          </ul>
          <div className="mp-arrange-tools" role="group" aria-label="Move the picked column">
            <span className="mp-arrange-picked-name">{pickedItem ? pickedItem.caption : "Pick a column"}</span>
            <button type="button" disabled={!canMove || index <= fixedCount} onClick={() => move(fixedCount)}>⤒ To Top</button>
            <button type="button" disabled={!canMove || index <= fixedCount} onClick={() => move(index - 1)} title="Ctrl+↑">▲ Up</button>
            <button type="button" disabled={!canMove || index >= items.length - 1} onClick={() => move(index + 1)} title="Ctrl+↓">▼ Down</button>
            <button type="button" disabled={!canMove || index >= items.length - 1} onClick={() => move(items.length - 1)}>⤓ To Bottom</button>
            <label className="mp-arrange-to">
              Move to No.
              <input type="number" min={fixedCount + 1} max={items.length} value={target} disabled={!canMove} onChange={(event) => setTarget(event.target.value)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); moveToNumber(); } }} />
            </label>
            <button type="button" disabled={!canMove || target.trim() === ""} onClick={moveToNumber}>Move</button>
          </div>
        </div>
        <div className="mp-dialog-buttons">
          <button type="button" disabled={!changed} onClick={onResetOrder}>Reset Order</button>
          <button type="button" className="mp-columns-show" data-hotkey="m" aria-keyshortcuts="Alt+M" onClick={onShowAll}><HotkeyLabel text="Show All Columns" hotkey="m" /></button>
          <button type="button" className="mp-columns-close" data-hotkey="e" aria-keyshortcuts="Alt+E" onClick={onClose}><HotkeyLabel text="Close" hotkey="e" /></button>
        </div>
      </div>
    </div>
  );
}
