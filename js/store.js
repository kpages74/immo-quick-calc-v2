// Speicherung der aktuellen Sitzung im Browser-Speicher. Einziges Modul mit Speicherzugriff (localStorage).
// Keine Funktion wirft: Fehler (z. B. Safari-Privatmodus, Speicher voll, Node ohne localStorage) werden abgefangen.
import { newSession, normalizeSession } from './session.js';
import { cleanDefaults } from './defaults.js';
import { cleanLibrary } from './library.js';
import { cleanPriceList } from './pricelist.js';

export const STORAGE_KEY = 'iqc2_current';
export const DEFAULTS_KEY = 'iqc2_defaults';
export const OBJECTS_KEY = 'iqc2_objects';
export const PRICELIST_KEY = 'iqc2_pricelist';

/** Standard-Speicher: globalThis.localStorage, falls vorhanden. Schon der Zugriff kann werfen. */
function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** storage undefined → Standard-Speicher; null oder fehlend → kein Speicher. */
function resolveStorage(storage) {
  return storage === undefined ? defaultStorage() : storage;
}

/** Liest die gespeicherte Sitzung. Fehlt sie, ist das JSON kaputt oder schlägt der Zugriff fehl: newSession(). */
export function loadSession(storage) {
  try {
    const s = resolveStorage(storage);
    if (!s) return newSession();
    const raw = s.getItem(STORAGE_KEY);
    if (typeof raw !== 'string') return newSession();
    return normalizeSession(JSON.parse(raw));
  } catch {
    return newSession();
  }
}

/** Speichert die (normalisierte) Sitzung. true bei Erfolg, sonst false. */
export function saveSession(storage, session) {
  try {
    const s = resolveStorage(storage);
    if (!s) return false;
    s.setItem(STORAGE_KEY, JSON.stringify(normalizeSession(session)));
    return true;
  } catch {
    return false;
  }
}

/** Entfernt die gespeicherte Sitzung. true bei Erfolg, sonst false. */
export function clearSession(storage) {
  try {
    const s = resolveStorage(storage);
    if (!s) return false;
    s.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Liest die eigenen Standardwerte, gesäubert. Fehler: {}. */
export function loadDefaults(storage) {
  try {
    const s = resolveStorage(storage);
    if (!s) return {};
    const raw = s.getItem(DEFAULTS_KEY);
    if (typeof raw !== 'string') return {};
    return cleanDefaults(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** Speichert die eigenen Standardwerte (gesäubert). true bei Erfolg, sonst false. */
export function saveDefaults(storage, overrides) {
  try {
    const s = resolveStorage(storage);
    if (!s) return false;
    s.setItem(DEFAULTS_KEY, JSON.stringify(cleanDefaults(overrides)));
    return true;
  } catch {
    return false;
  }
}

/** Liest die gespeicherten Objekte, gesäubert. Fehler: []. */
export function loadObjects(storage) {
  try {
    const s = resolveStorage(storage);
    if (!s) return [];
    const raw = s.getItem(OBJECTS_KEY);
    if (typeof raw !== 'string') return [];
    return cleanLibrary(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Speichert die Liste der Objekte (gesäubert). true bei Erfolg, sonst false. */
export function saveObjects(storage, list) {
  try {
    const s = resolveStorage(storage);
    if (!s) return false;
    s.setItem(OBJECTS_KEY, JSON.stringify(cleanLibrary(list)));
    return true;
  } catch {
    return false;
  }
}

/** Liest die gespeicherte Preisliste, gesäubert. Fehler: leere Liste. */
export function loadPriceList(storage) {
  try {
    const s = resolveStorage(storage);
    if (!s) return cleanPriceList(null);
    const raw = s.getItem(PRICELIST_KEY);
    if (typeof raw !== 'string') return cleanPriceList(null);
    return cleanPriceList(JSON.parse(raw));
  } catch {
    return cleanPriceList(null);
  }
}

/** Speichert die Preisliste (gesäubert). true bei Erfolg, sonst false. */
export function savePriceList(storage, data) {
  try {
    const s = resolveStorage(storage);
    if (!s) return false;
    s.setItem(PRICELIST_KEY, JSON.stringify(cleanPriceList(data)));
    return true;
  } catch {
    return false;
  }
}

/** Entfernt die gespeicherte Preisliste. true bei Erfolg, sonst false. */
export function clearPriceList(storage) {
  try {
    const s = resolveStorage(storage);
    if (!s) return false;
    s.removeItem(PRICELIST_KEY);
    return true;
  } catch {
    return false;
  }
}
