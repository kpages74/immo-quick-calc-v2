// Sicherungsdatei (JSON) mit gespeicherten Objekten, eigenen Standardwerten und Preisliste (Etappe 4).
// Rein: kein DOM, kein Speicher. Alle Funktionen werfen nicht.
import { cleanLibrary } from './library.js';
import { cleanDefaults } from './defaults.js';
import { cleanPriceList } from './pricelist.js';

export const BACKUP_APP = 'immo-quick-calc-2';
const BACKUP_SCHEMA = 1;
const MAX_CHARS = 5000000;

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const pad = (n) => String(n).padStart(2, '0');
const validDate = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date());

/** Sicherungsobjekt aus Objekten, Standardwerten und Preisliste, alles gesäubert. */
export function buildBackup(data, now = new Date()) {
  const src = isPlainObject(data) ? data : {};
  return {
    app: BACKUP_APP,
    schema: BACKUP_SCHEMA,
    exported: validDate(now).toISOString(),
    objects: cleanLibrary(src.objects),
    defaults: cleanDefaults(src.defaults),
    pricelist: cleanPriceList(src.pricelist),
  };
}

/** Liest den Text einer Sicherung. { ok: true, objects, defaults, pricelist } oder { ok: false, error }. */
export function parseBackup(text) {
  const fail = (error) => ({ ok: false, error });
  try {
    if (typeof text !== 'string' || text.length === 0 || text.length > MAX_CHARS) {
      return fail('Die Datei ist leer oder zu groß.');
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return fail('Die Datei ist keine gültige Sicherung (kein JSON).');
    }
    if (!isPlainObject(data) || data.app !== BACKUP_APP) {
      return fail('Die Datei stammt nicht aus Immo Quick-Calc 2.0.');
    }
    return {
      ok: true,
      objects: cleanLibrary(data.objects),
      defaults: cleanDefaults(data.defaults),
      pricelist: cleanPriceList(data.pricelist),
    };
  } catch {
    return fail('Die Datei ist keine gültige Sicherung (kein JSON).');
  }
}

/**
 * Führt importierte Objekte in die bestehende Liste ein. Gleiche id: der importierte Eintrag ersetzt den
 * bestehenden an seiner Position (replaced). Neue Einträge kommen vorn in die Liste (added).
 */
export function mergeObjects(existing, imported) {
  const current = Array.isArray(existing) ? existing : [];
  const incoming = cleanLibrary(imported);
  const currentIds = new Set(current.map((c) => c?.id));
  const incomingById = new Map(incoming.map((c) => [c.id, c]));
  let replaced = 0;
  const kept = current.map((c) => {
    if (c && incomingById.has(c.id)) {
      replaced += 1;
      return incomingById.get(c.id);
    }
    return c;
  });
  const added = incoming.filter((c) => !currentIds.has(c.id));
  return { list: [...added, ...kept], added: added.length, replaced };
}

/** Dateiname der Sicherung mit Datum in Ortszeit: quick-calc-2-sicherung-JJJJ-MM-TT.json */
export function backupFileName(now = new Date()) {
  const d = validDate(now);
  return `quick-calc-2-sicherung-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}
