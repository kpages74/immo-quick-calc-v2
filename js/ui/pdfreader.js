// PDF lokal lesen. pdf.js 3.11.174 liegt in js/vendor/ und wird erst geladen, wenn ein PDF gewählt wird.
// Liefert nur den Text der ersten Seiten. Suchen und Auswerten macht js/expose.js, Anzeige js/ui/quickie.js.
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

/** Text der ersten Seiten (höchstens 20) einer PDF-Datei. Wirft, wenn das PDF nicht geöffnet werden kann. */
export async function leseTextAusPdf(file) {
  const lib = await ladeBibliothek();
  lib.GlobalWorkerOptions.workerSrc = WORKER;
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await lib.getDocument({ data }).promise;
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
