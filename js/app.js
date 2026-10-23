// Modul: app
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { state, onChange, loadGlobalSettings, saveRules, saveGeneralSettings, createProject, openProject, closeProject, rederive, markImages, markFolders, flush, saveProject, requestHandlePermission, filesAvailable, attachSessionScan, applyRescan, reclassify, listProjects, removeMissingImages } = MB['project'];
const { supportsFSA, pickDirectoryFSA, scanDirectoryHandle, scanFileList, scanDataTransfer, scanZip, ensurePermission } = MB['scanner'];
const { classifyName } = MB['rules'];
const { descendantsOf, orderedFolderPaths } = MB['analyze'];
const { hasEdits } = MB['imaging'];
const { el, escapeHtml, formatBytes, formatDateTime, debounce, naturalCompare, saveBlob, safeFileName } = MB['util'];
const { modal, confirmDialog, promptDialog, toast, progressDialog } = MB['ui/dialogs'];
const { createTree } = MB['ui/tree'];
const { createGallery } = MB['ui/gallery'];
const { renderDetails } = MB['ui/details'];
const { createCompareView } = MB['ui/compare'];
const { openViewer, openCompareViewer } = MB['ui/viewer'];
const { openEditor } = MB['ui/editor'];
const { openRulesDialog } = MB['ui/settings'];
const { openReportDialog } = MB['ui/report-dialog'];
const { openTableCopyDialog } = MB['ui/table-copy'];
const { runChecks } = MB['checks'];
const { openChecksDialog } = MB['ui/checks-dialog'];
const { exportBackup, readBackup, restoreBackup } = MB['backup'];
const db = MB['db'];
const thumbs = MB['thumbs'];
// Montagebericht – Hauptmodul: Startbildschirm, Arbeitsbereich, Zustand der Oberfläche

const $ = id => document.getElementById(id);

// ---------- Oberflächenzustand ----------
const ui = {
  folder: '', includeSub: false, search: '', type: 'all', phase: 'all', docPoint: 'all', mark: 'all',
  sort: 'original', dir: 1, view: 'gallery', tile: 180,
  selection: new Set(), anchor: null, collapsed: new Set(),
};

let tree, gallery, compareView;

// ---------- Start ----------
async function init() {
  await db.openDB().catch(e => { document.body.innerHTML = `<div class="fatal"><h2>Datenbank nicht verfügbar</h2><p>${escapeHtml(e.message)}</p><p>Bitte die Anwendung nicht im privaten Fenster öffnen.</p></div>`; throw e; });
  await loadGlobalSettings();
  setupStart();
  setupWorkspace();
  setupDragDrop();
  thumbs.onProgress(updateProgress);
  onChange(what => {
    if (what === 'model' || what === 'open') { recheck(); refreshAll(); }
    else if (what === 'images') { recheckSoon(); refreshGallery(); refreshDetails(); updateStatus(); }
    else if (what === 'permission') updatePermissionUi();
  });
  const last = await db.getSetting('lastProject', null);
  const projects = await listProjects();
  if (last && projects.some(p => p.id === last) && new URLSearchParams(location.search).get('start') !== '1') await enterProject(last);
  else showStart();
}

function capabilityNotice() {
  const n = $('capNotice');
  const secure = window.isSecureContext;
  const fsa = supportsFSA();
  const parts = [];
  if (!secure) parts.push('<b>Achtung:</b> Dieser Browser behandelt die lokal geöffnete Datei nicht als sicheren Ursprung. Dauerhafter Ordnerzugriff und Speicherdialog sind deshalb gesperrt. Bitte Chrome oder Edge verwenden.');
  if (fsa && secure) parts.push('✓ Dieser Browser unterstützt <b>dauerhaften Ordnerzugriff</b>. Der Projektordner wird gemerkt und bei jedem Öffnen nur nach Erlaubnis gefragt. Bilder werden nicht kopiert.');
  else parts.push('Dieser Browser bietet keinen dauerhaften Ordnerzugriff (nur Chrome/Edge). Beim Einlesen wird stattdessen eine <b>Kopie der Bilder im Browser-Speicher</b> angelegt, damit das Projekt später wieder geöffnet werden kann. Leere Ordner werden über diesen Weg nicht erkannt.');
  n.innerHTML = parts.map(p => `<p>${p}</p>`).join('');
  n.className = 'notice ' + (!secure ? 'warn' : fsa ? 'ok' : '');
}

async function showStart() {
  await flush();
  closeProject();
  thumbs.resetCache();
  $('workspace').hidden = true;
  $('start').hidden = false;
  document.title = 'Montagebericht';
  capabilityNotice();
  const list = $('projectList');
  const projects = await listProjects();
  list.innerHTML = '';
  if (!projects.length) list.append(el('div', { class: 'empty-state small', html: '<p>Noch keine Projekte. Wähle oben einen Projektordner aus – die Struktur wird automatisch analysiert.</p>' }));
  for (const p of projects) {
    const src = { fsa: 'Ordnerzugriff', files: 'Kopie im Browser', zip: 'ZIP / Kopie' }[p.sourceType] || p.sourceType;
    const card = el('div', { class: 'pcard' },
      el('div', { class: 'pc-main', onclick: () => enterProject(p.id) },
        el('h3', { text: p.name }),
        el('div', { class: 'muted small', text: `Ordner „${p.rootName}“ · ${src}` }),
        el('div', { class: 'muted small', text: `Zuletzt geöffnet ${formatDateTime(p.openedAt)}${p.lastBackup ? ' · Sicherung ' + formatDateTime(p.lastBackup) : ' · noch keine Sicherung'}` })),
      el('div', { class: 'pc-actions' },
        el('button', { class: 'btn sm primary', text: 'Öffnen', onclick: () => enterProject(p.id) }),
        el('button', { class: 'btn sm ghost', text: 'Umbenennen', onclick: async () => { const n = await promptDialog('Projekt umbenennen', 'Name', p.name); if (n) { p.name = n; await db.put('projects', p); showStart(); } } }),
        el('button', { class: 'btn sm ghost danger-t', text: 'Löschen', onclick: async () => {
          if (await confirmDialog('Projekt löschen?', `„${p.name}“ wird mit allen Bearbeitungen, Vorschaubildern und gespeicherten Kopien aus der Anwendung entfernt.\nDie Originaldateien auf dem Datenträger bleiben unberührt.`, { ok: 'Löschen', danger: true })) {
            await db.deleteProject(p.id); toast('Projekt gelöscht.'); showStart();
          }
        } })));
    list.append(card);
  }
  const est = await db.storageEstimate();
  $('storageInfo').textContent = est ? `Belegter Speicher: ${formatBytes(est.usage)} von ca. ${formatBytes(est.quota)}` : '';
}

function setupStart() {
  $('btnPickFolder').addEventListener('click', () => pickFolder('new'));
  $('btnPickZip').addEventListener('click', () => { $('inpZip').dataset.mode = 'new'; $('inpZip').click(); });
  $('btnRestore').addEventListener('click', () => $('inpBackup').click());
  $('inpFolder').addEventListener('change', async e => {
    const files = e.target.files; const mode = e.target.dataset.mode;
    if (!files?.length) return;
    try { await handleScan(scanFileList(files), mode); } catch (err) { showError(err); }
    e.target.value = '';
  });
  $('inpZip').addEventListener('change', async e => {
    const f = e.target.files[0]; const mode = e.target.dataset.mode;
    if (!f) return;
    const prog = progressDialog('ZIP wird gelesen');
    try { const scan = await scanZip(f, x => prog.update(null, x.message)); prog.close(); await handleScan(scan, mode); }
    catch (err) { prog.close(); showError(err); }
    e.target.value = '';
  });
  $('inpBackup').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    e.target.value = '';
    try {
      const b = await readBackup(f);
      const exists = await db.get('projects', b.data.project.id);
      let replace = false;
      if (exists) {
        const r = await modal({ title: 'Projekt existiert bereits', body: `<p>„${escapeHtml(exists.name)}“ ist bereits vorhanden.</p>`, buttons: [{ label: 'Abbrechen', value: null, class: 'ghost' }, { label: 'Als Kopie wiederherstellen', value: 'copy', class: 'ghost' }, { label: 'Ersetzen', value: 'replace', class: 'danger' }] });
        if (!r) return;
        replace = r === 'replace';
      }
      const prog = progressDialog('Sicherung wird wiederhergestellt');
      const res = await restoreBackup(b, { replace }, (fr, t) => prog.update(fr, t));
      prog.close();
      toast(res.hasOriginals ? 'Projekt inkl. Originalbilder wiederhergestellt.' : 'Projekt wiederhergestellt. Bitte den Projektordner erneut verbinden, um auf die Originalbilder zuzugreifen.', { type: 'ok', timeout: 7000 });
      await enterProject(res.id);
    } catch (err) { showError(err); }
  });
}

// mode: 'new' | 'rescan' | 'relink'
async function pickFolder(mode) {
  if (supportsFSA() && window.isSecureContext) {
    let handle;
    try { handle = await pickDirectoryFSA(); }
    catch (e) { if (e.name !== 'AbortError') showError(e); return; }
    await handleHandle(handle, mode);
  } else {
    $('inpFolder').dataset.mode = mode;
    $('inpFolder').click();
  }
}

async function handleHandle(handle, mode) {
  const prog = progressDialog('Ordnerstruktur wird analysiert');
  try {
    const scan = await scanDirectoryHandle(handle, x => prog.update(null, `${x.files} Bilddateien in ${x.dirs} Ordnern gefunden …`));
    prog.close();
    await handleScan(scan, mode);
  } catch (e) { prog.close(); showError(e); }
}

async function handleScan(scan, mode) {
  if (!scan.files.length && scan.dirs.size <= 1) throw new Error('Im ausgewählten Ordner wurden keine Bilder oder Unterordner gefunden.');
  if (mode === 'rescan' || mode === 'relink') {
    if (scan.rootName !== state.project.rootName) {
      const ok = await confirmDialog('Anderer Ordnername', `Das Projekt wurde aus „${state.project.rootName}“ erstellt, gewählt wurde „${scan.rootName}“. Trotzdem verwenden? Bilder werden über ihren relativen Pfad zugeordnet.`, { ok: 'Verwenden' });
      if (!ok) return;
    }
    if (mode === 'relink') {
      attachSessionScan(scan);
      const paths = new Set(scan.files.map(f => f.relPath));
      const matched = state.images.filter(i => paths.has(i.fileRelPath || i.relPath)).length;
      toast(`Ordner verbunden – ${matched} von ${state.images.length} Bildern gefunden.`, { type: 'ok' });
      thumbs.resetCache(); refreshAll(); thumbs.processAll(state.images);
      return;
    }
    const stats = await applyRescan(scan);
    thumbs.resetCache();
    refreshAll();
    thumbs.processAll(state.images);
    toast(`Neu eingelesen: ${stats.added} neu, ${stats.changed} geändert, ${stats.missing} fehlen, ${stats.newFolders} neue Ordner.`, { type: 'ok', timeout: 7000 });
    if (stats.missing) {
      const rm = await confirmDialog('Fehlende Bilder', `${stats.missing} Bilder wurden nicht mehr gefunden. Sie bleiben vorerst als „fehlt“ sichtbar. Jetzt aus dem Projekt entfernen?`, { ok: 'Entfernen', cancel: 'Behalten' });
      if (rm) { const n = await removeMissingImages(); toast(`${n} fehlende Einträge entfernt.`); }
    }
    return;
  }
  // Neues Projekt: Zusammenfassung zeigen
  const total = scan.files.length;
  const pdfN = scan.files.filter(f => /\.pdf$/i.test(f.name)).length;
  const sizeKnown = scan.files.every(f => f.size != null);
  const bytes = sizeKnown ? scan.files.reduce((a, f) => a + (f.size || 0), 0) : null;
  let storeCopies = scan.sourceType !== 'fsa';
  const copyChk = el('input', { type: 'checkbox', checked: storeCopies });
  copyChk.onchange = () => { storeCopies = copyChk.checked; };
  const tops = [...scan.dirs].filter(p => p && !p.includes('/')).sort(naturalCompare);
  const body = el('div', {},
    el('p', { html: `<b>${escapeHtml(scan.rootName)}</b>: ${total - pdfN} Bilddateien${pdfN ? ` und ${pdfN} PDF${pdfN > 1 ? 's' : ''} (jede Seite wird ein eigenes Bild)` : ''} in ${scan.dirs.size - 1} Unterordnern${bytes != null ? ` (${formatBytes(bytes)})` : ''}. ${scan.notes?.length ? `${scan.notes.length} Kommentar-Datei${scan.notes.length > 1 ? 'en' : ''} (.txt) erkannt. ` : ''}${scan.ignored ? `${scan.ignored} andere Dateien werden ignoriert.` : ''}` }),
    tops.length ? el('div', { class: 'scan-preview', html: tops.slice(0, 40).map(t => `<div>📁 ${escapeHtml(t)}</div>`).join('') + (tops.length > 40 ? `<div class="muted">… und ${tops.length - 40} weitere</div>` : '') }) : null,
    scan.sourceType !== 'fsa' ? el('label', { class: 'check' }, copyChk, ' Kopie der Bilder im Browser speichern (empfohlen – sonst muss der Ordner bei jedem Öffnen neu gewählt werden)') : el('p', { class: 'muted small', text: 'Die Bilder bleiben am Originalort und werden nicht kopiert. Die Anwendung merkt sich den Ordner.' }));
  const ok = await modal({ title: 'Projektordner analysiert', body, buttons: [{ label: 'Abbrechen', value: false, class: 'ghost' }, { label: 'Projekt anlegen', value: true, class: 'primary' }] });
  if (ok !== true) return;
  const prog = progressDialog('Projekt wird angelegt');
  try {
    const id = await createProject(scan, x => prog.update(x.total ? x.done / x.total : null, x.message || `Bilder werden gespeichert: ${x.done} / ${x.total}`), { storeCopies });
    prog.close();
    await enterProject(id, true);
  } catch (e) { prog.close(); showError(e); }
}

function setupDragDrop() {
  let depth = 0;
  const ov = $('dropOverlay');
  const isFiles = e => e.dataTransfer?.types?.includes('Files');
  window.addEventListener('dragenter', e => { if (!isFiles(e)) return; depth++; ov.hidden = false; });
  window.addEventListener('dragleave', e => { if (!isFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) ov.hidden = true; });
  window.addEventListener('dragover', e => { if (isFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', async e => {
    if (!isFiles(e)) return;
    e.preventDefault(); depth = 0; ov.hidden = true;
    const mode = state.project ? 'relink-ask' : 'new';
    const prog = progressDialog('Ordner wird gelesen');
    try {
      const scan = await scanDataTransfer(e.dataTransfer, x => prog.update(null, x.message || `${x.files} Bilddateien gefunden …`));
      prog.close();
      if (mode === 'new') return handleScan(scan, 'new');
      const r = await modal({ title: 'Ordner abgelegt', body: `<p>Was soll mit „${escapeHtml(scan.rootName)}“ passieren?</p>`, buttons: [{ label: 'Abbrechen', value: null, class: 'ghost' }, { label: 'Als neues Projekt', value: 'new', class: 'ghost' }, { label: 'Aktuelles Projekt neu einlesen', value: 'rescan', class: 'primary' }] });
      if (r === 'new') { await showStart(); await handleScan(scan, 'new'); }
      else if (r === 'rescan') await handleScan(scan, 'rescan');
    } catch (err) { prog.close(); showError(err); }
  });
}

// ---------- Arbeitsbereich ----------
async function enterProject(id, fresh = false) {
  try { await openProject(id); }
  catch (e) { showError(e); return showStart(); }
  await db.setSetting('lastProject', id);
  Object.assign(ui, { folder: '', includeSub: false, search: '', type: 'all', phase: 'all', docPoint: 'all', mark: 'all', sort: 'original', dir: 1, selection: new Set(), anchor: null });
  const savedUi = state.project.ui || {};
  ui.collapsed = new Set(savedUi.collapsed || []);
  ui.view = savedUi.view || 'gallery';
  ui.tile = savedUi.tile || 180;
  // zuletzt gewählten Ordner wiederherstellen; Ordner ohne eigene Bilder zeigen automatisch ihre Unterordner
  if (savedUi.folder != null && state.model.info.has(savedUi.folder)) ui.folder = savedUi.folder;
  ui.includeSub = savedUi.includeSub ?? false;
  { const i = state.model.info.get(ui.folder); if (i && i.direct === 0 && i.total > 0) ui.includeSub = true; }
  if (fresh) {
    // Bei neuen Projekten: Wurzel mit allen Unterordnern zeigen
    ui.includeSub = true;
    // tiefe Ebenen zunächst eingeklappt lassen
    for (const f of state.folders) if (f.depth >= 2 && state.model.info.get(f.path)?.children.length) ui.collapsed.add(f.path);
  }
  $('start').hidden = true;
  $('workspace').hidden = false;
  syncToolbar();
  thumbs.resetCache();
  refreshAll(true);
  updatePermissionUi();
  thumbs.processAll(state.images);
  if (state.handle && state.permission !== 'granted') {
    toast('Für den Zugriff auf die Originalbilder ist eine erneute Freigabe nötig.', { action: () => grantAccess(), actionLabel: 'Zugriff erlauben', timeout: 12000 });
  }
}

async function grantAccess() {
  const p = await requestHandlePermission();
  if (p === 'granted') { thumbs.resetCache(); refreshAll(); thumbs.processAll(state.images); toast('Zugriff erlaubt.', { type: 'ok' }); }
  else toast('Zugriff wurde nicht erteilt.', { type: 'warn' });
}

function saveUiState() {
  if (!state.project) return;
  state.project.ui = { collapsed: [...ui.collapsed], view: ui.view, tile: ui.tile, folder: ui.folder, includeSub: ui.includeSub };
  saveProject();
}
const saveUiStateDebounced = debounce(saveUiState, 800);

function setupWorkspace() {
  tree = createTree($('tree'), {
    getModel: () => state.model, getState: () => ui,
    onSelect: path => selectFolder(path),
    onToggle: path => { ui.collapsed.has(path) ? ui.collapsed.delete(path) : ui.collapsed.add(path); tree.render(); saveUiStateDebounced(); },
    onDropImages: (ids, path) => assignImages(ids, path),
    onMoveFolder: (from, to, before) => moveFolder(from, to, before),
  });
  gallery = createGallery($('gallery'), $('gallerySpacer'), {
    onSelection: (ids, anchor, keepAnchor) => { ui.selection = new Set(ids); if (!keepAnchor || !ui.anchor) ui.anchor = anchor; else ui.anchor = anchor; gallery.setContext(galleryCtx()); refreshDetails(); updateStatus(); },
    onOpen: id => openImageViewer(id),
    onEdit: id => editImage(id),
    onToggleReport: id => { const im = state.model.imageById.get(id); patchImages([id], { selected: !im.selected }); },
    onToggleReportMany: ids => { const all = ids.every(id => state.model.imageById.get(id)?.selected); patchImages(ids, { selected: !all }); },
    onReorder: (ids, targetId, after) => reorderImages(ids, targetId, after),
  });
  compareView = createCompareView($('compare'), {
    getModel: () => state.model,
    saveCompare: (host, patch) => saveCompare(host, patch),
    openPair: (g, i) => openCompareViewer(g.rows.map(r => [state.model.imageById.get(r.b) || null, state.model.imageById.get(r.a) || null]), i, { title: state.model.info.get(g.hostPath).folder.name }),
    openImage: id => openImageViewer(id),
    selectImage: id => { ui.selection = new Set([id]); ui.anchor = id; refreshDetails(); },
    gotoFolder: p => selectFolder(p),
  });

  $('btnHome').addEventListener('click', () => { history.replaceState(null, '', '?start=1'); showStart(); });
  $('projectName').addEventListener('change', e => { state.project.name = e.target.value.trim() || state.project.rootName; saveProject(); document.title = state.project.name + ' – Montagebericht'; });
  $('btnRescan').addEventListener('click', () => rescan());
  $('btnRelink').addEventListener('click', () => relink());
  $('btnSettings').addEventListener('click', () => openSettings());
  $('btnReport').addEventListener('click', async () => { await flush(); openReportDialog(state.model, ui.folder); });
  $('btnBackup').addEventListener('click', () => backupDialog());
  $('btnChecks').addEventListener('click', () => showChecks());
  $('btnCopyTable').addEventListener('click', () => {
    const m = state.model;
    const view = gallery.order;
    const sources = [];
    if (ui.selection.size > 1) sources.push({ key: 'sel', label: 'Ausgewählte Bilder', images: view.filter(im => ui.selection.has(im.id)) });
    sources.push({ key: 'view', label: 'Aktuelle Ansicht', images: view });
    sources.push({ key: 'all', label: 'Gesamtes Projekt', images: orderedFolderPaths(m).flatMap(p => m.imagesByFolder.get(p) || []) });
    openTableCopyDialog(sources);
  });
  $('btnExpandAll').addEventListener('click', () => { ui.collapsed.clear(); tree.render(); saveUiStateDebounced(); });
  $('btnCollapseAll').addEventListener('click', () => { for (const f of state.folders) if (f.path && state.model.info.get(f.path)?.children.length) ui.collapsed.add(f.path); tree.render(); saveUiStateDebounced(); });
  $('treeFilter').addEventListener('input', debounce(e => tree.setFilter(e.target.value), 150));

  document.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $('search').addEventListener('input', debounce(e => { ui.search = e.target.value; refreshGallery(true); }, 180));
  $('includeSub').addEventListener('change', e => { ui.includeSub = e.target.checked; refreshGallery(true); saveUiStateDebounced(); });
  $('tileSize').addEventListener('input', e => { ui.tile = +e.target.value; gallery.setTileSize(ui.tile); saveUiStateDebounced(); });
  for (const [id, key] of [['fType', 'type'], ['fPhase', 'phase'], ['fDocPoint', 'docPoint'], ['fMark', 'mark'], ['sortBy', 'sort']]) {
    $(id).addEventListener('change', e => { ui[key] = e.target.value; refreshGallery(true); });
  }
  $('sortDir').addEventListener('click', () => { ui.dir *= -1; syncToolbar(); refreshGallery(); });
  $('btnResetSort').addEventListener('click', () => { Object.assign(ui, { sort: 'original', dir: 1, type: 'all', phase: 'all', docPoint: 'all', mark: 'all', search: '' }); syncToolbar(); refreshGallery(true); });

  // globale Tastenkürzel
  document.addEventListener('keydown', e => {
    if ($('workspace').hidden || document.querySelector('.modal-backdrop, .viewer, .editor')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('search').focus(); }
  });
}

function setView(v) {
  ui.view = v;
  document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $('gallery').hidden = v !== 'gallery';
  $('compare').hidden = v !== 'compare';
  $('filterBar').classList.toggle('dim', v !== 'gallery');
  if (v === 'compare') compareView.render(ui.folder); else refreshGallery();
  saveUiStateDebounced();
}

function syncToolbar() {
  $('search').value = ui.search; $('includeSub').checked = ui.includeSub; $('tileSize').value = ui.tile;
  $('fType').value = ui.type; $('fPhase').value = ui.phase; $('fMark').value = ui.mark; $('sortBy').value = ui.sort;
  $('sortDir').textContent = ui.dir > 0 ? '↑' : '↓';
  gallery.setTileSize(ui.tile);
}

function selectFolder(path) {
  ui.folder = path;
  saveUiStateDebounced();
  ui.selection = new Set(); ui.anchor = null;
  // Vorfahren aufklappen
  let p = state.model.info.get(path)?.folder.parentPath;
  while (p != null) { ui.collapsed.delete(p); p = state.model.info.get(p)?.folder.parentPath ?? null; }
  tree.render();
  if (ui.view === 'compare') compareView.render(path);
  refreshGallery(true);
  refreshDetails();
}

function refreshAll(resetScroll) {
  if (!state.model) return;
  const p = state.project;
  $('projectName').value = p.name;
  document.title = p.name + ' – Montagebericht';
  const src = { fsa: 'Ordnerzugriff', files: 'Kopie im Browser', zip: 'ZIP-Import' }[p.sourceType] || '';
  $('projectSub').textContent = `${p.rootName} · ${src} · eingelesen ${formatDateTime(p.scannedAt)}`;
  if (!state.model.info.has(ui.folder)) ui.folder = '';
  // Dokumentationspunkt-Filter füllen
  const dpSel = $('fDocPoint');
  const cur = ui.docPoint;
  dpSel.innerHTML = '<option value="all">Alle Dokumentationspunkte</option>' + orderedFolderPaths(state.model).filter(p => state.model.docPoints.includes(p)).map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p || state.project.rootName)}</option>`).join('');
  dpSel.value = state.model.docPoints.includes(cur) ? cur : 'all';
  ui.docPoint = dpSel.value;
  // nicht mehr vorhandene Auswahl bereinigen
  ui.selection = new Set([...ui.selection].filter(id => state.model.imageById.has(id)));
  tree.render();
  setView(ui.view);
  refreshGallery(resetScroll);
  refreshDetails();
  updateStatus();
  updatePermissionUi();
}

// ---------- Galerie-Daten ----------
const EXT_GROUP = { jpg: 'jpg', jpeg: 'jpg', jpe: 'jpg', jfif: 'jpg', png: 'png', webp: 'webp', heic: 'heic', heif: 'heic', tif: 'tif', tiff: 'tif', pdf: 'pdf' };

function computeGroups() {
  const m = state.model;
  const searching = ui.search.trim().length > 0;
  let paths;
  if (searching) paths = orderedFolderPaths(m, '');
  else if (ui.docPoint !== 'all') paths = orderedFolderPaths(m, '').filter(p => m.info.get(p).docPoint === ui.docPoint || p === ui.docPoint);
  else paths = ui.includeSub ? orderedFolderPaths(m, ui.folder) : [ui.folder];
  const q = ui.search.trim().toLowerCase();
  const unpaired = new Set();
  for (const g of m.compares.values()) for (const r of g.rows) { if (!(r.b && r.a)) unpaired.add(r.b || r.a); }
  const pass = im => {
    if (q && !(im.name.toLowerCase().includes(q) || im.relPath.toLowerCase().includes(q) || (im.caption || '').toLowerCase().includes(q))) return false;
    if (ui.type !== 'all') { const g = EXT_GROUP[im.ext] || 'other'; if (g !== ui.type) return false; }
    if (ui.phase !== 'all') {
      const ph = m.phaseOf.get(im.id);
      if (ui.phase === 'before' && ph?.phase !== 'before') return false;
      if (ui.phase === 'after' && ph?.phase !== 'after') return false;
      if (ui.phase === 'nophase' && ph) return false;
      if (ui.phase === 'nopartner' && !unpaired.has(im.id)) return false;
    }
    if (ui.mark === 'report' && !im.selected) return false;
    if (ui.mark === 'notreport' && im.selected) return false;
    if (ui.mark === 'marked' && !(im.starred || im.label)) return false;
    if (ui.mark === 'edited' && !hasEdits(im.edits)) return false;
    if (ui.mark === 'problem' && !['fehler', 'fehlt', 'nicht unterstützt', 'nicht lesbar'].includes(im.status)) return false;
    return true;
  };
  const groupsByFolder = paths.map(p => ({ key: p, path: p, items: (m.imagesByFolder.get(p) || []).filter(pass) })).filter(g => g.items.length);
  const multi = paths.length > 1;
  if (ui.sort === 'original') {
    const groups = groupsByFolder.map(g => {
      const info = m.info.get(g.path);
      const title = g.path === '' ? state.project.rootName : info.folder.name;
      const sub = g.path ? g.path : '';
      return { key: g.key, title: multi ? title : null, sub: multi ? sub : '', items: ui.dir > 0 ? g.items : [...g.items].reverse() };
    });
    if (ui.dir < 0) groups.reverse();
    return { groups, unpaired };
  }
  const all = groupsByFolder.flatMap(g => g.items);
  const key = {
    name: (a, b) => naturalCompare(a.name, b.name),
    date: (a, b) => (a.dateTaken ? 0 : 1) - (b.dateTaken ? 0 : 1) || String(a.dateTaken || '').localeCompare(String(b.dateTaken || '')) || naturalCompare(a.name, b.name),
    size: (a, b) => (a.size || 0) - (b.size || 0),
    dims: (a, b) => (a.width || 0) * (a.height || 0) - (b.width || 0) * (b.height || 0),
    type: (a, b) => (a.ext || '').localeCompare(b.ext || '') || naturalCompare(a.name, b.name),
  }[ui.sort];
  all.sort((a, b) => key(a, b) * ui.dir);
  if (ui.sort === 'date' && ui.dir < 0) { // Bilder ohne Datum immer ans Ende
    all.sort((a, b) => (a.dateTaken ? 0 : 1) - (b.dateTaken ? 0 : 1));
  }
  return { groups: [{ key: 'all', title: null, items: all }], unpaired };
}

let lastUnpaired = new Set();
function galleryCtx() {
  const canReorder = ui.sort === 'original' && ui.dir > 0 && !ui.includeSub && !ui.search.trim() && ui.docPoint === 'all' && ui.type === 'all' && ui.phase === 'all' && ui.mark === 'all';
  return { selection: ui.selection, anchor: ui.anchor, phaseOf: state.model.phaseOf, unpaired: lastUnpaired, canReorder };
}

function refreshGallery(resetScroll) {
  if (!state.model) return;
  const { groups, unpaired } = computeGroups();
  lastUnpaired = unpaired;
  gallery.setData(groups, galleryCtx(), { keepScroll: !resetScroll });
  const n = groups.reduce((a, g) => a + g.items.length, 0);
  $('resultInfo').textContent = `${n} Bild${n === 1 ? '' : 'er'}`;
  // Bereichsanzeige (Brotkrumen)
  const sb = $('scopeBar');
  sb.innerHTML = '';
  if (ui.search.trim()) sb.append(el('span', { text: `Suche im gesamten Projekt nach „${ui.search.trim()}“` }));
  else if (ui.docPoint !== 'all') sb.append(el('span', { text: 'Dokumentationspunkt: ' + (ui.docPoint || state.project.rootName) }));
  else {
    const parts = ui.folder ? ui.folder.split('/') : [];
    sb.append(el('a', { href: '#', text: state.project.rootName, onclick: e => { e.preventDefault(); selectFolder(''); } }));
    parts.forEach((part, i) => {
      const p = parts.slice(0, i + 1).join('/');
      sb.append(el('span', { class: 'sep', text: '›' }), el('a', { href: '#', text: part, onclick: e => { e.preventDefault(); selectFolder(p); } }));
    });
    const info = state.model.info.get(ui.folder);
    if (!ui.includeSub && info && info.direct === 0 && info.total > 0) sb.append(el('span', { class: 'hint', html: ` – keine Bilder direkt in diesem Ordner. <a href="#">Unterordner einbeziehen</a>` }));
    sb.querySelector('.hint a')?.addEventListener('click', e => { e.preventDefault(); ui.includeSub = true; $('includeSub').checked = true; refreshGallery(true); });
  }
  if (!galleryCtx().canReorder && ui.view === 'gallery') sb.append(el('span', { class: 'muted small right', text: 'Umsortieren per Drag & Drop: einzelnen Ordner ohne Filter in ursprünglicher Reihenfolge anzeigen' }));
  if (ui.view === 'compare') compareView.render(ui.folder);
}

function refreshDetails() {
  if (!state.model) return;
  renderDetails($('details'), {
    model: state.model, selection: [...ui.selection], folderPath: ui.folder,
    actions: {
      open: id => openImageViewer(id), edit: id => editImage(id),
      patchImages, patchFolder, clearEdits,
      gotoFolder: p => selectFolder(p), select: ids => { ui.selection = new Set(ids); ui.anchor = ids[0]; gallery.setContext(galleryCtx()); gallery.scrollToId(ids[0]); refreshDetails(); },
      subtreeImages: p => [p, ...descendantsOf(state.model, p)].flatMap(x => state.model.imagesByFolder.get(x) || []),
      moveFolderStep, resetFolderOrder, showCompare: p => { selectFolder(p); setView('compare'); },
    },
  });
}

// ---------- Aktionen ----------
function patchImages(ids, patch, derive = false) {
  const list = ids.map(id => state.model.imageById.get(id)).filter(Boolean);
  const before = list.map(im => ({ im, old: Object.fromEntries(Object.keys(patch).map(k => [k, im[k]])) }));
  for (const im of list) Object.assign(im, patch);
  markImages(list, { derive: derive || 'assignedFolder' in patch || 'reportOrder' in patch });
  if (list.length > 1 && ('selected' in patch)) toast(`${list.length} Bilder ${patch.selected ? 'in den Bericht übernommen' : 'aus dem Bericht entfernt'}.`, { action: () => { for (const b of before) Object.assign(b.im, b.old); markImages(list, { derive: true }); } });
}

function patchFolder(path, patch, derive = true) {
  const f = state.folders.find(x => x.path === path);
  if (!f) return;
  Object.assign(f, patch);
  markFolders([f], { derive });
}

function saveCompare(host, patch) {
  const f = state.folders.find(x => x.path === host);
  const cur = f.compare || {};
  f.compare = { ...cur, ...patch };
  if (patch.manual === false) f.compare.rows = null;
  markFolders([f]);
}

function clearEdits(ids) {
  const list = ids.map(id => state.model.imageById.get(id)).filter(im => im && hasEdits(im.edits));
  for (const im of list) { im.edits = null; im.editVersion = (im.editVersion || 0) + 1; thumbs.invalidate(im); }
  markImages(list);
  if (list.length) toast(`Bearbeitung von ${list.length} Bild${list.length > 1 ? 'ern' : ''} entfernt.`);
}

function assignImages(ids, path) {
  const list = ids.map(id => state.model.imageById.get(id)).filter(Boolean);
  const old = list.map(im => [im, im.assignedFolder, im.reportOrder]);
  for (const im of list) { im.assignedFolder = im.folderPath === path ? null : path; im.reportOrder = null; }
  markImages(list, { derive: true });
  const name = state.model.info.get(path)?.folder.name || path;
  toast(`${list.length} Bild${list.length > 1 ? 'er' : ''} im Bericht „${name}“ zugeordnet (Originaldateien unverändert).`, { action: () => { for (const [im, a, r] of old) { im.assignedFolder = a; im.reportOrder = r; } markImages(list, { derive: true }); } });
}

function reorderImages(ids, targetId, after) {
  const m = state.model;
  const target = m.imageById.get(targetId);
  const fp = target.assignedFolder ?? target.folderPath;
  const list = [...(m.imagesByFolder.get(fp) || [])];
  const moving = list.filter(im => ids.includes(im.id));
  const rest = list.filter(im => !ids.includes(im.id));
  let pos = rest.findIndex(im => im.id === targetId);
  if (after) pos++;
  rest.splice(pos, 0, ...moving);
  rest.forEach((im, i) => { im.reportOrder = i; });
  markImages(rest, { derive: true });
}

function moveFolder(from, to, before) {
  const m = state.model;
  const a = m.info.get(from).folder, b = m.info.get(to).folder;
  if (a.parentPath !== b.parentPath) return;
  const sibs = m.info.get(a.parentPath).children.map(c => c.path).filter(p => p !== from);
  let pos = sibs.indexOf(to);
  if (!before) pos++;
  sibs.splice(pos, 0, from);
  applySiblingOrder(sibs);
}
function moveFolderStep(path, d) {
  const m = state.model;
  const f = m.info.get(path).folder;
  const sibs = m.info.get(f.parentPath).children.map(c => c.path);
  const i = sibs.indexOf(path), j = i + d;
  if (j < 0 || j >= sibs.length) return;
  [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
  applySiblingOrder(sibs);
}
function resetFolderOrder(parent) {
  const sibs = state.folders.filter(f => f.parentPath === parent).sort((a, b) => a.origOrder - b.origOrder).map(f => f.path);
  applySiblingOrder(sibs);
  toast('Ursprüngliche Reihenfolge wiederhergestellt.');
}
function applySiblingOrder(paths) {
  const changed = [];
  paths.forEach((p, i) => { const f = state.folders.find(x => x.path === p); if (f.order !== i) { f.order = i; changed.push(f); } });
  if (changed.length) markFolders(changed);
}

function openImageViewer(id) {
  const order = ui.view === 'gallery' ? gallery.order : [];
  let list = order.length && order.some(i => i.id === id) ? order : [state.model.imageById.get(id)];
  list = list.filter(im => !['nicht unterstützt', 'fehlt'].includes(im.status));
  const idx = Math.max(0, list.findIndex(i => i.id === id));
  if (!list.length) return toast('Dieses Bild kann nicht angezeigt werden.', { type: 'warn' });
  openViewer(list, idx, { onEdit: editImage });
}

function editImage(id) {
  const im = state.model.imageById.get(id);
  if (!im || ['nicht unterstützt', 'fehlt'].includes(im.status)) return;
  openEditor(im, {
    onSave: edits => {
      im.edits = edits;
      im.editVersion = (im.editVersion || 0) + 1;
      markImages([im]);
      thumbs.invalidate(im);
      setTimeout(() => { gallery.refresh(); refreshDetails(); }, 50);
      toast(edits ? 'Bearbeitung gespeichert (Original unverändert).' : 'Bearbeitungen entfernt.', { type: 'ok' });
    },
  });
}

// ---------- Neu einlesen / Verbinden ----------
async function rescan() {
  await flush();
  if (state.handle) {
    const p = await ensurePermission(state.handle, true);
    if (p === 'granted') { state.permission = 'granted'; return handleHandle(state.handle, 'rescan'); }
  }
  if (!(await confirmDialog('Ordner auswählen', `Bitte den Projektordner „${state.project.rootName}“ auswählen. Neue Bilder werden ergänzt, geänderte erkannt; Bearbeitungen und Zuordnungen bleiben erhalten.`, { ok: 'Ordner wählen' }))) return;
  pickFolder('rescan');
}
async function relink() {
  if (state.handle) {
    const p = await requestHandlePermission();
    if (p === 'granted') { thumbs.resetCache(); refreshAll(); thumbs.processAll(state.images); return; }
  }
  pickFolder('relink');
}

function updatePermissionUi() {
  if (!state.project) return;
  const ok = filesAvailable();
  $('btnRelink').hidden = ok;
  $('btnRelink').textContent = state.handle ? 'Zugriff auf Ordner erlauben' : 'Ordner erneut verbinden';
  updateStatus();
}

// ---------- Einstellungen / Sicherung ----------
async function openSettings() {
  const r = await openRulesDialog(state.rules, state.settings);
  if (!r) return;
  await saveRules(r.rules);
  await saveGeneralSettings(r.general);
  await reclassify(classifyName);
  toast('Regeln gespeichert und auf das Projekt angewendet. Manuelle Festlegungen bleiben bestehen.', { type: 'ok' });
}

async function backupDialog() {
  await flush();
  const th = el('input', { type: 'checkbox', checked: true });
  const orig = el('input', { type: 'checkbox' });
  const body = el('div', {},
    el('p', { text: 'Die Sicherung enthält Projektstruktur, Auswahl, Beschriftungen, Zuordnungen, Vorher/Nachher-Verknüpfungen, Bearbeitungsschritte und Berichtseinstellungen.' }),
    el('label', { class: 'check' }, th, ' Vorschaubilder einschließen (schnelleres Öffnen nach Wiederherstellung)'),
    el('label', { class: 'check' }, orig, ' Originalbilder einschließen (große Datei, aber vollständig unabhängig vom Ordner)'),
    el('p', { class: 'muted small', text: state.project.lastBackup ? 'Letzte Sicherung: ' + formatDateTime(state.project.lastBackup) : 'Für dieses Projekt wurde noch keine Sicherung erstellt.' }));
  const r = await modal({ title: 'Projekt sichern', body, buttons: [{ label: 'Abbrechen', value: null, class: 'ghost' }, { label: 'Sicherung erstellen', value: 'go', class: 'primary' }] });
  if (r !== 'go') return;
  const prog = progressDialog('Sicherung wird erstellt');
  try {
    const { blob, missing } = await exportBackup({ thumbs: th.checked, originals: orig.checked }, (f, t) => prog.update(f, t));
    prog.close();
    await saveBlob(blob, safeFileName(`Sicherung ${state.project.name} ${new Date().toISOString().slice(0, 10)}`) + '.zip', [{ description: 'ZIP-Archiv', accept: { 'application/zip': ['.zip'] } }]);
    toast(missing ? `Sicherung erstellt – ${missing} Originale waren nicht erreichbar.` : 'Sicherung erstellt.', { type: missing ? 'warn' : 'ok' });
  } catch (e) { prog.close(); showError(e); }
}

// ---------- Vollständigkeitsprüfung ----------
function recheck() {
  if (!state.model || !state.project) return null;
  const r = runChecks(state.model, state.project);
  state.model.checks = r;
  const b = $('checkBadge');
  b.hidden = !(r.missing || r.hints);
  b.textContent = r.missing ? String(r.missing) : String(r.hints);
  b.className = 'badge ' + (r.missing ? 'bad' : 'hint');
  $('btnChecks').title = r.missing || r.hints ? `${r.missing} leere Ordner, ${r.hints} Hinweise` : 'Alles vollständig';
  return r;
}
const recheckSoon = debounce(() => { const before = JSON.stringify([...(state.model?.checks?.byPath || [])]); const r = recheck(); if (r && JSON.stringify([...r.byPath]) !== before) tree.render(); updateStatus(); }, 400);

function showChecks() {
  openChecksDialog({
    project: state.project,
    getResult: () => recheck(),
    gotoFolder: (p, view) => { selectFolder(p); setView(view || 'gallery'); },
    setIgnored: (key, on) => {
      const set = new Set(state.project.checkIgnored || []);
      on ? set.add(key) : set.delete(key);
      state.project.checkIgnored = [...set];
      saveProject(); recheck(); tree.render(); updateStatus();
    },
  });
}
window.addEventListener('mb:show-checks', () => showChecks());

// ---------- Status ----------
function updateStatus() {
  if (!state.model) return;
  const m = state.model;
  const total = state.images.length;
  const inRep = state.images.filter(i => i.selected).length;
  const problems = state.images.filter(i => ['fehler', 'fehlt', 'nicht unterstützt', 'nicht lesbar'].includes(i.status)).length;
  const cmpOpen = [...m.compares.values()].filter(g => !g.enabled).length;
  $('statusLeft').innerHTML = `${total} Bilder · ${m.docPoints.length} Dokumentationspunkte · ${m.compares.size} Vorher/Nachher-Gruppen${cmpOpen ? ` (<a href="#" id="lnkOpenCmp">${cmpOpen} unbestätigt</a>)` : ''} · <b>${inRep}</b> im Bericht${problems ? ` · <a href="#" id="lnkProblems" class="warn-t">${problems} mit Problemen</a>` : ''}${ui.selection.size > 1 ? ` · ${ui.selection.size} ausgewählt` : ''}`;
  const ck = m.checks;
  if (ck?.missing) $('statusLeft').insertAdjacentHTML('beforeend', ` · <a href="#" id="lnkChecks" class="bad-t">⚠ ${ck.missing} leere${ck.missing > 1 ? '' : 'r'} Ordner</a>`);
  $('lnkChecks')?.addEventListener('click', e => { e.preventDefault(); showChecks(); });
  $('lnkProblems')?.addEventListener('click', e => { e.preventDefault(); ui.mark = 'problem'; ui.folder = ''; ui.includeSub = true; syncToolbar(); setView('gallery'); refreshGallery(true); tree.render(); });
  $('lnkOpenCmp')?.addEventListener('click', e => { e.preventDefault(); selectFolder(''); setView('compare'); });
  const access = !filesAvailable() ? '<span class="warn-t">Originale nicht verbunden</span>' : state.handle ? 'Ordnerzugriff aktiv' : state.sessionFiles.size ? 'Ordner in dieser Sitzung geladen' : 'Kopie im Browser';
  $('statusRight').innerHTML = access;
}

function updateProgress({ pending, done, total }) {
  const sp = $('statusProgress');
  if (!pending) { sp.hidden = true; refreshGalleryLight(); return; }
  sp.hidden = false;
  sp.querySelector('.bar i').style.width = (total ? Math.round(done / total * 100) : 0) + '%';
  sp.querySelector('.txt').textContent = `Vorschaubilder & Metadaten: ${done} / ${total}`;
}
const refreshGalleryLight = debounce(() => {
  if (!state.model || $('workspace').hidden) return;
  if (ui.sort !== 'original' || ui.mark === 'problem') refreshGallery(); else gallery.refresh();
  refreshDetails(); updateStatus();
}, 300);

function showError(e) {
  console.error(e);
  modal({ title: 'Fehler', body: `<p>${escapeHtml(e?.message || String(e))}</p>`, buttons: [{ label: 'OK', class: 'primary' }] });
}

window.addEventListener('unhandledrejection', e => { console.error(e.reason); });
init();

})();
