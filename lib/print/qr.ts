import QRCode from "qrcode";

/**
 * A QR code (the e-invoice's signed QR text) as an image address a print template can show: an SVG made from the code's modules, as a data URI.
 * Empty text gives no image.
 */
export function qrDataUri(text: string, quiet = 1): string {
  if (text.trim() === "") return "";
  const code = QRCode.create(text, { errorCorrectionLevel: "L" });
  const size = code.modules.size;
  const data = code.modules.data;
  let path = "";
  for (let row = 0; row < size; row += 1) {
    let start = -1;
    for (let column = 0; column <= size; column += 1) {
      const dark = column < size && data[row * size + column] === 1;
      if (dark && start < 0) start = column;
      if (!dark && start >= 0) { path += `M${start + quiet} ${row + quiet}h${column - start}v1h-${column - start}z`; start = -1; }
    }
  }
  const box = size + quiet * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" shape-rendering="crispEdges"><rect width="${box}" height="${box}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
