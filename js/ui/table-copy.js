// Modul: ui/table-copy
// Bilder als formatierte Tabelle (Bild + Ordnername darunter) in die Zwischenablage kopieren
// oder als kleine Word-Datei speichern.
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { el, escapeHtml, loadDocx, saveBlob, safeFileName } = MB['util'];
const { state, getFile } = MB['project'];
const { decodeFile, renderEdited, releaseSource } = MB['imaging'];
const { modal, toast, progressDialog } = MB['ui/dialogs'];
const { topFolderName } = MB['analyze'];

const PROBLEM = new Set(['fehler', 'fehlt', 'nicht unterstützt', 'nicht lesbar']);
const CONTENT_W_CM = 17;            // A4 hoch, 2 cm Rand
const PX_PER_CM = 96 / 2.54;

// Beschriftung unter dem Bild
function captionFor(im, mode, model, n) {
  if (mode === 'top') return `Bild ${n}: ${topFolderName(model, im)}`;
  const fp = im.assignedFolder ?? im.folderPath;
  const info = model.info.get(fp);
  const folderName = fp === '' ? state.project.rootName : (info?.folder.name ?? fp.split('/').pop());
  if (mode === 'folder') return folderName;
  if (mode === 'docpoint') {
    // Bei Unterordnern wie „Vorher“ den Dokumentationspunkt voranstellen
    const dp = info?.docPoint;
    if (dp != null && dp !== fp && dp !== '') return `${model.info.get(dp).folder.name} – ${folderName}`;
    return folderName;
  }
  if (mode === 'path') return fp || state.project.rootName;
  if (mode === 'folder+file') return `${folderName} – ${im.name}`;
  return folderName;
}

// Kommentare aus .txt-Dateien: Ordner des Bildes und darüber bis zum Dokumentationspunkt
function commentsFor(im, model) {
  const out = [];
  let p = im.assignedFolder ?? im.folderPath;
  const dp = model.info.get(p)?.docPoint;
  while (p != null) {
    const f = model.info.get(p)?.folder;
    for (const c of f?.fileComments || []) { const t = MB['scanner'].commentText(c); if (t && !out.includes(t)) out.unshift(t); }
    if (p === dp || p === '') break;
    p = f?.parentPath ?? null;
  }
  return out;
}

// Bild in Zielgröße bringen (Bearbeitungen werden übernommen)
async function prepImage(im, maxWcm, maxHcm, quality) {
  const file = await getFile(im);
  const bmp = await decodeFile(file, im.name, im.edits?.crop ? 0 : quality);   // direkt verkleinert dekodieren
  const c = renderEdited(bmp, im.edits, { maxDim: quality, background: '#ffffff' });
  releaseSource(bmp);
  const sc = Math.min((maxWcm * PX_PER_CM) / c.width, (maxHcm * PX_PER_CM) / c.height);
  const w = Math.max(1, Math.round(c.width * sc)), h = Math.max(1, Math.round(c.height * sc));
  const dataUrl = c.toDataURL('image/jpeg', 0.86);
  c.width = c.height = 0;   // Speicher der Zeichenfläche sofort freigeben
  return { dataUrl, w, h, cw: c.width, ch: c.height };
}

function layout(cols) {
  const cellW = CONTENT_W_CM / cols;
  const maxH = cols === 1 ? 12 : cols === 2 ? 8 : cols === 3 ? 5.5 : 4.2;
  return { cellW, imgW: cellW - 0.5, maxH };
}

async function buildHtml(images, opts, onProgress) {
  const { cellW, imgW, maxH } = layout(opts.cols);
  const quality = opts.cols <= 2 ? 1400 : 1000;
  const cells = [];
  let done = 0;
  for (const im of images) {
    let inner;
    try {
      const p = await prepImage(im, imgW, maxH, quality);
      inner = `<img src="${p.dataUrl}" width="${p.w}" height="${p.h}" style="width:${p.w}px;height:${p.h}px;display:block;margin:0 auto" alt="${escapeHtml(im.name)}">`;
    } catch (e) {
      inner = `<p style="color:#9a3412;font-style:italic">[Bild nicht verfügbar: ${escapeHtml(im.name)}]</p>`;
    }
    const cap = escapeHtml(captionFor(im, opts.caption, opts.model, cells.length + 1));
    const cmts = opts.comments ? commentsFor(im, opts.model) : [];
    const cmtHtml = cmts.map(t => `<p style="margin:2pt 0 0 0;font-family:Calibri,Arial,sans-serif;font-size:8.5pt;font-style:italic;color:#555555;text-align:center">${escapeHtml(t).replace(/\n/g, '<br>')}</p>`).join('');
    cells.push(`<td width="${Math.round(cellW * PX_PER_CM)}" valign="top" style="width:${cellW.toFixed(2)}cm;border:1px solid #c9d1db;padding:5pt;text-align:center;vertical-align:top">${inner}<p style="margin:4pt 0 0 0;font-family:Calibri,Arial,sans-serif;font-size:9pt;color:#333333;text-align:center">${cap}</p>${cmtHtml}</td>`);
    onProgress?.(++done / images.length, `Bild ${done} von ${images.length}`);
  }
  const rows = [];
  for (let i = 0; i < cells.length; i += opts.cols) {
    const r = cells.slice(i, i + opts.cols);
    while (r.length < opts.cols) r.push(`<td style="width:${cellW.toFixed(2)}cm;border:1px solid #c9d1db"></td>`);
    rows.push(`<tr style="page-break-inside:avoid">${r.join('')}</tr>`);
  }
  return `<table border="1" cellspacing="0" cellpadding="0" style="border-collapse:collapse;table-layout:fixed;width:${CONTENT_W_CM}cm;border:1px solid #c9d1db">${rows.join('')}</table>`;
}

async function buildDocx(images, opts, onProgress) {
  const D = await loadDocx();
  const CM = 567;
  const { cellW, imgW, maxH } = layout(opts.cols);
  const quality = opts.cols <= 2 ? 1600 : 1100;
  const border = { style: D.BorderStyle.SINGLE, size: 4, color: 'C9D1DB' };
  const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
  const cells = [];
  let done = 0;
  for (const im of images) {
    const children = [];
    try {
      const p = await prepImage(im, imgW, maxH, quality);
      const bin = Uint8Array.from(atob(p.dataUrl.split(',')[1]), c => c.charCodeAt(0));
      children.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.ImageRun({ type: 'jpg', data: bin, transformation: { width: p.w, height: p.h }, altText: { name: im.name, title: im.name, description: im.relPath } })] }));
    } catch {
      children.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: `[Bild nicht verfügbar: ${im.name}]`, italics: true, color: '9A3412' })] }));
    }
    children.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 60 }, children: [new D.TextRun({ text: captionFor(im, opts.caption, opts.model, cells.length + 1), size: 18, color: '333333' })] }));
    for (const t of (opts.comments ? commentsFor(im, opts.model) : [])) {
      children.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 20 }, children: t.split('\n').map((l, i) => new D.TextRun({ text: l, size: 17, italics: true, color: '555555', ...(i ? { break: 1 } : {}) })) }));
    }
    cells.push(new D.TableCell({ width: { size: Math.round(cellW * CM), type: D.WidthType.DXA }, margins: { top: 80, bottom: 80, left: 80, right: 80 }, verticalAlign: D.VerticalAlign.TOP, children }));
    onProgress?.(++done / images.length, `Bild ${done} von ${images.length}`);
  }
  const rows = [];
  for (let i = 0; i < cells.length; i += opts.cols) {
    const r = cells.slice(i, i + opts.cols);
    while (r.length < opts.cols) r.push(new D.TableCell({ width: { size: Math.round(cellW * CM), type: D.WidthType.DXA }, children: [new D.Paragraph('')] }));
    rows.push(new D.TableRow({ cantSplit: true, children: r }));
  }
  const doc = new D.Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 21 }, paragraph: { spacing: { line: 240, lineRule: (D.LineRuleType && D.LineRuleType.AUTO) || 'auto' } } } } },
    sections: [{
      properties: { page: { size: { width: Math.round(21 * CM), height: Math.round(29.7 * CM) }, margin: { top: 2 * CM, bottom: 2 * CM, left: 2 * CM, right: 2 * CM } } },
      children: [new D.Table({ width: { size: Math.round(CONTENT_W_CM * CM), type: D.WidthType.DXA }, columnWidths: Array(opts.cols).fill(Math.round(cellW * CM)), layout: D.TableLayoutType.FIXED, borders, rows })],
    }],
  });
  return D.Packer.toBlob(doc);
}

// sources: [{ key, label, images }]
async function openTableCopyDialog(sources) {
  const model = state.model;
  const usable = sources.map(s => ({ ...s, images: s.images.filter(im => !PROBLEM.has(im.status)) })).filter(s => s.images.length);
  if (!usable.length) { toast('Keine Bilder zum Kopieren in der aktuellen Ansicht.', { type: 'warn' }); return; }
  const opts = { cols: 2, caption: 'top', onlyReport: false, comments: true, model };
  const srcSel = el('select', {}, ...usable.map(s => el('option', { value: s.key, text: `${s.label} (${s.images.length})` })));
  const colsSel = el('select', {}, ...[['1', '1 Bild pro Zeile'], ['2', '2 Bilder pro Zeile'], ['3', '3 Bilder pro Zeile'], ['4', '4 Bilder pro Zeile']].map(([v, t]) => el('option', { value: v, text: t })));
  colsSel.value = '2';
  const capSel = el('select', {},
    el('option', { value: 'top', text: 'Bild 1: Ordner / Unterordner (fortlaufend)' }),
    el('option', { value: 'docpoint', text: 'Ordnername (bei Vorher/Nachher mit Dokupunkt davor)' }),
    el('option', { value: 'folder', text: 'Nur Ordnername' }),
    el('option', { value: 'folder+file', text: 'Ordnername – Dateiname' }),
    el('option', { value: 'path', text: 'Vollständiger Ordnerpfad' }));
  const onlyRep = el('input', { type: 'checkbox' });
  const withCmt = el('input', { type: 'checkbox', checked: true });
  const info = el('p', { class: 'muted small' });
  const preview = el('div', { class: 'tc-preview' });
  const current = () => {
    const s = usable.find(x => x.key === srcSel.value) || usable[0];
    return onlyRep.checked ? s.images.filter(i => i.selected) : s.images;
  };
  const refresh = () => {
    opts.cols = +colsSel.value; opts.caption = capSel.value; opts.comments = withCmt.checked;
    const imgs = current();
    info.textContent = `${imgs.length} Bilder · ${Math.ceil(imgs.length / opts.cols)} Tabellenzeilen`;
    const sample = imgs.slice(0, opts.cols * 2);
    preview.style.setProperty('--cols', opts.cols);
    preview.innerHTML = sample.map((im, idx) => `<div class="tc-cell"><div class="tc-img" style="${MB['thumbs'].cachedThumb(im) ? `background-image:url('${MB['thumbs'].cachedThumb(im)}')` : ''}"></div><div class="tc-cap">${escapeHtml(captionFor(im, opts.caption, model, idx + 1))}</div>${opts.comments ? commentsFor(im, model).map(t => `<div class="tc-cmt">${escapeHtml(t).replace(/\n/g, '<br>')}</div>`).join('') : ''}</div>`).join('') + (imgs.length > sample.length ? `<div class="tc-more">… und ${imgs.length - sample.length} weitere</div>` : '');
  };
  [srcSel, colsSel, capSel, onlyRep, withCmt].forEach(x => x.addEventListener('change', refresh));
  const body = el('div', { class: 'tc-dlg' },
    el('label', { class: 'field' }, el('span', { text: 'Welche Bilder' }), srcSel),
    el('label', { class: 'check' }, onlyRep, ' Nur Bilder, die für den Bericht ausgewählt sind'),
    el('label', { class: 'check' }, withCmt, ' Kommentare aus .txt-Dateien unter dem Ordnernamen'),
    el('div', { class: 'row2' },
      el('label', { class: 'field' }, el('span', { text: 'Spalten' }), colsSel),
      el('label', { class: 'field' }, el('span', { text: 'Text unter dem Bild' }), capSel)),
    info, el('h4', { text: 'Vorschau' }), preview,
    el('p', { class: 'muted small', html: '<b>Kopieren:</b> danach in Word mit Strg+V (Mac: ⌘+V) einfügen. Bearbeitungen (Pfeile, Zuschnitt …) sind enthalten.<br><b>Word-Datei:</b> sicherer Weg bei sehr vielen Bildern oder falls das Einfügen in deiner Word-Version keine Bilder zeigt.' }));
  refresh();

  await modal({
    title: 'Bilder als Word-Tabelle', body, wide: false,
    buttons: [
      { label: 'Abbrechen', value: null, class: 'ghost' },
      {
        label: 'Als Word-Datei speichern', class: 'ghost',
        onClick: async () => {
          const imgs = current();
          const prog = progressDialog('Word-Tabelle wird erstellt');
          try {
            const blob = await buildDocx(imgs, { ...opts }, (f, t) => prog.update(f, t));
            prog.close();
            await saveBlob(blob, safeFileName(`Bildtabelle ${srcSel.selectedOptions[0].textContent.replace(/\s*\(\d+\)$/, '')}`) + '.docx', [{ description: 'Word-Dokument', accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] } }]);
            toast(`Word-Datei mit ${imgs.length} Bildern erstellt.`, { type: 'ok' });
          } catch (e) { prog.close(); toast('Fehler: ' + e.message, { type: 'warn', timeout: 8000 }); return false; }
        },
      },
      {
        label: 'In Zwischenablage kopieren', class: 'primary',
        onClick: () => {
          const imgs = current();
          if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
            toast('Dieser Browser kann keine Tabellen mit Bildern kopieren. Bitte „Als Word-Datei speichern“ nutzen.', { type: 'warn', timeout: 8000 });
            return false;
          }
          const prog = progressDialog('Tabelle wird für die Zwischenablage vorbereitet');
          const htmlP = buildHtml(imgs, { ...opts }, (f, t) => prog.update(f, t));
          // Wichtig: write() muss sofort im Klick aufgerufen werden, die Inhalte werden als Promise nachgereicht
          const item = new ClipboardItem({
            'text/html': htmlP.then(h => new Blob([h], { type: 'text/html' })),
            'text/plain': Promise.resolve(new Blob([imgs.map((im, idx) => [captionFor(im, opts.caption, model, idx + 1), ...(opts.comments ? commentsFor(im, model) : [])].join(' – ')).join('\n')], { type: 'text/plain' })),
          });
          navigator.clipboard.write([item]).then(() => {
            prog.close();
            toast(`Tabelle mit ${imgs.length} Bildern kopiert – jetzt in Word einfügen (Strg+V).`, { type: 'ok', timeout: 7000 });
          }).catch(e => {
            prog.close();
            toast('Kopieren fehlgeschlagen (' + (e.message || e) + '). Bitte „Als Word-Datei speichern“ nutzen.', { type: 'warn', timeout: 9000 });
          });
        },
      },
    ],
  });
}

MB['ui/table-copy'] = { openTableCopyDialog, buildHtml, captionFor };
})();
