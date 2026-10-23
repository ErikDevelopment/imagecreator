// Modul: ui/report-dialog
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { el, escapeHtml, saveBlob, safeFileName } = MB['util'];
const { modal, progressDialog, toast } = MB['ui/dialogs'];
const { buildOutline, generateReport } = MB['report'];
const { state, saveProject, filesAvailable } = MB['project'];
// Dialog zur Berichtserstellung: Kopfdaten, Optionen, Gliederungsvorschau, Export

async function openReportDialog(model, scopePath) {
  const p = state.project;
  const s = { ...p.report };
  if (s.showFileComments === undefined) s.showFileComments = true;   // ältere Projekte
  if (s.captionVersion !== 2) { s.caption = 'top'; s.captionVersion = 2; }   // neue Standard-Beschriftung
  const f = (key, label, type = 'text', extra = {}) => {
    const inp = type === 'textarea' ? el('textarea', { rows: 3, ...extra }) : el('input', { type, ...extra });
    inp.value = s[key] ?? '';
    inp.addEventListener('input', () => { s[key] = inp.value; });
    return el('label', { class: 'field' }, el('span', { text: label }), inp);
  };
  const sel = (key, label, opts) => {
    const x = el('select', {}, ...opts.map(([v, t]) => el('option', { value: v, text: t })));
    x.value = String(s[key]);
    x.addEventListener('change', () => { s[key] = x.value; renderOutline(); });
    return el('label', { class: 'field' }, el('span', { text: label }), x);
  };
  const chk = (key, label) => {
    const x = el('input', { type: 'checkbox', checked: !!s[key] });
    x.addEventListener('change', () => { s[key] = x.checked; renderOutline(); });
    return el('label', { class: 'check' }, x, ' ' + label);
  };
  let scope = scopePath;
  const scopeSel = el('select', {},
    el('option', { value: '', text: 'Gesamtes Projekt' }),
    scopePath ? el('option', { value: scopePath, text: 'Nur ausgewählter Ordner: ' + model.info.get(scopePath).folder.name }) : null);
  scopeSel.value = '';
  scope = '';
  scopeSel.onchange = () => { scope = scopeSel.value; renderOutline(); };

  const logoInp = el('input', { type: 'file', accept: 'image/png,image/jpeg' });
  const logoPrev = el('div', { class: 'logo-prev' });
  const showLogo = () => { logoPrev.innerHTML = s.logo ? `<img src="${s.logo}" alt="Logo"><button class="btn xs ghost" type="button">entfernen</button>` : '<span class="muted small">kein Logo</span>'; logoPrev.querySelector('button')?.addEventListener('click', () => { s.logo = null; showLogo(); }); };
  logoInp.onchange = async () => {
    const file = logoInp.files[0]; if (!file) return;
    if (file.size > 2e6) { toast('Logo bitte kleiner als 2 MB wählen.', { type: 'warn' }); return; }
    s.logo = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
    showLogo();
  };
  showLogo();

  const outline = el('div', { class: 'outline' });
  const outlineInfo = el('div', { class: 'small muted' });
  function renderOutline() {
    const o = buildOutline(model, s, scope);
    if (!o.root) { outline.innerHTML = '<p class="warn-t">Keine Inhalte – bitte Bilder für den Bericht auswählen.</p>'; outlineInfo.textContent = ''; return; }
    const lines = [];
    const walk = n => {
      if (n !== o.root) {
        const imgs = n.images.length + (n.compare ? n.compare.before.length + n.compare.after.length : 0);
        lines.push(`<div class="ol" style="--l:${n.level}"><span class="oln">${s.numbering ? escapeHtml(n.number) : ''}</span><span class="olt">${escapeHtml(n.title)}${n.title !== n.original ? ` <span class="muted small">(Ordner: ${escapeHtml(n.original)})</span>` : ''}</span>${n.compare ? `<span class="chip vn">V|N ${n.compare.before.length}:${n.compare.after.length}</span>` : ''}${imgs ? `<span class="olc">${imgs}</span>` : ''}</div>`);
      } else if (n.images.length) lines.push(`<div class="ol" style="--l:1"><span class="olt">${escapeHtml(n.title)} (Bilder im Projektordner)</span><span class="olc">${n.images.length}</span></div>`);
      n.children.forEach(walk);
    };
    walk(o.root);
    outline.innerHTML = lines.join('');
    outlineInfo.textContent = `${o.imageCount} Abbildungen werden exportiert.`;
    // Sehr große Berichte belasten den Arbeitsspeicher (z. B. MacBook Air) → kompakte Qualität empfehlen
    if (o.imageCount > 250 && s.quality !== 'kompakt') outlineInfo.innerHTML += ` <span class="warn-t">Bei so vielen Bildern „Bildqualität: Kompakt“ wählen – kleinere Datei, weniger Arbeitsspeicher.</span>`;
  }
  renderOutline();

  const avail = filesAvailable();
  const body = el('div', { class: 'report-dlg' },
    el('div', { class: 'rd-cols' },
      el('div', { class: 'rd-form' },
        el('h4', { text: 'Deckblatt' }),
        f('title', 'Titel'), f('subtitle', 'Untertitel / Projekt'),
        el('div', { class: 'row2' }, f('customer', 'Auftraggeber / Kunde'), f('site', 'Standort')),
        el('div', { class: 'row2' }, f('plant', 'Anlage'), f('orderNo', 'Auftragsnummer')),
        el('div', { class: 'row2' }, f('technician', 'Ausgeführt von'), f('date', 'Datum')),
        f('intro', 'Einleitung / Zusammenfassung', 'textarea'),
        el('label', { class: 'field' }, el('span', { text: 'Firmenlogo (optional)' }), logoInp, logoPrev),
        el('h4', { text: 'Darstellung' }),
        el('div', { class: 'row2' },
          sel('perRow', 'Bilder pro Zeile', [['1', '1 (groß)'], ['2', '2'], ['3', '3 (kompakt)']]),
          sel('caption', 'Bildunterschrift', [['top', 'Bild 1: Ordner / Unterordner (fortlaufend)'], ['top+file', 'Bild 1 / Ordner / Unterordner / Dateiname'], ['filename', 'Dateiname'], ['caption', 'Beschriftung (sonst Dateiname)'], ['both', 'Beschriftung + Dateiname'], ['none', 'keine']])),
        el('div', { class: 'row2' },
          sel('quality', 'Bildqualität', [['kompakt', 'Kompakt (kleine Datei)'], ['standard', 'Standard'], ['hoch', 'Hoch (große Datei)']]),
          sel('pageOrientation', 'Seitenformat', [['portrait', 'A4 Hochformat'], ['landscape', 'A4 Querformat']])),
        chk('includeToc', 'Inhaltsverzeichnis'), chk('numbering', 'Kapitelnummern (1, 1.1, …)'),
        chk('onlySelected', 'Nur für den Bericht ausgewählte Bilder'), chk('skipEmpty', 'Leere Ordner auslassen'),
        chk('showPath', 'Ordnerpfad unter Überschrift anzeigen'), chk('showOriginalName', 'Originalordnername anzeigen, wenn Überschrift geändert wurde'),
        chk('includeImageNotes', 'Interne Bildnotizen unter Bildern ausgeben'),
        chk('showFileComments', 'Kommentare aus .txt-Dateien unter den Überschriften'),
      ),
      el('div', { class: 'rd-outline' },
        el('label', { class: 'field' }, el('span', { text: 'Umfang' }), scopeSel),
        el('h4', { text: 'Gliederung (aus der Ordnerstruktur)' }), outlineInfo, outline,
        el('p', { class: 'small muted', text: 'Vorher/Nachher-Gruppen erscheinen als zweispaltige Tabelle. Die Darstellung pro Gruppe (paarweise, gegenübergestellt oder getrennt) wird in der Vorher/Nachher-Ansicht festgelegt.' }))));
  const ck = MB['checks'].runChecks(model, p);
  if (ck.missing) {
    const n = el('div', { class: 'notice warn ck-notice' },
      el('span', { html: `<b>⚠ ${ck.missing} leere${ck.missing > 1 ? '' : 'r'} Ordner:</b> ` + escapeHtml(ck.active.filter(i => i.level === 'fehlt').slice(0, 5).map(i => i.path).join(' · ')) + (ck.missing > 5 ? ' …' : '') }),
      el('button', { class: 'btn xs ghost', text: 'Jetzt prüfen', onclick: () => { body.closest('.modal')?.close?.(null); window.dispatchEvent(new Event('mb:show-checks')); } }));
    body.prepend(n);
  }
  if (!avail) body.prepend(el('div', { class: 'notice warn', text: 'Die Originalbilder sind derzeit nicht erreichbar. Bitte zuerst „Ordner erneut verbinden“ – sonst enthält der Bericht Platzhalter statt Bildern.' }));

  const res = await modal({ title: 'Word-Bericht erstellen', body, wide: true, buttons: [{ label: 'Abbrechen', value: null, class: 'ghost' }, { label: 'Einstellungen speichern', value: 'save', class: 'ghost' }, { label: 'DOCX erzeugen', value: 'go', class: 'primary' }] });
  if (!res) return;
  p.report = { ...s, perRow: +s.perRow };
  await saveProject();
  if (res !== 'go') { toast('Berichtseinstellungen gespeichert.'); return; }

  const prog = progressDialog('Bericht wird erstellt');
  try {
    const { blob, warnings, imageCount } = await generateReport(model, p.report, scope, (fr, t) => prog.update(fr, t));
    prog.close();
    const name = safeFileName(`${s.title || 'Montagebericht'} ${s.subtitle || p.name} ${new Date().toISOString().slice(0, 10)}`) + '.docx';
    await saveBlob(blob, name, [{ description: 'Word-Dokument', accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] } }]);
    if (warnings.length) {
      modal({ title: 'Bericht erstellt – mit Hinweisen', body: `<p>${imageCount} Abbildungen exportiert. Folgende Bilder konnten nicht eingefügt werden und erscheinen als Platzhalter:</p><ul class="warnlist">${warnings.slice(0, 50).map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>${warnings.length > 50 ? `<p>… und ${warnings.length - 50} weitere.</p>` : ''}`, buttons: [{ label: 'OK', class: 'primary' }] });
    } else toast(`Bericht mit ${imageCount} Abbildungen erstellt.`, { type: 'ok' });
  } catch (e) {
    prog.close();
    console.error(e);
    modal({ title: 'Fehler beim Erstellen', body: `<p>${escapeHtml(e.message || String(e))}</p>`, buttons: [{ label: 'OK', class: 'primary' }] });
  }
}
MB['ui/report-dialog'] = { openReportDialog };
})();
