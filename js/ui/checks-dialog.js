// Modul: ui/checks-dialog
// Dialog „Vollständigkeit prüfen“: leere Ordner und Hinweise
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { el } = MB['util'];
const { modal } = MB['ui/dialogs'];

const TYPE_ICON = { 'empty': '📁', 'cmp-count': '⇄', 'cmp-unconfirmed': '?', 'cmp-folder': '⇄', 'notselected': '☐', 'problem': '⚠' };

/**
 * actions: { getResult(), gotoFolder(path, view), setIgnored(key, bool) }
 */
async function openChecksDialog(actions) {
  const body = el('div', { class: 'ck-dlg' });

  function render() {
    const r = actions.getResult();
    const close = () => body.closest('.modal')?.close?.(null);
    body.innerHTML = '';
    if (!r.active.length) {
      body.append(el('div', { class: 'ck-ok', html: '<div class="ck-big">✓</div><h3>Alles vollständig</h3><p class="muted">Kein Ordner ist leer.</p>' }));
    }
    const section = (title, list, cls, target = body) => {
      if (!list.length) return;
      const wrap = el('section', { class: `ck-sec ${cls}` }, el('h4', { text: `${title} (${list.length})` }));
      for (const it of list) {
        const where = it.path === '' ? r.nameOf('') : it.path;
        wrap.append(el('div', { class: `ck-item lv-${it.level} ${it.ignored ? 'ign' : ''}` },
          el('span', { class: 'ck-icon', text: TYPE_ICON[it.type] || '•' }),
          el('div', { class: 'ck-main' },
            el('div', { class: 'ck-title' }, el('b', { text: it.title }), where ? el('span', { class: 'ck-path', text: ' · ' + where }) : null),
            it.detail ? el('div', { class: 'ck-detail muted small', text: it.detail }) : null),
          el('div', { class: 'ck-act' },
            el('button', { class: 'btn xs ghost', text: 'Zum Ordner', onclick: () => { close(); actions.gotoFolder(it.path, it.type.startsWith('cmp') ? 'compare' : 'gallery'); } }),
            el('button', { class: 'btn xs ghost', text: it.ignored ? 'Wieder anzeigen' : 'Ignorieren', title: it.ignored ? '' : 'Diese Meldung für dieses Projekt ausblenden', onclick: () => { actions.setIgnored(it.key, !it.ignored); render(); } }))));
      }
      target.append(wrap);
    };
    section('Leere Ordner', r.active.filter(i => i.level === 'fehlt'), 'sec-missing');
    section('Hinweise', r.active.filter(i => i.level === 'hinweis'), 'sec-hint');
    const ign = r.issues.filter(i => i.ignored);
    if (ign.length) {
      const det = el('details', { class: 'ck-ignored' }, el('summary', { text: `Ignorierte Meldungen (${ign.length})` }));
      section('Ignoriert', ign, 'sec-ign', det);
      body.append(det);
    }
  }

  render();
  await modal({ title: 'Vollständigkeit prüfen', body, wide: true, buttons: [{ label: 'Schließen', class: 'primary', value: null }] });
}

MB['ui/checks-dialog'] = { openChecksDialog };
})();
