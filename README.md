# Montagebericht

Lokale Web-Anwendung, die eine Fotodokumentation aus beliebigen Ordnerstrukturen automatisch einliest, nach dieser Struktur ordnet, Vorher/Nachher-Gruppen erkennt und daraus einen formatierten **Word-Montagebericht (.docx)** erzeugt. Alles läuft lokal im Browser – keine Cloud, kein Upload.

## Starten

**Online über GitHub Pages:** Repository → *Settings → Pages → Build and deployment → Source: „Deploy from a branch“*, Branch `main`, Ordner `/ (root)` → *Save*. Nach ca. einer Minute läuft die App unter `https://<benutzername>.github.io/imagecreator/`.

**Lokal:** `index.html` doppelklicken. Es gibt keinen Server, keine Installation und keinen Build-Schritt.

Empfohlen ist **Google Chrome oder Microsoft Edge**. Obwohl die App im Internet liegt, **verlassen keine Bilder den Rechner**: Ordner werden direkt im Browser gelesen, Daten liegen im Browser-Speicher (IndexedDB). GitHub liefert nur den Programmcode aus.

## Ablauf

1. **„Projektordner auswählen und analysieren“** – alle Unterordner werden rekursiv eingelesen. Alternativ Ordner ins Fenster ziehen oder ein ZIP importieren.
2. Die Anwendung baut den Ordnerbaum nach, erkennt Dokumentationspunkte und Vorher/Nachher-Gruppen und erzeugt im Hintergrund Vorschaubilder und Metadaten.
3. Prüfen, bei Bedarf Bilder abwählen, beschriften, markieren, bearbeiten, Vorher/Nachher-Paare anpassen.
4. **„Word-Bericht erstellen“** – Deckblatt ausfüllen, Gliederung prüfen, DOCX erzeugen.

## Wie die Ordnerstruktur verstanden wird

- Jeder Ordner wird über seinen **vollständigen relativen Pfad** identifiziert. `Projekt_A/Punkt_1/Vorher`, `Projekt_A/Punkt_2/Vorher` und `Projekt_B/Punkt_1/Vorher` bleiben getrennt.
- Die Reihenfolge wird beim ersten Einlesen festgelegt (natürliche Sortierung wie im Windows-Explorer: `Bild2` vor `Bild10`) und gespeichert. Sie lässt sich per Drag & Drop oder ↑/↓ ändern und jederzeit zurücksetzen.
- **Unterordner mit Bedeutung** werden über bearbeitbare Regeln erkannt (Menü *Erkennungsregeln*):
  - Vorher: `Vorher`, `Before`, `Ist-Zustand` (sicher) · `Vor`, `Ausgangszustand` (wahrscheinlich) · `Bestand` (unklar)
  - Nachher: `Nachher`, `After` (sicher, inkl. gängiger Tippfehler) · `Nach`, `Neu` (wahrscheinlich) · `Fertig`, `Fertigstellung` (unklar)
  - Räumlich: `Links`, `Rechts`, `Oben`, `Unten` … · Perspektive: `Übersicht`, `Details` …
  - Vor dem Vergleich werden Namen normalisiert: `01_Vorher`, `Vorher 2`, `VORHER` → `vorher`.
- **Sicherheitsstufen:** Vergleiche mit „sicher“/„wahrscheinlich“ sind automatisch aktiv. „Unklare“ Treffer werden angezeigt, aber erst nach Bestätigung im Bericht als Vergleich verwendet. Ein „unklarer“ Ordner ohne passendes Gegenstück oder mit eigenen Unterordnern bleibt ein normaler Ordner.
- Alle anderen Ordner werden zu **Dokumentationspunkten bzw. Kapiteln**. Die Überschrift im Bericht ist **exakt der Ordnername**. Ein abweichender Berichtstitel kann je Ordner gesetzt werden, der Originalname bleibt immer erhalten.
- Jeder Ordner kann seine Bedeutung manuell festgelegt bekommen (rechte Seitenleiste).

## Vorher/Nachher

- Paare werden nach der ursprünglichen Reihenfolge gebildet und als „automatisch“ gekennzeichnet. Bei ungleicher Anzahl bleiben überzählige Bilder sichtbar („ohne Gegenstück“). Es geht kein Bild verloren.
- In der Ansicht **Vorher / Nachher**: Bild links anklicken, dann rechts → verknüpfen. „Lösen“ trennt ein Paar. Zelle auf Zelle ziehen tauscht, Zeilengriff ⋮⋮ verschiebt ein Paar.
- Vollbild-Vergleich mit optional synchronisiertem Zoom (Mausrad, Ziehen, Doppelklick).
- Darstellung im Bericht je Gruppe: *paarweise Zeilen*, *Gruppen gegenüber* oder *getrennt*.

## Bearbeiten (nicht-destruktiv)

Drehen, Spiegeln, Zuschneiden (frei/4:3/1:1/16:9), Helligkeit/Kontrast/Sättigung, Pfeile, Linien, Rechtecke, Ellipsen, Text und Nummernmarker, mit Rückgängig/Wiederholen. **Die Originaldatei wird nie verändert.** Gespeichert werden nur die Bearbeitungsschritte, angewendet bei Vorschau und Export.

## Tastatur

| Taste | Funktion |
|---|---|
| Klick / Strg+Klick / Umschalt+Klick | Auswahl / hinzufügen / Bereich |
| Strg+A, Esc | alles auswählen / Auswahl aufheben |
| Pfeiltasten, Pos1, Ende | in der Galerie navigieren |
| Enter / Doppelklick | Bild öffnen |
| Leertaste | Auswahl in Bericht aufnehmen/entfernen |
| E | Bild bearbeiten |
| Strg+F | Suche |
| ← → im Betrachter | blättern, `+` `−` `0` Zoom |
| Strg+Z / Strg+Y, Entf im Editor | rückgängig / wiederholen, Anmerkung löschen |

Ausgewählte Bilder auf einen Ordner im Baum ziehen = im Bericht dort einordnen (Datei bleibt, wo sie ist). Innerhalb eines Ordners per Drag & Drop umsortieren (in der ursprünglichen Sortierung ohne Filter).

## Speicherung & Sicherung

- Projektdaten, Bearbeitungen, Vorschaubilder und Einstellungen liegen in der **IndexedDB des Browsers** (pro Browser und Benutzerprofil). Die Anwendung bittet um dauerhaften Speicher.
- **Chrome/Edge:** Der Projektordner wird als Zugriffs-Handle gemerkt. Bilder werden **nicht kopiert**. Beim nächsten Öffnen fragt der Browser einmal nach Erlaubnis.
- **Andere Browser / ZIP-Import:** Optional wird eine Kopie der Bilder im Browser-Speicher angelegt, sonst muss der Ordner bei jedem Öffnen neu gewählt werden.
- **Sicherung** (Schaltfläche *Sicherung*) erzeugt ein ZIP mit allen Projektdaten, optional mit Vorschaubildern und Originalen. Wiederherstellen über den Startbildschirm. Regelmäßig sichern, denn Browser-Daten gehen beim Löschen der Websitedaten verloren.
- **Neu einlesen** ergänzt neue Bilder, erkennt geänderte Dateien und markiert fehlende. Auswahl, Beschriftungen, Bearbeitungen und Paarungen bleiben über den relativen Pfad erhalten.

## Browserrechte und technische Grenzen

- **Ordnerzugriff:** Nur der vom Benutzer gewählte Ordner (und seine Unterordner) ist lesbar, **nur lesend**. Der Browser kann keine Laufwerke selbstständig durchsuchen. Systemordner (z. B. Windows-Systemverzeichnisse) lehnt Chrome ab.
- **Dauerhafter Zugriff** (File System Access API) gibt es nur in Chromium-Browsern (Chrome, Edge, Opera). Firefox und Safari nutzen den klassischen Ordner-Upload: Dabei sind **leere Ordner nicht sichtbar** und der Zugriff gilt nur für die Sitzung.
- **Speicherdialog** zum Speichern des Berichts nur in Chromium, sonst normaler Download.
- **Gespeicherte Projekte hängen an der Adresse:** Was unter `github.io` angelegt wurde, ist bei Doppelklick auf die lokale `index.html` nicht sichtbar (und umgekehrt). Zum Umziehen *Sicherung* → *Sicherung wiederherstellen* nutzen.
- **Doppelklick-Modus (`file://`):** Vorschaubilder entstehen im Hauptthread statt im Worker, bei großen Ordnern also etwas langsamer. Firefox/Safari erlauben dort teils keinen Browser-Speicher, deshalb lieber Chrome/Edge oder die Pages-Adresse nutzen.
- **Formate:** JPEG, PNG, WebP, GIF, BMP, AVIF nativ. **TIFF** über UTIF.js. **HEIC/HEIF**: Safari nativ, sonst über heic2any (langsamer, sehr große HEIC-Dateien können scheitern). RAW (CR2, NEF, DNG …), PSD und SVG werden als Eintrag mit Hinweis angezeigt, aber nicht dargestellt.
- **Aufnahmedatum** nur aus EXIF (`DateTimeOriginal`, ersatzweise Erstellungsdatum). Fehlt es, bleibt das Feld leer, es wird nichts erfunden. Das Änderungsdatum ist das des Dateisystems (beim ZIP-Import das im Archiv gespeicherte).
- **ZIP-Dateinamen:** UTF-8 und alte Windows-Kodierung (CP850) werden erkannt.
- **Inhaltsverzeichnis:** Word fragt beim Öffnen, ob Felder aktualisiert werden sollen. Mit „Ja“ wird das Verzeichnis gefüllt (sonst F9).
- Sehr große Projekte (mehrere tausend Bilder) funktionieren dank virtualisierter Galerie und Hintergrund-Workern, das erste Erzeugen der Vorschaubilder dauert aber entsprechend.

## Architektur

Reines **HTML, CSS und JavaScript**, ohne Framework, ohne Build-Schritt und ohne Server. Die Skripte sind klassische `<script>`-Dateien (keine ES-Module), jede kapselt sich in eine Funktion und meldet ihre Funktionen im Namensraum `window.MB` an. So läuft dieselbe App auf GitHub Pages (HTTPS) und per Doppelklick (`file://`), wo Browser ES-Module blockieren. Die Reihenfolge der `<script>`-Tags in `index.html` ist deshalb wichtig. Bibliotheken liegen im Repo unter `vendor/`, also kein CDN nötig:

| Bibliothek | Zweck |
|---|---|
| docx 9.x | echter Word-Export |
| JSZip | ZIP-Import, Sicherungen |
| exifr | EXIF-Metadaten |
| UTIF.js + pako | TIFF-Dekodierung |
| heic2any | HEIC-Dekodierung (nur bei Bedarf geladen) |

```
index.html, .nojekyll
css/app.css
  js/app.js            Oberfläche, Zustand, Aktionen
  js/scanner.js        Einlesen (Ordner-Handle, Ordner-Upload, Drag & Drop, ZIP)
  js/analyze.js        Struktur → Ordner/Bilder, Rollen, Dokupunkte, Paare
  js/rules.js          konfigurierbare Erkennungsregeln
  js/project.js        Projektzustand, Speichern, Dateizugriff
  js/db.js             IndexedDB
  js/thumbs.js         Vorschaubild-Warteschlange + Cache
  js/thumb-worker.js   Worker: Vorschau + EXIF (nur über https, bei file:// im Hauptthread)
  js/imaging.js        Dekodieren, nicht-destruktive Bearbeitung
  js/report.js         DOCX-Erzeugung
  js/backup.js         Sicherung/Wiederherstellung
  js/ui/*              Baum, Galerie, Vergleich, Betrachter, Editor, Dialoge
vendor/                docx, JSZip, exifr, UTIF, pako, heic2any
```
