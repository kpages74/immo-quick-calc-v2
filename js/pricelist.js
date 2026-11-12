// Eigene Preisliste (CSV) mit Quadratmeterpreisen je Lage (Etappe 4). Rein: kein DOM, kein Speicher.
// Kopfzeile: Ort;Stadtteil;PLZ;Preis_von;Preis_bis;Preis_mittel;Stand;Quelle (Groß/Klein egal, Reihenfolge beliebig).
import { parseNumber } from './format.js';

export const MAX_PRICE_ROWS = 5000;
const MAX_TEXT = 100;
const COLUMNS = Object.freeze(['ort', 'stadtteil', 'plz', 'preis_von', 'preis_bis', 'preis_mittel', 'stand', 'quelle']);
const PLACE_COLUMNS = Object.freeze(['ort', 'stadtteil', 'plz']);
const ROW_HEADER = 'Ort;Stadtteil;PLZ;Preis_von;Preis_bis;Preis_mittel;Stand;Quelle';

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Text getrimmt und auf 100 Zeichen begrenzt. Kein Text: ''. */
function cleanText(x) {
  return typeof x === 'string' ? x.trim().slice(0, MAX_TEXT).trim() : '';
}

/** Zahl ≥ 0 oder null. */
function cleanNumber(x) {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null;
}

/** Zelle als Zahl: „€“, „€/m²“ und Leerzeichen werden entfernt, dann parseNumber (deutsche Schreibweise). */
function numberCell(text) {
  const cleaned = String(text ?? '').replace(/€\/m²/g, '').replace(/€\/m2/g, '').replace(/€/g, '').replace(/\/m²/g, '').replace(/\/m2/g, '');
  return parseNumber(cleaned);
}

/**
 * Prüft eine Zeile mit gesäuberten Werten. Fehlt der Mittelpreis, aber sind von und bis da, gilt der Mittelwert.
 * Liefert { row } oder { error } (Fehlertext ohne Zeilennummer).
 */
function checkRow(raw) {
  const ort = cleanText(raw.ort);
  const stadtteil = cleanText(raw.stadtteil);
  const plz = cleanText(raw.plz);
  const von = cleanNumber(raw.von);
  const bis = cleanNumber(raw.bis);
  let mittel = cleanNumber(raw.mittel);
  if (mittel === null && von !== null && bis !== null) mittel = (von + bis) / 2;
  if (ort === '' && stadtteil === '' && plz === '') return { error: 'Ort, Stadtteil und PLZ fehlen.' };
  if (mittel === null || !(mittel > 0)) return { error: 'kein Mittelpreis > 0 bestimmbar.' };
  return {
    row: {
      ort,
      stadtteil,
      plz,
      von,
      bis,
      mittel,
      stand: cleanText(raw.stand),
      quelle: cleanText(raw.quelle),
    },
  };
}

/**
 * Zerlegt den Text in Datensätze { line, fields }. Feldtrenner delim, Anführungszeichen erlaubt
 * („“ schützt Trenner und Zeilenende, „“ innen = ein Anführungszeichen). Leere Zeilen fallen weg.
 * line = Zeilennummer in der Datei (erste Zeile = 1).
 */
function splitRecords(text, delim) {
  const records = [];
  let fields = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let startLine = 1;
  let i = 0;
  const endRecord = () => {
    fields.push(field);
    if (!(fields.length === 1 && fields[0].trim() === '')) records.push({ line: startLine, fields });
    fields = [];
    field = '';
  };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          quoted = false;
          i += 1;
        }
        continue;
      }
      if (ch === '\n') line += 1;
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      i += 1;
    } else if (ch === delim) {
      fields.push(field);
      field = '';
      i += 1;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      startLine = line;
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field !== '' || fields.length > 0) endRecord();
  return records;
}

/** Trenner: Semikolon. Enthält die erste nicht leere Zeile kein Semikolon, aber Tabulatoren, dann Tabulator. */
function detectDelimiter(text) {
  const first = text.split(/\r\n|\n|\r/).find((l) => l.trim() !== '') ?? '';
  return !first.includes(';') && first.includes('\t') ? '\t' : ';';
}

const failed = (message) => ({ ok: false, rows: [], errors: [message] });

/**
 * Liest eine CSV-Preisliste. Liefert { ok, rows, errors }. Fehlerhafte Zeilen werden verworfen und
 * mit „Zeile N: …“ gemeldet. ok ist true, wenn mindestens eine gültige Zeile da ist. Wirft nie.
 */
export function parsePriceList(text) {
  try {
    if (typeof text !== 'string') return failed('Die Datei ist leer.');
    const body = text.replace(/^﻿/, '');
    const records = splitRecords(body, detectDelimiter(body));
    if (records.length === 0) return failed('Die Datei ist leer.');

    const header = records[0].fields.map((h) => h.trim().toLowerCase());
    const col = Object.fromEntries(COLUMNS.map((name) => [name, header.indexOf(name)]));
    if (!PLACE_COLUMNS.some((name) => col[name] >= 0)) {
      return failed('Kopfzeile: Die Spalten Ort, Stadtteil und PLZ fehlen.');
    }
    const hasMean = col.preis_mittel >= 0;
    if (!hasMean && !(col.preis_von >= 0 && col.preis_bis >= 0)) {
      return failed('Kopfzeile: Die Spalte Preis_mittel fehlt, und Preis_von und Preis_bis reichen nicht aus.');
    }

    const rows = [];
    const errors = [];
    const data = records.slice(1);
    if (data.length > MAX_PRICE_ROWS) {
      errors.push(`Mehr als ${MAX_PRICE_ROWS} Zeilen: der Rest wurde ignoriert.`);
    }
    for (const rec of data.slice(0, MAX_PRICE_ROWS)) {
      const cell = (name) => (col[name] >= 0 && col[name] < rec.fields.length ? rec.fields[col[name]] : '');
      const result = checkRow({
        ort: cell('ort'),
        stadtteil: cell('stadtteil'),
        plz: cell('plz'),
        von: numberCell(cell('preis_von')),
        bis: numberCell(cell('preis_bis')),
        mittel: numberCell(cell('preis_mittel')),
        stand: cell('stand'),
        quelle: cell('quelle'),
      });
      if (result.error) errors.push(`Zeile ${rec.line}: ${result.error}`);
      else rows.push(result.row);
    }
    if (rows.length === 0 && errors.length === 0) errors.push('Keine Datenzeilen gefunden.');
    return { ok: rows.length > 0, rows, errors };
  } catch {
    return failed('Die Datei konnte nicht gelesen werden.');
  }
}

/** Gespeicherte Daten säubern: Zeilen mit denselben Regeln, höchstens 5000. Ungültig: leere Liste. Wirft nie. */
export function cleanPriceList(raw) {
  const empty = { rows: [], imported: '', fileName: '' };
  try {
    if (!isPlainObject(raw)) return empty;
    const rows = [];
    const list = Array.isArray(raw.rows) ? raw.rows : [];
    for (const item of list) {
      if (rows.length >= MAX_PRICE_ROWS) break;
      if (!isPlainObject(item)) continue;
      const result = checkRow(item);
      if (result.row) rows.push(result.row);
    }
    return { rows, imported: cleanText(raw.imported), fileName: cleanText(raw.fileName) };
  } catch {
    return empty;
  }
}

/** Treffer aus den Zeilen: jedes Suchwort muss in Ort, Stadtteil oder PLZ vorkommen. Leere Suche: []. */
export function searchPriceList(rows, query, limit = 20) {
  if (!Array.isArray(rows)) return [];
  const words = String(query ?? '').trim().toLowerCase().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return [];
  const max = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 20;
  const hits = [];
  for (const row of rows) {
    if (hits.length >= max) break;
    if (!isPlainObject(row)) continue;
    const hay = `${row.ort ?? ''} ${row.stadtteil ?? ''} ${row.plz ?? ''}`.toLowerCase();
    if (words.every((w) => hay.includes(w))) hits.push(row);
  }
  return hits;
}

/** Ortsangabe wie „Leipzig · Gohlis · 04155“, leere Teile fallen weg. */
export function priceListLabel(row) {
  const r = isPlainObject(row) ? row : {};
  return [r.ort, r.stadtteil, r.plz]
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter((x) => x !== '')
    .join(' · ');
}

/** Quellenangabe und Stand für eine Kalkulation aus einer Zeile der Preisliste. */
export function priceSourceFor(row) {
  const r = isPlainObject(row) ? row : {};
  return {
    source: `Preisliste: ${r.quelle || 'eigene Liste'} (${priceListLabel(r)})`,
    date: typeof r.stand === 'string' ? r.stand : '',
  };
}

/** Vorlage als CSV mit Kopfzeile und zwei erkennbar erfundenen Beispielzeilen (Zeilenende CRLF). */
export function priceListTemplate() {
  return [
    ROW_HEADER,
    'Musterstadt;Musterviertel;01234;2000;3000;2500;11/2026;Beispiel – bitte ersetzen',
    'Musterstadt;Beispielviertel;01235;1800;2600;2200;11/2026;Beispiel – bitte ersetzen',
  ].join('\r\n') + '\r\n';
}
