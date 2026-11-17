// Exposé einlesen: Zahlen aus dem Text eines Exposés per Suchmuster finden (ohne KI, ohne Netz).
// Reine Logik ohne DOM. js/ui/quickie.js zeigt die Ergebnisse, js/ui/pdfreader.js liest das PDF.
// Suchmuster und Zahlenlogik stammen aus dem Original „Deal-Schnellcheck Dresden“.

const ALLE_FEHLEND = Object.freeze(['Kaufpreis', 'Wohnfläche', 'Ist-Kaltmiete']);
const MIN_TEXT = 20;
const MIN_LESBAR = 200;

const isPos = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
const fmt = (n, d) => n.toLocaleString('de-DE', { maximumFractionDigits: d });

/** Deutsche Zahl („170.000“, „1.234,56“, „60,5“) als Zahl. Keine Zahl: null. */
export function deNum(s) {
  if (s === null || s === undefined) return null;
  let t = String(s).replace(/[^\d.,]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Suchmuster im Text. Ergebnis: kaufpreis, wohnflaeche (Zahlen), ist_kaltmiete_monat oder ist_kaltmiete_jahr,
 * vertragsart ('staffel' | 'index'), belege (Fundstellen als Zitat), hinweise (Liste). Nicht gefunden: Feld fehlt.
 */
export function regexExtract(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ');
  const out = { belege: {}, hinweise: [] };

  let m = t.match(/Kaufpreis[^0-9]{0,30}([\d.]+(?:,\d+)?)/i);
  if (m) {
    out.kaufpreis = deNum(m[1]);
    out.belege.kaufpreis = m[0];
  }

  m = t.match(/Wohnfl(?:ä|ae)che[^0-9]{0,30}([\d.]+(?:,\d+)?)/i);
  if (m) {
    out.wohnflaeche = deNum(m[1]);
    out.belege.wohnflaeche = m[0];
  }

  m = t.match(/(Ist-?\s?Miete|Netto-?kaltmiete|Kaltmiete|Mieteinnahmen|Jahresnettokaltmiete)[^0-9]{0,40}([\d.]+(?:,\d+)?)\s*(?:€|EUR|Euro)?[^.;\d]{0,25}/i);
  if (m) {
    const v = deNum(m[2]);
    const ctx = t.slice(m.index, m.index + m[0].length + 25);
    if (/p\.\s?a\.|jährl|pro Jahr|im Jahr|\/\s?Jahr|Jahres/i.test(ctx)) out.ist_kaltmiete_jahr = v;
    else out.ist_kaltmiete_monat = v;
    out.belege.miete = m[0];
  }

  if (/Staffelmiete/i.test(t)) out.vertragsart = 'staffel';
  else if (/Indexmiete/i.test(t)) out.vertragsart = 'index';
  return out;
}

/**
 * Anzeige für die Oberfläche aus dem Ergebnis von regexExtract.
 * Rückgabe: werte {miete (€/Monat), flaeche (m²), angebot (€)} je Zahl oder null (nur Werte > 0),
 * rows [{label, wert, zitat}] für gefundene Werte, notes (Vertragsart und Hinweise), fehlt (Liste),
 * status {text, art: 'ok' | 'err'}.
 */
export function presentExtract(res, quelle) {
  const r = res ?? {};
  const kp = isPos(r.kaufpreis) ? r.kaufpreis : null;
  const A = isPos(r.wohnflaeche) ? r.wohnflaeche : null;
  const monat = r.ist_kaltmiete_monat ?? null;
  const jahr = r.ist_kaltmiete_jahr ?? null;
  const rawMiete = monat ?? (jahr !== null ? jahr / 12 : null);
  const miete = isPos(rawMiete) ? rawMiete : null;
  const nurJahr = monat === null && jahr !== null;

  const belege = r.belege ?? {};
  const rows = [];
  if (kp !== null) rows.push({ label: 'Kaufpreis', wert: `${fmt(kp, 0)} €`, zitat: belege.kaufpreis ?? '' });
  if (A !== null) rows.push({ label: 'Wohnfläche', wert: `${fmt(A, 2)} m²`, zitat: belege.wohnflaeche ?? '' });
  if (miete !== null) {
    rows.push({
      label: 'Ist-Kaltmiete',
      wert: `${fmt(miete, 2)} €/Monat${nurJahr ? ' (Jahreswert ÷ 12)' : ''}`,
      zitat: belege.miete ?? '',
    });
  }

  const notes = [];
  if (r.vertragsart === 'staffel') {
    notes.push('Staffelmiete erwähnt: Mieterhöhung nach Mietspiegel nicht möglich. Vermutlich No-Deal.');
  } else if (r.vertragsart === 'index') {
    notes.push('Indexmiete erwähnt: Mieterhöhung nach Mietspiegel nicht möglich. Vermutlich No-Deal.');
  }
  notes.push(...(r.hinweise ?? []));

  const fehlt = [];
  if (kp === null) fehlt.push('Kaufpreis');
  if (A === null) fehlt.push('Wohnfläche');
  if (miete === null) fehlt.push('Ist-Kaltmiete');

  const status = fehlt.length > 0
    ? { text: `${quelle}: ${fehlt.join(', ')} nicht gefunden. Bitte ergänzen (gelb markiert) oder Text einfügen.`, art: 'err' }
    : { text: `${quelle}: alle drei Werte übernommen. Bitte kurz mit dem Exposé abgleichen.`, art: 'ok' };

  return {
    werte: { miete, flaeche: A, angebot: kp },
    rows,
    notes,
    fehlt,
    status,
  };
}

/** Ergebnis ohne auswertbaren Text: keine Werte, alle Felder fehlen. */
function ohneWerte(text) {
  return { werte: null, rows: [], notes: [], fehlt: [...ALLE_FEHLEND], status: { text, art: 'err' } };
}

/** Eingefügter Text (Quelle „Text (Suchmuster)“). Zu wenig Text: keine Werte. */
export function analysiereText(text, quelle = 'Text (Suchmuster)') {
  const s = String(text ?? '');
  if (s.trim().length < MIN_TEXT) return ohneWerte('Zu wenig Text gefunden.');
  return presentExtract(regexExtract(s), quelle);
}

/** Text aus einem PDF (Quelle „PDF (Suchmuster)“). Weniger als 200 Nicht-Leerzeichen: eingescanntes PDF. */
export function analysierePdfText(text, quelle = 'PDF (Suchmuster)') {
  const s = String(text ?? '');
  if (s.replace(/\s/g, '').length < MIN_LESBAR) {
    return ohneWerte('Dieses PDF enthält keinen lesbaren Text (eingescannt). Bitte Werte von Hand eintragen oder den Exposé-Text einfügen.');
  }
  return presentExtract(regexExtract(s), quelle);
}
