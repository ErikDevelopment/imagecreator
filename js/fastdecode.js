// Schnelles, verkleinertes Dekodieren von JPEG-Fotos (Hauptprogramm UND Worker).
// Nutzt WebCodecs ImageDecoder mit Zielgröße: der JPEG-Decoder dekodiert direkt in 1/2, 1/4 oder 1/8
// der Auflösung – bei 12-MP-Handyfotos etwa 4× schneller als volles Dekodieren.
// Gibt null zurück, wenn der Weg nicht möglich ist (kein JPEG, Browser ohne ImageDecoder, unbekannte
// Ausrichtung …) – dann nutzt der Aufrufer das bisherige Verfahren.
(function (g) {
  'use strict';
  const SOF = new Set([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]);

  // Pixelmaße (kodiert, ohne EXIF-Drehung) aus dem JPEG-Kopf lesen, ohne das Bild zu dekodieren
  async function jpegSize(file) {
    let buf = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
    let base = 0;
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
    let off = 2;
    for (let guard = 0; guard < 200; guard++) {
      // Puffer nachladen, falls der nächste Segmentkopf außerhalb liegt
      if (off + 9 > base + buf.length) {
        if (off >= file.size) return null;
        buf = new Uint8Array(await file.slice(off, off + 65536).arrayBuffer());
        base = off;
        if (buf.length < 9) return null;
      }
      const i = off - base;
      if (buf[i] !== 0xFF) return null;
      const marker = buf[i + 1];
      if (marker === 0xFF) { off++; continue; }                  // Füllbyte
      if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7)) { off += 2; continue; }
      if (SOF.has(marker)) return { h: (buf[i + 5] << 8) | buf[i + 6], w: (buf[i + 7] << 8) | buf[i + 8] };
      if (marker === 0xDA || marker === 0xD9) return null;       // Bilddaten erreicht, kein SOF gefunden
      const len = (buf[i + 2] << 8) | buf[i + 3];
      off += 2 + len;
    }
    return null;
  }

  let supported = null;
  function canFast() {
    if (supported === null) supported = typeof g.ImageDecoder === 'function' && typeof g.OffscreenCanvas === 'function';
    return supported;
  }

  /**
   * Dekodiert ein JPEG so, dass die längere Seite mindestens targetMax Pixel hat (soweit möglich).
   * Ergebnis: OffscreenCanvas (bereits richtig gedreht) + Originalmaße (gedreht), oder null.
   */
  // Optional: wiederverwendbare Zeichenfläche (spart Speicher bei vielen Bildern hintereinander)
  async function decodeScaled(file, targetMax, reuseCanvas) {
    if (!canFast() || !targetMax) return null;
    let dec, frame;
    try {
      const size = await jpegSize(file);
      if (!size || !size.w || !size.h) return null;
      const longSide = Math.max(size.w, size.h);
      let k = 1;
      for (const f of [8, 4, 2]) if (longSide / f >= targetMax) { k = f; break; }
      if (k === 1) return null;                                    // keine Ersparnis → normales Verfahren
      dec = new g.ImageDecoder({ data: file.stream(), type: 'image/jpeg', desiredWidth: Math.ceil(size.w / k), desiredHeight: Math.ceil(size.h / k) });
      ({ image: frame } = await dec.decode());
      // Ältere Browser kennen die Drehung des Frames nicht → lieber normales Verfahren
      if (typeof frame.rotation !== 'number') return null;
      // WICHTIG: den Frame NICHT direkt zeichnen. drawImage(VideoFrame) hält in Chrome pro Bild die komplette
      // eingelesene Datei im Speicher fest (gemessen: +229 MB bei 300 Fotos → Browserabstürze).
      // Über ein ImageBitmap gibt es dieses Leck nicht (+4 MB), Drehung und Tempo bleiben gleich.
      const bmp = await g.createImageBitmap(frame);
      const rotated = frame.rotation % 180 !== 0;
      frame.close(); frame = null;
      const c = reuseCanvas || new g.OffscreenCanvas(1, 1);
      c.width = bmp.width; c.height = bmp.height;
      // willReadFrequently: Zeichenfläche im Arbeitsspeicher statt im Grafikspeicher (stabiler bei vielen Bildern)
      c.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0);
      bmp.close();
      return { canvas: c, width: c.width, height: c.height, origWidth: rotated ? size.h : size.w, origHeight: rotated ? size.w : size.h };
    } catch (e) {
      return null;
    } finally {
      try { frame?.close(); } catch { /* */ }
      try { dec?.close(); } catch { /* */ }
    }
  }

  g.MBFast = { jpegSize, decodeScaled, canFast };
})(typeof self !== 'undefined' ? self : window);
