// PDF-Erzeuger ohne Bibliothek (Etappe 4, Paket 2). Läuft im Browser und in Node 24.
// Nutzt nur Uint8Array, TextEncoder, DecompressionStream, CompressionStream, Blob und Response.
// Keine DOM- und keine localStorage-Zugriffe, keine Importe. Alle Texte im Inhalt stehen als Hex-Strings
// in WinAnsi, dadurch ist die Datei außer den Bilddaten reines ASCII.

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 48;
const MARGIN_RIGHT_X = 547.28;
const HEADLINE_ZWEIT_X = 298; // zweite Kennzahl im Ergebnisblock (rechts neben der Marge)
const MARGIN_BOTTOM = 60;
const HEADER_H = 90;
const LOGO_H = 50;
const TOP_FIRST = 720;
const TOP_NEXT = 790;
const LINE = 14;
const ROW_LINE = 12;
const KEEP_TOGETHER_MAX = 700;
const FOOTER_Y = 36;
const APP_NAME = 'Immo Quick-Calc 2.0';

const HEADER_RGB = '#0f2949';
const GOLD_RGB = '#FAEEC8';
const GREY_RGB = '#666666';
const BLACK_RGB = '#000000';
const RULE_RGB = '#bfbfbf';

const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PNG_PIXELS = 25000000;

const WIN_SPECIAL = new Map([
  [0x20ac, 0x80], [0x201e, 0x84], [0x2026, 0x85], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
]);

/** Liest Inflate- oder Deflate-Daten durch einen Stream (Blob und Response liefern die Bytes). */
async function transform(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Entpackt zlib-Daten (PNG-IDAT). Fehlt DecompressionStream oder sind die Daten kaputt: null. */
async function inflate(bytes) {
  try {
    if (typeof DecompressionStream !== 'function') return null;
    return await transform(bytes, new DecompressionStream('deflate'));
  } catch {
    return null;
  }
}

/** Packt Bytes im zlib-Format für FlateDecode. Fehlt CompressionStream oder scheitert es: null. */
async function deflate(bytes) {
  try {
    if (typeof CompressionStream !== 'function') return null;
    return await transform(bytes, new CompressionStream('deflate'));
  } catch {
    return null;
  }
}

/** Paeth-Prädiktor aus PNG-Spezifikation. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Macht die PNG-Zeilenfilter rückgängig. Unbekannter Filtertyp: null. */
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  if (raw.length !== height * (stride + 1)) return null;
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) return null;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = y > 0 ? out[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[dst - stride + x - bpp] : 0;
      let v;
      if (filter === 0) v = 0;
      else if (filter === 1) v = a;
      else if (filter === 2) v = b;
      else if (filter === 3) v = Math.floor((a + b) / 2);
      else v = paeth(a, b, c);
      out[dst + x] = (raw[src + x] + v) & 0xff;
    }
  }
  return out;
}

/**
 * PNG dekodieren. Unterstützt nur Bittiefe 8, Farbtyp 2 (RGB) oder 6 (RGBA), nicht interlaced.
 * Alles andere, kaputte Daten oder fehlendes DecompressionStream: null. Wirft nie.
 */
export async function decodePng(bytes) {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.length < 8 + 25 + 12) return null;
    for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
      if (bytes[i] !== PNG_SIGNATURE[i]) return null;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = 8;
    let ihdr = null;
    const idat = [];
    let ended = false;
    while (pos + 8 <= bytes.length) {
      const len = view.getUint32(pos);
      const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
      const start = pos + 8;
      const end = start + len;
      if (end + 4 > bytes.length) return null;
      if (type === 'IHDR') {
        if (len !== 13) return null;
        ihdr = {
          width: view.getUint32(start),
          height: view.getUint32(start + 4),
          depth: bytes[start + 8],
          colorType: bytes[start + 9],
          interlace: bytes[start + 12],
        };
      } else if (type === 'IDAT') {
        idat.push(bytes.subarray(start, end));
      } else if (type === 'IEND') {
        ended = true;
        break;
      }
      pos = end + 4; // CRC überspringen
    }
    if (ihdr === null || !ended || idat.length === 0) return null;
    const { width, height, depth, colorType, interlace } = ihdr;
    if (depth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) return null;
    if (width < 1 || height < 1 || width * height > MAX_PNG_PIXELS) return null;

    const bpp = colorType === 2 ? 3 : 4;
    let total = 0;
    for (const part of idat) total += part.length;
    const zdata = new Uint8Array(total);
    let fill = 0;
    for (const part of idat) {
      zdata.set(part, fill);
      fill += part.length;
    }
    const raw = await inflate(zdata);
    if (raw === null) return null;
    const pixels = unfilter(raw, width, height, bpp);
    if (pixels === null) return null;

    const count = width * height;
    const rgb = new Uint8Array(count * 3);
    const alpha = colorType === 6 ? new Uint8Array(count) : null;
    for (let i = 0; i < count; i += 1) {
      rgb[i * 3] = pixels[i * bpp];
      rgb[i * 3 + 1] = pixels[i * bpp + 1];
      rgb[i * 3 + 2] = pixels[i * bpp + 2];
      if (alpha !== null) alpha[i] = pixels[i * 4 + 3];
    }
    return { width, height, rgb, alpha };
  } catch {
    return null;
  }
}

/** Text als WinAnsi/CP1252: ein Byte je Zeichen. Nicht darstellbare Zeichen werden „?“. */
export function toWinAnsi(text) {
  const codes = [];
  for (const ch of String(text ?? '')) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa1 && cp <= 0xff)) codes.push(cp);
    else if (cp === 0xa0 || cp === 0x202f || cp === 0x2009 || cp === 0x09) codes.push(0x20);
    else if (WIN_SPECIAL.has(cp)) codes.push(WIN_SPECIAL.get(cp));
    else if (cp === 0x2212) codes.push(0x2d);
    else codes.push(0x3f);
  }
  return Uint8Array.from(codes);
}

/** Hex-Text in Großbuchstaben der WinAnsi-Bytes, für <…>-Strings im PDF. */
export function pdfHex(text) {
  let out = '';
  for (const b of toWinAnsi(text)) out += b.toString(16).padStart(2, '0').toUpperCase();
  return out;
}

/** Bricht Text in Zeilen von höchstens maxChars Zeichen. Zeilenumbrüche bleiben, leere Absätze werden ''. */
export function wrapText(text, maxChars) {
  const max = Math.max(1, Math.floor(maxChars));
  const len = (s) => Array.from(s).length;
  const out = [];
  const paragraphs = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter((w) => w !== '');
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      if (len(word) > max) {
        // Zu langes Wort hart teilen: Rest der Zeile zuerst abschließen.
        if (line !== '') {
          out.push(line);
          line = '';
        }
        const chars = Array.from(word);
        for (let i = 0; i < chars.length; i += max) {
          const piece = chars.slice(i, i + max).join('');
          if (i + max < chars.length) out.push(piece);
          else line = piece;
        }
      } else if (line === '') {
        line = word;
      } else if (len(line) + 1 + len(word) <= max) {
        line += ` ${word}`;
      } else {
        out.push(line);
        line = word;
      }
    }
    if (line !== '') out.push(line);
  }
  return out;
}

/** Dateiname „Kalkulation-<Name>-JJJJ-MM-TT.pdf“ (Ortszeit). Leerer Name: „Objekt“. */
export function pdfFileName(name, now = new Date()) {
  const cleaned = String(name ?? '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  const short = Array.from(cleaned).slice(0, 60).join('').replace(/-+$/g, '');
  const base = short === '' ? 'Objekt' : short;
  const d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Kalkulation-${base}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.pdf`;
}

// MARK: - Aufbau der Datei

const f2 = (n) => Number(n).toFixed(2);
const str = (v) => (v === null || v === undefined ? '' : String(v));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** RGB-Anteile für den Operator-Text, z. B. „0.059 0.161 0.286“. */
function rgbParts(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [16, 8, 0].map((shift) => (((n >> shift) & 255) / 255).toFixed(3)).join(' ');
}

/** Ein Textfeld als Inhaltsoperatoren (Hex-String, Schrift F1 oder F2). */
function textOp(x, y, size, font, color, value) {
  return `${rgbParts(color)} rg BT /${font} ${size} Tf ${f2(x)} ${f2(y)} Td <${pdfHex(value)}> Tj ET\n`;
}

/** ASCII-Text zu Bytes. Nur für Texte, die nach Konstruktion ASCII sind. */
function ascii(s) {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function concat(list) {
  let n = 0;
  for (const part of list) n += part.length;
  const out = new Uint8Array(n);
  let p = 0;
  for (const part of list) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

/** Objekt ohne Stream: „N 0 obj … endobj“. */
function plainObject(num, body) {
  return { num, bytes: ascii(`${num} 0 obj\n${body}\nendobj\n`) };
}

/** Stream-Objekt. /Length ist die exakte Bytezahl zwischen „stream\n“ und „\nendstream“. */
function streamObject(num, dict, data) {
  const head = ascii(`${num} 0 obj\n<< ${dict} /Length ${data.length} >>\nstream\n`);
  const tail = ascii('\nendstream\nendobj\n');
  return { num, bytes: concat([head, data, tail]) };
}

/** Logo vorbereiten: Farbbild und ggf. Maske, beide komprimiert. Sonst null (dann Text in der Kopfzeile). */
async function prepareLogo(logoPng) {
  if (!(logoPng instanceof Uint8Array)) return null;
  const png = await decodePng(logoPng);
  if (png === null) return null;
  const rgbZ = await deflate(png.rgb);
  if (rgbZ === null) return null;
  let maskZ = null;
  if (png.alpha !== null) {
    maskZ = await deflate(png.alpha);
    if (maskZ === null) return null;
  }
  return { width: png.width, height: png.height, rgbZ, maskZ };
}

/**
 * PDF aus dem Ergebnis von presentReport. options.logoPng: Bytes der PNG-Datei (optional).
 * Wirft nicht bei fehlenden oder kaputten Feldern. Liefert Uint8Array (PDF 1.4).
 */
export async function buildPdf(report, options = {}) {
  const r = isObj(report) ? report : {};
  const opts = isObj(options) ? options : {};
  const headline = isObj(r.headline) ? r.headline : {};
  const sections = Array.isArray(r.sections) ? r.sections.filter(isObj) : [];
  const notes = Array.isArray(r.notes) ? r.notes.map(str).filter((n) => n !== '') : [];
  const name = str(r.name);
  const note = str(r.note);
  const appName = str(r.appName) || APP_NAME;
  const date = str(r.date);
  const logo = await prepareLogo(opts.logoPng);

  const pages = [];
  let page = [];
  let y = TOP_FIRST;

  const put = (x, yy, size, font, color, value) => page.push(textOp(x, yy, size, font, color, value));
  const need = (step) => {
    if (y - step < MARGIN_BOTTOM) newPage(false);
  };

  const drawHeader = () => {
    page.push(`${rgbParts(HEADER_RGB)} rg 0 ${f2(PAGE_H - HEADER_H)} ${f2(PAGE_W)} ${HEADER_H} re f\n`);
    if (logo !== null) {
      const h = LOGO_H;
      const w = (h * logo.width) / logo.height;
      const x = (PAGE_W - w) / 2;
      const yy = PAGE_H - HEADER_H / 2 - h / 2;
      page.push(`q ${f2(w)} 0 0 ${f2(h)} ${f2(x)} ${f2(yy)} cm /Im1 Do Q\n`);
    } else {
      put(MARGIN_X, PAGE_H - HEADER_H / 2 - 5, 16, 'F2', GOLD_RGB, appName);
    }
  };

  const newPage = (first) => {
    page = [];
    pages.push(page);
    if (first) {
      drawHeader();
      y = TOP_FIRST;
    } else {
      y = TOP_NEXT;
    }
  };

  /** Zeilen der Spalte 2 bei zweispaltigen Zeilen (52 Zeichen je Zeile). Sonst eine Zeile. */
  const rowLines = (cells) => (cells.length === 2 ? wrapText(cells[1], 52) : ['']);
  /** Höhe einer Tabellenzeile: 14 pt bis zur ersten Zeile, je Folgezeile 12 pt mehr. */
  const rowHeight = (cells) => LINE + ROW_LINE * (rowLines(cells).length - 1);
  const drawRow = (cells, isHeader) => {
    const size = isHeader ? 8.5 : 9.5;
    const color = isHeader ? GREY_RGB : BLACK_RGB;
    put(MARGIN_X, y, size, 'F1', color, clipText(cells[0] ?? '', 48));
    if (cells.length === 2) {
      rowLines(cells).forEach((line, i) => put(300, y - ROW_LINE * i, size, 'F1', color, line));
    } else if (cells.length >= 3) {
      put(300, y, size, 'F1', color, clipText(cells[1], 24));
      put(440, y, size, 'F1', color, clipText(cells[2], 24));
    }
    y -= rowHeight(cells);
  };

  // Erste Seite mit Kopfbalken, dann Name, Adresse und Kopfzeile.
  newPage(true);
  if (name !== '') {
    for (const line of wrapText(name, 50)) {
      need(22);
      put(MARGIN_X, y, 16, 'F2', BLACK_RGB, line);
      y -= 22;
    }
  }
  const address = str(r.address);
  if (address !== '') {
    for (const line of wrapText(address, 90)) {
      need(LINE);
      put(MARGIN_X, y, 10, 'F1', BLACK_RGB, line);
      y -= LINE;
    }
  }
  const meta = [date, str(r.kindLabel), str(r.modeLabel)].filter((s) => s !== '').join(' · ');
  if (meta !== '') {
    need(18);
    put(MARGIN_X, y, 10, 'F1', GREY_RGB, meta);
    y -= 18;
  }
  y -= 8;

  // Ergebnisblock
  need(28 + 18);
  const zweit = isObj(r.headlineZweit) ? r.headlineZweit : null;
  put(MARGIN_X, y, 10, 'F1', GREY_RGB, str(headline.label));
  if (zweit) put(HEADLINE_ZWEIT_X, y, 10, 'F1', GREY_RGB, str(zweit.label));
  y -= 28;
  put(MARGIN_X, y, 22, 'F2', BLACK_RGB, str(headline.value));
  if (zweit) put(HEADLINE_ZWEIT_X, y, 22, 'F2', BLACK_RGB, str(zweit.value));
  y -= 18;
  const sub = str(headline.sub);
  const zweitSub = zweit ? str(zweit.sub) : '';
  if (sub !== '' || zweitSub !== '') {
    need(16);
    if (sub !== '') put(MARGIN_X, y, 10, 'F1', GREY_RGB, sub);
    if (zweitSub !== '') put(HEADLINE_ZWEIT_X, y, 10, 'F1', GREY_RGB, zweitSub);
    y -= 16;
  }
  y -= 8;

  // Hinweise
  for (const n of notes) {
    wrapText(n, 90).forEach((line, i) => {
      need(13);
      put(MARGIN_X, y, 9.5, 'F1', BLACK_RGB, `${i === 0 ? '•' : ' '} ${line}`);
      y -= 13;
    });
  }
  if (notes.length > 0) y -= 8;

  // Abschnitte
  const drawTitle = (title) => {
    put(MARGIN_X, y, 11, 'F2', BLACK_RGB, title);
    page.push(`${rgbParts(RULE_RGB)} RG 0.5 w ${MARGIN_X} ${f2(y - 4)} m ${f2(MARGIN_RIGHT_X)} ${f2(y - 4)} l S\n`);
    y -= 20;
  };
  for (const section of sections) {
    const cols = Array.isArray(section.columns) ? section.columns.map(str) : null;
    const hasCols = cols !== null && cols.length > 0;
    const rows = Array.isArray(section.rows) ? section.rows.filter(Array.isArray).map((row) => row.map(str)) : [];
    // Passt der ganze Abschnitt auf eine Seite, beginnt er ggf. auf der nächsten. Sonst: Titel nicht allein am Seitenende.
    const height = 26 + (hasCols ? LINE : 0) + rows.reduce((sum, row) => sum + rowHeight(row), 0) + 10;
    if (height <= KEEP_TOGETHER_MAX && y - height < MARGIN_BOTTOM) newPage(false);
    else need(26 + (hasCols ? LINE : 0) + 2 * LINE);
    drawTitle(str(section.title));
    if (hasCols) drawRow(cols, true);
    for (const row of rows) {
      need(rowHeight(row));
      drawRow(row, false);
    }
    y -= 10;
  }

  // Notiz
  if (note !== '') {
    need(26 + 2 * LINE);
    drawTitle('Notiz');
    for (const line of wrapText(note, 90)) {
      need(LINE);
      put(MARGIN_X, y, 9.5, 'F1', BLACK_RGB, line);
      y -= LINE;
    }
  }

  // Fußzeile auf jeder Seite, Seitenzahl erst nach dem Umbruch bekannt.
  const total = pages.length;
  pages.forEach((ops, i) => {
    ops.push(textOp(MARGIN_X, FOOTER_Y, 8, 'F1', GREY_RGB, `${APP_NAME} · erstellt am ${date}`));
    ops.push(textOp(490, FOOTER_Y, 8, 'F1', GREY_RGB, `Seite ${i + 1} von ${total}`));
  });

  // Objektnummern: 1 Katalog, 2 Seiten, 3 Info, 4 F1, 5 F2, dann Bild und Maske, dann je Seite Seite und Inhalt.
  const objects = [];
  let next = 6;
  const imgNum = logo !== null ? next++ : 0;
  const maskNum = logo !== null && logo.maskZ !== null ? next++ : 0;
  const pageIds = pages.map(() => ({ page: next++, content: next++ }));
  const size = next;

  objects.push(plainObject(1, '<< /Type /Catalog /Pages 2 0 R >>'));
  objects.push(plainObject(2, `<< /Type /Pages /Kids [${pageIds.map((p) => `${p.page} 0 R`).join(' ')}] /Count ${pages.length} >>`));
  objects.push(plainObject(3, `<< /Title <${pdfHex(name)}> /Producer <${pdfHex(APP_NAME)}> >>`));
  objects.push(plainObject(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
  objects.push(plainObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));
  if (logo !== null) {
    const smask = maskNum !== 0 ? ` /SMask ${maskNum} 0 R` : '';
    objects.push(streamObject(imgNum,
      `/Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${smask}`,
      logo.rgbZ));
    if (maskNum !== 0) {
      objects.push(streamObject(maskNum,
        `/Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
        logo.maskZ));
    }
  }
  const xobject = logo !== null ? ` /XObject << /Im1 ${imgNum} 0 R >>` : '';
  pages.forEach((ops, i) => {
    const ids = pageIds[i];
    objects.push(plainObject(ids.page,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f2(PAGE_W)} ${f2(PAGE_H)}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >>${xobject} >> /Contents ${ids.content} 0 R >>`));
    objects.push(streamObject(ids.content, '', ascii(ops.join(''))));
  });
  objects.sort((a, b) => a.num - b.num);

  // Datei zusammensetzen: Kopf, Objekte mit Positionen, xref, Trailer.
  const headerBytes = concat([ascii('%PDF-1.4\n%'), Uint8Array.from([0xe2, 0xe3, 0xcf, 0xd3]), ascii('\n')]);
  const chunks = [headerBytes];
  const offsets = [];
  let pos = headerBytes.length;
  for (const obj of objects) {
    offsets[obj.num] = pos;
    chunks.push(obj.bytes);
    pos += obj.bytes.length;
  }
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n += 1) {
    xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  chunks.push(ascii(xref));
  return concat(chunks);
}

/** Text auf n Zeichen kürzen, Ende mit „…“. */
function clipText(value, max) {
  const s = str(value);
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : s;
}
