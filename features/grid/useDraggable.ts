"use client";

import { useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";

/**
 * Lets a small window be dragged by its title bar, so the data behind it can be seen.
 * Returns the position to apply (null until it is first moved) and the title's handler.
 */
export function useDraggable() {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const start = (event: ReactMouseEvent<HTMLElement>) => {
    if ((event.target as Element).closest("button, input, select")) return;
    const box = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const offsetX = event.clientX - box.left;
    const offsetY = event.clientY - box.top;
    event.preventDefault();
    const move = (moveEvent: MouseEvent) => setPosition({
      x: Math.min(Math.max(0, moveEvent.clientX - offsetX), window.innerWidth - 60),
      y: Math.min(Math.max(0, moveEvent.clientY - offsetY), window.innerHeight - 30),
    });
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  /** The keyboard way to move it: arrow keys shift the window 20px. */
  const nudge = (event: ReactKeyboardEvent<HTMLElement>) => {
    const step = ({ ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] } as Record<string, [number, number]>)[event.key];
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    const box = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    setPosition((current) => {
      const from = current ?? { x: box.left, y: box.top };
      return { x: Math.min(Math.max(0, from.x + step[0]), window.innerWidth - 60), y: Math.min(Math.max(0, from.y + step[1]), window.innerHeight - 30) };
    });
  };
  const style = position ? { position: "fixed" as const, left: position.x, top: position.y, right: "auto", bottom: "auto", transform: "none" } : undefined;
  /** Spread on the title bar: drag it, or focus it and use the arrow keys. */
  const handle = { role: "button" as const, tabIndex: 0, "aria-label": "Move this window: drag, or use the arrow keys", onMouseDown: start, onKeyDown: nudge };
  return { style, start, handle, reset: () => setPosition(null) };
}
