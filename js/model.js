// Datenmodell der Kalkulation (Etappe 2): Standardwerte, Anlegen, Normalisieren beim Import, Artwechsel.
// Keine DOM- oder localStorage-Zugriffe.
import { fieldsFor, defaultFor, clampField } from './fields.js';

export const SCHEMA_VERSION = 1;
export const KINDS = Object.freeze(['vermietet', 'kap', 'en', 'wg']);

const FALLBACK_KIND = 'kap';
const MAX_NAME = 200;
const MAX_NOTE = 2000;

/** Zufällige Kennung: crypto.randomUUID, falls vorhanden, sonst Zeitstempel mit Zufallsanteil. */
function newId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const nowIso = () => new Date().toISOString();
const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isIsoDate = (s) => typeof s === 'string' && s !== '' && !Number.isNaN(Date.parse(s));
const text = (x, max) => (typeof x === 'string' ? x.slice(0, max) : '');
const MAX_AKTE_TEXT = 500;

/**
 * Bezug zur Objekt-Akte (optional): { id, portal, inseratId, url, titel }. Ohne gültige id (Text) null.
 * Fehlende Teile sind null, url nur als http(s)-Adresse. Wirft nicht.
 */
export function cleanAkteRef(raw) {
  if (!isPlainObject(raw)) return null;
  const part = (x) => {
    const v = typeof x === 'number' && Number.isFinite(x) ? String(x) : text(x, MAX_AKTE_TEXT).trim();
    return v === '' ? null : v;
  };
  const id = part(raw.id);
  if (id === null) return null;
  const url = part(raw.url);
  return {
    id,
    portal: part(raw.portal),
    inseratId: part(raw.inseratId),
    url: url !== null && /^https?:\/\//i.test(url) ? url : null,
    titel: part(raw.titel),
  };
}

/** Eingaben einer Art mit Standardwerten: genau die Felder von fieldsFor(kind). */
export function defaultInputs(kind) {
  const out = {};
  for (const f of fieldsFor(kind)) out[f.key] = defaultFor(f.key, kind);
  return out;
}

/**
 * Neue Kalkulation. overrides: inputs (nur Felder der Art, über die Standardwerte gelegt),
 * name, address, note, priceSource, akte (Bezug zur Objekt-Akte, optional). Unbekannte Art wirft einen Fehler.
 */
export function createCalculation(kind, overrides = {}) {
  if (!KINDS.includes(kind)) throw new Error(`Unbekannte Art: ${kind}`);
  const opts = isPlainObject(overrides) ? overrides : {};
  const inputs = defaultInputs(kind);
  if (isPlainObject(opts.inputs)) {
    for (const f of fieldsFor(kind)) {
      if (Object.hasOwn(opts.inputs, f.key)) inputs[f.key] = opts.inputs[f.key];
    }
  }
  const now = nowIso();
  const ps = isPlainObject(opts.priceSource) ? opts.priceSource : {};
  const akte = cleanAkteRef(opts.akte);
  return {
    schema: SCHEMA_VERSION,
    id: newId(),
    created: now,
    modified: now,
    name: text(opts.name, MAX_NAME),
    address: text(opts.address, MAX_NAME),
    note: text(opts.note, MAX_NOTE),
    kind,
    priceSource: { source: text(ps.source, MAX_NAME), date: text(ps.date, MAX_NAME) },
    inputs,
    ...(akte ? { akte } : {}),
  };
}

/** Wert eines Eingabefeldes säubern: falscher Typ oder nicht endlich → Standard, Zahlen auf Bereich begrenzt. */
function normalizeValue(field, value, kind) {
  const fallback = defaultFor(field.key, kind);
  if (field.unit === 'bool') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
    return fallback;
  }
  if (field.key === 'offerPrice') {
    // Angebotspreis: nur Zahl > 0, sonst null (kein Angebot).
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return clampField(field.key, value);
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return clampField(field.key, value);
}

/** Der eigentliche Normalisierungsschritt, kann nicht werfen wenn normalizeCalculation ihn absichert. */
function normalizeUnsafe(raw) {
  const src = isPlainObject(raw) ? raw : {};
  const kind = KINDS.includes(src.kind) ? src.kind : FALLBACK_KIND;
  const rawInputs = isPlainObject(src.inputs) ? src.inputs : {};
  const inputs = {};
  for (const f of fieldsFor(kind)) {
    const value = Object.hasOwn(rawInputs, f.key) ? rawInputs[f.key] : undefined;
    inputs[f.key] = normalizeValue(f, value, kind);
  }
  const now = nowIso();
  const created = isIsoDate(src.created) ? src.created : now;
  const modified = isIsoDate(src.modified) ? src.modified : created;
  const id = typeof src.id === 'string' && src.id !== '' ? src.id : newId();
  const ps = isPlainObject(src.priceSource) ? src.priceSource : {};
  const akte = cleanAkteRef(src.akte);
  return {
    schema: SCHEMA_VERSION,
    id,
    created,
    modified,
    name: text(src.name, MAX_NAME),
    address: text(src.address, MAX_NAME),
    note: text(src.note, MAX_NOTE),
    kind,
    priceSource: { source: text(ps.source, MAX_NAME), date: text(ps.date, MAX_NAME) },
    inputs,
    ...(akte ? { akte } : {}),
  };
}

/**
 * Macht aus beliebigen (z. B. importierten) Daten eine gültige Kalkulation. Gibt immer ein neues Objekt
 * zurück, verändert die Eingabe nicht und wirft nicht.
 */
export function normalizeCalculation(raw) {
  try {
    return normalizeUnsafe(raw);
  } catch {
    return normalizeUnsafe({ kind: FALLBACK_KIND });
  }
}

/**
 * Normalisierte Kopie mit neuer id, created und modified = jetzt. Name = alter Name + nameSuffix, auf 200 Zeichen gekürzt.
 * Verändert die Eingabe nicht und wirft nicht.
 */
export function cloneCalculation(calc, nameSuffix = ' (Kopie)') {
  const base = normalizeCalculation(calc);
  const now = nowIso();
  const suffix = typeof nameSuffix === 'string' ? nameSuffix : '';
  return { ...base, id: newId(), created: now, modified: now, name: `${base.name}${suffix}`.slice(0, MAX_NAME) };
}

/**
 * Wechselt die Art. id, name, address, note, priceSource und created bleiben, modified wird auf jetzt gesetzt.
 * Gemeinsame Felder behalten ihren Wert, neue Felder bekommen den Standard der neuen Art.
 * carry (optional): zuletzt gesehene Werte, z. B. aus anderen Arten. Rangfolge für die neue Art:
 * Standardwert < carry (nur Felder der neuen Art, gesäubert wie beim Normalisieren) < bisherige Eingaben.
 * Unbekannte Art wirft einen Fehler.
 */
export function changeKind(calc, newKind, carry = {}) {
  if (!KINDS.includes(newKind)) throw new Error(`Unbekannte Art: ${newKind}`);
  const base = normalizeCalculation(calc);
  const inputs = defaultInputs(newKind);
  const source = isPlainObject(carry) ? carry : {};
  for (const f of fieldsFor(newKind)) {
    if (Object.hasOwn(source, f.key)) inputs[f.key] = normalizeValue(f, source[f.key], newKind);
  }
  for (const key of Object.keys(inputs)) {
    if (Object.hasOwn(base.inputs, key)) inputs[key] = base.inputs[key];
  }
  return { ...base, kind: newKind, inputs, modified: nowIso() };
}
