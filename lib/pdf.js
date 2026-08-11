// Tiny zero-dependency PDF writer for invoice/order downloads. We deliberately
// avoid a PDF library (pdfkit et al. pull native/font deps and bloat the
// serverless bundle); the documents we emit are simple text-and-rules layouts,
// which base-14 Helvetica covers fully. Coordinates are in points, origin TOP-left
// (converted to PDF's bottom-left origin internally). US Letter, 612×792.
//
// Supports exactly what lib/pdf-docs.js needs: regular/bold Helvetica text with
// WinAnsi (cp1252) encoding, left/right/center alignment, word-wrap measurement,
// horizontal rules, filled rectangles, and multiple pages.

// Helvetica / Helvetica-Bold advance widths (AFM, 1/1000 em) for chars 32–126.
// Used for right-alignment and word wrap; a hair off is fine, cumulative drift
// is not, so these are the real metrics rather than an average guess.
/* eslint-disable */
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
/* eslint-enable */

// Typographic chars we may receive from DB text, mapped to their cp1252 bytes.
const CP1252 = {
  '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93,
  '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99
};

// String → cp1252 byte string. Latin-1 (0xA0–0xFF: é, ç, °, ·…) passes through;
// anything unmappable (emoji, ✓) becomes '?' rather than corrupting the stream.
function toWinAnsi(str) {
  let out = '';
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c <= 126) out += ch;
    else if (c >= 0xA0 && c <= 0xFF) out += ch;
    else if (CP1252[ch] != null) out += String.fromCharCode(CP1252[ch]);
    else out += '?';
  }
  return out;
}

function escapePdf(byteStr) {
  return byteStr.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

const num = (n) => (Math.round(n * 100) / 100).toString();
const rgb = ([r, g, b]) => `${num(r)} ${num(g)} ${num(b)}`;

export class PdfDoc {
  constructor({ width = 612, height = 792 } = {}) {
    this.w = width;
    this.h = height;
    this.pages = [];
    this.addPage();
  }

  addPage() {
    this.ops = [];
    this.pages.push(this.ops);
  }

  // Width of str at size, in points. bold: use the bold metrics.
  textWidth(str, size, bold = false) {
    const table = bold ? W_BOLD : W_REG;
    let w = 0;
    for (const ch of toWinAnsi(str)) {
      const c = ch.charCodeAt(0);
      w += (c >= 32 && c <= 126) ? table[c - 32] : 556; // Latin-1 letters ≈ their base glyph
    }
    return (w / 1000) * size;
  }

  // Greedy word wrap → array of lines fitting maxWidth. Never returns [].
  wrap(str, maxWidth, size, bold = false) {
    const words = String(str).split(/\s+/).filter(Boolean);
    if (!words.length) return [''];
    const lines = [];
    let line = '';
    for (const word of words) {
      const probe = line ? line + ' ' + word : word;
      if (this.textWidth(probe, size, bold) <= maxWidth || !line) line = probe;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
    return lines;
  }

  // y is the text BASELINE measured from the top of the page.
  text(x, y, str, { size = 10.5, bold = false, color = [0, 0, 0], align = 'left' } = {}) {
    let tx = x;
    if (align !== 'left') {
      const w = this.textWidth(str, size, bold);
      tx = align === 'right' ? x - w : x - w / 2;
    }
    const s = escapePdf(toWinAnsi(str));
    this.ops.push(`BT /F${bold ? 2 : 1} ${num(size)} Tf ${rgb(color)} rg 1 0 0 1 ${num(tx)} ${num(this.h - y)} Tm (${s}) Tj ET`);
  }

  // Horizontal (or any) line; y from top.
  line(x1, y1, x2, y2, { width = 0.75, color = [0, 0, 0] } = {}) {
    this.ops.push(`${num(width)} w ${rgb(color)} RG ${num(x1)} ${num(this.h - y1)} m ${num(x2)} ${num(this.h - y2)} l S`);
  }

  // Filled rectangle; (x, y) is its TOP-left corner.
  rect(x, y, w, h, color) {
    this.ops.push(`${rgb(color)} rg ${num(x)} ${num(this.h - y - h)} ${num(w)} ${num(h)} re f`);
  }

  // Serialize the document. All content is cp1252 bytes, so latin1 gives an
  // exact byte-for-byte encoding (and string length == stream /Length).
  build() {
    const objs = [];
    const first = 5; // 1 catalog, 2 pages, 3 F1, 4 F2, then page+stream pairs
    const kids = this.pages.map((_, i) => `${first + i * 2} 0 R`).join(' ');
    objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
    objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${this.pages.length} >>`;
    objs[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
    objs[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;
    this.pages.forEach((ops, i) => {
      objs[first + i * 2] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.w} ${this.h}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${first + i * 2 + 1} 0 R >>`;
      objs[first + i * 2 + 1] = { stream: ops.join('\n') };
    });

    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [];
    for (let i = 1; i < objs.length; i++) {
      offsets[i] = out.length;
      const o = objs[i];
      out += `${i} 0 obj\n`;
      out += typeof o === 'string' ? o : `<< /Length ${o.stream.length} >>\nstream\n${o.stream}\nendstream`;
      out += `\nendobj\n`;
    }
    const xref = out.length;
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objs.length; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(out, 'latin1');
  }
}
