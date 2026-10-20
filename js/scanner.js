// Modul: scanner
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { extOf, loadJSZip, naturalCompare } = MB['util'];
// Einlesen von Ordnerstrukturen aus verschiedenen Quellen
//  - File System Access API (Chrome/Edge): dauerhafter Zugriff über gespeichertes Handle
//  - <input webkitdirectory> (alle modernen Browser): einmaliger Zugriff, leere Ordner nicht sichtbar
//  - Drag & Drop eines Ordners
//  - ZIP-Archiv
//
// Ergebnis: { rootName, dirs: Set<relPfad>, files: [{ relPath, name, dirPath, size, lastModified, getFile }], ignored, sourceType, handle }


const IMAGE_EXT = new Set(['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif']);
// Bildformate, die erkannt, aber nicht dargestellt werden können (werden als Eintrag mit Hinweis angezeigt)
const KNOWN_UNSUPPORTED = new Set(['cr2', 'cr3', 'nef', 'arw', 'dng', 'raw', 'orf', 'rw2', 'raf', 'psd', 'svg', 'jxl', 'ico', 'jp2', 'emf', 'wmf']);

const SKIP_NAMES = new Set(['thumbs.db', 'desktop.ini', '.ds_store', '__macosx', '$recycle.bin', 'system volume information', '.spotlight-v100', '.trashes', '.fseventsd']);
const isSkipped = name => name.startsWith('.') || name.startsWith('~$') || SKIP_NAMES.has(name.toLowerCase());
const isCandidate = name => { const e = extOf(name); return IMAGE_EXT.has(e) || KNOWN_UNSUPPORTED.has(e); };
// .txt-Dateien in Bildordnern sind Kommentare (Dateiname = Kommentartext, Inhalt optional)
const isNote = name => extOf(name) === 'txt';

const supportsFSA = () => typeof window.showDirectoryPicker === 'function';

// ---------- File System Access API ----------
async function pickDirectoryFSA() {
  return window.showDirectoryPicker({ id: 'montagebericht', mode: 'read' });
}

async function scanDirectoryHandle(rootHandle, onProgress) {
  const dirs = new Set(['']);
  const files = [];
  const notes = [];
  let ignored = 0, dirCount = 0;
  async function walk(dirHandle, rel) {
    const entries = [];
    try {
      for await (const [name, h] of dirHandle.entries()) entries.push([name, h]);
    } catch (e) {
      console.warn('Ordner nicht lesbar:', rel, e);
      return;
    }
    entries.sort((a, b) => naturalCompare(a[0], b[0]));
    for (const [name, h] of entries) {
      if (isSkipped(name)) { ignored++; continue; }
      const p = rel ? rel + '/' + name : name;
      if (h.kind === 'directory') {
        dirs.add(p);
        dirCount++;
        await walk(h, p);
      } else if (isCandidate(name)) {
        files.push({ relPath: p, name, dirPath: rel, handle: h, getFile: () => h.getFile() });
        if (files.length % 50 === 0) onProgress?.({ phase: 'scan', files: files.length, dirs: dirCount });
      } else if (isNote(name)) notes.push({ relPath: p, name, dirPath: rel, getFile: () => h.getFile() });
      else ignored++;
    }
  }
  await walk(rootHandle, '');
  onProgress?.({ phase: 'scan', files: files.length, dirs: dirCount });
  return { rootName: rootHandle.name, dirs, files, notes, ignored, sourceType: 'fsa', handle: rootHandle };
}

// Datei über ein gespeichertes Wurzel-Handle anhand des relativen Pfads auflösen
async function resolveFromHandle(rootHandle, relPath, cache) {
  const parts = relPath.split('/');
  const fileName = parts.pop();
  let dir = rootHandle, acc = '';
  for (const part of parts) {
    acc = acc ? acc + '/' + part : part;
    let next = cache?.get(acc);
    if (!next) {
      next = await dir.getDirectoryHandle(part);
      cache?.set(acc, next);
    }
    dir = next;
  }
  const fh = await dir.getFileHandle(fileName);
  return fh.getFile();
}

async function ensurePermission(handle, request = false) {
  if (!handle?.queryPermission) return 'denied';
  let p = await handle.queryPermission({ mode: 'read' });
  if (p === 'granted' || !request) return p;
  try { p = await handle.requestPermission({ mode: 'read' }); } catch { p = 'denied'; }
  return p;
}

// ---------- <input webkitdirectory> ----------
function scanFileList(fileList) {
  const list = Array.from(fileList);
  if (!list.length) throw new Error('Der ausgewählte Ordner enthält keine Dateien (oder der Browser hat keine übermittelt).');
  const first = list[0].webkitRelativePath || list[0].name;
  const rootName = first.includes('/') ? first.split('/')[0] : 'Import';
  const dirs = new Set(['']);
  const files = [];
  const notes = [];
  let ignored = 0;
  for (const f of list) {
    const full = f.webkitRelativePath || f.name;
    const parts = full.split('/');
    if (parts.length > 1 && parts[0] === rootName) parts.shift();
    if (parts.some(isSkipped)) { ignored++; continue; }
    const name = parts[parts.length - 1];
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    if (isNote(name)) { notes.push({ relPath: parts.join('/'), name, dirPath: parts.slice(0, -1).join('/'), getFile: async () => f }); continue; }
    if (!isCandidate(name)) { ignored++; continue; }
    const relPath = parts.join('/');
    files.push({ relPath, name, dirPath: parts.slice(0, -1).join('/'), size: f.size, lastModified: f.lastModified, getFile: async () => f, file: f });
  }
  return { rootName, dirs, files, notes, ignored, sourceType: 'files', handle: null };
}

// ---------- Drag & Drop ----------
async function scanDataTransfer(dt, onProgress) {
  const items = Array.from(dt.items || []).filter(i => i.kind === 'file');
  // Chromium: echtes Handle -> dauerhafter Zugriff möglich
  if (items.length === 1 && items[0].getAsFileSystemHandle) {
    try {
      const h = await items[0].getAsFileSystemHandle();
      if (h?.kind === 'directory') return scanDirectoryHandle(h, onProgress);
      if (h?.kind === 'file' && /\.zip$/i.test(h.name)) return scanZip(await h.getFile(), onProgress);
    } catch (e) { console.warn('Handle nicht verfügbar, Fallback auf Entries', e); }
  }
  const entries = items.map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length === 1 && entries[0].isFile && /\.zip$/i.test(entries[0].name)) {
    const f = await new Promise((res, rej) => entries[0].file(res, rej));
    return scanZip(f, onProgress);
  }
  if (entries.length === 1 && entries[0].isDirectory) return scanEntry(entries[0], onProgress);
  throw new Error('Bitte genau einen Ordner (oder eine ZIP-Datei) in das Fenster ziehen.');
}

async function scanEntry(rootEntry, onProgress) {
  const dirs = new Set(['']);
  const files = [];
  const notes = [];
  let ignored = 0;
  const readAll = reader => new Promise((res, rej) => {
    const out = [];
    const next = () => reader.readEntries(batch => { if (!batch.length) res(out); else { out.push(...batch); next(); } }, rej);
    next();
  });
  async function walk(entry, rel) {
    const children = await readAll(entry.createReader());
    children.sort((a, b) => naturalCompare(a.name, b.name));
    for (const c of children) {
      if (isSkipped(c.name)) { ignored++; continue; }
      const p = rel ? rel + '/' + c.name : c.name;
      if (c.isDirectory) { dirs.add(p); await walk(c, p); }
      else if (isCandidate(c.name)) {
        const f = await new Promise((res, rej) => c.file(res, rej));
        files.push({ relPath: p, name: c.name, dirPath: rel, size: f.size, lastModified: f.lastModified, getFile: async () => f, file: f });
        if (files.length % 50 === 0) onProgress?.({ phase: 'scan', files: files.length, dirs: dirs.size - 1 });
      } else if (isNote(c.name)) {
        const f = await new Promise((res, rej) => c.file(res, rej));
        notes.push({ relPath: p, name: c.name, dirPath: rel, getFile: async () => f });
      } else ignored++;
    }
  }
  await walk(rootEntry, '');
  return { rootName: rootEntry.name, dirs, files, notes, ignored, sourceType: 'files', handle: null };
}

// ---------- ZIP ----------
// CP850 (DOS Westeuropa) – Windows-Explorer-ZIPs ohne UTF-8-Kennzeichen verwenden oft diese Kodierung
const CP850_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ';
function decodeZipName(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return Array.from(bytes, b => b < 128 ? String.fromCharCode(b) : CP850_HIGH[b - 128]).join(''); }
}

async function scanZip(zipFile, onProgress) {
  const JSZip = await loadJSZip();
  onProgress?.({ phase: 'zip', message: 'ZIP-Archiv wird geöffnet …' });
  const zip = await JSZip.loadAsync(zipFile, { decodeFileName: decodeZipName });
  const all = Object.values(zip.files);
  // Gemeinsamen Wurzelordner ermitteln
  const tops = new Set(all.map(e => e.name.split('/')[0]));
  const singleRoot = tops.size === 1 && all.some(e => e.name.includes('/'));
  const rootName = singleRoot ? [...tops][0] : zipFile.name.replace(/\.zip$/i, '');
  const strip = p => singleRoot ? p.split('/').slice(1).join('/') : p;
  const dirs = new Set(['']);
  const files = [];
  const notes = [];
  let ignored = 0;
  for (const e of all) {
    const rel = strip(e.name.replace(/\/+$/, ''));
    if (!rel) continue;
    const parts = rel.split('/');
    if (parts.some(isSkipped)) { ignored++; continue; }
    if (e.dir) { for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/')); continue; }
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    const name = parts[parts.length - 1];
    if (isNote(name)) { notes.push({ relPath: rel, name, dirPath: parts.slice(0, -1).join('/'), getFile: async () => new File([await e.async('blob')], name) }); continue; }
    if (!isCandidate(name)) { ignored++; continue; }
    const lm = e.date ? e.date.getTime() : 0;
    files.push({
      relPath: rel, name, dirPath: parts.slice(0, -1).join('/'), size: e._data?.uncompressedSize, lastModified: lm,
      getFile: async () => new File([await e.async('blob')], name, { lastModified: lm }),
    });
  }
  files.sort((a, b) => naturalCompare(a.relPath, b.relPath));
  return { rootName, dirs, files, notes, ignored, sourceType: 'zip', handle: null };
}

// ---------- Kommentare aus .txt-Dateien ----------
// Allgemeine Dateinamen ohne Aussage → dann zählt nur der Inhalt
const GENERIC_NOTE = /^(neu(es)? textdokument|new text document|notiz(en)?|kommentar(e)?|readme|info|text|beschreibung|bemerkung(en)?)(\s*\(\d+\))?$/i;
function decodeText(buf) {
  const b = new Uint8Array(buf);
  const start = b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF ? 3 : 0;
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(start)); }
  catch { return new TextDecoder('windows-1252').decode(b); }   // ältere Windows-Editoren
}
// Liest alle .txt-Kommentare eines Scans: Map dirPath -> [{ file, title, text }]
async function readNotes(scan) {
  const out = new Map();
  const list = [...(scan.notes || [])].sort((a, b) => naturalCompare(a.name, b.name));
  for (const n of list) {
    const title = n.name.replace(/\.txt$/i, '').trim();
    let text = '';
    try {
      const f = await n.getFile();
      if (f.size > 0 && f.size < 256 * 1024) text = decodeText(await f.arrayBuffer()).replace(/\r\n?/g, '\n').trim();
    } catch { /* nicht lesbar → nur Dateiname */ }
    if (!out.has(n.dirPath)) out.set(n.dirPath, []);
    out.get(n.dirPath).push({ file: n.name, title, generic: GENERIC_NOTE.test(title), text });
  }
  return out;
}
// Anzeigetext eines Kommentars: Dateiname (ohne .txt), bei Inhalt zusätzlich der Text
function commentText(c) {
  if (c.generic) return c.text || '';
  return c.text && c.text !== c.title ? `${c.title}\n${c.text}` : c.title;
}
MB['scanner'] = { IMAGE_EXT, KNOWN_UNSUPPORTED, isCandidate, isNote, readNotes, commentText, supportsFSA, pickDirectoryFSA, scanDirectoryHandle, resolveFromHandle, ensurePermission, scanFileList, scanDataTransfer, scanZip };
})();
