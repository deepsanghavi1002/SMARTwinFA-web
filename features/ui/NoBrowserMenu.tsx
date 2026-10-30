"use client";

import { useEffect } from "react";

/**
 * The browser's own right-click menu never shows over the program (the desktop has none): where a
 * grid has its menu it opens, anywhere else nothing opens. Only a plain text box outside a grid
 * (a login or search box) keeps it, for Cut / Copy / Paste. Mounted once in app/layout.tsx.
 */
export function NoBrowserMenu() {
  useEffect(() => {
    const block = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const inGrid = Boolean(target?.closest('[role="grid"], .mp-grid, .mp-update, table'));
      const textBox = Boolean(target?.closest("input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, [contenteditable=true]"));
      if (textBox && !inGrid) return;
      event.preventDefault();
    };
    document.addEventListener("contextmenu", block);
    return () => document.removeEventListener("contextmenu", block);
  }, []);
  return null;
}
