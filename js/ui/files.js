// Dateien: herunterladen, lesen, teilen und Datei-Felder. Nur Browser-API, keine Formeln.

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Datei zum Herunterladen anbieten. content: Text, Bytes oder Blob. */
export function downloadFile(content, fileName, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Datei auf dem Handy über das Teilen-Menü anbieten, sonst herunterladen.
 * Ein Abbruch durch den Nutzer wird still ignoriert, andere Fehler werden weitergegeben.
 */
export async function shareOrDownload(file) {
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (error) {
      if (error?.name !== 'AbortError') throw error;
    }
    return;
  }
  downloadFile(file, file.name, file.type);
}

/** Text einer Datei lesen. */
export function readText(file) {
  return file.text();
}

/** Datei zu groß für die Eingabe (mehr als 5 MB). */
export function isTooLarge(file) {
  return file.size > MAX_FILE_BYTES;
}

/** Verstecktes Datei-Feld. onFile bekommt die gewählte Datei; das Feld wird danach geleert. */
export function fileInput(accept, onFile) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.className = 'file-input';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  input.addEventListener('change', () => {
    const file = input.files?.[0] ?? null;
    // Leeren, damit dieselbe Datei erneut gewählt werden kann. Das File-Objekt bleibt lesbar.
    input.value = '';
    if (file) onFile(file);
  });
  return input;
}
