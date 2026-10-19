// Modul: backup
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { loadJSZip, uid } = MB['util'];
const { state, getFile, thumbKey } = MB['project'];
const db = MB['db'];
// Sicherung und Wiederherstellung von Projekten (ZIP mit project.json, optional Vorschaubilder und Originale)

const FORMAT = 'montagebericht-sicherung';

async function exportBackup({ thumbs = true, originals = false } = {}, onProgress) {
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  const p = state.project;
  const images = state.images;
  zip.file('project.json', JSON.stringify({ format: FORMAT, version: 1, exportedAt: new Date().toISOString(), project: p, folders: state.folders, images, rules: state.rules }, null, 1));
  let n = 0, missing = 0;
  if (thumbs) {
    for (const im of images) {
      const t = await db.get('thumbs', thumbKey(im));
      if (t?.blob) zip.file(`thumbs/${im.id}.jpg`, t.blob);
    }
  }
  if (originals) {
    for (const im of images) {
      if (im.status === 'fehlt') continue;
      try { zip.file('originale/' + im.relPath, await getFile(im)); }
      catch { missing++; }
      onProgress?.(++n / images.length, `Original ${n} von ${images.length}`);
    }
  }
  onProgress?.(null, 'Archiv wird gepackt …');
  const blob = await zip.generateAsync({ type: 'blob', compression: originals ? 'STORE' : 'DEFLATE' }, m => onProgress?.(m.percent / 100, 'Archiv wird gepackt …'));
  p.lastBackup = Date.now();
  await db.put('projects', p);
  return { blob, missing };
}

async function readBackup(file) {
  let data, zip = null;
  if (/\.json$/i.test(file.name)) data = JSON.parse(await file.text());
  else {
    const JSZip = await loadJSZip();
    zip = await JSZip.loadAsync(file);
    const pj = zip.file('project.json');
    if (!pj) throw new Error('Keine gültige Sicherung (project.json fehlt).');
    data = JSON.parse(await pj.async('string'));
  }
  if (data.format !== FORMAT) throw new Error('Unbekanntes Sicherungsformat.');
  return { data, zip };
}

// Wiederherstellen – immer mit neuen IDs, damit vorhandene Projekte nicht überschrieben werden (außer replace=true)
async function restoreBackup({ data, zip }, { replace = false } = {}, onProgress) {
  const old = data.project;
  const exists = await db.get('projects', old.id);
  if (exists && replace) await db.deleteProject(old.id);
  const newId = (exists && !replace) ? uid('prj_') : old.id;
  const idMap = new Map();
  const images = data.images.map(im => {
    const nid = (exists && !replace) ? uid('img_') : im.id;
    idMap.set(im.id, nid);
    return { ...im, id: nid, projectId: newId };
  });
  const folders = data.folders.map(f => {
    const c = f.compare ? { ...f.compare, rows: f.compare.rows?.map(r => ({ ...r, b: r.b ? idMap.get(r.b) || null : null, a: r.a ? idMap.get(r.a) || null : null })) } : null;
    return { ...f, id: newId + '|' + f.path, projectId: newId, compare: c };
  });
  const hasOriginals = zip && Object.keys(zip.files).some(n => n.startsWith('originale/') && !zip.files[n].dir);
  const project = { ...old, id: newId, name: (exists && !replace) ? old.name + ' (wiederhergestellt)' : old.name, openedAt: Date.now(), storeCopies: !!hasOriginals, sourceType: hasOriginals ? 'zip' : old.sourceType };
  await db.put('projects', project);
  await db.putMany('folders', folders);
  await db.putMany('images', images);
  if (zip) {
    let n = 0;
    const rev = new Map([...idMap].map(([o, nw]) => [nw, o]));
    for (const im of images) {
      const oldId = rev.get(im.id);
      const t = zip.file(`thumbs/${oldId}.jpg`);
      if (t) await db.put('thumbs', { key: thumbKey(im), projectId: newId, blob: await t.async('blob') });
      const o = zip.file('originale/' + im.relPath);
      if (o) await db.put('files', { key: newId + '|' + im.relPath, projectId: newId, file: new File([await o.async('blob')], im.name, { lastModified: im.lastModified || Date.now() }) });
      onProgress?.(++n / images.length, `Bild ${n} von ${images.length}`);
    }
  }
  return { id: newId, hasOriginals };
}
MB['backup'] = { exportBackup, readBackup, restoreBackup };
})();
