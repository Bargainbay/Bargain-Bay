import zlib from 'zlib';

// Reading an .xlsx without a dependency.
//
// An xlsx is a ZIP of XML: the sheet is xl/worksheets/sheet1.xml, and most of
// its text lives once in xl/sharedStrings.xml with the cells pointing at it by
// index. Node already ships the only hard part (inflate), so the whole reader is
// a ZIP directory walk plus two small XML passes — no SheetJS, nothing to keep
// patched, and nothing that can't be read here in one sitting.
//
// It reads what a delivery list is: a rectangle of text. Formulas resolve to
// their last cached value (which is what the sender saw), and anything else —
// merged cells, formatting, charts — is ignored on purpose.

// ── ZIP ──────────────────────────────────────────────────────────────────────
// Central directory first: it is the authoritative list of entries, and unlike
// scanning for local headers it can't be fooled by a filename inside the data.
function readZip(buf) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  // The end-of-central-directory record is last, and at most 64KB from the end
  // (the comment field is the only thing that can follow it).
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That file is not a spreadsheet — save it as .xlsx or .csv.');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localAt = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, compSize, localAt });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return (name) => {
    const e = entries.get(name);
    if (!e) return null;
    // The local header repeats the name and extra fields, and its lengths are
    // the ones that count — the central copy can differ.
    const nameLen = buf.readUInt16LE(e.localAt + 26);
    const extraLen = buf.readUInt16LE(e.localAt + 28);
    const start = e.localAt + 30 + nameLen + extraLen;
    const raw = buf.subarray(start, start + e.compSize);
    if (e.method === 0) return raw.toString('utf8');
    if (e.method === 8) return zlib.inflateRawSync(raw).toString('utf8');
    throw new Error('That spreadsheet uses a compression this reader does not know.');
  };
}

// ── XML ──────────────────────────────────────────────────────────────────────
const unescapeXml = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&');                     // last, or &amp;lt; double-decodes

// A shared string can be one <t>, or several when Excel keeps per-run
// formatting inside one cell ("PO" bold + "10317" plain is still one value).
function sharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join('')
  );
}

// "BC7" → column 54. Base-26 with no zero, which is why it's a loop and not a
// lookup table.
function colIndex(ref) {
  const letters = String(ref).match(/^[A-Z]+/i)?.[0] || 'A';
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sheetRows(xml, strings) {
  if (!xml) return [];
  const rows = [];
  for (const rowM of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cM of rowM[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cM[1];
      const body = cM[2];
      const ref = attrs.match(/r="([A-Z]+\d+)"/i)?.[1];
      const type = attrs.match(/t="([^"]+)"/)?.[1];
      let value = '';
      if (type === 'inlineStr') {
        value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join('');
      } else {
        // <v> is the value; for a formula cell it is the cached result, which is
        // exactly what the person who sent the sheet was looking at.
        const v = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
        if (v != null) value = type === 's' ? (strings[Number(v)] ?? '') : unescapeXml(v);
      }
      const at = ref ? colIndex(ref) : cells.length;
      cells[at] = String(value).trim();
    }
    // A row of empty cells is spacing in a spreadsheet, not a stop.
    const filled = [...cells].map((c) => c || '');
    if (filled.some((c) => c !== '')) rows.push(filled);
  }
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return rows.map((r) => Array.from({ length: width }, (_, i) => r[i] || ''));
}

// The first sheet, as a grid of strings. `sheetName` picks another one.
export function readXlsx(buffer, sheetName) {
  const read = readZip(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
  const workbook = read('xl/workbook.xml') || '';
  const names = [...workbook.matchAll(/<sheet\b[^>]*name="([^"]*)"[^>]*\/?>/g)].map((m) => unescapeXml(m[1]));

  // Sheets are numbered by their order in the workbook, and sheet1.xml is not
  // reliably the first TAB — but for the sheets clients send, it is, and the
  // caller can name one when it isn't.
  const wanted = sheetName ? Math.max(0, names.indexOf(sheetName)) : 0;
  const strings = sharedStrings(read('xl/sharedStrings.xml'));
  const xml = read(`xl/worksheets/sheet${wanted + 1}.xml`) || read('xl/worksheets/sheet1.xml');
  if (!xml) throw new Error('That workbook has no readable sheet in it.');

  return { sheets: names, sheet: names[wanted] || names[0] || 'Sheet1', rows: sheetRows(xml, strings) };
}
