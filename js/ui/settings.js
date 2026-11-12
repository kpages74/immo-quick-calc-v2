// Bereich „Einstellungen“: eigene Standardwerte, Preisliste, Sicherung und Zurücksetzen.
// Anzeigetexte aus js/present.js, Dateien über js/ui/files.js, Speichern über js/store.js (in app.js).
import { getDefaultOverrides, setDefaultOverrides } from '../fields.js';
import { KIND_LABEL, presentDefaults, presentPriceListState } from '../present.js';
import { defaultsFromInputs, clearDefaults } from '../defaults.js';
import { saveDefaults } from '../store.js';
import { parsePriceList, priceListTemplate } from '../pricelist.js';
import { buildBackup, parseBackup, backupFileName, mergeObjects } from '../backup.js';
import { resetAll } from '../session.js';
import { el } from './controls.js';
import { confirmDialog, showStatus, SAVE_FAILED } from './dialogs.js';
import { downloadFile, fileInput, readText, isTooLarge } from './files.js';

const TOO_LARGE = 'Die Datei ist zu groß (höchstens 5 MB).';
const READ_FAILED = 'Die Datei konnte nicht gelesen werden.';
const ERROR_LIMIT = 5;

const $ = (id) => document.getElementById(id);
let ctx = null;
/** Fehlertexte des letzten CSV-Imports, bis zum nächsten Import sichtbar. */
let importErrors = [];

/** Einmal beim Start. ctx: { getSession, replaceSession, render, getObjects, setObjects, getPriceList, setPriceList, clearPriceList }. */
export function initSettings(context) {
  ctx = context;
}

/** Abschnitte neu aufbauen: beim Anzeigen des Bereichs und nach jeder Aktion hier. */
export function renderSettings() {
  const body = $('settings-body');
  if (!body || !ctx) return;
  const kind = ctx.getSession().calc.kind;
  body.replaceChildren(defaultsSection(kind), priceListSection(), backupSection(), resetSection());
}

// MARK: - Bausteine

function section(title) {
  const sec = el('div', 'set-sec');
  sec.append(el('h2', 'set-title', title));
  return sec;
}

function button(text, className, onClick) {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function bulletList(items, className = 'set-list') {
  const list = el('ul', className);
  for (const text of items) list.append(el('li', null, text));
  return list;
}

/** Fehlertexte: höchstens fünf, dazu die Anzahl der weiteren. */
function errorList(errors) {
  const items = errors.slice(0, ERROR_LIMIT);
  if (errors.length > ERROR_LIMIT) items.push(`und ${errors.length - ERROR_LIMIT} weitere`);
  return bulletList(items, 'set-list set-errors');
}

// MARK: - a) Standardwerte

function defaultsSection(kind) {
  const sec = section('Standardwerte');
  sec.append(el('p', 'set-text', `Nutzungsart: ${KIND_LABEL[kind]}`));

  sec.append(button('Aktuelle Eingaben als Standard übernehmen', 'btn', () => {
    const next = defaultsFromInputs(getDefaultOverrides(), kind, ctx.getSession().calc.inputs);
    const saved = saveDefaults(undefined, next);
    setDefaultOverrides(next);
    showStatus(saved ? 'Standardwerte gespeichert' : SAVE_FAILED);
    renderSettings();
  }));

  sec.append(button('Werksstandard wiederherstellen', 'btn', async () => {
    const ok = await confirmDialog({
      title: 'Werksstandard wiederherstellen?',
      text: `Die eigenen Standardwerte der Nutzungsart „${KIND_LABEL[kind]}“ werden gelöscht.`,
      okLabel: 'Wiederherstellen',
      danger: true,
    });
    if (!ok) return;
    const next = clearDefaults(getDefaultOverrides(), kind);
    const saved = saveDefaults(undefined, next);
    setDefaultOverrides(next);
    showStatus(saved ? 'Werksstandard wiederhergestellt' : SAVE_FAILED);
    renderSettings();
  }));

  const items = presentDefaults(getDefaultOverrides(), kind);
  if (items.length === 0) {
    sec.append(el('p', 'set-text', 'Es gelten die Werksstandards.'));
  } else {
    sec.append(bulletList(items.map((d) => `${d.label}: ${d.value} (Werk: ${d.factory})`)));
  }
  sec.append(el('p', 'set-foot', 'Gilt für neue Kalkulationen und für den Knopf „Standard“ in dieser Nutzungsart. Der Angebotspreis wird nicht übernommen.'));
  return sec;
}

// MARK: - b) Preisliste

async function importCsv(file) {
  if (isTooLarge(file)) {
    importErrors = [];
    showStatus(TOO_LARGE);
    renderSettings();
    return;
  }
  let result;
  try {
    result = parsePriceList(await readText(file));
  } catch {
    result = { ok: false, rows: [], errors: [READ_FAILED] };
  }
  importErrors = result.errors;
  if (!result.ok) {
    showStatus('Keine Einträge importiert.');
  } else {
    const saved = ctx.setPriceList({ rows: result.rows, imported: new Date().toISOString(), fileName: file.name });
    showStatus(saved ? `${result.rows.length} Einträge importiert` : SAVE_FAILED);
  }
  renderSettings();
}

async function clearPriceListWithConfirm() {
  const ok = await confirmDialog({
    title: 'Preisliste löschen?',
    text: 'Die importierte Preisliste wird entfernt. Richtpreise, die schon in Kalkulationen stehen, bleiben unverändert.',
    okLabel: 'Löschen',
    danger: true,
  });
  if (!ok) return;
  importErrors = [];
  showStatus(ctx.clearPriceList() ? 'Preisliste gelöscht' : SAVE_FAILED);
  renderSettings();
}

function priceListSection() {
  const sec = section('Preisliste');
  const data = ctx.getPriceList();
  sec.append(el('p', 'set-text', presentPriceListState(data)));

  const csv = fileInput('.csv,text/csv,text/plain', importCsv);
  sec.append(csv);
  sec.append(button('CSV importieren', 'btn', () => csv.click()));
  sec.append(button('Vorlage herunterladen', 'btn', () => {
    downloadFile(`﻿${priceListTemplate()}`, 'preisliste-vorlage.csv', 'text/csv;charset=utf-8');
  }));
  if (data.rows.length > 0) sec.append(button('Preisliste löschen', 'btn btn-danger', clearPriceListWithConfirm));
  if (importErrors.length > 0) sec.append(errorList(importErrors));
  sec.append(el('p', 'set-foot', 'Spalten: Ort;Stadtteil;PLZ;Preis_von;Preis_bis;Preis_mittel;Stand;Quelle'));
  return sec;
}

// MARK: - c) Sicherung

function exportBackup() {
  const backup = buildBackup({
    objects: ctx.getObjects(),
    defaults: getDefaultOverrides(),
    pricelist: ctx.getPriceList(),
  });
  downloadFile(JSON.stringify(backup, null, 1), backupFileName(), 'application/json');
}

async function importBackup(file) {
  if (isTooLarge(file)) {
    showStatus(TOO_LARGE);
    return;
  }
  let parsed;
  try {
    parsed = parseBackup(await readText(file));
  } catch {
    parsed = { ok: false, error: READ_FAILED };
  }
  if (!parsed.ok) {
    showStatus(parsed.error);
    return;
  }
  const ok = await confirmDialog({
    title: 'Sicherung importieren?',
    text: `${parsed.objects.length} Objekte importieren? Objekte mit gleicher Kennung werden ersetzt. Enthaltene Standardwerte und Preisliste ersetzen die vorhandenen.`,
    okLabel: 'Importieren',
  });
  if (!ok) return;

  const merged = mergeObjects(ctx.getObjects(), parsed.objects);
  const results = [ctx.setObjects(merged.list)];
  if (Object.keys(parsed.defaults).length > 0) {
    results.push(saveDefaults(undefined, parsed.defaults));
    setDefaultOverrides(parsed.defaults);
  }
  if (parsed.pricelist.rows.length > 0) results.push(ctx.setPriceList(parsed.pricelist));
  showStatus(results.every(Boolean) ? `${merged.added} neu, ${merged.replaced} ersetzt` : SAVE_FAILED);
  renderSettings();
  ctx.render();
}

function backupSection() {
  const sec = section('Sicherung');
  const backupFile = fileInput('.json,application/json', importBackup);
  sec.append(backupFile);
  sec.append(button('Sicherung exportieren', 'btn', exportBackup));
  sec.append(button('Sicherung importieren', 'btn', () => backupFile.click()));
  sec.append(el('p', 'set-foot', 'Die Sicherung enthält alle gespeicherten Objekte, die eigenen Standardwerte und die Preisliste. Zum Übertragen auf ein anderes Gerät dort importieren.'));
  return sec;
}

// MARK: - d) Zurücksetzen

function resetSection() {
  const sec = section('Zurücksetzen');
  sec.append(button('Alle Eingaben zurücksetzen', 'btn btn-danger', async () => {
    const ok = await confirmDialog({
      title: 'Alle Eingaben zurücksetzen?',
      text: 'Objektname, Adresse und alle Eingaben werden auf die Standardwerte gesetzt.',
      okLabel: 'Zurücksetzen',
      danger: true,
    });
    if (!ok) return;
    ctx.replaceSession(resetAll(ctx.getSession()));
  }));
  sec.append(el('p', 'set-foot', 'Setzt Objektname, Adresse und alle Eingaben auf die Standardwerte zurück. Die Nutzungsart bleibt. Gespeicherte Objekte bleiben erhalten.'));
  return sec;
}
