// Modul: ui/details
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { el, escapeHtml, formatBytes, formatDateTime } = MB['util'];
const { cachedThumb, requestThumb } = MB['thumbs'];
const { ROLES } = MB['rules'];
const { folderDisplayKind } = MB['analyze'];
const { hasEdits } = MB['imaging'];
const { normalizeName } = MB['rules'];
// Rechte Seitenleiste: Details zu Bild, Mehrfachauswahl oder Ordner

const LABELS = [['rot', 'Rot – Mangel'], ['gelb', 'Gelb – prüfen'], ['gruen', 'Grün – erledigt'], ['blau', 'Blau – Info']];

function renderDetails(container, ctx) {
  const { model, selection, folderPath } = ctx;
  container.innerHTML = '';
  if (!model) return;
  if (selection.length === 1) return renderImage(container, model.imageById.get(selection[0]), ctx);
  if (selection.length > 1) return renderMulti(container, selection.map(id => model.imageById.get(id)).filter(Boolean), ctx);
  renderFolder(container, folderPath, ctx);
}

function row(k, v, cls = '') { return `<tr class="${cls}"><th>${escapeHtml(k)}</th><td>${v}</td></tr>`; }

function renderImage(c, im, ctx) {
  if (!im) return;
  const { model, actions } = ctx;
  const eff = im.assignedFolder ?? im.folderPath;
  const info = model.info.get(eff);
  const dp = info?.docPoint;
  const ph = model.phaseOf.get(im.id);
  const g = ph && model.compares.get(ph.host);
  const partner = g && g.rows.find(r => r.b === im.id || r.a === im.id);
  const partnerId = partner && (partner.b === im.id ? partner.a : partner.b);
  const prev = el('div', { class: 'd-preview', title: 'Doppelklick zum Öffnen', ondblclick: () => actions.open(im.id) });
  const u = cachedThumb(im) || requestThumb(im, url => { if (url) prev.style.backgroundImage = `url("${url}")`; }, 3);
  if (u) prev.style.backgroundImage = `url("${u}")`;
  const parent = im.folderPath ? (im.folderPath.includes('/') ? im.folderPath.slice(0, im.folderPath.lastIndexOf('/')) : '(Projektordner)') : '–';
  const orient = im.width ? (im.width > im.height ? 'Querformat' : im.width < im.height ? 'Hochformat' : 'Quadratisch') : '–';
  const statusCls = ['fehler', 'fehlt', 'nicht unterstützt', 'nicht lesbar'].includes(im.status) ? 'bad' : '';
  const meta = `<table class="meta">
    ${row('Dateiname', escapeHtml(im.name))}
    ${row('Relativer Pfad', `<code>${escapeHtml(im.relPath)}</code>`)}
    ${row('Ursprünglicher Ordner', escapeHtml(model.info.get(im.folderPath)?.folder.name ?? im.folderPath))}
    ${row('Übergeordneter Ordner', escapeHtml(parent))}
    ${row('Ordnerpfad', `<code>${escapeHtml(im.folderPath || '(Projektordner)')}</code>`)}
    ${row('Ebene', String(im.folderPath ? im.folderPath.split('/').length : 0))}
    ${row('Position im Ordner', String(im.indexInFolder + 1))}
    ${row('Dokumentationspunkt', dp != null ? `<a href="#" data-goto="${escapeHtml(dp)}">${escapeHtml(model.info.get(dp)?.folder.name || '')}</a>` : '–')}
    ${row('Vorher/Nachher', ph ? `${ph.phase === 'before' ? 'Vorher' : 'Nachher'} <span class="conf conf-${ph.confidence}">${ph.confidence}</span>${ph.enabled ? '' : ' <span class="muted">(nicht bestätigt)</span>'}` : '<span class="muted">keiner Gruppe zugeordnet</span>')}
    ${ph ? row('Gegenstück', partnerId ? `<a href="#" data-select="${partnerId}">${escapeHtml(model.imageById.get(partnerId)?.name)}</a>` : '<span class="warn-t">ohne Gegenstück</span>') : ''}
    ${im.assignedFolder != null ? row('Im Bericht unter', `${escapeHtml(model.info.get(im.assignedFolder)?.folder.name || im.assignedFolder)} <a href="#" data-unassign>zurücksetzen</a>`) : ''}
    ${row('Format', escapeHtml((im.ext || '').toUpperCase()))}
    ${row('MIME-Typ (erkannt)', escapeHtml(im.mime || 'noch nicht geprüft'))}
    ${row('Dateigröße', formatBytes(im.size))}
    ${row('Abmessungen', im.width ? `${im.width} × ${im.height} px` : '–')}
    ${row('Ausrichtung', orient + (im.exifOrientation && im.exifOrientation !== 1 ? ` <span class="muted">(EXIF ${im.exifOrientation})</span>` : ''))}
    ${row('Aufnahmedatum', im.dateTaken ? `${formatDateTime(im.dateTaken)} <span class="muted">(${escapeHtml(im.dateSource || 'EXIF')})</span>` : '<span class="muted">nicht ermittelbar</span>')}
    ${row('Änderungsdatum', im.lastModified ? formatDateTime(im.lastModified) : '–')}
    ${im.camera ? row('Kamera', escapeHtml(im.camera)) : ''}
    ${row('Status', `<span class="st ${statusCls}">${escapeHtml(im.status)}</span>${im.error ? `<div class="small muted">${escapeHtml(im.error)}</div>` : ''}`)}
    ${row('Interne ID', `<code>${im.id}</code>`, 'muted')}
  </table>`;
  const cap = el('textarea', { rows: 2, placeholder: 'Bildbeschriftung für den Bericht (optional)' });
  cap.value = im.caption || '';
  cap.addEventListener('change', () => actions.patchImages([im.id], { caption: cap.value }));
  const note = el('textarea', { rows: 2, placeholder: 'Interne Notiz' });
  note.value = im.note || '';
  note.addEventListener('change', () => actions.patchImages([im.id], { note: note.value }));
  const repChk = el('input', { type: 'checkbox', checked: im.selected });
  repChk.onchange = () => actions.patchImages([im.id], { selected: repChk.checked });
  const star = el('button', { class: `btn sm ${im.starred ? 'primary' : 'ghost'}`, text: im.starred ? '★ Markiert' : '☆ Markieren', onclick: () => actions.patchImages([im.id], { starred: !im.starred }) });
  c.append(...[
    el('div', { class: 'd-head' }, el('h3', { text: im.name, title: im.name })),
    prev,
    el('div', { class: 'd-actions' },
      el('button', { class: 'btn sm ghost', text: 'Öffnen', onclick: () => actions.open(im.id) }),
      el('button', { class: 'btn sm ghost', text: 'Bearbeiten', disabled: im.status === 'nicht unterstützt' || im.status === 'fehlt', onclick: () => actions.edit(im.id) }),
      hasEdits(im.edits) ? el('button', { class: 'btn sm ghost', text: 'Bearbeitung entfernen', onclick: () => actions.clearEdits([im.id]) }) : null,
      star),
    el('label', { class: 'check big' }, repChk, ' Im Bericht verwenden'),
    labelPicker(im.label, v => actions.patchImages([im.id], { label: v })),
    el('label', { class: 'field' }, el('span', { text: 'Beschriftung' }), cap),
    el('label', { class: 'field' }, el('span', { text: 'Notiz' }), note),
    el('div', { html: meta })].filter(Boolean));
  bindLinks(c, ctx, im);
}

function labelPicker(cur, onPick) {
  const wrap = el('div', { class: 'labels' }, el('span', { class: 'small muted', text: 'Farbmarkierung' }));
  for (const [v, t] of LABELS) wrap.append(el('button', { class: `lbl lbl-${v} ${cur === v ? 'on' : ''}`, title: t, onclick: () => onPick(cur === v ? null : v) }));
  if (cur) wrap.append(el('button', { class: 'btn xs ghost', text: 'entfernen', onclick: () => onPick(null) }));
  return wrap;
}

function bindLinks(c, ctx, im) {
  c.querySelectorAll('[data-goto]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); ctx.actions.gotoFolder(a.dataset.goto); }));
  c.querySelectorAll('[data-select]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); ctx.actions.select([a.dataset.select]); }));
  c.querySelectorAll('[data-unassign]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); ctx.actions.patchImages([im.id], { assignedFolder: null, reportOrder: null }, true); }));
}

function renderMulti(c, ims, ctx) {
  const { actions } = ctx;
  const ids = ims.map(i => i.id);
  const inRep = ims.filter(i => i.selected).length;
  const size = ims.reduce((a, i) => a + (i.size || 0), 0);
  c.append(
    el('div', { class: 'd-head' }, el('h3', { text: `${ims.length} Bilder ausgewählt` })),
    el('p', { class: 'muted small', text: `${inRep} davon im Bericht · ${formatBytes(size)}` }),
    el('div', { class: 'd-actions col' },
      el('button', { class: 'btn sm', text: 'Alle in den Bericht übernehmen', onclick: () => actions.patchImages(ids, { selected: true }) }),
      el('button', { class: 'btn sm ghost', text: 'Alle aus dem Bericht entfernen', onclick: () => actions.patchImages(ids, { selected: false }) }),
      el('button', { class: 'btn sm ghost', text: '★ Alle markieren', onclick: () => actions.patchImages(ids, { starred: true }) }),
      el('button', { class: 'btn sm ghost', text: 'Markierung entfernen', onclick: () => actions.patchImages(ids, { starred: false, label: null }) }),
      el('button', { class: 'btn sm ghost', text: 'Zuordnung zum Originalordner zurücksetzen', onclick: () => actions.patchImages(ids, { assignedFolder: null, reportOrder: null }, true) }),
      el('button', { class: 'btn sm ghost', text: 'Bearbeitungen entfernen', onclick: () => actions.clearEdits(ids) })),
    labelPicker(null, v => actions.patchImages(ids, { label: v })),
    el('p', { class: 'muted small', text: 'Tipp: Ausgewählte Bilder auf einen Ordner im Baum ziehen, um sie im Bericht dort einzuordnen. Die Originaldateien werden dabei nicht verschoben.' }));
}

function renderFolder(c, path, ctx) {
  const { model, actions } = ctx;
  const i = model.info.get(path);
  if (!i) return;
  const f = i.folder;
  const roleSel = el('select', {},
    el('option', { value: '', text: 'Automatisch' + (f.detected ? ` (${ROLES[f.detected.role].label}, ${f.detected.confidence})` : ' (keine Rolle)') }),
    el('option', { value: 'none', text: 'Keine Rolle – normaler Ordner' }),
    ...Object.entries(ROLES).map(([k, v]) => el('option', { value: k, text: v.label })));
  roleSel.value = f.roleOverride || '';
  roleSel.disabled = path === '';
  roleSel.onchange = () => actions.patchFolder(path, { roleOverride: roleSel.value || null });
  const titleInp = el('input', { type: 'text', value: f.reportTitle ?? '', placeholder: f.name });
  titleInp.addEventListener('change', () => actions.patchFolder(path, { reportTitle: titleInp.value.trim() && titleInp.value.trim() !== f.name ? titleInp.value.trim() : null }));
  const stripNum = normalizeName(f.name) !== f.name.toLowerCase() && /^\s*\d+[\s._\-]+/.test(f.name) ? f.name.replace(/^\s*\d+[\s._\-]+/, '').replace(/_/g, ' ') : null;
  const note = el('textarea', { rows: 3, placeholder: 'Beschreibung / Bemerkung zu diesem Punkt (erscheint im Bericht unter der Überschrift)' });
  note.value = f.note || '';
  note.addEventListener('change', () => actions.patchFolder(path, { note: note.value }, false));
  const incl = el('input', { type: 'checkbox', checked: f.includeInReport });
  incl.onchange = () => actions.patchFolder(path, { includeInReport: incl.checked });
  const directIms = model.imagesByFolder.get(path) || [];
  const subtree = actions.subtreeImages(path);
  const sel = subtree.filter(x => x.selected).length;

  c.append(...[
    el('div', { class: 'd-head' }, el('h3', { text: f.name, title: f.name }), el('span', { class: `kind k-${i.kind}`, text: folderDisplayKind(i) })),
    el('table', { class: 'meta', html: `
      ${row('Relativer Pfad', `<code>${escapeHtml(path || '(Projektordner)')}</code>`)}
      ${row('Ebene', String(f.depth))}
      ${row('Bilder', `${i.direct} direkt · ${i.total} gesamt`)}
      ${row('Unterordner', String(i.subCount))}
      ${row('Im Bericht', `${sel} von ${subtree.length} Bildern`)}
      ${i.kind === 'role' ? row('Erkennung', `${escapeHtml(i.source || '')} <span class="conf conf-${i.confidence}">${i.confidence}</span>`) : ''}
      ${i.hint ? row('Hinweis', `<span class="muted">${escapeHtml(i.hint)}</span>`) : ''}
      ${i.docPoint !== path && path !== '' ? row('Gehört zu', `<a href="#" data-goto="${escapeHtml(i.docPoint)}">${escapeHtml(model.info.get(i.docPoint)?.folder.name || '')}</a>`) : ''}
      ${i.compare ? row('Vorher/Nachher', `${i.compare.beforeImgs.length} ↔ ${i.compare.afterImgs.length} Bilder · <span class="conf conf-${i.compare.confidence}">${i.compare.confidence}</span> · ${i.compare.enabled ? 'aktiv' : '<b>nicht bestätigt</b>'} <a href="#" data-compare>anzeigen</a>`) : ''}
      ${i.empty ? row('Status', '<span class="muted">leer – keine Bilder</span>') : ''}
      ${f.missingOnDisk ? row('Status', '<span class="warn-t">beim letzten Einlesen nicht gefunden</span>') : ''}
    ` }),
    el('label', { class: 'check big' }, incl, ' Im Bericht ausgeben'),
    el('label', { class: 'field' }, el('span', { text: 'Überschrift im Bericht' }), titleInp,
      el('small', { class: 'muted', html: `Original: <b>${escapeHtml(f.name)}</b> – bleibt immer erhalten. Leer lassen = Originalname.` })),
    stripNum ? el('button', { class: 'btn xs ghost', text: `Vorschlag übernehmen: „${stripNum}“`, onclick: () => actions.patchFolder(path, { reportTitle: stripNum }) }) : null,
    el('label', { class: 'field' }, el('span', { text: 'Bedeutung des Ordners' }), roleSel),
    f.fileComments?.length ? el('div', { class: 'field' }, el('span', { text: 'Kommentare aus .txt-Dateien' }),
      ...f.fileComments.map(c => el('div', { class: 'fcomment', title: c.file },
        el('div', { class: 'fc-text', text: MB['scanner'].commentText(c) || '(leer)' }),
        el('div', { class: 'fc-file muted small', text: c.file })))) : null,
    el('label', { class: 'field' }, el('span', { text: 'Bemerkung' }), note),
    path !== '' ? el('div', { class: 'd-actions' },
      el('button', { class: 'btn sm ghost', text: '↑ Nach oben', onclick: () => actions.moveFolderStep(path, -1) }),
      el('button', { class: 'btn sm ghost', text: '↓ Nach unten', onclick: () => actions.moveFolderStep(path, 1) }),
      el('button', { class: 'btn sm ghost', text: 'Reihenfolge zurücksetzen', title: 'Ursprüngliche Reihenfolge der Unterordner von ' + (model.info.get(f.parentPath)?.folder.name || ''), onclick: () => actions.resetFolderOrder(f.parentPath) })) : null,
    el('div', { class: 'd-actions' },
      el('button', { class: 'btn sm ghost', text: 'Alle Bilder hier in den Bericht', onclick: () => actions.patchImages(subtree.map(x => x.id), { selected: true }) }),
      el('button', { class: 'btn sm ghost', text: 'Alle hier entfernen', onclick: () => actions.patchImages(subtree.map(x => x.id), { selected: false }) }),
      directIms.some(x => x.reportOrder != null) ? el('button', { class: 'btn sm ghost', text: 'Bildreihenfolge zurücksetzen', onclick: () => actions.patchImages(directIms.map(x => x.id), { reportOrder: null }, true) }) : null),
  ].filter(Boolean));
  c.querySelectorAll('[data-goto]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); actions.gotoFolder(a.dataset.goto); }));
  c.querySelector('[data-compare]')?.addEventListener('click', e => { e.preventDefault(); actions.showCompare(path); });
}
MB['ui/details'] = { renderDetails };
})();
