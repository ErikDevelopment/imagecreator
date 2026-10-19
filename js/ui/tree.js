// Modul: ui/tree
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { escapeHtml } = MB['util'];
const { ROLES } = MB['rules'];
// Verzeichnisbaum mit Zählern, Rollen-Kennzeichnung, Auf-/Zuklappen, Drag & Drop

function createTree(container, { getModel, getState, onSelect, onToggle, onDropImages, onMoveFolder }) {
  let filter = '';

  function render() {
    const model = getModel();
    const st = getState();
    if (!model) { container.innerHTML = ''; return; }
    const f = filter.trim().toLowerCase();
    // Bei Filter: Pfade, die passen, inkl. Vorfahren anzeigen
    let visible = null;
    if (f) {
      visible = new Set();
      for (const [path, i] of model.info) {
        if (i.folder.name.toLowerCase().includes(f) || path.toLowerCase().includes(f)) {
          let p = path;
          while (p != null) { visible.add(p); p = model.info.get(p)?.folder.parentPath ?? null; }
        }
      }
    }
    const out = [];
    const walk = (path, depth) => {
      const i = model.info.get(path);
      if (!i) return;
      if (visible && !visible.has(path)) return;
      const fo = i.folder;
      const hasKids = i.children.length > 0;
      const collapsed = !f && st.collapsed.has(path);
      const sel = st.folder === path;
      const badges = [];
      if (i.compare) badges.push(`<span class="chip vn ${i.compare.enabled ? '' : 'off'}" title="Vorher/Nachher-Gruppe (${i.compare.confidence})${i.compare.enabled ? '' : ' – noch nicht bestätigt'}">V|N${i.compare.confidence !== 'sicher' ? '?' : ''}</span>`);
      if (i.kind === 'role') badges.push(`<span class="chip role-${i.role} ${i.confidence !== 'sicher' ? 'unsure' : ''}" title="${escapeHtml(i.source || '')}">${ROLES[i.role].label}${i.confidence !== 'sicher' ? '?' : ''}</span>`);
      if (fo.missingOnDisk) badges.push('<span class="chip warn" title="Ordner beim letzten Einlesen nicht mehr gefunden">fehlt</span>');
      if (!fo.includeInReport) badges.push('<span class="chip off" title="Nicht im Bericht">ausgeblendet</span>');
      const counts = `<span class="cnt" title="${i.direct} Bilder direkt, ${i.total} insgesamt, ${i.subCount} Unterordner">${i.direct !== i.total ? `${i.direct}<em>/${i.total}</em>` : i.total}${i.subCount ? `<b>▸${i.subCount}</b>` : ''}</span>`;
      const kindCls = i.kind === 'docpoint' ? 'dp' : i.kind;
      out.push(`<div class="tnode ${sel ? 'sel' : ''} ${i.empty ? 'empty' : ''} k-${kindCls}" role="treeitem" aria-selected="${sel}" data-path="${escapeHtml(path)}" style="--d:${depth}" draggable="${path !== ''}" title="${escapeHtml(path || fo.name)}">
        <span class="twisty ${hasKids ? '' : 'none'}" data-twisty>${hasKids ? (collapsed ? '▸' : '▾') : ''}</span>
        <span class="ticon">${icon(i)}</span>
        <span class="tname">${escapeHtml(fo.reportTitle && fo.reportTitle !== fo.name ? fo.name : fo.name)}</span>
        ${badges.join('')}${counts}
      </div>`);
      if (hasKids && !collapsed) for (const c of i.children) walk(c.path, depth + 1);
    };
    walk('', 0);
    container.innerHTML = out.join('');
    container.querySelector('.tnode.sel')?.scrollIntoView({ block: 'nearest' });
  }

  function icon(i) {
    if (i.kind === 'root') return '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="2.5" fill="currentColor" opacity=".9"/></svg>';
    if (i.empty) return '<svg viewBox="0 0 16 16"><path d="M1.5 4.5a1 1 0 0 1 1-1h3.3l1.4 1.5h6.3a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-dasharray="2 1.5"/></svg>';
    return '<svg viewBox="0 0 16 16"><path d="M1.5 4.5a1 1 0 0 1 1-1h3.3l1.4 1.5h6.3a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="currentColor"/></svg>';
  }

  container.addEventListener('click', e => {
    const n = e.target.closest('.tnode');
    if (!n) return;
    const path = n.dataset.path;
    if (e.target.closest('[data-twisty]')) { onToggle(path); return; }
    onSelect(path);
  });
  container.addEventListener('dblclick', e => {
    const n = e.target.closest('.tnode');
    if (n && !e.target.closest('[data-twisty]')) onToggle(n.dataset.path);
  });

  // Drag & Drop: Bilder auf Ordner (virtuelle Zuordnung) oder Ordner unter Geschwistern verschieben
  let dragFolder = null;
  container.addEventListener('dragstart', e => {
    const n = e.target.closest('.tnode');
    if (!n) return;
    dragFolder = n.dataset.path;
    e.dataTransfer.setData('application/x-mb-folder', dragFolder);
    e.dataTransfer.effectAllowed = 'move';
  });
  container.addEventListener('dragend', () => { dragFolder = null; clearMarks(); });
  const clearMarks = () => container.querySelectorAll('.drop-in,.drop-before,.drop-after').forEach(x => x.classList.remove('drop-in', 'drop-before', 'drop-after'));
  container.addEventListener('dragover', e => {
    const n = e.target.closest('.tnode');
    if (!n) return;
    const types = e.dataTransfer.types;
    clearMarks();
    if (types.includes('application/x-mb-images')) { e.preventDefault(); n.classList.add('drop-in'); e.dataTransfer.dropEffect = 'move'; }
    else if (types.includes('application/x-mb-folder') && dragFolder != null) {
      const model = getModel();
      const a = model.info.get(dragFolder)?.folder, b = model.info.get(n.dataset.path)?.folder;
      if (a && b && a.parentPath === b.parentPath && a.path !== b.path) {
        e.preventDefault();
        const r = n.getBoundingClientRect();
        n.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
      }
    }
  });
  container.addEventListener('dragleave', e => { if (!container.contains(e.relatedTarget)) clearMarks(); });
  container.addEventListener('drop', e => {
    const n = e.target.closest('.tnode');
    if (!n) return;
    e.preventDefault();
    const before = n.classList.contains('drop-before');
    clearMarks();
    const imgs = e.dataTransfer.getData('application/x-mb-images');
    if (imgs) { onDropImages(JSON.parse(imgs), n.dataset.path); return; }
    const fp = e.dataTransfer.getData('application/x-mb-folder');
    if (fp) onMoveFolder(fp, n.dataset.path, before);
  });

  return { render, setFilter(v) { filter = v; render(); } };
}
MB['ui/tree'] = { createTree };
})();
