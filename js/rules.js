// Modul: rules
(function () {
'use strict';
const MB = (window.MB = window.MB || {});

// Konfigurierbare Erkennungsregeln für Unterordner-Bedeutungen
//
// Jede Regel prüft einen *normalisierten* Ordnernamen (Kleinschreibung, führende/abschließende
// Nummerierung entfernt, _ und - als Leerzeichen) gegen einen regulären Ausdruck.
// Ergebnis: Rolle + Sicherheit ("sicher" | "wahrscheinlich" | "unklar").
// Die Regeln sind in den Einstellungen bearbeitbar. Mehrdeutige Begriffe sind bewusst als "unklar" markiert.

const ROLES = {
  before: { label: 'Vorher', short: 'V' },
  after: { label: 'Nachher', short: 'N' },
  side: { label: 'Seite / Bauteil', short: 'S' },
  perspective: { label: 'Perspektive', short: 'P' },
};

const CONFIDENCE = ['sicher', 'wahrscheinlich', 'unklar'];
const confRank = c => ({ sicher: 3, wahrscheinlich: 2, unklar: 1 }[c] || 0);

const DEFAULT_RULES = [
  { id: 'r-before-1', label: 'Vorher (eindeutig)', pattern: '^(vorher|before|ist zustand|istzustand)$', role: 'before', confidence: 'sicher', enabled: true },
  { id: 'r-before-2', label: 'Vorher (Kurzform)', pattern: '^(vor|zuvor|ausgangszustand|alt)$', role: 'before', confidence: 'wahrscheinlich', enabled: true },
  { id: 'r-before-3', label: 'Bestand (mehrdeutig)', pattern: '^(bestand|bestandsaufnahme)$', role: 'before', confidence: 'unklar', enabled: true },
  { id: 'r-after-1', label: 'Nachher (eindeutig, inkl. Tippfehler-Variante)', pattern: '^(nachher|nacher|nachher zustand|after)$', role: 'after', confidence: 'sicher', enabled: true },
  { id: 'r-after-2', label: 'Nachher (Kurzform)', pattern: '^(nach|danach|neu)$', role: 'after', confidence: 'wahrscheinlich', enabled: true },
  { id: 'r-after-3', label: 'Fertig (mehrdeutig)', pattern: '^(fertig|fertigstellung|ergebnis|erledigt)$', role: 'after', confidence: 'unklar', enabled: true },
  { id: 'r-side', label: 'Räumliche Unterteilung', pattern: '^(links|rechts|oben|unten|mitte|vorne|vorn|hinten|innen|aussen|außen|left|right|top|bottom|front|back)$', role: 'side', confidence: 'sicher', enabled: true },
  { id: 'r-persp', label: 'Bildperspektive', pattern: '^(übersicht|uebersicht|gesamt|gesamtansicht|detail|details|detailansicht|nahaufnahme|overview|closeup|close up)$', role: 'perspective', confidence: 'sicher', enabled: true },
];

function normalizeName(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFC')
    .replace(/^\s*\d+[\s._)\-]*/, '')        // führende Nummerierung "01_", "1. ", "02 - "
    .replace(/[\s._\-]*\(?\d+\)?\s*$/, '')   // abschließende Nummerierung "Vorher 2", "Vorher_(1)"
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyName(name, rules) {
  const n = normalizeName(name);
  if (!n) return null;
  let best = null;
  for (const r of rules) {
    if (!r.enabled) continue;
    let re;
    try { re = new RegExp(r.pattern, 'iu'); } catch { continue; }
    if (re.test(n)) {
      if (!best || confRank(r.confidence) > confRank(best.confidence)) {
        best = { role: r.role, confidence: r.confidence, ruleId: r.id, ruleLabel: r.label, normalized: n };
      }
    }
  }
  return best;
}

function validateRule(r) {
  try { new RegExp(r.pattern, 'iu'); } catch (e) { return 'Ungültiger Ausdruck: ' + e.message; }
  if (!ROLES[r.role]) return 'Unbekannte Rolle';
  if (!CONFIDENCE.includes(r.confidence)) return 'Unbekannte Sicherheit';
  return null;
}
MB['rules'] = { ROLES, CONFIDENCE, confRank, DEFAULT_RULES, normalizeName, classifyName, validateRule };
})();
