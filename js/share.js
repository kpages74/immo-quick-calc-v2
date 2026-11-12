// Link teilen (Etappe 4): Kalkulation als base64url-Token im URL-Hash (#k=…). Rein: kein DOM, kein Speicher.
// Nutzt TextEncoder/TextDecoder, btoa/atob. Alle Funktionen werfen nicht (decodeShare liefert null).
import { normalizeCalculation } from './model.js';

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

/** Token der Kalkulation (normalisiert) mit Modus. Ungültiger Modus: 'max'. */
export function encodeShare(calc, mode) {
  const c = normalizeCalculation(calc);
  const payload = {
    v: VERSION,
    kind: c.kind,
    mode: MODES.includes(mode) ? mode : 'max',
    name: c.name,
    address: c.address,
    note: c.note,
    priceSource: c.priceSource,
    inputs: c.inputs,
  };
  return toBase64Url(JSON.stringify(payload));
}

/** Adresse ohne Hash und Abfrage plus „#k=“ und Token. */
export function shareUrl(baseUrl, calc, mode) {
  const base = String(baseUrl ?? '').split('#')[0].split('?')[0];
  return `${base}#k=${encodeShare(calc, mode)}`;
}

/**
 * Liest eine geteilte Kalkulation aus Hash oder Adresse. { calc, mode } oder null, wenn das Token fehlt,
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
    });
    return { calc, mode: MODES.includes(data.mode) ? data.mode : 'max' };
  } catch {
    return null;
  }
}
