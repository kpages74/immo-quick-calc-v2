// Exposé einlesen: Zahlen aus dem Text eines Exposés per Suchmuster finden (ohne KI, ohne Netz).
// Reine Logik ohne DOM. js/ui/quickie.js zeigt die Ergebnisse, js/ui/pdfreader.js liest das PDF,
// js/ui/ocr.js erkennt Text in Bildern und eingescannten PDFs (Tesseract.js, lokal).
// Suchmuster und Zahlenlogik stammen aus dem Original „Deal-Schnellcheck Dresden“.
// ergebnisFuerArt ordnet die gefundenen Werte den Seiten des Rechners zu (Feldschlüssel aus js/fields.js).
import { clampField } from './fields.js';

const ALLE_FEHLEND = Object.freeze(['Kaufpreis', 'Wohnfläche', 'Ist-Kaltmiete']);
const MIN_TEXT = 20;
const MIN_LESBAR = 200;
const MIN_OCR = 10;

/**
 * Welche Werte je Seite des Rechners übernommen werden (Feldschlüssel). Leerstehend übernimmt keine Kaltmiete,
 * WG keine Kaltmiete (die Zimmerzahl dafür schon).
 */
const SEITEN = Object.freeze({
  vermietet: Object.freeze(['offerPrice', 'livingArea', 'rent']),
  kap: Object.freeze(['offerPrice', 'livingArea']),
  en: Object.freeze(['offerPrice', 'livingArea']),
  wg: Object.freeze(['offerPrice', 'livingArea', 'rooms']),
});

/** Bezeichnungen der Werte in Meldungen (Feldschlüssel → Text). */
const BEZEICHNUNG = Object.freeze({
  offerPrice: 'Kaufpreis',
  livingArea: 'Wohnfläche',
  rent: 'Ist-Kaltmiete',
  rooms: 'Zimmer',
});

/** Dateitypen, die als Bild per Texterkennung gelesen werden. */
export const BILD_TYPEN = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']);

const isPos = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
const fmt = (n, d) => n.toLocaleString('de-DE', { maximumFractionDigits: d });

/** Deutsche Zahl („170.000“, „1.234,56“, „60,5“) als Zahl. Keine Zahl: null. */
export function deNum(s) {
  if (s === null || s === undefined) return null;
  let t = String(s).replace(/[^\d.,]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Suchmuster im Text. Ergebnis: kaufpreis, wohnflaeche (Zahlen), ist_kaltmiete_monat oder ist_kaltmiete_jahr,
 * vertragsart ('staffel' | 'index'), belege (Fundstellen als Zitat), hinweise (Liste). Nicht gefunden: Feld fehlt.
 */
export function regexExtract(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ');
  const out = { belege: {}, hinweise: [] };

  // Zahl: „170.000“, „170 000“ (OCR-Leerzeichen als Tausendertrenner), „72,5“, „72.5“. Ein Leerzeichen zählt nur mit drei Ziffern danach.
  let m = t.match(/Kaufpreis[^0-9]{0,30}(\d{1,3}(?: \d{3}(?!\d))+(?:,\d+)?|[\d.]+(?:,\d+)?)/i);
  if (m) {
    out.kaufpreis = deNum(m[1]);
    out.belege.kaufpreis = m[0];
  }

  m = t.match(/Wohnfl(?:ä|ae)che[^0-9]{0,30}(\d{1,3}(?: \d{3}(?!\d))+(?:,\d+)?|[\d.]+(?:,\d+)?)/i);
  if (m) {
    out.wohnflaeche = deNum(m[1]);
    out.belege.wohnflaeche = m[0];
  }

  m = t.match(/(Ist-?\s?Miete|Netto-?kaltmiete|Kaltmiete|Mieteinnahmen|Jahresnettokaltmiete)[^0-9]{0,40}(\d{1,3}(?: \d{3}(?!\d))+(?:,\d+)?|[\d.]+(?:,\d+)?)\s*(?:€|EUR|Euro)?[^.;\d]{0,25}/i);
  if (m) {
    const v = deNum(m[2]);
    const ctx = t.slice(m.index, m.index + m[0].length + 25);
    if (/p\.\s?a\.|jährl|pro Jahr|im Jahr|\/\s?Jahr|Jahres/i.test(ctx)) out.ist_kaltmiete_jahr = v;
    else out.ist_kaltmiete_monat = v;
    out.belege.miete = m[0];
  }

  // Zimmer: „Anzahl Zimmer 3,5“, „Zimmer: 4“, „4 Zimmer“, „4-Zimmer-Wohnung“. „Wohnzimmer“ und „Schlafzimmer“ zählen nicht.
  // Bruchteile werden abgerundet (3,5 → 3).
  m = t.match(/Anzahl\s+(?:der\s+)?Zimmer[^0-9]{0,10}(\d{1,2}(?:,\d+)?)/i)
    || t.match(/(?<![A-Za-zÄÖÜäöüß])Zimmer\s*:\s*(\d{1,2}(?:,\d+)?)/i)
    || t.match(/(?<![\d,.])(\d{1,2}(?:,\d+)?)\s?-?\s?Zimmer/i);
  if (m) {
    const z = deNum(m[1]);
    if (z !== null && z >= 0) {
      out.zimmer = Math.floor(z);
      out.belege.zimmer = m[0];
    }
  }

  if (/Staffelmiete/i.test(t)) out.vertragsart = 'staffel';
  else if (/Indexmiete/i.test(t)) out.vertragsart = 'index';
  return out;
}

/**
 * Anzeige für die Oberfläche aus dem Ergebnis von regexExtract.
 * Rückgabe: werte {miete (€/Monat), flaeche (m²), angebot (€)} je Zahl oder null (nur Werte > 0),
 * rows [{label, wert, zitat}] für gefundene Werte, notes (Vertragsart und Hinweise), fehlt (Liste),
 * status {text, art: 'ok' | 'err'}.
 */
export function presentExtract(res, quelle) {
  const r = res ?? {};
  const kp = isPos(r.kaufpreis) ? r.kaufpreis : null;
  const A = isPos(r.wohnflaeche) ? r.wohnflaeche : null;
  const monat = r.ist_kaltmiete_monat ?? null;
  const jahr = r.ist_kaltmiete_jahr ?? null;
  const rawMiete = monat ?? (jahr !== null ? jahr / 12 : null);
  const miete = isPos(rawMiete) ? rawMiete : null;
  const nurJahr = monat === null && jahr !== null;
  const zimmer = isPos(r.zimmer) ? Math.floor(r.zimmer) : null;

  const belege = r.belege ?? {};
  const rows = [];
  if (kp !== null) rows.push({ label: 'Kaufpreis', wert: `${fmt(kp, 0)} €`, zitat: belege.kaufpreis ?? '' });
  if (A !== null) rows.push({ label: 'Wohnfläche', wert: `${fmt(A, 2)} m²`, zitat: belege.wohnflaeche ?? '' });
  if (miete !== null) {
    rows.push({
      label: 'Ist-Kaltmiete',
      wert: `${fmt(miete, 2)} €/Monat${nurJahr ? ' (Jahreswert ÷ 12)' : ''}`,
      zitat: belege.miete ?? '',
    });
  }

  const notes = [];
  if (r.vertragsart === 'staffel') {
    notes.push('Staffelmiete erwähnt: Mieterhöhung nach Mietspiegel nicht möglich. Vermutlich No-Deal.');
  } else if (r.vertragsart === 'index') {
    notes.push('Indexmiete erwähnt: Mieterhöhung nach Mietspiegel nicht möglich. Vermutlich No-Deal.');
  }
  notes.push(...(r.hinweise ?? []));

  const fehlt = [];
  if (kp === null) fehlt.push('Kaufpreis');
  if (A === null) fehlt.push('Wohnfläche');
  if (miete === null) fehlt.push('Ist-Kaltmiete');

  const status = fehlt.length > 0
    ? { text: `${quelle}: ${fehlt.join(', ')} nicht gefunden. Bitte ergänzen (gelb markiert) oder Text einfügen.`, art: 'err' }
    : { text: `${quelle}: alle drei Werte übernommen. Bitte kurz mit dem Exposé abgleichen.`, art: 'ok' };

  return {
    werte: { miete, flaeche: A, angebot: kp },
    zimmer,
    rows,
    notes,
    fehlt,
    status,
  };
}

/** Ergebnis ohne auswertbaren Text: keine Werte, alle Felder fehlen. */
function ohneWerte(text) {
  return { werte: null, zimmer: null, rows: [], notes: [], fehlt: [...ALLE_FEHLEND], status: { text, art: 'err' } };
}

/** Ganze Zahl innerhalb der Feldgrenzen (js/fields.js), oder null, wenn kein positiver Wert vorliegt. */
function ganzInGrenzen(key, x) {
  if (!isPos(x)) return null;
  const v = clampField(key, Math.round(x));
  return v > 0 ? v : null;
}

/**
 * Ergebnis je Seite des Rechners. art: 'vermietet' | 'kap' | 'en' | 'wg' (Rückgabe: werte {Feldschlüssel: ganze Zahl oder null},
 * nur die Felder der Seite; fehlt (Bezeichnungen der fehlenden Felder dieser Seite), notes, status).
 * Bei Erfolg kein Text (status.art null). Fehlt ein Wert: status mit art 'err'. Zu wenig Text: Status aus dem Befund, werte null.
 * art 'quickie' oder unbekannt: der Befund aus presentExtract / analysiere… unverändert.
 */
export function ergebnisFuerArt(befund, art, quelle = '') {
  const felder = SEITEN[art];
  if (!felder) return befund;
  if (befund.werte === null) {
    return { werte: null, fehlt: felder.map((k) => BEZEICHNUNG[k]), notes: befund.notes ?? [], status: befund.status };
  }
  const quellen = {
    offerPrice: befund.werte.angebot,
    livingArea: befund.werte.flaeche,
    rent: befund.werte.miete,
    rooms: befund.zimmer,
  };
  const werte = {};
  for (const key of felder) werte[key] = ganzInGrenzen(key, quellen[key]);
  const fehlt = felder.filter((key) => werte[key] === null).map((key) => BEZEICHNUNG[key]);
  const status = fehlt.length > 0
    ? { text: `${quelle}: ${fehlt.join(', ')} nicht gefunden. Bitte ergänzen (gelb markiert) oder Text einfügen.`, art: 'err' }
    : { text: '', art: null };
  return { werte, fehlt, notes: befund.notes, status };
}

/** Eingefügter Text (Quelle „Text (Suchmuster)“). Zu wenig Text: keine Werte. */
export function analysiereText(text, quelle = 'Text (Suchmuster)') {
  const s = String(text ?? '');
  if (s.trim().length < MIN_TEXT) return ohneWerte('Zu wenig Text gefunden.');
  return presentExtract(regexExtract(s), quelle);
}

/** Weniger als 200 Nicht-Leerzeichen im Text eines PDFs: eingescanntes PDF, das per Texterkennung gelesen wird. */
export function istEingescannt(text) {
  return String(text ?? '').replace(/\s/g, '').length < MIN_LESBAR;
}

/** Text aus einem PDF (Quelle „PDF (Suchmuster)“). Weniger als 200 Nicht-Leerzeichen: eingescanntes PDF. */
export function analysierePdfText(text, quelle = 'PDF (Suchmuster)') {
  const s = String(text ?? '');
  if (istEingescannt(s)) {
    return ohneWerte('Dieses PDF enthält keinen lesbaren Text (eingescannt). Bitte Werte von Hand eintragen oder den Exposé-Text einfügen.');
  }
  return presentExtract(regexExtract(s), quelle);
}

/** Dateityp, der als Bild per Texterkennung gelesen wird (PNG, JPEG, WebP, GIF, BMP). */
export function istBildTyp(typ) {
  return BILD_TYPEN.includes(typ);
}

/** Text aus der Texterkennung (Bild oder eingescanntes PDF). Weniger als 10 Nicht-Leerzeichen: kein lesbarer Text. */
export function analysiereOcrText(text, quelle) {
  const s = String(text ?? '');
  if (s.replace(/\s/g, '').length < MIN_OCR) {
    return ohneWerte('Im Bild wurde kein lesbarer Text gefunden. Bitte Werte von Hand eintragen.');
  }
  return presentExtract(regexExtract(s), quelle);
}
