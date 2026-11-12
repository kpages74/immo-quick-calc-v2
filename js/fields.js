// Feld-Spezifikation der Eingaben (Etappe 2). Einzige Quelle für Bereiche, Schritte, Standardwerte und Arten.
// Keine DOM-Zugriffe. Prozentwerte werden als Prozentzahl gespeichert (20 = 20 %).

const ALL_KINDS = ['vermietet', 'kap', 'en', 'wg'];

// Standardwert je Art: Objekt { art: wert, all: rückfall } oder ein einzelner Wert für alle Arten.
const RAW_FIELDS = [
  { key: 'livingArea', label: 'Wohnfläche', unit: 'squareMeter', group: 'objekt', kinds: ALL_KINDS, min: 0, max: 600, step: 1, digits: 0, default: { all: 60, wg: 90 } },
  { key: 'rooms', label: 'Anzahl WG-Zimmer', unit: 'rooms', group: 'objekt', kinds: ['wg'], min: 1, max: 10, step: 1, digits: 0, default: 3 },
  { key: 'rent', label: 'Ist-Miete p. M.', unit: 'euro', group: 'ertrag', kinds: ['vermietet'], min: 0, max: 3000, step: 10, digits: 0, default: 600 },
  { key: 'rentSurchargePercent', label: 'Soll-Miete (Aufschlag)', unit: 'percent', group: 'ertrag', kinds: ['vermietet'], min: 0, max: 50, step: 0.5, digits: 1, signed: true, default: 15 },
  { key: 'rentPerSqm', label: 'Miete je m² p. M.', unit: 'euroPerSqm', group: 'ertrag', kinds: ['kap'], min: 0, max: 50, step: 0.1, digits: 2, default: 12 },
  { key: 'roomRent', label: 'Durchschn. Kaltmiete je Zimmer', unit: 'euro', group: 'ertrag', kinds: ['wg'], min: 0, max: 1500, step: 10, digits: 0, default: 500 },
  { key: 'parkingCount', label: 'Anzahl Stellplätze', unit: 'pieces', group: 'ertrag', kinds: ['wg'], min: 0, max: 10, step: 1, digits: 0, default: 0 },
  { key: 'parkingRent', label: 'Miete Stellplatz/Garage p. M.', unit: 'euro', group: 'ertrag', kinds: ['vermietet', 'kap', 'wg'], min: 0, max: 300, step: 5, digits: 0, default: { all: 0, wg: 50 } },
  { key: 'minYield', label: 'Mindestrendite Käufer', unit: 'percent', group: 'ertrag', kinds: ['vermietet', 'kap', 'wg'], min: 0, max: 15, step: 0.1, digits: 1, default: { all: 4.5, wg: 6.5 } },
  { key: 'maxSalePricePerSqm', label: 'Max. Verkaufspreis je m²', help: 'Der m²-Deckel ist der höchste Verkaufspreis je m², der in dieser Lage am Markt erzielbar ist, zum Beispiel laut Preisatlas oder eigener Preisliste. Der Verkaufspreis ist immer der kleinere Wert aus Rendite-Grenze (Jahresmiete ÷ Mindestrendite des Käufers) und m²-Deckel. Steht hier 0, ist kein Deckel gesetzt: Dann zählt nur die Rendite-Grenze, und der errechnete Verkaufspreis kann über dem Marktpreis liegen.', unit: 'euroPerSqm', group: 'ertrag', kinds: ALL_KINDS, min: 0, max: 15000, step: 10, digits: 0, default: 0 },
  { key: 'parkingSalePrice', label: 'Verkaufspreis Stellplatz/Garage', unit: 'euro', group: 'ertrag', kinds: ALL_KINDS, min: 0, max: 40000, step: 500, digits: 0, default: 0 },
  { key: 'renovationCosts', label: 'Sanierungskosten', unit: 'euro', group: 'kosten', kinds: ALL_KINDS, min: 0, max: 200000, step: 500, digits: 0, default: 20000 },
  { key: 'renovationBufferPercent', label: 'Sicherheitszuschlag Sanierung', unit: 'percent', group: 'kosten', kinds: ALL_KINDS, min: 0, max: 50, step: 1, digits: 0, default: 0 },
  { key: 'otherCosts', label: 'Sonstige Kosten', unit: 'euro', group: 'kosten', kinds: ALL_KINDS, min: 0, max: 100000, step: 100, digits: 0, default: 0 },
  { key: 'brokerPercent', label: 'Makler', unit: 'percent', group: 'kosten', kinds: ALL_KINDS, min: 0, max: 10, step: 0.01, digits: 2, default: 3.57 },
  { key: 'transferTaxPercent', label: 'Grunderwerbsteuer', unit: 'percent', group: 'kosten', kinds: ALL_KINDS, min: 0, max: 10, step: 0.1, digits: 2, default: 5.5 },
  { key: 'notaryPercent', label: 'Notar und Grundbuch', unit: 'percent', group: 'kosten', kinds: ALL_KINDS, min: 0, max: 5, step: 0.01, digits: 2, default: 1.5 },
  { key: 'salesCommissionPercent', label: 'Vertriebskosten', unit: 'percent', group: 'kosten', kinds: ALL_KINDS, min: 0, max: 20, step: 0.5, digits: 1, default: 0 },
  { key: 'targetMargin', label: 'Zielmarge', unit: 'percent', group: 'marge', kinds: ALL_KINDS, min: 0, max: 100, step: 0.5, digits: 1, default: 20 },
  { key: 'softened', label: 'Marge aufweichen', unit: 'bool', group: 'marge', kinds: ALL_KINDS, min: 0, max: 1, step: 1, digits: 0, default: false },
  { key: 'marginFloor', label: 'Untergrenze Marge', unit: 'percent', group: 'marge', kinds: ALL_KINDS, min: 0, max: 20, step: 0.5, digits: 1, default: 17.5 },
  { key: 'minProfit', label: 'Mindestgewinn', unit: 'euro', group: 'marge', kinds: ALL_KINDS, min: 0, max: 200000, step: 1000, digits: 0, default: 20000 },
  { key: 'durationMonths', label: 'Projektlaufzeit', unit: 'months', group: 'projekt', kinds: ALL_KINDS, min: 1, max: 60, step: 1, digits: 0, default: 6 },
  { key: 'loanPercent', label: 'Finanzierungshöhe', unit: 'percent', group: 'projekt', kinds: ALL_KINDS, min: 0, max: 200, step: 1, digits: 0, default: 100 },
  { key: 'interestPercent', label: 'Zinsen', unit: 'percent', group: 'projekt', kinds: ALL_KINDS, min: 0, max: 15, step: 0.1, digits: 1, default: 5.5 },
  { key: 'processingFeePercent', label: 'Bearbeitungsgebühr', unit: 'percent', group: 'projekt', kinds: ALL_KINDS, min: 0, max: 5, step: 0.1, digits: 1, default: 1 },
  { key: 'hausgeld', label: 'Hausgeld p. M.', unit: 'euro', group: 'projekt', kinds: ALL_KINDS, min: 0, max: 2000, step: 10, digits: 0, default: 300 },
  { key: 'heatingCosts', label: 'Strom + Heizung p. M.', unit: 'euro', group: 'projekt', kinds: ALL_KINDS, min: 0, max: 1000, step: 10, digits: 0, default: 0 },
  { key: 'scenarioPercent', label: 'Szenario-Abweichung', help: 'Die Szenarien zeigen, wie stark sich das Ergebnis ändert, wenn Miete oder Sanierungskosten anders ausfallen als angenommen. Die Szenario-Abweichung ist der Prozentwert, um den beide Größen jeweils nach unten und nach oben verändert werden (Standard 10 %). Die Tabelle zeigt je Fall den neuen max. Einkaufspreis und den Unterschied zum Ausgangswert. Im Modus „Angebot prüfen“ zeigt sie stattdessen Marge und Gewinn beim Angebotspreis.', unit: 'percent', group: 'szenarien', kinds: ALL_KINDS, min: 1, max: 50, step: 1, digits: 0, default: 10 },
  { key: 'offerPrice', label: 'Angebotspreis', unit: 'euro', group: 'pruefung', kinds: ALL_KINDS, min: 0, max: 5000000, step: 1000, digits: 0, default: null },
];

/** Alle Felder als eingefrorene Liste (Reihenfolge wie in der Oberfläche). */
export const FIELD_LIST = Object.freeze(RAW_FIELDS.map((f) => Object.freeze({
  ...f,
  kinds: Object.freeze([...f.kinds]),
  default: f.default !== null && typeof f.default === 'object' ? Object.freeze({ ...f.default }) : f.default,
})));

/** Felder als eingefrorenes Objekt: Schlüssel → Spezifikation. */
export const FIELDS = Object.freeze(Object.fromEntries(FIELD_LIST.map((f) => [f.key, f])));

/** Gruppen der Eingaben in Anzeige-Reihenfolge. Nur „projekt“ startet eingeklappt. */
export const GROUPS = Object.freeze([
  Object.freeze({ key: 'objekt', title: 'Objekt', collapsed: false }),
  Object.freeze({ key: 'ertrag', title: 'Ertrag und Verkauf', collapsed: false }),
  Object.freeze({ key: 'kosten', title: 'Kosten', collapsed: false }),
  Object.freeze({ key: 'marge', title: 'Marge', collapsed: false }),
  Object.freeze({ key: 'projekt', title: 'Projekt', collapsed: true }),
  Object.freeze({ key: 'szenarien', title: 'Szenarien', collapsed: false }),
  Object.freeze({ key: 'pruefung', title: 'Angebot prüfen', collapsed: false }),
]);

/** Felder, die für eine Kalkulationsart gelten. Unbekannte Art → leere Liste. */
export function fieldsFor(kind) {
  return FIELD_LIST.filter((f) => f.kinds.includes(kind));
}

/** Eigene Standardwerte je Art: { [art]: { [feld]: wert } }. Anfangs leer. */
let overrides = {};

/** Werksstandard eines Feldes für eine Art. Objekt-Standard: Eintrag der Art, sonst all. Unbekanntes Feld wirft. */
export function factoryDefaultFor(key, kind) {
  const field = FIELDS[key];
  if (!field) throw new Error(`Unbekanntes Feld: ${key}`);
  const d = field.default;
  if (d !== null && typeof d === 'object') {
    return Object.hasOwn(d, kind) ? d[kind] : d.all;
  }
  return d;
}

/** Kopie der Überschreibungen: nur Objekt-Einträge je Art werden übernommen. */
function copyOverrides(src) {
  const out = {};
  for (const kind of Object.keys(src)) {
    const entries = src[kind];
    if (entries !== null && typeof entries === 'object' && !Array.isArray(entries)) out[kind] = { ...entries };
  }
  return out;
}

/** Übernimmt eigene Standardwerte (bereits gesäubert, siehe defaults.js). Kein Objekt → keine Überschreibungen. */
export function setDefaultOverrides(obj) {
  overrides = obj !== null && typeof obj === 'object' && !Array.isArray(obj) ? copyOverrides(obj) : {};
}

/** Kopie der aktuell gesetzten eigenen Standardwerte. */
export function getDefaultOverrides() {
  return copyOverrides(overrides);
}

/** Standardwert eines Feldes für eine Art: eigene Überschreibung, falls vorhanden, sonst Werksstandard. Unbekanntes Feld wirft. */
export function defaultFor(key, kind) {
  if (!FIELDS[key]) throw new Error(`Unbekanntes Feld: ${key}`);
  if (Object.hasOwn(overrides, kind) && Object.hasOwn(overrides[kind], key)) return overrides[kind][key];
  return factoryDefaultFor(key, kind);
}

/** Begrenzt einen Wert auf den Bereich des Feldes (z. B. Zielmarge 0…100). */
export function clampField(key, value) {
  const f = FIELDS[key];
  return Math.min(Math.max(value, f.min), f.max);
}

/** Position des Reglers 0…1, Werte außerhalb des Bereichs stehen am Anschlag. */
export function sliderFraction(key, value) {
  const f = FIELDS[key];
  const span = f.max - f.min;
  if (span <= 0) return 0;
  return Math.min(Math.max((value - f.min) / span, 0), 1);
}
