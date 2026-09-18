# Dynamic Action Panel – Cell Selection & Cell Colors (Produktspezifikation v1)

- **Datum:** 2026-09-18 (zweite Runde am selben Tag: Abschnitte 4a, 8.2 und 19)
- **Status:** Produktspezifikation, **implementiert** (Umsetzungsstand: Abschnitt 18). Keine
  Datei-/Format-Änderung, kein `settingsVersion`-Bump.
- **Grundlage:** Nutzerentscheidungen vom 2026-09-18 (hier als beschlossen geführt) plus die
  Code-Befunde aus `docs/ocap/audits/2026-09-18-selection-color-architecture.md`.
- **Verhältnis zum Audit:** Das Audit empfahl einen expliziten „Select cells“-Sub-Mode mit
  Toggle-Selection, Shift-Rechteck und Marquee. Diese Spezifikation **ersetzt** jenes
  Interaktionsmodell (Abschnitte 3, 5, 5.5, 6 und Entscheidung 3/5 der dortigen Matrix).
  Alles Übrige des Audits — Datenmodell, Zustandseigentum, Invarianten, Farbwertmodell,
  visuelle Kanäle, Risikoliste — bleibt gültig und wird hier referenziert statt wiederholt.

---

## 1. Zweck und Abgrenzung

Der Nutzer soll im Edit Mode eine oder mehrere **Grid-Zellen** auswählen und ihnen anschließend
eine Farbe geben können. Leere Zellen sind dabei gleichwertige Auswahlziele.

Selection ist ausdrücklich ein **allgemeiner Mechanismus**, kein Teil des Farbfeatures.
Cell Colors sind der erste Consumer; weitere folgen (Abschnitt 14). Die UX darf deshalb an keiner
Stelle so gebaut werden, dass sie ohne Farben bedeutungslos wäre.

---

## 2. Begriffe — Zelle, nicht Slot

Diese Unterscheidung ist normativ und keine Wortklauberei:

| Begriff | Bedeutung | Identität |
|---|---|---|
| **Zelle** | eine Position im Raster | Koordinate `r<row>c<column>`, z. B. `r1c2` |
| **Slot** | flacher Index der Tool-Platzierung | `0..n`, abhängig von der Spaltenzahl |

**Die Auswahleinheit ist die Zelle (Koordinate), nicht der Slot.** Grund: Ein Slot-Index wechselt
seine Bedeutung, sobald sich die Spaltenzahl ändert — Slot 5 ist bei 4 und bei 3 Spalten eine
andere Position. Die Koordinate bleibt dieselbe Zelle. Es ist außerdem exakt der Schlüssel, unter
dem `cellStyles` bereits persistiert wird (`src/types/settings.ts:234-243`).

Wo dieses Dokument umgangssprachlich „Slot“ sagt, ist immer die Zelle gemeint.

Ein **Grid-Kontext** ist das Paar `(categoryId, variantId | null)` — `null` genau dann, wenn die
Kategorie ein statisches Grid ist. Eine dynamische Kategorie hat pro Variant ein eigenes,
vollständiges Grid mit eigenen Farben.

---

## 3. Moduskontrakt

Das Panel kennt genau zwei Interaktionsmodi (`InteractionMode = 'locked' | 'edit'`; der frühere
dritte Modus `sort` wurde in Settings-Version 4 in `edit` aufgelöst).

| | Locked Mode | Edit Mode |
|---|---|---|
| Linksklick auf Tool | **führt das Tool aus** | **wählt die Zelle aus** — führt nichts aus |
| Linksklick auf leere Zelle | ohne Wirkung | wählt die Zelle aus |
| Rechtsklick auf Tool | ohne Wirkung | Kontextmenü (Bearbeiten, Kopieren, Löschen) — unverändert |
| Drag | aus | Move/Swap — unverändert |
| Zellfarben sichtbar | **ja** | ja |
| Selection möglich | nein | ja |
| `+` auf leerer Zelle | nein | ja |

**Beschlossene Verhaltensänderung:** Im Edit Mode führt ein Klick ein Tool nicht mehr aus. Bisher
tat er das (es gibt im Bestand keinerlei Mode-Guard), was ein Unfall des Upstream-Codes war und die
gefährlichere der beiden Bedeutungen darstellte — ein verrutschter Klick konnte ein Script starten.

**Akzeptierte Konsequenzen:**

- Ein Tool testet man, indem man in den Locked Mode schaltet. Es gibt dafür keinen Ersatzpfad im
  Edit Mode, und es soll auch keinen geben (kein „Ausführen“ im Kontextmenü).
- Bestandsnutzer erleben eine stille Verhaltensänderung. Es gibt **keine** einmalige Hinweismeldung;
  der Auswahlrahmen auf der geklickten Zelle plus die dauerhaft sichtbare Farbleiste erklären das
  neue Verhalten beim ersten Klick selbst.
- **Tastatur:** Ein per Tab fokussiertes Tool darf im Edit Mode auch mit Enter oder Leertaste
  **nichts ausführen**. Die Regel gilt für die Bedeutung des Aktivierens, nicht für die Eingabeart.
  **Präzisierung aus der Umsetzung (2026-09-18):** Eine Tastaturaktivierung ist nicht wirkungslos,
  sondern bedeutet dasselbe wie ein Klick auf dieselbe Zelle — sie wählt sie aus, und mit
  gehaltenem Shift bzw. Strg gelten dieselben drei Gesten. Das ist keine Umdeutung der Gesten,
  sondern ihre konsequente Anwendung auf die gleichwertige Eingabeart, und es ist deutlich besser
  als eine tote Taste. Eine **Navigation** der Auswahl per Pfeiltasten gibt es weiterhin nicht
  (Abschnitt 15).

---

## 4. Selection-Semantik (beschlossen)

Die Auswahl bezieht sich auf **Zellen**. Leere und belegte Zellen verhalten sich vollkommen
identisch; der Auswahlmechanismus weiß nicht, ob eine Zelle belegt ist.

### 4.1 Die drei Gesten

```
Normal  = ersetzen
Shift   = hinzufügen
Strg    = entfernen
```

| Geste | Zelle ist nicht ausgewählt | Zelle ist ausgewählt |
|---|---|---|
| **Linksklick** | Auswahl verwerfen, nur diese Zelle auswählen | Auswahl verwerfen, nur diese Zelle auswählen (bleibt also ausgewählt) |
| **Shift + Linksklick** | Zelle zur Auswahl **hinzufügen** | **keine Änderung** |
| **Strg + Linksklick** | **keine Änderung** | Zelle aus der Auswahl **entfernen** |

Das ist das klassische Selection-Modell aus Desktop- und DCC-Anwendungen. Ausdrücklich gilt:

- **Shift wählt niemals ab.** Es ist rein additiv.
- **Strg wählt niemals aus.** Es ist rein subtraktiv.
- **Es gibt kein Toggle.** Ein zweiter Linksklick auf die einzige ausgewählte Zelle lässt sie
  ausgewählt — er ersetzt die Auswahl durch sich selbst. Diese Regel ist ausdrücklich festgehalten,
  damit sich später kein Toggle-Verhalten einschleicht.
- **Ein Modifier-KLICK betrifft genau eine Zelle.** Die geometrische Bedeutung von Shift/Strg
  entsteht ausschließlich durch Ziehen (Abschnitt 4a); ein Shift-Klick ist nie eine
  Von-bis-Auswahl.

---

## 4a. Rechteck-Auswahl per Modifier-Drag (beschlossen 2026-09-18, ersetzt das frühere Nichtziel)

**Diese Entscheidung hebt den ursprünglichen Punkt „keine Rechteck-Auswahl" in Abschnitt 4.1 und
das Nichtziel „Marquee-/Rahmenauswahl" in Abschnitt 15 bewusst auf.** Der Grund ist Erfahrung am
laufenden Panel: Zwölf Zellen einzeln per Shift anzuklicken ist die häufigste Aktion und zugleich
die mühsamste.

Die Semantik ist **dieselbe wie beim Klick**, nur auf eine Fläche statt auf eine Zelle angewandt:

```
Shift + Klick = eine Zelle hinzufügen      Shift + Ziehen = Rechteck hinzufügen
Strg  + Klick = eine Zelle entfernen       Strg  + Ziehen = Rechteck entfernen
```

Es gibt **keinen zusätzlichen Modus**. Das Panel kennt weiterhin genau `locked` und `edit`; ein
Modifier ist eine temporäre Geste, kein Zustand.

### 4a.1 Geometrie

Das Rechteck wird zwischen der Zelle beim PointerDown (**Anker**) und der aktuell adressierten
Zielzelle aufgespannt, **inklusiv auf beiden Seiten**:

```
min(row)…max(row)  ×  min(column)…max(column)
```

Richtungsfrei: `r2c3 → r1c1` liefert denselben Block wie `r1c1 → r2c3`. Der Weg zwischen Anfang und
Ende ist bedeutungslos — es ist kein Pinsel (Abschnitt 15).

**Die Einheit ist die Zelle, nie das Pixel.** Es gibt keinen Überlappungsanteil, keine 50-%-Schwelle
und damit nie die Frage „ist dieser Button halb ausgewählt?".

### 4a.2 Zielzelle, Lücken und Ränder

Der Zeiger adressiert **immer genau eine Zelle, nie keine**. Gemessen wird gegen die Mitten der
Grid-Tracks:

- innerhalb einer Zelle → diese Zelle;
- in der 4-px-Lücke → der nähere der beiden Nachbarn; exakt auf der Mitte gewinnt der spätere Track
  (ein willkürlicher, aber *fester* Tiebreak — Hauptsache die Geste flackert nicht);
- außerhalb des Grids → der Rand-Track. Über den Rand hinauszuziehen erweitert das Rechteck weiter,
  statt die Geste abzubrechen.

Dadurch gibt es keine toten Zonen, auch nicht am Kreuz zwischen vier Zellen.

### 4a.3 Live-Vorschau

Während des Ziehens aktualisiert sich **die bestehende Auswahl-Darstellung der betroffenen Zellen**.
Es wird ausdrücklich **kein** freies Pixel-Rechteck gezeichnet (kein Overlay, kein Canvas, kein
SVG): Das Rechteck „snappt" sichtbar auf ganze Zellen, was genau die Einheit ist, in der es rechnet.
Ein freies Preview-Rechteck bleibt eine spätere Option, falls sich das Snapping klobig anfühlt.

### 4a.4 Baseline

Beim PointerDown wird die bestehende Auswahl als **Baseline** festgehalten; jeder Schritt der Geste
wird daraus neu abgeleitet:

```
Shift: preview = baseline ∪ rechteck
Strg:  preview = baseline − rechteck
```

Niemals inkrementell pro PointerMove. Nur so führt Aufziehen-und-wieder-Zusammenziehen innerhalb
*derselben* Geste zuverlässig auf `baseline ± aktuelles Rechteck` zurück.

### 4a.5 Modifier reserviert die Auswahl — nicht Drag-and-Drop

Sobald ein PointerDown Shift oder Strg/Cmd trägt, gehört die Geste der Auswahl, und zwar
vollständig: **kein Tool-Move, kein Swap, kein Category-Reorder** — auf belegten wie auf leeren
Zellen. Die Geste wird **beim PointerDown** entschieden; ein später gedrücktes Shift verwandelt
einen laufenden Drag nicht nachträglich, und ein losgelassener Modifier macht aus einer
Auswahl-Geste keinen Drag.

Umgesetzt an zwei Stellen, ohne globalen Schalter, der nach einem KeyUp hängen bleiben könnte:

- **im Grid** fängt `CategoryButtonGrid` den Druck in der **Capture-Phase** ab, bevor er den
  dnd-kit-Aktivator des Tools darunter oder den Kategorie-Drag darüber erreicht;
- **außerhalb** (Kategorie-Header der List-View, Tabs, Folder-Kacheln) umhüllt
  `suppressDragOnSelectionModifier` die dnd-kit-Listener. Dort gibt es keine Zelle, also startet
  auch kein Rechteck — der Modifier unterdrückt schlicht den Drag.

Ohne Modifier bleibt alles unverändert: Move/Swap, Category-Reorder, File-Drop, Grid-Resize.

### 4a.6 Klick-Fallback und Abbruch

Unterhalb der bestehenden Drag-Schwelle (4 px, dieselbe euklidische Distanz wie der Drag-Sensor)
ist die Geste ein **Klick** und bedeutet exakt das Bisherige: Shift fügt eine Zelle hinzu, Strg
entfernt eine. Oberhalb der Schwelle rastet sie ein und bleibt ein Rechteck, auch wenn der Zeiger
zum Ausgangspunkt zurückwandert — der anschließende Klick wird dann verworfen.

- **Escape** während der Geste bricht das Rechteck ab: die Auswahl kehrt auf die Baseline zurück,
  nichts wird geschrieben. Das panelweite Escape (Auswahl leeren) tritt dafür zurück, solange eine
  Geste läuft — sonst feuerten beide auf dieselbe Taste und der Abbruch endete in einer leeren
  statt in der ursprünglichen Auswahl.
- **`pointercancel`** (verlorener Zeiger) wird wie Escape behandelt: sauberer Abbruch auf die
  Baseline, kein Schreibvorgang, keine hängende Interaktion.

### 4a.7 Ausdrücklich nicht gebaut

- **Kein Explorer-Range.** `Klick r1c1`, dann `Shift-Klick r1c5` wählt **nicht** r1c1–r1c5 aus.
  Shift-Klick bleibt „genau eine Zelle hinzufügen"; das Rechteck-Ziehen deckt den Fall flexibler ab.
- **Kein Pinselmodus.** Mit gehaltenem Shift über Zellen zu fahren malt keine Auswahl; relevant ist
  nur das Gebiet zwischen Anker und aktueller Zelle.
- **Kein freies Pixel-Marquee**, siehe 4a.3.
- **Keine Tastatur-Range** (Pfeiltasten, Ctrl+A) — unverändert, siehe Abschnitt 15.

### 4.2 Abgeleitete Regeln

- **Auswahl leeren:** Escape. Oder jede Zelle einzeln per Strg abwählen. Ein Linksklick kann die
  Auswahl nie auf leer bringen (er hinterlässt immer genau eine Zelle).
- **Klick in die Lücke zwischen zwei Zellen** (4 px): **keine Wirkung.** Weder Auswahl setzen noch
  leeren. Die Fläche ist zu klein, um Absicht zu unterstellen.
- **Klick außerhalb des Grids:** **keine Wirkung.** Kein Leeren. Begründung: In der Folder-View ist
  „außerhalb“ mehrdeutig mit dem Schließen des Ordners, in der List-View mit dem Bereich einer
  anderen Kategorie. Ein einheitliches „passiert nichts“ ist vorhersehbarer als eine
  view-abhängige Regel; Escape ist der explizite Weg.
- **Höchstens ein Grid trägt eine Auswahl.** Ein Linksklick in das Grid einer anderen Kategorie
  verschiebt die Auswahl dorthin und verwirft die alte — das ist einfach „ersetzen“ über die
  Grid-Grenze hinweg. Shift und Strg wirken **nur innerhalb des Grids, das die Auswahl bereits
  hält**; auf ein fremdes Grid angewandt bleiben sie wirkungslos (sonst entstünde eine unsichtbare
  Auswahl über zwei Kategorien).
- **Mehrere Panel-Leaves** haben jeweils ihre eigene, unabhängige Auswahl.
- **Escape** leert die Auswahl. In der Folder-View schließt Escape heute den geöffneten Ordner —
  die Auswahl hat Vorrang: erstes Escape leert die Auswahl, ein weiteres schließt den Ordner.

### 4.3 Mac

Auf macOS ist Strg+Klick der Sekundärklick und löst ein Kontextmenü aus. Die hier beschriebene
Semantik bleibt davon unberührt: Auf macOS übernimmt **Cmd** die subtraktive Rolle, und Strg+Klick
bleibt dort der Sekundärklick. Das ist eine reine Tastenzuordnung, keine Semantikänderung.

---

## 5. Drag

- **Klick + Ziehen auf einem Tool** bleibt das bestehende Move-/Swap-Verhalten. Die Aktivierung
  liegt wie bisher bei 4 px Zeigerbewegung; ein Klick, der sich nicht bewegt, startet nie einen Drag.
- **Ein erfolgreicher Drag löst beim Loslassen keinen Selection-Klick aus.** Der dafür nötige
  Mechanismus existiert im Bestand bereits als Guard gegen den Ausführungs-Klick und muss lediglich
  den Selection-Klick ebenso abdecken.
- **Ein Drag verändert die Auswahl nicht.** Er wählt die gegriffene Zelle nicht aus und leert nichts.
  Begründung: Selection ist ein Batch-Werkzeug, Drag ist Umräumen. Würde jedes Umräumen eine
  aufgebaute Auswahl zerstören, ließen sich beide nie zusammen benutzen.
- **Kein Multi-Drag in v1.** Auch bei mehreren ausgewählten Zellen bewegt ein Drag ausschließlich
  das tatsächlich gegriffene Tool.
- **Die Auswahl folgt dem Tool nicht.** Wird ein Tool aus einer ausgewählten Zelle herausgezogen,
  bleibt **die Zelle** ausgewählt. Dasselbe gilt beim Swap: die Zellen bleiben ausgewählt, die
  Tools tauschen die Plätze. Das ist die zwingende Konsequenz daraus, dass Auswahl und Farbe an der
  Koordinate hängen, und es ist dieselbe Regel, nach der ein Tool-Drag auch keine Farbe mitnimmt.
- **Ein Drop aus einem anderen Grid** in eine ausgewählte Zelle ist unproblematisch: Die Zelle
  bleibt dieselbe ausgewählte Zelle, ihre Farbe bleibt unverändert.

---

## 6. Leere Zellen und das `+`

Leere Zellen werden vollwertige Auswahlziele. Das `+` darf deshalb nicht mehr die gesamte Zellfläche
belegen (heute ist es `width/height: 100%`).

**Gestalt:**

- kleine `+`-Affordance **oben rechts**, vom Rand **eingerückt** (~4 px), sodass die Außenkante der
  Zelle immer Auswahlfläche bleibt und die `+`-Ziele zweier benachbarter Zellen nie aneinandergrenzen;
- **nur im Edit Mode**;
- im Normalzustand **dezent** sichtbar, bei **Hover der Zelle deutlich** — nicht erst bei Hover
  *erscheinend*, das kostet Auffindbarkeit;
- brauchbarer, aber nicht übergroßer Hit-Target, **nicht mit der Zelle mitskalierend**: Bei 150 px
  Panelbreite und 4 Spalten ist eine Zelle rund 33 px breit, ein 18-px-`+` also bereits gut ein
  Viertel der Zellfläche.

**Umgesetzte Maße (2026-09-18):** 18 × 18 px, 2 px eingerückt. Die Größe liegt im vom Nutzer
vorgegebenen Band (16–20 px); die Einrückung ist kleiner als die hier ursprünglich genannten ~4 px,
weil bei 5 Spalten in einer 150-px-Sidebar eine Zelle nur noch ~26 px breit ist und 4 px Einrückung
plus 18 px Button praktisch keine Außenkante mehr übrig ließen. Die Werte sind in
`tests/paletteGridGeometry.test.ts` als Kontrakt festgehalten.

**Verhalten:**

```
Klick auf die Zellfläche      → Selection
Klick direkt auf das +        → Tool genau dort erstellen
```

**Modifier haben Vorrang.** Wird Shift oder Strg gehalten, ist das `+` **keine** Schaltfläche,
sondern gewöhnliche Zellfläche: Der Klick zählt als Selection-Geste auf dieser Zelle und öffnet
niemals den Create-Dialog. Das entschärft den schlimmsten Fehlklick — ein Modal mitten im
Mehrfach-Auswählen.

**Weitere Regeln:**

- Bewegt sich der Zeiger zwischen Down und Up um ≥ 4 px, ist es kein `+`-Klick.
- Ein Klick auf das `+` **verändert die bestehende Auswahl nicht** — er ist keine Selection-Geste.
  Nach dem Schließen des Dialogs steht die vorherige Auswahl unverändert da.
- Das `+` erscheint nur auf **leeren** Zellen (unverändert zum Bestand).

---

## 7. Cell Colors

Farben gehören der **Zelle**, nicht dem Tool. Deshalb können leere Zellen gefärbt sein, und deshalb
nimmt ein Tool seine Farbe beim Verschieben nicht mit.

Das bestehende Datenmodell bleibt unverändert und braucht keinen `settingsVersion`-Bump: `cellStyles`
liegt auf dem Besitzer des Grids (Kategorie bei statischem Grid, Variant bei dynamischem), ist mit
`r<row>c<column>` gekeyt, und ein Farbwert ist entweder ein Hex-Literal oder ein portabler Name
`ocap:<name>`. Es wird **nie** ein `var(--…)` oder ein CSS-Klassenname persistiert.

### 7.1 Palette v1

Sechs Farben plus „Keine Farbe“:

| Anzeige | Gespeicherter Wert | Auflösung beim Rendern |
|---|---|---|
| Gelb | `ocap:yellow` | `--color-yellow-rgb` |
| Rot | `ocap:red` | `--color-red-rgb` |
| Grün | `ocap:green` | `--color-green-rgb` |
| Blau | `ocap:blue` | `--color-blue-rgb` |
| Lila | `ocap:purple` | `--color-purple-rgb` |
| Grau | `ocap:gray` | **Sonderfall, siehe unten** |
| Keine Farbe | kein Eintrag | — |

Benannte Farben werden **erst beim Rendern** auf Obsidians Theme-Variablen aufgelöst. Damit folgt
die Optik dem Theme (hell/dunkel, Custom Themes), während der gespeicherte Wert portabel bleibt und
einen Template-Export unbeschadet übersteht.

**Grau hat keine `--color-gray-rgb`.** Obsidians Farbvariablen umfassen red, orange, yellow, green,
cyan, blue, purple und pink — kein Grau. `ocap:gray` wird deshalb aus
`rgba(var(--mono-rgb-100), α)` aufgelöst: schwarz im hellen, weiß im dunklen Theme, bei geringer
Deckkraft also ein themekonformes Grau. Dieses Muster hat im Projekt bereits Präzedenz (Grid-Raster
und Resize-Griffe nutzen es).

**Der Resolver muss mehr Namen kennen, als die Palette anbietet.** Auch `ocap:orange`, `ocap:cyan`
und `ocap:pink` müssen korrekt gerendert werden, obwohl v1 keine Swatches dafür zeigt — solche
Werte können jederzeit per Template-Import eintreffen, und sie würden sonst stillschweigend als
ungefärbt erscheinen (Datenverlust im Auge des Nutzers, obwohl die Daten intakt sind). Ebenso
müssen Hex-Werte gerendert werden, obwohl v1 keinen Colorpicker hat.

**Unbekannte `ocap:`-Namen** rendern als „keine Farbe“ und bleiben in den Daten **unangetastet**.
Nie umschreiben, nie ablehnen, nie beim Speichern aufräumen.

### 7.2 Farbe anwenden

```
Auswahl vorhanden + Klick auf Farbfeld   → alle ausgewählten Zellen bekommen diese Farbe
Auswahl vorhanden + Klick auf „Keine Farbe“ → Farbe aller ausgewählten Zellen wird entfernt
Keine Auswahl + Klick auf ein Farbfeld   → wirkungslos
```

- **Die Auswahl bleibt nach dem Färben bestehen.** Man kann also erst Rot, dann Blau probieren, ohne
  neu auszuwählen. Das ist gleichzeitig der praktische Ersatz für ein Undo (Abschnitt 13).
- Leere und belegte Zellen werden vollkommen gleich behandelt.
- „Keine Farbe“ löscht den Eintrag. Wird die Farbtabelle dadurch leer, verschwindet sie ganz, sodass
  unberührte Konfigurationen byte-gleich zu Daten von vor diesem Feature bleiben.

---

## 8. Farbe als Selection-Werkzeug

Die tragende Regel dieses Bereichs:

> **Ein Modifier auf einem Farbfeld schreibt nie.** Er verändert ausschließlich die Auswahl.

Damit ist das Farbfeld gefahrlos zu erkunden: Der einzige Klick, der die Konfiguration verändert,
ist der Klick ohne Modifier.

```
Strg + Klick auf Rot
→ Auswahl wird ersetzt durch alle roten Zellen des aktuell sichtbaren Grids
```

- Gilt ausdrücklich **auch für leere gefärbte Zellen**.
- Strikt nur im **aktuell sichtbaren Grid-Kontext** — also in genau der Kategorie und genau der
  Variant, die gerade angezeigt wird. Niemals über andere Kategorien oder Varianten hinweg.
- `Strg + Klick auf „Keine Farbe“` wählt alle **ungefärbten** Zellen des Grids aus. Das fällt gratis
  an und beantwortet die häufige Frage „was habe ich noch nicht eingefärbt?“.
- Findet sich keine Zelle der Farbe, ist die Auswahl anschließend **leer**, ohne Meldung. Das leere
  Ergebnis ist die Antwort.
- Verglichen wird der **rohe gespeicherte Wert**, nicht die gerenderte CSS-Farbe. Ein `ocap:red` und
  ein zufällig gleich aussehendes Hex sind verschiedene Farben.

**Bewusst akzeptierte Asymmetrie:** Strg bedeutet auf einer *Zelle* „entfernen“ und auf einem
*Farbfeld* „ersetzen“. Das sind verschiedene Oberflächen mit verschiedenen Aufgaben; verbindend ist
allein die Regel oben — ein Modifier schreibt nie. Sie ist im Tooltip zu benennen, nicht der
Intuition zu überlassen.

### 8.1 Shift auf einem Farbfeld (entschieden 2026-09-18)

```
Shift + Klick auf Farbfeld
→ alle Zellen dieser Farbe zur bestehenden Auswahl hinzufügen
```

Damit ist `Strg + Rot`, dann `Shift + Blau` = alle roten **und** blauen Zellen gemeinsam
auswählen und in einem Zug umfärben. Konsistent mit „Shift = hinzufügen“ überall sonst, und es
schreibt nicht.

Verworfen wurde „Shift = wie ein normaler Klick“: ein verrutschter Shift würde dann schreiben und
bräche die Regel *Modifier schreibt nie*.

`Strg+Shift` auf einem Farbfeld hat in v1 **keine eigene Bedeutung**. Es löst deterministisch nach
derselben Prioritätsregel auf wie auf einer Zelle — Shift gewinnt, die Geste ist also `hinzufügen`.
Die Lesart „alle dieser Farbe aus der Auswahl entfernen“ bleibt für später reserviert.

### 8.2 Ephemere Auswahlfarbe (beschlossen 2026-09-18)

Wer eben Rot auf seine Auswahl angewendet hat und sie danach per Shift erweitert, meint fast immer:
**die neuen Zellen bitte auch rot.** Dafür gibt es keinen Pinsel und keinen Modus, sondern eine
Eigenschaft der *laufenden Auswahl*:

```
Auswahl vorhanden + normaler Klick auf ein Farbfeld
→ Farbe anwenden (unverändert)
→ zusätzlich: diese Farbe ist ab jetzt die Auswahlfarbe
```

- **„Keine Farbe“ ist eine ebenso bewusste Wahl** und wird genauso scharf gestellt: danach
  hinzugefügte Zellen werden ungefärbt.
- **Modifier-Klicks auf Farbfeldern ändern sie nie** — sie schreiben nicht, und sie stellen nichts
  scharf. Die Regel „ein Modifier auf einem Farbfeld schreibt nie“ bleibt vollständig gültig.
- **Ohne Auswahl passiert nichts**, insbesondere wird nichts scharf gestellt. Es gibt keinen
  dauerhaft „bewaffneten“ Farbpinsel.

**Wirkung:** Eine additive Geste — Shift-Klick wie Shift-Rechteck — färbt **genau die Zellen, die
sie neu hinzufügt**. Bereits ausgewählte Zellen werden nicht erneut angefasst, und ein
Strg-Entfernen färbt grundsätzlich nichts: Eine rote Zelle, die aus der Auswahl entfernt wird,
bleibt rot. Auswahl und Zellfarbe bleiben getrennte Konzepte.

**Lebensdauer:** Die Auswahlfarbe gehört der Auswahl-Session und stirbt mit ihr — Auswahl geleert,
Escape, Edit-Mode verlassen, Kategorie oder Variant gewechselt, Grid-Kontext gewechselt. Eine Regel
deckt alle diese Fälle ab, weil sie alle damit enden, dass die Auswahl ein anderes Grid oder gar
keines mehr benennt. Sie wird **nicht persistiert**: nicht in `data.json`, nicht in den Settings,
nicht in einem Template.

**Schreibverhalten:** Während des Ziehens wird **nichts** gespeichert; die Zellen zeigen die Farbe
nur als Vorschau. Beim Loslassen fällt **genau eine** gebündelte Persistenzoperation für alle neu
hinzugekommenen Zellen an. Die Vorschau bleibt stehen, bis der Schreibvorgang wirklich in den
gespeicherten Farben angekommen ist — sonst blitzte für ein paar Frames die alte Farbe auf, während
die Settings nachziehen (dasselbe Problem, für das die Resize-Vorschau ihre Geometrie hält). Ein
abgebrochener oder abgelehnter Schreibvorgang lässt die Vorschau sofort fallen.

---

## 9. Darstellung

Persistente Zellfarbe und temporäre Auswahl dürfen nie verwechselbar sein. Sie belegen deshalb
getrennte visuelle Kanäle:

| Zustand | Kanal |
|---|---|
| **Zellfarbe** | `background-color` der Zelle |
| **Auswahl** | `outline` in der Akzentfarbe, nach innen versetzt |

Eine rote ausgewählte Zelle ist damit gleichzeitig eindeutig rot **und** eindeutig ausgewählt.

Warum ausgerechnet `outline`: `border-color` ist im Bestand für Drop-Ziele und File-Drop-Ziele
vergeben (diese Ringe versprechen, wo ein Drop landet, und dürfen nicht überschrieben werden),
`border-width` ist durch die Geometrie-Invariante des Grids gesperrt, eine gestrichelte Outline
bedeutet bereits „vom Kontext ausgeblendet“, und `opacity` ist ebenfalls belegt. `outline` ist der
einzige freie Kanal und nimmt nie am Layout teil — die Zellgeometrie bleibt in jedem Modus identisch.

**Die Zellfarbe füllt die Zelle bis an ihre Kante, sichtbar über die Tool-Schaltfläche hinaus.** Das
ist nicht bloß Ästhetik: Es ist die einzige Möglichkeit, dem Nutzer beizubringen, dass die Farbe der
*Kachel* gehört und nicht dem Tool — die Voraussetzung dafür, dass „das Tool nimmt seine Farbe beim
Verschieben nicht mit“ nicht als Fehler gelesen wird.

Die Auswahl wird **nicht persistiert**. Sie existiert nur zur Laufzeit.

---

## 10. Die Farbleiste

**Ort:** beim Grid, im Edit Mode, **unterhalb des Grids**. Nicht schwebend über den Zellen (das
verdeckt genau die Zellen, die sie färbt) und nicht in der globalen Navigationsleiste (ein
panelweites Bedienelement für eine Geste, die einem einzelnen Grid gehört).

**Sichtbarkeit: dauerhaft im Edit Mode**, nicht erst bei bestehender Auswahl. Zwei konkrete Gründe:

1. Eine Leiste, die bei der ersten Auswahl erscheint, **verschiebt das Grid unter dem Zeiger**. Der
   unmittelbar folgende Shift-Klick landet dann auf der falschen Zelle. Dauerhaft montiert bewegt
   sich nichts.
2. `Strg + Farbfeld` ist ein **Auswahlwerkzeug** und muss ohne bestehende Auswahl funktionieren. Eine
   Leiste, die es erst mit Auswahl gibt, kann das nicht leisten.

**Ohne Auswahl** sind die Swatches gedimmt (ein Klick ohne Modifier ist wirkungslos), bleiben aber
Strg-klickbar. Die Dimmung erklärt visuell, warum ein Klick gerade nichts tut.

**Gestalt:** kompakte Swatches von etwa 18–20 px mit rund 6 px Abstand, in einer umbrechenden Reihe.
Bewusst **deutlich kleiner als eine Grid-Zelle** — die Palette darf nie wie eine weitere Grid-Zeile
aussehen. „Keine Farbe“ ist ein Swatch desselben Formats in derselben Reihe, dargestellt als
diagonaler Strich auf transparentem Grund, ohne Text: Es ist dieselbe Art von Aktion und nimmt an
denselben Regeln teil.

**Aktiv-Indikator:**

| Zustand der Auswahl | Anzeige |
|---|---|
| alle ausgewählten Zellen haben dieselbe Farbe | dieses Swatch ist als aktiv markiert |
| alle ausgewählten Zellen sind ungefärbt | „Keine Farbe“ ist als aktiv markiert |
| gemischte Farben | **kein** Swatch aktiv |
| keine Auswahl | kein Swatch aktiv |

**Kommunikation von `Strg + Farbfeld`:** Der Tooltip jedes Swatches nennt alle drei Bedeutungen
(`Klick: anwenden · Strg+Klick: diese Zellen auswählen · Shift+Klick: hinzufügen`). Alle
Beschriftungen laufen über die bestehende i18n-Mechanik.

**Zurückgestellt (2026-09-18):** Die zusätzliche Idee, die Leiste beim *Halten* eines Modifiers
sichtbar in den Auswahlmodus kippen zu lassen und dabei Farben auszugrauen, die im aktuellen Grid
nicht vorkommen, ist in v1 **nicht umgesetzt**. Sie bräuchte einen dokumentweiten Keydown/Keyup-
Zustand pro sichtbarem Grid; der Nutzen rechtfertigt dieses Risiko nicht, solange das Feature noch
nicht manuell erprobt ist. Sie bleibt ein Polish-Kandidat.

---

## 11. Lebensdauer der Auswahl

Die Auswahl ist **ephemer** und wird nie gespeichert. Sie wird verworfen bei:

- Verlassen des Edit Mode;
- Wechsel der Kategorie beziehungsweise Auswahl in einem anderen Grid;
- Wechsel der Dynamic Variant (Dropdown, ⇄-Flip, Duplicate, New, Delete);
- jedem anderen Wechsel des Grid-Kontexts — Kategorie gelöscht, statisches Grid dynamisch gemacht,
  Grid in eine Flow-Kategorie umgewandelt, Ansicht gewechselt, Kategorie eingeklappt, Ordner
  geschlossen, Plugin oder View neu geladen;
- Escape.

**Es gibt keine unsichtbaren Auswahlen.** Eine Auswahl existiert nur, solange das Grid, zu dem sie
gehört, sichtbar und bedienbar ist. Es wird insbesondere **keine** Auswahl pro Variant aufbewahrt und
beim Zurückwechseln wiederhergestellt — eine wieder auftauchende Auswahl würde die nächste
Farbaktion still umadressieren.

**Ein Commit beendet die Auswahl nicht.** Nach dem Anwenden einer Farbe bleiben Auswahl und Ansicht
bestehen (Abschnitt 7.2).

**Ein latenter Fallstrick, der zu berücksichtigen ist:** Bei einer dynamischen Kategorie, deren
Variant nie explizit gewählt wurde, wird die angezeigte Variant aus dem Obsidian-Kontext abgeleitet.
Wechselt der Nutzer im Edit Mode die aktive Notiz, kann das angezeigte Grid also unter dem Zeiger
wechseln. Beim Beginn einer Auswahl in einer dynamischen Kategorie muss die angezeigte Variant
deshalb explizit festgeschrieben werden; weicht der Auswahlkontext dennoch je vom angezeigten Grid
ab, wird die Auswahl verworfen statt umadressiert.

---

## 12. Farben außerhalb des Edit Mode

Zellfarben sind **Inhalt** und deshalb in **jedem** Modus sichtbar, auch im Locked Mode. Nur die
Auswahl und die Bearbeitungs-Affordances (`+`, Kontextmenüs, Drag, Farbleiste) gehören dem Edit Mode.

**Konsequenz, bewusst so gewollt:** Eine leere, aber gefärbte Zelle ist im Locked Mode als farbige
Kachel sichtbar, obwohl dort kein Tool steht. Das ist kein Nebeneffekt, sondern eine Fähigkeit:
Gefärbte Leerzellen werden zu Trennern, Gruppenmarkierungen und reservierten Plätzen. Die
Spezifikation hält ausdrücklich fest, dass diese Zellen im Locked Mode **nicht** klickbar werden —
sie sind Fläche, nicht Bedienelement.

---

## 13. Rastergröße, Umbau und Undo

- **Grid-Resize bleibt im Edit Mode verfügbar**, auch bei bestehender Auswahl (es gibt keinen
  Sub-Mode, der ihn abschalten könnte).
- **Wirksam ist die Auswahl immer nur innerhalb der aktuellen Rasterdimensionen.** Wächst das Grid,
  bleiben alle ausgewählten Zellen gültig (Koordinaten brauchen kein Remapping). Schrumpft es,
  fallen die Zellen des abgeschnittenen Streifens aus der Auswahl — **derselbe Streifen, aus dem
  auch Tools und Farben fallen**. Eine Regel, kein Sonderfall.
- **Duplicate Variant und Copy Category erben die Farben** (bestehendes Verhalten), aber nie eine
  Auswahl.
- **Es gibt kein Undo.** Das Plugin hat keinen Undo-Stack; zwölf Zellen zu färben ist ein Commit und
  nicht rücknehmbar. Praktisch gemildert wird das dadurch, dass die Auswahl nach dem Färben bestehen
  bleibt: Die unmittelbar vorangegangene Farbaktion lässt sich mit einem einzigen weiteren Klick
  korrigieren. Das ist eine bewusst akzeptierte Kante, kein Versehen.

---

## 14. Erweiterbarkeit

Selection ist intern **generisch** zu halten: ein Mechanismus, der eine Menge von Zellen eines
Grid-Kontexts liefert, plus Consumer, die diese Menge entgegennehmen. Cell Colors sind der erste
Consumer und dürfen nicht der einzige mögliche sein. Es entsteht dafür **kein Framework und keine
Action-Registry** — die Grenze ist ein schlichter Wert plus gewöhnliche Funktionen.

Später denkbar: Export Selected, Duplicate Selected, Clear Selected, Create Note from Selection,
weitere Batch-Aktionen.

**Eine scharfe Kante für später, hier vorsorglich festgehalten:** Das bestehende Entfernen eines
Tools aus einer Kategorie entfernt es aus **allen** Varianten. Solange das so ist, darf die UX
nichts andeuten, was zell-skopiertes Löschen verspricht. „Delete Selected“ braucht zuerst eine
zell-skopierte Operation.

**ZotFlow:** Später soll die Farbe einer gedroppten ZotFlow-Annotation **einmalig** als Farbe der
Zielzelle übernommen werden. Rein initiales Seeding beim Drop, **keine** dauerhafte Synchronisation;
danach gehört die Zellfarbe ausschließlich dem Nutzer. Das hier beschriebene Modell ermöglicht das
ohne Änderung, weil die Farbe an der Zelle hängt und ein Drop ohnehin eine Zelle adressiert. Für v1
wird es **nicht** gebaut.

---

## 15. Nichtziele v1

> **Zwei Punkte dieser Liste sind am 2026-09-18 bewusst überholt worden:** die Rechteck-Auswahl per
> Modifier-Drag (Abschnitt 4a) und die „aktuelle Farbe“ in Gestalt der ephemeren Auswahlfarbe
> (Abschnitt 8.2). Alles Übrige gilt weiter — insbesondere bleibt das **freie Pixel-Marquee** ein
> Nichtziel, ebenso die Explorer-artige Range-Auswahl per Shift-Klick und der Pinselmodus.

- freies Pixel-Marquee: Rahmen aufziehen, Auswahl über Überlappungsanteil, 50-%-Schwelle
- Range Selection per Shift-Klick (Anker → Ziel)
- Toggle-Selection, zusätzlicher „Select cells“-Sub-Mode
- Multi-Drag, Drag Painting, Paint-/Pinsel-Modus, dauerhaft bewaffneter Farbpinsel
- Pipette
- freier RGB-Colorpicker, gespeicherte oder editierbare Palette
- gespeicherte Auswahl
- Auswahl über mehrere Varianten oder Kategorien; globale Same-Color-Suche über das sichtbare Grid
  hinaus
- Keyboard-Navigation der Auswahl (Pfeiltasten, Ctrl+A)
- Undo-System
- große Batch-Action-Leiste
- neue Delete-Selected- oder Move-Selected-Logik
- Auswahl im Locked Mode; „Run selected“
- Auswahl in Flow-Kategorien (sie haben keine Zellen)
- Änderung am Template-Format, an Export/Import oder an `settingsVersion`

---

## 16. Verhältnis zum Audit vom 2026-09-18

| Audit-Abschnitt | Status |
|---|---|
| 2 Bestandsaufnahme, 2.5 Datenmodell, 2.6 Bewertung `cellStyles` | gültig |
| 3 Selection Domain Model (Zelle als Einheit, Kontextschlüssel, I-KEY) | gültig |
| 4 State Ownership (ephemer, React-State, eigener Context) | gültig |
| **5 Interaction Model (Sub-Mode, Overlay, Toggle)** | **ersetzt durch Abschnitte 3–6 dieses Dokuments** |
| **5.5 Click-Semantik (Toggle, Shift-Rechteck)** | **ersetzt durch Abschnitt 4**; das Rechteck kehrt als Modifier-DRAG zurück (Abschnitt 4a), nicht als Shift-Klick |
| 5.6 Escape / Klick außerhalb | gültig, siehe Abschnitt 4.2 |
| 5.7 Ort der Bedienelemente | gültig in der Begründung; Platzierung präzisiert in Abschnitt 10 |
| **6 Marquee** | freies Pixel-Marquee bleibt Nichtziel; zellengerastertes Rechteck per Modifier-Drag ist gebaut (Abschnitt 4a) |
| 7 Dynamic-Variant-Semantik, I-CTX, Variant-Pin | gültig, siehe Abschnitt 11 |
| 8 Grid Resize, I-DIM | gültig, siehe Abschnitt 13 |
| 9 Cell Color Consumer, Farbwertmodell, Rendering, Spezifitätskontrakt | gültig; Palette und Grau-Sonderfall präzisiert in Abschnitt 7.1 |
| 10 Future Consumers | gültig, siehe Abschnitt 14 |
| 11 Visuelle Kanäle und ARIA | gültig, siehe Abschnitt 9 |
| 12 Risiken | gültig, ausgenommen die Overlay-/Sensor-bezogenen Punkte |

---

## 17. Zu klärende Punkte

Erst am laufenden Panel zu beurteilen, deshalb bewusst nicht vorab entschieden:

1. Ob die dauerhaft sichtbare Farbleiste in der **List-View mit vielen offenen Kategorien** zu laut
   wirkt. Sie erscheint dort pro Grid. Die Alternative wäre eine Leiste nur beim zuletzt benutzten
   Grid, was unsichtbaren Zustand einführte und deshalb nicht vorgeschlagen wird.
2. Ob das `+` bei 18 px in der Ecke groß genug trifft, besonders bei 5 Spalten in einer schmalen
   Sidebar. Zweitpfad-Kandidat, falls nicht: **Doppelklick auf eine leere Zelle** erzeugt ein Tool
   — die Geste ist im Plugin nirgends vergeben und per Konstruktion fehlklick-fest.
3. Ob die Tint-Stärke `--ocap-cell-color-alpha: 0.22` in hellen und dunklen Themes gleich gut
   trägt. Eine Zeile CSS.

## 18. Umsetzungsstand

Implementiert am 2026-09-18, lokal committet, **nicht deployt und nicht manuell abgenommen**.
Technische Details in `docs/ocap/HANDOFF.md` §2d, Begründungen in `DECISIONS.md`.

Abweichungen von diesem Dokument, jeweils als Präzisierung markiert: Tastaturaktivierung wählt aus,
statt wirkungslos zu sein (§3); die Modifier-Vorschau der Leiste ist zurückgestellt (§10); Shift auf
einem Farbfeld ist entschieden (§8.1).

**Nachtrag 2026-09-18 (zweite Runde, nach der manuellen Abnahme im Smoke-Vault):**

- **Rechteck-Auswahl per Modifier-Drag** implementiert (§4a). Pure Kernlogik in
  `src/utils/gridRectangleSelection.ts`, Zeigerschicht in
  `src/hooks/useCellRectangleSelection.ts`, DnD-Guard in `src/utils/dragSelectionGuard.ts`.
- **Ephemere Auswahlfarbe** implementiert (§8.2), Zustand in `PanelContent`, verteilt über
  `GridCellSelectionContext`. Nichts davon erreicht Settings oder Template.
- **Locked und Edit sind visuell angeglichen** (§19). Kein `settingsVersion`-Bump, kein
  Template-Format-Bump, keine Datenänderung.

---

## 19. Locked und Edit sehen gleich aus (2026-09-18)

> Der Moduswechsel ändert das Bedienverhalten, nicht das Layout des Panels.

Die manuelle Abnahme zeigte drei Stellen, an denen derselbe Grid nach dem Sperren wie ein anderes
Panel aussah. Alle drei waren Unfälle der Spezifität bzw. des Layouts, keine Absicht:

1. **Der Tool-Inhalt saß links statt im Slot.** `.icon-top` / `.icon-left` geben der Schaltfläche
   eine *feste* Breite (56 px / 96 px) mit Spezifität 0-4-2. Im Edit-Mode fügt der Drag-Wrapper
   (`.sortable-button-item`) eine Klasse hinzu, wodurch die `width: 100%`-Regel des Grids ebenfalls
   0-4-2 erreicht und per Quellreihenfolge gewinnt. Im Locked-Mode gibt es diesen Wrapper nicht
   (`ButtonItem` rendert die Schaltfläche direkt in die Zelle), die Regel blieb bei 0-3-2 und verlor
   — das Tool war 56 px breit in einer viel breiteren Zelle, also linksbündig. Behoben, indem die
   Layout-Klasse mitbenannt wird (0-5-2), wodurch die Regel in beiden Modi und unabhängig von der
   Konkatenationsreihenfolge gewinnt.
2. **Der Hover war ein Button-Hover.** Dieselbe Kollision: `.icon-top`/`.icon-left` setzen
   `background-color: transparent` und überstimmen den Basis-Hover aus `Button.css`, sodass ein
   Tool im Grid **in keinem Modus** einen Hover-Grund hatte — sichtbar war nur ein Schlagschatten,
   dessen Größe wegen (1) zwischen den Modi sprang. Der Grid gibt dem Tool jetzt einen eigenen
   Hover-Grund (0-5-2), der die ganze Zelle füllt und der Regel für **gefärbte** Zellen (gleiche
   Spezifität, später) weiterhin unterliegt — eine deckende Fläche über einer gefärbten Zelle
   verdeckte genau die Farbe, die der Nutzer bearbeitet.
3. **Die Grid-Grenzen fehlten.** Raster und äußerer Rahmen hingen an `--managed`, also am Edit-Mode.
   Sie gelten jetzt in jedem Modus; `--managed` behält nur noch, was wirklich zum Bearbeiten gehört
   (Hover einer leeren Zelle, Greif-Cursor). Geometrie bleibt unberührt: die 1-px-Zellborder
   existiert ohnehin in jedem Modus (transparent), der Rahmen ist ein `outline`.

Dazu kam ein vierter Punkt, den erst die Messung im laufenden Obsidian zeigte: **die 16 px breite
Resize-Rinne gibt es nur im Edit-Mode**, wodurch bei vier Spalten jede Zelle beim Sperren um 4 px
wuchs — das ganze Raster sprang. Die Griffe bleiben eine Edit-Affordanz, ihr **Platz** wird im
Locked-Mode aber als leere, zeigerdurchlässige Rinne reserviert.

Edit-only bleiben: Auswahlrahmen, die `+`-Ecken, die Farbleiste, die Resize-Griffe und der
Variant-Selektor. Locked-only bleibt: das Tool ausführen.
