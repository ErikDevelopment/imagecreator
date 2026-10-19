// Modul: ui/compare
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { el, escapeHtml } = MB['util'];
const { requestThumb, cachedThumb } = MB['thumbs'];
const { ROLES } = MB['rules'];
// Vorher/Nachher-Ansicht: Gruppen nebeneinander, manuelle Verknüpfung, Lösen, Umsortieren

function createCompareView(container, { getModel, saveCompare, openPair, openImage, selectImage, gotoFolder }) {
  let pick = null; // { side:'b'|'a', id, host }
  let size = 170;
  const io = new IntersectionObserver(entries => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const node = en.target;
      io.unobserve(node);
      const im = getModel()?.imageById.get(node.dataset.img);
      if (!im) continue;
      const u = requestThumb(im, url => { if (url) node.style.backgroundImage = `url("${url}")`; else node.classList.add('nothumb'); }, 2);
      if (u) node.style.backgroundImage = `url("${u}")`;
    }
  }, { root: container, rootMargin: '300px' });

  function render(scopePath) {
    const model = getModel();
    container.innerHTML = '';
    if (!model) return;
    // Gruppen im aktuellen Bereich (Ordner selbst, sein übergeordneter Ordner bei Rollenordnern, sonst alle darunter)
    let hosts = [];
    const info = model.info.get(scopePath);
    if (info?.compare) hosts = [scopePath];
    else if (info?.kind === 'role' && model.info.get(info.folder.parentPath)?.compare) hosts = [info.folder.parentPath];
    else {
      const pref = scopePath ? scopePath + '/' : '';
      for (const [h] of model.compares) if (scopePath === '' || h === scopePath || h.startsWith(pref)) hosts.push(h);
      // in Baum-Reihenfolge sortieren
      const order = new Map(); let k = 0;
      const walk = p => { order.set(p, k++); for (const c of model.info.get(p).children) walk(c.path); };
      walk('');
      hosts.sort((a, b) => order.get(a) - order.get(b));
    }
    const head = el('div', { class: 'cmp-top' },
      el('span', { class: 'muted', text: hosts.length ? `${hosts.length} Vorher/Nachher-Gruppe${hosts.length > 1 ? 'n' : ''} in diesem Bereich` : '' }),
      el('div', { class: 'toolbar-spacer' }),
      el('label', { class: 'small muted', text: 'Bildgröße ' }),
      Object.assign(el('input', { type: 'range', min: 100, max: 320, value: size }), { oninput: e => { size = +e.target.value; container.style.setProperty('--cs', size + 'px'); } }));
    container.style.setProperty('--cs', size + 'px');
    container.append(head);
    if (!hosts.length) {
      container.append(el('div', { class: 'empty-state', html: `<h3>Keine Vorher/Nachher-Gruppe in diesem Bereich</h3>
        <p>Eine Gruppe entsteht automatisch, wenn ein Ordner Unterordner wie <b>Vorher</b> und <b>Nachher</b> enthält.
        Abweichende Namen können in den <b>Erkennungsregeln</b> ergänzt oder je Ordner in den Ordnerdetails (rechts) als Vorher/Nachher festgelegt werden.</p>` }));
      return;
    }
    for (const h of hosts) container.append(renderGroup(model, model.compares.get(h)));
    container.querySelectorAll('[data-img]').forEach(n => {
      const im = model.imageById.get(n.dataset.img);
      const u = im && cachedThumb(im);
      if (u) n.style.backgroundImage = `url("${u}")`; else io.observe(n);
    });
  }

  function renderGroup(model, g) {
    const f = model.info.get(g.hostPath).folder;
    const nameOf = paths => paths.map(p => model.info.get(p).folder.name).join(', ');
    const unsure = g.confidence !== 'sicher';
    const modeSel = el('select', { title: 'Darstellung im Word-Bericht' },
      el('option', { value: 'pairs', text: 'Bericht: paarweise Zeilen' }),
      el('option', { value: 'groups', text: 'Bericht: Gruppen gegenüber' }),
      el('option', { value: 'separate', text: 'Bericht: getrennt darstellen' }));
    modeSel.value = g.mode;
    modeSel.onchange = () => saveCompare(g.hostPath, { mode: modeSel.value });
    const enable = el('input', { type: 'checkbox', checked: g.enabled });
    enable.onchange = () => saveCompare(g.hostPath, { enabled: enable.checked, userSet: true });
    const box = el('section', { class: `cmp-group ${g.enabled ? '' : 'disabled'}`, dataset: { host: g.hostPath } },
      el('header', { class: 'cmp-head' },
        el('div', {},
          el('a', { class: 'cmp-title', href: '#', text: f.name, onclick: e => { e.preventDefault(); gotoFolder(g.hostPath); } }),
          el('div', { class: 'muted small', text: (g.hostPath || '(Projektordner)') })),
        el('div', { class: 'toolbar-spacer' }),
        el('span', { class: `conf conf-${g.confidence}`, title: 'Sicherheit der Erkennung', text: `Erkennung: ${g.confidence}` }),
        el('span', { class: 'chip', title: 'Zuordnungsart', text: g.manual ? 'manuell angepasst' : 'nach ursprünglicher Reihenfolge' }),
        el('label', { class: 'check', title: 'Im Bericht als Vergleich darstellen' }, enable, ' Vergleich aktiv'),
        modeSel,
        el('button', { class: 'btn ghost sm', text: 'Neu nach Reihenfolge', title: 'Manuelle Zuordnungen verwerfen und nach ursprünglicher Reihenfolge paaren', disabled: !g.manual, onclick: () => saveCompare(g.hostPath, { manual: false, rows: null }) }),
        el('button', { class: 'btn ghost sm', text: 'Vollbild', onclick: () => openPair(g, 0) })));
    if (unsure && !g.enabled) {
      box.append(el('div', { class: 'cmp-note', html: `Die Ordner <b>${escapeHtml(nameOf(g.beforeFolders))}</b> und <b>${escapeHtml(nameOf(g.afterFolders))}</b> wurden nur <b>${g.confidence}</b> als Vorher/Nachher erkannt. Bitte prüfen und „Vergleich aktiv“ setzen, wenn die Zuordnung stimmt.` }));
    }
    const grid = el('div', { class: 'cmp-grid' },
      el('div', { class: 'cmp-colhead before', html: `Vorher <span>${escapeHtml(nameOf(g.beforeFolders))} · ${g.beforeImgs.length}</span>` }),
      el('div', { class: 'cmp-colhead mid' }),
      el('div', { class: 'cmp-colhead after', html: `Nachher <span>${escapeHtml(nameOf(g.afterFolders))} · ${g.afterImgs.length}</span>` }));
    g.rows.forEach((r, i) => {
      const b = r.b && model.imageById.get(r.b), a = r.a && model.imageById.get(r.a);
      const both = b && a;
      grid.append(
        cell(g, i, 'b', b, !both),
        el('div', { class: 'cmp-mid', dataset: { row: i } },
          el('span', { class: 'drag-handle', draggable: 'true', title: 'Zeile ziehen, um Reihenfolge zu ändern', text: '⋮⋮' }),
          both ? el('span', { class: `link ${r.manual ? 'man' : 'auto'}`, title: r.manual ? 'Manuell verknüpft' : 'Automatisch nach Reihenfolge gepaart', text: '⟷' }) : el('span', { class: 'link none', title: 'Kein Gegenstück', text: '∅' }),
          both ? el('button', { class: 'btn ghost xs', text: 'Lösen', title: 'Verknüpfung lösen', onclick: () => unlink(g, i) }) : null,
          both ? el('button', { class: 'btn ghost xs', text: 'Groß', onclick: () => openPair(g, i) }) : null),
        cell(g, i, 'a', a, !both));
    });
    box.append(grid);
    if (pick && pick.host === g.hostPath) box.append(el('div', { class: 'cmp-pickhint', text: `Ausgewählt: ${model.imageById.get(pick.id)?.name}. Jetzt ein Bild der ${pick.side === 'b' ? 'Nachher' : 'Vorher'}-Spalte anklicken, um zu verknüpfen (Esc bricht ab).` }));
    return box;
  }

  function cell(g, row, side, im, unpaired) {
    if (!im) return el('div', { class: 'cmp-cell empty', dataset: { row, side } }, el('span', { text: '— kein Bild —' }));
    const picked = pick && pick.id === im.id;
    return el('div', { class: `cmp-cell ${picked ? 'picked' : ''} ${unpaired ? 'unpaired' : ''} ${im.selected ? '' : 'notrep'}`, dataset: { row, side, id: im.id }, draggable: 'true' },
      el('div', { class: 'cthumb', dataset: { img: im.id } }),
      el('div', { class: 'cname', title: im.relPath, text: im.name }),
      unpaired ? el('span', { class: 'b np', title: 'Ohne Gegenstück', text: 'ohne Gegenstück' }) : null);
  }

  // ---- Aktionen ----
  const rowsOf = g => g.rows.map(r => ({ b: r.b, a: r.a, manualLink: !!r.manual }));
  function unlink(g, i) {
    const rows = rowsOf(g);
    const r = rows[i];
    rows.splice(i, 1, { b: r.b, a: null }, { b: null, a: r.a });
    saveCompare(g.hostPath, { manual: true, rows });
  }
  function link(g, bId, aId) {
    let rows = rowsOf(g);
    const bi = rows.findIndex(r => r.b === bId), ai = rows.findIndex(r => r.a === aId);
    const pos = Math.min(bi, ai);
    rows[bi].b = null; rows[ai].a = null;
    rows.splice(pos, 0, { b: bId, a: aId, manualLink: true });
    rows = rows.filter(r => r.b || r.a);
    saveCompare(g.hostPath, { manual: true, rows });
  }
  function swapCells(g, side, i, j) {
    const rows = rowsOf(g);
    [rows[i][side], rows[j][side]] = [rows[j][side], rows[i][side]];
    rows[i].manualLink = rows[j].manualLink = true;
    saveCompare(g.hostPath, { manual: true, rows: rows.filter(r => r.b || r.a) });
  }
  function moveRow(g, from, to) {
    const rows = rowsOf(g);
    const [r] = rows.splice(from, 1);
    rows.splice(to > from ? to - 1 : to, 0, r);
    saveCompare(g.hostPath, { manual: true, rows });
  }

  container.addEventListener('click', e => {
    const c = e.target.closest('.cmp-cell');
    if (!c || !c.dataset.id) return;
    const host = c.closest('.cmp-group').dataset.host;
    const g = getModel().compares.get(host);
    const side = c.dataset.side, id = c.dataset.id;
    selectImage(id);
    if (pick && pick.host === host && pick.side !== side) {
      const bId = side === 'b' ? id : pick.id, aId = side === 'a' ? id : pick.id;
      pick = null;
      link(g, bId, aId);
      return;
    }
    pick = (pick && pick.id === id) ? null : { side, id, host };
    render(currentScope);
  });
  container.addEventListener('dblclick', e => {
    const c = e.target.closest('.cmp-cell');
    if (c?.dataset.id) openImage(c.dataset.id);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && pick && !container.hidden) { pick = null; render(currentScope); } });

  // Drag & Drop: Zelle auf Zelle (gleiche Spalte) = tauschen; Zeilengriff = Zeile verschieben
  let drag = null;
  container.addEventListener('dragstart', e => {
    const h = e.target.closest('.drag-handle');
    const c = e.target.closest('.cmp-cell');
    const grp = e.target.closest('.cmp-group');
    if (!grp) return;
    if (h) drag = { kind: 'row', host: grp.dataset.host, row: +h.parentElement.dataset.row };
    else if (c?.dataset.id) drag = { kind: 'cell', host: grp.dataset.host, row: +c.dataset.row, side: c.dataset.side };
    else return;
    e.dataTransfer.setData('text/plain', 'cmp');
    e.dataTransfer.effectAllowed = 'move';
  });
  container.addEventListener('dragend', () => { drag = null; clear(); });
  const clear = () => container.querySelectorAll('.dropt').forEach(n => n.classList.remove('dropt'));
  container.addEventListener('dragover', e => {
    if (!drag) return;
    const grp = e.target.closest('.cmp-group');
    if (!grp || grp.dataset.host !== drag.host) return;
    clear();
    if (drag.kind === 'cell') {
      const c = e.target.closest('.cmp-cell');
      if (c && c.dataset.side === drag.side && +c.dataset.row !== drag.row) { e.preventDefault(); c.classList.add('dropt'); }
    } else {
      const m = e.target.closest('.cmp-mid, .cmp-cell');
      if (m) { e.preventDefault(); grp.querySelectorAll(`[data-row="${m.dataset.row}"]`).forEach(n => n.classList.add('dropt')); }
    }
  });
  container.addEventListener('drop', e => {
    if (!drag) return;
    const grp = e.target.closest('.cmp-group');
    const g = grp && getModel().compares.get(grp.dataset.host);
    clear();
    if (!g) return;
    e.preventDefault();
    const t = e.target.closest('.cmp-cell, .cmp-mid');
    if (!t) return;
    const to = +t.dataset.row;
    if (drag.kind === 'cell') swapCells(g, drag.side, drag.row, to);
    else if (to !== drag.row) moveRow(g, drag.row, to > drag.row ? to + 1 : to);
    drag = null;
  });

  let currentScope = '';
  return { render(scope) { currentScope = scope; render(scope); }, clearPick() { pick = null; } };
}
MB['ui/compare'] = { ROLES, createCompareView };
})();
