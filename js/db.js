// Modul: db
(function () {
'use strict';
const MB = (window.MB = window.MB || {});

// IndexedDB-Zugriff: Projekte, Ordner, Bilder, Vorschaubilder, Ordner-Handles, Einstellungen, Dateikopien

const DB_NAME = 'montagebericht';
const DB_VERSION = 1;
let dbPromise;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      if (!db.objectStoreNames.contains('thumbs')) db.createObjectStore('thumbs', { keyPath: 'key' }).createIndex('projectId', 'projectId');
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles', { keyPath: 'projectId' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'key' }).createIndex('projectId', 'projectId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Datenbank ist in einem anderen Tab blockiert. Bitte andere Tabs der Anwendung schließen.'));
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('Transaktion abgebrochen'));
  });
}
const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

async function get(store, key) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).get(key));
}
async function getAll(store) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).getAll());
}
async function getAllByProject(store, projectId) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).index('projectId').getAll(projectId));
}
async function put(store, value) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return done(tx);
}
async function putMany(store, values) {
  if (!values.length) return;
  const db = await openDB();
  // In Blöcken schreiben, damit sehr große Projekte die Transaktion nicht überlasten
  for (let i = 0; i < values.length; i += 2000) {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const v of values.slice(i, i + 2000)) os.put(v);
    await done(tx);
  }
}
async function del(store, key) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return done(tx);
}
async function delMany(store, keys) {
  if (!keys.length) return;
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const k of keys) os.delete(k);
  return done(tx);
}
async function deleteByProject(store, projectId) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const idx = tx.objectStore(store).index('projectId');
  const req = idx.openKeyCursor(IDBKeyRange.only(projectId));
  req.onsuccess = () => {
    const c = req.result;
    if (c) { tx.objectStore(store).delete(c.primaryKey); c.continue(); }
  };
  return done(tx);
}

async function deleteProject(projectId) {
  for (const s of ['folders', 'images', 'thumbs', 'files']) await deleteByProject(s, projectId);
  await del('handles', projectId);
  await del('projects', projectId);
}

async function getSetting(key, fallback) {
  const r = await get('settings', key);
  return r ? r.value : fallback;
}
async function setSetting(key, value) { return put('settings', { key, value }); }

async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* nicht verfügbar */ }
}

async function storageEstimate() {
  try { return await navigator.storage.estimate(); } catch { return null; }
}
MB['db'] = { openDB, get, getAll, getAllByProject, put, putMany, del, delMany, deleteByProject, deleteProject, getSetting, setSetting, requestPersistence, storageEstimate };
})();
