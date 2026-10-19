// Modul: util
(function () {
'use strict';
const MB = (window.MB = window.MB || {});

// Allgemeine Hilfsfunktionen

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
const naturalCompare = (a, b) => collator.compare(a, b);

function uid(prefix = '') {
  const r = crypto.getRandomValues(new Uint32Array(2));
  return prefix + Date.now().toString(36) + r[0].toString(36) + r[1].toString(36);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatBytes(n) {
  if (n == null || isNaN(n)) return '–';
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toLocaleString('de-DE', { maximumFractionDigits: n < 10 ? 1 : 0 }) + ' ' + u[i];
}

function formatDateTime(v) {
  if (!v) return '–';
  // Lokale ISO-Zeichenkette ohne Zeitzone (EXIF) oder Zeitstempel
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return `${m[3]}.${m[2]}.${m[1]}${m[4] ? ` ${m[4]}:${m[5]}${m[6] ? ':' + m[6] : ''}` : ''}`;
    return v;
  }
  const d = new Date(v);
  if (isNaN(d)) return '–';
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function todayDE() {
  return new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

const scriptCache = new Map();
function loadScript(src) {
  if (!scriptCache.has(src)) {
    scriptCache.set(src, new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => res();
      s.onerror = () => { scriptCache.delete(src); rej(new Error('Bibliothek konnte nicht geladen werden: ' + src)); };
      document.head.append(s);
    }));
  }
  return scriptCache.get(src);
}

const VENDOR = {
  docx: 'vendor/docx.iife.js',
  jszip: 'vendor/jszip.min.js',
  exifr: 'vendor/exifr.umd.js',
  heic: 'vendor/heic2any.min.js',
  pako: 'vendor/pako.min.js',
  utif: 'vendor/UTIF.js',
};

async function loadJSZip() { await loadScript(VENDOR.jszip); return window.JSZip; }
async function loadDocx() { await loadScript(VENDOR.docx); return window.docx; }

function pathJoin(a, b) { return a ? (b ? a + '/' + b : a) : b; }
function parentPath(p) { if (!p) return null; const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
function baseName(p) { const i = p.lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1); }
function extOf(name) { const i = name.lastIndexOf('.'); return i < 0 ? '' : name.slice(i + 1).toLowerCase(); }

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

async function saveBlob(blob, filename, types) {
  if ('showSaveFilePicker' in window) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: filename, types });
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
      console.warn('Speicherdialog nicht verfügbar, Download wird verwendet', e);
    }
  }
  downloadBlob(blob, filename);
  return true;
}

function safeFileName(s) {
  return String(s || 'Bericht').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Bericht';
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// Erkennt den tatsächlichen Dateityp anhand der ersten Bytes
async function sniffMime(file) {
  try {
    const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const s = (o, l) => String.fromCharCode(...b.slice(o, o + l));
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b[0] === 0x89 && s(1, 3) === 'PNG') return 'image/png';
    if (s(0, 4) === 'GIF8') return 'image/gif';
    if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'image/webp';
    if (s(0, 2) === 'BM') return 'image/bmp';
    if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2A) || (b[0] === 0x4D && b[1] === 0x4D && b[3] === 0x2A)) return 'image/tiff';
    if (s(4, 4) === 'ftyp') {
      const brand = s(8, 4);
      if (/^(heic|heix|hevc|hevx|heim|heis)$/.test(brand)) return 'image/heic';
      if (/^(mif1|msf1)$/.test(brand)) return 'image/heif';
      if (/^(avif|avis)$/.test(brand)) return 'image/avif';
    }
    return 'unbekannt';
  } catch { return 'nicht lesbar'; }
}

function nextFrame() { return new Promise(r => requestAnimationFrame(() => r())); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
MB['util'] = { collator, naturalCompare, uid, escapeHtml, formatBytes, formatDateTime, todayDE, debounce, el, loadScript, VENDOR, loadJSZip, loadDocx, pathJoin, parentPath, baseName, extOf, downloadBlob, saveBlob, safeFileName, clamp, sniffMime, nextFrame, sleep };
})();
