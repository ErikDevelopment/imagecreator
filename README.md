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

## Kommentare per .txt-Datei

Liegt in einem Bildordner eine `.txt`-Datei, wird sie zum **Kommentar für diesen Ordner**:

- Der **Dateiname** (ohne `.txt`) ist der Kommentar, z. B. `Stecker war lose, nachgezogen.txt`. Die Datei darf leer sein.
- Steht Text **in** der Datei, wird er zusätzlich übernommen. Bei Allerweltsnamen wie `Neues Textdokument.txt`, `Notiz.txt` oder `Kommentar.txt` zählt nur der Inhalt.
- Kodierung UTF-8, UTF-16 und ältere Windows-Editoren (Windows-1252) werden erkannt.
- Anzeige: 💬 im Ordnerbaum, Kommentarkasten in den Ordnerdetails, im Word-Bericht unter der Überschrift (bei Vorher/Nachher-Ordnern mit Ordnername) und optional unter den Bildern in der Word-Tabelle.
- Kommentare werden bei jedem Einlesen neu aus den Dateien gelesen. Bei bestehenden Projekten einmal **Neu einlesen**.

## Vollständigkeit prüfen (leere Ordner)

Schaltfläche **Vollständigkeit** oben. Die Zahl zeigt, wie viele Ordner **komplett leer** sind, also weder Fotos noch Unterordner enthalten. Ein Ordner, in dem nur eine `.txt` liegt, zählt ebenfalls als leer. Die Prüfung braucht keine festen Ordnernamen und funktioniert mit jeder Struktur.

- Leere Ordner bekommen ⚠ im Ordnerbaum. Vor dem Word-Export erscheint eine Warnung.
- „Zum Ordner“ springt direkt hin, „Ignorieren“ blendet eine Meldung für dieses Projekt aus.
- Zusätzlich als **Hinweise** (ohne Warnzähler): ungleiche Anzahl Vorher/Nachher, nicht bestätigte Vorher/Nachher-Erkennung, Vorher-Ordner ohne Nachher-Ordner, Fotos ohne Auswahl für den Bericht, beschädigte Dateien.

## Vorher/Nachher

- Paare werden nach der ursprünglichen Reihenfolge gebildet und als „automatisch“ gekennzeichnet. Bei ungleicher Anzahl bleiben überzählige Bilder sichtbar („ohne Gegenstück“). Es geht kein Bild verloren.
- In der Ansicht **Vorher / Nachher**: Bild links anklicken, dann rechts → verknüpfen. „Lösen“ trennt ein Paar. Zelle auf Zelle ziehen tauscht, Zeilengriff ⋮⋮ verschiebt ein Paar.
- Vollbild-Vergleich mit optional synchronisiertem Zoom (Mausrad, Ziehen, Doppelklick).
- Darstellung im Bericht je Gruppe: *paarweise Zeilen*, *Gruppen gegenüber* oder *getrennt*.

## Bilder als Word-Tabelle kopieren

Schaltfläche **⧉ Als Word-Tabelle** in der Galerie: Die Bilder werden als Tabelle mit 1–4 Spalten angeordnet. Unter jedem Bild steht standardmäßig **„Bild 1: Ordner / Unterordner“**, fortlaufend nummeriert, mit allen Ordnernamen vom Hauptordner bis zum Bildordner, z. B. „Bild 3: J03 Verdrahtung / Vorher“. So sind Vorher und Nachher unterscheidbar. Kommentare aus `.txt`-Dateien stehen zusätzlich darunter. Alternativ: Ordnername, Dokumentationspunkt – Unterordner, Ordnername – Dateiname oder vollständiger Pfad. Der Word-Bericht nutzt dieselbe Beschriftung „Bild N: Ordner / Unterordner“ als Standard (umstellbar im Berichtsdialog). Quelle: ausgewählte Bilder, aktuelle Ansicht oder das gesamte Projekt. Bearbeitungen werden übernommen.

- **In Zwischenablage kopieren** → in Word mit Strg+V (Mac: ⌘+V) an beliebiger Stelle einfügen.
- **Als Word-Datei speichern** → eigene `.docx` nur mit dieser Tabelle. Der sicherere Weg bei sehr vielen Bildern oder wenn eine Word-Version eingefügte Bilder nicht anzeigt.

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

**Geschwindigkeit:** JPEG-Fotos werden mit WebCodecs `ImageDecoder` direkt verkleinert dekodiert (1/2, 1/4 oder 1/8 der Auflösung, `js/fastdecode.js`). Bei 12-MP-Handyfotos ist das rund 4× schneller als volles Dekodieren. Vorschaubilder und Word-Export laufen parallel in mehreren Web Workern (bis zu 6, je nach Prozessorkernen). Gespeicherte Vorschaubilder werden beim Öffnen in einem einzigen Datenbankzugriff geladen. Die Galerie erzeugt beim Scrollen nur neu sichtbare Kacheln. Browser ohne `ImageDecoder` und Formate wie PNG, HEIC oder TIFF nutzen automatisch den normalen Weg.

**Arbeitsspeicher:** Worker werden nach 2,5 s Leerlauf beendet (gibt ihren Speicher frei), nutzen je eine wiederverwendete Zeichenfläche im Arbeitsspeicher statt im Grafikspeicher, und ihre Anzahl richtet sich nach dem Gerätespeicher (z. B. 4 bei 8 GB). Wichtig: Ein mit `ImageDecoder` dekodierter Frame wird über `createImageBitmap` gezeichnet und nicht direkt mit `drawImage`. Der direkte Weg hält in Chrome pro Bild die ganze Datei im Speicher (gemessen +229 MB bei 300 Fotos, führte zu Browserabstürzen). Ab 250 Bildern empfiehlt der Berichtsdialog die Qualität „Kompakt“.

Messung (600 Fotos à 12 MP, Testrechner mit nur 2 Kernen):

| | vorher | nachher |
|---|---|---|
| alle Vorschaubilder erzeugen | 28,4 s | 9,7 s |
| erste Vorschaubilder sichtbar | 0,86 s | 0,19 s |
| Word-Export (40 Bilder) | 7,1 s | 3,6 s |
| Projekt erneut öffnen, alles geladen | – | 0,4 s |
| Speicher der Seite nach dem Einlesen (Spitze / Leerlauf) | 740 / 620 MB | 280 / 165 MB |

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
  js/thumb-worker.js   Worker: Vorschau + EXIF + Bildvorbereitung für den Export (nur über https, bei file:// im Hauptthread)
  js/fastdecode.js     schnelles verkleinertes JPEG-Dekodieren (Hauptprogramm und Worker)
  js/imaging.js        Dekodieren, nicht-destruktive Bearbeitung
  js/report.js         DOCX-Erzeugung
  js/backup.js         Sicherung/Wiederherstellung
  js/ui/*              Baum, Galerie, Vergleich, Betrachter, Editor, Dialoge
vendor/                docx, JSZip, exifr, UTIF, pako, heic2any
```
