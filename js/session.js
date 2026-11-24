// Sitzung der Oberfläche: { calc, carry, mode }. Rein, keine DOM- und keine Speicherzugriffe.
// calc = Kalkulation (model.js), carry = Feldschlüssel → zuletzt gesehener Wert über alle Arten,
// mode = 'max' (Maximaler Einkaufspreis) oder 'check' (Angebot prüfen).
// Alle Exporte geben eine NEUE Sitzung zurück, verändern die Eingabe nicht und werfen nicht.
import { KINDS, createCalculation, normalizeCalculation, changeKind } from './model.js';
import { FIELD_LIST, GROUPS, fieldsFor, defaultFor, clampField } from './fields.js';

const MODES = Object.freeze(['max', 'check']);
const DEFAULT_KIND = 'kap';
const TEXT_LIMITS = Object.freeze({ name: 200, address: 200, note: 2000 });
const PRICE_SOURCE_LIMIT = 200;

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const nowIso = () => new Date().toISOString();

/**
 * Wert eines Feldes säubern. Liefert undefined, wenn der Wert nicht passt (dann bleibt alles unverändert).
 * Bool-Felder: nur boolean. Auswahl-Felder (unit 'choice'): nur ein Wert aus options. offerPrice: null oder Zahl; ≤ 0 wird null. Sonst: endliche Zahl, auf Bereich begrenzt.
 */
function cleanValue(field, value) {
  if (field.unit === 'bool') return typeof value === 'boolean' ? value : undefined;
  if (field.unit === 'choice') return field.options.some((o) => o.value === value) ? value : undefined;
  if (field.key === 'offerPrice') {
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return value > 0 ? clampField(field.key, value) : null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return clampField(field.key, value);
}

/** Carry aus beliebigen Daten: nur bekannte Feldschlüssel mit gesäubertem Wert. */
function cleanCarry(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const field of FIELD_LIST) {
    if (!Object.hasOwn(raw, field.key)) continue;
    const value = cleanValue(field, raw[field.key]);
    if (value !== undefined) out[field.key] = value;
  }
  return out;
}

/** Neue Sitzung mit einer Kalkulation der Art. Unbekannte Art → kap. */
export function newSession(kind = DEFAULT_KIND) {
  const k = KINDS.includes(kind) ? kind : DEFAULT_KIND;
  return { calc: createCalculation(k), carry: {}, mode: 'max' };
}

/** Beliebige (z. B. gespeicherte) Daten → gültige Sitzung. Verändert die Eingabe nicht, wirft nicht. */
export function normalizeSession(raw) {
  try {
    const src = isPlainObject(raw) ? raw : {};
    return {
      calc: normalizeCalculation(src.calc),
      carry: cleanCarry(src.carry),
      mode: MODES.includes(src.mode) ? src.mode : 'max',
    };
  } catch {
    return newSession();
  }
}

/**
 * Setzt ein Feld der aktuellen Art. Unbekannter Schlüssel oder Feld einer fremden Art: unverändert.
 * Zahlen werden auf den Bereich begrenzt; nicht endliche Werte werden ignoriert.
 * Die Zielmarge wird unverändert übernommen (auch unter 20 %).
 */
export function setInput(session, key, value) {
  const base = normalizeSession(session);
  const field = fieldsFor(base.calc.kind).find((f) => f.key === key);
  if (!field) return base;
  const cleaned = cleanValue(field, value);
  if (cleaned === undefined) return base;

  const inputs = { ...base.calc.inputs, [key]: cleaned };
  const carry = { ...base.carry, [key]: cleaned };
  return { calc: { ...base.calc, inputs, modified: nowIso() }, carry, mode: base.mode };
}

/** Setzt name, address oder note (gekürzt wie in model.js). Anderer Schlüssel oder kein Text: unverändert. */
export function setText(session, key, value) {
  const base = normalizeSession(session);
  if (!Object.hasOwn(TEXT_LIMITS, key) || typeof value !== 'string') return base;
  return {
    ...base,
    calc: { ...base.calc, [key]: value.slice(0, TEXT_LIMITS[key]), modified: nowIso() },
  };
}

/**
 * Sitzung aus einer gespeicherten Kalkulation: carry leer, Modus 'check' bei Angebotspreis > 0, sonst 'max'.
 */
export function loadCalculation(calc) {
  const normalized = normalizeCalculation(calc);
  const offer = normalized.inputs.offerPrice;
  const mode = typeof offer === 'number' && offer > 0 ? 'check' : 'max';
  return { calc: normalized, carry: {}, mode };
}

/**
 * Setzt Quelle und Stand der Preisangabe (je auf 200 Zeichen gekürzt, kein Text: ''). Kein Objekt: unverändert.
 */
export function setPriceSource(session, priceSource) {
  const base = normalizeSession(session);
  if (!isPlainObject(priceSource)) return base;
  const text = (x) => (typeof x === 'string' ? x.slice(0, PRICE_SOURCE_LIMIT) : '');
  return {
    ...base,
    calc: {
      ...base.calc,
      priceSource: { source: text(priceSource.source), date: text(priceSource.date) },
      modified: nowIso(),
    },
  };
}

/** Setzt den Modus 'max' oder 'check'. Anderer Wert: unverändert. */
export function setMode(session, mode) {
  const base = normalizeSession(session);
  return MODES.includes(mode) ? { ...base, mode } : base;
}

/**
 * Wechselt die Art. Die bisherigen Eingaben werden vorher in carry übernommen, damit beim Zurückwechseln
 * Werte fremder Arten (z. B. Mietfelder über EN) wieder da sind. Unbekannte Art: unverändert.
 */
export function switchKind(session, kind) {
  const base = normalizeSession(session);
  if (!KINDS.includes(kind)) return base;
  const carry = { ...base.carry, ...base.calc.inputs };
  return { calc: changeKind(base.calc, kind, carry), carry, mode: base.mode };
}

/** Setzt alle Felder einer Gruppe der aktuellen Art auf Standardwerte (auch in carry). Unbekannte Gruppe: unverändert. */
export function resetGroup(session, groupKey) {
  const base = normalizeSession(session);
  if (!GROUPS.some((g) => g.key === groupKey)) return base;
  const kind = base.calc.kind;
  const inputs = { ...base.calc.inputs };
  const carry = { ...base.carry };
  for (const field of fieldsFor(kind).filter((f) => f.group === groupKey)) {
    const d = defaultFor(field.key, kind);
    inputs[field.key] = d;
    carry[field.key] = d;
  }
  return { calc: { ...base.calc, inputs, modified: nowIso() }, carry, mode: base.mode };
}

/** Neue Kalkulation mit derselben Art, carry leer, Modus 'max', Name, Adresse und Notiz leer. */
export function resetAll(session) {
  const base = normalizeSession(session);
  return { calc: createCalculation(base.calc.kind), carry: {}, mode: 'max' };
}

/** Eingaben für rechnerische Zwecke. Im Modus 'max' ist offerPrice null, damit kein Angebot gerechnet wird. */
export function effectiveInputs(session) {
  const base = normalizeSession(session);
  const inputs = { ...base.calc.inputs };
  if (base.mode === 'max') inputs.offerPrice = null;
  return inputs;
}
