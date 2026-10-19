// Modul: project
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { buildRecords, mergeRescan, derive, folderId } = MB['analyze'];
const { DEFAULT_RULES } = MB['rules'];
const { uid, sniffMime, todayDE } = MB['util'];
const { resolveFromHandle, ensurePermission } = MB['scanner'];
const db = MB['db'];
// Projektzustand im Speicher, Laden/Speichern, Dateizugriff

const listeners = new Set();
const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (what) => listeners.forEach(fn => { try { fn(what); } catch (e) { console.error(e); } });

const state = {
  project: null, folders: [], images: [], model: null,
  handle: null, permission: 'none',
  sessionFiles: new Map(),   // relPath -> getFile() (nur für aktuelle Sitzung)
  dirCache: new Map(),
  rules: DEFAULT_RULES,
  settings: { autoSelect: true, thumbSize: 360, storeCopies: true },
};

async function loadGlobalSettings() {
  state.rules = await db.getSetting('rules', DEFAULT_RULES);
  state.settings = { ...state.settings, ...(await db.getSetting('general', {})) };
}
async function saveRules(rules) { state.rules = rules; await db.setSetting('rules', rules); }
async function saveGeneralSettings(s) { state.settings = { ...state.settings, ...s }; await db.setSetting('general', state.settings); }

function defaultReportSettings(name) {
  return {
    title: 'Montagebericht', subtitle: name || '', customer: '', site: '', plant: '', orderNo: '', technician: '', date: todayDE(),
    intro: '', includeToc: true, numbering: true, perRow: 2, caption: 'filename', compareMode: 'pairs', quality: 'standard',
    skipEmpty: true, showPath: false, onlySelected: true, logo: null, pageOrientation: 'portrait', showDocPointNote: true,
  };
}

// ---------- Projekt anlegen ----------
async function createProject(scan, onProgress, opts = {}) {
  const id = uid('prj_');
  const { folders, images } = buildRecords(id, scan, state.rules, { autoSelect: state.settings.autoSelect });
  const storeCopies = scan.sourceType !== 'fsa' && opts.storeCopies !== false;
  const project = {
    id, name: scan.rootName, rootName: scan.rootName, sourceType: scan.sourceType, storeCopies,
    createdAt: Date.now(), updatedAt: Date.now(), openedAt: Date.now(), scannedAt: Date.now(), lastBackup: null,
    ignoredFiles: scan.ignored, report: defaultReportSettings(scan.rootName),
  };
  await db.put('projects', project);
  await db.putMany('folders', folders);
  await db.putMany('images', images);
  if (scan.handle) await db.put('handles', { projectId: id, handle: scan.handle });
  if (storeCopies) {
    let n = 0;
    for (const f of scan.files) {
      const file = await f.getFile();
      await db.put('files', { key: id + '|' + f.relPath, projectId: id, file });
      if (++n % 20 === 0) onProgress?.({ phase: 'copy', done: n, total: scan.files.length });
    }
  }
  await db.requestPersistence();
  await openProject(id, scan);
  return id;
}

async function openProject(id, scan) {
  const project = await db.get('projects', id);
  if (!project) throw new Error('Projekt nicht gefunden');
  project.openedAt = Date.now();
  await db.put('projects', project);
  state.project = project;
  state.folders = await db.getAllByProject('folders', id);
  state.images = await db.getAllByProject('images', id);
  state.sessionFiles = new Map();
  state.dirCache = new Map();
  state.handle = null; state.permission = 'none';
  if (scan) for (const f of scan.files) state.sessionFiles.set(f.relPath, f.getFile);
  const h = await db.get('handles', id);
  if (h?.handle) { state.handle = h.handle; state.permission = await ensurePermission(h.handle, false); }
  rederive();
  emit('open');
}

function closeProject() {
  state.project = null; state.folders = []; state.images = []; state.model = null;
  state.sessionFiles = new Map(); state.handle = null;
  emit('close');
}

function rederive() {
  if (!state.project) return;
  state.model = derive(state.project, state.folders, state.images);
  emit('model');
}

// ---------- Speichern ----------
let pendingImages = new Map(), pendingFolders = new Map(), saveTimer = null;
function markImages(list, { derive: d = false, silent = false } = {}) {
  for (const im of list) pendingImages.set(im.id, im);
  scheduleSave();
  if (silent) return;
  if (d) rederive(); else emit('images');
}
function markFolders(list, { derive: d = true } = {}) {
  for (const f of list) pendingFolders.set(f.id, f);
  scheduleSave();
  if (d) rederive();
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 400);
}
async function flush() {
  clearTimeout(saveTimer);
  const imgs = [...pendingImages.values()], fols = [...pendingFolders.values()];
  pendingImages.clear(); pendingFolders.clear();
  if (imgs.length) await db.putMany('images', imgs);
  if (fols.length) await db.putMany('folders', fols);
  if (state.project && (imgs.length || fols.length)) { state.project.updatedAt = Date.now(); await db.put('projects', state.project); }
}
window.addEventListener('beforeunload', () => { flush(); });

async function saveProject() {
  if (!state.project) return;
  state.project.updatedAt = Date.now();
  await db.put('projects', state.project);
  emit('project');
}

function folder(path) { return state.model?.fmap.get(path); }
function updateFolder(path, patch) {
  const f = state.folders.find(x => x.path === path);
  if (!f) return;
  Object.assign(f, patch);
  markFolders([f]);
}

// ---------- Dateizugriff ----------
async function requestHandlePermission() {
  if (!state.handle) return 'none';
  state.permission = await ensurePermission(state.handle, true);
  emit('permission');
  return state.permission;
}

function filesAvailable() {
  if (!state.project) return false;
  if (state.sessionFiles.size) return true;
  if (state.project.storeCopies) return true;
  return state.handle && state.permission === 'granted';
}

async function getFile(image) {
  const sf = state.sessionFiles.get(image.relPath);
  if (sf) return sf();
  if (state.handle) {
    if (state.permission !== 'granted') state.permission = await ensurePermission(state.handle, false);
    if (state.permission === 'granted') return resolveFromHandle(state.handle, image.relPath, state.dirCache);
  }
  if (state.project.storeCopies) {
    const r = await db.get('files', state.project.id + '|' + image.relPath);
    if (r?.file) return r.file;
  }
  const err = new Error('Originaldatei derzeit nicht erreichbar. Bitte Projektordner erneut verbinden.');
  err.code = 'NOFILE';
  throw err;
}

// Wenn der Benutzer einen Ordner erneut auswählt (Fallback-Browser), Dateien dieser Sitzung zuordnen
function attachSessionScan(scan) {
  state.sessionFiles = new Map(scan.files.map(f => [f.relPath, f.getFile]));
  if (scan.handle) { state.handle = scan.handle; state.permission = 'granted'; db.put('handles', { projectId: state.project.id, handle: scan.handle }); }
  emit('permission');
}

// ---------- Neu einlesen ----------
async function applyRescan(scan) {
  const p = state.project;
  const res = mergeRescan(p.id, scan, state.rules, state.folders, state.images, { autoSelect: state.settings.autoSelect });
  for (const im of res.images) { delete im.isNew; }
  for (const f of res.folders) { delete f.isNew; }
  await db.delMany('folders', res.removedFolders);
  // veraltete Vorschaubilder geänderter Dateien entfernen
  const changed = res.images.filter(i => i.status === 'geändert');
  await db.delMany('thumbs', changed.map(i => thumbKey(i)));
  for (const i of changed) i.editVersion = (i.editVersion || 0); // Bearbeitung bleibt erhalten
  await db.putMany('folders', res.folders);
  await db.putMany('images', res.images);
  if (p.storeCopies) {
    for (const f of scan.files) {
      const old = state.images.find(i => i.relPath === f.relPath);
      const now = res.images.find(i => i.relPath === f.relPath);
      if (!old || now.status === 'geändert') await db.put('files', { key: p.id + '|' + f.relPath, projectId: p.id, file: await f.getFile() });
    }
  }
  p.scannedAt = Date.now();
  p.ignoredFiles = scan.ignored;
  await db.put('projects', p);
  state.folders = res.folders;
  state.images = res.images;
  attachSessionScan(scan);
  rederive();
  return res.stats;
}

// Regeln geändert: erkannte Rollen neu berechnen (manuelle Festlegungen bleiben)
async function reclassify(classifyName) {
  for (const f of state.folders) f.detected = f.path === '' ? null : classifyName(f.name, state.rules);
  await db.putMany('folders', state.folders);
  rederive();
}

const thumbKey = im => `${im.id}|${im.editVersion || 0}|${im.sig || ''}`;

async function removeMissingImages() {
  const missing = state.images.filter(i => i.status === 'fehlt');
  await db.delMany('images', missing.map(i => i.id));
  state.images = state.images.filter(i => i.status !== 'fehlt');
  rederive();
  return missing.length;
}

async function listProjects() {
  const ps = await db.getAll('projects');
  return ps.sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
}
MB['project'] = { folderId, sniffMime, onChange, state, loadGlobalSettings, saveRules, saveGeneralSettings, defaultReportSettings, createProject, openProject, closeProject, rederive, markImages, markFolders, flush, saveProject, folder, updateFolder, requestHandlePermission, filesAvailable, getFile, attachSessionScan, applyRescan, reclassify, thumbKey, removeMissingImages, listProjects };
})();
