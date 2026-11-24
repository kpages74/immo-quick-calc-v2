// Fertige Anzeigetexte für die Oberfläche. Rein, keine DOM-Zugriffe.
// Alle Rechenwerte kommen aus compute/scenarios mit effectiveInputs(session); hier stehen keine eigenen Formeln.
// Geldbeträge als ganze Euro (Fmt.euro), €/m² und % mit zwei Nachkommastellen (Fmt.perSqm, Fmt.percent).
import { compute, scenarios, parkingMode, RULE_MARGIN, AMPEL, LIMIT, KIND, PARKING_MODE } from './calc.js';
import { Fmt, fieldDisplay } from './format.js';
import { FIELD_LIST, FIELDS, GROUPS, fieldsFor, factoryDefaultFor } from './fields.js';
import { normalizeSession, effectiveInputs } from './session.js';
import { normalizeCalculation } from './model.js';

/** Anzeigename je Art für die Objektliste. */
export const KIND_LABEL = Object.freeze({
  vermietet: 'Vermietet',
  kap: 'Leerstehend · Kapitalanleger',
  en: 'Leerstehend · Eigennutzer',
  wg: 'WG',
});

const NBSP = ' ';
const DASH = '–';
const MINUS = '−';
/** Felder, die nur bei aufgeweichter Marge sichtbar sind. */
const SOFTENED_ONLY = Object.freeze(['marginFloor', 'minProfit']);
/** Felder für Stellplatz-Miete, sichtbar bei Stellplatzmiete „Separat“ oder „In Kaltmiete“ (parkingRentMode). */
const PARKING_RENT_ONLY = Object.freeze(['parkingRent', 'parkingCount']);
const AMPEL_LABEL = Object.freeze({ [AMPEL.GREEN]: 'Grün', [AMPEL.YELLOW]: 'Gelb', [AMPEL.RED]: 'Rot' });
const LIMIT_TEXT = Object.freeze({
  [LIMIT.CAP]: 'm²-Verkaufsgrenze greift',
  [LIMIT.YIELD]: 'Rendite-Grenze greift',
  [LIMIT.BOTH]: 'Beide Grenzen gleich',
});

/** Marge als Text für Anzeige und Berichtszeilen: ganze Zahl ohne Nachkommastelle („20“, „25“), sonst eine („22,5“). */
function marginText(x) {
  return Fmt.fieldNumber(x, Number.isInteger(x) ? 0 : 1);
}

/** Kurzer Grund zur Ampel. Grün ab der grünen Marge (Zielmarge, mindestens 20 %). Ohne berechenbare Marge: „Nicht berechenbar“. */
function ampelText(ampel, margin, threshold) {
  if (ampel === AMPEL.GREEN) return `Marge ab ${marginText(threshold)} %`;
  if (ampel === AMPEL.YELLOW) return 'Aufgeweicht, Mindestgewinn erreicht';
  return margin === null ? 'Nicht berechenbar' : 'Marge unter der Regel';
}

/** Abweichung eines Angebots vom ganzzahligen Maximum. */
function deltaText(price, max) {
  if (typeof max !== 'number' || !Number.isFinite(max)) return 'Kein Maximum berechenbar';
  const d = Math.round(price - max);
  if (d === 0) return 'Genau am Maximum';
  return d > 0
    ? `${Fmt.euro(d)} über dem Maximum`
    : `${Fmt.euro(-d)} unter dem Maximum`;
}

/** Betrag mit Vorzeichen: „+4.324 €“, „−4.324 €“, „±0 €“. */
function signedEuro(d) {
  if (typeof d !== 'number' || !Number.isFinite(d)) return DASH;
  const r = Math.round(d);
  if (r === 0) return `±0${NBSP}€`;
  return r > 0 ? `+${Fmt.euro(r)}` : `${MINUS}${Fmt.euro(-r)}`;
}

/**
 * Ergebnis für die Anzeige. Im Modus 'max' beziehen sich ampel, margin, profit, gik auf den maximalen
 * Einkaufspreis. Im Modus 'check' mit Angebotspreis auf das Angebot (compute(...).offer).
 */
export function presentResult(session) {
  const s = normalizeSession(session);
  const inputs = effectiveInputs(s);
  const r = compute(s.calc.kind, inputs);
  const offer = r.offer;
  const useOffer = s.mode === 'check' && offer !== null;
  // Ohne möglichen Ankauf (kein Verkaufspreis oder Höchstpreis ≤ 0) hat der Maximalpreis keine Ampel und keine Marge.
  // compute würde sonst eine negative Höchstgrenze und eine Marge von 20 % liefern.
  const maxOk = r.isPurchasePossible;
  const basis = useOffer
    ? offer
    : {
      ampel: maxOk ? r.ampel : AMPEL.RED,
      marginPercent: maxOk ? r.marginPercent : null,
      profit: maxOk ? r.profit : null,
      totalInvestment: maxOk ? r.totalInvestment : null,
    };

  const ampel = basis.ampel;
  const margin = basis.marginPercent;

  // Gegenwert je m² zu GIK und Gewinn. Ohne Wohnfläche oder ohne Zahl (z. B. kein Ankauf): DASH.
  const flaeche = inputs.livingArea;
  const perSqmOf = (value) => (flaeche > 0 && typeof value === 'number' && Number.isFinite(value)
    ? Fmt.perSqm(value / flaeche)
    : DASH);

  // notes: Hinweistexte. noteHelp: je Hinweis der Erklärtext (gleiche Länge). Nur die Hinweise zur m²-Verkaufsgrenze haben einen.
  const notes = [];
  const noteHelp = [];
  const add = (text, help = '') => {
    notes.push(text);
    noteHelp.push(help);
  };
  // Erklärtext zur m²-Verkaufsgrenze (Feldhilfe von maxSalePricePerSqm).
  const capHelp = FIELDS.maxSalePricePerSqm.help ?? '';
  // Ohne m²-Verkaufsgrenze (Vermietet, KAP, WG) kein eigener Hinweis mehr: Die Erklärung steht als „?“ hinter „Rendite-Grenze greift“.
  if (r.capMissing && s.calc.kind === KIND.EN) {
    add('Bitte den max. Verkaufspreis je m² eingeben.', capHelp);
  }
  if (r.softenedActive) {
    add(`Aufgeweicht: ${Fmt.fieldNumber(r.effectiveMargin, 1)}${NBSP}% statt ${RULE_MARGIN}${NBSP}%`);
  }
  if (r.salePrice !== null && !r.isPurchasePossible) {
    add('Zu diesen Werten ist kein Ankauf möglich.');
  }
  if (s.mode === 'check' && offer === null) add('Bitte einen Angebotspreis eingeben.');

  let bufferText = '';
  if (r.buffer !== null && r.limit === LIMIT.CAP) {
    bufferText = `Puffer ${Fmt.euro(r.buffer)} bis zur Rendite-Grenze`;
  } else if (r.buffer !== null && r.limit === LIMIT.YIELD) {
    bufferText = `Puffer ${Fmt.euro(r.buffer)} bis zur m²-Verkaufsgrenze`;
  }

  return {
    mode: s.mode,
    // Beschriftung der Zeile „Nötiger Verkaufspreis …“: die grüne Marge (Zielmarge, mindestens 20 %).
    requiredLabel: `Nötiger Verkaufspreis für ${marginText(r.greenThreshold)} %`,
    maxPrice: maxOk ? Fmt.euro(r.maxPurchasePrice) : DASH,
    // compute liefert ohne Einkaufspreis 0 statt null (perSqm(null, Fläche)); hier abgefangen.
    maxPricePerSqm: maxOk ? Fmt.perSqm(r.maxPurchasePricePerSqm) : DASH,
    bid: r.bidRecommendation === null ? '' : `Gebot bis ${Fmt.euro(r.bidRecommendation)}`,
    ampel,
    ampelLabel: AMPEL_LABEL[ampel] ?? DASH,
    ampelText: ampelText(ampel, margin, r.greenThreshold),
    margin: Fmt.percent(margin),
    profit: Fmt.euro(basis.profit),
    profitPerSqm: perSqmOf(basis.profit),
    salePrice: Fmt.euro(r.salePrice),
    salePricePerSqm: Fmt.perSqm(r.salePricePerSqm),
    gik: Fmt.euro(basis.totalInvestment),
    gikPerSqm: perSqmOf(basis.totalInvestment),
    buyerYield: Fmt.percent(r.buyerYield),
    limitText: Object.hasOwn(LIMIT_TEXT, r.limit) ? LIMIT_TEXT[r.limit] : '',
    bufferText,
    // Erklärung zur Grenze (Rendite-Grenze / m²-Verkaufsgrenze), als „?“ hinter limitText.
    limitHelp: Object.hasOwn(LIMIT_TEXT, r.limit) && LIMIT_TEXT[r.limit] ? capHelp : '',
    notes,
    noteHelp,
    offer: useOffer
      ? {
        price: Fmt.euro(offer.purchasePrice),
        deltaText: deltaText(offer.purchasePrice, r.maxPurchasePrice),
        requiredSalePrice: Fmt.euro(offer.requiredSalePrice),
        requiredSalePricePerSqm: Fmt.perSqm(offer.requiredSalePricePerSqm),
      }
      : null,
  };
}

/**
 * Szenarienzeilen { key, label, value, delta, ampel }. Im Modus 'max': value = max. Einkaufspreis,
 * delta = Abweichung mit Vorzeichen, ampel null. Mit Angebot (Modus 'check'): value = Marge, delta = Gewinn, ampel = Ampel.
 */
export function presentScenarios(session) {
  const s = normalizeSession(session);
  const inputs = effectiveInputs(s);
  const useOffer = typeof inputs.offerPrice === 'number' && inputs.offerPrice > 0;
  return scenarios(s.calc.kind, inputs).map((row) => {
    if (useOffer) {
      return {
        key: row.key,
        label: row.label,
        value: Fmt.percent(row.offerMarginPercent),
        delta: Fmt.euro(row.offerProfit),
        ampel: row.offerAmpel,
      };
    }
    // Kein möglicher Ankauf (Höchstpreis null oder ≤ 0): keine Werte anzeigen.
    const possible = typeof row.maxPurchasePrice === 'number' && row.maxPurchasePrice > 0;
    return {
      key: row.key,
      label: row.label,
      value: possible ? Fmt.euro(row.maxPurchasePrice) : DASH,
      delta: possible ? signedEuro(row.deltaMaxPurchase) : DASH,
      ampel: null,
    };
  });
}

/**
 * Anzeigename eines Feldes in der Sitzung. Miete Stellplatz/Garage heißt im Modus „In Kaltmiete“ „davon …“,
 * weil sie dann schon in der Miete steckt. Sonst der Name aus fields.js.
 */
export function fieldLabel(session, key) {
  const field = FIELDS[key];
  if (!field) return '';
  if (key === 'parkingRent' && parkingMode(normalizeSession(session).calc.inputs) === PARKING_MODE.INKL) {
    return 'davon Stellplatz/Garage p. M.';
  }
  return field.label;
}

/** Zusatztext unter einem Feld oder ''. Nur für Felder der aktuellen Art. */
export function fieldHint(session, key) {
  const s = normalizeSession(session);
  const kind = s.calc.kind;
  if (!fieldsFor(kind).some((f) => f.key === key)) return '';
  const inputs = effectiveInputs(s);
  const r = compute(kind, inputs);
  const useOffer = r.offer !== null;

  switch (key) {
    case 'rentSurchargePercent':
      return r.targetRent === null
        ? ''
        : `Soll-Miete ${Fmt.euro(r.targetRent)} · ${Fmt.perSqm(r.targetRentPerSqm)}`;
    case 'rent':
      if (r.parkingMode === PARKING_MODE.INKL) {
        // Gesamte Ist-Miete je m² (inkl. Stellplatz), nicht die Kernmiete.
        return inputs.livingArea > 0 ? `${Fmt.perSqm(inputs.rent / inputs.livingArea)} inkl. Stellplatz` : '';
      }
      return r.currentRentPerSqm === null ? '' : Fmt.perSqm(r.currentRentPerSqm);
    case 'parkingRent': {
      if (r.parkingMode === PARKING_MODE.KEINE) return '';
      // Stellplatzmiete gesamt pro Monat (bei WG × Anzahl Stellplätze). Ohne Betrag ist der Modus unvollständig.
      const parkingSum = kind === KIND.WG
        ? (inputs.parkingCount || 0) * (inputs.parkingRent || 0)
        : (inputs.parkingRent || 0);
      if (parkingSum <= 0) return 'Bitte Stellplatzmiete eintragen';
      if (r.parkingMode === PARKING_MODE.SEPARAT) return 'Kommt zur Kaltmiete dazu · zählt für Verkaufspreis und Rendite des Käufers';
      if (r.parkingCoreMonthly === null) return '';
      const perSqm = inputs.livingArea > 0 ? ` · ${Fmt.perSqm(r.parkingCoreMonthly / inputs.livingArea)}` : '';
      return `Wohnung ${Fmt.euro(r.parkingCoreMonthly)}${perSqm}`;
    }
    case 'rentPerSqm':
      // Gesamtmiete der Wohnung im Monat (Miete je m² × Wohnfläche).
      return inputs.livingArea > 0 && inputs.rentPerSqm > 0
        ? `Miete ${Fmt.euro(inputs.livingArea * inputs.rentPerSqm)} p. M.`
        : '';
    case 'otherCosts':
      return inputs.otherCosts > 0 && inputs.livingArea > 0
        ? Fmt.perSqm(inputs.otherCosts / inputs.livingArea)
        : '';
    case 'minYield': {
      // Rendite-Grenze aus der Gesamtmiete inkl. Stellplatzmiete (wenn vermietet).
      if (r.yieldLimit === null) return '';
      const withParking = r.parkingMode !== PARKING_MODE.KEINE && r.parkingRentAnnual > 0;
      return `Rendite-Grenze ${Fmt.euro(r.yieldLimit)}${withParking ? ' · inkl. Stellplatz' : ''}`;
    }
    case 'maxSalePricePerSqm':
      if (r.capLimit !== null) {
        return `m²-Verkaufsgrenze ${Fmt.euro(r.capLimit)}${inputs.parkingSalePrice > 0 ? ' · inkl. Stellplatz' : ''}`;
      }
      return inputs.maxSalePricePerSqm === 0 ? '0 = keine m²-Verkaufsgrenze' : '';
    case 'renovationCosts': {
      const perSqm = inputs.livingArea > 0 ? inputs.renovationCosts / inputs.livingArea : null;
      const base = `Sanierung ${Fmt.perSqm(perSqm)}`;
      return inputs.renovationBufferPercent > 0
        ? `${base} · Gesamt inkl. Zuschlag ${Fmt.euro(r.renovationTotal)}`
        : base;
    }
    case 'notaryPercent':
      return `Summe ${Fmt.percent(r.knkSumPercent)} · gerechnet mit ${Fmt.fieldNumber(r.knkPercent, 0)}${NBSP}%`;
    case 'parkingSalePrice': {
      if (inputs.parkingSalePrice <= 0 || r.salePrice === null) return '';
      if (kind === KIND.EN) return 'Kommt zum Verkaufspreis dazu';
      if (r.limit === LIMIT.YIELD) {
        // Bei vermieteter Wohnung steckt der Stellplatz über seine Miete schon in der Rendite-Grenze.
        return r.parkingRentAnnual > 0
          ? 'Steckt über die Stellplatzmiete schon im Verkaufspreis · zählt nur für die m²-Verkaufsgrenze'
          : 'Zählt nur für die m²-Verkaufsgrenze';
      }
      return 'In der m²-Verkaufsgrenze enthalten';
    }
    case 'durationMonths': {
      const financing = useOffer ? r.offer.financingCosts : r.financingCosts;
      // Negative laufende Kosten (Mieteinnahmen übersteigen Hausgeld): als Mietüberschuss ohne Vorzeichen.
      const holding = r.holdingCosts < 0
        ? `Mietüberschuss ${Fmt.euro(-r.holdingCosts)}`
        : `Laufende Kosten ${Fmt.euro(r.holdingCosts)}`;
      return `${holding} · Finanzierung ${Fmt.euro(financing)}`;
    }
    case 'offerPrice':
      return typeof inputs.offerPrice === 'number' && inputs.offerPrice > 0 && inputs.livingArea > 0
        ? Fmt.perSqm(inputs.offerPrice / inputs.livingArea)
        : '';
    default:
      return '';
  }
}

/**
 * Eine Zeile der Objektliste. Gerechnet wird ohne Angebotspreis (wie im Modus max). Ohne möglichen Ankauf:
 * Ampel rot, Höchstpreis „–“. Keine eigene Formel: alle Werte aus compute.
 */
export function presentObjectRow(calc) {
  const c = normalizeCalculation(calc);
  const r = compute(c.kind, { ...c.inputs, offerPrice: null });
  const possible = r.isPurchasePossible;
  const ampel = possible ? r.ampel : AMPEL.RED;
  return {
    id: c.id,
    name: c.name || 'Ohne Namen',
    address: c.address,
    kindLabel: KIND_LABEL[c.kind],
    date: Fmt.date(c.modified),
    ampel,
    ampelLabel: AMPEL_LABEL[ampel] ?? DASH,
    maxPrice: possible ? Fmt.euro(r.maxPurchasePrice) : DASH,
  };
}

/** Feld-Spezifikationen, die die Oberfläche als Zeilen zeigt, in der Reihenfolge von FIELD_LIST. */
export function visibleFields(session) {
  const s = normalizeSession(session);
  const kind = s.calc.kind;
  const softened = s.calc.inputs.softened === true;
  const parkingShown = parkingMode(s.calc.inputs) !== PARKING_MODE.KEINE;
  return FIELD_LIST.filter((f) => f.kinds.includes(kind)
    && !(SOFTENED_ONLY.includes(f.key) && !softened)
    && !(PARKING_RENT_ONLY.includes(f.key) && !parkingShown)
    && !(f.key === 'offerPrice' && s.mode !== 'check'));
}

/** Regler-Bereich { min, max, step }. targetMargin hat min 20, solange softened nicht true ist. Unbekannter Schlüssel: null. */
export function fieldRange(session, key) {
  if (!Object.hasOwn(FIELDS, key)) return null;
  const f = FIELDS[key];
  const softened = normalizeSession(session).calc.inputs.softened === true;
  const min = key === 'targetMargin' && !softened ? RULE_MARGIN : f.min;
  return { min, max: f.max, step: f.step };
}

// MARK: - Bericht (PDF und Druck)

const APP_NAME = 'Immo Quick-Calc 2.0';
const MODE_LABEL = Object.freeze({ max: 'Maximum ermitteln', check: 'Angebot prüfen' });

/** Anzeige eines Feldwerts im Bericht: Ja/Nein, „–“ ohne Wert, sonst wie in der Oberfläche. */
function reportFieldValue(field, value) {
  if (field.unit === 'bool') return value === true ? 'Ja' : 'Nein';
  if (value === null || value === undefined) return DASH;
  return fieldDisplay(FIELDS[field.key], value);
}

/** Grenztext für die Ergebniszeile „Grenze“: Grenze und Puffer mit ' · ' verbunden, leere Teile entfallen. */
function limitRow(r) {
  const text = [r.limitText, r.bufferText].filter(Boolean).join(' · ');
  return text === '' ? null : ['Grenze', text];
}

/**
 * Inhalt des Berichts für PDF und Druck. Rein, keine eigene Formel: alle Werte aus presentResult,
 * presentScenarios, visibleFields und fieldHint. Wirft nie (Sitzung wird vorher normalisiert).
 */
export function presentReport(session, now = new Date()) {
  const s = normalizeSession(session);
  const r = presentResult(s);
  const scenarioRows = presentScenarios(s);
  const withOffer = r.offer !== null;
  const kind = s.calc.kind;
  const scenarioTitle = `Szenarien (Abweichung ${fieldDisplay(FIELDS.scenarioPercent, s.calc.inputs.scenarioPercent)})`;
  const validNow = now instanceof Date && !Number.isNaN(now.getTime());

  const headline = withOffer
    ? { label: 'Marge beim Angebot', value: r.margin, sub: '' }
    : {
      label: 'Max. Einkaufspreis',
      value: r.maxPrice,
      sub: [r.maxPricePerSqm, r.bid].filter(Boolean).join(' · '),
    };

  // Mit Angebot: Gewinn beim Angebot neben der Marge. Ohne Angebot (Modus Maximum): Gewinn neben dem Max. Einkaufspreis.
  // Gleichwertig, Euro; darunter Gewinn je m².
  const headlineZweit = withOffer
    ? { label: 'Gewinn beim Angebot', value: r.profit, sub: r.profitPerSqm }
    : { label: 'Gewinn', value: r.profit, sub: r.profitPerSqm };

  const result = [];
  if (withOffer) {
    result.push(
      ['Angebotspreis', r.offer.price],
      ['Abstand zum Maximum', r.offer.deltaText],
      ['Max. Einkaufspreis', `${r.maxPrice} · ${r.maxPricePerSqm}`],
      ['GIK', `${r.gik} · ${r.gikPerSqm}`],
      ['Verkaufspreis', `${r.salePrice} · ${r.salePricePerSqm}`],
      [r.requiredLabel, `${r.offer.requiredSalePrice} · ${r.offer.requiredSalePricePerSqm}`],
    );
  } else {
    result.push(
      ['Marge', r.margin],
      ['Verkaufspreis', `${r.salePrice} · ${r.salePricePerSqm}`],
      ['GIK', `${r.gik} · ${r.gikPerSqm}`],
    );
    if (kind !== KIND.EN) result.push(['Rendite Käufer', r.buyerYield]);
  }
  const limit = limitRow(r);
  if (limit) result.push(limit);

  const sections = [{ title: 'Ergebnis', rows: result }];

  const visible = visibleFields(s);
  for (const group of GROUPS) {
    // Der Angebotspreis steht unter „Ergebnis“; die Szenario-Abweichung steht im Titel des Szenarien-Abschnitts.
    if (group.key === 'szenarien' || group.key === 'pruefung') continue;
    const fields = visible.filter((f) => f.group === group.key);
    if (fields.length === 0) continue;
    const rows = fields.map((f) => [fieldLabel(s, f.key), reportFieldValue(f, s.calc.inputs[f.key])]);
    if (group.key === 'kosten') {
      const hint = fieldHint(s, 'notaryPercent');
      if (hint !== '') rows.push(['Kaufnebenkosten', hint]);
    }
    sections.push({ title: group.title, rows });
  }

  sections.push(withOffer
    ? {
      title: scenarioTitle,
      columns: ['Szenario', 'Marge', 'Gewinn'],
      rows: scenarioRows.map((row) => [row.label, row.value, row.delta]),
    }
    : {
      title: scenarioTitle,
      columns: ['Szenario', 'Max. Einkaufspreis', 'Abweichung'],
      rows: scenarioRows.map((row) => [row.label, row.value, row.delta]),
    });

  const ps = s.calc.priceSource;
  if (ps.source || ps.date) {
    sections.push({ title: 'Richtpreis', rows: [['Quelle', ps.source || DASH], ['Stand', ps.date || DASH]] });
  }

  return {
    appName: APP_NAME,
    name: s.calc.name || 'Ohne Namen',
    address: s.calc.address,
    date: Fmt.date(validNow ? now.toISOString() : ''),
    kindLabel: KIND_LABEL[kind],
    modeLabel: MODE_LABEL[s.mode],
    headline,
    headlineZweit,
    ampel: r.ampel,
    ampelLine: `${r.ampelLabel} · ${r.ampelText}`,
    sections,
    notes: r.notes,
    note: s.calc.note,
  };
}

// MARK: - Eigene Standardwerte, Preisliste (Oberfläche)

/**
 * Eigene Standardwerte einer Art als Zeilen { key, label, value, factory }, in der Reihenfolge von FIELD_LIST.
 * value = eigener Wert, factory = Werksstandard, beides als Anzeigetext (Ja/Nein bei Schaltern). Ohne Überschreibung: [].
 */
export function presentDefaults(overrides, kind) {
  if (overrides === null || typeof overrides !== 'object' || !Object.hasOwn(overrides, kind)) return [];
  const entries = overrides[kind];
  if (entries === null || typeof entries !== 'object') return [];
  const show = (field, value) => (field.unit === 'bool' ? (value === true ? 'Ja' : 'Nein') : fieldDisplay(field, value));
  // Stellplatz-Miete nur, wenn der Stellplatz vermietet ist: „Separat“ oder „In Kaltmiete“ (eigener Wert oder Werksstandard).
  const parkingShown = parkingMode(entries) !== PARKING_MODE.KEINE;
  return FIELD_LIST
    .filter((f) => f.key !== 'offerPrice' && f.kinds.includes(kind) && Object.hasOwn(entries, f.key))
    .filter((f) => !(PARKING_RENT_ONLY.includes(f.key) && !parkingShown))
    .map((f) => ({
      key: f.key,
      label: f.label,
      value: show(f, entries[f.key]),
      factory: show(f, factoryDefaultFor(f.key, kind)),
    }));
}

/** Preistext einer Zeile der Preisliste, z. B. „Mittel 2.750 €/m² (2.400–3.100 €/m²) · Stand 10/2026“. Spanne nur mit von und bis, Stand nur mit Angabe. */
export function presentPriceText(row) {
  const r = row !== null && typeof row === 'object' ? row : {};
  const unit = `${NBSP}€/m²`;
  let text = `Mittel ${Fmt.fieldNumber(r.mittel, 0)}${unit}`;
  if (typeof r.von === 'number' && typeof r.bis === 'number') {
    text += ` (${Fmt.fieldNumber(r.von, 0)}–${Fmt.fieldNumber(r.bis, 0)}${unit})`;
  }
  if (typeof r.stand === 'string' && r.stand !== '') text += ` · Stand ${r.stand}`;
  return text;
}

/** Zustand der Preisliste für die Einstellungen: „Keine Preisliste importiert.“ oder Anzahl, Datum und Datei. */
export function presentPriceListState(data) {
  const rows = data !== null && typeof data === 'object' && Array.isArray(data.rows) ? data.rows : [];
  if (rows.length === 0) return 'Keine Preisliste importiert.';
  const file = typeof data.fileName === 'string' && data.fileName !== '' ? ` (${data.fileName})` : '';
  return `${Fmt.fieldNumber(rows.length, 0)} Einträge, importiert am ${Fmt.date(data.imported)}${file}`;
}
