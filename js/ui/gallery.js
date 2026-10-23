// Modul: ui/gallery
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { escapeHtml } = MB['util'];
const { requestThumb, cachedThumb, bumpPriority } = MB['thumbs'];
const { hasEdits } = MB['imaging'];
// Virtualisierte Galerie mit Gruppenüberschriften, Mehrfachauswahl, Tastatursteuerung und Drag & Drop

const PROBLEM = new Set(['fehler', 'fehlt', 'nicht unterstützt', 'nicht lesbar']);
const HEADER_H = 34, GAP = 10, PAD = 12, LABEL_H = 38;

function createGallery(scroller, spacer, handlers) {
  let groups = [];         // [{ key, title, sub, items: [image] }]
  let flat = [];           // alle Bilder in Anzeige-Reihenfolge
  let indexOf = new Map(); // id -> Index in flat
  let rows = [];           // [{ type:'h'|'t', top, h, group, items }]
  let cols = 1, tile = 180, total = 0;
  let ctx = {};            // { selection:Set, phaseOf, canReorder }
  let raf = 0;

  function layout() {
    const w = scroller.clientWidth - PAD * 2;
    cols = Math.max(1, Math.floor((w + GAP) / (tile + GAP)));
    rows = [];
    let y = PAD;
    const tileH = tile + LABEL_H;
    for (const g of groups) {
      if (g.title != null) { rows.push({ type: 'h', top: y, h: HEADER_H, group: g }); y += HEADER_H; }
      for (let i = 0; i < g.items.length; i += cols) {
        rows.push({ type: 't', top: y, h: tileH, items: g.items.slice(i, i + cols), start: i });
        y += tileH + GAP;
      }
      if (g.title != null) y += 6;
    }
    total = y + PAD;
    spacer.style.height = total + 'px';
  }

  // Kacheln werden nach Schlüssel wiederverwendet: beim Scrollen entstehen nur neu sichtbare Kacheln,
  // bereits vorhandene bleiben unangetastet. Ein vollständiger Neuaufbau nur nach Daten-/Auswahl-/Layoutänderung.
  const nodes = new Map();   // Schlüssel ('t:'+id bzw. 'h:'+Gruppe) -> Element
  let dirty = true;
  const tpl = document.createElement('template');
  function schedule(full) { if (full) dirty = true; cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }

  function draw() {
    const top = scroller.scrollTop, bottom = top + scroller.clientHeight;
    const over = 400;
    // binäre Suche erste sichtbare Zeile
    let lo = 0, hi = rows.length - 1, first = rows.length;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].top + rows[m].h >= top - over) { first = m; hi = m - 1; } else lo = m + 1; }
    const needed = new Set();
    const fresh = [];
    const tileW = tile;
    const place = (key, makeHtml, im) => {
      needed.add(key);
      const old = nodes.get(key);
      if (old && !dirty) return;
      tpl.innerHTML = makeHtml();
      const n = tpl.content.firstElementChild;
      if (old) old.replaceWith(n); else spacer.append(n);
      nodes.set(key, n);
      if (im) fresh.push(im);
    };
    for (let r = first; r < rows.length && rows[r].top <= bottom + over; r++) {
      const row = rows[r];
      if (row.type === 'h') {
        const g = row.group;
        place('h:' + g.key + ':' + row.top, () => `<div class="g-head" style="top:${row.top}px" data-group="${escapeHtml(g.key)}"><span class="g-title">${escapeHtml(g.title)}</span>${g.sub ? `<span class="g-sub">${escapeHtml(g.sub)}</span>` : ''}<span class="g-count">${g.items.length}</span></div>`);
      } else {
        row.items.forEach((im, k) => {
          const x = PAD + k * (tileW + GAP);
          place('t:' + im.id, () => tileHtml(im, x, row.top, tileW), im);
        });
      }
    }
    for (const [k, n] of nodes) if (!needed.has(k)) { n.remove(); nodes.delete(k); }
    dirty = false;
    if (!fresh.length) return;
    bumpPriority(fresh);
    // Vorschaubilder für neu erzeugte Kacheln anfordern
    for (const im of fresh) {
      if (cachedThumb(im) || PROBLEM.has(im.status)) continue;
      requestThumb(im, url => {
        const node = nodes.get('t:' + im.id)?.querySelector('.thumb');
        if (!node) return;
        if (url) { node.style.backgroundImage = `url("${url}")`; node.classList.remove('loading'); }
        else node.classList.add('nothumb');
      }, 2);
    }
  }

  function tileHtml(im, x, y, w) {
    const sel = ctx.selection?.has(im.id);
    const url = cachedThumb(im);
    const ph = ctx.phaseOf?.get(im.id);
    const problem = ['fehler', 'fehlt', 'nicht unterstützt', 'nicht lesbar'].includes(im.status);
    const badges = [];
    if (ph) badges.push(`<span class="b ph-${ph.phase} ${ph.enabled ? '' : 'unsure'}" title="${ph.phase === 'before' ? 'Vorher' : 'Nachher'} (${ph.confidence})">${ph.phase === 'before' ? 'V' : 'N'}</span>`);
    if (im.pdfPage) badges.push(`<span class="b pdf" title="Seite ${im.pdfPage} von ${im.pdfPages} aus ${escapeHtml(im.pdfName || '')}">PDF${im.pdfPages > 1 ? ' ' + im.pdfPage : ''}</span>`);
    if (hasEdits(im.edits)) badges.push('<span class="b ed" title="Bearbeitet">✎</span>');
    if (im.assignedFolder != null) badges.push('<span class="b mv" title="Im Bericht einem anderen Ordner zugeordnet">↪</span>');
    if (im.starred) badges.push('<span class="b st" title="Markiert">★</span>');
    const unpaired = ctx.unpaired?.has(im.id);
    if (unpaired) badges.push('<span class="b np" title="Ohne Gegenstück in der Vorher/Nachher-Gruppe">∅</span>');
    return `<div class="tile ${sel ? 'sel' : ''} ${problem ? 'problem' : ''} ${im.selected ? 'inrep' : 'notrep'} ${im.label ? 'lbl-' + im.label : ''}" data-id="${im.id}" style="transform:translate(${x}px,${y}px);width:${w}px" draggable="true" tabindex="-1">
      <div class="thumb ${url ? '' : (problem ? 'nothumb' : 'loading')}" style="height:${w}px;${url ? `background-image:url('${url}')` : ''}">
        ${problem ? `<div class="err" title="${escapeHtml(im.error || im.status)}">${escapeHtml(statusText(im))}</div>` : ''}
        <button class="rep" data-rep title="${im.selected ? 'Im Bericht – klicken zum Entfernen' : 'Nicht im Bericht – klicken zum Hinzufügen'}" aria-pressed="${im.selected}">${im.selected ? '✓' : ''}</button>
        <div class="badges">${badges.join('')}</div>
      </div>
      <div class="tlabel"><span class="fn" title="${escapeHtml(im.relPath)}">${escapeHtml(im.name)}</span><span class="tmeta">${im.width ? `${im.width}×${im.height}` : (im.ext || '').toUpperCase()}</span></div>
    </div>`;
  }

  function statusText(im) {
    if (im.status === 'fehlt') return 'Datei fehlt';
    if (im.status === 'nicht unterstützt') return `.${im.ext} nicht unterstützt`;
    if (im.status === 'nicht lesbar') return 'nicht lesbar';
    return 'Fehler beim Lesen';
  }

  scroller.addEventListener('scroll', () => schedule(false), { passive: true });
  new ResizeObserver(() => { layout(); schedule(true); }).observe(scroller);

  // ---- Interaktion ----
  scroller.addEventListener('click', e => {
    const t = e.target.closest('.tile');
    if (!t) { if (e.target === scroller || e.target === spacer) handlers.onSelection([], null); return; }
    const id = t.dataset.id;
    if (e.target.closest('[data-rep]')) { handlers.onToggleReport(id); return; }
    const sel = new Set(ctx.selection);
    if (e.shiftKey && ctx.anchor && indexOf.has(ctx.anchor)) {
      const a = indexOf.get(ctx.anchor), b = indexOf.get(id);
      const [s, en] = a < b ? [a, b] : [b, a];
      if (!(e.ctrlKey || e.metaKey)) sel.clear();
      for (let i = s; i <= en; i++) sel.add(flat[i].id);
      handlers.onSelection([...sel], ctx.anchor);
    } else if (e.ctrlKey || e.metaKey) {
      sel.has(id) ? sel.delete(id) : sel.add(id);
      handlers.onSelection([...sel], id);
    } else handlers.onSelection([id], id);
    scroller.focus({ preventScroll: true });
  });
  scroller.addEventListener('dblclick', e => {
    const t = e.target.closest('.tile');
    if (t && !e.target.closest('[data-rep]')) handlers.onOpen(t.dataset.id);
  });
  scroller.addEventListener('keydown', e => {
    if (!flat.length) return;
    const cur = ctx.anchor && indexOf.has(ctx.anchor) ? indexOf.get(ctx.anchor) : -1;
    let next = null;
    if (e.key === 'ArrowRight') next = cur + 1;
    else if (e.key === 'ArrowLeft') next = cur - 1;
    else if (e.key === 'ArrowDown') next = cur < 0 ? 0 : cur + cols;
    else if (e.key === 'ArrowUp') next = cur - cols;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = flat.length - 1;
    else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handlers.onSelection(flat.map(i => i.id), flat[0].id); return; }
    else if (e.key === 'Escape') { handlers.onSelection([], null); return; }
    else if (e.key === 'Enter' && cur >= 0) { handlers.onOpen(flat[cur].id); return; }
    else if (e.key === ' ' && ctx.selection?.size) { e.preventDefault(); handlers.onToggleReportMany([...ctx.selection]); return; }
    else if ((e.key === 'e' || e.key === 'E') && cur >= 0 && !e.ctrlKey && !e.metaKey) { handlers.onEdit(flat[cur].id); return; }
    if (next == null) return;
    e.preventDefault();
    next = Math.max(0, Math.min(flat.length - 1, next));
    const id = flat[next].id;
    if (e.shiftKey && ctx.anchor) {
      const sel = new Set(ctx.selection); sel.add(id); handlers.onSelection([...sel], id, true);
    } else handlers.onSelection([id], id);
    scrollToId(id);
  });

  // Drag & Drop
  let dragIds = null;
  scroller.addEventListener('dragstart', e => {
    const t = e.target.closest('.tile');
    if (!t) return;
    const id = t.dataset.id;
    dragIds = ctx.selection?.has(id) ? [...ctx.selection] : [id];
    if (!ctx.selection?.has(id)) handlers.onSelection([id], id);
    e.dataTransfer.setData('application/x-mb-images', JSON.stringify(dragIds));
    e.dataTransfer.effectAllowed = 'move';
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost'; ghost.textContent = dragIds.length === 1 ? '1 Bild' : `${dragIds.length} Bilder`;
    document.body.append(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 10);
    setTimeout(() => ghost.remove(), 0);
  });
  scroller.addEventListener('dragend', () => { dragIds = null; clearDrop(); });
  const clearDrop = () => spacer.querySelectorAll('.drop-l,.drop-r').forEach(n => n.classList.remove('drop-l', 'drop-r'));
  scroller.addEventListener('dragover', e => {
    if (!dragIds || !ctx.canReorder) return;
    const t = e.target.closest('.tile');
    clearDrop();
    if (!t || dragIds.includes(t.dataset.id)) return;
    e.preventDefault();
    const r = t.getBoundingClientRect();
    t.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-l' : 'drop-r');
  });
  scroller.addEventListener('drop', e => {
    if (!dragIds || !ctx.canReorder) return;
    const t = e.target.closest('.tile');
    if (!t) return;
    e.preventDefault();
    const after = t.classList.contains('drop-r');
    clearDrop();
    handlers.onReorder(dragIds, t.dataset.id, after);
  });

  function scrollToId(id) {
    const idx = indexOf.get(id);
    if (idx == null) return;
    // Zeile suchen
    for (const r of rows) {
      if (r.type === 't' && r.items.some(i => i.id === id)) {
        if (r.top < scroller.scrollTop) scroller.scrollTop = r.top - 8;
        else if (r.top + r.h > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = r.top + r.h - scroller.clientHeight + 8;
        break;
      }
    }
  }

  return {
    setData(newGroups, newCtx, { keepScroll = true } = {}) {
      groups = newGroups;
      flat = groups.flatMap(g => g.items);
      indexOf = new Map(flat.map((im, i) => [im.id, i]));
      ctx = newCtx;
      if (!keepScroll) scroller.scrollTop = 0;
      layout(); schedule(true);
    },
    setContext(newCtx) { ctx = newCtx; schedule(true); },
    setTileSize(px) { tile = px; layout(); schedule(true); },
    refresh() { schedule(true); },
    scrollToId,
    get order() { return flat; },
  };
}
MB['ui/gallery'] = { createGallery };
})();
