"use client";

import { createContext, useCallback, useContext, useEffect, useRef } from "react";

/**
 * Several program windows can be open at once (the main menu's tabs, as the desktop's MDI windows): the one in front is active,
 * the others stay mounted with their selection, grid and scroll as they were, but out of sight and inert.
 *
 * A screen's window-wide key listeners (Esc to leave, Alt letters, F-keys) must answer only in the active window: they read
 * `useWindowActive()`. Code that finds a screen's own element by searching the page (`.mp-editor`, `#mp-save`) searches
 * `activeScope()`, so it does not pick up the same element of a window behind.
 */

const WindowActiveContext = createContext(true);
/** Where a screen leaves the function its window's close button runs (its own Quit, which asks about unsaved work). */
const WindowCloserContext = createContext<((close: (() => void) | null) => void) | null>(null);

/** `onCloser` (stable) is told the close function the window's screen registers, by window id. */
export function WindowActiveProvider({ active, windowId, onCloser, children }: { active: boolean; windowId: number; onCloser: (id: number, close: (() => void) | null) => void; children: React.ReactNode }) {
  const setCloser = useCallback((close: (() => void) | null) => onCloser(windowId, close), [onCloser, windowId]);
  return <WindowActiveContext.Provider value={active}><WindowCloserContext.Provider value={setCloser}>{children}</WindowCloserContext.Provider></WindowActiveContext.Provider>;
}

/**
 * The screen's own way to close (Quit with its questions): the window's × runs it instead of just closing the window, so an
 * unsaved master or entry asks first. A screen that does not register is closed at once.
 */
export function useWindowCloser(close: () => void) {
  const setCloser = useContext(WindowCloserContext);
  const latest = useRef(close);
  useEffect(() => { latest.current = close; });
  useEffect(() => {
    if (!setCloser) return;
    setCloser(() => latest.current());
    return () => setCloser(null);
  }, [setCloser]);
}

/** Whether this screen's window is the one in front, as a ref (for listeners added once). Outside the windows: always true. */
export function useWindowActive() {
  const active = useContext(WindowActiveContext);
  const ref = useRef(active);
  useEffect(() => { ref.current = active; }, [active]);
  return ref;
}

/** The window in front (or the whole page when there are no windows): where a screen looks for its own elements. */
export function activeScope(): ParentNode {
  if (typeof document === "undefined") return {} as ParentNode;
  return document.querySelector<HTMLElement>("[data-window-active]") ?? document;
}

/** `#id` inside the window in front (ids such as mp-save repeat when two screens of one kind are open). */
export function activeById<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return activeScope().querySelector<T>(`#${CSS.escape(id)}`);
}
