// Modul: ui/editor
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { el, escapeHtml, clamp } = MB['util'];
const { getFile } = MB['project'];
const { decodeImageRecord, renderEdited, emptyEdits, rotatedSize, drawAnnotations, annotationBounds, hasEdits } = MB['imaging'];
// Nicht-destruktiver Bildeditor. Originaldateien werden nie verändert – gespeichert wird nur eine Liste von Bearbeitungsschritten.

const COLORS = ['#ff2d2d', '#ffb800', '#22c55e', '#2f80ff', '#ffffff', '#111111'];
const TOOLS = [
  ['select', 'Auswählen / Verschieben', 'M5 3l12 9-5 1 3 6-2 1-3-6-4 3z'],
  ['crop', 'Zuschneiden', 'M6 2v14h14M2 6h14v14'],
  ['arrow', 'Pfeil', 'M4 20L19 5m0 0h-8m8 0v8'],
  ['line', 'Linie', 'M4 20L20 4'],
  ['rect', 'Rechteck', 'M4 6h16v12H4z'],
  ['ellipse', 'Ellipse', 'M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z'],
  ['text', 'Text', 'M5 5h14M12 5v14'],
  ['marker', 'Marker (nummeriert)', 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z'],
];

async function openEditor(im, { onSave }) {
  let bmp;
  const loading = el('div', { class: 'editor-loading', text: 'Bild wird geladen …' });
  const root = el('div', { class: 'editor' }, loading);
  document.body.append(root);
  try { bmp = await decodeImageRecord(im, await getFile(im), im.pdfPage ? 2400 : 0); }
  catch (e) { loading.textContent = 'Bild kann nicht geöffnet werden: ' + e.message; setTimeout(() => root.remove(), 3500); return; }

  let edits = structuredClone(im.edits || emptyEdits());
  edits.adjust ||= { brightness: 100, contrast: 100, saturation: 100 };
  edits.annotations ||= [];
  const history = [JSON.stringify(edits)];
  let hIdx = 0;
  let tool = 'select', color = COLORS[0], width = 1, textSize = 1, selected = -1;
  let base = null;         // gerendertes Basisbild (ohne Anmerkungen)
  let region = null;       // sichtbarer Bereich im normierten gedrehten Raum
  let RW, RH;
  let pendingCrop = null;  // während des Zuschneidens

  // ---- Oberfläche ----
  const canvas = el('canvas', { class: 'ecanvas' });
  const stage = el('div', { class: 'estage' }, canvas);
  const toolBtns = TOOLS.map(([id, label, d]) => el('button', { class: 'tool', 'data-tool': id, title: label, html: `<svg viewBox="0 0 24 24"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${label.split(' ')[0]}</span>` }));
  const colorBtns = COLORS.map(c => el('button', { class: 'swatch', style: { background: c }, 'data-color': c, title: c }));
  const widthSel = el('select', {}, ...[['0.6', 'Dünn'], ['1', 'Normal'], ['1.6', 'Dick']].map(([v, l]) => el('option', { value: v, text: l })));
  widthSel.value = '1';
  const textInp = el('input', { type: 'text', placeholder: 'Text für das Textwerkzeug', value: '' });
  const sizeSel = el('select', {}, ...[['0.7', 'Klein'], ['1', 'Mittel'], ['1.5', 'Groß']].map(([v, l]) => el('option', { value: v, text: l })));
  sizeSel.value = '1';
  const slider = (key, label) => {
    const val = el('span', { class: 'sval' });
    const s = el('input', { type: 'range', min: 40, max: 180, value: edits.adjust[key] });
    const upd = () => { val.textContent = s.value + ' %'; };
    s.addEventListener('input', () => { edits.adjust[key] = +s.value; upd(); rebuildBase(); });
    s.addEventListener('change', commit);
    s.addEventListener('dblclick', () => { s.value = 100; edits.adjust[key] = 100; upd(); rebuildBase(); commit(); });
    upd();
    return { node: el('label', { class: 'slider' }, el('span', { text: label }), s, val), s, upd };
  };
  const sB = slider('brightness', 'Helligkeit'), sC = slider('contrast', 'Kontrast'), sS = slider('saturation', 'Sättigung');
  const cropBar = el('div', { class: 'cropbar', hidden: true },
    el('span', { text: 'Bereich aufziehen, verschieben oder an den Ecken anpassen.' }),
    el('select', { id: 'cropAspect' }, ...[['free', 'Frei'], ['4:3', '4:3'], ['3:4', '3:4'], ['1:1', '1:1'], ['16:9', '16:9']].map(([v, l]) => el('option', { value: v, text: l }))),
    el('button', { class: 'btn sm ghost', text: 'Kein Zuschnitt', onclick: () => { pendingCrop = null; edits.crop = null; commit(); setTool('select'); } }),
    el('button', { class: 'btn sm primary', text: 'Zuschnitt übernehmen', onclick: () => { applyCrop(); } }));
  const side = el('div', { class: 'eside' },
    el('h4', { text: 'Werkzeuge' }), el('div', { class: 'tools' }, ...toolBtns),
    el('h4', { text: 'Farbe & Stärke' }), el('div', { class: 'swatches' }, ...colorBtns), el('div', { class: 'row2' }, widthSel, sizeSel),
    textInp,
    el('h4', { text: 'Ausrichtung' }),
    el('div', { class: 'row2' },
      el('button', { class: 'btn sm ghost', text: '⟲ Links drehen', onclick: () => rotate(-90) }),
      el('button', { class: 'btn sm ghost', text: '⟳ Rechts drehen', onclick: () => rotate(90) })),
    el('div', { class: 'row2' },
      el('button', { class: 'btn sm ghost', text: '⇋ Horizontal spiegeln', onclick: () => flip('h') }),
      el('button', { class: 'btn sm ghost', text: '⇵ Vertikal spiegeln', onclick: () => flip('v') })),
    el('h4', { text: 'Korrektur' }), sB.node, sC.node, sS.node,
    el('p', { class: 'muted small', text: 'Doppelklick auf einen Regler setzt ihn zurück. Entf löscht die ausgewählte Anmerkung.' }));
  const undoBtn = el('button', { class: 'btn ghost sm', text: '↶ Rückgängig', onclick: () => undo() });
  const redoBtn = el('button', { class: 'btn ghost sm', text: '↷ Wiederholen', onclick: () => redo() });
  const resetBtn = el('button', { class: 'btn ghost sm', text: 'Alle Bearbeitungen entfernen', onclick: () => { edits = emptyEdits(); syncControls(); rebuildBase(); commit(); } });
  const head = el('div', { class: 'ehead' },
    el('div', { class: 'vtitle', html: `<strong>Bearbeiten:</strong> ${escapeHtml(im.name)} <span class="muted small">Original bleibt unverändert</span>` }),
    el('div', { class: 'toolbar-spacer' }), undoBtn, redoBtn, resetBtn,
    el('button', { class: 'btn ghost', text: 'Abbrechen', onclick: () => close(false) }),
    el('button', { class: 'btn primary', text: 'Speichern', onclick: () => close(true) }));
  root.replaceChildren(head, el('div', { class: 'ebody' }, el('div', { class: 'ecenter' }, cropBar, stage), side));

  toolBtns.forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  colorBtns.forEach(b => b.addEventListener('click', () => {
    color = b.dataset.color; markColor();
    if (selected >= 0) { edits.annotations[selected].color = color; draw(); commit(); }
  }));
  widthSel.onchange = () => { width = +widthSel.value; if (selected >= 0) { edits.annotations[selected].width = width; draw(); commit(); } };
  sizeSel.onchange = () => { textSize = +sizeSel.value; if (selected >= 0) { edits.annotations[selected].size = textSize; draw(); commit(); } };
  textInp.addEventListener('input', () => {
    if (selected >= 0 && edits.annotations[selected].type === 'text') { edits.annotations[selected].text = textInp.value; draw(); }
  });
  textInp.addEventListener('change', () => { if (selected >= 0) commit(); });
  function markColor() { colorBtns.forEach(b => b.classList.toggle('active', b.dataset.color === color)); }
  markColor();

  function setTool(t) {
    tool = t;
    toolBtns.forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    cropBar.hidden = t !== 'crop';
    if (t === 'crop') { pendingCrop = edits.crop ? { ...edits.crop } : { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }; selected = -1; }
    else pendingCrop = null;
    rebuildBase();
  }

  function syncControls() {
    edits.adjust ||= { brightness: 100, contrast: 100, saturation: 100 };
    for (const [s, k] of [[sB, 'brightness'], [sC, 'contrast'], [sS, 'saturation']]) { s.s.value = edits.adjust[k]; s.upd(); }
  }

  // ---- Darstellung ----
  function rebuildBase() {
    [RW, RH] = rotatedSize(bmp.width, bmp.height, edits.rotate || 0);
    const cropMode = tool === 'crop';
    region = (!cropMode && edits.crop) ? edits.crop : { x: 0, y: 0, w: 1, h: 1 };
    const maxW = stage.clientWidth - 24, maxH = stage.clientHeight - 24;
    const rw = region.w * RW, rh = region.h * RH;
    const sc = Math.min(maxW / rw, maxH / rh, 1.5);
    base = renderEdited(bmp, edits, { skipAnnotations: true, skipCrop: cropMode, maxDim: Math.max(400, Math.round(Math.max(rw, rh) * Math.min(sc, 1) * (window.devicePixelRatio || 1))) });
    canvas.width = base.width; canvas.height = base.height;
    canvas.style.width = Math.round(rw * sc) + 'px';
    canvas.style.height = Math.round(rh * sc) + 'px';
    draw();
  }

  function draw() {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    ctx.save();
    ctx.scale(canvas.width / (region.w * RW), canvas.height / (region.h * RH));
    ctx.translate(-region.x * RW, -region.y * RH);
    drawAnnotations(ctx, edits.annotations, RW, RH, selected);
    ctx.restore();
    if (tool === 'crop' && pendingCrop) {
      const c = pendingCrop, W = canvas.width, H = canvas.height;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(c.x * W, c.y * H, c.w * W, c.h * H); ctx.fill('evenodd');
      ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, W / 600);
      ctx.strokeRect(c.x * W, c.y * H, c.w * W, c.h * H);
      ctx.setLineDash([4, 4]); ctx.globalAlpha = .6;
      for (let k = 1; k < 3; k++) {
        ctx.beginPath(); ctx.moveTo((c.x + c.w * k / 3) * W, c.y * H); ctx.lineTo((c.x + c.w * k / 3) * W, (c.y + c.h) * H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(c.x * W, (c.y + c.h * k / 3) * H); ctx.lineTo((c.x + c.w) * W, (c.y + c.h * k / 3) * H); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.fillStyle = '#fff';
      const hs = Math.max(6, W / 90);
      for (const [hx, hy] of corners(c)) ctx.fillRect(hx * W - hs / 2, hy * H - hs / 2, hs, hs);
      ctx.restore();
    }
    undoBtn.disabled = hIdx === 0; redoBtn.disabled = hIdx >= history.length - 1;
  }
  const corners = c => [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]];

  // ---- Koordinaten ----
  function toNorm(e) {
    const r = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    return { px, py, x: region.x + px * region.w, y: region.y + py * region.h };
  }
  function hitTest(x, y) {
    for (let i = edits.annotations.length - 1; i >= 0; i--) {
      const b = annotationBounds(edits.annotations[i], RW, RH);
      const pad = Math.hypot(RW, RH) * 0.012;
      if (x * RW >= b.x - pad && x * RW <= b.x + b.w + pad && y * RH >= b.y - pad && y * RH <= b.y + b.h + pad) return i;
    }
    return -1;
  }

  // ---- Zeiger ----
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    const p = toNorm(e);
    if (tool === 'crop') {
      const c = pendingCrop;
      const W = canvas.getBoundingClientRect().width, tol = 14 / W;
      const ci = c ? corners(c).findIndex(([hx, hy]) => Math.abs(hx - p.px) < tol && Math.abs(hy - p.py) < tol * W / canvas.getBoundingClientRect().height) : -1;
      if (ci >= 0) drag = { mode: 'corner', ci, start: { ...c } };
      else if (c && p.px > c.x && p.px < c.x + c.w && p.py > c.y && p.py < c.y + c.h) drag = { mode: 'move', ox: p.px - c.x, oy: p.py - c.y };
      else { drag = { mode: 'new', sx: p.px, sy: p.py }; pendingCrop = { x: p.px, y: p.py, w: 0.001, h: 0.001 }; }
      return;
    }
    if (tool === 'select') {
      selected = hitTest(p.x, p.y);
      if (selected >= 0) {
        const a = edits.annotations[selected];
        drag = { mode: 'moveAnn', sx: p.x, sy: p.y, orig: { ...a } };
        if (a.type === 'text') textInp.value = a.text;
      }
      draw();
      return;
    }
    if (tool === 'text') {
      const txt = textInp.value.trim() || 'Text';
      edits.annotations.push({ type: 'text', x1: p.x, y1: p.y, text: txt, color, size: textSize });
      selected = edits.annotations.length - 1; textInp.value = txt;
      draw(); commit(); setTool('select'); return;
    }
    if (tool === 'marker') {
      const n = edits.annotations.filter(a => a.type === 'marker').length + 1;
      edits.annotations.push({ type: 'marker', x1: p.x, y1: p.y, text: String(n), color, size: textSize });
      selected = edits.annotations.length - 1;
      draw(); commit(); return;
    }
    edits.annotations.push({ type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, width });
    selected = edits.annotations.length - 1;
    drag = { mode: 'draw' };
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) {
      if (tool === 'select') canvas.style.cursor = hitTest(toNorm(e).x, toNorm(e).y) >= 0 ? 'move' : 'default';
      return;
    }
    const p = toNorm(e);
    if (drag.mode === 'draw') { const a = edits.annotations[selected]; a.x2 = p.x; a.y2 = p.y; }
    else if (drag.mode === 'moveAnn') {
      const a = edits.annotations[selected], dx = p.x - drag.sx, dy = p.y - drag.sy;
      a.x1 = drag.orig.x1 + dx; a.y1 = drag.orig.y1 + dy;
      if (drag.orig.x2 != null) { a.x2 = drag.orig.x2 + dx; a.y2 = drag.orig.y2 + dy; }
    } else if (drag.mode === 'new') {
      let x = Math.min(drag.sx, p.px), y = Math.min(drag.sy, p.py), w = Math.abs(p.px - drag.sx), h = Math.abs(p.py - drag.sy);
      ({ w, h } = aspectFix(w, h));
      if (p.px < drag.sx) x = drag.sx - w; if (p.py < drag.sy) y = drag.sy - h;
      pendingCrop = clampCrop({ x, y, w, h });
    } else if (drag.mode === 'move') {
      const c = pendingCrop;
      pendingCrop = { ...c, x: clamp(p.px - drag.ox, 0, 1 - c.w), y: clamp(p.py - drag.oy, 0, 1 - c.h) };
    } else if (drag.mode === 'corner') {
      const s = drag.start;
      const fx = drag.ci % 2 === 0 ? s.x + s.w : s.x, fy = drag.ci < 2 ? s.y + s.h : s.y;
      let w = Math.abs(p.px - fx), h = Math.abs(p.py - fy);
      ({ w, h } = aspectFix(w, h));
      pendingCrop = clampCrop({ x: p.px < fx ? fx - w : fx, y: p.py < fy ? fy - h : fy, w, h });
    }
    draw();
  });
  canvas.addEventListener('pointerup', () => {
    if (!drag) return;
    const m = drag.mode; drag = null;
    if (m === 'draw') {
      const a = edits.annotations[selected];
      if (Math.hypot((a.x2 - a.x1) * RW, (a.y2 - a.y1) * RH) < 6) { edits.annotations.splice(selected, 1); selected = -1; draw(); return; }
      commit();
    } else if (m === 'moveAnn') commit();
  });

  function aspectFix(w, h) {
    const v = root.querySelector('#cropAspect')?.value || 'free';
    if (v === 'free') return { w, h };
    const [a, b] = v.split(':').map(Number);
    const target = (a / b) * (RH / RW); // in normierten Einheiten
    if (w / h > target) w = h * target; else h = w / target;
    return { w, h };
  }
  const clampCrop = c => {
    const x = clamp(c.x, 0, 1), y = clamp(c.y, 0, 1);
    return { x, y, w: clamp(c.w, 0.01, 1 - x), h: clamp(c.h, 0.01, 1 - y) };
  };
  function applyCrop() {
    if (pendingCrop && (pendingCrop.w < 0.999 || pendingCrop.h < 0.999)) edits.crop = { ...pendingCrop };
    else edits.crop = null;
    commit();
    setTool('select');
  }

  // ---- Drehen / Spiegeln (Zuschnitt und Anmerkungen werden mitgeführt) ----
  function mapPoints(fn) {
    for (const a of edits.annotations) {
      [a.x1, a.y1] = fn(a.x1, a.y1);
      if (a.x2 != null) [a.x2, a.y2] = fn(a.x2, a.y2);
    }
  }
  function rotate(deg) {
    const cw = deg > 0;
    edits.rotate = (((edits.rotate || 0) + deg) % 360 + 360) % 360;
    const fn = cw ? (x, y) => [1 - y, x] : (x, y) => [y, 1 - x];
    mapPoints(fn);
    if (edits.crop) { const c = edits.crop; edits.crop = cw ? { x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w } : { x: c.y, y: 1 - (c.x + c.w), w: c.h, h: c.w }; }
    // Rechtecke/Ellipsen nach Drehung normalisieren
    rebuildBase(); commit();
  }
  function flip(dir) {
    const rotOdd = (edits.rotate || 0) % 180 !== 0;
    if (dir === 'h') { rotOdd ? (edits.flipV = !edits.flipV) : (edits.flipH = !edits.flipH); mapPoints((x, y) => [1 - x, y]); if (edits.crop) edits.crop.x = 1 - (edits.crop.x + edits.crop.w); }
    else { rotOdd ? (edits.flipH = !edits.flipH) : (edits.flipV = !edits.flipV); mapPoints((x, y) => [x, 1 - y]); if (edits.crop) edits.crop.y = 1 - (edits.crop.y + edits.crop.h); }
    rebuildBase(); commit();
  }

  // ---- Verlauf ----
  function commit() {
    const s = JSON.stringify(edits);
    if (s === history[hIdx]) return;
    history.splice(hIdx + 1);
    history.push(s); hIdx = history.length - 1;
    draw();
  }
  function undo() { if (hIdx > 0) { hIdx--; edits = JSON.parse(history[hIdx]); selected = -1; syncControls(); rebuildBase(); } }
  function redo() { if (hIdx < history.length - 1) { hIdx++; edits = JSON.parse(history[hIdx]); selected = -1; syncControls(); rebuildBase(); } }

  const onKey = e => {
    if (e.target === textInp) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected >= 0) { edits.annotations.splice(selected, 1); selected = -1; draw(); commit(); e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if (e.key === 'Escape') { if (tool === 'crop') setTool('select'); else close(false); }
  };
  document.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => rebuildBase());
  ro.observe(stage);

  function close(save) {
    if (save) {
      if (tool === 'crop') applyCrop();
      const result = hasEdits(edits) ? edits : null;
      onSave?.(result);
    }
    document.removeEventListener('keydown', onKey);
    ro.disconnect();
    bmp.close?.();
    root.remove();
  }

  setTool('select');
  syncControls();
}
MB['ui/editor'] = { openEditor };
})();
