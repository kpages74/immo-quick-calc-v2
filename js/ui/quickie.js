// Oberfläche des Quickie (Deal-Schnellcheck). Der Bereich wird einmal aufgebaut, danach werden nur Texte und Werte
// aktualisiert, damit ein gerade bearbeitetes Feld nicht neu entsteht. Rechnen und Texte kommen aus js/quickie.js,
// Suchen im Exposé aus js/expose.js, PDF-Lesen aus js/ui/pdfreader.js, Speicher aus js/store.js. Hier steht keine Formel
// und keine Suchlogik.
import { el, setHint, fitText } from './controls.js';
import { parseNumber, Fmt } from '../format.js';
import { QUICKIE_DEFAULTS, cleanVorgaben, presentQuickie } from '../quickie.js';
import { loadQuickie, saveQuickie, loadQuickieVorgaben, saveQuickieVorgaben } from '../store.js';
import { analysiereText, analysierePdfText } from '../expose.js';
import { leseTextAusPdf } from './pdfreader.js';

let state = null;      // { active, miete, flaeche, angebot }
let vorgaben = null;   // { erh, r, deckel, nk, halte, marge, z1, z2 }
let refs = null;       // Verweise auf die Knoten, die aktualisiert werden

const PDF_FEHLER = 'PDF konnte nicht geöffnet werden. Bitte Werte von Hand eintragen oder den Exposé-Text einfügen.';

/** Anzeige eines Zahlenwertes ohne Fokus: ganze Zahlen mit Tausenderpunkt, sonst bis 2 Nachkommastellen. */
function displayNum(value) {
  if (value === null || value === undefined) return '';
  if (Number.isInteger(value)) return Fmt.fieldNumber(value, 0);
  return Fmt.fieldNumber(value, 2).replace(/0+$/, '').replace(/,$/, '');
}

function persist() {
  saveQuickie(undefined, state);
}

function persistVorgaben() {
  saveQuickieVorgaben(undefined, vorgaben);
}

/** Zustand für die Oberfläche: aktiv oder nicht. Das Neuzeichnen des Rechners übernimmt der Aufrufer. */
export function isQuickieActive() {
  return state !== null && state.active === true;
}

export function setQuickieActive(on) {
  if (!state) return;
  state.active = on === true;
  persist();
}

/** Feld mit Label, Eingabe, Einheit rechts im Feld und Zusatzzeile. */
function buildField(key, labelText, unit) {
  const wrap = el('div', 'q-field');
  const id = `q-${key}`;
  const label = el('label', null, labelText);
  label.htmlFor = id;
  const inwrap = el('div', 'q-inwrap');
  const input = el('input');
  input.id = id;
  input.type = 'text';
  input.inputMode = 'decimal';
  input.enterKeyHint = 'done';
  input.autocomplete = 'off';
  input.spellcheck = false;
  inwrap.append(input, el('span', 'q-unit', unit));
  const hint = el('small');
  wrap.append(label, inwrap, hint);
  return { wrap, input, hint };
}

/** Haupteingaben (Miete, Fläche, Angebot): jede gültige Eingabe rechnet sofort neu. */
function bindMain(field, key) {
  field.input.addEventListener('focus', () => {
    const value = state[key];
    field.input.value = value === null ? '' : Fmt.editingNumber(value);
  });
  field.input.addEventListener('input', () => {
    field.input.classList.remove('filled', 'missing');
    const text = field.input.value.trim();
    let value = null;
    if (text !== '') {
      value = parseNumber(text);
      if (value === null) return; // ungültiger Text: alter Wert bleibt
    }
    state[key] = value;
    persist();
    renderQuickie();
  });
  field.input.addEventListener('blur', () => {
    field.input.value = displayNum(state[key]);
    renderQuickie();
  });
}

/** Vorgaben (und Rendite/Deckel): gültige Eingabe wird sofort übernommen, leer oder ungültig beim Verlassen durch den Standardwert ersetzt. */
function bindVorgabe(field, key) {
  field.input.addEventListener('input', () => {
    const value = parseNumber(field.input.value);
    if (value === null) return;
    const next = cleanVorgaben({ ...vorgaben, [key]: value });
    if (next[key] !== value) return;
    vorgaben = next;
    persistVorgaben();
    renderQuickie();
  });
  field.input.addEventListener('blur', () => {
    vorgaben = cleanVorgaben({ ...vorgaben, [key]: parseNumber(field.input.value) });
    persistVorgaben();
    field.input.value = displayNum(vorgaben[key]);
    renderQuickie();
  });
}

function buildLimit() {
  const lbl = el('span', 'lbl');
  const lbl1 = el('span', null);
  const lbl2 = el('span', null);
  lbl.append(lbl1, lbl2);
  const big = el('span', 'big fit');
  const meta = el('span', 'meta');
  const meta1 = el('span', null);
  const meta2 = el('span', null);
  meta.append(meta1, meta2);
  const box = el('div', 'q-limit');
  box.append(lbl, big, meta);
  return { box, lbl1, lbl2, big, meta1, meta2 };
}

function buildFact(label) {
  const row = el('div', 'q-row');
  const value = el('span', null);
  row.append(el('span', null, label), value);
  return { row, value };
}

/** Bereich „Exposé einlesen“: PDF per Ablage oder Auswahl, Text per Einfügen, Ergebnisliste. */
function buildImport() {
  const drop = el('label', 'q-drop');
  const file = el('input', 'q-file');
  file.type = 'file';
  file.accept = 'application/pdf';
  file.setAttribute('aria-label', 'PDF-Exposé wählen');
  drop.append(file, el('span', null, 'PDF hier ablegen oder auswählen'));

  const text = el('textarea', 'q-text');
  text.placeholder = '… oder Exposé-Text hier einfügen';
  text.setAttribute('aria-label', 'Exposé-Text');
  text.rows = 1;

  const go = el('button', 'q-go', 'Text auswerten');
  go.type = 'button';

  const textRow = el('div', 'q-import-row');
  textRow.append(text, go);

  const status = el('p', 'q-status');
  status.setAttribute('aria-live', 'polite');
  const list = el('ul', 'q-finds');

  const title = el('h2', 'q-import-title', 'Exposé einlesen');
  const box = el('section', 'q-box q-import');
  box.append(title, drop, textRow, status, list);
  return { box, drop, file, text, go, status, list };
}

function buildRefs(root) {
  const miete = buildField('miete', 'Ist-Kaltmiete', '€/Mon.');
  const flaeche = buildField('flaeche', 'Wohnfläche', 'm²');
  const angebot = buildField('angebot', 'Angebotspreis', '€');
  const rendite = buildField('rendite', 'Rendite Käufer', '%');
  const deckel = buildField('deckel', 'Max. €/m² Käufer', '€/m²');
  bindMain(miete, 'miete');
  bindMain(flaeche, 'flaeche');
  bindMain(angebot, 'angebot');
  bindVorgabe(rendite, 'r');
  bindVorgabe(deckel, 'deckel');

  const inputsRow = el('section', 'q-inputs');
  inputsRow.append(miete.wrap, flaeche.wrap, angebot.wrap);
  const buyerRow = el('section', 'q-inputs buyer');
  buyerRow.append(rendite.wrap, deckel.wrap);

  const chip = el('span', 'q-chip');
  const headline = el('div', 'headline');
  const sub = el('div', 'sub');
  const verdict = el('section', 'q-verdict');
  verdict.dataset.ampel = 'neutral';
  verdict.append(chip, headline, sub);

  const limits = [buildLimit(), buildLimit(), buildLimit()];
  const limitRow = el('section', 'q-limits');
  limitRow.append(...limits.map((l) => l.box));

  const facts = [
    buildFact('Miete nach Erhöhung'),
    buildFact('Verkaufspreis'),
    buildFact('Rendite Käufer (Bruttorendite beim Verkauf)'),
    buildFact('Begrenzt durch'),
    buildFact('Deine Kaufrendite (Ist-Miete ÷ Angebot)'),
  ];
  const factRow = el('section', 'q-facts');
  factRow.append(...facts.map((f) => f.row));

  const hint = el('div', 'q-box q-hint');
  hint.hidden = true;

  const steps = el('ol', 'q-steps');
  const weg = el('details', 'q-box');
  weg.append(el('summary', null, 'Rechenweg'), steps);

  // Vorgaben ändern: Mieterhöhung, Kaufnebenkosten, Haltekosten, Marge, Mindest- und Wunschgewinn.
  const vorgabeDefs = [
    ['erh', 'Mieterhöhung', '%'],
    ['nk', 'Kaufnebenkosten', '%'],
    ['halte', 'Haltekosten', '€'],
    ['marge', 'Marge', '%'],
    ['z1', 'Mindestgewinn', '€'],
    ['z2', 'Wunschgewinn', '€'],
  ];
  const vorgabeFields = vorgabeDefs.map(([key, text, unit]) => {
    const f = buildField(`vorgabe-${key}`, text, unit);
    bindVorgabe(f, key);
    return { key, field: f };
  });
  const vorgabeRow = el('section', 'q-inputs buyer');
  vorgabeRow.append(...vorgabeFields.map((x) => x.field.wrap));
  const std = el('button', 'btn q-std', 'Standardwerte');
  std.type = 'button';
  std.addEventListener('click', () => {
    vorgaben = cleanVorgaben(QUICKIE_DEFAULTS);
    persistVorgaben();
    renderQuickie();
  });
  const vorgabenBox = el('details', 'q-box');
  vorgabenBox.append(el('summary', null, 'Vorgaben ändern'), vorgabeRow, std);

  const foot = el('p', 'q-foot');

  const imp = buildImport();
  root.replaceChildren(imp.box, inputsRow, buyerRow, verdict, limitRow, hint, factRow, weg, vorgabenBox, foot);

  return {
    inputs: { miete, flaeche, angebot, rendite, deckel, vorgaben: vorgabeFields },
    verdict, chip, headline, sub, limits, facts, hint, steps, foot, imp,
  };
}

/** Werte der Felder setzen, außer dem gerade bearbeiteten. */
function syncInputs() {
  const set = (field, value) => {
    if (document.activeElement !== field.input) field.input.value = value;
  };
  set(refs.inputs.miete, displayNum(state.miete));
  set(refs.inputs.flaeche, displayNum(state.flaeche));
  set(refs.inputs.angebot, displayNum(state.angebot));
  set(refs.inputs.rendite, displayNum(vorgaben.r));
  set(refs.inputs.deckel, displayNum(vorgaben.deckel));
  for (const { key, field } of refs.inputs.vorgaben) set(field, displayNum(vorgaben[key]));
}

// Messfeld für Eingaben (gleiche Schrift, außerhalb des sichtbaren Layouts).
let probe = null;

/**
 * Schrift einer Eingabe verkleinern, falls die Zahl samt Einheit-Platz rechts sonst nicht passt (mindestens 60 %).
 * Breite aus dem Rahmenmaß minus Rahmen und Polster: clientWidth liefert bei Eingaben nur die Inhaltsbreite.
 */
function fitInput(input) {
  input.style.fontSize = '';
  const cs = getComputedStyle(input);
  const box = input.getBoundingClientRect().width;
  if (box <= 0) return;
  const innen = ['Left', 'Right'].reduce(
    (sum, side) => sum + parseFloat(cs[`padding${side}`]) + parseFloat(cs[`border${side}Width`]), 0,
  );
  const avail = box - innen;
  if (!probe) {
    probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;left:-9999px;top:0;';
    document.body.append(probe);
  }
  probe.style.fontFamily = cs.fontFamily;
  probe.style.fontWeight = cs.fontWeight;
  probe.style.fontVariantNumeric = 'tabular-nums';
  probe.style.fontSize = cs.fontSize;
  probe.textContent = input.value;
  const needed = probe.getBoundingClientRect().width;
  if (avail > 0 && needed > avail) {
    const base = parseFloat(cs.fontSize);
    input.style.fontSize = `${Math.max(base * 0.6, (base * avail * 0.98) / needed)}px`;
  }
}

/** Schrift aller Eingaben prüfen (nach jedem Neuzeichnen, damit auch der Wert im Feld passt). */
function fitInputs() {
  const i = refs.inputs;
  for (const f of [i.miete, i.flaeche, i.angebot, i.rendite, i.deckel, ...i.vorgaben.map((x) => x.field)]) {
    fitInput(f.input);
  }
}

/** Texte, Ampel und Werte aktualisieren. Nur wenn der Quickie aktiv ist, wird gerechnet. */
export function renderQuickie() {
  if (!refs || !state) return;
  const p = presentQuickie({ miete: state.miete, A: state.flaeche, angebot: state.angebot }, vorgaben);

  syncInputs();
  fitInputs();
  refs.inputs.miete.hint.textContent = p.felder.miete;
  refs.inputs.flaeche.hint.textContent = p.felder.flaeche;
  refs.inputs.angebot.hint.textContent = p.felder.angebot;
  refs.inputs.rendite.hint.textContent = p.felder.rendite;
  refs.inputs.deckel.hint.textContent = p.felder.deckel;

  refs.verdict.dataset.ampel = p.ampel;
  refs.chip.textContent = p.chip;
  refs.headline.textContent = p.headline;
  setHint(refs.sub, p.sub);

  p.karten.forEach((karte, i) => {
    const node = refs.limits[i];
    node.lbl1.textContent = karte.label[0];
    node.lbl2.textContent = karte.label[1];
    node.big.textContent = karte.wert;
    node.meta1.textContent = karte.zeilen[0];
    node.meta2.textContent = karte.zeilen[1];
    fitText(node.big);
  });

  setHint(refs.hint, p.hinweis);

  p.fakten.forEach((fakt, i) => {
    const node = refs.facts[i];
    node.value.textContent = fakt.wert;
    if (fakt.pill) node.value.append(el('br'), el('span', 'q-pill', fakt.pill));
  });

  refs.steps.replaceChildren(...p.rechenweg.map((text) => el('li', null, text)));
  refs.foot.textContent = p.fuss;
}

// MARK: - Exposé einlesen

function setStatus(text, art) {
  const node = refs.imp.status;
  node.textContent = text ?? '';
  if (art) node.dataset.art = art;
  else delete node.dataset.art;
}

/** Nur Warnhinweise (z. B. Staffel-/Indexmiete) mit ⚠ zeigen; gefundene Werte stehen bereits grün markiert in den Feldern. Nur textContent. */
function renderFunde(res) {
  const list = refs.imp.list;
  list.replaceChildren();
  for (const note of res.notes) list.append(el('li', 'q-warn', `⚠ ${note}`));
  list.hidden = res.notes.length === 0;
}

/** Gefundene Werte in die Felder schreiben (gerundet), fehlende Felder markieren, Speichern und Neurechnen. */
function uebernehmen(res) {
  const inputs = refs.inputs;
  for (const f of [inputs.miete, inputs.flaeche, inputs.angebot]) f.input.classList.remove('filled', 'missing');
  if (!res.werte) return; // zu wenig Text: nichts verändern

  const round2 = (x) => Math.round(x * 100) / 100;
  const felder = [
    ['miete', inputs.miete, res.werte.miete, round2],
    ['flaeche', inputs.flaeche, res.werte.flaeche, round2],
    ['angebot', inputs.angebot, res.werte.angebot, (x) => Math.round(x)],
  ];
  for (const [key, field, value, rund] of felder) {
    if (value === null) {
      field.input.classList.add('missing');
      continue;
    }
    state[key] = rund(value);
    field.input.classList.add('filled');
  }
  persist();
  renderQuickie();
}

function auswerten(res) {
  // Erfolgsmeldung entfällt: die Felder sind grün bzw. gelb markiert. Nur Fehler werden gemeldet.
  if (res.status.art === 'err') setStatus(res.status.text, 'err');
  else setStatus('', null);
  renderFunde(res);
  uebernehmen(res);
}

/** Datei prüfen und lesen. Nur PDF wird angenommen. */
async function leseDatei(file) {
  if (!refs) return;
  if (file.type !== 'application/pdf') {
    setStatus('Dateityp nicht unterstützt. Bitte ein PDF wählen.', 'err');
    return;
  }
  setStatus('PDF wird gelesen …', null);
  refs.imp.list.replaceChildren();
  let text;
  try {
    text = await leseTextAusPdf(file);
  } catch {
    setStatus(PDF_FEHLER, 'err');
    return;
  }
  auswerten(analysierePdfText(text, 'PDF (Suchmuster)'));
}

function bindImport() {
  const imp = refs.imp;
  imp.file.addEventListener('change', () => {
    const f = imp.file.files?.[0];
    if (f) leseDatei(f);
    imp.file.value = '';
  });
  imp.drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    imp.drop.classList.add('is-over');
  });
  imp.drop.addEventListener('dragleave', () => imp.drop.classList.remove('is-over'));
  imp.drop.addEventListener('drop', (e) => {
    e.preventDefault();
    imp.drop.classList.remove('is-over');
    const f = e.dataTransfer?.files?.[0];
    if (f) leseDatei(f);
  });
  imp.go.addEventListener('click', () => {
    auswerten(analysiereText(imp.text.value, 'Text (Suchmuster)'));
  });
  // Strg+V mit einem PDF: nur wenn der Quickie aktiv ist.
  document.addEventListener('paste', (e) => {
    if (!isQuickieActive() || !refs) return;
    const pdf = [...(e.clipboardData?.files ?? [])].find((f) => f.type === 'application/pdf');
    if (!pdf) return;
    e.preventDefault();
    leseDatei(pdf);
  });
}

/** Einmal beim Start: Zustand laden, Bereich in #quickie aufbauen. */
export function initQuickie() {
  state = loadQuickie();
  vorgaben = loadQuickieVorgaben();
  const root = document.getElementById('quickie');
  if (!root) return;
  refs = buildRefs(root);
  bindImport();
  renderQuickie();
}
