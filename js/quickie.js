// Quickie: Deal-Schnellcheck für den Kauf einer vermieteten Wohnung. Reine Rechen- und Textlogik, ohne DOM.
// Formeln und Wortlaut stammen aus dem Original „Deal-Schnellcheck Dresden“.
// computeQuickie liefert Zahlen, presentQuickie liefert fertige Texte für js/ui/quickie.js.
import { Fmt } from './format.js';

/** Vorgaben-Standard. r (Rendite Käufer, %) und deckel (Max. €/m² Käufer) stehen bei den Eingaben, die übrigen unter „Vorgaben ändern“. */
export const QUICKIE_DEFAULTS = Object.freeze({ erh: 15, r: 4.5, deckel: 3200, nk: 11, halte: 0, marge: 20, z1: 15000, z2: 20000 });

/** Zustand beim allerersten Start (kein gespeicherter Zustand). */
export const QUICKIE_START = Object.freeze({ active: false, miete: 500, flaeche: 60, angebot: null });

const NB = ' ';
const DASH = '–';
const eur = (x) => Fmt.euro(x);
const cur2 = (x) => Fmt.currency(x);
const num = (x, digits) => Fmt.fieldNumber(x, digits);
const plain = (x) => Fmt.editingNumber(x);
const sqm = (x, digits) => `${num(x, digits)}${NB}€/m²`;
const pct = (x, digits) => `${num(x, digits)}${NB}%`;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isPos = (x) => isNum(x) && x > 0;

// Gültigkeit je Vorgabe. Ungültig oder leer: Standardwert.
const RULES = Object.freeze({
  erh: (n) => n >= 0,
  r: (n) => n > 0,
  deckel: (n) => n >= 0,
  nk: (n) => n >= 0,
  halte: (n) => n >= 0,
  marge: (n) => n >= 0,
  z1: (n) => n >= 0,
  z2: (n) => n >= 0,
});

/** Vorgaben säubern: jede Angabe muss eine gültige Zahl sein, sonst gilt der Standardwert. Ohne Angabe: alle Standardwerte. */
export function cleanVorgaben(raw) {
  const out = {};
  for (const key of Object.keys(QUICKIE_DEFAULTS)) {
    const value = raw !== null && typeof raw === 'object' ? raw[key] : undefined;
    out[key] = isNum(value) && RULES[key](value) ? value : QUICKIE_DEFAULTS[key];
  }
  return out;
}

/** Gespeicherten Zustand säubern: active als Wahrheitswert, Beträge als Zahl oder null (leer). */
export function cleanQuickieState(raw) {
  if (raw === null || typeof raw !== 'object') return { ...QUICKIE_START };
  const nonNeg = (x) => (isNum(x) && x >= 0 ? x : null);
  return {
    active: raw.active === true,
    miete: nonNeg(raw.miete),
    flaeche: nonNeg(raw.flaeche),
    angebot: isNum(raw.angebot) ? raw.angebot : null,
  };
}

/** Kurzform für die Gewinn-Ziele: 15000 → „15k“, 12500 → „12.500 €“. */
export function kurz(g) {
  return g % 1000 === 0 ? `${g / 1000}k` : eur(g);
}

/**
 * Reine Zahlen. inputs: { miete (Ist-Kaltmiete €/Monat), A (Wohnfläche m²), angebot (Angebotspreis oder null) }.
 * Ohne gültige Miete oder Fläche: { fehlt: true }. angebotStatus: 'leer' | 'ungueltig' | 'ok'.
 * gewinn ist nur bei gültigem Angebot gesetzt.
 */
export function computeQuickie(inputs, vorgaben) {
  const v = cleanVorgaben(vorgaben);
  const miete = inputs?.miete ?? null;
  const A = inputs?.A ?? null;
  const angebot = inputs?.angebot ?? null;
  const angebotStatus = angebot === null ? 'leer' : isPos(angebot) ? 'ok' : 'ungueltig';
  if (!(isPos(miete) && isPos(A))) {
    return { fehlt: true, vorgaben: v, miete, A, angebot, angebotStatus };
  }

  const e = v.erh / 100;
  const r = v.r / 100;
  const nk = v.nk / 100;
  const m = v.marge / 100;
  const mNeu = miete * (1 + e);
  const jNeu = mNeu * 12;
  const jIst = miete * 12;
  const vpRendite = jNeu / r;
  const vpDeckel = v.deckel * A;
  const vp = Math.min(vpRendite, vpDeckel);
  const umschalt = (v.deckel * r) / 12;
  const bindet = Math.abs(vpRendite - vpDeckel) < 0.5 ? 'beide' : vpRendite < vpDeckel ? 'Rendite' : 'Deckel';

  const maxKp = (g) => (vp - v.halte - g) / (1 + nk);
  const k1 = maxKp(v.z1);
  const k2 = maxKp(v.z2);
  const k3 = (vp / (1 + m) - v.halte) / (1 + nk);
  const gewinn = angebotStatus === 'ok' ? vp - angebot * (1 + nk) - v.halte : null;

  return {
    fehlt: false, vorgaben: v, miete, A, angebot, angebotStatus,
    e, r, nk, m, mNeu, jNeu, jIst, vpRendite, vpDeckel, vp, umschalt, bindet,
    k1, k2, k3, gewinn,
  };
}

const BINDET_TEXT = Object.freeze({ beide: 'beide', Rendite: 'Rendite Käufer', Deckel: 'Max. €/m² Käufer' });
const FAKT_LABELS = Object.freeze([
  'Miete nach Erhöhung',
  'Verkaufspreis',
  'Rendite Käufer (Bruttorendite beim Verkauf)',
  'Begrenzt durch',
  'Deine Kaufrendite (Ist-Miete ÷ Angebot)',
]);

/**
 * Fertige Texte. Ampel: 'gruen' | 'gelb' | 'rot' | 'neutral' (ohne Angebot, ungültig, Eingabe fehlt).
 * Rückgabe: fehlt, ampel, chip, headline, sub, karten[3] {label[2], wert, zeilen[2]}, hinweis (null oder Text),
 * fakten[5] {label, wert, pill}, rechenweg[] (leer ohne Eingabe), felder {miete, flaeche, angebot, rendite, deckel}, fuss.
 */
export function presentQuickie(inputs, vorgaben) {
  const c = computeQuickie(inputs, vorgaben);
  const v = c.vorgaben;
  const ok = !c.fehlt;

  // Karten
  const labelZ1 = ['Max. Kaufpreis', `${kurz(v.z1)} Gewinn`];
  const labelZ2 = ['Max. Kaufpreis', `${kurz(v.z2)} Gewinn`];
  const labelM = ['Max. Kaufpreis', `${num(v.marge, 0)}${NB}% Marge`];
  const karten = ok
    ? [
      { label: labelZ1, wert: eur(c.k1), zeilen: [sqm(c.k1 / c.A, 0), `Faktor ${num(c.k1 / c.jIst, 1)}`] },
      { label: labelZ2, wert: eur(c.k2), zeilen: [sqm(c.k2 / c.A, 0), `Faktor ${num(c.k2 / c.jIst, 1)}`] },
      {
        label: labelM,
        wert: eur(c.k3),
        zeilen: [`Gewinn ${eur(c.vp - c.k3 * (1 + c.nk) - v.halte)}`, `Faktor ${num(c.k3 / c.jIst, 1)}`],
      },
    ]
    : [
      { label: labelZ1, wert: DASH, zeilen: [DASH, DASH] },
      { label: labelZ2, wert: DASH, zeilen: [DASH, DASH] },
      { label: labelM, wert: DASH, zeilen: [DASH, DASH] },
    ];

  // Urteil
  let ampel = 'neutral';
  let chip = 'Eingabe fehlt';
  let headline = 'Ist-Kaltmiete und Wohnfläche eintragen.';
  let sub = '';
  if (ok && c.angebotStatus === 'leer') {
    chip = 'Kein Angebot';
    headline = 'Angebotspreis eintragen, um den Deal zu prüfen.';
    sub = `Bis ${eur(c.k1)} bleiben mindestens ${eur(v.z1)} Gewinn.`;
  } else if (ok && c.angebotStatus === 'ungueltig') {
    chip = 'Prüfen';
    headline = 'Angebotspreis ist keine gültige Zahl.';
  } else if (ok) {
    const g = c.gewinn;
    if (g >= v.z2) {
      ampel = 'gruen';
      chip = 'Deal';
      headline = `Gewinn ${eur(g)}: Wunschziel erreicht.`;
    } else if (g >= v.z1) {
      ampel = 'gelb';
      chip = 'knapp';
      headline = `Gewinn ${eur(g)}: Mindestziel erreicht, Wunschziel nicht.`;
      sub = `Für ${eur(v.z2)}: auf ${eur(c.k2)} verhandeln.`;
    } else {
      ampel = 'rot';
      chip = 'No-Deal';
      headline = `Gewinn nur ${eur(g)}. Verhandlungsziel: ${eur(c.k1)}.`;
      sub = `Der Preis muss um ${eur(c.angebot - c.k1)} runter (Kauf-Bruttorendite dann ${num(c.jIst / c.k1 * 100, 2)}${NB}%).`;
    }
  }

  // Hinweis: die m²-Verkaufsgrenze bindet, wenn die neue Miete je m² über dem Umschaltpunkt liegt.
  const hinweis = ok && c.mNeu / c.A > c.umschalt + 1e-9
    ? `Neue Miete ${sqm(c.mNeu / c.A, 2)} liegt über ${sqm(c.umschalt, 2)}. Die m²-Verkaufsgrenze bindet: ${eur(c.mNeu - c.umschalt * c.A)} pro Monat der Erhöhung bringen beim Verkauf nichts.`
    : null;

  // Übersicht
  const fakten = FAKT_LABELS.map((label) => ({ label, wert: DASH, pill: null }));
  if (ok) {
    fakten[0].wert = `${eur(c.mNeu)} · ${sqm(c.mNeu / c.A, 2)}`;
    fakten[1].wert = `${eur(c.vp)} · ${sqm(c.vp / c.A, 0)}`;
    fakten[2].wert = pct(c.jNeu / c.vp * 100, 2);
    fakten[3].wert = BINDET_TEXT[c.bindet];
    fakten[3].pill = `Umschaltpunkt ${sqm(c.umschalt, 2)}`;
    fakten[4].wert = c.angebotStatus === 'ok' ? pct(c.jIst / c.angebot * 100, 2) : DASH;
  }

  // Rechenweg
  const rechenweg = ok ? [
    `Neue Miete: ${cur2(c.miete)} × ${num(1 + c.e, 2)} = ${num(c.mNeu, 2)}${NB}€/Monat`,
    `Wert über Rendite: ${eur(c.jNeu)} ÷ ${num(v.r, 1)}${NB}% = ${eur(c.vpRendite)}`,
    `Wert über m²-Verkaufsgrenze: ${num(v.deckel, 0)} × ${num(c.A, 0)} m² = ${eur(c.vpDeckel)}`,
    `Verkaufspreis = kleinerer Wert = ${eur(c.vp)}`,
    `Max. Kaufpreis = (${eur(c.vp)} − ${eur(v.halte)} − ${eur(v.z1)}) ÷ ${num(1 + c.nk, 2)} = ${eur(c.k1)}`,
    `Max. Kaufpreis ${plain(v.marge)}% Marge = (${eur(c.vp)} ÷ ${num(1 + c.m, 2)} − ${eur(v.halte)}) ÷ ${num(1 + c.nk, 2)} = ${eur(c.k3)}`,
  ] : [];

  // Kleine Zeilen unter den Eingaben
  // Einheiten stehen im Feld selbst (js/ui/quickie.js), hier nur Zusatzinfos ohne doppelte Einheit.
  const mieteText = isPos(c.miete) && isPos(c.A) ? sqm(c.miete / c.A, 2) : '';
  let angebotText = '';
  if (c.angebotStatus === 'leer') angebotText = 'optional';
  else if (c.angebotStatus === 'ok' && isPos(c.A)) angebotText = sqm(c.angebot / c.A, 0);
  const felder = {
    miete: mieteText,
    flaeche: '',
    angebot: angebotText,
    rendite: `brutto, Standard ${num(QUICKIE_DEFAULTS.r, 1)}`,
    deckel: `Standard ${num(QUICKIE_DEFAULTS.deckel, 0)}`,
  };

  const fuss = `Alle Gewinne vor Steuern. Marge = Gewinn ÷ Gesamtkosten (Kaufpreis + Nebenkosten + Haltekosten). Annahmen: Kaufnebenkosten ${plain(v.nk)}${NB}%, keine Verkaufskosten, Haltekosten ${eur(v.halte)}. Rechtlich nicht geprüft: Kappungsgrenze, Vergleichsmiete, Vertragsart (Staffel/Index = No-Deal).`;

  return {
    fehlt: c.fehlt, ampel, chip, headline, sub, karten, hinweis, fakten, rechenweg, felder, fuss,
  };
}
