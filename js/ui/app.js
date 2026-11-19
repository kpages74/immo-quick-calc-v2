// Einstieg der Oberfläche Immo Quick-Calc 2.0. Besitzer der Sitzung und der gespeicherten Listen (Objekte, Preisliste).
// Zustand ist eine Sitzung aus js/session.js, gespeichert über js/store.js. Alle Texte kommen aus js/present.js,
// die Feldanzeige aus js/format.js, Eingaben werden mit parseNumber gelesen. Hier steht keine Formel.
// Jede Änderung läuft über js/session.js, danach speichern und neu zeichnen.
import {
  loadSession, saveSession, loadDefaults, loadObjects, saveObjects,
  loadPriceList, savePriceList, clearPriceList as removePriceList,
} from '../store.js';
import { setInput, setText, setMode, switchKind, resetGroup } from '../session.js';
import { presentResult, presentScenarios, fieldHint, visibleFields, fieldRange } from '../present.js';
import { FIELDS, GROUPS, setDefaultOverrides } from '../fields.js';
import { Fmt, fieldDisplay, parseNumber } from '../format.js';
import { cleanLibrary } from '../library.js';
import { cleanPriceList } from '../pricelist.js';
import { el, setHint, fitText, fitPill } from './controls.js';
import { installScrollKeeper, tapOutsideBlurs } from './scroll.js';
import { initDialogs } from './dialogs.js';
import { initObjects, renderObjects } from './objects.js';
import { initSettings, renderSettings } from './settings.js';
import { initActions, updateActions, checkIncomingLink } from './actions.js';
import { createPriceBox } from './pricebox.js';
import { initQuickie, isQuickieActive, setQuickieActive, renderQuickie } from './quickie.js';
import { createExposeBox } from './exposebox.js';

const AMPEL_TEXT = Object.freeze({ gruen: 'Grün', gelb: 'Gelb', rot: 'Rot' });
const VIEWS = Object.freeze(['rechner', 'objekte', 'einstellungen']);

const $ = (id) => document.getElementById(id);
const formEl = $('form');

// Eigene Standardwerte zuerst, danach die Sitzung: neue Kalkulationen nutzen sonst die Werksstandards.
setDefaultOverrides(loadDefaults());
let session = loadSession();
let objects = loadObjects();
let pricelist = loadPriceList();
let formKey = '';
let widgets = [];
let scenarioBox = null;
const groupOpen = {};
// Offene Erklärungen überleben das Neuzeichnen. Schlüssel: field:<Feld> oder note:<Nummer>.
const openHelp = new Set();
// Markierungen aus „Exposé einlesen“ im Rechner: Feldschlüssel → 'filled' (übernommen) | 'missing' (fehlt).
// Sie gelten, bis das Feld selbst geändert oder die Art gewechselt wird (marksKind = Art der Markierung).
const marks = new Map();
let marksKind = null;

// MARK: - Zustand

/** Jede Änderung: neue Sitzung übernehmen, speichern, neu zeichnen. */
function commit(next) {
  session = next;
  saveSession(undefined, session);
  render();
}

/** Neue Sitzung setzen (Objekt öffnen, Link, Neu, Zurücksetzen): Formular neu aufbauen, speichern, neu zeichnen. */
function replaceSession(next) {
  session = next;
  formKey = '';
  $('import-banner').hidden = true; // Hinweis „Übernommen aus …“ gehört nur zur zuletzt übernommenen Kalkulation
  saveSession(undefined, session);
  render();
}

/**
 * Ergebnis des Exposé-Blocks im Rechner (js/ui/exposebox.js, Werte je Seite aus js/expose.js): Werte über die Sitzung
 * übernehmen, gefundene Felder grün, fehlende gelb markieren. Ein Kaufpreis schaltet auf „Angebot prüfen“.
 */
function uebernehmenExpose(res) {
  marks.clear();
  marksKind = session.calc.kind;
  if (!res.werte) {
    render();
    return;
  }
  let next = session;
  for (const [key, value] of Object.entries(res.werte)) {
    if (value === null) {
      marks.set(key, 'missing');
    } else {
      marks.set(key, 'filled');
      next = setInput(next, key, value);
    }
  }
  if (res.werte.offerPrice !== null) next = setMode(next, 'check');
  commit(next);
}

/** Exposé-Block im Rechner: steht in der Eingabespalte über dem Formular, bleibt beim Neuaufbau erhalten. */
const exposeRechner = createExposeBox({ getArt: () => session.calc.kind, onErgebnis: uebernehmenExpose });

/** Zugriff für die Module der Oberfläche. Speichern der Listen geschieht über js/store.js. */
const ctx = {
  getSession: () => session,
  commit,
  replaceSession,
  showView,
  render,
  getObjects: () => objects,
  setObjects(list) {
    objects = cleanLibrary(list);
    return saveObjects(undefined, objects);
  },
  getPriceList: () => pricelist,
  setPriceList(data) {
    pricelist = cleanPriceList(data);
    return savePriceList(undefined, pricelist);
  },
  clearPriceList() {
    pricelist = cleanPriceList(null);
    return removePriceList(undefined);
  },
  /** Quickie beenden (ohne Neuzeichnen): z. B. vor dem Öffnen eines Objekts über einen Link. */
  leaveQuickie: () => setQuickieActive(false),
};

/** Anzeige eines Zahlenfeldes ohne Fokus. Ohne Wert (Angebotspreis) leer. */
function displayOf(key, value) {
  if (value === null || value === undefined) return '';
  return fieldDisplay(FIELDS[key], value);
}

/** Schlüssel, bei dessen Änderung sich die Menge der sichtbaren Felder ändert: nur dann wird das Formular neu aufgebaut. */
// Erlaubt einen Zeilenumbruch nach dem Schrägstrich (unsichtbares Trennzeichen), damit schmale Bildschirme nicht mitten im Wort trennen.
const breakable = (text) => String(text).replace(/\//g, "/\u200b");
const formKeyOf = (s) => `${s.calc.kind}|${s.mode}|${s.calc.inputs.softened === true}|${s.calc.inputs.parkingRentSeparate === true}`;

// MARK: - Zahlenfeld, Schalter, Textfeld

/**
 * Fragezeichen-Knopf und Erklärungskasten. Der Kasten wird nur ein- oder ausgeblendet, nicht neu aufgebaut,
 * damit Scrollposition und Formular beim Klick unverändert bleiben.
 */
function helpPair(key, label, text) {
  const id = `help-${key.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  const box = el('div', 'help-box', text);
  box.id = id;
  box.hidden = !openHelp.has(key);

  // Das Zeichen „?“ kommt aus dem CSS (::before), der Knopf bleibt ohne Text.
  const button = el('button', 'help-btn');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-controls', id);
  button.setAttribute('aria-expanded', String(!box.hidden));

  const toggle = () => {
    const open = !openHelp.has(key);
    if (open) openHelp.add(key);
    else openHelp.delete(key);
    box.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', toggle);
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openHelp.has(key)) {
      event.preventDefault();
      toggle();
    }
  });
  return { button, box };
}

function numberRow(key) {
  const spec = FIELDS[key];
  const root = el('div', 'row');
  const head = el('div', 'row-head');
  const labelWrap = el('div', 'label-wrap');
  const labelLine = el('div', 'label-line');
  labelLine.append(el('span', 'label', breakable(spec.label)));
  let helpBox = null;
  if (spec.help) {
    const pair = helpPair(`field:${key}`, `Erklärung: ${spec.label}`, spec.help);
    labelLine.append(pair.button);
    helpBox = pair.box;
  }
  labelWrap.append(labelLine);

  const pill = el('input', 'pill');
  pill.type = 'text';
  pill.inputMode = 'decimal';
  pill.enterKeyHint = 'done';
  pill.autocomplete = 'off';
  pill.spellcheck = false;
  pill.setAttribute('aria-label', spec.label);
  pill.setAttribute('data-number-field', '');
  pill.dataset.focusKey = `pill:${key}`;
  if (key === 'offerPrice') pill.placeholder = '… €';
  head.append(labelWrap, pill);

  const slider = el('input', 'slider');
  slider.type = 'range';
  slider.setAttribute('aria-label', spec.label);
  slider.dataset.focusKey = `slider:${key}`;

  const hint = el('div', 'hint');
  root.append(head, slider, hint);
  if (helpBox) root.append(helpBox);

  // Bearbeitungstext beim Fokus. null = nicht im Bearbeitungsmodus.
  let editStart = null;

  // Eigene Eingabe in dieses Feld hebt die Markierung aus dem Exposé auf.
  const unmark = () => {
    marks.delete(key);
    pill.classList.remove('filled', 'missing');
  };

  pill.addEventListener('focus', () => {
    const value = session.calc.inputs[key];
    editStart = value === null || value === undefined ? '' : Fmt.editingNumber(value);
    pill.value = editStart;
    fitPill(pill);
    pill.select();
  });

  // Übernahme nur bei geändertem und gültigem Text. Ungültig oder leer: alter Wert.
  pill.addEventListener('blur', () => {
    const start = editStart;
    editStart = null;
    if (start !== null && pill.value !== start) {
      const text = pill.value.trim();
      if (key === 'offerPrice' && text === '') {
        commit(setInput(session, key, null));
        return;
      }
      const parsed = parseNumber(text);
      if (parsed !== null) {
        commit(setInput(session, key, parsed));
        return;
      }
    }
    pill.value = displayOf(key, session.calc.inputs[key]);
    fitPill(pill);
  });

  pill.addEventListener('input', unmark);

  pill.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      pill.blur();
    }
  });

  slider.addEventListener('input', () => {
    unmark();
    commit(setInput(session, key, Number(slider.value)));
  });

  const update = (s) => {
    const value = s.calc.inputs[key];
    // Das gerade bearbeitete Feld wird nicht überschrieben.
    if (document.activeElement !== pill) {
      pill.value = displayOf(key, value);
      fitPill(pill);
    }
    const range = fieldRange(s, key);
    if (range) {
      slider.min = String(range.min);
      slider.max = String(range.max);
      slider.step = String(range.step);
      const span = range.max - range.min;
      const v = value ?? 0;
      const fraction = span > 0 ? Math.min(Math.max((v - range.min) / span, 0), 1) : 0;
      slider.style.setProperty('--pos', `${fraction * 100}%`);
    }
    slider.value = String(value ?? 0);
    setHint(hint, fieldHint(s, key));
    const mark = marks.get(key);
    pill.classList.toggle('filled', mark === 'filled');
    pill.classList.toggle('missing', mark === 'missing');
  };

  return { node: root, update };
}

function switchRow(key) {
  const spec = FIELDS[key];
  const root = el('div', 'row row-switch');
  const head = el('div', 'row-head');
  const labelWrap = el('div', 'label-wrap');
  const labelLine = el('div', 'label-line');
  labelLine.append(el('span', 'label', breakable(spec.label)));
  let helpBox = null;
  if (spec.help) {
    const pair = helpPair(`field:${key}`, `Erklärung: ${spec.label}`, spec.help);
    labelLine.append(pair.button);
    helpBox = pair.box;
  }
  labelWrap.append(labelLine);

  const btn = el('button', 'switch');
  btn.type = 'button';
  btn.setAttribute('role', 'switch');
  btn.setAttribute('aria-label', spec.label);
  btn.dataset.focusKey = `switch:${key}`;
  btn.append(el('span', 'switch-knob'));
  btn.addEventListener('click', () => {
    commit(setInput(session, key, session.calc.inputs[key] !== true));
  });

  head.append(labelWrap, btn);
  root.append(head);
  if (helpBox) root.append(helpBox);

  const update = (s) => {
    const on = s.calc.inputs[key] === true;
    btn.setAttribute('aria-checked', String(on));
    btn.classList.toggle('is-on', on);
  };
  return { node: root, update };
}

function textRow(label, key, max) {
  const root = el('div', 'row');
  const wrap = el('label', 'text-field');
  wrap.append(el('span', 'label', label));
  const input = el('input', 'text-input');
  input.type = 'text';
  input.maxLength = max;
  input.autocomplete = 'off';
  input.dataset.focusKey = `text:${key}`;
  input.addEventListener('input', () => {
    commit(setText(session, key, input.value));
  });
  wrap.append(input);
  root.append(wrap);

  const update = (s) => {
    const value = s.calc[key] ?? '';
    if (document.activeElement !== input && input.value !== value) input.value = value;
  };
  return { node: root, update };
}

/** Notizfeld zum Objekt. Erscheint im PDF. */
function noteRow() {
  const root = el('div', 'row');
  const wrap = el('label', 'text-field');
  wrap.append(el('span', 'label', 'Notiz'));
  const area = el('textarea', 'text-input text-area');
  area.rows = 3;
  area.maxLength = 2000;
  area.addEventListener('input', () => {
    commit(setText(session, 'note', area.value));
  });
  wrap.append(area);
  root.append(wrap, el('div', 'hint', 'Erscheint im PDF.'));

  const update = (s) => {
    const value = s.calc.note ?? '';
    if (document.activeElement !== area && area.value !== value) area.value = value;
  };
  return { node: root, update };
}

// MARK: - Formular

function addWidget(parent, widget) {
  parent.append(widget.node);
  widgets.push(widget);
}

/** Abschnitt als Details-Element mit Titel und Knopf „Standard“. Der Projekt-Abschnitt startet eingeklappt. */
function groupBody(group) {
  const details = el('details', 'group');
  details.dataset.group = group.key;
  details.open = groupOpen[group.key] ?? !group.collapsed;
  details.addEventListener('toggle', () => {
    groupOpen[group.key] = details.open;
  });
  details.append(el('summary', 'group-title', group.title));

  const body = el('div', 'group-body');
  const bar = el('div', 'group-bar');
  const standard = el('button', 'std-btn', 'Standard');
  standard.type = 'button';
  standard.dataset.focusKey = `std:${group.key}`;
  standard.addEventListener('click', () => {
    commit(resetGroup(session, group.key));
  });
  bar.append(standard);
  body.append(bar);
  details.append(body);
  return { details, body };
}

function buildForm() {
  // Fokus auf Schalter oder Standard-Knopf merken, damit er nach dem Neuaufbau erhalten bleibt.
  const focused = document.activeElement?.dataset?.focusKey ?? '';
  widgets = [];
  scenarioBox = null;
  formEl.replaceChildren();

  const s = session;
  const visible = visibleFields(s);
  // Im Modus „Angebot prüfen“ steht der Angebotspreis oben.
  const order = s.mode === 'check'
    ? [...GROUPS.filter((g) => g.key === 'pruefung'), ...GROUPS.filter((g) => g.key !== 'pruefung')]
    : GROUPS;

  for (const group of order) {
    const specs = visible.filter((f) => f.group === group.key);
    const isObjekt = group.key === 'objekt';
    const isSzenarien = group.key === 'szenarien';
    if (specs.length === 0 && !isObjekt && !isSzenarien) continue;

    const { details, body } = groupBody(group);
    if (isObjekt) {
      addWidget(body, textRow('Objektname', 'name', 200));
      addWidget(body, textRow('Adresse', 'address', 200));
      addWidget(body, noteRow());
    }
    for (const spec of specs) {
      addWidget(body, spec.unit === 'bool' ? switchRow(spec.key) : numberRow(spec.key));
      // Richtpreis-Block direkt nach dem Verkaufspreis je m² (Deckel).
      if (spec.key === 'maxSalePricePerSqm') addWidget(body, createPriceBox(ctx));
    }
    if (isSzenarien) {
      scenarioBox = el('div', 'scen');
      body.append(scenarioBox);
    }
    formEl.append(details);
  }

  if (focused.startsWith('switch:') || focused.startsWith('std:')) {
    formEl.querySelector(`[data-focus-key="${focused}"]`)?.focus();
  }
}

function renderScenarios() {
  if (!scenarioBox) return;
  const rows = presentScenarios(session);
  const withOffer = session.mode === 'check' && rows.some((r) => r.ampel !== null);
  const table = el('table', 'scen-table');
  const thead = el('thead');
  const headRow = el('tr');
  const heads = ['Szenario', withOffer ? 'Marge' : 'Wert', withOffer ? 'Gewinn' : 'Abweichung'];
  if (withOffer) heads.push('Ampel');
  for (const text of heads) headRow.append(el('th', null, text));
  thead.append(headRow);
  table.append(thead);

  const tbody = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    tr.append(el('td', 'scen-label', row.label));
    tr.append(el('td', 'num', row.value));
    tr.append(el('td', 'num', row.delta));
    if (withOffer) {
      const td = el('td', 'scen-ampel');
      td.append(el('span', `dot dot-${row.ampel}`), el('span', null, AMPEL_TEXT[row.ampel] ?? ''));
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  scenarioBox.replaceChildren(table);
}

// MARK: - Ergebniskarte

function verdict(r) {
  const box = el('div', 'verdict');
  const dot = el('span', `dot dot-${r.ampel}`);
  dot.setAttribute('aria-hidden', 'true');
  box.append(dot, el('span', 'verdict-text', `${r.ampelLabel} · ${r.ampelText}`));
  return box;
}

function cell(caption, value, sub) {
  const box = el('div', 'cell');
  box.append(el('span', 'cap', caption), el('span', 'fig fit', value));
  if (sub) box.append(el('span', 'sub', sub));
  return box;
}

function limitLine(r) {
  const text = [r.limitText, r.bufferText].filter(Boolean).join(' · ');
  if (!text) return null;
  const line = el('p', 'limit', text);
  if (!r.limitHelp) return line;
  // Nur das „?“ hinter der Zeile; die Erklärung erscheint beim Antippen als Pop-up über der Seite.
  const button = el('button', 'help-btn');
  button.type = 'button';
  button.setAttribute('aria-label', 'Erklärung: Rendite-Grenze und m²-Deckel');
  button.setAttribute('aria-haspopup', 'dialog');
  button.addEventListener('click', () => showHelpPopup('Rendite-Grenze und m²-Deckel', r.limitHelp));
  line.append(' ', button);
  return line;
}

/** Pop-up mit Erklärtext. Schließt über den Knopf, Escape oder Tippen neben das Fenster. */
function showHelpPopup(title, text) {
  let dlg = document.getElementById('dlg-help');
  if (!dlg) {
    dlg = el('dialog', 'help-dialog');
    dlg.id = 'dlg-help';
    dlg.setAttribute('aria-labelledby', 'help-title');
    const head = el('h2', 'dlg-title');
    head.id = 'help-title';
    const body = el('p', 'help-dialog-text');
    const actions = el('div', 'dlg-actions');
    const close = el('button', 'btn', 'Schließen');
    close.type = 'button';
    close.addEventListener('click', () => dlg.close());
    actions.append(close);
    dlg.append(head, body, actions);
    dlg.addEventListener('click', (event) => {
      if (event.target === dlg) dlg.close(); // Tippen auf den Hintergrund
    });
    document.body.append(dlg);
  }
  dlg.querySelector('#help-title').textContent = title;
  dlg.querySelector('.help-dialog-text').textContent = text;
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
}

/** Zeile „Mit Stellplatz: …“ nur bei Stellplatz-Verkaufspreis. */
function parkingLineNode(r) {
  return r.parkingLine ? el('p', 'limit', r.parkingLine) : null;
}

/** Hinweise stehen außerhalb der Karte, in #result-notes. */
function renderNotes(r) {
  const box = $('result-notes');
  if (r.notes.length === 0) {
    box.replaceChildren();
    box.hidden = true;
    return;
  }
  const list = el('ul', 'notes');
  r.notes.forEach((note, i) => {
    const item = el('li', 'notes-item');
    item.append(el('span', null, note));
    const help = r.noteHelp[i];
    if (help) {
      const pair = helpPair(`note:${i}`, 'Erklärung zum Hinweis', help);
      item.append(pair.button, pair.box);
    }
    list.append(item);
  });
  box.replaceChildren(list);
  box.hidden = false;
}

/** Ansicht „Maximum ermitteln“ (auch Modus Angebot ohne Angebotspreis). */
function maxView(r, kind) {
  const hero = el('div', 'hero');
  hero.append(el('span', 'cap', 'Max. Einkaufspreis'), el('span', 'hero-fig fit', r.maxPrice));
  // Eine Zeile: €/m² und Gebot, das Gebot nur bei vorhandenem Wert.
  hero.append(el('span', 'sub', [r.maxPricePerSqm, r.bid].filter(Boolean).join(' · ')));

  const cells = el('div', 'cells');
  cells.append(
    cell('Marge', r.margin, `${r.profit} · ${r.profitPerSqm}`),
    cell('Verkaufspreis', r.salePrice, r.salePricePerSqm),
    cell('GIK', r.gik, r.gikPerSqm),
  );
  if (kind !== 'en') cells.append(cell('Rendite Käufer', r.buyerYield));
  return [hero, verdict(r), cells, limitLine(r), parkingLineNode(r)].filter(Boolean);
}

/** Ansicht „Angebot prüfen“ mit Angebotspreis: Marge und Gewinn beim Angebot nebeneinander (schmal untereinander). */
function offerView(r) {
  const hero = el('div', 'hero hero-pair');
  const marge = el('div', 'hero-col');
  marge.append(el('span', 'cap', 'Marge beim Angebot'), el('span', 'hero-fig fit', r.margin));
  const gewinn = el('div', 'hero-col');
  gewinn.append(el('span', 'cap', 'Gewinn beim Angebot'), el('span', 'hero-fig fit', r.profit), el('span', 'sub', r.profitPerSqm));
  hero.append(marge, gewinn);

  const cells = el('div', 'cells');
  cells.append(
    cell('Max. Einkaufspreis', r.maxPrice, r.maxPricePerSqm),
    cell('GIK', r.gik, r.gikPerSqm),
    cell('Verkaufspreis', r.salePrice, r.salePricePerSqm),
    cell('Nötiger Verkaufspreis für 20 %', r.offer.requiredSalePrice, r.offer.requiredSalePricePerSqm),
  );
  return [hero, verdict(r), el('p', 'delta', r.offer.deltaText), cells, limitLine(r), parkingLineNode(r)].filter(Boolean);
}

function renderResult() {
  const r = presentResult(session);
  const card = $('result');
  card.dataset.ampel = r.ampel;
  const body = $('result-body');
  const nodes = r.mode === 'check' && r.offer ? offerView(r) : maxView(r, session.calc.kind);
  body.replaceChildren(...nodes);
  renderNotes(r);
}

// MARK: - Schalter oben (Art und Modus)

function renderSegments() {
  const kind = session.calc.kind;
  const group = kind === 'vermietet' ? 'vermietet' : kind === 'wg' ? 'wg' : 'leer';
  const quick = isQuickieActive();
  for (const btn of $('seg-kind').querySelectorAll('button')) {
    // Im Quickie ist nur der Knopf „Quickie“ gedrückt.
    const pressed = quick ? btn.dataset.kind === 'quickie' : btn.dataset.kind === group;
    btn.setAttribute('aria-pressed', String(pressed));
  }
  $('seg-sub').hidden = quick || group !== 'leer';
  for (const btn of $('seg-sub').querySelectorAll('button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.kind === kind));
  }
  for (const btn of $('seg-mode').querySelectorAll('button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === session.mode));
  }
}

function bindSegments() {
  for (const btn of $('seg-kind').querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      // Quickie ist nur ein Oberflächenzustand: keine Art, keine Sitzungsänderung.
      if (btn.dataset.kind === 'quickie') {
        if (!isQuickieActive()) {
          setQuickieActive(true);
          render();
        }
        return;
      }
      const wasQuickie = isQuickieActive();
      setQuickieActive(false);
      const current = session.calc.kind;
      // „Leerstehend“ wählt Kapitalanleger; die Unterart wird danach über den zweiten Umschalter gesetzt.
      const target = btn.dataset.kind === 'leer' ? 'kap' : btn.dataset.kind;
      if (target !== current) commit(switchKind(session, target));
      else if (wasQuickie) render();
    });
  }
  for (const btn of $('seg-sub').querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      if (btn.dataset.kind !== session.calc.kind) commit(switchKind(session, btn.dataset.kind));
    });
  }
  for (const btn of $('seg-mode').querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      if (btn.dataset.mode !== session.mode) commit(setMode(session, btn.dataset.mode));
    });
  }
}

// MARK: - Zeichnen

function fitAll() {
  for (const node of document.querySelectorAll('.fit')) fitText(node);
}

/** Im Quickie ausblenden: Unterart, Modus, Aktionen, Speicherzustand und der Rechner selbst. */
function setQuickieLayout(quick) {
  if (quick) $('seg-sub').hidden = true;
  $('seg-mode').hidden = quick;
  $('actions').hidden = quick;
  $('save-state').hidden = quick;
  document.querySelector('#view-rechner .split').hidden = quick;
  $('quickie').hidden = !quick;
}

function render() {
  const quick = isQuickieActive();
  // Wechsel der Art: Markierungen und Meldung des Exposé-Blocks gelten nicht mehr.
  if (marksKind !== null && session.calc.kind !== marksKind) {
    marks.clear();
    marksKind = null;
    exposeRechner.leeren();
  }
  const key = formKeyOf(session);
  if (key !== formKey) {
    formKey = key;
    buildForm();
  }
  renderSegments();
  setQuickieLayout(quick);
  if (quick) {
    renderQuickie();
  } else {
    renderResult();
    for (const widget of widgets) widget.update(session);
    renderScenarios();
  }
  updateActions();
  fitAll();
}

// MARK: - Bereiche

/** Bereich anzeigen. Rechner, Objekte und Einstellungen werden beim Anzeigen frisch gezeichnet. */
function showView(name) {
  for (const view of VIEWS) $(`view-${view}`).hidden = view !== name;
  for (const btn of document.querySelectorAll('.tabbar [data-view]')) {
    if (btn.dataset.view === name) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
  if (name === 'rechner') render();
  if (name === 'objekte') renderObjects();
  if (name === 'einstellungen') renderSettings();
  window.scrollTo(0, 0);
}

function init() {
  bindSegments();
  initQuickie();
  $('expose-rechner').append(exposeRechner.node);
  initDialogs();
  initObjects(ctx);
  initSettings(ctx);
  initActions(ctx);
  for (const btn of document.querySelectorAll('.tabbar [data-view]')) {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  }

  formEl.addEventListener('pointerdown', tapOutsideBlurs);
  installScrollKeeper();
  window.addEventListener('resize', () => {
    for (const pill of document.querySelectorAll('.pill')) fitPill(pill);
    fitAll();
  });

  showView('rechner');
  checkIncomingLink();
  window.addEventListener('hashchange', checkIncomingLink);
}

init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    try {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // Ohne Service Worker funktioniert die App weiterhin online.
      });
    } catch {
      // Registrierung nicht möglich: die App läuft ohne Offline-Nutzung weiter.
    }
  });
}
