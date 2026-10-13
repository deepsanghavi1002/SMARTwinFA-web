"use client";

import { useEffect, useRef } from "react";
import { activeScope, useWindowActive } from "../ui/activeWindow";

/**
 * Esc closes the window that was opened last (a side panel, the Log or Arrange Columns window).
 * Every window that uses this registers while it is open; one Esc press closes only the top one,
 * and the screen under it does not see the key (so Esc does not also leave the report).
 *
 * Overlays that handle Esc themselves are left alone while they are open: message boxes, a column's
 * filter list, the right-click menu and the print preview.
 */

/** The open windows, newest last; each knows whether its program window is the one in front (several can be open). */
const open: { close: { current: () => void }; active: { current: boolean } }[] = [];
const OWN_ESC = ".mp-filter, .mp-menu, .mp-preview";

function onKey(event: KeyboardEvent) {
  if (event.key !== "Escape" || open.length === 0) return;
  if (document.querySelector(".msgbox-backdrop") || activeScope().querySelector(OWN_ESC)) return;
  // The newest one of the program window in front: a panel left open in a window behind waits for its own window.
  const top = [...open].reverse().find((entry) => entry.active.current);
  if (!top) return;
  event.preventDefault();
  event.stopPropagation();
  top.close.current();
}

export function useEscapeClose(onClose: () => void) {
  const latest = useRef(onClose);
  const active = useWindowActive();
  useEffect(() => { latest.current = onClose; });
  useEffect(() => {
    if (open.length === 0) document.addEventListener("keydown", onKey, true);
    const entry = { close: latest, active };
    open.push(entry);
    return () => {
      const at = open.indexOf(entry);
      if (at >= 0) open.splice(at, 1);
      if (open.length === 0) document.removeEventListener("keydown", onKey, true);
    };
  }, [active]);
}
