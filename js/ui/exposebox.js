// Bereich „Exposé einlesen“ als gemeinsamer Baustein für den Quickie und den Rechner: PDF per Ablage oder Auswahl,
// Bild oder Screenshot per Texterkennung, Text einfügen und „Text auswerten“. Lesen: js/ui/pdfreader.js (PDF),
// js/ui/ocr.js (Texterkennung). Suchen und Zuordnen der Werte: js/expose.js. Hier steht keine Formel und keine Suchlogik.
// Der Aufrufer bekommt das Ergebnis über onErgebnis(res) und schreibt die Felder selbst. Nur DOM-API, kein Markup-Einfügen.
import { el } from './controls.js';
import {
  analysiereText, analysierePdfText, analysiereOcrText, istEingescannt, istBildTyp, BILD_TYPEN, ergebnisFuerArt,
} from '../expose.js';
import { leseTextAusPdf, renderPdfSeiten } from './pdfreader.js';
import { bildAlsCanvas, erkenneTexte } from './ocr.js';

const PDF_FEHLER = 'PDF konnte nicht geöffnet werden. Bitte Werte von Hand eintragen oder den Exposé-Text einfügen.';
const BILD_FEHLER = 'Bild konnte nicht geöffnet werden. Bitte Werte von Hand eintragen oder den Exposé-Text einfügen.';
const OCR_LADEN_FEHLER = 'Texterkennung konnte nicht geladen werden. Bitte Text einfügen oder Werte von Hand eintragen.';
const OCR_LAUF_FEHLER = 'Texterkennung fehlgeschlagen. Bitte Text einfügen oder Werte von Hand eintragen.';
const SEITEN_OCR = 3;   // höchstens so viele Seiten eines eingescannten PDFs werden erkannt
const OCR_MASSSTAB = 2; // Render-Maßstab der PDF-Seiten für die Texterkennung

/** Datei aus einer Liste (Ablage, Einfügen), die gelesen werden kann: PDF oder Bild. */
function passendeDatei(list) {
  return [...(list ?? [])].find((f) => f.type === 'application/pdf' || istBildTyp(f.type));
}

/**
 * Baut den Bereich. Optionen: getArt() liefert die Art der Seite ('quickie', 'vermietet', 'kap', 'en' oder 'wg'),
 * onErgebnis(res) bekommt das Ergebnis nach dem Auswerten (res.werte, res.fehlt, res.notes, res.status).
 * Rückgabe: { node, leeren() } – leeren() entfernt Meldung und Warnungen (z. B. beim Wechsel der Seite).
 * Einfügen (Strg+V) einer Datei wird nur von dem Block angenommen, der gerade sichtbar ist.
 */
export function createExposeBox({ getArt, onErgebnis }) {
  let beschaeftigt = false; // true, solange eine Datei gelesen oder erkannt wird

  const drop = el('label', 'q-drop');
  const file = el('input', 'q-file');
  file.type = 'file';
  file.accept = ['application/pdf', ...BILD_TYPEN].join(',');
  file.setAttribute('aria-label', 'PDF-Exposé oder Bild wählen');
  drop.append(file, el('span', null, 'PDF oder Screenshot hier ablegen oder auswählen'));

  const text = el('textarea', 'q-text');
  // Eigener Platzhalter über dem Feld, damit er immer senkrecht und waagerecht mittig steht (auch zweizeilig).
  // Das leere placeholder-Attribut sorgt nur dafür, dass CSS :placeholder-shown (Feld leer) greift.
  text.placeholder = ' ';
  text.setAttribute('aria-label', 'Exposé-Text');
  text.rows = 1;

  const go = el('button', 'q-go', 'Text auswerten');
  go.type = 'button';

  const textRow = el('div', 'q-import-row');
  const textWrap = el('div', 'q-text-wrap');
  textWrap.append(text, el('span', 'q-ph', '… oder Exposé-Text hier einfügen'));
  textRow.append(textWrap, go);

  const status = el('p', 'q-status');
  status.setAttribute('aria-live', 'polite');
  const list = el('ul', 'q-finds');

  const title = el('h2', 'q-import-title', 'Exposé einlesen');
  const node = el('section', 'q-box q-import');
  node.append(title, drop, textRow, status, list);

  /** Status setzen. Nur Fehler bekommen eine Farbe; bei Erfolg bleibt die Meldung leer. */
  function setStatus(msg, art) {
    status.textContent = msg ?? '';
    if (art) status.dataset.art = art;
    else delete status.dataset.art;
  }

  /** Nur Warnhinweise (z. B. Staffel-/Indexmiete) mit ⚠ zeigen; die Werte stehen in den Feldern. Nur textContent. */
  function renderWarnungen(res) {
    list.replaceChildren();
    for (const hinweis of res.notes ?? []) list.append(el('li', 'q-warn', `⚠ ${hinweis}`));
    list.hidden = (res.notes ?? []).length === 0;
  }

  /** Befund (Suchmuster-Ergebnis) für die Seite umsetzen, Meldung und Warnungen zeigen, dann den Aufrufer informieren. */
  function auswerten(befund, quelle) {
    const res = ergebnisFuerArt(befund, getArt(), quelle);
    if (res.status.art === 'err') setStatus(res.status.text, 'err');
    else setStatus('', null);
    renderWarnungen(res);
    onErgebnis(res);
  }

  /** Zeigt den Fortschritt der Texterkennung: „Texterkennung läuft … (Seite 1 von 3) 40 %“. */
  function fortschritt(index, anteil, anzahl) {
    const seite = anzahl > 1 ? ` (Seite ${index + 1} von ${anzahl})` : '';
    setStatus(`Texterkennung läuft …${seite} ${Math.round(anteil * 100)} %`, null);
  }

  /** Erkennt die Bilder. Bei Fehler: Meldung im Status, Ergebnis null. */
  async function erkennen(bilder) {
    try {
      return await erkenneTexte(bilder, (index, anteil) => fortschritt(index, anteil, bilder.length));
    } catch (e) {
      setStatus(e.art === 'laden' ? OCR_LADEN_FEHLER : OCR_LAUF_FEHLER, 'err');
      return null;
    }
  }

  /** Ein Vorgang nach dem anderen: solange einer läuft, werden neue Dateien nicht angenommen. */
  async function mitSperre(vorgang) {
    if (beschaeftigt) return;
    beschaeftigt = true;
    try {
      await vorgang();
    } finally {
      beschaeftigt = false;
    }
  }

  /** PDF lesen. Hat es eine Textebene, wird der Text ausgewertet. Ist es eingescannt, werden die ersten Seiten erkannt. */
  async function leseDateiPdf(datei) {
    setStatus('PDF wird gelesen …', null);
    list.replaceChildren();
    let inhalt;
    try {
      inhalt = await leseTextAusPdf(datei);
    } catch {
      setStatus(PDF_FEHLER, 'err');
      return;
    }
    if (!istEingescannt(inhalt)) {
      auswerten(analysierePdfText(inhalt, 'PDF (Suchmuster)'), 'PDF (Suchmuster)');
      return;
    }
    setStatus('Texterkennung läuft …', null);
    let seiten;
    try {
      seiten = await renderPdfSeiten(datei, SEITEN_OCR, OCR_MASSSTAB);
    } catch {
      setStatus(PDF_FEHLER, 'err');
      return;
    }
    const texte = await erkennen(seiten);
    if (texte === null) return;
    auswerten(analysiereOcrText(texte.join('\n'), 'PDF (Texterkennung)'), 'PDF (Texterkennung)');
  }

  /** Bild lesen und per Texterkennung auswerten. */
  async function leseDateiBild(datei) {
    list.replaceChildren();
    setStatus('Texterkennung läuft …', null);
    let bild;
    try {
      bild = await bildAlsCanvas(datei);
    } catch {
      setStatus(BILD_FEHLER, 'err');
      return;
    }
    const texte = await erkennen([bild]);
    if (texte === null) return;
    auswerten(analysiereOcrText(texte.join('\n'), 'Bild (Texterkennung)'), 'Bild (Texterkennung)');
  }

  /** Datei prüfen und lesen: PDF oder Bild (PNG, JPEG, WebP, GIF, BMP). Andere Typen werden abgelehnt. */
  async function leseDatei(datei) {
    if (datei.type === 'application/pdf') {
      await mitSperre(() => leseDateiPdf(datei));
    } else if (istBildTyp(datei.type)) {
      await mitSperre(() => leseDateiBild(datei));
    } else {
      setStatus('Dateityp nicht unterstützt. Bitte ein PDF oder ein Bild (PNG, JPEG, WebP, GIF, BMP) wählen.', 'err');
    }
  }

  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f) leseDatei(f);
    file.value = '';
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('is-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    const f = e.dataTransfer?.files?.[0];
    if (f) leseDatei(f);
  });
  go.addEventListener('click', () => {
    auswerten(analysiereText(text.value, 'Text (Suchmuster)'), 'Text (Suchmuster)');
  });

  // Strg+V mit einem PDF oder Bild: nur der Block, der gerade sichtbar ist (getClientRects leer = ausgeblendet).
  document.addEventListener('paste', (e) => {
    if (node.getClientRects().length === 0) return;
    const datei = passendeDatei(e.clipboardData?.files);
    if (!datei) return;
    e.preventDefault();
    leseDatei(datei);
  });

  /** Meldung und Warnungen leeren (ohne Felder zu ändern). */
  function leeren() {
    setStatus('', null);
    list.replaceChildren();
    list.hidden = true;
  }

  return { node, leeren };
}
