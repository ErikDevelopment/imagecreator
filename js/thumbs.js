// Modul: thumbs
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { state, getFile, markImages, thumbKey } = MB['project'];
const { decodeImageRecord, renderEdited, canvasToBlob, hasEdits, releaseSource } = MB['imaging'];
const { sniffMime } = MB['util'];
const db = MB['db'];
// Vorschaubilder: Erzeugung im Hintergrund (Worker-Pool), Zwischenspeicherung in IndexedDB,
// gleichzeitige Erfassung der Metadaten (Abmessungen, EXIF-Datum, tatsächlicher Dateityp).
// Der Worker-Pool erledigt außerdem die Bildvorbereitung für den Word-Export (renderForReport).

const urlCache = new Map();          // thumbKey -> objectURL
const waiting = new Map();           // thumbKey -> [callbacks]
// Warteschlange mit zwei Stufen: sichtbare Kacheln (hi, zuletzt angefordert zuerst) und Hintergrund (lo, der Reihe nach)
const jobs = new Map();              // thumbKey -> Auftrag (noch nicht gestartet)
let hi = [], lo = [], loIdx = 0;
const failed = new Set();            // thumbKeys, die in dieser Sitzung nicht erzeugt werden konnten
let running = 0;
let paused = false;                  // während des Word-Exports gehören die Worker dem Export
const CORES = navigator.hardwareConcurrency || 4;
// Arbeitsspeicher des Geräts (Chromium meldet max. 8): wenig Speicher → weniger parallele Worker
const MEM_GB = navigator.deviceMemory || 4;
const MAX_PARALLEL = Math.max(2, Math.min(MEM_GB >= 8 ? 4 : MEM_GB >= 4 ? 3 : 2, CORES - 1));
const IDLE_MS = 2500;                // so lange untätig → Worker beenden und Speicher freigeben
let idleTimer = null;
let workers = [];
// Worker nur bei Auslieferung über http(s); bei file:// blockieren Browser Worker-Dateien → Hauptthread
let workerOk = location.protocol !== 'file:' && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
const progressListeners = new Set();
const onProgress = fn => { progressListeners.add(fn); return () => progressListeners.delete(fn); };
let totalPlanned = 0, totalDone = 0;

function emitProgress() { progressListeners.forEach(fn => fn({ pending: jobs.size + running, done: totalDone, total: totalPlanned })); }

function initWorkers() {
  clearTimeout(idleTimer);
  if (!workerOk || workers.length) return;
  try {
    for (let i = 0; i < MAX_PARALLEL; i++) { const w = new Worker('js/thumb-worker.js'); w.busy = false; workers.push(w); }
  } catch (e) { workerOk = false; workers = []; }
}
function freeWorker() { initWorkers(); return workers.find(w => !w.busy) || null; }

function runInWorker(w, payload, transfer) {
  return new Promise(res => {
    w.busy = true;
    w.onmessage = ev => { w.busy = false; res(ev.data); };
    w.onerror = ev => { w.busy = false; res({ id: payload.id, needsMain: true, error: ev.message }); };
    w.postMessage(payload, transfer || []);
  });
}

function resetCache() {
  for (const u of urlCache.values()) URL.revokeObjectURL(u);
  urlCache.clear(); jobs.clear(); hi = []; lo = []; loIdx = 0; failed.clear(); totalPlanned = 0; totalDone = 0;
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
  const existing = jobs.get(key);
  if (existing) { if (prio >= 2 && existing.prio < 2) { existing.prio = prio; hi.push(existing); } return; }
  if (running && runningKeys.has(key)) return;
  const job = { im, key, prio };
  jobs.set(key, job);
  (prio >= 2 ? hi : lo).push(job);
  totalPlanned++;
  pump();
}
const runningKeys = new Set();

function nextJob() {
  while (hi.length) { const j = hi.pop(); if (jobs.get(j.key) === j) return j; }
  while (loIdx < lo.length) { const j = lo[loIdx++]; if (jobs.get(j.key) === j) return j; }
  hi = []; lo = []; loIdx = 0;
  return null;
}

// Alle Bilder im Hintergrund verarbeiten (Metadaten + Vorschau)
async function processAll(images) {
  // Gespeicherte Vorschaubilder in EINEM Datenbankzugriff laden statt einzeln
  const pid = images[0]?.projectId;
  if (pid) {
    try {
      const recs = await db.getAllByProject('thumbs', pid);
      const stored = new Map(recs.map(r => [r.key, r.blob]));
      for (const im of images) {
        const k = thumbKey(im);
        if (im.metaDone && !urlCache.has(k) && stored.get(k)) { jobs.delete(k); deliver(k, stored.get(k)); }
      }
    } catch (e) { console.warn('Vorschaubilder konnten nicht gesammelt geladen werden', e); }
  }
  for (const im of images) if ((!im.metaDone || !urlCache.has(thumbKey(im))) && im.status !== 'fehler') enqueue(im, 0);
  emitProgress();
}

function pump() {
  while (!paused && running < MAX_PARALLEL) {
    const job = nextJob();
    if (!job) break;
    jobs.delete(job.key);
    runningKeys.add(job.key);
    running++;
    processJob(job).catch(e => console.warn(e)).finally(() => {
      running--; totalDone++; runningKeys.delete(job.key);
      if (!jobs.size && !running) { totalPlanned = 0; totalDone = 0; scheduleIdle(); }
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

// Gespeicherte Vorschaubilder gesammelt in einer Transaktion schreiben
const thumbBuffer = [];
let thumbTimer;
function queueThumbSave(rec) { thumbBuffer.push(rec); clearTimeout(thumbTimer); thumbTimer = thumbBuffer.length >= 40 ? (flushThumbs(), null) : setTimeout(flushThumbs, 500); }
function flushThumbs() { if (thumbBuffer.length) db.putMany('thumbs', thumbBuffer.splice(0)).catch(e => console.warn('Vorschaubilder nicht gespeichert', e)); }

async function processJob({ im, key }) {
  if (urlCache.has(key) && im.metaDone) { deliver(key, null, true); return; }   // inzwischen gesammelt geladen
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
  const size = state.settings.thumbSize || 360;
  let blob = stored?.blob || null;
  let result = null;
  const w = !hasEdits(im.edits) && !im.pdfPage ? freeWorker() : null;   // PDF-Seiten rendert pdf.js im Hauptprogramm
  if (w) {
    result = await runInWorker(w, { id: im.id, file, size, wantMeta: needMeta });
    if (result.thumb) blob = result.thumb;
  }
  if (needMeta && result?.meta) Object.assign(im, result.meta);
  if (result?.width) { im.width = result.width; im.height = result.height; }

  if (!blob || hasEdits(im.edits)) {
    // Hauptprogramm: Spezialformate (HEIC/TIFF), bearbeitete Bilder oder kein Worker (file://)
    try {
      const noCrop = !im.edits?.crop;
      const src = await decodeImageRecord(im, file, noCrop ? size : (im.pdfPage ? 1600 : 0));
      im.width = src.origWidth || src.width; im.height = src.origHeight || src.height;
      if (needMeta && !result?.meta) await readMetaMain(im, file);
      const c = renderEdited(src, im.edits, { maxDim: size });
      releaseSource(src);
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
  queueThumbSave({ key, projectId: im.projectId, blob });
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

function deliver(key, blob, fromCache = false) {
  let url = fromCache ? urlCache.get(key) : null;
  if (!blob && !fromCache) failed.add(key);
  if (blob) { url = URL.createObjectURL(blob); const old = urlCache.get(key); if (old) URL.revokeObjectURL(old); urlCache.set(key, url); }
  const cbs = waiting.get(key) || [];
  waiting.delete(key);
  for (const cb of cbs) { try { cb(url); } catch (e) { console.error(e); } }
}

// Nach einer Bearbeitung: Vorschaubild neu erzeugen
function invalidate(im) {
  enqueue(im, 3, true);
}

// Sichtbare Kacheln vorziehen (ohne die ganze Warteschlange zu durchsuchen)
function bumpPriority(ims) {
  for (const im of ims) { const j = jobs.get(thumbKey(im)); if (j && j.prio < 2) { j.prio = 2; hi.push(j); } }
}

// Untätige Worker beenden: gibt deren gesamten Speicher (dekodierte Bilder, Zeichenflächen) sofort frei
function scheduleIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (running || jobs.size || paused || workers.some(w => w.busy)) return;
    for (const w of workers) w.terminate();
    workers = [];
  }, IDLE_MS);
}

// ---------- Word-Export: Bilder parallel im Worker-Pool vorbereiten ----------
function pauseBackground(on) { paused = on; if (!on) { pump(); if (!jobs.size && !running) scheduleIdle(); } }
function workerCount() { initWorkers(); return workers.length; }

async function acquireWorker() {
  for (;;) {
    const w = freeWorker();
    if (w) { w.busy = true; return w; }
    if (!workerOk) return null;
    await new Promise(r => setTimeout(r, 8));
  }
}

// Liefert { data: Uint8Array, w, h } oder null (dann bereitet der Aufrufer im Hauptprogramm vor)
async function renderForReport(file, maxDim, quality) {
  if (!workerOk) return null;
  const w = await acquireWorker();
  if (!w) return null;
  const r = await runInWorker(w, { type: 'render', id: Math.random(), file, maxDim, quality });
  if (!r || r.error || !r.buf) return null;
  return { data: new Uint8Array(r.buf), w: r.w, h: r.h };
}

MB['thumbs'] = { onProgress, resetCache, cachedThumb, requestThumb, processAll, invalidate, bumpPriority, pauseBackground, workerCount, renderForReport };
})();
