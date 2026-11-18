// Objekt-Akte aus einer Kalkulation (Etappe 3): Eckdaten, Quelle (aus dem Akte-Bezug) und die QuickCalc-Bewertung.
// Das Akte-Format kommt aus akquise/addon/src/akte.js. Rein: kein DOM, kein Speicher. Es wird nicht neu gerechnet:
// alle Kernzahlen stammen aus compute() von calc.js.
import { neueAkte } from '../akquise/addon/src/akte.js';
import { compute } from './calc.js';
import { normalizeCalculation } from './model.js';

export const WERKZEUG = 'QuickCalc';
export const WERKZEUG_VERSION = '2.0';

const pad = (n) => String(n).padStart(2, '0');
const rund = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

/** Datum 'JJJJ-MM-TT' in Ortszeit. */
export function isoDate(now = new Date()) {
  const d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Dateiname '<Titel>.akte.json' ohne Zeichen, die Dateisysteme nicht mögen. */
export function akteFileName(title) {
  const base = String(title ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return `${base || 'Kalkulation'}.akte.json`;
}

/** Adresse „Straße Nr, PLZ Ort“ (wie MietQuickie sie schreibt) in Teile zerlegen; was nicht passt, bleibt null. */
function parseAddress(address) {
  const out = { strasse: null, hausnummer: null, plz: null, ort: null };
  const parts = String(address ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  const plzIdx = parts.findIndex((p) => /^\d{5}\s+\S/.test(p));
  if (plzIdx >= 0) {
    const m = parts[plzIdx].match(/^(\d{5})\s+(.+)$/);
    out.plz = m[1];
    out.ort = m[2];
  } else if (parts.length === 1) {
    const m = parts[0].match(/^(\d{5})\s+(.+)$/);
    if (m) { out.plz = m[1]; out.ort = m[2]; }
  }
  const street = parts.find((p, i) => i !== plzIdx && /\D/.test(p));
  if (street && plzIdx >= 0) {
    const m = street.match(/^(.*\D)\s+(\d+\s?[a-zA-Z]?(?:\s?[-/]\s?\d+\s?[a-zA-Z]?)?)$/);
    if (m) { out.strasse = m[1].trim(); out.hausnummer = m[2].trim(); } else out.strasse = street;
  }
  return out;
}

/** Bewertung { werkzeug, version, datum, ampel?, kernzahlen } aus compute(); nichts wird neu gerechnet. */
export function buildAssessment(calc, now = new Date()) {
  const c = normalizeCalculation(calc);
  const r = compute(c.kind, c.inputs);
  const kernzahlen = {
    maxPurchasePrice: rund(r.maxPurchasePrice),
    salePrice: rund(r.salePrice),
    limit: r.limit ?? null,
  };
  let ampel = r.isPurchasePossible ? r.ampel : 'rot';
  if (r.offer) {
    kernzahlen.offerPrice = rund(r.offer.purchasePrice);
    kernzahlen.offerMarginPercent = rund(r.offer.marginPercent);
    kernzahlen.offerProfit = rund(r.offer.profit);
    ampel = r.offer.ampel;
  }
  const out = { werkzeug: WERKZEUG, version: WERKZEUG_VERSION, datum: isoDate(now), kernzahlen };
  if (typeof ampel === 'string') out.ampel = ampel;
  return out;
}

/** Akte aus der Kalkulation. Mit akte.id (Akte-Bezug) dieselbe id, damit das Dashboard zusammenführt. */
export function buildAkte(calc, now = new Date()) {
  const c = normalizeCalculation(calc);
  const i = c.inputs;
  const adr = parseAddress(c.address);
  const herkunft = {};
  const from = (key, value) => { if (value !== null && value !== undefined) herkunft[key] = 'QuickCalc'; };
  const eckdaten = {
    kaufpreis: typeof i.offerPrice === 'number' && i.offerPrice > 0 ? i.offerPrice : null,
    wohnflaeche: typeof i.livingArea === 'number' && i.livingArea > 0 ? i.livingArea : null,
    istKaltmiete: c.kind === 'vermietet' && typeof i.rent === 'number' && i.rent > 0 ? i.rent : null,
    vermietet: c.kind === 'vermietet',
    plz: adr.plz,
    ort: adr.ort,
    strasse: adr.strasse,
    hausnummer: adr.hausnummer,
  };
  for (const [k, v] of Object.entries(eckdaten)) from(k, v);

  const quellen = [];
  if (c.akte && c.akte.portal) {
    quellen.push({
      portal: c.akte.portal,
      inseratId: c.akte.inseratId,
      url: c.akte.url,
      titel: c.akte.titel ?? (c.name || null),
    });
  }
  const teile = { quellen, eckdaten, eckdatenHerkunft: herkunft, bewertungen: [buildAssessment(c, now)] };
  if (c.akte) teile.id = c.akte.id;
  return neueAkte(teile);
}
