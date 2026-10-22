/**
 * A finished HTML document (the invoice bill) as a Rich Text (.rtf) file that Word opens and edits: the rendered page is read
 * as it is laid out, so its tables, and the grids of boxes (party, totals ...) become RTF tables, and the text keeps its size,
 * weight and alignment. Pictures are not carried.
 */

const TWIPS_PER_PX = 15;
/** A4 less 10 mm margins, in twips: the width a table is spread over. */
const PAGE_TWIPS = 10772;

const escapeRtf = (text: string) => {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\\" || char === "{" || char === "}") out += `\\${char}`;
    else if (char === "\n") out += "\\line ";
    else if (code > 126) out += (code > 0xffff ? [...char] : [char]).map((part) => { const unit = part.charCodeAt(0); return `\\u${unit > 32767 ? unit - 65536 : unit}?`; }).join("");
    else if (code >= 32) out += char;
  }
  return out;
};

type Style = CSSStyleDeclaration;
const px = (value: string) => Number.parseFloat(value) || 0;

export function htmlToRtf(doc: Document): string {
  const win = doc.defaultView;
  if (!win) return "";
  const style = (el: Element): Style => win.getComputedStyle(el);
  const isBlock = (el: Element) => !["inline", "inline-block", "contents"].includes(style(el).display) && !["B", "STRONG", "I", "EM", "U", "SPAN", "SMALL", "A", "BR"].includes(el.tagName);
  const isRowOfBoxes = (el: Element) => {
    const display = style(el).display;
    const kids = [...el.children].filter((kid) => style(kid).display !== "none");
    return (display === "grid" || display === "flex") && kids.length > 1;
  };

  /** The runs of an inline piece: text with bold / italic from the page's own styling. */
  const runs = (node: Node, inherited: Style): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ");
      return text === " " && !(node.previousSibling && node.nextSibling) ? "" : escapeRtf(text);
    }
    if (!(node instanceof win.HTMLElement)) return "";
    if (node.tagName === "BR") return "\\line ";
    const own = style(node);
    if (own.display === "none") return "";
    const bold = px(own.fontWeight) >= 600 || own.fontWeight === "bold";
    const italic = own.fontStyle === "italic";
    const inner = [...node.childNodes].map((child) => runs(child, own)).join("");
    if (inner === "") return "";
    const wrapB = bold && !(px(inherited.fontWeight) >= 600);
    return `{${wrapB ? "\\b " : ""}${italic ? "\\i " : ""}${inner}}`;
  };

  /** Set while the paragraphs of a bordered block (the company box) are made: they are drawn inside its box. */
  let boxed = false;
  const hasBorder = (own: Style) => px(own.borderTopWidth) > 0 || px(own.borderLeftWidth) > 0 || px(own.borderRightWidth) > 0 || px(own.borderBottomWidth) > 0;
  const paragraph = (el: HTMLElement, flat = false): string => {
    const own = style(el);
    const align = own.textAlign === "right" || own.textAlign === "end" ? "\\qr" : own.textAlign === "center" ? "\\qc" : "\\ql";
    const size = Math.max(12, Math.round(px(own.fontSize) * 0.75 * 2));
    const bold = px(own.fontWeight) >= 600 ? "\\b " : "";
    const joined = (own.display === "grid" || own.display === "flex") ? " " : "";
    const body = [...el.childNodes].map((child) => runs(child, own)).join(joined).trim();
    if (body === "" && !flat) return "";
    const box = boxed || hasBorder(own) ? "\\box\\brdrs\\brdrw10\\brsp40" : "";
    return `\\pard\\plain${box}${align}\\fs${size} ${bold}${body}`;
  };

  const border = (width: string) => (px(width) > 0 ? "\\brdrs\\brdrw10" : "\\brdrnil");
  const row = (cells: { el: HTMLElement; width: number; content: string[] }[], total: number, outer?: HTMLElement): string => {
    let at = 0;
    const frame = outer ? style(outer) : null;
    const defs = cells.map((cell, index) => {
      const own = style(cell.el);
      // A grid of boxes: the container's own border is the outside of the first and last box.
      const side = (width: string, edge: boolean, outerWidth: string | undefined) => border(px(width) > 0 || (edge && outerWidth !== undefined && px(outerWidth) > 0) ? "1" : "0");
      at += Math.max(300, Math.round((cell.width / Math.max(1, total)) * PAGE_TWIPS));
      return `\\clbrdrt${side(own.borderTopWidth, true, frame?.borderTopWidth)}\\clbrdrl${side(own.borderLeftWidth, index === 0, frame?.borderLeftWidth)}\\clbrdrb${side(own.borderBottomWidth, true, frame?.borderBottomWidth)}\\clbrdrr${side(own.borderRightWidth, index === cells.length - 1, frame?.borderRightWidth)}\\clvertalt\\cellx${at}`;
    }).join("");
    // Every paragraph in a cell is marked \intbl, or Word draws it outside the table.
    const body = cells.map((cell) => `${(cell.content.join("\\par ") || "\\pard\\plain ").replace(/\\pard\\plain/g, "\\pard\\plain\\intbl")}\\cell`).join("");
    return `\\trowd\\trgaph80\\trleft0${defs}${body}\\row\n`;
  };

  /** The paragraphs inside a cell or box: no nested table is built, a nested table's row is a line of tab-separated cells. */
  const inside = (el: HTMLElement): string[] => {
    const out: string[] = [];
    const blocks = [...el.children].filter((kid): kid is HTMLElement => kid instanceof win.HTMLElement && style(kid).display !== "none" && isBlock(kid));
    if (blocks.length === 0) { const text = paragraph(el); return text ? [text] : []; }
    let loose = "";
    for (const node of el.childNodes) {
      if (node instanceof win.HTMLElement && isBlock(node)) {
        if (loose.trim()) { out.push(`\\pard\\plain\\fs${Math.round(px(style(el).fontSize) * 1.5)} ${loose.trim()}`); loose = ""; }
        if (node.tagName === "TABLE") for (const tr of (node as HTMLTableElement).rows) out.push(`\\pard\\plain\\fs${Math.round(px(style(tr).fontSize) * 1.5)} ${[...tr.cells].map((cell) => escapeRtf((cell.innerText ?? cell.textContent ?? "").trim())).join("\\tab ")}`);
        else out.push(...inside(node));
      } else loose += runs(node, style(el));
    }
    if (loose.trim()) out.push(`\\pard\\plain\\fs${Math.round(px(style(el).fontSize) * 1.5)} ${loose.trim()}`);
    return out;
  };

  const block = (el: HTMLElement): string => {
    if (style(el).display === "none") return "";
    if (el.tagName === "STYLE" || el.tagName === "SCRIPT" || el.tagName === "HEAD") return "";
    if (el.tagName === "TABLE") {
      const table = el as HTMLTableElement;
      const total = table.getBoundingClientRect().width;
      return [...table.rows].map((tr) => row([...tr.cells].map((cell) => {
        const own = style(cell);
        const align = own.textAlign === "right" || own.textAlign === "end" ? "\\qr" : own.textAlign === "center" ? "\\qc" : "\\ql";
        const size = Math.max(12, Math.round(px(own.fontSize) * 0.75 * 2));
        const bold = px(own.fontWeight) >= 600 || cell.tagName === "TH" ? "\\b " : "";
        const content = inside(cell as HTMLElement).map((text) => text.replace(/^\\pard\\plain(\\q[lrc])?(\\fs\d+)? ?/, ""));
        return { el: cell as HTMLElement, width: cell.getBoundingClientRect().width, content: content.map((text) => `\\pard\\plain${align}\\fs${size} ${bold}${text}`) };
      }), total)).join("") + "\\pard\\plain\\par\n";
    }
    if (isRowOfBoxes(el)) {
      const kids = [...el.children].filter((kid): kid is HTMLElement => kid instanceof win.HTMLElement && style(kid).display !== "none");
      const total = kids.reduce((sum, kid) => sum + kid.getBoundingClientRect().width, 0);
      return row(kids.map((kid) => ({ el: kid, width: kid.getBoundingClientRect().width, content: inside(kid) })), total, el);
    }
    const kids = [...el.children].filter((kid): kid is HTMLElement => kid instanceof win.HTMLElement && style(kid).display !== "none" && isBlock(kid));
    if (kids.length > 0) {
      const before = boxed;
      if (hasBorder(style(el))) boxed = true;
      try { return [...el.childNodes].map((node) => (node instanceof win.HTMLElement && isBlock(node) ? block(node) : "")).join(""); } finally { boxed = before; }
    }
    const text = paragraph(el);
    return text ? `${text}\\par\n` : "";
  };

  const body = doc.body;
  const font = style(body).fontFamily.split(",")[0].replace(/["']/g, "").trim() || "Arial";
  const content = [...body.children].map((el) => (el instanceof win.HTMLElement ? block(el) : "")).join("");
  return `{\\rtf1\\ansi\\ansicpg1252\\deff0\\deflang16393{\\fonttbl{\\f0\\fswiss ${escapeRtf(font)};}}\\paperw11906\\paperh16838\\margl567\\margr567\\margt567\\margb567\\fs22\n${content}}`;
}

/** Downloads the document as `<name>.rtf`. */
export function downloadRtf(html: string, name: string) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0";
  frame.srcdoc = html;
  frame.onload = () => {
    try {
      const doc = frame.contentDocument;
      if (!doc) return;
      const url = URL.createObjectURL(new Blob([htmlToRtf(doc)], { type: "application/rtf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Document"}.rtf`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      frame.remove();
    }
  };
  document.body.appendChild(frame);
}
