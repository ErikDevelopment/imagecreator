// Hintergrund-Worker: Vorschaubilder und Metadaten erzeugen, ohne die Oberfläche zu blockieren.
/* global exifr */
let exifrReady = false;
try { importScripts('../vendor/exifr.umd.js'); exifrReady = typeof exifr !== 'undefined'; } catch (e) { exifrReady = false; }

function exifDateToLocalIso(v) {
  if (!v) return null;
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m || m[1] === '0000') return null;
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  }
  return null;
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

self.onmessage = async ev => {
  const { id, file, size, wantMeta } = ev.data;
  const res = { id };
  try {
    if (wantMeta) res.meta = await readMeta(file);
    let bmp;
    try {
      bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      res.needsMain = true; // z. B. HEIC/TIFF -> Hauptthread mit Spezialdecoder
      self.postMessage(res);
      return;
    }
    res.width = bmp.width; res.height = bmp.height;
    const s = Math.min(1, size / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    res.thumb = await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  } catch (e) {
    res.error = String(e?.message || e);
  }
  self.postMessage(res);
};
