// Scrollposition bei Zahlenfeldern. Die Seite scrollt über das Fenster. Beim Antippen eines Zahlenfeldes
// schiebt iOS Safari das Feld über der Tastatur in die Sicht. Die Position davor wird gemerkt und nach dem
// Verlassen des Feldes sowie nach dem Schließen der Tastatur wiederhergestellt, außer der Nutzer hat selbst gescrollt.

const KEEP_TIMEOUT_MS = 800;
const keep = { saved: null, userScrolled: false, pending: false, timer: null };

const isNumberField = (node) => node instanceof HTMLInputElement && node.hasAttribute('data-number-field');

function keepStart() {
  if (keep.saved !== null) return;
  keep.saved = window.scrollY;
  keep.userScrolled = false;
}

function keepRestore() {
  if (keep.saved === null || keep.userScrolled) return;
  window.scrollTo(0, keep.saved);
}

function keepCancelPending() {
  clearTimeout(keep.timer);
  keep.timer = null;
  keep.pending = false;
}

function keepFinish() {
  if (keep.saved === null) return;
  keepRestore();
  keepCancelPending();
  keep.pending = true;
  keep.timer = setTimeout(keepDone, KEEP_TIMEOUT_MS);
}

function keepDone() {
  keepRestore();
  keepCancelPending();
  keep.saved = null;
  keep.userScrolled = false;
}

/** Einmal beim Start aufrufen. */
export function installScrollKeeper() {
  document.addEventListener('pointerdown', (event) => {
    if (isNumberField(event.target)) keepStart();
  }, true);

  document.addEventListener('focusin', (event) => {
    if (!isNumberField(event.target)) return;
    keepStart();
    keepCancelPending();
  });

  // Wechsel zu einem anderen Zahlenfeld: der zuerst gemerkte Wert bleibt.
  document.addEventListener('focusout', (event) => {
    if (!isNumberField(event.target) || isNumberField(event.relatedTarget)) return;
    keepFinish();
  });

  // Zieht der Nutzer selbst, wird nicht zurückgesetzt.
  window.addEventListener('touchmove', () => {
    if (keep.saved === null) return;
    if (isNumberField(document.activeElement) || keep.pending) keep.userScrolled = true;
  }, { passive: true });

  // Nach dem Schließen der Tastatur (Größe des sichtbaren Bereichs ändert sich).
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (keep.pending) keepRestore();
    });
  }
}

/** Tippen auf Text im Formular entfernt den Fokus aus einem Textfeld, wie in der App. */
export function tapOutsideBlurs(event) {
  if (event.target.closest('input, textarea, button, summary')) return;
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && active.type === 'text') active.blur();
  else if (active instanceof HTMLTextAreaElement) active.blur();
}
