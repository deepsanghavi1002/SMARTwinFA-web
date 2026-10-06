"use client";

import { useEffect, useRef } from "react";

/**
 * Esc closes the window that was opened last (a side panel, the Log or Arrange Columns window).
 * Every window that uses this registers while it is open; one Esc press closes only the top one,
 * and the screen under it does not see the key (so Esc does not also leave the report).
 *
 * Overlays that handle Esc themselves are left alone while they are open: message boxes, a column's
 * filter list, the right-click menu and the print preview.
 */

const open: { current: () => void }[] = [];
const OWN_ESC = ".msgbox-backdrop, .mp-filter, .mp-menu, .mp-preview";

function onKey(event: KeyboardEvent) {
  if (event.key !== "Escape" || open.length === 0) return;
  if (document.querySelector(OWN_ESC)) return;
  event.preventDefault();
  event.stopPropagation();
  open[open.length - 1].current();
}

export function useEscapeClose(onClose: () => void) {
  const latest = useRef(onClose);
  useEffect(() => { latest.current = onClose; });
  useEffect(() => {
    if (open.length === 0) document.addEventListener("keydown", onKey, true);
    open.push(latest);
    return () => {
      const at = open.indexOf(latest);
      if (at >= 0) open.splice(at, 1);
      if (open.length === 0) document.removeEventListener("keydown", onKey, true);
    };
  }, []);
}
