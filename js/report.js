// Modul: report
(function () {
'use strict';
const MB = (window.MB = window.MB || {});
const { loadDocx } = MB['util'];
const { getFile } = MB['project'];
const { decodeFile, renderEdited, canvasToBlob } = MB['imaging'];
// Erzeugung des Word-Montageberichts (.docx) mit der Bibliothek "docx".
// Kapitelstruktur = Ordnerstruktur. Überschriften = Original-Ordnernamen (oder bewusst gesetzter Berichtstitel).

const CM = 567;                       // Twips pro cm
const PX_PER_CM = 96 / 2.54;          // docx-Bildmaße in Pixeln (96 dpi)
const QUALITY = { kompakt: 1200, standard: 1700, hoch: 2400 };
const OK_STATUS = new Set(['ok', 'ausstehend', 'geändert']);

// Gliederung des Berichts berechnen (auch für die Vorschau im Dialog)
function buildOutline(model, settings, scopePath = '') {
  const s = settings;
  const usable = im => OK_STATUS.has(im.status) && (!s.onlySelected || im.selected);
  const out = [];
  const counters = [];
  let figures = 0;

  function visit(path, level) {
    const info = model.info.get(path);
    const f = info.folder;
    if (!f.includeInReport) return null;
    const node = { path, level, title: (f.reportTitle && f.reportTitle.trim()) || f.name, original: f.name, note: f.note, kind: info.kind, role: info.role, images: [], compare: null, children: [] };
    node.images = (model.imagesByFolder.get(path) || []).filter(usable);
    const consumed = new Set();
    const g = info.compare;
    if (g && g.enabled && g.mode !== 'separate') {
      const rowsUse = g.rows.map(r => ({ b: r.b && usable(model.imageById.get(r.b)) ? model.imageById.get(r.b) : null, a: r.a && usable(model.imageById.get(r.a)) ? model.imageById.get(r.a) : null })).filter(r => r.b || r.a);
      if (rowsUse.length) node.compare = { mode: g.mode, rows: rowsUse, before: rowsUse.map(r => r.b).filter(Boolean), after: rowsUse.map(r => r.a).filter(Boolean) };
      for (const p of [...g.beforeFolders, ...g.afterFolders]) {
        consumed.add(p);
        // eventuelle Unterordner der Vorher/Nachher-Ordner trotzdem ausgeben
        for (const c of model.info.get(p).children) node.children.push({ deferred: c.path });
      }
    }
    for (const c of info.children) if (!consumed.has(c.path)) node.children.push({ deferred: c.path });
    node.children = node.children.map(d => visit(d.deferred, level + 1)).filter(Boolean);
    node.count = node.images.length + (node.compare ? node.compare.before.length + node.compare.after.length : 0) + node.children.reduce((a, c) => a + c.count, 0);
    if (s.skipEmpty && node.count === 0 && !(node.note && node.note.trim())) return null;
    return node;
  }
  const root = visit(scopePath, 0);
  if (!root) return { root: null, flat: [], imageCount: 0 };
  // Nummerierung
  const number = (node, prefix) => {
    node.children.forEach((c, i) => {
      c.number = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      number(c, c.number);
    });
  };
  // Hat die Wurzel selbst Bilder, bekommt sie ein eigenes Kapitel
  number(root, '');
  const flat = [];
  const walk = n => { flat.push(n); n.children.forEach(walk); };
  walk(root);
  return { root, flat, imageCount: root.count };
}

async function generateReport(model, settings, scopePath, onProgress) {
  const D = await loadDocx();
  const s = settings;
  const { root, imageCount } = buildOutline(model, s, scopePath);
  if (!root) throw new Error('Für den Bericht sind keine Bilder ausgewählt (oder alle Ordner sind ausgeblendet).');

  const landscape = s.pageOrientation === 'landscape';
  const pageW = landscape ? 29.7 : 21.0, pageH = landscape ? 21.0 : 29.7;
  const margin = 2.0;
  const contentW = pageW - 2 * margin;
  const maxDim = QUALITY[s.quality] || QUALITY.standard;
  const warnings = [];
  let done = 0, figNo = 0;

  const prepCache = new Map();
  async function prep(im) {
    if (prepCache.has(im.id)) return prepCache.get(im.id);
    let r;
    try {
      const file = await getFile(im);
      const bmp = await decodeFile(file, im.name);
      const c = renderEdited(bmp, im.edits, { maxDim, background: '#ffffff' });
      bmp.close?.();
      const blob = await canvasToBlob(c, 'image/jpeg', 0.86);
      r = { data: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height };
    } catch (e) {
      warnings.push(`${im.relPath}: ${e.message}`);
      r = null;
    }
    done++;
    onProgress?.(done / Math.max(1, imageCount), `Bild ${done} von ${imageCount}: ${im.name}`);
    prepCache.set(im.id, r);
    return r;
  }

  const fit = (w, h, maxWcm, maxHcm) => {
    const sc = Math.min(maxWcm / (w / PX_PER_CM), maxHcm / (h / PX_PER_CM), 1e9);
    return { width: Math.round(w / PX_PER_CM * sc * PX_PER_CM), height: Math.round(h / PX_PER_CM * sc * PX_PER_CM) };
  };
  const captionText = im => {
    figNo++;
    if (s.caption === 'none') return null;
    const t = s.caption === 'caption' ? (im.caption?.trim() || im.name) : (s.caption === 'both' && im.caption?.trim() ? `${im.caption.trim()} (${im.name})` : im.name);
    return `Abb. ${figNo}: ${t}`;
  };

  async function imageBlock(im, maxWcm, maxHcm) {
    const p = await prep(im);
    const paras = [];
    if (!p) {
      figNo++;
      paras.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: `[Bild nicht verfügbar: ${im.name}]`, italics: true, color: '9A3412', size: 18 })] }));
      return paras;
    }
    const t = fit(p.w, p.h, maxWcm, maxHcm);
    paras.push(new D.Paragraph({
      alignment: D.AlignmentType.CENTER, spacing: { before: 60, after: 40 }, keepNext: true,
      children: [new D.ImageRun({ type: 'jpg', data: p.data, transformation: t, altText: { name: im.name, title: im.name, description: im.relPath } })],
    }));
    const cap = captionText(im);
    if (cap) paras.push(new D.Paragraph({ style: 'Bildunterschrift', alignment: D.AlignmentType.CENTER, children: [new D.TextRun(cap)] }));
    if (im.note?.trim() && s.includeImageNotes) paras.push(new D.Paragraph({ style: 'Bildunterschrift', alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: im.note.trim(), italics: true })] }));
    return paras;
  }

  const noBorders = { top: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, left: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, insideHorizontal: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, insideVertical: { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' } };
  const lineBorder = c => ({ style: D.BorderStyle.SINGLE, size: 4, color: c });
  const gridBorders = { top: lineBorder('C9D1DB'), bottom: lineBorder('C9D1DB'), left: lineBorder('C9D1DB'), right: lineBorder('C9D1DB'), insideHorizontal: lineBorder('C9D1DB'), insideVertical: lineBorder('C9D1DB') };

  async function imageGrid(images) {
    const per = Math.max(1, Math.min(3, +s.perRow || 2));
    const colW = contentW / per;
    const maxH = per === 1 ? (landscape ? 12 : 14) : per === 2 ? (landscape ? 9 : 8.5) : 6;
    if (per === 1) {
      const out = [];
      for (const im of images) out.push(...await imageBlock(im, contentW - 0.4, maxH));
      return out;
    }
    const rows = [];
    for (let i = 0; i < images.length; i += per) {
      const cells = [];
      for (let k = 0; k < per; k++) {
        const im = images[i + k];
        cells.push(new D.TableCell({
          width: { size: Math.round(colW * CM), type: D.WidthType.DXA },
          margins: { top: 60, bottom: 100, left: 80, right: 80 },
          verticalAlign: D.VerticalAlign.TOP,
          children: im ? await imageBlock(im, colW - 0.5, maxH) : [new D.Paragraph('')],
        }));
      }
      rows.push(new D.TableRow({ cantSplit: true, children: cells }));
    }
    return [new D.Table({ width: { size: Math.round(contentW * CM), type: D.WidthType.DXA }, columnWidths: Array(per).fill(Math.round(colW * CM)), layout: D.TableLayoutType.FIXED, borders: noBorders, rows }), new D.Paragraph({ spacing: { after: 80 }, children: [] })];
  }

  async function compareTable(cmp) {
    const colW = contentW / 2;
    const maxW = colW - 0.5, maxH = landscape ? 9 : 8;
    const headCell = (txt, fill) => new D.TableCell({
      width: { size: Math.round(colW * CM), type: D.WidthType.DXA },
      shading: { fill, type: D.ShadingType.CLEAR, color: 'auto' },
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: txt, bold: true, color: 'FFFFFF', size: 22 })] })],
    });
    const rows = [new D.TableRow({ tableHeader: true, cantSplit: true, children: [headCell('Vorher', '6B7280'), headCell('Nachher', '1F7A4D')] })];
    const cellOf = async list => {
      const children = [];
      for (const im of list) children.push(...await imageBlock(im, maxW, list.length > 1 ? Math.min(maxH, 7) : maxH));
      if (!children.length) children.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 200, after: 200 }, children: [new D.TextRun({ text: 'Kein zugeordnetes Bild', italics: true, color: '8A94A3', size: 18 })] }));
      return new D.TableCell({
        width: { size: Math.round(colW * CM), type: D.WidthType.DXA },
        margins: { top: 80, bottom: 100, left: 100, right: 100 },
        verticalAlign: D.VerticalAlign.TOP,
        children,
      });
    };
    if (cmp.mode === 'groups') {
      // Bilder nacheinander vorbereiten (Reihenfolge der Abbildungsnummern: erst Vorher, dann Nachher)
      const left = await cellOf(cmp.before);
      const right = await cellOf(cmp.after);
      rows.push(new D.TableRow({ children: [left, right] }));
    } else {
      for (const r of cmp.rows) {
        const left = await cellOf(r.b ? [r.b] : []);
        const right = await cellOf(r.a ? [r.a] : []);
        rows.push(new D.TableRow({ cantSplit: true, children: [left, right] }));
      }
    }
    return [new D.Table({ width: { size: Math.round(contentW * CM), type: D.WidthType.DXA }, columnWidths: [Math.round(colW * CM), Math.round(colW * CM)], layout: D.TableLayoutType.FIXED, borders: gridBorders, rows }), new D.Paragraph({ spacing: { after: 120 }, children: [] })];
  }

  const HEAD = [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3, D.HeadingLevel.HEADING_4, D.HeadingLevel.HEADING_5, D.HeadingLevel.HEADING_6];
  const body = [];
  async function emit(node, isRoot) {
    if (!isRoot) {
      const lvl = Math.min(node.level, 6);
      const text = (s.numbering && node.number ? node.number + '  ' : '') + node.title;
      body.push(new D.Paragraph({ heading: HEAD[lvl - 1], keepNext: true, children: [new D.TextRun(text)] }));
      if (s.showPath) body.push(new D.Paragraph({ style: 'Pfad', children: [new D.TextRun(`Ordner: ${node.path}`)] }));
      if (node.title !== node.original && s.showOriginalName) body.push(new D.Paragraph({ style: 'Pfad', children: [new D.TextRun(`Originalordner: ${node.original}`)] }));
    }
    if (node.note?.trim() && s.showDocPointNote !== false) for (const line of node.note.trim().split(/\n+/)) body.push(new D.Paragraph({ spacing: { after: 100 }, children: [new D.TextRun(line)] }));
    if (node.images.length) {
      if (isRoot && (node.children.length || node.compare)) body.push(new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, keepNext: true, children: [new D.TextRun(node.title)] }));
      body.push(...await imageGrid(node.images));
    }
    if (node.compare) body.push(...await compareTable(node.compare));
    for (const c of node.children) await emit(c, false);
  }
  await emit(root, true);

  // ---- Deckblatt ----
  const cover = [];
  if (s.logo) {
    try {
      const bin = Uint8Array.from(atob(s.logo.split(',')[1]), c => c.charCodeAt(0));
      const type = /image\/png/.test(s.logo) ? 'png' : 'jpg';
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = s.logo; });
      cover.push(new D.Paragraph({ alignment: D.AlignmentType.RIGHT, children: [new D.ImageRun({ type, data: bin, transformation: fit(img.naturalWidth, img.naturalHeight, 6, 2.5) })] }));
    } catch { warnings.push('Logo konnte nicht eingefügt werden.'); }
  }
  cover.push(new D.Paragraph({ spacing: { before: 2400 }, children: [] }));
  cover.push(new D.Paragraph({ style: 'Deckblatttitel', children: [new D.TextRun(s.title || 'Montagebericht')] }));
  if (s.subtitle) cover.push(new D.Paragraph({ style: 'Deckblattuntertitel', children: [new D.TextRun(s.subtitle)] }));
  const facts = [['Auftraggeber / Kunde', s.customer], ['Standort', s.site], ['Anlage', s.plant], ['Auftragsnummer', s.orderNo], ['Ausgeführt von', s.technician], ['Datum', s.date]].filter(([, v]) => v && String(v).trim());
  const dpCount = (function count(n) { return (n.images.length || n.compare ? 1 : 0) + n.children.reduce((a, c) => a + count(c), 0); })(root);
  facts.push(['Umfang', `${dpCount} Dokumentationspunkte, ${imageCount} Abbildungen`]);
  cover.push(new D.Paragraph({ spacing: { before: 600 }, children: [] }));
  cover.push(new D.Table({
    width: { size: Math.round(contentW * CM), type: D.WidthType.DXA }, columnWidths: [Math.round(5.5 * CM), Math.round((contentW - 5.5) * CM)], layout: D.TableLayoutType.FIXED,
    borders: { ...noBorders, insideHorizontal: lineBorder('D8DEE6'), top: lineBorder('D8DEE6'), bottom: lineBorder('D8DEE6') },
    rows: facts.map(([k, v]) => new D.TableRow({ children: [
      new D.TableCell({ width: { size: Math.round(5.5 * CM), type: D.WidthType.DXA }, margins: { top: 90, bottom: 90, left: 0, right: 100 }, children: [new D.Paragraph({ children: [new D.TextRun({ text: k, color: '5B6573' })] })] }),
      new D.TableCell({ width: { size: Math.round((contentW - 5.5) * CM), type: D.WidthType.DXA }, margins: { top: 90, bottom: 90, left: 100, right: 0 }, children: [new D.Paragraph({ children: [new D.TextRun({ text: String(v), bold: true })] })] }),
    ] })),
  }));
  if (s.intro?.trim()) {
    cover.push(new D.Paragraph({ spacing: { before: 600 }, children: [] }));
    for (const line of s.intro.trim().split(/\n+/)) cover.push(new D.Paragraph({ spacing: { after: 120 }, children: [new D.TextRun(line)] }));
  }
  cover.push(new D.Paragraph({ children: [new D.PageBreak()] }));
  if (s.includeToc) {
    cover.push(new D.Paragraph({ style: 'Verzeichnistitel', children: [new D.TextRun('Inhaltsverzeichnis')] }));
    cover.push(new D.TableOfContents('Inhaltsverzeichnis', { hyperlink: true, headingStyleRange: '1-3' }));
    cover.push(new D.Paragraph({ style: 'Pfad', children: [new D.TextRun('Hinweis: Falls das Verzeichnis leer ist, in Word mit Rechtsklick → „Felder aktualisieren“ (F9) erzeugen.')] }));
    cover.push(new D.Paragraph({ children: [new D.PageBreak()] }));
  }

  const headerText = [s.title, s.subtitle].filter(Boolean).join(' – ');
  const doc = new D.Document({
    creator: s.technician || 'Montagebericht',
    title: s.title || 'Montagebericht',
    description: 'Erstellt mit der Montagebericht-Anwendung',
    features: { updateFields: !!s.includeToc },
    styles: {
      default: { document: { run: { font: 'Calibri', size: 21, color: '1F2937' }, paragraph: { spacing: { line: 276, lineRule: (D.LineRuleType && D.LineRuleType.AUTO) || 'auto' } } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, color: '0F2A44' }, paragraph: { spacing: { before: 360, after: 160 }, keepNext: true, border: { bottom: { style: D.BorderStyle.SINGLE, size: 8, color: 'E8A317', space: 4 } } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: '0F2A44' }, paragraph: { spacing: { before: 280, after: 120 }, keepNext: true } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 23, bold: true, color: '33475B' }, paragraph: { spacing: { before: 220, after: 100 }, keepNext: true } },
        { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, italics: true, color: '33475B' }, paragraph: { spacing: { before: 180, after: 80 }, keepNext: true } },
        { id: 'Heading5', name: 'Heading 5', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 21, bold: true, color: '5B6573' }, paragraph: { spacing: { before: 160, after: 60 }, keepNext: true } },
        { id: 'Heading6', name: 'Heading 6', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 21, italics: true, color: '5B6573' }, paragraph: { spacing: { before: 140, after: 60 }, keepNext: true } },
        { id: 'Bildunterschrift', name: 'Bildunterschrift', basedOn: 'Normal', run: { size: 17, color: '5B6573' }, paragraph: { spacing: { before: 20, after: 80 } } },
        { id: 'Pfad', name: 'Ordnerpfad', basedOn: 'Normal', run: { size: 16, color: '8A94A3' }, paragraph: { spacing: { after: 100 } } },
        { id: 'Deckblatttitel', name: 'Deckblatt Titel', basedOn: 'Normal', run: { size: 56, bold: true, color: '0F2A44' }, paragraph: { spacing: { after: 160 } } },
        { id: 'Deckblattuntertitel', name: 'Deckblatt Untertitel', basedOn: 'Normal', run: { size: 30, color: '5B6573' }, paragraph: { spacing: { after: 200 } } },
        { id: 'Verzeichnistitel', name: 'Verzeichnistitel', basedOn: 'Normal', run: { size: 32, bold: true, color: '0F2A44' }, paragraph: { spacing: { after: 240 } } },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { orientation: landscape ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT, width: Math.round(21.0 * CM), height: Math.round(29.7 * CM) },
          margin: { top: Math.round(margin * CM), bottom: Math.round(margin * CM), left: Math.round(margin * CM), right: Math.round(margin * CM), header: Math.round(0.9 * CM), footer: Math.round(0.9 * CM) },
        },
        titlePage: true,
      },
      headers: {
        default: new D.Header({ children: [new D.Paragraph({ alignment: D.AlignmentType.RIGHT, border: { bottom: { style: D.BorderStyle.SINGLE, size: 4, color: 'D8DEE6', space: 4 } }, children: [new D.TextRun({ text: headerText, size: 16, color: '8A94A3' })] })] }),
        first: new D.Header({ children: [new D.Paragraph('')] }),
      },
      footers: {
        default: new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ children: ['Seite ', D.PageNumber.CURRENT, ' von ', D.PageNumber.TOTAL_PAGES], size: 16, color: '8A94A3' })] })] }),
        first: new D.Footer({ children: [new D.Paragraph('')] }),
      },
      children: [...cover, ...body],
    }],
  });
  onProgress?.(1, 'Word-Datei wird zusammengestellt …');
  const blob = await D.Packer.toBlob(doc);
  return { blob, warnings, imageCount: figNo };
}
MB['report'] = { buildOutline, generateReport };
})();
