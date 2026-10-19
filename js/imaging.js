// Modul: imaging
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { loadScript, VENDOR, extOf } = MB['util'];
// Bilddekodierung (inkl. HEIC/TIFF), nicht-destruktive Bearbeitung und Rendering

// ---------- Dekodieren ----------
async function decodeFile(file, nameHint) {
  const ext = extOf(nameHint || file.name || '');
  if (ext === 'tif' || ext === 'tiff') return decodeTiff(file);
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    if (ext === 'heic' || ext === 'heif') return decodeHeic(file);
    // Fallback über <img> (manche Formate/Browser)
    return decodeViaImg(file);
  }
}

async function decodeViaImg(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return await createImageBitmap(img);
  } catch {
    throw new Error('Bild kann von diesem Browser nicht dekodiert werden (Datei beschädigt oder Format nicht unterstützt).');
  } finally { URL.revokeObjectURL(url); }
}

async function decodeHeic(file) {
  try {
    await loadScript(VENDOR.heic);
    const out = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    const blob = Array.isArray(out) ? out[0] : out;
    return await createImageBitmap(blob);
  } catch (e) {
    throw new Error('HEIC-Datei konnte nicht umgewandelt werden: ' + (e?.message || e?.code || e));
  }
}

async function decodeTiff(file) {
  await loadScript(VENDOR.pako);
  await loadScript(VENDOR.utif);
  const UTIF = window.UTIF;
  const buf = await file.arrayBuffer();
  const ifds = UTIF.decode(buf);
  if (!ifds.length) throw new Error('TIFF enthält keine Bilddaten');
  // größtes Teilbild verwenden
  let page = ifds[0];
  for (const i of ifds) if ((i.width || 0) * (i.height || 0) > (page.width || 0) * (page.height || 0)) page = i;
  UTIF.decodeImage(buf, page, ifds);
  const rgba = UTIF.toRGBA8(page);
  const id = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), page.width, page.height);
  return createImageBitmap(id);
}

// ---------- Bearbeitungen ----------
function emptyEdits() {
  return { rotate: 0, flipH: false, flipV: false, crop: null, adjust: { brightness: 100, contrast: 100, saturation: 100 }, annotations: [] };
}
function hasEdits(e) {
  if (!e) return false;
  return !!(e.rotate || e.flipH || e.flipV || e.crop || (e.annotations && e.annotations.length) ||
    (e.adjust && (e.adjust.brightness !== 100 || e.adjust.contrast !== 100 || e.adjust.saturation !== 100)));
}

function rotatedSize(w, h, rot) { return (rot % 180) ? [h, w] : [w, h]; }

let filterSupported;
function canvasFilterSupported() {
  if (filterSupported === undefined) {
    const c = document.createElement('canvas').getContext('2d');
    filterSupported = c && 'filter' in c;
    if (filterSupported) { c.filter = 'brightness(50%)'; filterSupported = c.filter === 'brightness(50%)'; }
  }
  return filterSupported;
}

// Zeichnet die Quelle (ImageBitmap) mit allen Bearbeitungen in ein neues Canvas.
// opts.maxDim begrenzt die Ausgabegröße; opts.skipCrop/skipAnnotations für den Editor.
function renderEdited(src, edits, opts = {}) {
  const e = edits || emptyEdits();
  const W = src.width, H = src.height;
  const rot = ((e.rotate || 0) % 360 + 360) % 360;
  const [RW, RH] = rotatedSize(W, H, rot);
  const crop = (!opts.skipCrop && e.crop) ? e.crop : { x: 0, y: 0, w: 1, h: 1 };
  const cx = crop.x * RW, cy = crop.y * RH, cw = Math.max(1, crop.w * RW), ch = Math.max(1, crop.h * RH);
  const s = opts.maxDim ? Math.min(1, opts.maxDim / Math.max(cw, ch)) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cw * s));
  canvas.height = Math.max(1, Math.round(ch * s));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (opts.background) { ctx.fillStyle = opts.background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  const adj = e.adjust || { brightness: 100, contrast: 100, saturation: 100 };
  const needAdj = adj.brightness !== 100 || adj.contrast !== 100 || adj.saturation !== 100;
  const useFilter = needAdj && canvasFilterSupported();
  ctx.save();
  if (useFilter) ctx.filter = `brightness(${adj.brightness}%) contrast(${adj.contrast}%) saturate(${adj.saturation}%)`;
  ctx.scale(s, s);
  ctx.translate(-cx, -cy);
  ctx.translate(RW / 2, RH / 2);
  ctx.rotate(rot * Math.PI / 180);
  ctx.scale(e.flipH ? -1 : 1, e.flipV ? -1 : 1);
  ctx.drawImage(src, -W / 2, -H / 2);
  ctx.restore();
  if (needAdj && !useFilter) applyAdjustManually(ctx, canvas.width, canvas.height, adj);
  if (!opts.skipAnnotations && e.annotations?.length) {
    ctx.save();
    ctx.scale(s, s);
    ctx.translate(-cx, -cy);
    drawAnnotations(ctx, e.annotations, RW, RH);
    ctx.restore();
  }
  return canvas;
}

function applyAdjustManually(ctx, w, h, adj) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const b = adj.brightness / 100, c = adj.contrast / 100, sat = adj.saturation / 100;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] * b, g = d[i + 1] * b, bl = d[i + 2] * b;
    r = (r - 128) * c + 128; g = (g - 128) * c + 128; bl = (bl - 128) * c + 128;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    d[i] = l + (r - l) * sat; d[i + 1] = l + (g - l) * sat; d[i + 2] = l + (bl - l) * sat;
  }
  ctx.putImageData(img, 0, 0);
}

// Anmerkungen liegen normiert (0..1) im Koordinatensystem des gedrehten, ungeschnittenen Bildes
function drawAnnotations(ctx, anns, RW, RH, highlightIndex = -1) {
  const diag = Math.hypot(RW, RH);
  for (let i = 0; i < anns.length; i++) {
    const a = anns[i];
    const lw = Math.max(2, diag * 0.0035 * (a.width || 1));
    const x1 = a.x1 * RW, y1 = a.y1 * RH, x2 = (a.x2 ?? a.x1) * RW, y2 = (a.y2 ?? a.y1) * RH;
    ctx.save();
    ctx.strokeStyle = a.color || '#ff2d2d';
    ctx.fillStyle = a.color || '#ff2d2d';
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = lw * 0.8;
    if (a.type === 'arrow' || a.type === 'line') {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (a.type === 'arrow') {
        const ang = Math.atan2(y2 - y1, x2 - x1), hl = lw * 4.5;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - hl * Math.cos(ang - 0.45), y2 - hl * Math.sin(ang - 0.45));
        ctx.lineTo(x2 - hl * Math.cos(ang + 0.45), y2 - hl * Math.sin(ang + 0.45));
        ctx.closePath(); ctx.fill();
      }
    } else if (a.type === 'rect') {
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (a.type === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2 || 1, Math.abs(y2 - y1) / 2 || 1, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (a.type === 'text') {
      const fs = Math.max(12, RH * 0.045 * (a.size || 1));
      ctx.font = `600 ${fs}px "Segoe UI", system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.shadowBlur = 0;
      ctx.lineWidth = fs * 0.18;
      ctx.strokeStyle = 'rgba(0,0,0,.75)';
      const lines = String(a.text || '').split('\n');
      lines.forEach((ln, k) => { ctx.strokeText(ln, x1, y1 + k * fs * 1.2); ctx.fillText(ln, x1, y1 + k * fs * 1.2); });
    } else if (a.type === 'marker') {
      const r = Math.max(10, diag * 0.018 * (a.size || 1));
      ctx.beginPath(); ctx.arc(x1, y1, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${r * 1.15}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(a.text || '1'), x1, y1 + r * 0.05);
    }
    if (i === highlightIndex) {
      ctx.setLineDash([lw * 2, lw * 2]); ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, lw / 2); ctx.shadowBlur = 0;
      const pad = lw * 3;
      const bx = annotationBounds(a, RW, RH);
      ctx.strokeRect(bx.x - pad, bx.y - pad, bx.w + 2 * pad, bx.h + 2 * pad);
    }
    ctx.restore();
  }
}

function annotationBounds(a, RW, RH) {
  const x1 = a.x1 * RW, y1 = a.y1 * RH;
  if (a.type === 'text') {
    const fs = Math.max(12, RH * 0.045 * (a.size || 1));
    const lines = String(a.text || '').split('\n');
    const w = Math.max(...lines.map(l => l.length)) * fs * 0.58;
    return { x: x1, y: y1, w, h: lines.length * fs * 1.2 };
  }
  if (a.type === 'marker') {
    const r = Math.max(10, Math.hypot(RW, RH) * 0.018 * (a.size || 1));
    return { x: x1 - r, y: y1 - r, w: 2 * r, h: 2 * r };
  }
  const x2 = a.x2 * RW, y2 = a.y2 * RH;
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.85) {
  return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('Bild konnte nicht erzeugt werden')), type, quality));
}
MB['imaging'] = { decodeFile, emptyEdits, hasEdits, rotatedSize, renderEdited, drawAnnotations, annotationBounds, canvasToBlob };
})();
