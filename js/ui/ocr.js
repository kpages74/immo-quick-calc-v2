// Texterkennung (OCR) lokal mit Tesseract.js 5.1.1 (Apache-2.0). Alle Dateien liegen in js/vendor/tesseract/,
// es gibt keine Netzanfragen. tesseract.min.js wird erst beim ersten Bedarf per <script> geladen. Für jeden Vorgang
// startet ein Worker mit der Sprache deu, der danach beendet wird. Auswerten macht js/expose.js, Anzeige js/ui/quickie.js.
const BASE = 'js/vendor/tesseract/';

let libPromise = null;

/**
 * Fehler der Texterkennung. art: 'laden' (Bibliothek, Sprachdatei oder Worker fehlen) oder 'erkennung' (Lauf gescheitert).
 */
export class OcrFehler extends Error {
  constructor(art, cause) {
    super(`Texterkennung: ${art}`, { cause });
    this.name = 'OcrFehler';
    this.art = art;
  }
}

/** Adresse einer Datei aus js/vendor/tesseract/, relativ zur App (funktioniert auch in einem Unterordner). */
function adresse(datei) {
  return new URL(`${BASE}${datei}`, window.location.href).href;
}

/** tesseract.min.js einmal per <script> laden. Bei Fehler wird es beim nächsten Mal erneut versucht. */
function ladeBibliothek() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = adresse('tesseract.min.js');
      script.onload = () => {
        if (window.Tesseract) {
          resolve(window.Tesseract);
        } else {
          script.remove();
          libPromise = null;
          reject(new Error('Tesseract fehlt'));
        }
      };
      script.onerror = () => {
        script.remove();
        libPromise = null;
        reject(new Error('tesseract.min.js konnte nicht geladen werden'));
      };
      document.head.append(script);
    });
  }
  return libPromise;
}

/**
 * Bilddatei (PNG, JPEG, WebP, GIF, BMP) als Canvas. Der Browser dekodiert das Format, der Grund wird weiß gefüllt,
 * damit transparente Bereiche nicht schwarz gelesen werden. Wirft, wenn die Datei nicht gelesen werden kann.
 */
export async function bildAlsCanvas(file) {
  const bild = await dekodiere(file);
  const canvas = document.createElement('canvas');
  canvas.width = bild.width;
  canvas.height = bild.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bild.quelle, 0, 0);
  if (bild.quelle.close) bild.quelle.close();
  return canvas;
}

/** Bild dekodieren: zuerst createImageBitmap (zuverlässig, auch in Hintergrund-Tabs), sonst <img> mit onload. */
async function dekodiere(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { quelle: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      // weiter mit <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Bild nicht lesbar'));
      image.src = url;
    });
    return { quelle: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Erkennt den Text je Bild (Canvas) mit einem Worker für Deutsch. onFortschritt(index, anteil 0..1) wird während
 * der Erkennung aufgerufen. Liefert je Bild einen Text. Wirft OcrFehler mit art 'laden' oder 'erkennung'.
 */
export async function erkenneTexte(bilder, onFortschritt) {
  let T;
  try {
    T = await ladeBibliothek();
  } catch (e) {
    throw new OcrFehler('laden', e);
  }

  let index = 0;
  let worker;
  try {
    worker = await T.createWorker('deu', 1, {
      workerPath: adresse('worker.min.js'),
      corePath: adresse(''),
      langPath: adresse(''),
      cacheMethod: 'none',
      workerBlobURL: false,
      logger: (m) => {
        if (m.status === 'recognizing text' && onFortschritt) onFortschritt(index, m.progress);
      },
    });
  } catch (e) {
    throw new OcrFehler('laden', e);
  }

  try {
    await worker.setParameters({ tessedit_pageseg_mode: '3' }); // AUTO: mehrere Textblöcke einer Seite
    const texte = [];
    for (index = 0; index < bilder.length; index += 1) {
      const { data } = await worker.recognize(bilder[index], {}, { text: true });
      texte.push(data.text ?? '');
    }
    return texte;
  } catch (e) {
    throw new OcrFehler('erkennung', e);
  } finally {
    await worker.terminate().catch(() => {});
  }
}
