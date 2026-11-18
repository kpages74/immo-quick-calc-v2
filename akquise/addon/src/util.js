// Gemeinsame Hilfsfunktionen (kein DOM). Zahlen im deutschen Format (1.234,56).

/** Text oder Zahl -> Zahl; null bei fehlender oder ungültiger Eingabe. */
export function parseDeNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined) return null;
  let t = String(v).replace(/[^\d.,]/g, '');
  if (!t) return null;
  if (t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Erste Zahl in einem Text (deutsches Format) oder null. */
export function parseFirstNumber(text) {
  const m = String(text || '').match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+\.\d{1,2}(?!\d)|\d+(?:,\d+)?/);
  return m ? parseDeNumber(m[0]) : null;
}

export function fmtEur(x) {
  return Math.round(x).toLocaleString('de-DE') + ' €';
}

export function fmtNum(x, d) {
  const n = d === undefined ? 2 : d;
  return x.toLocaleString('de-DE', { minimumFractionDigits: n, maximumFractionDigits: n });
}
