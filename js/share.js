// Link teilen (Etappe 4): Kalkulation als base64url-Token im URL-Hash (#k=…). Rein: kein DOM, kein Speicher.
// Nutzt TextEncoder/TextDecoder, btoa/atob. Alle Funktionen werfen nicht (decodeShare liefert null).
import { normalizeCalculation, cleanAkteRef } from './model.js';
import { FIELDS } from './fields.js';

const VERSION = 1;
const MAX_TOKEN = 12000;
const MODES = Object.freeze(['max', 'check']);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** UTF-8-Text als base64url ohne Auffüllzeichen. */
function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url zurück zu UTF-8-Text. Ungültige Zeichen oder Kodierung: Fehler (wird von decodeShare abgefangen). */
function fromBase64Url(token) {
  if (!TOKEN_PATTERN.test(token) || token.length % 4 === 1) throw new Error('kein base64url');
  const standard = token.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/**
 * Herkunft einer Übernahme aus einem anderen Werkzeug: { tool, version, datum, felder[] }.
 * felder = Schlüssel der tatsächlich übergebenen Eingaben (nur bekannte Feldschlüssel). Ohne tool: null.
 */
export function cleanUebernommen(raw) {
  if (!isPlainObject(raw)) return null;
  const t = (x, max) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
  const tool = t(raw.tool, 40);
  if (tool === '') return null;
  const felder = Array.isArray(raw.felder)
    ? [...new Set(raw.felder.filter((k) => typeof k === 'string' && Object.hasOwn(FIELDS, k)))].slice(0, 80)
    : [];
  return { tool, version: t(raw.version, 20), datum: t(raw.datum, 20), felder };
}

/**
 * Token der Kalkulation (normalisiert) mit Modus. Ungültiger Modus: 'max'. Der Bezug zur Objekt-Akte (akte) reist mit.
 * options.uebernommen ({ tool, version, datum, felder }): nur die genannten Eingaben werden übertragen, alle anderen
 * bleiben beim Öffnen beim Standard der Empfänger-App; die Herkunft steht im Token (für den Hinweis „Übernommen aus …“).
 */
export function encodeShare(calc, mode, options = {}) {
  const c = normalizeCalculation(calc);
  const von = cleanUebernommen(isPlainObject(options) ? options.uebernommen : null);
  let inputs = c.inputs;
  if (von !== null) inputs = Object.fromEntries(Object.entries(c.inputs).filter(([k]) => von.felder.includes(k)));
  const payload = {
    v: VERSION,
    kind: c.kind,
    mode: MODES.includes(mode) ? mode : 'max',
    name: c.name,
    address: c.address,
    note: c.note,
    priceSource: c.priceSource,
    inputs,
  };
  if (c.akte) payload.akte = c.akte;
  if (von !== null) payload.von = von;
  return toBase64Url(JSON.stringify(payload));
}

/** Adresse ohne Hash und Abfrage plus „#k=“ und Token. */
export function shareUrl(baseUrl, calc, mode, options = {}) {
  const base = String(baseUrl ?? '').split('#')[0].split('?')[0];
  return `${base}#k=${encodeShare(calc, mode, options)}`;
}

/**
 * Liest eine geteilte Kalkulation aus Hash oder Adresse. { calc, mode, uebernommen } (uebernommen = Herkunft oder null) oder null, wenn das Token fehlt,
 * zu lang (über 12000 Zeichen), kaputt oder von einer anderen Version ist. Die id wird neu vergeben.
 */
export function decodeShare(hashOrUrl) {
  try {
    if (typeof hashOrUrl !== 'string') return null;
    const hashIndex = hashOrUrl.indexOf('#');
    const part = hashIndex >= 0 ? hashOrUrl.slice(hashIndex + 1) : hashOrUrl;
    const match = part.match(/(?:^|[&?])k=([^&]*)/);
    if (!match) return null;
    const token = match[1];
    if (token === '' || token.length > MAX_TOKEN) return null;
    const data = JSON.parse(fromBase64Url(token));
    if (!isPlainObject(data) || data.v !== VERSION) return null;
    const calc = normalizeCalculation({
      kind: data.kind,
      name: data.name,
      address: data.address,
      note: data.note,
      priceSource: data.priceSource,
      inputs: data.inputs,
      akte: data.akte,
    });
    return { calc, mode: MODES.includes(data.mode) ? data.mode : 'max', uebernommen: cleanUebernommen(data.von) };
  } catch {
    return null;
  }
}
