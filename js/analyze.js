// Modul: analyze
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { naturalCompare, extOf, baseName, parentPath, uid } = MB['util'];
const { classifyName, confRank, ROLES } = MB['rules'];
const { IMAGE_EXT } = MB['scanner'];
// Strukturanalyse: aus einem Scan-Ergebnis Ordner- und Bilddatensätze erzeugen
// sowie abgeleitete Informationen (Dokumentationspunkte, Vorher/Nachher-Gruppen, Paare) berechnen.


const folderId = (projectId, path) => projectId + '|' + path;

// ---------- Erstes Einlesen ----------
function buildRecords(projectId, scan, rules, opts = {}) {
  const dirPaths = [...scan.dirs];
  // Geschwister in natürlicher Sortierung -> feste Ausgangsreihenfolge
  const byParent = new Map();
  for (const p of dirPaths) {
    if (p === '') continue;
    const par = parentPath(p);
    if (!byParent.has(par)) byParent.set(par, []);
    byParent.get(par).push(p);
  }
  for (const list of byParent.values()) list.sort((a, b) => naturalCompare(baseName(a), baseName(b)));

  const folders = [];
  const mk = (path, order) => {
    const name = path === '' ? scan.rootName : baseName(path);
    const cls = path === '' ? null : classifyName(name, rules);
    return {
      id: folderId(projectId, path), projectId, path, name,
      parentPath: path === '' ? null : parentPath(path),
      depth: path === '' ? 0 : path.split('/').length,
      order, origOrder: order,
      detected: cls,               // Ergebnis der Regelprüfung (nur Information)
      roleOverride: null,          // manuelle Festlegung: null = automatisch, 'none' = keine Rolle, sonst Rolle
      reportTitle: null,           // abweichender Berichtstitel (Original bleibt in name)
      includeInReport: true,
      note: '',
      fileComments: (opts.comments && opts.comments.get(path)) || [],   // aus .txt-Dateien, wird bei jedem Einlesen neu gelesen
      compare: null,               // { enabled, userSet, mode, rows (manuell), manual }
    };
  };
  folders.push(mk('', 0));
  const walk = par => {
    (byParent.get(par) || []).forEach((p, i) => { folders.push(mk(p, i)); walk(p); });
  };
  walk('');

  // Bilder je Ordner in natürlicher Reihenfolge
  const filesByDir = new Map();
  for (const f of scan.files) {
    if (!filesByDir.has(f.dirPath)) filesByDir.set(f.dirPath, []);
    filesByDir.get(f.dirPath).push(f);
  }
  const images = [];
  let g = 0;
  for (const fo of folders) {
    const list = (filesByDir.get(fo.path) || []).sort((a, b) => naturalCompare(a.name, b.name));
    list.forEach((f, i) => {
      images.push(newImageRecord(projectId, f, i, g++, opts));
    });
  }
  return { folders, images };
}

function newImageRecord(projectId, f, indexInFolder, globalIndex, opts = {}) {
  const ext = f.ext || extOf(f.name);
  const supported = (IMAGE_EXT.has(ext) || ext === 'pdf') && !f.pdfError;
  return {
    id: uid('img_'), projectId,
    name: f.name, relPath: f.relPath, folderPath: f.dirPath,
    ext, mime: null, mimeExpected: mimeFromExt(ext),
    size: f.size ?? null, lastModified: f.lastModified ?? null,
    width: null, height: null, exifOrientation: null,
    dateTaken: null, dateSource: null, camera: null,
    indexInFolder, globalIndex,
    status: f.pdfError ? 'fehler' : supported ? 'ausstehend' : 'nicht unterstützt',
    error: f.pdfError ? `PDF konnte nicht gelesen werden: ${f.pdfError}` : supported ? null : `Format .${ext} wird nicht unterstützt (z. B. RAW/PSD/SVG). Datei bleibt als Eintrag sichtbar.`,
    // PDF-Seiten: echte Datei + Seitennummer
    fileRelPath: f.fileRelPath || null, pdfPage: f.pdfPage || null, pdfPages: f.pdfPages || null, pdfName: f.pdfName || null,
    sig: f.size != null ? `${f.size}-${f.lastModified}` : null,
    metaDone: false,
    selected: supported && opts.autoSelect !== false && f.autoSelect !== false,
    label: null, starred: false, caption: '', note: '',
    edits: null, editVersion: 0,
    assignedFolder: null,  // virtuelle Zuordnung zu anderem Ordner (Original bleibt erhalten)
    reportOrder: null,     // manuelle Reihenfolge innerhalb des Ordners
  };
}

function mimeFromExt(ext) {
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', pdf: 'application/pdf' })[ext] || 'unbekannt';
}

// ---------- Erneutes Einlesen: Benutzerdaten erhalten ----------
function mergeRescan(projectId, scan, rules, oldFolders, oldImages, opts = {}) {
  const fresh = buildRecords(projectId, scan, rules, opts);
  const oldF = new Map(oldFolders.map(f => [f.path, f]));
  const newPaths = new Set(fresh.folders.map(f => f.path));
  // Ordner: Benutzerangaben übernehmen; manuelle Reihenfolge erhalten, neue hinten anfügen
  const maxOrderByParent = new Map();
  for (const f of oldFolders) maxOrderByParent.set(f.parentPath, Math.max(maxOrderByParent.get(f.parentPath) ?? -1, f.order));
  const folders = fresh.folders.map(nf => {
    const of = oldF.get(nf.path);
    if (!of) {
      const m = (maxOrderByParent.get(nf.parentPath) ?? -1) + 1;
      maxOrderByParent.set(nf.parentPath, m);
      return { ...nf, order: m, isNew: true };
    }
    return { ...nf, order: of.order, roleOverride: of.roleOverride, reportTitle: of.reportTitle, includeInReport: of.includeInReport, note: of.note, compare: of.compare, name: nf.name };
  });
  // Weggefallene Ordner mit Benutzerdaten behalten? Nein – sie werden entfernt, Bilder darin als "fehlt" markiert.
  const oldI = new Map(oldImages.map(i => [i.relPath, i]));
  const freshPaths = new Set(fresh.images.map(i => i.relPath));
  const images = fresh.images.map(ni => {
    const oi = oldI.get(ni.relPath);
    if (!oi) return { ...ni, isNew: true };
    const changed = ni.sig && oi.sig && ni.sig !== oi.sig;
    return {
      ...oi,
      indexInFolder: ni.indexInFolder, globalIndex: ni.globalIndex,
      size: ni.size ?? oi.size, lastModified: ni.lastModified ?? oi.lastModified,
      sig: ni.sig ?? oi.sig,
      status: changed ? 'geändert' : (oi.status === 'fehlt' ? 'ausstehend' : oi.status),
      metaDone: changed ? false : oi.metaDone,
    };
  });
  const missing = oldImages.filter(i => !freshPaths.has(i.relPath)).map(i => ({ ...i, status: 'fehlt', error: 'Datei wurde beim erneuten Einlesen nicht mehr gefunden.' }));
  // Fehlende Bilder bleiben sichtbar; ihre Ordner bleiben, falls weggefallen, als Eintrag bestehen
  for (const m of missing) {
    let p = m.folderPath;
    while (p != null && !newPaths.has(p)) {
      const old = oldF.get(p);
      if (old) { folders.push({ ...old, missingOnDisk: true }); newPaths.add(p); }
      p = parentPath(p);
    }
  }
  const removedFolders = oldFolders.filter(f => !newPaths.has(f.path)).map(f => f.id);
  return {
    folders, images: [...images, ...missing], removedFolders,
    stats: { added: images.filter(i => i.isNew).length, changed: images.filter(i => i.status === 'geändert').length, missing: missing.length, newFolders: folders.filter(f => f.isNew).length },
  };
}

// ---------- Ableitung (bei jedem Laden/Ändern neu berechnet) ----------
// Liefert ein Modell mit Baum, Rollen, Dokumentationspunkten, Vergleichsgruppen und Bildzuordnungen.
function derive(project, folders, images) {
  const fmap = new Map(folders.map(f => [f.path, f]));
  const children = new Map();
  for (const f of folders) {
    if (f.parentPath == null) continue;
    if (!children.has(f.parentPath)) children.set(f.parentPath, []);
    children.get(f.parentPath).push(f);
  }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order || naturalCompare(a.name, b.name));

  // 1) Effektive Rolle je Ordner
  const info = new Map(); // path -> abgeleitete Infos
  for (const f of folders) {
    const kids = children.get(f.path) || [];
    let role = null, confidence = null, source = null, hint = null;
    if (f.path !== '') {
      if (f.roleOverride && f.roleOverride !== 'none') { role = f.roleOverride; confidence = 'sicher'; source = 'manuell festgelegt'; }
      else if (f.roleOverride === 'none') { source = 'manuell: keine Rolle'; }
      else if (f.detected) {
        // "Unklare" Treffer mit eigenen Unterordnern werden nicht als Rolle behandelt (z. B. "01_Bestand" als Kapitel)
        if (f.detected.confidence === 'unklar' && kids.length) {
          hint = `Name ähnelt „${ROLES[f.detected.role].label}“ (unklar) – wegen Unterordnern als normaler Ordner behandelt`;
        } else {
          role = f.detected.role; confidence = f.detected.confidence; source = `Regel „${f.detected.ruleLabel}“`;
        }
      }
    }
    info.set(f.path, { folder: f, role, confidence, source, hint, children: kids });
  }
  // Unklare Vorher/Nachher-Treffer ohne Gegenstück unter den Geschwistern bleiben normale Ordner
  for (const i of info.values()) {
    if (i.confidence !== 'unklar' || !(i.role === 'before' || i.role === 'after') || i.folder.roleOverride) continue;
    const opposite = i.role === 'before' ? 'after' : 'before';
    const sibs = info.get(i.folder.parentPath)?.children || [];
    if (!sibs.some(s => info.get(s.path).role === opposite)) {
      i.hint = `Name ähnelt „${ROLES[i.role].label}“ (unklar), aber ohne passendes Gegenstück – als normaler Ordner behandelt`;
      i.role = null; i.confidence = null; i.source = null;
    }
  }

  // 2) Bilder je effektivem Ordner
  const imagesByFolder = new Map();
  for (const im of images) {
    const fp = im.assignedFolder != null && fmap.has(im.assignedFolder) ? im.assignedFolder : im.folderPath;
    if (!imagesByFolder.has(fp)) imagesByFolder.set(fp, []);
    imagesByFolder.get(fp).push(im);
  }
  const imgOrder = (a, b) => (a.reportOrder ?? Infinity) - (b.reportOrder ?? Infinity) || (a.folderPath === b.folderPath ? a.indexInFolder - b.indexInFolder : a.globalIndex - b.globalIndex);
  for (const list of imagesByFolder.values()) list.sort(imgOrder);

  // 3) Zählungen (direkt + gesamt) und Art (Kapitel / Dokumentationspunkt / Rolle / Wurzel)
  const totals = new Map();
  const count = path => {
    const i = info.get(path);
    let t = (imagesByFolder.get(path) || []).length;
    for (const c of i.children) t += count(c.path);
    totals.set(path, t);
    return t;
  };
  count('');
  for (const [path, i] of info) {
    i.direct = (imagesByFolder.get(path) || []).length;
    i.total = totals.get(path) || 0;
    i.subCount = i.children.length;
    i.empty = i.total === 0;
    const nonRoleKids = i.children.filter(c => !info.get(c.path).role);
    if (path === '') i.kind = 'root';
    else if (i.role) i.kind = 'role';
    else if (nonRoleKids.length) i.kind = 'chapter';
    else i.kind = 'docpoint';
  }

  // 4) Dokumentationspunkt je Ordner (nächster Vorfahre/selbst ohne Rolle)
  const docPointOf = path => {
    let p = path;
    while (p != null && p !== '') {
      if (!info.get(p).role) return p;
      p = info.get(p).folder.parentPath;
    }
    return '';
  };
  for (const [path, i] of info) i.docPoint = docPointOf(path);

  // 5) Vorher/Nachher-Gruppen: jeder Ordner mit Vorher- UND Nachher-Unterordnern
  const compares = new Map(); // hostPath -> Gruppe
  for (const [path, i] of info) {
    const befores = i.children.filter(c => info.get(c.path).role === 'before');
    const afters = i.children.filter(c => info.get(c.path).role === 'after');
    if (!befores.length || !afters.length) continue;
    const best = list => { const r = Math.max(...list.map(c => confRank(info.get(c.path).confidence))); return list.filter(c => confRank(info.get(c.path).confidence) === r); };
    const bF = best(befores), aF = best(afters);
    const cb = info.get(bF[0].path).confidence, ca = info.get(aF[0].path).confidence;
    const confidence = confRank(cb) <= confRank(ca) ? cb : ca;
    const cfg = i.folder.compare || {};
    const enabled = cfg.userSet ? !!cfg.enabled : confidence !== 'unklar';
    const beforeImgs = bF.flatMap(c => imagesByFolder.get(c.path) || []);
    const afterImgs = aF.flatMap(c => imagesByFolder.get(c.path) || []);
    const g = {
      hostPath: path, beforeFolders: bF.map(c => c.path), afterFolders: aF.map(c => c.path),
      confidence, enabled, mode: cfg.mode || 'pairs', manual: !!cfg.manual,
      beforeImgs, afterImgs,
    };
    g.rows = buildRows(g, cfg);
    compares.set(path, g);
    i.compare = g;
  }
  // Phase je Bild
  const phaseOf = new Map();
  for (const g of compares.values()) {
    for (const im of g.beforeImgs) phaseOf.set(im.id, { phase: 'before', confidence: g.confidence, enabled: g.enabled, host: g.hostPath });
    for (const im of g.afterImgs) phaseOf.set(im.id, { phase: 'after', confidence: g.confidence, enabled: g.enabled, host: g.hostPath });
  }

  const docPoints = [...info.values()].filter(i => i.kind === 'docpoint' || (i.kind === 'chapter' && i.direct > 0)).map(i => i.folder.path);

  return { project, folders, images, fmap, info, children, imagesByFolder, compares, phaseOf, docPoints, imageById: new Map(images.map(i => [i.id, i])) };
}

// Paare bilden: manuell gespeicherte Zeilen bevorzugen, sonst nach ursprünglicher Reihenfolge.
// Kein Bild darf verloren gehen – nicht zugeordnete Bilder erhalten eigene Zeilen.
function buildRows(g, cfg) {
  const bIds = new Set(g.beforeImgs.map(i => i.id)), aIds = new Set(g.afterImgs.map(i => i.id));
  if (cfg.manual && Array.isArray(cfg.rows)) {
    const usedB = new Set(), usedA = new Set();
    const rows = [];
    for (const r of cfg.rows) {
      const b = r.b && bIds.has(r.b) && !usedB.has(r.b) ? r.b : null;
      const a = r.a && aIds.has(r.a) && !usedA.has(r.a) ? r.a : null;
      if (b) usedB.add(b); if (a) usedA.add(a);
      if (b || a) rows.push({ b, a, manual: !!r.manualLink });
    }
    for (const im of g.beforeImgs) if (!usedB.has(im.id)) rows.push({ b: im.id, a: null, manual: false });
    for (const im of g.afterImgs) if (!usedA.has(im.id)) rows.push({ b: null, a: im.id, manual: false });
    return rows;
  }
  const n = Math.max(g.beforeImgs.length, g.afterImgs.length);
  const rows = [];
  for (let k = 0; k < n; k++) rows.push({ b: g.beforeImgs[k]?.id || null, a: g.afterImgs[k]?.id || null, manual: false, auto: true });
  return rows;
}

// Hilfsfunktionen für die Oberfläche
function folderDisplayKind(i) {
  if (i.kind === 'root') return 'Projektordner';
  if (i.kind === 'role') return ROLES[i.role].label + (i.confidence !== 'sicher' ? ` (${i.confidence})` : '');
  if (i.kind === 'chapter') return 'Kapitel';
  return 'Dokumentationspunkt';
}

// Ordnerweg eines Bildes: alle Ordnernamen vom Hauptordner bis zum Bildordner, z. B. „J03 Verdrahtung / Vorher“
// (der Projektordner selbst wird weggelassen; Bilder direkt im Projektordner bekommen dessen Namen)
function topFolderName(model, im, sep = ' / ') {
  const fp = im.assignedFolder ?? im.folderPath;
  if (!fp) return model.project?.rootName ?? model.info.get('')?.folder.name ?? '';
  const parts = fp.split('/');
  return parts.map((name, i) => {
    const f = model.info.get(parts.slice(0, i + 1).join('/'))?.folder;
    return (f?.reportTitle && f.reportTitle.trim()) || f?.name || name;
  }).join(sep);
}

function descendantsOf(model, path) {
  const out = [];
  const walk = p => { for (const c of model.info.get(p)?.children || []) { out.push(c.path); walk(c.path); } };
  walk(path);
  return out;
}

function orderedFolderPaths(model, start = '') {
  const out = [start];
  const walk = p => { for (const c of model.info.get(p)?.children || []) { out.push(c.path); walk(c.path); } };
  walk(start);
  return out;
}
MB['analyze'] = { topFolderName, folderId, buildRecords, newImageRecord, mimeFromExt, mergeRescan, derive, folderDisplayKind, descendantsOf, orderedFolderPaths };
})();
