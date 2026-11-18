// Objekt-Akte v1: gemeinsames Datenformat für MietQuickie, QuickCalc und ImmoDashboard.
// Reines Modul: kein DOM, kein chrome.*, keine Abhängigkeiten außer util.js (ebenfalls DOM-frei).
//
// Grundsätze
//  - Jeder Eckdaten-Wert ist optional; null = unbekannt. Fehlende Werte zählen beim Vergleich
//    weder als Treffer noch als Widerspruch.
//  - Bewertungen ({werkzeug, version, datum, ampel?, kernzahlen}) werden nur übernommen, nie neu gerechnet.
//  - Unsichere Dubletten ('unsicher') sind nur Vorschläge; die Bestätigung des Nutzers hat Vorrang.
//
// DUBLETTENREGEL (vergleiche)
//  0. Gleiches Portal + gleiche Inserats-ID in einer Quelle beider Akten -> 'gleich' (Grund „gleiches Inserat“).
//  1. Widerspruch -> sofort 'verschieden'. Widerspruch = beide Seiten bekannt UND
//       Zimmer ungleich | Etage ungleich | |Wohnfläche| Differenz > 2 m² | PLZ ungleich |
//       Baujahr ohne gemeinsames Jahr („1927/1999“: erstes Jahr = Baujahr, zweites = Modernisierung;
//       gleich, wenn irgendein Jahr übereinstimmt) | Energiekennwert beide da und Differenz > 3 kWh.
//  2. Punkte (Kriterien ohne Widerspruch):
//       sehr stark (je 100): mind. 1 Bildpaar mit Hamming-Abstand <= 6;
//                            gleicher Energieausweis (Kennwert +-1 UND Klasse gleich, falls beide Klassen da).
//       stark: Straße+Hausnummer gleich (normalisiert) 40; Wohnfläche +-1 m² 25; Zimmer gleich 15;
//              Etage gleich 15; PLZ gleich 10.
//       mittel (je 10): Baujahr gleich; Hausgeld +-5 EUR; Ist-Kaltmiete +-5 EUR;
//              Beschreibung jaccard >= 0,5; Energieklasse gleich (nur wenn kein Ausweis-Treffer vorliegt).
//       kein Kriterium: Kaufpreis, Anbieter, Titel, URL.
//  3. Urteil: kein Widerspruch und (Punkte >= 100 ODER (Fläche +-1 UND Zimmer UND PLZ gleich UND
//     mind. 2 weitere Treffer aus Etage/Baujahr/Hausgeld/Miete/Energieklasse)) -> 'gleich';
//     kein Widerspruch und Punkte >= 40 -> 'unsicher'; sonst 'verschieden'.
//
// Zusatzfeld: eckdaten.baujahrModernisierung (zweites Jahr aus „1927/1999“).

import { parseDeNumber } from './util.js';

export const AKTE_VERSION = 1;
export const STUFEN = ['gescannt', 'angefragt', 'unterlagen', 'besichtigt', 'angebot', 'notar', 'gekauft', 'aussortiert'];

const SKALARE = ['kaufpreis', 'wohnflaeche', 'istKaltmiete', 'vermietet', 'vertragsart', 'zimmer', 'etage',
  'etagenGesamt', 'baujahr', 'baujahrModernisierung', 'hausgeld', 'plz', 'ort', 'strasse', 'hausnummer'];
const ENERGIE = ['ausweistyp', 'kennwertKwh', 'klasse', 'energietraeger', 'baujahrHeizung'];

// ---------------------------------------------------------------- Normalisierung

const istObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};

function zahl(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = text(v);
  if (t === null) return null;
  const n = parseDeNumber(t);
  if (n === null) return null;
  return /^\s*-/.test(t) ? -n : n;
}

function ganzzahl(v) {
  const n = zahl(v);
  return n !== null && Number.isInteger(n) ? n : null;
}

/** „2“, „2,5“, „2 1/2“, „2,5 Zimmer“ -> Zahl; sonst null. */
export function normalisiereZimmer(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = text(v);
  if (t === null) return null;
  const halb = t.match(/^(\d+)\s+1\s*\/\s*2\b/);
  if (halb) return Number(halb[1]) + 0.5;
  const m = t.match(/\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** 5-stellige PLZ als String; sonst null. */
export function normalisierePlz(v) {
  if (typeof v === 'number') {
    return Number.isInteger(v) && v >= 1000 && v <= 99999 ? String(v).padStart(5, '0') : null;
  }
  const t = text(v);
  if (t === null) return null;
  const m = t.match(/(?<!\d)\d{5}(?!\d)/);
  return m ? m[0] : null;
}

/**
 * Etagenangabe -> {etage, etagenGesamt} (je Zahl oder null).
 * „EG“/„Erdgeschoss“ -> 0; „1. OG“ -> 1; „DG“ nur mit Zahl („2. DG“); „3 von 3“ -> 3/3.
 * Nicht eindeutig („DG“, „Hochparterre“, „Souterrain“) -> null.
 */
export function normalisiereEtage(v) {
  const leer = { etage: null, etagenGesamt: null };
  if (typeof v === 'number') return Number.isInteger(v) ? { etage: v, etagenGesamt: null } : leer;
  const t = text(v);
  if (t === null) return leer;
  const s = t.toLowerCase().replace(/\s+/g, ' ');
  const von = s.match(/(\d{1,2})\s*(?:\.?\s*(?:og|etage|stock|geschoss|geschoß))?\s*(?:von|\/)\s*(\d{1,2})/);
  if (von) return { etage: Number(von[1]), etagenGesamt: Number(von[2]) };
  if (/^(eg|erdgeschoss|erdgeschoß|parterre)$/.test(s)) return { etage: 0, etagenGesamt: null };
  const m = s.match(/^(?:etage\s*)?(\d{1,2})\s*\.?\s*(?:og|obergeschoss|obergeschoß|etage|stock|stockwerk|dg|dachgeschoss|dachgeschoß)?$/);
  if (m) return { etage: Number(m[1]), etagenGesamt: null };
  return leer;
}

/** „1927/1999“ -> {baujahr:1927, modernisierung:1999}; „1900“ -> {baujahr:1900, modernisierung:null}. */
export function parseBaujahr(v) {
  const leer = { baujahr: null, modernisierung: null };
  if (typeof v === 'number') return Number.isInteger(v) ? { baujahr: v, modernisierung: null } : leer;
  const t = text(v);
  if (t === null) return leer;
  const jahre = t.match(/(?<!\d)(1[5-9]\d\d|20\d\d)(?!\d)/g) || [];
  return { baujahr: jahre[0] ? Number(jahre[0]) : null, modernisierung: jahre[1] ? Number(jahre[1]) : null };
}

function wahrheit(v) {
  if (typeof v === 'boolean') return v;
  const t = text(v);
  if (t === null) return null;
  if (/^(ja|j|y|yes|true|1|vermietet)$/i.test(t)) return true;
  if (/^(nein|n|no|false|0)$/i.test(t)) return false;
  return null;
}

function ausweistyp(v) {
  const t = text(v);
  if (t === null) return null;
  if (/verbrauch/i.test(t)) return 'verbrauch';
  if (/bedarf/i.test(t)) return 'bedarf';
  return null;
}

function energieklasse(v) {
  const t = text(v);
  if (t === null) return null;
  const k = t.toUpperCase();
  return /^(A\+|[A-H])$/.test(k) ? k : null;
}

function datum(v) {
  const t = text(v);
  if (t === null) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function uuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
    else if (i === 14) s += '4';
    else if (i === 19) s += h[8 + Math.floor(Math.random() * 4)];
    else s += h[Math.floor(Math.random() * 16)];
  }
  return s;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{16}$/;

function leereEckdaten() {
  const e = {};
  for (const k of SKALARE) e[k] = null;
  e.energie = {};
  for (const k of ENERGIE) e.energie[k] = null;
  return e;
}

function normalisiereEckdaten(raw) {
  const r = istObj(raw) ? raw : {};
  const e = leereEckdaten();
  e.kaufpreis = zahl(r.kaufpreis);
  e.wohnflaeche = zahl(r.wohnflaeche);
  e.istKaltmiete = zahl(r.istKaltmiete);
  e.vermietet = wahrheit(r.vermietet);
  const va = text(r.vertragsart);
  e.vertragsart = va === null ? null : va.toLowerCase();
  e.zimmer = normalisiereZimmer(r.zimmer);
  const et = normalisiereEtage(r.etage);
  e.etage = et.etage;
  e.etagenGesamt = et.etagenGesamt;
  const eg = ganzzahl(r.etagenGesamt);
  if (eg !== null) e.etagenGesamt = eg;
  const bj = parseBaujahr(r.baujahr);
  e.baujahr = bj.baujahr;
  e.baujahrModernisierung = bj.modernisierung;
  const bm = ganzzahl(r.baujahrModernisierung);
  if (bm !== null) e.baujahrModernisierung = bm;
  e.hausgeld = zahl(r.hausgeld);
  e.plz = normalisierePlz(r.plz);
  e.ort = text(r.ort);
  e.strasse = text(r.strasse);
  const hn = text(r.hausnummer);
  e.hausnummer = hn;
  const en = istObj(r.energie) ? r.energie : {};
  e.energie.ausweistyp = ausweistyp(en.ausweistyp);
  e.energie.kennwertKwh = zahl(en.kennwertKwh);
  e.energie.klasse = energieklasse(en.klasse);
  e.energie.energietraeger = text(en.energietraeger);
  e.energie.baujahrHeizung = ganzzahl(en.baujahrHeizung);
  return e;
}

function normalisiereQuelle(q) {
  const r = istObj(q) ? q : {};
  const verlauf = (Array.isArray(r.preisverlauf) ? r.preisverlauf : [])
    .map((p) => (istObj(p) ? { datum: datum(p.datum), preis: zahl(p.preis) } : null))
    .filter((p) => p && p.datum !== null && p.preis !== null);
  return {
    portal: text(r.portal) ? text(r.portal).toLowerCase() : null,
    inseratId: text(r.inseratId),
    url: text(r.url),
    titel: text(r.titel),
    anbieter: text(r.anbieter),
    erstmalsGesehen: datum(r.erstmalsGesehen),
    onlineSeit: datum(r.onlineSeit),
    preisverlauf: verlauf,
  };
}

function normalisiereBewertung(b) {
  if (!istObj(b)) return null;
  const werkzeug = text(b.werkzeug);
  if (werkzeug === null) return null;
  const out = {
    werkzeug,
    version: text(b.version),
    datum: datum(b.datum),
    kernzahlen: istObj(b.kernzahlen) ? { ...b.kernzahlen } : {},
  };
  if (text(b.ampel) !== null) out.ampel = text(b.ampel).toLowerCase();
  return out;
}

function normalisiereKonflikt(k) {
  return istObj(k) && text(k.feld) ? { feld: text(k.feld), a: k.a ?? null, b: k.b ?? null } : null;
}

function leereAkte() {
  const jetzt = new Date().toISOString();
  return {
    version: AKTE_VERSION,
    id: uuid(),
    erstellt: jetzt,
    geaendert: jetzt,
    quellen: [],
    eckdaten: leereEckdaten(),
    eckdatenHerkunft: {},
    merkmale: { bildHashes: [], beschreibungShingles: null },
    bewertungen: [],
    status: { stufe: 'gescannt', grund: null },
    konflikte: [],
  };
}

/** Bringt beliebige Eingaben in die Akte-Form v1. Wirft nie; Unbrauchbares wird null/leer. */
export function normalisiereAkte(obj) {
  try {
    const r = istObj(obj) ? obj : {};
    const akte = leereAkte();
    if (typeof r.id === 'string' && UUID_RE.test(r.id.trim())) akte.id = r.id.trim().toLowerCase();
    const erst = text(r.erstellt);
    if (erst) akte.erstellt = erst;
    const gen = text(r.geaendert);
    if (gen) akte.geaendert = gen;
    akte.quellen = (Array.isArray(r.quellen) ? r.quellen : []).map(normalisiereQuelle).filter((q) => q.portal !== null);
    akte.eckdaten = normalisiereEckdaten(r.eckdaten);
    if (istObj(r.eckdatenHerkunft)) {
      for (const [k, v] of Object.entries(r.eckdatenHerkunft)) if (text(v) !== null) akte.eckdatenHerkunft[k] = text(v);
    }
    const m = istObj(r.merkmale) ? r.merkmale : {};
    akte.merkmale.bildHashes = [...new Set((Array.isArray(m.bildHashes) ? m.bildHashes : [])
      .map((h) => (typeof h === 'string' ? h.trim().toLowerCase() : ''))
      .filter((h) => HASH_RE.test(h)))];
    akte.merkmale.beschreibungShingles = Array.isArray(m.beschreibungShingles)
      ? [...new Set(m.beschreibungShingles.filter((s) => typeof s === 'string' && s))]
      : null;
    akte.bewertungen = (Array.isArray(r.bewertungen) ? r.bewertungen : []).map(normalisiereBewertung).filter(Boolean);
    const st = istObj(r.status) ? r.status : {};
    const stufe = text(st.stufe) ? text(st.stufe).toLowerCase() : null;
    akte.status = { stufe: STUFEN.includes(stufe) ? stufe : 'gescannt', grund: text(st.grund) };
    akte.konflikte = (Array.isArray(r.konflikte) ? r.konflikte : []).map(normalisiereKonflikt).filter(Boolean);
    return akte;
  } catch {
    return leereAkte();
  }
}

/** Neue Akte aus Teilen {quellen, eckdaten, eckdatenHerkunft, merkmale, bewertungen, status}. */
export function neueAkte(teile) {
  return normalisiereAkte(istObj(teile) ? teile : {});
}

// ---------------------------------------------------------------- Prüfung (streng, ohne Korrektur)

/** Prüft eine Akte ohne sie zu verändern. -> {ok, fehler[]} (Texte mit Feldpfad). */
export function pruefeAkte(obj) {
  const fehler = [];
  const f = (pfad, msg) => fehler.push(`${pfad}: ${msg}`);
  if (!istObj(obj)) return { ok: false, fehler: ['Akte ist kein Objekt'] };

  if (obj.version !== AKTE_VERSION) f('version', `muss ${AKTE_VERSION} sein`);
  if (typeof obj.id !== 'string' || !UUID_RE.test(obj.id)) f('id', 'fehlt oder ist keine UUID');
  for (const k of ['erstellt', 'geaendert']) {
    if (typeof obj[k] !== 'string' || obj[k] === '' || Number.isNaN(Date.parse(obj[k]))) f(k, 'fehlt oder ist kein Zeitstempel');
  }

  const istDatum = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v));
  const optText = (pfad, v) => { if (v !== null && v !== undefined && typeof v !== 'string') f(pfad, 'muss Text oder null sein'); };
  const optDatum = (pfad, v) => { if (v !== null && v !== undefined && !istDatum(v)) f(pfad, 'muss Datum JJJJ-MM-TT oder null sein'); };
  const optZahl = (pfad, v, { min, ganz, grenze } = {}) => {
    if (v === null || v === undefined) return;
    if (typeof v !== 'number' || !Number.isFinite(v)) return f(pfad, 'muss Zahl oder null sein');
    if (ganz && !Number.isInteger(v)) return f(pfad, 'muss ganzzahlig sein');
    if (min !== undefined && (grenze === 'oberhalb' ? v <= min : v < min)) f(pfad, `muss ${grenze === 'oberhalb' ? '>' : '>='} ${min} sein`);
  };

  if (!Array.isArray(obj.quellen)) f('quellen', 'muss Liste sein');
  else {
    obj.quellen.forEach((q, i) => {
      const p = `quellen[${i}]`;
      if (!istObj(q)) return f(p, 'muss Objekt sein');
      if (typeof q.portal !== 'string' || q.portal === '') f(`${p}.portal`, 'fehlt');
      for (const k of ['inseratId', 'url', 'titel', 'anbieter']) optText(`${p}.${k}`, q[k]);
      optDatum(`${p}.erstmalsGesehen`, q.erstmalsGesehen);
      optDatum(`${p}.onlineSeit`, q.onlineSeit);
      if (q.preisverlauf !== undefined && !Array.isArray(q.preisverlauf)) f(`${p}.preisverlauf`, 'muss Liste sein');
      else (q.preisverlauf || []).forEach((pv, j) => {
        if (!istObj(pv) || !istDatum(pv.datum)) f(`${p}.preisverlauf[${j}].datum`, 'ungültig');
        if (!istObj(pv) || typeof pv.preis !== 'number' || !(pv.preis >= 0)) f(`${p}.preisverlauf[${j}].preis`, 'muss Zahl >= 0 sein');
      });
    });
  }

  if (!istObj(obj.eckdaten)) f('eckdaten', 'muss Objekt sein');
  else {
    const e = obj.eckdaten;
    optZahl('eckdaten.kaufpreis', e.kaufpreis, { min: 0 });
    optZahl('eckdaten.wohnflaeche', e.wohnflaeche, { min: 0, grenze: 'oberhalb' });
    optZahl('eckdaten.istKaltmiete', e.istKaltmiete, { min: 0 });
    if (e.vermietet !== null && e.vermietet !== undefined && typeof e.vermietet !== 'boolean') f('eckdaten.vermietet', 'muss true/false/null sein');
    optText('eckdaten.vertragsart', e.vertragsart);
    optZahl('eckdaten.zimmer', e.zimmer, { min: 0, grenze: 'oberhalb' });
    optZahl('eckdaten.etage', e.etage, { ganz: true, min: 0 });
    optZahl('eckdaten.etagenGesamt', e.etagenGesamt, { ganz: true, min: 1 });
    optZahl('eckdaten.baujahr', e.baujahr, { ganz: true, min: 1500 });
    optZahl('eckdaten.baujahrModernisierung', e.baujahrModernisierung, { ganz: true, min: 1500 });
    optZahl('eckdaten.hausgeld', e.hausgeld, { min: 0 });
    if (e.plz !== null && e.plz !== undefined && !(typeof e.plz === 'string' && /^\d{5}$/.test(e.plz))) f('eckdaten.plz', 'muss 5-stelliger Text sein');
    for (const k of ['ort', 'strasse', 'hausnummer']) optText(`eckdaten.${k}`, e[k]);
    if (e.energie !== undefined && !istObj(e.energie)) f('eckdaten.energie', 'muss Objekt sein');
    else if (e.energie) {
      const en = e.energie;
      if (en.ausweistyp != null && !['verbrauch', 'bedarf'].includes(en.ausweistyp)) f('eckdaten.energie.ausweistyp', "muss 'verbrauch', 'bedarf' oder null sein");
      optZahl('eckdaten.energie.kennwertKwh', en.kennwertKwh, { min: 0 });
      if (en.klasse != null && !(typeof en.klasse === 'string' && /^(A\+|[A-H])$/.test(en.klasse))) f('eckdaten.energie.klasse', 'muss A+ bis H sein');
      optText('eckdaten.energie.energietraeger', en.energietraeger);
      optZahl('eckdaten.energie.baujahrHeizung', en.baujahrHeizung, { ganz: true, min: 1500 });
    }
  }

  if (obj.eckdatenHerkunft !== undefined) {
    if (!istObj(obj.eckdatenHerkunft)) f('eckdatenHerkunft', 'muss Objekt sein');
    else for (const [k, v] of Object.entries(obj.eckdatenHerkunft)) if (typeof v !== 'string') f(`eckdatenHerkunft.${k}`, 'muss Text sein');
  }

  if (!istObj(obj.merkmale)) f('merkmale', 'muss Objekt sein');
  else {
    const m = obj.merkmale;
    if (!Array.isArray(m.bildHashes)) f('merkmale.bildHashes', 'muss Liste sein');
    else m.bildHashes.forEach((h, i) => { if (typeof h !== 'string' || !HASH_RE.test(h)) f(`merkmale.bildHashes[${i}]`, 'muss 16 Hex-Zeichen (64 Bit) sein'); });
    if (m.beschreibungShingles != null && !(Array.isArray(m.beschreibungShingles) && m.beschreibungShingles.every((s) => typeof s === 'string'))) {
      f('merkmale.beschreibungShingles', 'muss Liste von Texten oder null sein');
    }
  }

  if (!Array.isArray(obj.bewertungen)) f('bewertungen', 'muss Liste sein');
  else obj.bewertungen.forEach((b, i) => {
    const p = `bewertungen[${i}]`;
    if (!istObj(b)) return f(p, 'muss Objekt sein');
    if (typeof b.werkzeug !== 'string' || b.werkzeug === '') f(`${p}.werkzeug`, 'fehlt');
    if (b.version === undefined || b.version === null || b.version === '') f(`${p}.version`, 'fehlt');
    if (!istDatum(b.datum)) f(`${p}.datum`, 'fehlt oder ungültig');
    if (!istObj(b.kernzahlen)) f(`${p}.kernzahlen`, 'muss Objekt sein');
    if (b.ampel !== undefined && b.ampel !== null && typeof b.ampel !== 'string') f(`${p}.ampel`, 'muss Text sein');
  });

  if (!istObj(obj.status)) f('status', 'muss Objekt sein');
  else {
    if (!STUFEN.includes(obj.status.stufe)) f('status.stufe', `muss eine von ${STUFEN.join(', ')} sein`);
    optText('status.grund', obj.status.grund);
  }

  if (obj.konflikte !== undefined) {
    if (!Array.isArray(obj.konflikte)) f('konflikte', 'muss Liste sein');
    else obj.konflikte.forEach((k, i) => { if (!istObj(k) || typeof k.feld !== 'string') f(`konflikte[${i}].feld`, 'fehlt'); });
  }

  return { ok: fehler.length === 0, fehler };
}

// ---------------------------------------------------------------- Bild-Hash und Text-Fingerabdruck

/**
 * Differenz-Hash (dHash) aus 9x8 Grauwerten (zeilenweise: 8 Zeilen à 9 Spalten, 72 Werte).
 * Bit = linker Pixel heller als rechter Nachbar; Reihenfolge zeilenweise, höchstes Bit zuerst.
 * -> 16 Hex-Zeichen (64 Bit).
 */
export function dHash64(grau) {
  if (!grau || typeof grau.length !== 'number' || grau.length !== 72) throw new TypeError('dHash64: 72 Grauwerte (9x8) erwartet');
  let hex = '';
  let nib = 0;
  for (let i = 0; i < 64; i++) {
    const r = Math.floor(i / 8);
    const c = i % 8;
    const bit = grau[r * 9 + c] > grau[r * 9 + c + 1] ? 1 : 0;
    nib = (nib << 1) | bit;
    if (i % 4 === 3) { hex += nib.toString(16); nib = 0; }
  }
  return hex;
}

const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/** Hamming-Abstand zweier Hex-Hashes; Infinity bei ungültiger Eingabe oder ungleicher Länge. */
export function hamming(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || a.length === 0) return Infinity;
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}

/** 5-Wort-Shingles: klein, ohne Satzzeichen. Weniger als 5 Wörter -> ein Shingle aus allen. -> Array (eindeutig). */
export function textFingerprint(t) {
  const woerter = String(t ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (woerter.length === 0) return [];
  if (woerter.length < 5) return [woerter.join(' ')];
  const out = new Set();
  for (let i = 0; i + 5 <= woerter.length; i++) out.add(woerter.slice(i, i + 5).join(' '));
  return [...out];
}

/** Jaccard-Ähnlichkeit zweier Mengen/Listen (0..1); zwei leere -> 0. */
export function jaccard(a, b) {
  const A = new Set(a || []);
  const B = new Set(b || []);
  if (A.size === 0 && B.size === 0) return 0;
  let gemeinsam = 0;
  for (const x of A) if (B.has(x)) gemeinsam++;
  return gemeinsam / (A.size + B.size - gemeinsam);
}

// ---------------------------------------------------------------- Vergleich

/** Straße normalisiert: klein, ß=ss, „straße/strasse/str.“ -> „str“, nur Buchstaben/Ziffern. */
export function normalisiereStrasse(s) {
  const t = text(s);
  if (t === null) return null;
  const n = t.toLowerCase().replace(/ß/g, 'ss').replace(/stra(?:ss)e/g, 'str').replace(/str\./g, 'str').replace(/[^\p{L}\p{N}]/gu, '');
  return n === '' ? null : n;
}

function normalisiereHausnummer(s) {
  const t = text(s);
  if (t === null) return null;
  const n = t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return n === '' ? null : n;
}

const bekannt = (v) => v !== null && v !== undefined;

function baujahre(e) {
  return [e.baujahr, e.baujahrModernisierung].filter(bekannt);
}

/** Vergleicht zwei Akten. -> {urteil, punkte, gruende:[{merkmal, a, b, wirkung}]} (Regel siehe Dateikopf). */
export function vergleiche(akteA, akteB) {
  const A = normalisiereAkte(akteA);
  const B = normalisiereAkte(akteB);
  const a = A.eckdaten;
  const b = B.eckdaten;
  const gruende = [];

  // 0. gleiches Inserat
  for (const qa of A.quellen) {
    for (const qb of B.quellen) {
      if (qa.inseratId !== null && qa.portal === qb.portal && qa.inseratId === qb.inseratId) {
        gruende.push({ merkmal: 'inserat', a: `${qa.portal}:${qa.inseratId}`, b: `${qb.portal}:${qb.inseratId}`, wirkung: 'gleiches Inserat' });
        return { urteil: 'gleich', punkte: 100, gruende };
      }
    }
  }

  // 1. Widerspruch
  const wid = (merkmal, va, vb) => gruende.push({ merkmal, a: va, b: vb, wirkung: 'widerspruch' });
  if (bekannt(a.zimmer) && bekannt(b.zimmer) && a.zimmer !== b.zimmer) wid('zimmer', a.zimmer, b.zimmer);
  if (bekannt(a.etage) && bekannt(b.etage) && a.etage !== b.etage) wid('etage', a.etage, b.etage);
  if (bekannt(a.wohnflaeche) && bekannt(b.wohnflaeche) && Math.abs(a.wohnflaeche - b.wohnflaeche) > 2) wid('wohnflaeche', a.wohnflaeche, b.wohnflaeche);
  if (bekannt(a.plz) && bekannt(b.plz) && a.plz !== b.plz) wid('plz', a.plz, b.plz);
  const ja = baujahre(a);
  const jb = baujahre(b);
  if (ja.length && jb.length && !ja.some((x) => jb.includes(x))) wid('baujahr', ja.join('/'), jb.join('/'));
  const ka = a.energie.kennwertKwh;
  const kb = b.energie.kennwertKwh;
  if (bekannt(ka) && bekannt(kb) && Math.abs(ka - kb) > 3) wid('energieKennwert', ka, kb);
  if (gruende.length) return { urteil: 'verschieden', punkte: 0, gruende };

  // 2. Punkte
  let punkte = 0;
  const plus = (merkmal, va, vb, p) => { punkte += p; gruende.push({ merkmal, a: va, b: vb, wirkung: `+${p}` }); };

  let bestes = Infinity;
  let bestesPaar = null;
  for (const ha of A.merkmale.bildHashes) {
    for (const hb of B.merkmale.bildHashes) {
      const d = hamming(ha, hb);
      if (d < bestes) { bestes = d; bestesPaar = [ha, hb]; }
    }
  }
  if (bestes <= 6) plus('bild', bestesPaar[0], bestesPaar[1], 100);

  const klA = a.energie.klasse;
  const klB = b.energie.klasse;
  let ausweisTreffer = false;
  if (bekannt(ka) && bekannt(kb) && Math.abs(ka - kb) <= 1 && (!bekannt(klA) || !bekannt(klB) || klA === klB)) {
    ausweisTreffer = true;
    plus('energieausweis', `${ka} kWh ${klA ?? ''}`.trim(), `${kb} kWh ${klB ?? ''}`.trim(), 100);
  }

  const sa = normalisiereStrasse(a.strasse);
  const sb = normalisiereStrasse(b.strasse);
  const na = normalisiereHausnummer(a.hausnummer);
  const nb = normalisiereHausnummer(b.hausnummer);
  if (sa && sb && na && nb && sa === sb && na === nb) plus('strasse+hausnummer', `${a.strasse} ${a.hausnummer}`, `${b.strasse} ${b.hausnummer}`, 40);

  const flaeche = bekannt(a.wohnflaeche) && bekannt(b.wohnflaeche) && Math.abs(a.wohnflaeche - b.wohnflaeche) <= 1;
  if (flaeche) plus('wohnflaeche', a.wohnflaeche, b.wohnflaeche, 25);
  const zimmer = bekannt(a.zimmer) && bekannt(b.zimmer) && a.zimmer === b.zimmer;
  if (zimmer) plus('zimmer', a.zimmer, b.zimmer, 15);
  const etage = bekannt(a.etage) && bekannt(b.etage) && a.etage === b.etage;
  if (etage) plus('etage', a.etage, b.etage, 15);
  const plz = bekannt(a.plz) && bekannt(b.plz) && a.plz === b.plz;
  if (plz) plus('plz', a.plz, b.plz, 10);

  let weitere = 0;
  const mittel = (treffer, merkmal, va, vb) => { if (treffer) { weitere++; plus(merkmal, va, vb, 10); } };
  mittel(ja.length > 0 && jb.length > 0 && ja.some((x) => jb.includes(x)), 'baujahr', ja.join('/'), jb.join('/'));
  mittel(bekannt(a.hausgeld) && bekannt(b.hausgeld) && Math.abs(a.hausgeld - b.hausgeld) <= 5, 'hausgeld', a.hausgeld, b.hausgeld);
  mittel(bekannt(a.istKaltmiete) && bekannt(b.istKaltmiete) && Math.abs(a.istKaltmiete - b.istKaltmiete) <= 5, 'istKaltmiete', a.istKaltmiete, b.istKaltmiete);
  // Energieklasse zählt nur ohne Ausweis-Treffer (sonst doppelt gewertet)
  const klasseGleich = bekannt(klA) && bekannt(klB) && klA === klB;
  if (klasseGleich && !ausweisTreffer) mittel(true, 'energieklasse', klA, klB);
  else if (klasseGleich) weitere++;

  const sha = A.merkmale.beschreibungShingles;
  const shb = B.merkmale.beschreibungShingles;
  if (sha && shb) {
    const j = jaccard(sha, shb);
    if (j >= 0.5) plus('beschreibung', `jaccard ${j.toFixed(2)}`, '', 10);
  }

  // 3. Urteil
  const kombination = flaeche && zimmer && plz && weitere >= 2;
  if (punkte >= 100 || kombination) {
    if (punkte < 100) gruende.push({ merkmal: 'kombination', a: 'Fläche+Zimmer+PLZ+' + weitere + ' weitere', b: '', wirkung: 'gleich' });
    return { urteil: 'gleich', punkte, gruende };
  }
  return { urteil: punkte >= 40 ? 'unsicher' : 'verschieden', punkte, gruende };
}

// ---------------------------------------------------------------- Zusammenführen

const frueher = (x, y) => {
  if (x === null) return y;
  if (y === null) return x;
  return x <= y ? x : y;
};

function mischeQuelle(x, y) {
  const verlauf = new Map();
  for (const p of [...x.preisverlauf, ...y.preisverlauf]) verlauf.set(`${p.datum}|${p.preis}`, p);
  return {
    portal: x.portal,
    inseratId: x.inseratId ?? y.inseratId,
    url: x.url ?? y.url,
    titel: x.titel ?? y.titel,
    anbieter: x.anbieter ?? y.anbieter,
    erstmalsGesehen: frueher(x.erstmalsGesehen, y.erstmalsGesehen),
    onlineSeit: frueher(x.onlineSeit, y.onlineSeit),
    preisverlauf: [...verlauf.values()].sort((p, q) => (p.datum < q.datum ? -1 : p.datum > q.datum ? 1 : 0)),
  };
}

const gleichWert = (x, y) => (typeof x === 'string' && typeof y === 'string'
  ? x.trim().toLowerCase() === y.trim().toLowerCase() : x === y);

/**
 * Führt zwei bestätigte Dubletten zu einer Akte zusammen (A hat Vorrang, B füllt Lücken).
 * Quellen: eindeutig nach portal+inseratId (ohne ID: portal+url), Daten und Preisverläufe vereinigt.
 * Eckdaten: A-Wert bleibt, fehlender Wert aus B (samt Herkunft); abweichende Werte -> konflikte[] {feld, a, b}.
 * Bewertungen und Preisverlauf vereinigt; frühestes onlineSeit/erstmalsGesehen. Status und id von A.
 */
export function fuehreZusammen(akteA, akteB) {
  const A = normalisiereAkte(akteA);
  const B = normalisiereAkte(akteB);
  const out = normalisiereAkte(A);

  const quellen = new Map();
  for (const q of [...A.quellen, ...B.quellen]) {
    const key = `${q.portal}|${q.inseratId ?? 'url:' + (q.url ?? '')}`;
    quellen.set(key, quellen.has(key) ? mischeQuelle(quellen.get(key), q) : q);
  }
  out.quellen = [...quellen.values()];

  const konflikte = [...A.konflikte];
  const gesehen = new Set(konflikte.map((k) => `${k.feld}|${JSON.stringify(k.a)}|${JSON.stringify(k.b)}`));
  const nimm = (feld, va, vb, setze) => {
    if (!bekannt(vb)) return;
    if (!bekannt(va)) {
      setze(vb);
      const h = B.eckdatenHerkunft[feld];
      if (h) out.eckdatenHerkunft[feld] = h;
    } else if (!gleichWert(va, vb)) {
      const k = { feld, a: va, b: vb };
      const key = `${feld}|${JSON.stringify(va)}|${JSON.stringify(vb)}`;
      if (!gesehen.has(key)) { gesehen.add(key); konflikte.push(k); }
    }
  };
  for (const k of SKALARE) nimm(k, A.eckdaten[k], B.eckdaten[k], (v) => { out.eckdaten[k] = v; });
  for (const k of ENERGIE) nimm(`energie.${k}`, A.eckdaten.energie[k], B.eckdaten.energie[k], (v) => { out.eckdaten.energie[k] = v; });
  out.konflikte = konflikte;

  out.merkmale.bildHashes = [...new Set([...A.merkmale.bildHashes, ...B.merkmale.bildHashes])];
  out.merkmale.beschreibungShingles = A.merkmale.beschreibungShingles || B.merkmale.beschreibungShingles
    ? [...new Set([...(A.merkmale.beschreibungShingles || []), ...(B.merkmale.beschreibungShingles || [])])]
    : null;

  const bew = new Map();
  for (const x of [...A.bewertungen, ...B.bewertungen]) bew.set(`${x.werkzeug}|${x.version}|${x.datum}`, x);
  out.bewertungen = [...bew.values()];

  out.erstellt = frueher(A.erstellt, B.erstellt);
  out.geaendert = new Date().toISOString();
  return out;
}

/** Frühestes onlineSeit über alle Quellen einer Akte (JJJJ-MM-TT) oder null. */
export function fruehestesOnlineSeit(akte) {
  return normalisiereAkte(akte).quellen.reduce((m, q) => frueher(m, q.onlineSeit), null);
}
