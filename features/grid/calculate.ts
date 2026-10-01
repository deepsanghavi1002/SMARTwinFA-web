/**
 * The arithmetic behind the cell calculator: numbers, + - * / %, brackets. It is parsed
 * here, never run as code. Percent follows a desk calculator: 5000+18% is 5900.
 */

/** Evaluates an arithmetic expression, or returns null when it is not one. */
export function evaluate(expression: string): number | null {
  const text = expression.replace(/[×x]/gi, "*").replace(/÷/g, "/").replace(/,/g, "").replace(/\s+/g, "");
  if (text === "" || /[^0-9.+\-*/%()]/.test(text)) return null;
  let at = 0;
  const peek = () => text[at];
  const number = (): number | null => {
    const match = /^\d*\.?\d+|^\d+\./.exec(text.slice(at));
    if (!match) return null;
    at += match[0].length;
    return Number(match[0]);
  };
  const factor = (): number | null => {
    if (peek() === "-") { at += 1; const value = factor(); return value === null ? null : -value; }
    if (peek() === "+") { at += 1; return factor(); }
    let value: number | null;
    if (peek() === "(") {
      at += 1;
      value = sum();
      if (peek() !== ")") return null;
      at += 1;
    } else value = number();
    // "15%" is fifteen hundredths, so 200*15% is 30.
    while (value !== null && peek() === "%") { at += 1; value /= 100; }
    return value;
  };
  const product = (): number | null => {
    let value = factor();
    while (value !== null && (peek() === "*" || peek() === "/")) {
      const op = text[at];
      at += 1;
      const right = factor();
      if (right === null || (op === "/" && right === 0)) return null;
      value = op === "*" ? value * right : value / right;
    }
    return value;
  };
  function sum(): number | null {
    let value = product();
    while (value !== null && (peek() === "+" || peek() === "-")) {
      const op = text[at];
      at += 1;
      const start = at;
      let right = product();
      if (right === null) return null;
      // As on a desk calculator, 5000+18% adds 18% of 5000 (GST on top), and 5000-10% takes a tenth off.
      if (/^\d*\.?\d+%$/.test(text.slice(start, at))) right = value * right;
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }
  const result = sum();
  return result !== null && at === text.length && Number.isFinite(result) ? result : null;
}
