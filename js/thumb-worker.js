// Hintergrund-Worker: Vorschaubilder + Metadaten erzeugen und Bilder für den Word-Export vorbereiten,
// ohne die Oberfläche zu blockieren.
/* global exifr, MBFast */
let exifrReady = false;
try { importScripts('../vendor/exifr.umd.js'); exifrReady = typeof exifr !== 'undefined'; } catch (e) { exifrReady = false; }
try { importScripts('fastdecode.js'); } catch (e) { self.MBFast = null; }

function exifDateToLocalIso(v) {
  if (!v || typeof v !== 'string') return null;
  const m = v.match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m || m[1] === '0000') return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

async function readMeta(file) {
  const out = { dateTaken: null, dateSource: null, exifOrientation: null, camera: null };
  if (!exifrReady) return out;
  try {
    const t = await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized', 'Orientation', 'Make', 'Model'], reviveValues: false, translateValues: false });
    if (t) {
      const d = exifDateToLocalIso(t.DateTimeOriginal) || exifDateToLocalIso(t.DateTimeDigitized) || exifDateToLocalIso(t.CreateDate);
      if (d) { out.dateTaken = d; out.dateSource = t.DateTimeOriginal ? 'EXIF DateTimeOriginal' : 'EXIF Erstellungsdatum'; }
      if (t.Orientation) out.exifOrientation = t.Orientation;
      const cam = [t.Make, t.Model].filter(Boolean).join(' ').trim();
      if (cam) out.camera = cam;
    }
  } catch { /* keine EXIF-Daten */ }
  return out;
}

// Zwei feste Zeichenflächen pro Worker statt neuer Flächen pro Bild: verhindert, dass sich bei
// hunderten Fotos Grafik-/Arbeitsspeicher ansammelt (führte in Arc/Chrome auf dem Mac zu Abstürzen).
const decodeCanvas = new OffscreenCanvas(1, 1);
const outCanvas = new OffscreenCanvas(1, 1);
const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
function release() { decodeCanvas.width = decodeCanvas.height = 1; outCanvas.width = outCanvas.height = 1; }

// Quelle in Zielgröße holen: zuerst schneller JPEG-Weg, sonst volles Dekodieren
async function getSource(file, targetMax) {
  const fast = self.MBFast ? await self.MBFast.decodeScaled(file, targetMax, decodeCanvas) : null;
  if (fast) return { src: fast.canvas, w: fast.width, h: fast.height, origW: fast.origWidth, origH: fast.origHeight, close() {} };
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return { src: bmp, w: bmp.width, h: bmp.height, origW: bmp.width, origH: bmp.height, close() { bmp.close(); } };
}

function drawFit(source, maxDim, background) {
  const s = Math.min(1, maxDim / Math.max(source.w, source.h));
  const w = Math.max(1, Math.round(source.w * s)), h = Math.max(1, Math.round(source.h * s));
  const c = outCanvas;
  c.width = w; c.height = h;
  const ctx = outCtx;
  ctx.imageSmoothingQuality = 'high';
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(source.src, 0, 0, w, h);
  return c;
}

self.onmessage = async ev => {
  const d = ev.data;
  // Bild für den Word-Export (ohne Bearbeitungen) in Zielgröße als JPEG
  if (d.type === 'render') {
    try {
      const source = await getSource(d.file, d.maxDim);
      const c = drawFit(source, d.maxDim, '#ffffff');
      source.close();
      const w = c.width, h = c.height;
      const buf = await (await c.convertToBlob({ type: 'image/jpeg', quality: d.quality || 0.86 })).arrayBuffer();
      release();
      self.postMessage({ id: d.id, buf, w, h }, [buf]);
    } catch (e) {
      release();
      self.postMessage({ id: d.id, error: String(e?.message || e) });
    }
    return;
  }
  // Vorschaubild + Metadaten
  const { id, file, size, wantMeta } = d;
  const res = { id };
  try {
    if (wantMeta) res.meta = await readMeta(file);
    let source;
    try { source = await getSource(file, size); }
    catch (e) { res.needsMain = true; self.postMessage(res); return; }   // z. B. HEIC/TIFF → Hauptprogramm
    res.width = source.origW; res.height = source.origH;
    const c = drawFit(source, size);
    source.close();
    res.thumb = await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  } catch (e) {
    res.error = String(e?.message || e);
  }
  release();
  self.postMessage(res);
};
