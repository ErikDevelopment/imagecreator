// Modul: ui/settings
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { el, escapeHtml } = MB['util'];
const { modal } = MB['ui/dialogs'];
const { DEFAULT_RULES, ROLES, CONFIDENCE, classifyName, normalizeName, validateRule } = MB['rules'];
// Einstellungen: Erkennungsregeln bearbeiten und testen

async function openRulesDialog(currentRules, general) {
  let rules = structuredClone(currentRules);
  const list = el('div', { class: 'rules' });
  const testInp = el('input', { type: 'text', placeholder: 'Ordnernamen testen, z. B. „02 Nachher“', class: 'full' });
  const testOut = el('div', { class: 'small rule-test' });
  const autoSel = el('input', { type: 'checkbox', checked: general.autoSelect !== false });

  function renderList() {
    list.innerHTML = '';
    list.append(el('div', { class: 'rule head' }, el('span', { text: 'Aktiv' }), el('span', { text: 'Bezeichnung' }), el('span', { text: 'Muster (regulärer Ausdruck)' }), el('span', { text: 'Bedeutung' }), el('span', { text: 'Sicherheit' }), el('span')));
    rules.forEach((r, idx) => {
      const err = el('div', { class: 'rule-err small' });
      const upd = (k, v) => { r[k] = v; err.textContent = validateRule(r) || ''; runTest(); };
      const en = el('input', { type: 'checkbox', checked: r.enabled }); en.onchange = () => upd('enabled', en.checked);
      const lab = el('input', { type: 'text', value: r.label }); lab.oninput = () => upd('label', lab.value);
      const pat = el('input', { type: 'text', value: r.pattern, class: 'mono' }); pat.oninput = () => upd('pattern', pat.value);
      const role = el('select', {}, ...Object.entries(ROLES).map(([k, v]) => el('option', { value: k, text: v.label }))); role.value = r.role; role.onchange = () => upd('role', role.value);
      const conf = el('select', {}, ...CONFIDENCE.map(c => el('option', { value: c, text: c }))); conf.value = r.confidence; conf.onchange = () => upd('confidence', conf.value);
      const delBtn = el('button', { class: 'icon-btn sm', title: 'Regel löschen', html: '&times;', onclick: () => { rules.splice(idx, 1); renderList(); runTest(); } });
      list.append(el('div', { class: 'rule' }, en, lab, pat, role, conf, delBtn), err);
    });
  }
  function runTest() {
    const v = testInp.value.trim();
    if (!v) { testOut.innerHTML = '<span class="muted">Ordnernamen eingeben, um die Erkennung zu prüfen.</span>'; return; }
    const r = classifyName(v, rules);
    testOut.innerHTML = `Normalisiert: <code>${escapeHtml(normalizeName(v))}</code> → ` + (r ? `<b>${ROLES[r.role].label}</b> <span class="conf conf-${r.confidence}">${r.confidence}</span> <span class="muted">(Regel „${escapeHtml(r.ruleLabel)}“)</span>` : '<b>keine Rolle</b> – wird als eigener Dokumentationspunkt / Untergruppe behandelt');
  }
  testInp.addEventListener('input', runTest);
  renderList(); runTest();

  const body = el('div', { class: 'settings' },
    el('p', { class: 'muted', html: `Diese Regeln bestimmen, welche <b>Unterordner</b> als Vorher, Nachher, räumliche Unterteilung oder Perspektive verstanden werden.
      Ordnernamen werden vor dem Vergleich normalisiert: Kleinschreibung, führende/abschließende Nummern entfernt („01_Vorher“, „Vorher 2“ → „vorher“), „_“ und „-“ als Leerzeichen.
      Treffer mit Sicherheit <b>unklar</b> werden angezeigt, aber erst nach Bestätigung im Bericht als Vergleich verwendet. Alle anderen Ordner behalten ihren Namen als Überschrift.` }),
    list,
    el('div', { class: 'd-actions' },
      el('button', { class: 'btn sm ghost', text: '+ Regel hinzufügen', onclick: () => { rules.push({ id: 'r-' + Date.now(), label: 'Neue Regel', pattern: '^(beispiel)$', role: 'before', confidence: 'wahrscheinlich', enabled: true }); renderList(); } }),
      el('button', { class: 'btn sm ghost', text: 'Standardregeln wiederherstellen', onclick: () => { rules = structuredClone(DEFAULT_RULES); renderList(); runTest(); } })),
    el('h4', { text: 'Regeln testen' }), testInp, testOut,
    el('h4', { text: 'Allgemein' }),
    el('label', { class: 'check' }, autoSel, ' Beim Einlesen alle Bilder automatisch für den Bericht auswählen'));

  const res = await modal({
    title: 'Erkennungsregeln', body, wide: true,
    buttons: [{ label: 'Abbrechen', value: null, class: 'ghost' }, {
      label: 'Speichern und anwenden', class: 'primary', value: 'ok',
      onClick: () => {
        const bad = rules.map(validateRule).find(Boolean);
        if (bad) { alertInline(body, bad); return false; }
      },
    }],
  });
  if (res !== 'ok') return null;
  return { rules, general: { autoSelect: autoSel.checked } };
}

function alertInline(body, msg) {
  let n = body.querySelector('.inline-alert');
  if (!n) { n = el('div', { class: 'notice warn inline-alert' }); body.prepend(n); }
  n.textContent = msg;
}
MB['ui/settings'] = { openRulesDialog };
})();
