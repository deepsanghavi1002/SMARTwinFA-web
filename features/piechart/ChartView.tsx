"use client";

import { forwardRef } from "react";

/**
 * The pie chart screen's drawing (the desktop's MS Chart, one series): every chart type of its Chart Type list as plain SVG, so the
 * picture can be saved as it stands. All colours and fonts are written inline for that.
 */

export type Slice = { label: string; value: number };
export const CHART_TYPES = ["Bar", "Point", "Bubble", "Column", "Pie", "Doughnut", "Candlestick", "BoxPlot", "Funnel", "Pyramid"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

const FONT = "Segoe UI, Arial, sans-serif";
const INK = "#28324a";
const GRID = "#e6eaf0";

/** Slice i's colour: the hue steps by 137 degrees so neighbours differ (saturation 0.7, value 0.9). */
export function sliceColor(index: number): string {
  const hue = (index * 137) % 360;
  const [s, v] = [0.7, 0.9];
  const f = (n: number) => {
    const k = (n + hue / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return `rgb(${f(5)},${f(3)},${f(1)})`;
}

/** A value axis from 0 (or the lowest) up in round steps. */
function niceScale(min: number, max: number): { lo: number; hi: number; step: number } {
  const lo = Math.min(0, min);
  const span = (Math.max(0, max) - lo) || 1;
  const rough = span / 5;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const unit = [1, 2, 2.5, 5, 10].find((candidate) => candidate * power >= rough)! * power;
  return { lo: Math.floor(lo / unit) * unit, hi: Math.ceil(Math.max(0, max) / unit) * unit || unit, step: unit };
}

const short = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);
const axisFormat = (value: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);

type Props = { size: { width: number; height: number }; type: ChartType; slices: Slice[]; axisX: string; axisY: string; format: (value: number) => string; onSlice: (slice: Slice) => void };

export const ChartView = forwardRef<SVGSVGElement, Props>(function ChartView({ size, type, slices, axisX, axisY, format, onSlice }, ref) {
  const W = size.width, H = size.height;
  const tip = (slice: Slice) => `${axisX}: ${slice.label}\nValue: ${format(slice.value)}`;
  const text = (x: number, y: number, content: string, extra: Record<string, string | number> = {}) => (
    <text x={x} y={y} fontFamily={FONT} fontSize={14} fill={INK} {...extra}>{content}</text>
  );
  const pick = (slice: Slice) => ({ onClick: () => onSlice(slice), style: { cursor: "pointer" } as const });

  let body: React.ReactNode;
  if (type === "Pie" || type === "Doughnut") {
    const cx = W / 2, cy = H / 2, r = Math.max(60, Math.min(W / 2 - 110, H / 2 - 30)), inner = type === "Doughnut" ? r * 0.53 : 0;
    const sum = slices.reduce((total, slice) => total + Math.max(0, slice.value), 0) || 1;
    let angle = -Math.PI / 2;
    body = slices.map((slice, index) => {
      const share = Math.max(0, slice.value) / sum;
      const start = angle, end = angle + share * Math.PI * 2;
      angle = end;
      const point = (a: number, radius: number) => [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius];
      const [x1, y1] = point(start, r), [x2, y2] = point(end, r), [x3, y3] = point(end, inner), [x4, y4] = point(start, inner);
      const large = end - start > Math.PI ? 1 : 0;
      const full = share >= 0.9999;
      const path = full
        ? `M${cx - r},${cy}a${r},${r} 0 1 0 ${2 * r},0a${r},${r} 0 1 0 ${-2 * r},0${inner ? `M${cx - inner},${cy}a${inner},${inner} 0 1 1 ${2 * inner},0a${inner},${inner} 0 1 1 ${-2 * inner},0` : ""}`
        : `M${x1},${y1}A${r},${r} 0 ${large} 1 ${x2},${y2}${inner ? `L${x3},${y3}A${inner},${inner} 0 ${large} 0 ${x4},${y4}Z` : `L${cx},${cy}Z`}`;
      const mid = (start + end) / 2;
      const [lx, ly] = point(mid, r + 16);
      return (
        <g key={index} {...pick(slice)}>
          <title>{tip(slice)}</title>
          <path d={path} fill={sliceColor(index)} fillRule="evenodd" stroke="#fff" strokeWidth={1.5} />
          {share >= 0.015 && text(lx, ly, format(slice.value), { textAnchor: Math.cos(mid) >= 0 ? "start" : "end", fontWeight: 600, fontSize: 13 })}
        </g>
      );
    });
  } else if (type === "Funnel" || type === "Pyramid") {
    const sorted = slices.map((slice, index) => ({ slice, index })).sort((a, b) => (type === "Funnel" ? b.slice.value - a.slice.value : a.slice.value - b.slice.value));
    const sum = sorted.reduce((total, entry) => total + Math.max(0, entry.slice.value), 0) || 1;
    const top = 20, height = H - 40, cx = W / 2, widest = Math.min(W - 60, 760);
    let y = top;
    body = sorted.map(({ slice, index }, at) => {
      const share = Math.max(0, slice.value) / sum;
      const h = Math.max(share * height, 2);
      const wideAt = (offset: number) => (type === "Funnel" ? widest * (1 - (offset - top) / height) : widest * ((offset - top) / height));
      const [w1, w2] = [wideAt(y), wideAt(y + h)];
      const path = `M${cx - w1 / 2},${y}L${cx + w1 / 2},${y}L${cx + w2 / 2},${y + h}L${cx - w2 / 2},${y + h}Z`;
      const row = (
        <g key={at} {...pick(slice)}>
          <title>{tip(slice)}</title>
          <path d={path} fill={sliceColor(index)} stroke="#fff" strokeWidth={1} />
          {h >= 12 && text(cx, y + h / 2 + 4, `${short(slice.label, 22)}: ${format(slice.value)}`, { textAnchor: "middle", fill: "#fff", fontWeight: 600, fontSize: 13 })}
        </g>
      );
      y += h;
      return row;
    });
  } else if (type === "Bar") {
    // Horizontal bars, the first slice on top, as the legend reads.
    const left = 170, right = W - 90, top = 20, bottom = H - 50;
    const scale = niceScale(Math.min(...slices.map((s) => s.value)), Math.max(...slices.map((s) => s.value)));
    const x = (value: number) => left + ((value - scale.lo) / (scale.hi - scale.lo)) * (right - left);
    const band = (bottom - top) / slices.length;
    const ticks = Array.from({ length: Math.round((scale.hi - scale.lo) / scale.step) + 1 }, (_, i) => scale.lo + i * scale.step);
    body = (
      <>
        {ticks.map((value) => <g key={value}><line x1={x(value)} x2={x(value)} y1={top} y2={bottom} stroke={GRID} />{text(x(value), bottom + 16, axisFormat(value), { textAnchor: "middle", fontSize: 12 })}</g>)}
        <line x1={x(0)} x2={x(0)} y1={top} y2={bottom} stroke="#9aa5b8" />
        {slices.map((slice, index) => (
          <g key={index} {...pick(slice)}>
            <title>{tip(slice)}</title>
            <rect x={Math.min(x(0), x(slice.value))} y={top + index * band + band * 0.15} width={Math.abs(x(slice.value) - x(0))} height={band * 0.7} fill={sliceColor(index)} />
            {text(left - 8, top + index * band + band / 2 + 4, short(slice.label, 22), { textAnchor: "end", fontSize: 13 })}
            {text(Math.max(x(slice.value), x(0)) + 4, top + index * band + band / 2 + 4, format(slice.value), { fontWeight: 600, fontSize: 12 })}
          </g>
        ))}
        {text((left + right) / 2, H - 12, axisY, { textAnchor: "middle", fontWeight: 600 })}
      </>
    );
  } else {
    // Column, Point, Bubble, Candlestick, BoxPlot: a mark above each label on a value axis (one value a slice, so a candle or a box is its line).
    const left = 80, right = W - 20, top = 24, bottom = H - 70;
    const scale = niceScale(Math.min(...slices.map((s) => s.value)), Math.max(...slices.map((s) => s.value)));
    const y = (value: number) => bottom - ((value - scale.lo) / (scale.hi - scale.lo)) * (bottom - top);
    const band = (right - left) / slices.length;
    const maxAbs = Math.max(...slices.map((s) => Math.abs(s.value)), 1);
    const ticks = Array.from({ length: Math.round((scale.hi - scale.lo) / scale.step) + 1 }, (_, i) => scale.lo + i * scale.step);
    body = (
      <>
        {ticks.map((value) => <g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke={GRID} />{text(left - 6, y(value) + 4, axisFormat(value), { textAnchor: "end", fontSize: 12 })}</g>)}
        <line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke="#9aa5b8" />
        {slices.map((slice, index) => {
          const cx = left + index * band + band / 2;
          const color = sliceColor(index);
          const mark = type === "Column"
            ? <rect x={cx - band * 0.35} y={Math.min(y(0), y(slice.value))} width={band * 0.7} height={Math.abs(y(slice.value) - y(0))} fill={color} />
            : type === "Bubble"
              ? <circle cx={cx} cy={y(slice.value)} r={6 + 22 * Math.sqrt(Math.abs(slice.value) / maxAbs)} fill={color} fillOpacity={0.75} stroke={color} />
              : type === "Point"
                ? <circle cx={cx} cy={y(slice.value)} r={5} fill={color} />
                : <g stroke={color} strokeWidth={2}><line x1={cx} x2={cx} y1={y(0)} y2={y(slice.value)} /><line x1={cx - band * 0.25} x2={cx + band * 0.25} y1={y(slice.value)} y2={y(slice.value)} /></g>;
          const labelY = slice.value >= 0 ? y(slice.value) - (type === "Bubble" ? 6 + 22 * Math.sqrt(Math.abs(slice.value) / maxAbs) + 4 : 8) : y(slice.value) + 16;
          return (
            <g key={index} {...pick(slice)}>
              <title>{tip(slice)}</title>
              {mark}
              {text(cx, labelY, format(slice.value), { textAnchor: "middle", fontWeight: 600, fontSize: 12 })}
              <text x={cx} y={bottom + 18} fontFamily={FONT} fontSize={13} fill={INK} textAnchor={slices.length > 8 ? "end" : "middle"} transform={slices.length > 8 ? `rotate(-35 ${cx} ${bottom + 18})` : undefined}>{short(slice.label, 18)}</text>
            </g>
          );
        })}
        {text((left + right) / 2, H - 8, axisX, { textAnchor: "middle", fontWeight: 600 })}
      </>
    );
  }

  return (
    <svg ref={ref} className="pc-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`${type} chart`}>
      <rect width={W} height={H} fill="#fff" />
      {body}
    </svg>
  );
});
