// Rechenlogik der Immo Quick-Calc Web-App (Etappe 2). Einzige Quelle aller Formeln.
// Keine DOM-Zugriffe. Prozentwerte als Prozentzahl (20 = 20 %). Ergebnis null = nicht berechenbar.
// Wohnung und Stellplatz werden als Paket gerechnet: Max. Einkaufspreis, Verkaufspreis und Angebot gelten inkl. Stellplatz.

export const KIND = Object.freeze({ VERMIETET: 'vermietet', KAP: 'kap', EN: 'en', WG: 'wg' });
export const AMPEL = Object.freeze({ GREEN: 'gruen', YELLOW: 'gelb', RED: 'rot' });
export const LIMIT = Object.freeze({ YIELD: 'rendite', CAP: 'deckel', BOTH: 'beide' });
/** Regelmarge in Prozent: Grün-Schwelle, wenn die Zielmarge darunter liegt (greenThreshold). */
export const RULE_MARGIN = 20;
/** Gelb-Schwelle in Prozent: Marge ab diesem Wert ist gelb (bis zur grünen Schwelle), darunter rot. */
export const YELLOW_MARGIN = 17.5;

/** Stellplatz-/Garagenmiete: keine Miete, separat vermietet (kommt zur Kaltmiete dazu) oder in der Kaltmiete enthalten. */
export const PARKING_MODE = Object.freeze({ KEINE: 'keine', SEPARAT: 'separat', INKL: 'inkl' });

const KIND_VALUES = Object.values(KIND);
const PARKING_MODE_VALUES = Object.values(PARKING_MODE);
const MINUS = '−';

/**
 * Stellplatz-/Garagenmiete einer Eingabe: 'keine' | 'separat' | 'inkl'. Ohne parkingRentMode gilt der frühere
 * Schalter parkingRentSeparate (true → 'separat', sonst 'keine'). Unbekannter Wert → 'keine'. Rein, wirft nicht.
 */
export function parkingMode(inputs) {
  const src = inputs !== null && typeof inputs === 'object' ? inputs : {};
  if (src.parkingRentMode !== undefined) {
    return PARKING_MODE_VALUES.includes(src.parkingRentMode) ? src.parkingRentMode : PARKING_MODE.KEINE;
  }
  return src.parkingRentSeparate === true ? PARKING_MODE.SEPARAT : PARKING_MODE.KEINE;
}

/**
 * Grüne Schwelle in Prozent: die Zielmarge, mindestens die Regelmarge (20 %). Ohne targetMargin in den Eingaben gilt 20.
 * Bestimmt die grüne Ampel und den nötigen Verkaufspreis. Der Max. Einkaufspreis rechnet dagegen mit der Zielmarge selbst.
 */
export function greenThreshold(inputs) {
  return Math.max(RULE_MARGIN, read(inputs, 'targetMargin'));
}

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

/** Wohnungsanteil je m²: Preis ohne Stellplatz-Verkaufspreis (nie unter 0) ÷ Fläche. */
const flatPerSqm = (price, parkingSalePrice, area) => perSqm(Math.max(0, price - parkingSalePrice), area);

/** Szenario-Faktor: nur endliche Werte ≥ 0 zählen, sonst 1. */
const factorOf = (x) => (Number.isFinite(x) && x >= 0 ? x : 1);

function assertKind(kind) {
  if (!KIND_VALUES.includes(kind)) throw new Error(`Unbekannte Art: ${kind}`);
}

/**
 * Zwischenwerte einer Berechnung: Miete, Grenzen, Verkaufspreis, Kosten und Marge.
 * Gemeinsame Grundlage für compute, evaluatePurchase und scenarios.
 * Das Paket aus Wohnung und Stellplatz: Die Miete für die Rendite-Grenze enthält die Stellplatzmiete (bei 'inkl'
 * und 'separat'), die m²-Verkaufsgrenze enthält den Verkaufspreis des Stellplatzes. salePrice ist damit der
 * Gesamtverkaufspreis inkl. Stellplatz.
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
  // Stellplatzmiete-Modus. Bei Eigennutzer immer 'keine'.
  const mode = kind === KIND.EN ? PARKING_MODE.KEINE : parkingMode(inputs);
  const inkl = mode === PARKING_MODE.INKL;
  // S = Stellplatzmiete gesamt pro Monat (bei WG × Anzahl). Bei 'keine' 0.
  const parkingRentS = mode === PARKING_MODE.KEINE
    ? 0
    : (kind === KIND.WG ? read(inputs, 'parkingCount') * parkingRent : parkingRent);
  // Stellplatzmiete, die in die Rechnung eingeht. Bei 'inkl' steckt sie schon in der eingegebenen Miete und ist auf sie begrenzt.
  let parkingRentMonthly = 0;
  // Nur bei 'inkl': Ist-Miete ohne Stellplatz (nie unter 0).
  let coreIstMonthly = null;

  // Schritt 1: Miete. Kernmiete ohne Stellplatz, Stellplatzmiete je nach Modus.
  let targetRent = null;
  let targetRentPerSqm = null;
  let currentRentPerSqm = null;
  let monthlyRent = null;
  let rentalIncome = 0;
  if (kind === KIND.VERMIETET) {
    const rent = read(inputs, 'rent');
    const surcharge = read(inputs, 'rentSurchargePercent') / 100;
    if (inkl) {
      parkingRentMonthly = Math.min(parkingRentS, rent);
      coreIstMonthly = rent - parkingRentMonthly;
      const sollCore = coreIstMonthly * (1 + surcharge);
      targetRent = scaleRent(sollCore);
      targetRentPerSqm = perSqm(targetRent, area);
      currentRentPerSqm = perSqm(coreIstMonthly, area);
      monthlyRent = scaleRent(sollCore + parkingRentMonthly);
      rentalIncome = rent; // gesamte Ist-Miete inkl. Stellplatz
    } else {
      parkingRentMonthly = parkingRentS;
      const sollRent = rent * (1 + surcharge);
      targetRent = scaleRent(sollRent);
      targetRentPerSqm = perSqm(targetRent, area);
      currentRentPerSqm = perSqm(rent, area);
      monthlyRent = scaleRent(sollRent + parkingRentMonthly);
      rentalIncome = rent + parkingRentMonthly; // Ist-Miete, nicht Soll-Miete; Szenario ändert sie nicht
    }
  } else if (kind === KIND.KAP) {
    const rentPerSqm = read(inputs, 'rentPerSqm');
    const total = area * rentPerSqm;
    if (inkl) {
      parkingRentMonthly = Math.min(parkingRentS, total);
      coreIstMonthly = total - parkingRentMonthly;
      monthlyRent = scaleRent(total);
    } else {
      parkingRentMonthly = parkingRentS;
      monthlyRent = scaleRent(total + parkingRentMonthly);
    }
    currentRentPerSqm = rentPerSqm;
  } else if (kind === KIND.WG) {
    const roomsRent = read(inputs, 'rooms') * read(inputs, 'roomRent');
    if (inkl) {
      parkingRentMonthly = Math.min(parkingRentS, roomsRent);
      coreIstMonthly = roomsRent - parkingRentMonthly;
      monthlyRent = scaleRent(roomsRent);
    } else {
      parkingRentMonthly = parkingRentS;
      monthlyRent = scaleRent(roomsRent + parkingRentMonthly);
    }
  }
  // Gesamtmiete inkl. Stellplatz pro Jahr: Grundlage der Rendite-Grenze und der Rendite des Käufers.
  const annualRent = monthlyRent === null ? null : monthlyRent * 12;

  // Schritt 2: Verkaufspreis des Pakets (Wohnung + Stellplatz). Beide Grenzen gelten inkl. Stellplatz.
  const minYield = read(inputs, 'minYield');
  const maxPerSqm = read(inputs, 'maxSalePricePerSqm');
  // Rendite-Grenze: Gesamtmiete inkl. Stellplatzmiete ÷ Mindestrendite des Käufers.
  let yieldLimit = null;
  if (kind !== KIND.EN && minYield > 0 && annualRent !== null && annualRent > 0) {
    yieldLimit = finiteOrNull(annualRent / (minYield / 100));
  }
  // m²-Verkaufsgrenze: Wohnfläche × max. Verkaufspreis je m², plus Verkaufspreis Stellplatz/Garage. Ohne Preis je m² (0) keine Grenze.
  let capLimit = null;
  if (maxPerSqm > 0 && area > 0) capLimit = area * maxPerSqm + parkingSalePrice;

  const candidates = [yieldLimit, capLimit].filter((x) => x !== null);
  // Gesamtverkaufspreis inkl. Stellplatz: der kleinere Wert der beiden Grenzen.
  const salePrice = candidates.length > 0 ? Math.min(...candidates) : null;

  let limit = null;
  if (yieldLimit !== null && capLimit !== null) {
    if (Math.abs(yieldLimit - capLimit) < 0.005) limit = LIMIT.BOTH;
    else limit = yieldLimit < capLimit ? LIMIT.YIELD : LIMIT.CAP;
  } else if (yieldLimit !== null) {
    limit = LIMIT.YIELD;
  } else if (capLimit !== null) {
    limit = LIMIT.CAP;
  }
  const capMissing = maxPerSqm === 0;
  // Wohnungsanteil je m²: Verkaufspreis ohne Stellplatz-Verkaufspreis, nie unter 0.
  const salePricePerSqm = salePrice === null ? null : flatPerSqm(salePrice, parkingSalePrice, area);
  // Rendite Käufer: Jahresmiete inkl. Stellplatzmiete, geteilt durch den Gesamtverkaufspreis inkl. Stellplatz.
  const buyerYield = kind !== KIND.EN && annualRent !== null && salePrice !== null && salePrice > 0
    ? finiteOrNull((annualRent / salePrice) * 100)
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

  // Schritt 4: Marge. Die Zielmarge wirkt immer direkt (auch unter 20 %).
  const effectiveMargin = read(inputs, 'targetMargin');
  const m = effectiveMargin / 100;

  // Maximaler Einkaufspreis (inkl. Stellplatz): saleNet = (1 + m) × GIK mit GIK = EK (1 + p + φ) + S + O + H
  let maxPurchasePriceExact = null;
  if (saleNet !== null) {
    maxPurchasePriceExact = finiteOrNull((saleNet / (1 + m) - renovationTotal - otherCosts - holdingCosts) / (1 + p + phi));
  }
  const maxPurchasePrice = maxPurchasePriceExact === null ? null : Math.floor(maxPurchasePriceExact + 1e-6);
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
    limit,
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
    parkingRentS,
    parkingMode: mode,
    coreIstMonthly,
    salesCommission,
    saleNet,
    v,
    effectiveMargin,
    greenThreshold: greenThreshold(inputs),
    maxPurchasePriceExact,
    maxPurchasePrice,
    isPurchasePossible,
  };
}

/**
 * Vorwärtsrechnung für einen beliebigen Einkaufspreis P (gleiche Formeln wie compute). P ist der Preis inkl. Stellplatz.
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
  const profit = hasSale ? c.saleNet - totalInvestment : null;
  const marginPercent = hasSale && totalInvestment > 0 ? (profit / totalInvestment) * 100 : null;
  const ampel = trafficLight(marginPercent, c.inputs);
  // Verkaufspreis inkl. Stellplatz, der für die Zielmarge (effectiveMargin) nötig wäre.
  const requiredSalePrice = c.v < 1 ? ((1 + c.effectiveMargin / 100) * totalInvestment) / (1 - c.v) : null;

  return {
    purchasePrice: P,
    parkingSalePrice: c.parkingSalePrice,
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
    // Wie salePricePerSqm (Wohnungsanteil je m²), damit beide m²-Werte vergleichbar sind. Gilt für die Zielmarge.
    requiredSalePricePerSqm: requiredSalePrice === null ? null : flatPerSqm(requiredSalePrice, c.parkingSalePrice, c.area),
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
 * Ampel nach fester Margen-Stufe: grün ab der grünen Schwelle (greenThreshold: Zielmarge, mindestens 20 %),
 * gelb ab 17,5 % bis unter die grüne Schwelle, rot darunter. Ohne berechenbare Marge rot.
 */
export function trafficLight(marginPercent, inputs) {
  if (typeof marginPercent !== 'number' || !Number.isFinite(marginPercent)) return AMPEL.RED;
  if (marginPercent >= greenThreshold(inputs) - 1e-9) return AMPEL.GREEN;
  if (marginPercent >= YELLOW_MARGIN - 1e-9) return AMPEL.YELLOW;
  return AMPEL.RED;
}

/**
 * Vorwärtsrechnung für einen Einkaufspreis P. Liefert Nebenkosten, Finanzierung, GIK, Gewinn, Marge,
 * Ampel und den Verkaufspreis inkl. Stellplatz, der für die grüne Marge nötig wäre.
 */
export function evaluatePurchase(kind, inputs, purchasePrice) {
  const P = Number.isFinite(purchasePrice) ? purchasePrice : 0;
  return evaluateWith(context(kind, inputs), P);
}

/**
 * Berechnung aller Ergebnisse. Der Max. Einkaufspreis ist das einzige berechnete Preisergebnis und gilt inkl. Stellplatz.
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
    limit: c.limit,
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
    parkingRentTotal: c.parkingRentS,
    parkingMode: c.parkingMode,
    parkingCoreMonthly: c.coreIstMonthly,
    salesCommission: c.salesCommission,
    saleNet: c.saleNet,
    effectiveMargin: c.effectiveMargin,
    greenThreshold: c.greenThreshold,
    maxPurchasePriceExact: exact,
    maxPurchasePrice: c.maxPurchasePrice,
    maxPurchasePricePerSqm: perSqm(c.maxPurchasePrice, c.area),
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
