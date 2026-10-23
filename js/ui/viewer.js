// Modul: ui/viewer
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { el, escapeHtml } = MB['util'];
const { getFile } = MB['project'];
const { decodeImageRecord, renderEdited, canvasToBlob } = MB['imaging'];
// Bildbetrachter: Einzelbild mit Zoom/Verschieben, Vorher/Nachher nebeneinander mit optional synchronem Zoom

const fullCache = new Map(); // key -> objectURL (kleiner LRU)
async function fullUrl(im) {
  const key = `${im.id}|${im.editVersion || 0}|${im.sig}`;
  if (fullCache.has(key)) { const u = fullCache.get(key); fullCache.delete(key); fullCache.set(key, u); return u; }
  const file = await getFile(im);
  const bmp = await decodeImageRecord(im, file, im.pdfPage ? 3000 : 0);
  const c = renderEdited(bmp, im.edits, { maxDim: 3200 });
  bmp.close?.();
  const blob = await canvasToBlob(c, 'image/jpeg', 0.92);
  const u = URL.createObjectURL(blob);
  fullCache.set(key, u);
  while (fullCache.size > 8) { const [k, v] = fullCache.entries().next().value; URL.revokeObjectURL(v); fullCache.delete(k); }
  return u;
}

function makePane(onTransform) {
  const img = el('img', { class: 'vimg', draggable: 'false', alt: '' });
  const pane = el('div', { class: 'vpane' }, img, el('div', { class: 'vspin' }));
  const t = { s: 1, x: 0, y: 0 };
  const apply = () => { img.style.transform = `translate(${t.x}px,${t.y}px) scale(${t.s})`; };
  const set = (nt, silent) => { Object.assign(t, nt); apply(); if (!silent) onTransform?.({ ...t }, pane); };
  pane.addEventListener('wheel', e => {
    e.preventDefault();
    const r = pane.getBoundingClientRect();
    const cx = e.clientX - r.left - r.width / 2, cy = e.clientY - r.top - r.height / 2;
    const f = Math.exp(-e.deltaY * 0.0015);
    const s = Math.max(1, Math.min(12, t.s * f));
    const k = s / t.s;
    set({ s, x: s === 1 ? 0 : cx - (cx - t.x) * k, y: s === 1 ? 0 : cy - (cy - t.y) * k });
  }, { passive: false });
  let drag = null;
  pane.addEventListener('pointerdown', e => { if (t.s <= 1) return; drag = { x: e.clientX - t.x, y: e.clientY - t.y }; pane.setPointerCapture(e.pointerId); pane.classList.add('grabbing'); });
  pane.addEventListener('pointermove', e => { if (drag) set({ x: e.clientX - drag.x, y: e.clientY - drag.y }); });
  pane.addEventListener('pointerup', () => { drag = null; pane.classList.remove('grabbing'); });
  pane.addEventListener('dblclick', () => set(t.s > 1 ? { s: 1, x: 0, y: 0 } : { s: 2.5, x: 0, y: 0 }));
  return {
    pane, img,
    async load(im) {
      pane.classList.add('busy'); pane.classList.remove('failed');
      set({ s: 1, x: 0, y: 0 }, true);
      if (!im) { img.removeAttribute('src'); pane.classList.remove('busy'); pane.classList.add('emptyp'); return; }
      pane.classList.remove('emptyp');
      try { img.src = await fullUrl(im); await img.decode().catch(() => {}); }
      catch (e) { pane.classList.add('failed'); pane.dataset.err = e.message; }
      pane.classList.remove('busy');
    },
    set, get t() { return { ...t }; },
    zoom(f) { const s = Math.max(1, Math.min(12, t.s * f)); set({ s, x: s === 1 ? 0 : t.x * s / t.s, y: s === 1 ? 0 : t.y * s / t.s }); },
  };
}

// Einzelansicht mit Blättern
function openViewer(list, startIndex, { onEdit } = {}) {
  let idx = startIndex;
  const p = makePane();
  const title = el('div', { class: 'vtitle' });
  const counter = el('span', { class: 'muted' });
  const prev = el('button', { class: 'vnav prev', html: '‹', title: 'Vorheriges (←)' });
  const next = el('button', { class: 'vnav next', html: '›', title: 'Nächstes (→)' });
  const close = el('button', { class: 'icon-btn vclose', html: '&times;', title: 'Schließen (Esc)' });
  const editBtn = el('button', { class: 'btn ghost sm', text: 'Bearbeiten' });
  const zin = el('button', { class: 'icon-btn sm', text: '+', title: 'Vergrößern' });
  const zout = el('button', { class: 'icon-btn sm', text: '−', title: 'Verkleinern' });
  const z0 = el('button', { class: 'btn ghost sm', text: 'Einpassen' });
  const bar = el('div', { class: 'vbar' }, title, counter, el('div', { class: 'toolbar-spacer' }), zout, zin, z0, editBtn, close);
  const root = el('div', { class: 'viewer' }, bar, el('div', { class: 'vstage' }, p.pane, prev, next));
  document.body.append(root);
  const show = () => {
    const im = list[idx];
    title.innerHTML = `<strong>${escapeHtml(im.name)}</strong> <span class="muted small">${escapeHtml(im.relPath)}</span>`;
    counter.textContent = `${idx + 1} / ${list.length}`;
    prev.disabled = idx === 0; next.disabled = idx === list.length - 1;
    p.load(im);
  };
  const go = d => { const n = idx + d; if (n >= 0 && n < list.length) { idx = n; show(); } };
  prev.onclick = () => go(-1); next.onclick = () => go(1);
  zin.onclick = () => p.zoom(1.4); zout.onclick = () => p.zoom(1 / 1.4); z0.onclick = () => p.set({ s: 1, x: 0, y: 0 });
  editBtn.onclick = () => { const im = list[idx]; destroy(); onEdit?.(im.id); };
  const onKey = e => {
    if (document.querySelector('.modal-backdrop')) return;
    if (e.key === 'Escape') destroy();
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === '+' || e.key === '=') p.zoom(1.4);
    else if (e.key === '-') p.zoom(1 / 1.4);
    else if (e.key === '0') p.set({ s: 1, x: 0, y: 0 });
  };
  document.addEventListener('keydown', onKey);
  close.onclick = () => destroy();
  function destroy() { document.removeEventListener('keydown', onKey); root.remove(); }
  show();
}

// Vorher/Nachher nebeneinander
function openCompareViewer(pairs, startIndex, { title: groupTitle } = {}) {
  let idx = startIndex;
  let sync = true;
  let a, b;
  const onT = (t, src) => { if (!sync) return; (src === a.pane ? b : a).set(t, true); };
  a = makePane(onT); b = makePane(onT);
  const syncChk = el('input', { type: 'checkbox', checked: true });
  syncChk.onchange = () => { sync = syncChk.checked; };
  const counter = el('span', { class: 'muted' });
  const capA = el('div', { class: 'vcap' }), capB = el('div', { class: 'vcap' });
  const close = el('button', { class: 'icon-btn vclose', html: '&times;' });
  const prev = el('button', { class: 'btn ghost sm', text: '‹ Vorheriges Paar' });
  const next = el('button', { class: 'btn ghost sm', text: 'Nächstes Paar ›' });
  const bar = el('div', { class: 'vbar' }, el('div', { class: 'vtitle' }, el('strong', { text: groupTitle || 'Vorher / Nachher' })), counter,
    el('div', { class: 'toolbar-spacer' }), el('label', { class: 'check' }, syncChk, ' Zoom synchronisieren'), prev, next, close);
  const stage = el('div', { class: 'vstage two' },
    el('div', { class: 'vcol' }, el('div', { class: 'vhead before', text: 'Vorher' }), a.pane, capA),
    el('div', { class: 'vcol' }, el('div', { class: 'vhead after', text: 'Nachher' }), b.pane, capB));
  const root = el('div', { class: 'viewer' }, bar, stage);
  document.body.append(root);
  const show = () => {
    const [ib, ia] = pairs[idx];
    counter.textContent = `Paar ${idx + 1} / ${pairs.length}`;
    capA.textContent = ib ? ib.name : '— kein Vorher-Bild zugeordnet —';
    capB.textContent = ia ? ia.name : '— kein Nachher-Bild zugeordnet —';
    prev.disabled = idx === 0; next.disabled = idx === pairs.length - 1;
    a.load(ib); b.load(ia);
  };
  prev.onclick = () => { if (idx > 0) { idx--; show(); } };
  next.onclick = () => { if (idx < pairs.length - 1) { idx++; show(); } };
  const onKey = e => {
    if (e.key === 'Escape') destroy();
    else if (e.key === 'ArrowLeft') prev.click();
    else if (e.key === 'ArrowRight') next.click();
  };
  document.addEventListener('keydown', onKey);
  close.onclick = () => destroy();
  function destroy() { document.removeEventListener('keydown', onKey); root.remove(); }
  show();
}
MB['ui/viewer'] = { openViewer, openCompareViewer };
})();
