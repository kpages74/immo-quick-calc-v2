// Richtpreis-Block im Formular: Suche in der eigenen Preisliste, Quelle und Stand, Link zum Preisatlas.
// Wird einmal beim Formularaufbau erzeugt und danach nur per update(session) aktualisiert.
// Anzeigetexte kommen aus js/present.js (presentPriceText), Suche und Quelle aus js/pricelist.js.
import { setInput, setPriceSource } from '../session.js';
import { presentPriceText } from '../present.js';
import { searchPriceList, priceListLabel, priceSourceFor } from '../pricelist.js';
import { el } from './controls.js';
import { showStatus } from './dialogs.js';

const PRICE_ATLAS = 'https://www.homeday.de/de/preisatlas';
const HIT_LIMIT = 8;

/** Textfeld mit Beschriftung, in ein Label verpackt wie in app.js. */
function labeled(text, input) {
  const wrap = el('label', 'text-field');
  wrap.append(el('span', 'label', text), input);
  return wrap;
}

/**
 * Richtpreis-Block. ctx: { getSession, commit, getPriceList }. Rückgabe { node, update } wie die anderen Widgets.
 */
export function createPriceBox(ctx) {
  const root = el('div', 'row pricebox');
  root.append(el('div', 'pb-title', 'Richtpreis'));

  const noList = el('p', 'hint', 'Noch keine Preisliste. Import unter Einstellungen.');

  const search = el('input', 'text-input');
  search.type = 'search';
  search.autocomplete = 'off';
  const results = el('div', 'pb-results');
  const searchBox = el('div', 'pb-search');
  searchBox.append(labeled('Stadtteil, Ort oder PLZ', search), results);

  const source = el('input', 'text-input');
  source.type = 'text';
  source.maxLength = 200;
  source.autocomplete = 'off';
  const date = el('input', 'text-input');
  date.type = 'text';
  date.maxLength = 200;
  date.autocomplete = 'off';
  date.placeholder = 'z. B. 11/2026';

  const atlas = el('a', 'btn', 'Im Preisatlas nachsehen');
  atlas.href = PRICE_ATLAS;
  atlas.target = '_blank';
  atlas.rel = 'noopener noreferrer';

  root.append(
    noList,
    searchBox,
    labeled('Quelle des Richtpreises', source),
    labeled('Stand', date),
    atlas,
    el('p', 'hint', 'Wert von Hand eintragen und Quelle mit Datum notieren.'),
  );

  /** Ausgewählten Treffer übernehmen: Richtpreis und Quelle in einer Änderung. */
  function apply(row) {
    const next = setPriceSource(setInput(ctx.getSession(), 'maxSalePricePerSqm', row.mittel), priceSourceFor(row));
    search.value = '';
    ctx.commit(next);
    showStatus('Richtpreis übernommen');
  }

  function hitItem(row) {
    const item = el('li', 'pb-item');
    const button = el('button', 'pb-hit');
    button.type = 'button';
    button.append(el('span', 'pb-hit-name', priceListLabel(row)), el('span', 'pb-hit-price', presentPriceText(row)));
    button.addEventListener('click', () => apply(row));
    item.append(button);
    return item;
  }

  // Trefferliste nur neu aufbauen, wenn sich Suchtext oder Liste ändern. So bleiben die Knöpfe beim Antippen erhalten.
  let shownRows = null;
  let shownQuery = null;
  function refreshResults() {
    const rows = ctx.getPriceList().rows;
    const query = search.value.trim();
    if (rows === shownRows && query === shownQuery) return;
    shownRows = rows;
    shownQuery = query;
    results.replaceChildren();
    if (query === '') return;
    const hits = searchPriceList(rows, query, HIT_LIMIT);
    if (hits.length === 0) {
      results.append(el('p', 'hint', 'Kein Eintrag gefunden.'));
      return;
    }
    const list = el('ul', 'pb-list');
    for (const row of hits) list.append(hitItem(row));
    results.append(list);
  }

  search.addEventListener('input', refreshResults);
  source.addEventListener('input', () => {
    ctx.commit(setPriceSource(ctx.getSession(), { source: source.value, date: date.value }));
  });
  date.addEventListener('input', () => {
    ctx.commit(setPriceSource(ctx.getSession(), { source: source.value, date: date.value }));
  });

  const update = (s) => {
    const hasRows = ctx.getPriceList().rows.length > 0;
    noList.hidden = hasRows;
    searchBox.hidden = !hasRows;
    const ps = s.calc.priceSource;
    if (document.activeElement !== source && source.value !== ps.source) source.value = ps.source;
    if (document.activeElement !== date && date.value !== ps.date) date.value = ps.date;
    refreshResults();
  };

  return { node: root, update };
}
