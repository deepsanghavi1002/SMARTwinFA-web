"use client";

import { useEffect } from "react";
import type { RefObject } from "react";
import { isMessageBoxOpen } from "./MessageBox";

/**
 * Alt+letter for a screen's buttons, as the desktop's &Save captions give.
 *
 * Mark a button with data-hotkey="s" and show its letter with <HotkeyLabel>. Alt+S (and
 * Alt+Shift+S, which Firefox keeps for page access keys) then presses the first visible,
 * enabled button inside `scope` that carries that letter. Nothing fires while a message box
 * is open; it has its own keys. A field that uses an Alt letter itself lists it in
 * data-own-alt-keys="c" and keeps it (a number editor's Alt+C calculator).
 */
export function useAltHotkeys(scope: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || isMessageBoxOpen()) return;
      // event.code, so the letter is the same whatever Shift or the keyboard layout does to event.key.
      const match = /^Key([A-Z])$/.exec(event.code);
      if (!match || !scope.current) return;
      const letter = match[1].toLowerCase();
      // A field can keep an Alt letter for itself (a number editor's Alt+C calculator).
      const owner = (event.target as Element | null)?.closest?.("[data-own-alt-keys]");
      if (owner?.getAttribute("data-own-alt-keys")?.includes(letter)) return;
      // While a window is open over the screen, only its own buttons answer.
      const windows = scope.current.querySelectorAll<HTMLElement>('[aria-modal="true"]');
      const within = windows.length ? windows[windows.length - 1] : scope.current;
      const button = [...within.querySelectorAll<HTMLButtonElement>(`[data-hotkey="${letter}"]`)]
        .find((candidate) => !candidate.disabled && candidate.offsetParent !== null);
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      button.focus({ preventScroll: true });
      button.click();
    };
    // Capture, so the shortcut wins over the grid's own key handling and the browser's Alt menus.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [scope]);
}

/** A caption with its Alt letter underlined (the first match, either case). */
export function HotkeyLabel({ text, hotkey }: { text: string; hotkey: string }) {
  const at = text.toLowerCase().indexOf(hotkey.toLowerCase());
  // One span, so a flex button's gap does not split the word around the underlined letter.
  if (at < 0) return <span>{text}</span>;
  return <span className="hotkey-label">{text.slice(0, at)}<u>{text.charAt(at)}</u>{text.slice(at + 1)}</span>;
}
