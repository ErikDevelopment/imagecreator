// Modul: ui/dialogs
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { el, escapeHtml } = MB['util'];
// Modale Dialoge, Bestätigungen, Hinweise

const root = () => document.getElementById('modalRoot');

function modal({ title, body, buttons = [], wide = false, full = false, onClose, className = '' }) {
  return new Promise(resolve => {
    const backdrop = el('div', { class: 'modal-backdrop' });
    const box = el('div', { class: `modal ${wide ? 'wide' : ''} ${full ? 'full' : ''} ${className}`, role: 'dialog', 'aria-modal': 'true' });
    const head = el('div', { class: 'modal-head' }, el('h3', { text: title || '' }), el('button', { class: 'icon-btn', 'aria-label': 'Schließen', onclick: () => close(null), html: '&times;' }));
    const content = el('div', { class: 'modal-body' });
    if (typeof body === 'string') content.innerHTML = body; else if (body) content.append(body);
    const foot = el('div', { class: 'modal-foot' });
    for (const b of buttons) {
      const btn = el('button', { class: 'btn ' + (b.class || ''), text: b.label });
      btn.addEventListener('click', async () => {
        if (b.onClick) { const r = await b.onClick(content, btn); if (r === false) return; }
        close(b.value ?? b.label);
      });
      foot.append(btn);
    }
    box.append(head, content);
    if (buttons.length) box.append(foot);
    backdrop.append(box);
    root().append(backdrop);
    const onKey = e => {
      if (e.key !== 'Escape') return;
      // nur der oberste Dialog reagiert
      const all = root().querySelectorAll('.modal-backdrop');
      if (all[all.length - 1] !== backdrop) return;
      e.stopPropagation(); e.preventDefault(); close(null);
    };
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) backdrop.dataset.down = '1'; });
    backdrop.addEventListener('mouseup', e => { if (e.target === backdrop && backdrop.dataset.down) close(null); delete backdrop.dataset.down; });
    function close(v) {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      onClose?.(v);
      resolve(v);
    }
    box.close = close;
    setTimeout(() => (box.querySelector('[autofocus]') || foot.querySelector('.primary') || box).focus?.(), 30);
  });
}

async function confirmDialog(title, text, { ok = 'OK', cancel = 'Abbrechen', danger = false } = {}) {
  const r = await modal({ title, body: `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`, buttons: [{ label: cancel, value: false, class: 'ghost' }, { label: ok, value: true, class: danger ? 'danger' : 'primary' }] });
  return r === true;
}

async function promptDialog(title, label, value = '') {
  const inp = el('input', { type: 'text', value, class: 'full', autofocus: true });
  const body = el('div', {}, el('label', { class: 'field' }, el('span', { text: label }), inp));
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') body.closest('.modal').querySelector('.modal-foot .primary').click(); });
  const r = await modal({ title, body, buttons: [{ label: 'Abbrechen', value: null, class: 'ghost' }, { label: 'Übernehmen', class: 'primary', value: '__ok' }] });
  return r === '__ok' ? inp.value : null;
}

function toast(msg, { type = 'info', action, actionLabel, timeout = 4500 } = {}) {
  const t = el('div', { class: `toast ${type}` }, el('span', { text: msg }));
  if (action) t.append(el('button', { class: 'btn sm ghost', text: actionLabel || 'Rückgängig', onclick: () => { action(); t.remove(); } }));
  document.getElementById('toastRoot').append(t);
  setTimeout(() => t.classList.add('out'), timeout);
  setTimeout(() => t.remove(), timeout + 400);
}

// Fortschrittsanzeige als Modal
function progressDialog(title) {
  const bar = el('div', { class: 'pbar' }, el('i'));
  const txt = el('div', { class: 'muted small ptext', text: 'Vorbereitung …' });
  const body = el('div', { class: 'progress-body' }, bar, txt);
  let closeFn;
  const p = modal({ title, body, className: 'progress-modal' });
  setTimeout(() => { closeFn = body.closest('.modal')?.close; }, 0);
  return {
    update(frac, text) {
      if (frac != null) bar.firstChild.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
      bar.classList.toggle('indeterminate', frac == null);
      if (text) txt.textContent = text;
    },
    close() { (closeFn || body.closest('.modal')?.close)?.(null); },
    done: p,
  };
}
MB['ui/dialogs'] = { modal, confirmDialog, promptDialog, toast, progressDialog };
})();
