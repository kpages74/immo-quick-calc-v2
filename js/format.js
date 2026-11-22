// Formatierung und Zahleneingabe der Immo Quick-Calc Web-App (Etappe 2).
// Block aus calc.js („MARK: - Formatierung“ bis Dateiende) unverändert übernommen.
// Keine DOM-Zugriffe. Exporte: Fmt, fieldDisplay, parseNumber.

// MARK: - Formatierung (de-DE, kaufmännisch gerundet)

const DASH = '–';
const NBSP = ' ';

function groupThousands(intText) {
  return intText.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Festkommazahl mit deutschem Format. Rundung kaufmännisch (halbe Werte von der Null weg).
 * Rundet über eine dezimale Zwischendarstellung, damit z. B. 1,005 als „1,01“ erscheint.
 */
function formatFixed(value, digits, grouped = true) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DASH;
  const factor = 10 ** digits;
  const scaled = Math.round(Number((Math.abs(value) * factor).toPrecision(12)));
  const intPart = Math.floor(scaled / factor);
  const fracPart = scaled - intPart * factor;
  const sign = value < 0 && scaled !== 0 ? '-' : '';
  const intText = grouped ? groupThousands(String(intPart)) : String(intPart);
  if (digits === 0) return sign + intText;
  return `${sign}${intText},${String(fracPart).padStart(digits, '0')}`;
}

function withUnit(value, digits, unit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DASH;
  return formatFixed(value, digits) + NBSP + unit;
}

export const Fmt = Object.freeze({
  /** „137.723,40 €“ */
  currency: (value) => withUnit(value, 2, '€'),
  /** „53,23 %“ */
  percent: (value) => withUnit(value, 2, '%'),
  /** „1.995,99 €/m²“ */
  perSqm: (value) => withUnit(value, 2, '€/m²'),
  /** Ganze Euro: „111.721 €“. „–“ bei nicht endlichem Wert oder null. */
  euro: (value) => withUnit(value, 0, '€'),
  /** „92.307,69 € je Zimmer“: Wert geteilt durch die Zimmerzahl. „–“ ohne Wert oder bei 0 Zimmern. */
  perRoom: (value, rooms) => (typeof value === 'number' && Number.isFinite(value) && rooms > 0
    ? withUnit(value / rooms, 2, '€') + ' je Zimmer'
    : DASH),
  /** Anzeige im Eingabefeld mit fester Stellenzahl: „294.456“, „15,0“ */
  fieldNumber: (value, digits) => formatFixed(value, digits),
  /** Datum in Ortszeit: „12.11.2026“. „–“ bei fehlendem oder ungültigem ISO-Text. */
  date: (iso) => {
    if (typeof iso !== 'string') return DASH;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return DASH;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  },
  /** Bearbeitungstext: ohne Tausenderpunkte, bis 2 Nachkommastellen, ohne überflüssige Nullen. */
  editingNumber: (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DASH;
    const text = formatFixed(value, 2, false);
    if (!text.includes(',')) return text;
    return text.replace(/0+$/, '').replace(/,$/, '');
  },
});

/**
 * Anzeige eines Zahlenfeldes ohne Fokus mit Einheit, wie FieldSpec.displayText in der App:
 * „250.000 €“, „60 m²“, „10,0 %“, „4.000 €/m²“, Soll-Miete „+15,0 %“. Geschütztes Leerzeichen vor der Einheit.
 */
const FIELD_SUFFIX = Object.freeze({ euro: '€', euroPerSqm: '€/m²', squareMeter: 'm²', percent: '%', months: 'Monate', rooms: 'Zimmer', pieces: 'Stk.' });
export function fieldDisplay(spec, value) {
  if (spec.unit === 'bool') return value === true ? 'Ja' : 'Nein';
  if (spec.unit === 'choice') {
    const option = spec.options.find((o) => o.value === value);
    return option ? option.label : DASH;
  }
  const sign = spec.signed && value >= 0 ? '+' : '';
  return sign + Fmt.fieldNumber(value, spec.digits) + NBSP + FIELD_SUFFIX[spec.unit];
}

// MARK: - Zahleneingabe (NumberParser.swift)

/**
 * Liest Zahlen in deutscher Schreibweise („1.234,56“, „15,5 %“, „200.000 €“).
 * Gibt null zurück bei leerer Eingabe, Buchstaben, mehreren Kommas oder negativen Werten.
 */
export function parseNumber(text) {
  let cleaned = '';
  for (const ch of String(text)) {
    if (/\s/.test(ch) || ch === ' ' || ch === ' ' || ch === '€' || ch === '%') continue;
    cleaned += ch;
  }
  // Ein führendes Pluszeichen ist erlaubt („+15“ bei Soll-Miete).
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
  if (cleaned === '') return null;
  if (!/^[0-9.,]+$/.test(cleaned)) return null;

  const commaCount = (cleaned.match(/,/g) || []).length;
  if (commaCount > 1) return null;

  let normalized;
  if (commaCount === 1) {
    // Komma ist der Dezimaltrenner, Punkte sind Tausendertrenner.
    const idx = cleaned.indexOf(',');
    const integerPart = cleaned.slice(0, idx).replace(/\./g, '');
    const fractionPart = cleaned.slice(idx + 1);
    if (!/^[0-9]*$/.test(fractionPart)) return null;
    if (integerPart === '' && fractionPart === '') return null;
    const integerText = integerPart === '' ? '0' : integerPart;
    normalized = fractionPart === '' ? integerText : `${integerText}.${fractionPart}`;
  } else {
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (dotCount === 1) {
      // Ein einzelner Punkt mit 1–2 Ziffern dahinter gilt als Dezimalpunkt.
      const digitsAfter = cleaned.length - cleaned.indexOf('.') - 1;
      normalized = digitsAfter >= 1 && digitsAfter <= 2 ? cleaned : cleaned.replace(/\./g, '');
    } else {
      // Mehrere Punkte oder Gruppen zu drei Ziffern: Tausendertrenner.
      normalized = cleaned.replace(/\./g, '');
    }
  }

  if (!/[0-9]/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
