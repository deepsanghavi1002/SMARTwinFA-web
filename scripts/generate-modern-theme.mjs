#!/usr/bin/env node
/**
 * Builds app/modern-theme.generated.css: the colours of every rule in app/globals.css and app/modern-theme.css, re-derived for the
 * Modern view's two themes. The screens were drawn in one (light, teal-blue) palette; this keeps their layout rules untouched and only
 * restates their colours under `html[data-mtheme="dark"]` (a real dark palette) and `html[data-mtheme="light"]` (the same screens with the
 * teal chrome toned to the Modern neutrals). `html[data-mtheme]` exists only while the Modern view is on, so Legacy is never touched.
 *
 *   node scripts/generate-modern-theme.mjs          writes the file
 *   node scripts/generate-modern-theme.mjs --check  fails when the file is not what the sources give (tests/modern-theme.test.mjs)
 *
 * Colours a screen draws in code (inline styles) are not CSS and are themed where they are written.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = ["app/globals.css", "app/modern-theme.css"];
const OUTPUT = "app/modern-theme.generated.css";

// ---- colour maths -------------------------------------------------------------------------------------------------
const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

function parseHex(text) {
  let h = text.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}
function parseFunction(text) {
  const m = /^(rgba?|hsla?)\(([^)]*)\)$/i.exec(text);
  if (!m) return null;
  const parts = m[2].replace(/\//g, " ").split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const num = (v, pct = 1) => (v.endsWith("%") ? (parseFloat(v) / 100) * pct : parseFloat(v));
  if (m[1].toLowerCase().startsWith("rgb")) {
    return { r: num(parts[0], 255), g: num(parts[1], 255), b: num(parts[2], 255), a: parts[3] === undefined ? 1 : num(parts[3], 1) };
  }
  const h = parseFloat(parts[0]);
  const s = num(parts[1], 1);
  const l = num(parts[2], 1);
  const rgb = hslToRgb(h, s, l);
  return { ...rgb, a: parts[3] === undefined ? 1 : num(parts[3], 1) };
}
function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
function toHex({ h, s, l }, a) {
  const { r, g, b } = hslToRgb(h, clamp(s), clamp(l));
  const x = (n) => Math.round(clamp(n / 255) * 255).toString(16).padStart(2, "0");
  return `#${x(r)}${x(g)}${x(b)}${a < 1 ? x(a * 255) : ""}`;
}
const NAMED = { white: "#ffffff", black: "#000000", grey: "#808080", gray: "#808080", red: "#ff0000", blue: "#0000ff", yellow: "#ffff00" };

/** A colour token (hex, rgb(), hsl() or a few names) as {h,s,l,a}, or null. */
function parseColor(token) {
  const t = token.trim().toLowerCase();
  let rgb = null;
  if (t.startsWith("#")) rgb = parseHex(t);
  else if (NAMED[t]) rgb = parseHex(NAMED[t]);
  else rgb = parseFunction(t);
  return rgb ? { ...rgbToHsl(rgb), a: rgb.a } : null;
}

// Hues of the legacy chrome (teal / cyan / blue greys): these become the Modern neutrals. Other hues (reds, greens, ambers) carry meaning and stay.
const isChrome = (c) => c.s < 0.12 || (c.h >= 150 && c.h <= 235);
const NEUTRAL_HUE = 218;

/** Dark theme: light surfaces go dark, dark text goes light, mid colours (buttons, selections) stay. role: bg | fg | line. */
function toDark(c, role) {
  if (c.a < 0.6) return c; // a translucent wash (a hover tint, a shadow) works on either ground
  const chrome = isChrome(c);
  const hue = chrome ? NEUTRAL_HUE : c.h;
  if (role === "bg") {
    if (c.l >= 0.75) return { h: hue, s: chrome ? 0.26 : Math.min(c.s, 0.5) * 0.85, l: 0.17 - 0.095 * ((c.l - 0.75) / 0.25) };
    if (c.l >= 0.45) return { h: hue, s: chrome ? Math.min(c.s, 0.3) : c.s * 0.8, l: 0.3 - 0.13 * ((c.l - 0.45) / 0.3) };
    return c;
  }
  if (role === "fg") {
    if (c.l < 0.3) return { h: chrome ? NEUTRAL_HUE : c.h, s: chrome ? 0.2 : c.s, l: 0.94 - 0.2 * (c.l / 0.3) };
    if (c.l < 0.62) return c.s > 0.35 ? { h: c.h, s: c.s, l: Math.max(0.64, 1 - c.l) } : { h: NEUTRAL_HUE, s: 0.14, l: clamp(1 - c.l * 0.9, 0.55, 0.95) };
    return c;
  }
  // line: borders, outlines, rings
  if (c.l >= 0.6) return { h: hue, s: chrome ? 0.22 : c.s * 0.6, l: 0.14 + (1 - c.l) * 0.28 };
  if (c.l < 0.35) return { h: hue, s: chrome ? 0.2 : c.s, l: 0.3 + c.l * 0.2 };
  return { h: hue, s: chrome ? 0.2 : c.s, l: 0.3 };
}

/** Light theme: the teal chrome becomes the Modern neutral; selections, status colours and strong blues are left as drawn. */
function toLight(c, role) {
  if (c.a < 0.6 || !isChrome(c)) return c;
  if (role === "bg") {
    if (c.l < 0.55) return c;
    return { h: NEUTRAL_HUE, s: c.l > 0.88 ? Math.min(c.s * 0.7, 0.5) : Math.min(c.s, 0.22), l: 0.55 + c.l * 0.45 };
  }
  if (role === "fg") return c.l < 0.2 ? { h: NEUTRAL_HUE, s: Math.min(c.s, 0.4), l: c.l } : c;
  if (c.l >= 0.35 && c.l < 0.75) return { h: NEUTRAL_HUE, s: Math.min(c.s, 0.2), l: 0.55 + c.l * 0.4 };
  return { h: NEUTRAL_HUE, s: Math.min(c.s, 0.2), l: c.l };
}

// ---- declarations ------------------------------------------------------------------------------------------------
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)|\b(?:white|black|grey|gray|red|blue|yellow)\b/gi;

function roleOf(prop) {
  const p = prop.toLowerCase();
  if (p.startsWith("--")) return /(text|ink|fg|font)/.test(p) ? "fg" : /(border|line|rule|edge)/.test(p) ? "line" : "bg";
  if (p === "color" || p === "caret-color" || p === "fill" || p === "stroke" || p === "text-decoration-color" || p === "accent-color") return "fg";
  if (p.startsWith("background")) return "bg";
  if (p.startsWith("border") || p.startsWith("outline") || p === "column-rule" || p === "column-rule-color") return "line";
  if (p === "box-shadow") return "shadow";
  return null;
}

/** Re-colours every colour in a value (outside url(...)), as the role says. `mode` is dark or light. */
function mapValue(value, role, mode) {
  const fn = mode === "dark" ? toDark : toLight;
  const pieces = value.split(/(url\([^)]*\))/);
  return pieces.map((piece) => (piece.startsWith("url(") ? piece : piece.replace(COLOUR, (token) => {
    const c = parseColor(token);
    if (!c) return token;
    const next = fn(c, role);
    return next === c ? token : toHex(next, c.a);
  }))).join("");
}
function mapShadow(value, mode) {
  // Rings (inset shadows) are lines; drop shadows keep their own darkness.
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === "(") depth += 1;
    else if (value[i] === ")") depth -= 1;
    else if (value[i] === "," && depth === 0) { parts.push(value.slice(start, i)); start = i + 1; }
  }
  parts.push(value.slice(start));
  return parts.map((part) => (/\binset\b/.test(part) ? mapValue(part, "line", mode) : part)).join(",");
}
function mapDeclaration(prop, value, mode) {
  const role = roleOf(prop);
  if (!role) return value;
  if (/^var\(/.test(value.trim()) && !COLOUR.test(value)) return value;
  COLOUR.lastIndex = 0;
  return role === "shadow" ? mapShadow(value, mode) : mapValue(value, role, mode);
}

// ---- selectors and rules -----------------------------------------------------------------------------------------
/** The rule's selector under html[data-mtheme=...]; null for selectors that cannot apply in the Modern view. */
function scopeSelector(selector, theme) {
  const sel = selector.trim();
  if (!sel || /\.legacy-view\b/.test(sel)) return null;
  const prefix = `html[data-mtheme="${theme}"]`;
  if (/^:root\b/.test(sel)) return `${prefix}${sel.slice(":root".length)}`;
  if (/^html\b/.test(sel)) return /^html\s+\.modern-view\b/.test(sel) ? `${prefix} ${sel.replace(/^html\s+/, "")}` : `${prefix}${sel.slice("html".length)}`;
  if (/^(\*|body)\b/.test(sel)) return `${prefix} ${sel}`;
  return `${prefix} ${sel}`;
}

/** A declaration that takes part in the colours of a rule: kept (even when its colour is unchanged) so the cascade between rules stays as drawn. */
const COLOURED = (prop) => {
  const p = prop.toLowerCase();
  if (!roleOf(p)) return false;
  return !/(radius|width|style|collapse|spacing|image-|-image-)/.test(p) || p === "background-image";
};

function themedRule(rule, theme) {
  const kept = [];
  rule.walkDecls((decl) => {
    if (decl.parent !== rule || !COLOURED(decl.prop)) return;
    const next = mapDeclaration(decl.prop, decl.value, theme);
    kept.push({ prop: decl.prop, value: next, important: decl.important });
  });
  if (kept.length === 0) return null;
  const selectors = rule.selectors.map((s) => scopeSelector(s, theme)).filter(Boolean);
  if (selectors.length === 0) return null;
  const out = postcss.rule({ selectors });
  for (const decl of kept) out.append(postcss.decl({ prop: decl.prop, value: decl.value, important: decl.important }));
  return out;
}

function walkContainer(container, theme, into) {
  for (const node of container.nodes ?? []) {
    if (node.type === "rule") {
      if (node.parent?.type === "atrule" && /keyframes$/i.test(node.parent.name)) continue;
      const made = themedRule(node, theme);
      if (made) into.append(made);
    } else if (node.type === "atrule" && /^(media|supports|layer)$/i.test(node.name)) {
      const wrapper = postcss.atRule({ name: node.name, params: node.params });
      walkContainer(node, theme, wrapper);
      if (wrapper.nodes?.length) into.append(wrapper);
    }
  }
}

export function generate() {
  const out = postcss.root();
  const header = "/* GENERATED by scripts/generate-modern-theme.mjs from app/globals.css and app/modern-theme.css: do not edit. Run `npm run theme`. */";
  for (const theme of ["light", "dark"]) {
    const section = postcss.root();
    for (const source of SOURCES) {
      const css = fs.readFileSync(path.join(root, source), "utf8").replace(/@import[^;]*;/g, "");
      walkContainer(postcss.parse(css), theme, section);
    }
    out.append(postcss.comment({ text: ` ${theme} ` }));
    out.append(section.nodes);
  }
  return `${header}\n${out.toString().replace(/\n{2,}/g, "\n")}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const css = generate();
  const target = path.join(root, OUTPUT);
  if (process.argv.includes("--check")) {
    const have = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (have !== css) { console.error(`${OUTPUT} is out of date: run npm run theme`); process.exit(1); }
    console.log(`${OUTPUT} is up to date`);
  } else {
    fs.writeFileSync(target, css);
    console.log(`wrote ${OUTPUT} (${(css.length / 1024).toFixed(0)} KB)`);
  }
}
