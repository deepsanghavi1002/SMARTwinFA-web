"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Phones: a wide screen (Master, Entry, Report) is as wide as on a PC and scrolls left to right. The browser's own scroll bar is a thin,
 * sometimes hidden strip, so this is a thick slider (and ◀ ▶ steps) above the bottom bar that moves the open window sideways.
 * It shows only when the open window is wider than the screen (CSS keeps it off larger screens).
 */
export function PanBar() {
  const [state, setState] = useState({ max: 0, left: 0 });
  const box = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const read = () => {
      const el = document.querySelector<HTMLElement>(".app-window-on");
      if (el !== box.current) box.current = el;
      const max = el ? Math.max(0, el.scrollWidth - el.clientWidth) : 0;
      const left = el ? el.scrollLeft : 0;
      setState((now) => (now.max === max && Math.abs(now.left - left) < 1 ? now : { max, left }));
    };
    read();
    // scroll does not bubble, so it is caught on the way down; the timer picks up a window opening, closing or growing
    document.addEventListener("scroll", read, true);
    window.addEventListener("resize", read);
    const timer = window.setInterval(read, 500);
    return () => {
      document.removeEventListener("scroll", read, true);
      window.removeEventListener("resize", read);
      window.clearInterval(timer);
    };
  }, []);

  if (state.max < 8) return null;
  const move = (to: number) => box.current?.scrollTo({ left: to });
  const step = () => Math.max(120, (box.current?.clientWidth ?? 300) * 0.6);
  return (
    <div className="pan-bar" role="group" aria-label="Scroll the screen sideways">
      <button type="button" aria-label="Scroll left" onClick={() => move(state.left - step())}>◀</button>
      <input type="range" min={0} max={Math.round(state.max)} step={1} value={Math.round(state.left)} aria-label="Screen position" onChange={(event) => move(Number(event.target.value))} />
      <button type="button" aria-label="Scroll right" onClick={() => move(state.left + step())}>▶</button>
    </div>
  );
}
