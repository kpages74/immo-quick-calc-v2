// PDF lokal lesen. pdf.js 3.11.174 liegt in js/vendor/ und wird erst geladen, wenn ein PDF gewählt wird.
// leseTextAusPdf liefert den Text der ersten Seiten, renderPdfSeiten die ersten Seiten als Bild (für die Texterkennung
// eingescannter PDFs, js/ui/ocr.js). Suchen und Auswerten macht js/expose.js, Anzeige js/ui/quickie.js.
const LIB = 'js/vendor/pdf.min.js';
const WORKER = 'js/vendor/pdf.worker.min.js';
const MAX_SEITEN = 20;

let libPromise = null;

/** pdf.js einmal per <script> laden. Bei Fehler wird es beim nächsten Mal erneut versucht. */
function ladeBibliothek() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = LIB;
      script.onload = () => {
        if (window.pdfjsLib) resolve(window.pdfjsLib);
        else reject(new Error('pdf.js fehlt'));
      };
      script.onerror = () => {
        script.remove();
        libPromise = null;
        reject(new Error('pdf.js konnte nicht geladen werden'));
      };
      document.head.append(script);
    });
  }
  return libPromise;
}

/** PDF-Dokument aus einer Datei öffnen. Wirft, wenn das PDF nicht geöffnet werden kann. */
async function oeffneDokument(file) {
  const lib = await ladeBibliothek();
  lib.GlobalWorkerOptions.workerSrc = WORKER;
  const data = new Uint8Array(await file.arrayBuffer());
  return lib.getDocument({ data }).promise;
}

/** Text der ersten Seiten (höchstens 20) einer PDF-Datei. Wirft, wenn das PDF nicht geöffnet werden kann. */
export async function leseTextAusPdf(file) {
  const doc = await oeffneDokument(file);
  let text = '';
  const seiten = Math.min(doc.numPages, MAX_SEITEN);
  for (let i = 1; i <= seiten; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += `${content.items.map((it) => it.str).join(' ')}\n`;
  }
  await doc.destroy();
  return text;
}

/**
 * Erste Seiten (höchstens maxSeiten) als Canvas, weißer Grund, Maßstab scale (2 entspricht etwa 144 dpi).
 * Wirft, wenn das PDF nicht geöffnet werden kann.
 */
export async function renderPdfSeiten(file, maxSeiten = 3, scale = 2) {
  const doc = await oeffneDokument(file);
  const bilder = [];
  try {
    const seiten = Math.min(doc.numPages, maxSeiten);
    for (let i = 1; i <= seiten; i += 1) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      bilder.push(canvas);
    }
  } finally {
    await doc.destroy();
  }
  return bilder;
}
