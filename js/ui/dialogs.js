// Dialoge und Statusmeldung: ein allgemeiner Bestätigungsdialog, der Link-Dialog und die kurze Meldung unten.
// Nur DOM-API (textContent), keine Formeln und kein Markup aus Text.

const $ = (id) => document.getElementById(id);
const STATUS_MS = 4000;

export const SAVE_FAILED = 'Speichern nicht möglich (Speicher voll oder gesperrt).';

let pendingResolve = null;
let statusTimer = null;

/** Dialog öffnen: modal, wenn der Browser das kann. */
export function openModal(dialog) {
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
}

/** Dialog schließen. */
export function closeModal(dialog) {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

/** Offene Bestätigung beenden. Der Wert geht nur einmal an den Aufrufer. */
function settle(value) {
  const resolve = pendingResolve;
  pendingResolve = null;
  if (resolve) resolve(value);
}

/**
 * Bestätigungsdialog. Liefert true bei Bestätigung, false bei Abbrechen oder Escape.
 * danger: roter Bestätigungsknopf.
 */
export function confirmDialog({ title, text, okLabel = 'OK', danger = false }) {
  settle(false);
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  const ok = $('btn-confirm-ok');
  ok.textContent = okLabel;
  ok.className = danger ? 'btn btn-danger' : 'btn';
  return new Promise((resolve) => {
    pendingResolve = resolve;
    openModal($('dlg-confirm'));
  });
}

/** Einmal beim Start: Knöpfe und Schließen der Dialoge verbinden. */
export function initDialogs() {
  const confirm = $('dlg-confirm');
  $('btn-confirm-cancel').addEventListener('click', () => {
    settle(false);
    closeModal(confirm);
  });
  $('btn-confirm-ok').addEventListener('click', () => {
    settle(true);
    closeModal(confirm);
  });
  // Escape schließt den Dialog ohne Bestätigung. Ein neu geöffneter Dialog bleibt unberührt.
  confirm.addEventListener('close', () => {
    if (!confirm.open) settle(false);
  });
  const link = $('dlg-link');
  $('btn-link-close').addEventListener('click', () => closeModal(link));
}

/** Kurze Meldung über der unteren Leiste, verschwindet nach 4 Sekunden. */
export function showStatus(text) {
  const box = $('status');
  box.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    box.textContent = '';
  }, STATUS_MS);
}
