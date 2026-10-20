// Modul: checks
// Vollständigkeitsprüfung: komplett leere Ordner + Hinweise zu Vorher/Nachher, Auswahl und Dateien
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { naturalCompare } = MB['util'];

const PROBLEM = new Set(['fehler', 'fehlt', 'nicht unterstützt', 'nicht lesbar']);
const usable = im => !PROBLEM.has(im.status);

/**
 * Prüft das Projekt und liefert eine Liste von Meldungen.
 * level: 'fehlt' (sollte vor dem Bericht behoben werden) | 'hinweis'
 */
function runChecks(model, project) {
  const issues = [];
  const ignored = new Set(project.checkIgnored || []);
  const add = (type, level, path, title, detail) => {
    const d = typeof detail === 'string' ? { text: detail } : (detail || {});
    const key = `${type}|${path}${d.key ? '|' + d.key : ''}`;
    issues.push({ key, type, level, path, title, detail: d.text || '', ignored: ignored.has(key) });
  };
  const info = model.info;
  const nameOf = p => p === '' ? project.rootName : info.get(p).folder.name;
  const subtreeImages = p => { const out = []; const walk = q => { out.push(...(model.imagesByFolder.get(q) || [])); for (const c of info.get(q).children) walk(c.path); }; walk(p); return out; };
  const excluded = p => { let q = p; while (q != null) { const f = info.get(q)?.folder; if (!f || !f.includeInReport) return true; q = f.parentPath; } return false; };

  // 1) Komplett leere Ordner: keine Bilder und keine Unterordner (eine .txt allein zählt nicht als Foto)
  for (const [p, i] of info) {
    if (p === '' || excluded(p) || i.children.length || (model.imagesByFolder.get(p) || []).length) continue;
    const cmts = (i.folder.fileComments || []).length;
    add('empty', 'fehlt', p, 'Ordner ist leer', cmts ? 'Nur ein Kommentar (.txt), aber kein Foto.' : 'Keine Fotos und keine Unterordner.');
  }

  // 2) Vorher/Nachher-Gruppen (nur Hinweise – leere Vorher/Nachher-Ordner meldet bereits Punkt 1)
  for (const g of model.compares.values()) {
    if (excluded(g.hostPath)) continue;
    const b = g.beforeImgs.filter(usable).length, a = g.afterImgs.filter(usable).length;
    if (b && a && b !== a) add('cmp-count', 'hinweis', g.hostPath, 'Ungleiche Anzahl', `${b} Vorher / ${a} Nachher – ${Math.abs(b - a)} Bild${Math.abs(b - a) > 1 ? 'er' : ''} ohne Gegenstück.`);
    if (!g.enabled) add('cmp-unconfirmed', 'hinweis', g.hostPath, 'Vorher/Nachher nicht bestätigt', `Erkennung „${g.confidence}“ – in der Vorher/Nachher-Ansicht prüfen und aktivieren.`);
  }

  // 3) Vorher-Ordner ohne Nachher-Ordner (oder umgekehrt)
  for (const [p, i] of info) {
    if (excluded(p) || i.compare) continue;
    const roles = i.children.map(c => info.get(c.path)).filter(ci => ci.role === 'before' || ci.role === 'after');
    const hasB = roles.some(r => r.role === 'before'), hasA = roles.some(r => r.role === 'after');
    if (hasB && !hasA) add('cmp-folder', 'hinweis', p, 'Nachher-Ordner fehlt', 'Es gibt einen Vorher-Ordner, aber keinen Nachher-Ordner.');
    if (hasA && !hasB) add('cmp-folder', 'hinweis', p, 'Vorher-Ordner fehlt', 'Es gibt einen Nachher-Ordner, aber keinen Vorher-Ordner.');
  }

  // 4) Fotos vorhanden, aber keines für den Bericht ausgewählt (auf Ebene der Dokumentationspunkte)
  for (const p of model.docPoints) {
    if (p === '' || excluded(p)) continue;
    const ims = subtreeImages(p).filter(usable);
    if (ims.length && !ims.some(im => im.selected)) add('notselected', 'hinweis', p, 'Kein Foto im Bericht', `${ims.length} Foto${ims.length > 1 ? 's' : ''} vorhanden, aber keines ausgewählt.`);
  }

  // 5) Problemdateien, die ausgewählt sind
  const probByFolder = new Map();
  for (const im of model.images) {
    if (!PROBLEM.has(im.status) || !im.selected) continue;
    const fp = im.assignedFolder ?? im.folderPath;
    if (excluded(fp)) continue;
    if (!probByFolder.has(fp)) probByFolder.set(fp, []);
    probByFolder.get(fp).push(im);
  }
  for (const [fp, list] of probByFolder) add('problem', 'hinweis', fp, 'Datei nicht verwendbar', list.map(im => `${im.name} (${im.status})`).join(', '));

  // Sortierung: fehlt vor Hinweis, dann Baumreihenfolge
  const order = new Map(); let k = 0;
  const walk = p => { order.set(p, k++); for (const c of info.get(p).children) walk(c.path); };
  walk('');
  issues.sort((x, y) => (x.level === y.level ? 0 : x.level === 'fehlt' ? -1 : 1) || (order.get(x.path) ?? -1) - (order.get(y.path) ?? -1) || naturalCompare(x.title, y.title));

  const active = issues.filter(i => !i.ignored);
  const byPath = new Map();
  for (const i of active) if (i.path != null) { const cur = byPath.get(i.path); if (!cur || i.level === 'fehlt') byPath.set(i.path, i.level); }
  return {
    issues, active, byPath,
    missing: active.filter(i => i.level === 'fehlt').length,
    hints: active.filter(i => i.level === 'hinweis').length,
    nameOf,
  };
}

MB['checks'] = { runChecks };
})();
