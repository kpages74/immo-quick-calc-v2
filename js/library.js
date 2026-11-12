// Gespeicherte Objekte (Etappe 4): Liste von Kalkulationen. Rein: kein DOM, kein Speicher.
// Alle Funktionen geben neue Listen zurück, verändern die Eingabe nicht und werfen nicht.
import { normalizeCalculation, cloneCalculation, defaultInputs } from './model.js';

export const MAX_OBJECTS = 2000;

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const listOf = (list) => (Array.isArray(list) ? list : []);

/** Säubert eine Liste: normalisierte Kalkulationen, doppelte ids nur einmal (erster bleibt), höchstens 2000. */
export function cleanLibrary(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (out.length >= MAX_OBJECTS) break;
    if (!isPlainObject(item)) continue;
    const calc = normalizeCalculation(item);
    if (seen.has(calc.id)) continue;
    seen.add(calc.id);
    out.push(calc);
  }
  return out;
}

/** Ersetzt die Kalkulation mit gleicher id an ihrer Position, sonst wird sie vorn eingefügt. */
export function upsertObject(list, calc) {
  const items = listOf(list);
  const next = normalizeCalculation(calc);
  const index = items.findIndex((c) => c?.id === next.id);
  if (index === -1) return [next, ...items];
  return items.map((c, i) => (i === index ? next : c));
}

/** Liste ohne die Kalkulation mit dieser id. */
export function removeObject(list, id) {
  return listOf(list).filter((c) => c?.id !== id);
}

/** Kopie einer Kalkulation (cloneCalculation), vorn eingefügt. Unbekannte id: unveränderte Liste und copy null. */
export function duplicateObject(list, id) {
  const items = listOf(list);
  const source = items.find((c) => c?.id === id);
  if (!source) return { list: [...items], copy: null };
  const copy = cloneCalculation(source);
  return { list: [copy, ...items], copy };
}

/** Kalkulation mit dieser id oder null. */
export function findObject(list, id) {
  return listOf(list).find((c) => c?.id === id) ?? null;
}

/**
 * Kalkulation ist frisch: Name, Adresse, Notiz und Preisangabe leer, alle Eingaben gleich den Standardwerten.
 * Die Zeitstempel spielen keine Rolle.
 */
function isFresh(calc) {
  if (calc.name !== '' || calc.address !== '' || calc.note !== '') return false;
  if (calc.priceSource.source !== '' || calc.priceSource.date !== '') return false;
  const defaults = defaultInputs(calc.kind);
  return Object.keys(defaults).every((key) => calc.inputs[key] === defaults[key]);
}

/**
 * Speicherzustand der aktuellen Kalkulation gegenüber der Liste.
 * 'unberuehrt': nicht in der Liste und frisch (siehe isFresh).
 * 'neu': nicht in der Liste und nicht frisch. 'gespeichert': in der Liste, gleicher Stand (modified).
 * 'geaendert': in der Liste, anderer Stand (modified). Wirft nicht.
 */
export function saveState(list, calc) {
  const current = normalizeCalculation(calc);
  const saved = findObject(list, current.id);
  if (saved === null) return isFresh(current) ? 'unberuehrt' : 'neu';
  return normalizeCalculation(saved).modified === current.modified ? 'gespeichert' : 'geaendert';
}

/**
 * Suche nach Name oder Adresse (ohne Groß/Klein, Text getrimmt). Leere Suche: alle.
 * Ergebnis nach modified absteigend sortiert.
 */
export function searchObjects(list, query) {
  const items = listOf(list).filter((c) => isPlainObject(c));
  const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
  const hits = q === ''
    ? items.slice()
    : items.filter((c) => String(c.name ?? '').toLowerCase().includes(q)
      || String(c.address ?? '').toLowerCase().includes(q));
  return hits.sort((a, b) => (Date.parse(b.modified) || 0) - (Date.parse(a.modified) || 0));
}
