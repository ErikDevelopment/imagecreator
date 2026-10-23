// Modul: pdf
// PDF-Dateien in den Bildordnern: jede Seite wird zu einem eigenen „Bild“, das wie ein Foto
// ausgewählt, beschriftet, bearbeitet und in Bericht/Word-Tabelle eingefügt werden kann.
// Rendering mit pdf.js (Mozilla) – lädt nur bei Bedarf und läuft komplett im Browser.
(function () {
'use strict';
const MB = (window.MB = window.MB || {});

const AUTO_SELECT_MAX_PAGES = 5;    // längere PDFs (z. B. Handbücher) nicht automatisch in den Bericht
let libPromise = null;

function vendorBase() { return new URL('vendor/pdfjs/', document.baseURI).href; }

// pdf.js wird als ES-Modul nachgeladen. Bei Doppelklick-Start (file://) blockieren Browser das → nur online.
function loadPdfjs() {
  if (!libPromise) {
    if (location.protocol === 'file:') return Promise.reject(new Error('PDF-Seiten können nur in der Online-Version (GitHub Pages) angezeigt werden.'));
    libPromise = import(vendorBase() + 'pdf.min.mjs').then(lib => {
      lib.GlobalWorkerOptions.workerSrc = vendorBase() + 'pdf.worker.min.mjs';
      return lib;
    }).catch(e => { libPromise = null; throw new Error('PDF-Bibliothek konnte nicht geladen werden: ' + e.message); });
  }
  return libPromise;
}

// Geöffnete Dokumente kurz zwischenspeichern (mehrere Seiten derselben Datei hintereinander)
const docCache = new Map();   // Schlüssel -> Promise<PDFDocumentProxy>
const CACHE_MAX = 3;
function docKey(file) { return `${file.name}|${file.size}|${file.lastModified}`; }

async function openDoc(file) {
  const key = docKey(file);
  if (docCache.has(key)) { const p = docCache.get(key); docCache.delete(key); docCache.set(key, p); return p; }
  const p = (async () => {
    const lib = await loadPdfjs();
    const data = new Uint8Array(await file.arrayBuffer());
    return lib.getDocument({
      data,
      isEvalSupported: false,                       // Sicherheit: kein eval für Schriftprogramme
      standardFontDataUrl: vendorBase() + 'standard_fonts/',
      useSystemFonts: true,
    }).promise;
  })();
  docCache.set(key, p);
  p.catch(() => docCache.delete(key));
  while (docCache.size > CACHE_MAX) {
    const [k, old] = docCache.entries().next().value;
    docCache.delete(k);
    old.then(d => d.destroy()).catch(() => {});
  }
  return p;
}

// Seitenzahl ermitteln (beim Einlesen)
async function pageCount(file) {
  const doc = await openDoc(file);
  return doc.numPages;
}

/**
 * Rendert eine Seite so, dass die längere Seite ca. targetMax Pixel hat (Standard 2000).
 * Ergebnis: <canvas> mit weißem Hintergrund, plus origWidth/origHeight (Seitengröße bei 96 dpi).
 */
async function renderPage(file, pageNo, targetMax = 2000) {
  const doc = await openDoc(file);
  const page = await doc.getPage(pageNo);
  try {
    const base = page.getViewport({ scale: 1 });                 // 1 = 72 dpi
    const scale = Math.max(0.1, targetMax / Math.max(base.width, base.height));
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.floor(vp.width)); c.height = Math.max(1, Math.floor(vp.height));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp, background: 'rgb(255,255,255)' }).promise;
    c.origWidth = Math.round(base.width * 96 / 72);
    c.origHeight = Math.round(base.height * 96 / 72);
    return c;
  } finally {
    page.cleanup();
  }
}

/**
 * Ersetzt im Scan-Ergebnis jede PDF-Datei durch einen Eintrag pro Seite.
 * Nicht lesbare PDFs bleiben als einzelner Eintrag mit Fehlerhinweis sichtbar.
 */
async function expandPdfs(scan, onProgress) {
  const pdfs = scan.files.filter(f => /\.pdf$/i.test(f.name));
  if (!pdfs.length) return scan;
  const out = [];
  let n = 0;
  for (const f of scan.files) {
    if (!/\.pdf$/i.test(f.name)) { out.push(f); continue; }
    onProgress?.({ phase: 'pdf', done: n, total: pdfs.length, message: `PDF wird gelesen: ${f.name}` });
    let pages = 0, error = null;
    try { pages = await pageCount(await f.getFile()); }
    catch (e) { error = e.message || String(e); }
    n++;
    if (!pages) { out.push({ ...f, ext: 'pdf', pdfError: error || 'PDF enthält keine Seiten.' }); continue; }
    const base = f.name.replace(/\.pdf$/i, '');
    for (let p = 1; p <= pages; p++) {
      out.push({
        ...f,
        relPath: `${f.relPath}#Seite${p}`,                  // eindeutiger Pfad je Seite
        fileRelPath: f.relPath,                             // echte Datei auf dem Datenträger
        name: pages === 1 ? `${base}.pdf` : `${base}.pdf – Seite ${String(p).padStart(String(pages).length, '0')}`,
        ext: 'pdf', pdfPage: p, pdfPages: pages, pdfName: f.name,
        autoSelect: pages <= AUTO_SELECT_MAX_PAGES,
      });
    }
  }
  return { ...scan, files: out, pdfCount: pdfs.length };
}

MB['pdf'] = { loadPdfjs, pageCount, renderPage, expandPdfs, AUTO_SELECT_MAX_PAGES };
})();
