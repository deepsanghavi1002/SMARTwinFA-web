"use client";

import { useEffect, useRef, useState } from "react";

/** The pixel size of the area a chart fills, so it is drawn at that size (text stays readable) instead of a fixed canvas shrunk to fit. */
export function Plot({ minWidth = 0, children }: { minWidth?: number; children: (size: { width: number; height: number }) => React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const read = () => setSize((current) => {
      const width = Math.floor(element.clientWidth), height = Math.floor(element.clientHeight);
      return current.width === width && current.height === height ? current : { width, height };
    });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Wider than the area (many years or columns): the chart keeps its own width and the area scrolls sideways.
  const scrolls = minWidth > size.width;
  const drawn = { width: Math.max(size.width, minWidth), height: size.height - (scrolls ? 17 : 0) };
  return <div ref={box} className="pc-plot">{size.width > 0 && size.height > 0 ? children(drawn) : null}</div>;
}
