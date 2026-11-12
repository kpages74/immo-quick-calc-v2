// Bereich „Objekte“: gespeicherte Kalkulationen suchen, öffnen, duplizieren und löschen.
// Anzeigetexte aus js/present.js (presentObjectRow), Liste und Suche aus js/library.js.
import { searchObjects, duplicateObject, removeObject } from '../library.js';
import { presentObjectRow } from '../present.js';
import { loadCalculation } from '../session.js';
import { el } from './controls.js';
import { confirmDialog, showStatus, SAVE_FAILED } from './dialogs.js';
import { confirmDiscard } from './actions.js';

const $ = (id) => document.getElementById(id);
let ctx = null;
let searchInput = null;
let listBox = null;

/** Einmal beim Start: Suchfeld und Liste aufbauen. ctx: { getSession, getObjects, setObjects, replaceSession, showView, render }. */
export function initObjects(context) {
  ctx = context;
  searchInput = el('input', 'text-input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Suchen nach Name oder Adresse';
  searchInput.setAttribute('aria-label', 'Suchen nach Name oder Adresse');
  searchInput.autocomplete = 'off';
  searchInput.addEventListener('input', renderObjects);

  const searchRow = el('div', 'row search-row');
  searchRow.append(searchInput);
  listBox = el('div', 'obj-box');
  $('objects-body').replaceChildren(searchRow, listBox);
}

/** Liste neu zeichnen: beim Anzeigen des Bereichs, bei Suche und nach jeder Änderung. */
export function renderObjects() {
  if (!listBox) return;
  const all = ctx.getObjects();
  listBox.replaceChildren();
  if (all.length === 0) {
    listBox.append(el('p', 'empty', 'Noch keine gespeicherten Objekte. Im Rechner auf „Speichern“ tippen.'));
    return;
  }
  const hits = searchObjects(all, searchInput.value);
  if (hits.length === 0) {
    listBox.append(el('p', 'empty', 'Kein Objekt gefunden.'));
    return;
  }
  const currentId = ctx.getSession().calc.id;
  const list = el('ul', 'obj-list');
  for (const calc of hits) list.append(objectItem(calc, currentId));
  listBox.append(list);
}

function actionButton(text, label, className, onClick) {
  const button = el('button', className, text);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

function objectItem(calc, currentId) {
  const row = presentObjectRow(calc);
  const item = el('li', 'obj-item');

  const head = el('div', 'obj-head');
  head.append(el('span', 'obj-name', row.name));
  if (calc.id === currentId) head.append(el('span', 'obj-open', 'Geöffnet'));
  item.append(head);

  if (row.address) item.append(el('p', 'obj-address', row.address));
  item.append(el('p', 'obj-meta', `${row.kindLabel} · ${row.date}`));

  const status = el('p', 'obj-status');
  const dot = el('span', `dot dot-${row.ampel}`);
  dot.setAttribute('aria-hidden', 'true');
  status.append(dot, el('span', null, row.ampelLabel));
  item.append(status);

  const price = el('p', 'obj-price');
  price.append(el('span', null, 'Max. Einkaufspreis '), el('strong', null, row.maxPrice));
  item.append(price);

  const actions = el('div', 'obj-actions');
  actions.append(
    actionButton('Öffnen', `Öffnen: ${row.name}`, 'btn', () => openObject(calc)),
    actionButton('Duplizieren', `Duplizieren: ${row.name}`, 'btn', () => duplicate(calc.id)),
    actionButton('Löschen', `Löschen: ${row.name}`, 'btn btn-danger', () => remove(calc)),
  );
  item.append(actions);
  return item;
}

async function openObject(calc) {
  if (!(await confirmDiscard())) return;
  ctx.replaceSession(loadCalculation(calc));
  ctx.showView('rechner');
}

function duplicate(id) {
  const result = duplicateObject(ctx.getObjects(), id);
  if (result.copy !== null) {
    showStatus(ctx.setObjects(result.list) ? 'Kopie angelegt' : SAVE_FAILED);
  }
  ctx.render();
  renderObjects();
}

async function remove(calc) {
  const name = calc.name || 'Ohne Namen';
  const ok = await confirmDialog({
    title: 'Objekt löschen?',
    text: `„${name}“ wird aus den gespeicherten Objekten entfernt.`,
    okLabel: 'Löschen',
    danger: true,
  });
  if (!ok) return;
  showStatus(ctx.setObjects(removeObject(ctx.getObjects(), calc.id)) ? 'Objekt gelöscht' : SAVE_FAILED);
  ctx.render();
  renderObjects();
}
