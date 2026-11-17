// Aktionen des Rechners: Speichern, Neu, PDF, Link teilen, eingehender Link (#k=…) und der Speicherzustand.
// Alle Werte kommen aus den Logik-Modulen (library, present, pdf, share); hier steht keine Formel.
import { saveState, upsertObject } from '../library.js';
import { presentReport } from '../present.js';
import { buildPdf, pdfFileName } from '../pdf.js';
import { shareUrl, decodeShare } from '../share.js';
import { resetAll } from '../session.js';
import { confirmDialog, openModal, showStatus, SAVE_FAILED } from './dialogs.js';
import { shareOrDownload } from './files.js';

const STATE_TEXT = Object.freeze({
  unberuehrt: '',
  neu: 'Noch nicht gespeichert',
  gespeichert: 'Gespeichert',
  geaendert: 'Geändert seit dem Speichern',
});
const APP_TITLE = 'Immo Quick-Calc 2.0';

const $ = (id) => document.getElementById(id);
let ctx = null;

/** Einmal beim Start: Knöpfe der Aktionsleiste verbinden. */
export function initActions(context) {
  ctx = context;
  $('btn-save').addEventListener('click', saveCurrent);
  $('btn-pdf').addEventListener('click', makePdf);
  $('btn-share').addEventListener('click', shareLink);
  $('btn-new').addEventListener('click', newCalculation);
}

/** Speicherzustand unter der Aktionsleiste. Wird bei jedem Zeichnen aufgerufen. */
export function updateActions() {
  const state = saveState(ctx.getObjects(), ctx.getSession().calc);
  $('save-state').textContent = STATE_TEXT[state] ?? '';
}

/**
 * Bei ungespeicherten Änderungen (neu oder geändert) vorher bestätigen. Liefert true, wenn verworfen werden darf.
 */
export async function confirmDiscard() {
  const state = saveState(ctx.getObjects(), ctx.getSession().calc);
  if (state !== 'neu' && state !== 'geaendert') return true;
  return confirmDialog({
    title: 'Ungespeicherte Änderungen verwerfen?',
    text: 'Die Eingaben der aktuellen Kalkulation sind noch nicht gespeichert.',
    okLabel: 'Verwerfen',
    danger: true,
  });
}

function saveCurrent() {
  const ok = ctx.setObjects(upsertObject(ctx.getObjects(), ctx.getSession().calc));
  showStatus(ok ? 'Gespeichert' : SAVE_FAILED);
  ctx.render();
}

async function newCalculation() {
  if (!(await confirmDiscard())) return;
  ctx.replaceSession(resetAll(ctx.getSession()));
}

/** Logo als Bytes, oder null, wenn es nicht geladen werden kann (dann ohne Logo). */
async function loadLogo() {
  try {
    const response = await fetch('icons/logo.png');
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

async function makePdf() {
  const button = $('btn-pdf');
  button.disabled = true;
  try {
    const session = ctx.getSession();
    const logoPng = await loadLogo();
    const bytes = await buildPdf(presentReport(session), { logoPng });
    const file = new File([bytes], pdfFileName(session.calc.name), { type: 'application/pdf' });
    await shareOrDownload(file);
  } catch {
    showStatus('PDF konnte nicht erstellt werden.');
  } finally {
    button.disabled = false;
  }
}

/** Dialog mit dem Link zum Markieren, wenn Teilen und Kopieren nicht gehen. */
function showLinkDialog(url) {
  const field = $('link-field');
  field.value = url;
  openModal($('dlg-link'));
  field.focus();
  field.select();
  field.setSelectionRange(0, url.length);
}

async function shareLink() {
  const session = ctx.getSession();
  const url = shareUrl(location.href, session.calc, session.mode);
  if (matchMedia('(pointer: coarse)').matches && navigator.share) {
    try {
      await navigator.share({ title: APP_TITLE, url });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    showStatus('Link kopiert');
  } catch {
    showLinkDialog(url);
  }
}

/**
 * Geteilte Kalkulation aus dem Hash (#k=…). Nach der Antwort wird der Hash in jedem Fall entfernt.
 * Ohne gültigen Link geschieht nichts.
 */
export async function checkIncomingLink() {
  const shared = decodeShare(location.hash);
  if (shared === null) return;
  const name = shared.calc.name || 'Ohne Namen';
  const ok = await confirmDialog({
    title: 'Geteilte Kalkulation öffnen?',
    text: `„${name}“ wird geöffnet. Die aktuellen Eingaben werden dabei ersetzt.`,
    okLabel: 'Öffnen',
  });
  history.replaceState(null, '', location.pathname + location.search);
  if (ok) {
    ctx.leaveQuickie();
    ctx.replaceSession({ calc: shared.calc, carry: {}, mode: shared.mode });
    ctx.showView('rechner');
  }
}
