// Rechenlogik der Immo Quick-Calc Web-App (Etappe 2). Einzige Quelle aller Formeln.
// Keine DOM-Zugriffe. Prozentwerte als Prozentzahl (20 = 20 %). Ergebnis null = nicht berechenbar.

export const KIND = Object.freeze({ VERMIETET: 'vermietet', KAP: 'kap', EN: 'en', WG: 'wg' });
export const AMPEL = Object.freeze({ GREEN: 'gruen', YELLOW: 'gelb', RED: 'rot' });
export const LIMIT = Object.freeze({ YIELD: 'rendite', CAP: 'deckel', BOTH: 'beide' });
/** Regelmarge in Prozent: ohne „aufweichen“ wird die Zielmarge auf mindestens diesen Wert angehoben. */
export const RULE_MARGIN = 20;

const KIND_VALUES = Object.values(KIND);
const MINUS = '−';

/** Eingabe lesen: fehlend, nicht endlich, nicht Zahl oder negativ → 0. */
function read(inputs, key) {
  const v = inputs ? inputs[key] : undefined;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Ergebnis nur als endliche Zahl, sonst null. */
const finiteOrNull = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** Gleitkommarest auf 1e-9 bereinigen (z. B. 0,43000000000002 → 0,43). */
const roundNano = (x) => Math.round(x * 1e9) / 1e9;

/** Division durch Fläche, null bei Fläche 0 oder ohne endlichen Wert (kein Wert ergibt null, nicht 0). */
const perSqm = (value, area) => (area > 0 && typeof value === 'number' && Number.isFinite(value) ? finiteOrNull(value / area) : null);

/** Szenario-Faktor: nur endliche Werte ≥ 0 zählen, sonst 1. */
const factorOf = (x) => (Number.isFinite(x) && x >= 0 ? x : 1);

function assertKind(kind) {
  if (!KIND_VALUES.includes(kind)) throw new Error(`Unbekannte Art: ${kind}`);
}

/**
 * Zwischenwerte einer Berechnung: Miete, Grenzen, Verkaufspreis, Kosten und Marge.
 * Gemeinsame Grundlage für compute, evaluatePurchase und scenarios.
 * options (intern, für Szenarien): rentFactor multipliziert alle Mietwerte außer rentalIncome,
 * renovationFactor multipliziert die Sanierungskosten.
 */
function context(kind, inputs, options = {}) {
  assertKind(kind);
  const rentFactor = factorOf(options.rentFactor);
  const renovationFactor = factorOf(options.renovationFactor);
  const scaleRent = (x) => x * rentFactor;

  const area = read(inputs, 'livingArea');
  const parkingRent = read(inputs, 'parkingRent');
  const parkingSalePrice = read(inputs, 'parkingSalePrice');
  // Stellplatzmiete zählt nur, wenn separat vermietet (Schalter). Bei Eigennutzer nie.
  const separat = kind !== KIND.EN && inputs?.parkingRentSeparate === true;
  const parkingRentMonthly = separat
    ? (kind === KIND.WG ? read(inputs, 'parkingCount') * parkingRent : parkingRent)
    : 0;

  // Schritt 1: Miete. Kernmiete ohne Stellplatz, Stellplatzmiete nur bei separater Vermietung.
  let targetRent = null;
  let targetRentPerSqm = null;
  let currentRentPerSqm = null;
  let monthlyRent = null;
  let coreAnnualRent = null; // Kern-Jahresmiete ohne Stellplatz, Grundlage der Rendite-Grenze
  let rentalIncome = 0;
  if (kind === KIND.VERMIETET) {
    const rent = read(inputs, 'rent');
    const surcharge = read(inputs, 'rentSurchargePercent') / 100;
    const sollRent = rent * (1 + surcharge);
    targetRent = scaleRent(sollRent);
    targetRentPerSqm = perSqm(targetRent, area);
    currentRentPerSqm = perSqm(rent, area);
    monthlyRent = scaleRent(sollRent + parkingRentMonthly);
    coreAnnualRent = scaleRent(sollRent) * 12;
    rentalIncome = rent + parkingRentMonthly; // Ist-Miete, nicht Soll-Miete; Szenario ändert sie nicht
  } else if (kind === KIND.KAP) {
    const rentPerSqm = read(inputs, 'rentPerSqm');
    monthlyRent = scaleRent(area * rentPerSqm + parkingRentMonthly);
    coreAnnualRent = scaleRent(area * rentPerSqm) * 12;
    currentRentPerSqm = rentPerSqm;
  } else if (kind === KIND.WG) {
    monthlyRent = scaleRent(read(inputs, 'rooms') * read(inputs, 'roomRent') + parkingRentMonthly);
    coreAnnualRent = scaleRent(read(inputs, 'rooms') * read(inputs, 'roomRent')) * 12;
  }
  const annualRent = monthlyRent === null ? null : monthlyRent * 12;

  // Schritt 2: Verkaufspreis der Wohnung. Rendite-Grenze nur aus der Kernmiete, ohne Stellplatz.
  // Der Stellplatz-Verkaufspreis wird nicht zu den Grenzen addiert; er fließt nur in Gewinn, Marge und Max. Einkaufspreis.
  const minYield = read(inputs, 'minYield');
  const maxPerSqm = read(inputs, 'maxSalePricePerSqm');
  let yieldLimit = null;
  if (kind !== KIND.EN && minYield > 0 && coreAnnualRent > 0) {
    yieldLimit = finiteOrNull(coreAnnualRent / (minYield / 100));
  }
  // m²-Deckel: nur Wohnung × Deckel.
  let capLimit = null;
  if (maxPerSqm > 0 && area > 0) capLimit = area * maxPerSqm;

  const candidates = [yieldLimit, capLimit].filter((x) => x !== null);
  const salePrice = candidates.length > 0 ? Math.min(...candidates) : null;

  let limit = null;
  let buffer = null;
  if (yieldLimit !== null && capLimit !== null) {
    if (Math.abs(yieldLimit - capLimit) < 0.005) limit = LIMIT.BOTH;
    else limit = yieldLimit < capLimit ? LIMIT.YIELD : LIMIT.CAP;
    buffer = Math.abs(yieldLimit - capLimit);
  } else if (yieldLimit !== null) {
    limit = LIMIT.YIELD;
  } else if (capLimit !== null) {
    limit = LIMIT.CAP;
  }
  const capMissing = maxPerSqm === 0;
  const salePricePerSqm = salePrice === null ? null : perSqm(salePrice, area);
  // Verkaufspreis mit Stellplatz: nur Zusatz zum Verkauf, der Einkaufspreis hängt nicht davon ab.
  const salePriceTotal = salePrice === null ? null : salePrice + parkingSalePrice;
  // Rendite Käufer: Jahresmiete inkl. separater Stellplatzmiete, geteilt durch den Kaufpreis inkl. Stellplatz.
  const buyerYield = kind !== KIND.EN && salePriceTotal !== null && salePriceTotal > 0
    ? finiteOrNull((annualRent / salePriceTotal) * 100)
    : null;

  // Schritt 3: Kosten
  // Kaufnebenkosten: Summe der Einzelsätze, dann auf volle Prozent aufgerundet (1e-9 gegen Gleitkommafehler).
  const knkSumPercent = read(inputs, 'brokerPercent') + read(inputs, 'transferTaxPercent') + read(inputs, 'notaryPercent');
  const knkPercent = Math.max(0, Math.ceil(knkSumPercent - 1e-9));
  const knkRoundingPercent = Math.max(0, roundNano(knkPercent - knkSumPercent));
  const p = knkPercent / 100;
  const renovationTotal = read(inputs, 'renovationCosts') * renovationFactor * (1 + read(inputs, 'renovationBufferPercent') / 100);
  const otherCosts = read(inputs, 'otherCosts');
  const months = read(inputs, 'durationMonths');
  const holdingCosts = (read(inputs, 'hausgeld') + read(inputs, 'heatingCosts') - rentalIncome) * months;
  const loanFraction = read(inputs, 'loanPercent') / 100;
  const z = read(inputs, 'interestPercent') / 100;
  const b = read(inputs, 'processingFeePercent') / 100;
  const phi = loanFraction * ((z * months) / 12 + b);
  const v = read(inputs, 'salesCommissionPercent') / 100;
  const salesCommission = salePrice === null ? null : salePrice * v;
  const saleNet = salePrice === null ? null : salePrice * (1 - v);
  // Stellplatz-Verkaufspreis nach Vertriebskosten: zählt voll in Gewinn, Marge und Max. Einkaufspreis, nicht in €/m² der Wohnung.
  const parkingNet = parkingSalePrice * (1 - v);

  // Schritt 4: Marge
  const targetMargin = read(inputs, 'targetMargin');
  const softened = inputs?.softened === true;
  const softenedActive = softened && targetMargin < RULE_MARGIN;
  const effectiveMargin = softened ? targetMargin : Math.max(targetMargin, RULE_MARGIN);
  const m = effectiveMargin / 100;

  // Maximaler Einkaufspreis: saleNet + parkingNet = (1 + m) × GIK mit GIK = EK (1 + p + φ) + S + O + H
  let maxPurchasePriceExact = null;
  if (saleNet !== null) {
    maxPurchasePriceExact = finiteOrNull(((saleNet + parkingNet) / (1 + m) - renovationTotal - otherCosts - holdingCosts) / (1 + p + phi));
  }
  const maxPurchasePrice = maxPurchasePriceExact === null ? null : Math.floor(maxPurchasePriceExact + 1e-6);
  const bidRecommendation = maxPurchasePriceExact !== null && maxPurchasePriceExact > 0
    ? Math.floor((maxPurchasePriceExact + 1e-6) / 1000) * 1000
    : null;
  const isPurchasePossible = maxPurchasePriceExact !== null && maxPurchasePriceExact > 0;

  return {
    inputs,
    kind,
    area,
    parkingSalePrice,
    targetRent,
    targetRentPerSqm,
    currentRentPerSqm,
    monthlyRent,
    annualRent,
    yieldLimit,
    capLimit,
    salePrice,
    salePricePerSqm,
    salePriceTotal,
    parkingNet,
    limit,
    buffer,
    capMissing,
    buyerYield,
    knkSumPercent,
    knkPercent,
    knkRoundingPercent,
    p,
    phi,
    z,
    b,
    months,
    loanFraction,
    renovationTotal,
    otherCosts,
    holdingCosts,
    rentalIncome,
    parkingRentMonthly,
    salesCommission,
    saleNet,
    v,
    effectiveMargin,
    softenedActive,
    maxPurchasePriceExact,
    maxPurchasePrice,
    bidRecommendation,
    isPurchasePossible,
  };
}

/**
 * Vorwärtsrechnung für einen beliebigen Einkaufspreis P (gleiche Formeln wie compute).
 * Ohne Verkaufspreis sind profit und marginPercent null und die Ampel rot.
 */
function evaluateWith(c, P) {
  const closingCosts = P * c.p;
  const loanAmount = c.loanFraction * P;
  const financingInterest = (loanAmount * c.z * c.months) / 12;
  const financingFee = loanAmount * c.b;
  const financingCosts = c.phi * P;
  const totalInvestment = P * (1 + c.p + c.phi) + c.renovationTotal + c.otherCosts + c.holdingCosts;

  const hasSale = c.saleNet !== null;
  // Gewinn: Wohnung nach Vertriebskosten plus Stellplatz/Garage nach Vertriebskosten, abzüglich Gesamtinvestition.
  const profit = hasSale ? c.saleNet + c.parkingNet - totalInvestment : null;
  const marginPercent = hasSale && totalInvestment > 0 ? (profit / totalInvestment) * 100 : null;
  const ampel = trafficLight(marginPercent, profit, c.inputs);
  // Nötiger Verkaufspreis der Wohnung für Regelmarge: Stellplatz-Erlös nach Vertrieb wird abgezogen.
  const requiredSalePrice = c.v < 1 ? (((1 + RULE_MARGIN / 100) * totalInvestment) - c.parkingNet) / (1 - c.v) : null;

  return {
    purchasePrice: P,
    parkingSalePrice: c.parkingSalePrice,
    parkingNet: c.parkingNet,
    salePriceTotal: c.salePriceTotal,
    closingCosts,
    closingBreakdown: {
      broker: P * (read(c.inputs, 'brokerPercent') / 100),
      transferTax: P * (read(c.inputs, 'transferTaxPercent') / 100),
      notary: P * (read(c.inputs, 'notaryPercent') / 100),
      rounding: P * (c.knkRoundingPercent / 100),
    },
    loanAmount,
    financingInterest,
    financingFee,
    financingCosts,
    totalInvestment,
    profit,
    marginPercent: finiteOrNull(marginPercent),
    ampel,
    purchasePricePerSqm: perSqm(P, c.area),
    totalInvestmentPerSqm: perSqm(totalInvestment, c.area),
    requiredSalePrice: finiteOrNull(requiredSalePrice),
    requiredSalePricePerSqm: requiredSalePrice === null ? null : perSqm(requiredSalePrice, c.area),
  };
}

/** Ergebnis ohne berechenbaren Einkaufspreis: Kosten- und Margenwerte null, Ampel rot. */
function unpricedEvaluation() {
  return {
    purchasePrice: null,
    closingCosts: null,
    closingBreakdown: { broker: null, transferTax: null, notary: null, rounding: null },
    loanAmount: null,
    financingInterest: null,
    financingFee: null,
    financingCosts: null,
    totalInvestment: null,
    profit: null,
    marginPercent: null,
    ampel: AMPEL.RED,
    purchasePricePerSqm: null,
    totalInvestmentPerSqm: null,
    requiredSalePrice: null,
    requiredSalePricePerSqm: null,
  };
}

/**
 * Ampel: grün ab Regelmarge; gelb nur bei aufgeweichter Marge (ab Untergrenze und Mindestgewinn); sonst rot.
 */
export function trafficLight(marginPercent, profit, inputs) {
  if (typeof marginPercent !== 'number' || !Number.isFinite(marginPercent)) return AMPEL.RED;
  if (marginPercent >= RULE_MARGIN - 1e-9) return AMPEL.GREEN;
  if (
    inputs?.softened === true
    && marginPercent >= read(inputs, 'marginFloor') - 1e-9
    && typeof profit === 'number'
    && profit >= read(inputs, 'minProfit') - 1e-6
  ) {
    return AMPEL.YELLOW;
  }
  return AMPEL.RED;
}

/**
 * Vorwärtsrechnung für einen Einkaufspreis P. Liefert Nebenkosten, Finanzierung, GIK, Gewinn, Marge,
 * Ampel und den Wohnungs-Verkaufspreis, der für 20 % Marge nötig wäre (Stellplatz-Erlös bereits abgezogen).
 */
export function evaluatePurchase(kind, inputs, purchasePrice) {
  const P = Number.isFinite(purchasePrice) ? purchasePrice : 0;
  return evaluateWith(context(kind, inputs), P);
}

/**
 * Berechnung aller Ergebnisse. Der Max. Einkaufspreis ist das einzige berechnete Preisergebnis.
 * options ist intern (Szenarien): { rentFactor, renovationFactor }.
 */
export function compute(kind, inputs, options = {}) {
  const c = context(kind, inputs, options);
  const exact = c.maxPurchasePriceExact;
  const ev = exact === null ? unpricedEvaluation() : evaluateWith(c, exact);

  const offerPrice = read(inputs, 'offerPrice');
  let offer = null;
  if (offerPrice > 0) {
    const deltaToMax = exact === null ? null : offerPrice - exact;
    offer = {
      ...evaluateWith(c, offerPrice),
      deltaToMax,
      deltaToMaxPercent: deltaToMax === null ? null : (deltaToMax / offerPrice) * 100,
    };
  }

  return {
    kind,
    targetRent: c.targetRent,
    targetRentPerSqm: c.targetRentPerSqm,
    currentRentPerSqm: c.currentRentPerSqm,
    monthlyRent: c.monthlyRent,
    annualRent: c.annualRent,
    yieldLimit: c.yieldLimit,
    capLimit: c.capLimit,
    salePrice: c.salePrice,
    salePricePerSqm: c.salePricePerSqm,
    parkingSalePrice: c.parkingSalePrice,
    parkingNet: c.parkingNet,
    salePriceTotal: c.salePriceTotal,
    limit: c.limit,
    buffer: c.buffer,
    capMissing: c.capMissing,
    buyerYield: c.buyerYield,
    knkSumPercent: c.knkSumPercent,
    knkPercent: c.knkPercent,
    knkRoundingPercent: c.knkRoundingPercent,
    renovationTotal: c.renovationTotal,
    renovationPerSqm: perSqm(c.renovationTotal, c.area),
    otherCosts: c.otherCosts,
    holdingCosts: c.holdingCosts,
    rentalIncome: c.rentalIncome,
    parkingRentAnnual: c.parkingRentMonthly * 12,
    salesCommission: c.salesCommission,
    saleNet: c.saleNet,
    effectiveMargin: c.effectiveMargin,
    softenedActive: c.softenedActive,
    maxPurchasePriceExact: exact,
    maxPurchasePrice: c.maxPurchasePrice,
    maxPurchasePricePerSqm: perSqm(c.maxPurchasePrice, c.area),
    bidRecommendation: c.bidRecommendation,
    isPurchasePossible: c.isPurchasePossible,
    ...ev,
    offer,
  };
}

/**
 * Szenarien um s % (scenarioPercent, Standard 10): Miete und Sanierungskosten jeweils runter und rauf.
 * Bei EN entfallen die Miet-Szenarien.
 */
export function scenarios(kind, inputs) {
  const s0 = read(inputs, 'scenarioPercent');
  const s = s0 > 0 ? s0 : 10;
  const sText = String(s).replace('.', ',');
  const base = compute(kind, inputs);
  const offerOn = read(inputs, 'offerPrice') > 0;

  const defs = [
    { key: 'rentDown', label: `Miete ${MINUS}${sText} %`, percent: -s, options: { rentFactor: 1 - s / 100 } },
    { key: 'rentUp', label: `Miete +${sText} %`, percent: s, options: { rentFactor: 1 + s / 100 } },
    { key: 'renovationDown', label: `Sanierung ${MINUS}${sText} %`, percent: -s, options: { renovationFactor: 1 - s / 100 } },
    { key: 'renovationUp', label: `Sanierung +${sText} %`, percent: s, options: { renovationFactor: 1 + s / 100 } },
  ];
  const list = kind === KIND.EN ? defs.filter((d) => d.key.startsWith('renovation')) : defs;

  return list.map((d) => {
    const r = compute(kind, inputs, d.options);
    const bothPriced = r.maxPurchasePrice !== null && base.maxPurchasePrice !== null;
    return {
      key: d.key,
      label: d.label,
      percent: d.percent,
      salePrice: r.salePrice,
      maxPurchasePrice: r.maxPurchasePrice,
      deltaMaxPurchase: bothPriced ? r.maxPurchasePrice - base.maxPurchasePrice : null,
      offerMarginPercent: offerOn && r.offer ? r.offer.marginPercent : null,
      offerProfit: offerOn && r.offer ? r.offer.profit : null,
      offerAmpel: offerOn && r.offer ? r.offer.ampel : null,
    };
  });
}
