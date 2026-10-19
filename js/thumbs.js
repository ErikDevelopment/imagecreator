// Modul: thumbs
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { state, getFile, markImages, thumbKey } = MB['project'];
const { decodeFile, renderEdited, canvasToBlob, hasEdits } = MB['imaging'];
const { sniffMime } = MB['util'];
const db = MB['db'];
// Vorschaubilder: Erzeugung im Hintergrund (Worker-Pool), Zwischenspeicherung in IndexedDB,
// gleichzeitige Erfassung der Metadaten (Abmessungen, EXIF-Datum, tatsächlicher Dateityp).

const urlCache = new Map();          // thumbKey -> objectURL
const waiting = new Map();           // thumbKey -> [callbacks]
const queue = [];                    // { im, prio }
const queued = new Set();
const failed = new Set();            // thumbKeys, die in dieser Sitzung nicht erzeugt werden konnten
let running = 0;
const MAX_PARALLEL = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
let workers = [];
// Worker nur bei Auslieferung über http(s); bei file:// blockieren Browser Worker-Dateien → Hauptthread
let workerOk = location.protocol !== 'file:' && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
const progressListeners = new Set();
const onProgress = fn => { progressListeners.add(fn); return () => progressListeners.delete(fn); };
let totalPlanned = 0, totalDone = 0;

function emitProgress() { progressListeners.forEach(fn => fn({ pending: queue.length + running, done: totalDone, total: totalPlanned })); }

function getWorker() {
  if (!workerOk) return null;
  if (!workers.length) {
    try {
      for (let i = 0; i < MAX_PARALLEL; i++) {
        const w = new Worker('js/thumb-worker.js');
        w.busy = false;
        workers.push(w);
      }
    } catch (e) { workerOk = false; return null; }
  }
  return workers.find(w => !w.busy) || null;
}

function runInWorker(w, payload) {
  return new Promise(res => {
    w.busy = true;
    w.onmessage = ev => { w.busy = false; res(ev.data); };
    w.onerror = ev => { w.busy = false; res({ id: payload.id, needsMain: true, error: ev.message }); };
    w.postMessage(payload);
  });
}

function resetCache() {
  for (const u of urlCache.values()) URL.revokeObjectURL(u);
  urlCache.clear(); queue.length = 0; queued.clear(); failed.clear(); totalPlanned = 0; totalDone = 0;
  emitProgress();
}

function cachedThumb(im) { return urlCache.get(thumbKey(im)) || null; }

// Liefert sofort eine URL, falls vorhanden; sonst wird die Erstellung eingeplant und cb später aufgerufen.
function requestThumb(im, cb, prio = 1) {
  const key = thumbKey(im);
  const u = urlCache.get(key);
  if (u) return u;
  if (failed.has(key) || im.status === 'nicht unterstützt' || im.status === 'fehlt') return null;
  if (cb) { if (!waiting.has(key)) waiting.set(key, []); waiting.get(key).push(cb); }
  enqueue(im, prio);
  return null;
}

function enqueue(im, prio, force = false) {
  if (im.status === 'nicht unterstützt' || im.status === 'fehlt') return;
  const key = thumbKey(im);
  if (failed.has(key) && !force) return;
  if (queued.has(key)) {
    if (prio > 1) { const q = queue.find(x => x.key === key); if (q && q.prio < prio) { q.prio = prio; } }
    return;
  }
  queued.add(key);
  queue.push({ im, key, prio });
  totalPlanned++;
  pump();
}

// Alle Bilder im Hintergrund verarbeiten (Metadaten + Vorschau)
function processAll(images) {
  for (const im of images) if ((!im.metaDone || !urlCache.has(thumbKey(im))) && im.status !== 'fehler') enqueue(im, 0);
  emitProgress();
}

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    // höchste Priorität zuerst (sichtbare Kacheln)
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].prio > queue[bi].prio) bi = i;
    const job = queue.splice(bi, 1)[0];
    running++;
    processJob(job).catch(e => console.warn(e)).finally(() => {
      running--; totalDone++; queued.delete(job.key);
      if (!queue.length && !running) { totalPlanned = 0; totalDone = 0; }
      emitProgress();
      pump();
    });
  }
  emitProgress();
}

const metaBuffer = [];
let metaTimer;
function flushMeta() { if (metaBuffer.length) markImages(metaBuffer.splice(0), { derive: false, silent: true }); }
function queueMetaSave(im) { metaBuffer.push(im); clearTimeout(metaTimer); metaTimer = setTimeout(flushMeta, 600); }

async function processJob({ im, key }) {
  // 1) Zwischengespeichertes Vorschaubild?
  const stored = await db.get('thumbs', key);
  if (stored?.blob && im.metaDone) { deliver(key, stored.blob); return; }

  let file;
  try { file = await getFile(im); }
  catch (e) {
    if (stored?.blob) { deliver(key, stored.blob); return; }
    if (e.code === 'NOFILE') { deliver(key, null); return; }
    setStatus(im, 'nicht lesbar', e.message); deliver(key, null); return;
  }
  const needMeta = !im.metaDone;
  if (needMeta) {
    im.mime = await sniffMime(file);
    im.size = file.size;
    im.lastModified = file.lastModified || im.lastModified;
    im.sig = `${file.size}-${file.lastModified || im.lastModified}`;
  }
  let blob = stored?.blob || null;
  let result = null;
  const w = getWorker();
  if (w && !hasEdits(im.edits)) {
    result = await runInWorker(w, { id: im.id, file, size: state.settings.thumbSize || 360, wantMeta: needMeta });
    if (result.thumb) blob = result.thumb;
  }
  if (needMeta && result?.meta) Object.assign(im, result.meta);
  if (result?.width) { im.width = result.width; im.height = result.height; }

  if (!blob || hasEdits(im.edits)) {
    // Hauptthread: Spezialformate (HEIC/TIFF) oder bearbeitete Bilder
    try {
      const bmp = await decodeFile(file, im.name);
      im.width = bmp.width; im.height = bmp.height;
      if (needMeta && !result?.meta) await readMetaMain(im, file);
      const c = renderEdited(bmp, im.edits, { maxDim: state.settings.thumbSize || 360 });
      bmp.close?.();
      blob = await canvasToBlob(c, 'image/jpeg', 0.82);
    } catch (e) {
      setStatus(im, 'fehler', e.message || String(e));
      im.metaDone = true; queueMetaSave(im);
      deliver(key, null);
      return;
    }
  }
  if (needMeta) {
    im.metaDone = true;
    if (im.status === 'ausstehend' || im.status === 'geändert' || im.status === 'nicht lesbar') { im.status = 'ok'; im.error = null; }
    if (im.mime && im.mimeExpected && im.mime !== 'unbekannt' && im.mime !== im.mimeExpected && !(im.mime === 'image/heif' && im.mimeExpected === 'image/heic')) {
      im.error = `Hinweis: Dateiendung .${im.ext}, tatsächlicher Typ ${im.mime}`;
    }
    queueMetaSave(im);
  }
  await db.put('thumbs', { key, projectId: im.projectId, blob });
  deliver(key, blob);
}

async function readMetaMain(im, file) {
  try {
    const { loadScript, VENDOR } = MB['util'];
    await loadScript(VENDOR.exifr);
    const t = await window.exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate', 'Orientation', 'Make', 'Model'], reviveValues: false, translateValues: false });
    const m = t?.DateTimeOriginal || t?.CreateDate;
    const mm = typeof m === 'string' && m.match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (mm && mm[1] !== '0000') { im.dateTaken = `${mm[1]}-${mm[2]}-${mm[3]}T${mm[4]}:${mm[5]}:${mm[6]}`; im.dateSource = 'EXIF'; }
    if (t?.Orientation) im.exifOrientation = t.Orientation;
    const cam = [t?.Make, t?.Model].filter(Boolean).join(' ').trim();
    if (cam) im.camera = cam;
  } catch { /* keine Metadaten */ }
}

function setStatus(im, status, error) { im.status = status; im.error = error; queueMetaSave(im); }

function deliver(key, blob) {
  let url = null;
  if (!blob) failed.add(key);
  if (blob) { url = URL.createObjectURL(blob); const old = urlCache.get(key); if (old) URL.revokeObjectURL(old); urlCache.set(key, url); }
  const cbs = waiting.get(key) || [];
  waiting.delete(key);
  for (const cb of cbs) { try { cb(url); } catch (e) { console.error(e); } }
}

// Nach einer Bearbeitung: Vorschaubild neu erzeugen
function invalidate(im) {
  enqueue(im, 3, true);
}

function bumpPriority(ims) { for (const im of ims) { const q = queue.find(x => x.im.id === im.id); if (q) q.prio = 2; } }
MB['thumbs'] = { onProgress, resetCache, cachedThumb, requestThumb, processAll, invalidate, bumpPriority };
})();
