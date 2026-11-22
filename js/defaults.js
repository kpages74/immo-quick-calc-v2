// Eigene Standardwerte je Nutzungsart (Etappe 4). Rein: kein DOM, kein Speicher.
// Form: { [art]: { [feld]: wert } }. Gespeichert wird nur, was vom Werksstandard abweicht.
import { fieldsFor, factoryDefaultFor, clampField } from './fields.js';
import { RULE_MARGIN, parkingMode } from './calc.js';
import { KINDS } from './model.js';

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Gesäuberter Wert eines Feldes oder undefined. offerPrice wird vorher ausgeschlossen. */
function cleanValue(field, value) {
  if (field.unit === 'bool') return typeof value === 'boolean' ? value : undefined;
  if (field.unit === 'choice') return field.options.some((o) => o.value === value) ? value : undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return clampField(field.key, value);
}

/**
 * Säubert beliebige Standardwerte: nur gültige Arten und Felder der Art, offerPrice nie, Typen geprüft,
 * Zahlen begrenzt. Werte gleich dem Werksstandard fallen weg, leere Arten ebenso. Margenregel: ohne
 * aufgeweichte Marge wird targetMargin unter RULE_MARGIN auf RULE_MARGIN gesetzt. Wirft nie, ändert die Eingabe nicht.
 */
export function cleanDefaults(raw) {
  try {
    const out = {};
    const src = isPlainObject(raw) ? raw : {};
    for (const kind of KINDS) {
      if (!Object.hasOwn(src, kind) || !isPlainObject(src[kind])) continue;
      const entries = src[kind];
      const clean = {};
      for (const field of fieldsFor(kind)) {
        // Stellplatzmiete: gespeicherter alter Schalter parkingRentSeparate wird zum Modus (Migration).
        if (field.key === 'parkingRentMode') {
          clean[field.key] = parkingMode(entries);
          continue;
        }
        if (field.key === 'offerPrice' || !Object.hasOwn(entries, field.key)) continue;
        const value = cleanValue(field, entries[field.key]);
        if (value !== undefined) clean[field.key] = value;
      }
      const softened = Object.hasOwn(clean, 'softened') ? clean.softened : factoryDefaultFor('softened', kind);
      const margin = Object.hasOwn(clean, 'targetMargin') ? clean.targetMargin : factoryDefaultFor('targetMargin', kind);
      if (softened !== true && margin < RULE_MARGIN) clean.targetMargin = RULE_MARGIN;
      for (const key of Object.keys(clean)) {
        if (clean[key] === factoryDefaultFor(key, kind)) delete clean[key];
      }
      if (Object.keys(clean).length > 0) out[kind] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Neue gesäuberte Überschreibungen: die Einträge der Art kind werden durch die Werte aus inputs ersetzt,
 * andere Arten bleiben. Felder, die in inputs fehlen, fallen auf den Werksstandard zurück.
 * Ungültige Art → cleanDefaults(overrides).
 */
export function defaultsFromInputs(overrides, kind, inputs) {
  if (!KINDS.includes(kind)) return cleanDefaults(overrides);
  const next = { ...cleanDefaults(overrides) };
  const src = isPlainObject(inputs) ? inputs : {};
  const entries = {};
  for (const field of fieldsFor(kind)) {
    if (field.key !== 'offerPrice' && Object.hasOwn(src, field.key)) entries[field.key] = src[field.key];
  }
  next[kind] = entries;
  return cleanDefaults(next);
}

/** Gesäuberte Überschreibungen ohne die Einträge der Art kind. Neues Objekt. */
export function clearDefaults(overrides, kind) {
  const out = cleanDefaults(overrides);
  if (Object.hasOwn(out, kind)) delete out[kind];
  return out;
}
