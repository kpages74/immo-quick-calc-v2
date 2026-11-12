// Bausteine der Oberfläche: Elemente erzeugen, Text und Schrift einpassen. Nur DOM-API (createElement, textContent).

/** Element mit Klasse und Text erzeugen. Text wird als Text gesetzt, nie als Markup. */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Hinweistext setzen; ohne Text bleibt der Knoten ausgeblendet. */
export function setHint(node, text) {
  node.textContent = text ?? '';
  node.hidden = !text;
}

/** Schriftgröße verkleinern, bis der Text in die Breite passt (mindestens 60 %). */
export function fitText(node) {
  node.style.fontSize = '';
  const width = node.clientWidth;
  const needed = node.scrollWidth;
  if (width > 0 && needed > width + 1) {
    const base = parseFloat(getComputedStyle(node).fontSize);
    const min = base * 0.6;
    let size = Math.max(min, (base * width) / needed);
    node.style.fontSize = `${size}px`;
    // Die Breite ist nicht exakt proportional zur Schrift: in kleinen Schritten nachverkleinern.
    while (node.scrollWidth > width + 1 && size > min) {
      size = Math.max(min, size - 0.25);
      node.style.fontSize = `${size}px`;
    }
  }
}

// Messfeld für Eingabefelder: gleiche Schrift wie das Feld, außerhalb des sichtbaren Layouts.
let probe = null;

/** Schrift eines Zahlenfeldes (Pill) verkleinern, damit der Inhalt ohne Auslassung passt (mindestens 60 %). */
export function fitPill(input) {
  input.style.fontSize = '';
  const width = input.clientWidth;
  if (width <= 0) return;
  const cs = getComputedStyle(input);
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
  const avail = width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const needed = probe.getBoundingClientRect().width;
  if (avail > 0 && needed > avail) {
    const base = parseFloat(cs.fontSize);
    input.style.fontSize = `${Math.max(base * 0.6, (base * avail * 0.98) / needed)}px`;
  }
}
