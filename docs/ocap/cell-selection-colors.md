# Dynamic Action Panel – Cell Selection & Cell Colors (Produktspezifikation v1)

- **Datum:** 2026-09-18 (zweite Runde am selben Tag: Abschnitte 4a, 8.2 und 19; 2026-09-19: das
  operative Modell in Abschnitt 3 — normal klicken = benutzen, Modifier = auswählen, in beiden Modi)
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

Der Nutzer soll eine oder mehrere **Grid-Zellen** auswählen und ihnen anschließend eine Farbe geben
können — seit 2026-09-19 in **beiden** Modi (Abschnitt 3). Leere Zellen sind dabei gleichwertige
Auswahlziele.

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

> **Normativ seit 2026-09-19 — das operative Modell.**
>
> ```
> normal klicken   = Tool BENUTZEN          (Locked und Edit)
> Modifier         = Zellen AUSWÄHLEN       (Locked und Edit)
> Locked / Edit    = Layout geschützt / Layout editierbar — sonst nichts
> ```
>
> Selection ist eine **operative Arbeitsfunktion**, keine Edit-Funktion. Der Moduswechsel ändert
> nur, ob das **Layout** verändert werden darf. Die Tabelle unten ist die geltende Fassung; die
> Absätze darunter halten fest, wie es dazu kam.

Das Panel kennt genau zwei Interaktionsmodi (`InteractionMode = 'locked' | 'edit'`; der frühere
dritte Modus `sort` wurde in Settings-Version 4 in `edit` aufgelöst). Die einzige Frage, die sie
unterscheidet, ist `allowsLayoutEditing(mode)` (`src/utils/interactionMode.ts`).

| | Locked (Layout geschützt) | Edit (Layout editierbar) |
|---|---|---|
| Klick auf Tool | **führt das Tool aus** | **führt das Tool aus** |
| Klick auf leere Zelle | ohne Wirkung | ohne Wirkung |
| Enter/Leertaste auf fokussiertem Tool | führt aus | führt aus |
| Shift + Klick / Ziehen | Zelle / Rechteck **hinzufügen** — Tool läuft nicht | ebenso |
| Strg/Cmd + Klick / Ziehen | Zelle / Rechteck **entfernen** — Tool läuft nicht | ebenso |
| Farbleiste (Färben, Select-by-Colour) | **ja** | ja |
| Escape / Klick auf leeren Hintergrund | Auswahl leeren | ebenso |
| Datei auf eine Zelle droppen (auch ersetzen) | **ja** | ja |
| Zellfarben sichtbar | ja | ja |
| Tool verschieben / tauschen | **nein** | ja |
| Kategorie umsortieren | **nein** | ja |
| Grid-Größe ändern | **nein** | ja |
| `+` auf leerer Zelle, Kontextmenüs | **nein** | ja |
| Moduswechsel verwirft die Auswahl | **nein** | **nein** |

**Warum.** Das vorige Modell — Locked *konsumiert*, Edit *verwaltet* — hatte zwei Kosten, die im
Alltag schwerer wogen als sein Schutz: Tools funktionierten nicht mehr, sobald man entsperrte, und
die Auswahl verschwand, sobald man sperrte. Der Schutz, um den es eigentlich ging, ist der des
**Layouts**; den behält Locked vollständig. Die Gefahr, gegen die das alte Modell gebaut war — ein
verrutschter Klick startet beim Umräumen ein Script —, ist jetzt anders gelöst: Ein **Drag** führt
nie aus (der abschließende Klick eines Layout-Drags wird verschluckt, auch wenn das Tool an seinen
Ausgangsplatz zurückkehrt), und ein **Modifier-Klick** führt nie aus.

**Wer entscheidet, was ein Klick bedeutet.** Das Grid, in der **Capture-Phase**, bevor das Tool
den Klick sieht (`gridClickMeaning` in `src/utils/gridCellSelection.ts`): `run-tool` für einen
einfachen Klick, `select` für Shift/Strg/Cmd, `ignore` für den Klick am Ende eines Drags oder
Rechtecks und für den macOS-Sekundärklick. Die Funktion hat bewusst **keinen** Modus-Parameter.

### 3.1 Historie dieses Abschnitts

- **2026-09-18:** Edit führt nichts aus, ein Klick wählt die Zelle aus; Locked hat keine Auswahl.
- **2026-09-19 (früher am Tag):** Präzisierung „Locked ist der Arbeitsmodus“ — Datei-Drop auch im
  Locked Mode, Ersetzen ohne Rückfrage (`DECISIONS.md`).
- **2026-09-19:** das operative Modell oben. Es **ersetzt** den Stand vom 2026-09-18: „Klick im
  Edit Mode wählt aus“, „Enter/Leertaste im Edit Mode wählen aus“ und „Locked hat keine Auswahl“
  gelten nicht mehr.

---

## 4. Selection-Semantik (beschlossen)

Die Auswahl bezieht sich auf **Zellen**. Leere und belegte Zellen verhalten sich vollkommen
identisch; der Auswahlmechanismus weiß nicht, ob eine Zelle belegt ist.

### 4.1 Die Gesten (normativ seit 2026-09-19)

```
Normal  = Tool benutzen — KEINE Selection
Shift   = hinzufügen
Strg    = entfernen      (macOS: Cmd)
```

| Geste | Zelle ist nicht ausgewählt | Zelle ist ausgewählt |
|---|---|---|
| **Linksklick** | Tool läuft (leere Zelle: nichts); Auswahl **unverändert** | Tool läuft; Auswahl **unverändert** |
| **Shift + Linksklick** | Zelle zur Auswahl **hinzufügen** — Tool läuft nicht | **keine Änderung** — Tool läuft nicht |
| **Strg + Linksklick** | **keine Änderung** — Tool läuft nicht | Zelle aus der Auswahl **entfernen** — Tool läuft nicht |

Gilt in **beiden** Modi. Existiert noch keine Auswahl, beginnt ein Shift-Klick sie natürlich mit
genau dieser Zelle.

Das ist das klassische Selection-Modell aus Desktop- und DCC-Anwendungen. Ausdrücklich gilt:

- **Shift wählt niemals ab.** Es ist rein additiv.
- **Strg wählt niemals aus.** Es ist rein subtraktiv.
- **Es gibt kein Toggle.** Diese Regel ist ausdrücklich festgehalten, damit sich später kein
  Toggle-Verhalten einschleicht.
- **Ein einfacher Klick ersetzt die Auswahl nicht mehr.** *Überholt am 2026-09-19:* Bis dahin hieß
  es „Normal = ersetzen“ — ein Klick verwarf die Auswahl und wählte nur diese Zelle. Das kollidierte
  mit dem Benutzen der Tools und ist ersatzlos entfallen. Der Mengen-Operator „ersetzen“ lebt seit
  2026-09-20 nur noch in der Live-Vorschau eines Rechtecks fort (Abschnitt 4a.4); auf der Farbleiste
  ist er durch dieselben drei Gesten ersetzt worden (Abschnitt 8).
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

Während des Ziehens aktualisiert sich **die Auswahl-Darstellung der betroffenen Zellen**, und
zusätzlich zeichnet die Geste **einen durchgehenden Rahmen** um den Block (Abschnitt 9.1).

Das Rechteck bleibt zellengerastert: Der Rahmen springt auf ganze Zellen, weil das die Einheit ist,
in der die Geste rechnet. Er ist ausdrücklich **kein** freies Pixel-Marquee — nicht zwischen
exaktem Pointer-Start und Pointer-Position aufgezogen, sondern um genau die Zellen gelegt, die
tatsächlich betroffen sind, Lücken eingeschlossen. Ein freies Marquee bleibt Nichtziel
(Abschnitt 15).

*Nachtrag 2026-09-18 (zweite Runde):* Ursprünglich stand hier, es werde gar kein Rahmen gezeichnet
und die Geste zeige sich allein über die Auswahl der Zellen. Das reichte nicht — siehe Abschnitt 9.

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
  nichts wird geschrieben. Hat die Geste den Kontext aus einem anderen Grid herübergeholt (4.2),
  wird die gesamte Auswahl von vor dem PointerDown wiederhergestellt — im alten Grid. Das panelweite Escape (Auswahl leeren) tritt dafür zurück, solange eine
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

- **Auswahl leeren:** Escape **oder ein Klick auf leeren Panel-Hintergrund** (Abschnitt 4.4). Oder
  jede Zelle einzeln per Strg abwählen. Ein Linksklick auf eine ZELLE kann die Auswahl nie auf leer
  bringen (er hinterlässt immer genau eine Zelle).
- **Klick in die Lücke zwischen zwei Zellen** (4 px): **keine Wirkung.** Weder Auswahl setzen noch
  leeren. Die Fläche ist zu klein, um Absicht zu unterstellen — und sie gehört zum Grid, ist also
  auch kein Hintergrund im Sinne von 4.4.
- **Genau ein aktiver Selection-Kontext, panelweit (normativ seit 2026-09-19).** Der Kontext ist die
  fachliche Grid-Identität `(categoryId, variantId)`, nie die Render-Position. Über die
  Grid-Grenze hinweg gilt:

  | Geste in Grid B, während A die Auswahl hält | Wirkung |
  |---|---|
  | **Shift + Klick / Shift + Ziehen** | A wird geleert; B wird aktiver Kontext mit genau den neu gewählten Zellen |
  | **Strg/Cmd + Klick / Strg/Cmd + Ziehen** | **No-op.** A bleibt unverändert; B bekommt nichts; kein Tool läuft |
  | **normaler Klick auf ein Tool** | das Tool läuft; A bleibt unverändert |
  | **Klick oder Shift + Farbfeld in B** | wählt dort aus, also wechselt der Kontext nach B (Abschnitt 8) |
  | **Strg/Cmd + Farbfeld in B** | **No-op**, wie überall sonst (seit 2026-09-20; vorher ersetzte es) |

  Begründung: Shift ist die einzige Geste, die eine Auswahl *beginnt*; seit ein einfacher Klick
  nicht mehr ersetzt (4.1), wäre ohne diese Regel ein Grid, das nicht schon die Auswahl hält, gar
  nicht mehr erreichbar. Strg kann in einem Grid ohne Auswahl nichts entfernen und darf deshalb
  auch nichts anderes verwerfen. Zwei gleichzeitige Auswahlen gibt es nie.

  Der Wechsel nimmt **keine `selectionPaintColor`** mit (sie gehört dem alten Kontext, Abschnitt
  8.2): Die ersten Zellen in B werden nicht mit A's scharfer Farbe eingefärbt. **Escape während
  eines kontextwechselnden Shift-Rechtecks** stellt die komplette Auswahl in A wieder her, nicht
  eine leere (Abschnitt 4a.6).

  *Überholt am 2026-09-19:* Bis dahin verschob ein einfacher Linksklick die Auswahl in ein anderes
  Grid, und Shift/Strg blieben auf einem fremden Grid wirkungslos.
- **Mehrere Panel-Leaves** haben jeweils ihre eigene, unabhängige Auswahl.
- **Escape** leert die Auswahl. In der Folder-View schließt Escape heute den geöffneten Ordner —
  die Auswahl hat Vorrang: erstes Escape leert die Auswahl, ein weiteres schließt den Ordner.

### 4.3 Mac

Auf macOS ist Strg+Klick der Sekundärklick und löst ein Kontextmenü aus. Die hier beschriebene
Semantik bleibt davon unberührt: Auf macOS übernimmt **Cmd** die subtraktive Rolle, und Strg+Klick
bleibt dort der Sekundärklick. Das ist eine reine Tastenzuordnung, keine Semantikänderung.

### 4.4 Klick auf leeren Hintergrund leert die Auswahl (2026-09-19)

**Dieser Abschnitt hebt die frühere Regel „Klick außerhalb des Grids: keine Wirkung“ auf.** Die
damalige Begründung — „außerhalb“ sei view-abhängig mehrdeutig — trifft für den *leeren* Hintergrund
nicht zu: Eine Fläche, die keine eigene Aktion hat, kann keine verlieren.

```
Klick auf leeren Panel-/Kategorie-Hintergrund → Auswahl komplett leeren
```

Damit gibt es zwei natürliche Wege hinaus — Tastatur und Maus — und beide kosten weder eine
Schaltfläche noch einen Modus.

**Was als Hintergrund gilt**, ist als **Ausschlussliste** definiert und nicht als Allowlist: Ein
Hintergrund ist nichts, was jemand rendert, sondern das, was zwischen den Dingen übrig bleibt. Die
Kontrollen zu benennen ist die kürzere und ehrlichere Liste — und eine neue Kontrolle, die dort
vergessen wird, fällt laut auf (ihr Klick leert zusätzlich die Auswahl) statt leise (ihr Klick
hörte auf zu funktionieren).

**Auf der Liste steht nur, was selbst eine Klick-Aktion hat (normativ seit 2026-09-20).**

> Ein Container ist keine Kontrolle, nur weil er eine enthält.

Die Liste wird mit `closest` ausgewertet, riegelt also jeweils den ganzen Teilbaum ab — richtig für
eine Kontrolle (ihr Symbol und ihre Beschriftung gehören zu ihr), falsch für eine Leiste, die bloß
Kontrollen trägt. Genau daran lag es, dass die **freie Fläche rechts neben den Farbfeldern** und
**neben den Variant-Schaltflächen** nicht leerte: Farbleiste und Variant-Bar standen selbst auf der
Liste. Sie stehen es nicht mehr; ihre Schaltflächen sind ohnehin `button` und bleiben ausgenommen.

Ausgenommen sind damit: **Kontrollen** — Tools, Farbfelder samt `Clear`, das `+`, Resize-Griffe,
Variant-Dropdown und dessen Schaltflächen, Tabs, Folder-Kacheln, Eingaben, Links, Kategorietitel
(die ganze Zeile klappt) und der Kategorie-Handle — sowie **das Grid**: Zellen, Grid und Rahmen.
Letzteres nicht, weil es Kontrollen wären, sondern weil dort das Grid entscheidet, was ein Druck
bedeutet (Tool ausführen, mit Modifier auswählen, Datei ablegen) und die 4-px-Lücke bewusst nichts
tut. Eine leere Zelle ist Drop-Ziel und Erzeugungsort, kein übrig gebliebener Platz.

**Die Fläche reicht so weit wie die DAP-Ansicht.** Gehorcht wird auf dem `view-content` dieser
Ansicht, nicht nur auf dem gerenderten Panel: Der leere Raum **unter der letzten Kategorie** gehört
genauso dazu wie die Lücke zwischen zweien. Editor, Modal und andere Leaves bleiben außen vor.

**Entschieden wird beim KLICK, nie beim PointerDown.** In der List-View ist genau dieser Hintergrund
auch der Griff des Kategorie-Drags; ein Leeren beim Drücken würde die Auswahl zu Beginn jedes
Kategorie-Drags zerstören. Der Druck wird nur gemerkt; erst wenn feststeht, dass die Geste ein Klick
war — höchstens 4 px Weg, dieselbe Schwelle wie überall —, wird geleert. Ein Drag, der tatsächlich
gestartet ist, verwirkt seinen Klick zusätzlich unabhängig von der Distanz.

**Die freie Fläche der Kategorie gehört dazu (normativ seit 2026-09-19, erweitert 2026-09-20).** Die Fläche des
Kategorieblocks — neben und unter dem Grid — ist Hintergrund: ein kurzer Klick leert die Auswahl.
Seit der Kategorie-Handle existiert (Abschnitt 5a) ist sie überhaupt keine Griff-Fläche mehr, also
auch kein Sonderfall: Der Block trägt `role="button"` nicht mehr, dnd-kits Aktivator-Props sitzen
am Handle. Ausgenommen bleiben Titel, **Handle**, Grid, Tools, Slots, Farbleiste, Resize, `+`,
Links, Eingaben und Buttons; **Tabs und Folder-Kacheln** sind weiterhin zugleich Drag-Griffe und
haben eine eigene Klick-Aktion (Tab wechseln, Ordner öffnen).

**Ein Druck, der je weiter als die Schwelle gewandert ist, verwirkt seinen Klick** — unabhängig
davon, ob eine Drag-Engine ihn aufgegriffen hat. Auf der freien Fläche startet seit dem Handle kein
Drag mehr; ohne diese Regel wäre Wegziehen-und-Zurückkommen dort wieder ein Klick geworden.

Gehört zur Selection-Session wie alles andere: `selectionPaintColor` fällt mit der Auswahl
(Abschnitt 8.2). Ein Klick **außerhalb des Panels** — Editor, Modal, anderes Leaf — bleibt
wirkungslos.

### 4.5 Das Cursor-Modell (normativ seit 2026-09-19, erweitert am 2026-09-19)

> Der Zeiger sagt, was **an genau dieser Stelle** möglich ist — nicht mehr und nicht weniger.

Die Prioritäten, von oben nach unten:

| # | Zustand | Cursor |
|---|---|---|
| 1 | ein Layout-Drag läuft gerade | `grabbing` |
| 2 | Strg/Cmd gehalten | **Minus** (entfernen) |
| 3 | Shift gehalten | `cell` — das fette Plus des Systems (hinzufügen) |
| 4 | Edit-Mode, ein Tool, das bewegt werden kann | `grab` |
| 5 | sonst die eigene Bedeutung der Fläche | Tool ausführen `pointer`, `+` `pointer`, Zelle/Lücke `default` |

Dazu gehören ausdrücklich:

- **Eine leere Zelle zeigt den normalen Pfeil.** Sie ist nichts, was man greifen kann; der frühere
  Grab-Cursor über der ganzen Kategorie hat das Gegenteil behauptet. Das `+` in ihrer Ecke bleibt
  ein Pointer und bleibt unverändert bedienbar.
- **Ein Tool im Edit-Mode zeigt die offene Hand** und während des Ziehens die geschlossene. Die
  Hand hängt am Drag-Wrapper *und* an der Schaltfläche darin — vorher nur am Wrapper, weshalb der
  Zeiger über dem Tool selbst der Pointer der Schaltfläche blieb. Sie erscheint genau dann, wenn
  der Wrapper existiert, also wenn das Tool wirklich beweglich ist (nicht in Locked, nicht während
  einer Suche). **Ein Klick ohne Ziehen führt weiterhin aus.**
- **Die Modifier gelten in beiden Modi** (Selection ist operativ) und haben Vorrang vor der Hand.
  Sind beide Tasten gedrückt, zeigt der Cursor, was der Druck wirklich täte: hinzufügen (Shift
  gewinnt, Abschnitt 8.1) — ein Cursor, der etwas anderes verspricht als die Geste, wäre schlimmer
  als gar keiner.
- **Loslassen stellt sofort den darunterliegenden Cursor her.** Kein hängender Zustand nach
  Fensterwechsel, Fokusverlust, Moduswechsel oder Unmount.

**Technisch** ist die Priorität nicht der Spezifität überlassen, sondern eingebaut: Der
Panel-Content trägt `data-ocap-selection-intent="add" | "remove"` (gesetzt von
`CellSelectionModifierCursor` aus `keydown`/`keyup`/`pointermove`, entfernt bei `blur` und beim
Unmount, mit derselben Modifier-Auflösung `gestureOfEvent` wie die Gesten selbst). Das Attribut
setzt **eine** Custom Property, und jede Grid-Fläche nennt ihren eigenen Cursor nur als deren
Fallback:

```css
cursor: var(--ocap-selection-cursor, grab);   /* ein bewegliches Tool */
cursor: var(--ocap-selection-cursor, default); /* Zelle, Lücke */
```

Für „entfernen" gibt es **keinen nativen Cursor** — `zoom-out` ist eine Lupe und bedeutet etwas
anderes. Also ein eingebettetes SVG als Data-URI (keine Asset-Datei), gezeichnet wie das Plus von
`cell`: weißer Balken, schwarzer Rand, Hotspot in der Mitte, und `cell` als Fallback, falls ein
Bild-Cursor nicht getragen wird.

Stufe 1 ist die einzige Regel, die alles überstimmen muss — auch Obsidians eigene Cursor, über das
ganze Panel und nur solange dnd-kit einen Drag wirklich aktiv hat (`buttons-panel-is-dragging`).
Sie ist deshalb das einzige `!important` des Modells.

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

## 5a. Kategorie verschieben: nur am Handle (normativ seit 2026-09-19)

> **Handle = bewegen. Header = auf- und zuklappen.** Zwei Handlungen, zwei Orte.

In der List-View war der **ganze Kategorieblock** der Drag-Aktivator: jeder freie Pixel neben dem
Grid, unter der Farbleiste und im Header hat die Kategorie verschoben. Das hatte zwei Kosten. Der
Header musste gleichzeitig klappen und verschieben, und über riesigen Flächen stand eine Greif-Hand,
unter der nichts zu greifen war — auch über leeren Zellen, die nun wirklich nichts anbieten.

```
[⠿ Handle] [Icon] [Name] ............ [Chevron]
```

- Der Handle sitzt **ganz links im Header, vor dem Icon**, klein und eindeutig (Obsidians
  `grip-vertical`).
- **Nur er startet einen Reorder.** Header, Icon, Name, Grid, leere Zellen, der Raum unter dem Grid
  und die übrige Kategoriefläche starten keinen mehr.
- **Der Header klappt weiterhin** die Kategorie auf und zu — jetzt als seine einzige Aufgabe.
- **Ein Klick auf den Handle tut nichts:** Er klappt nicht (er stoppt seinen Klick, bevor der Header
  ihn sieht) und leert keine Auswahl (er steht auf der Ausschlussliste, Abschnitt 4.4).
- **Ein Modifier unterdrückt auch am Handle den Drag** — Shift/Strg gehören der Auswahl
  (Abschnitt 4a.5).
- Der Handle ist eine **Layout**-Affordanz und existiert nur, wo Layout-Editing erlaubt ist: im
  Edit-Mode ohne aktive Suche. Wie die Resize-Rinne (Abschnitt 19) bleibt sein **Platz** sonst leer
  und zeigerdurchlässig reserviert, damit der Header beim Moduswechsel nicht springt.
- Die Drag-Vorschau zeichnet denselben Header **mitsamt Handle**, damit das Gezogene aussieht wie
  das Original.

**Unverändert:** die Reorder-Logik selbst, Drop, Vorschau, Animation und Zustand. Es ist dieselbe
dnd-kit-Sortable; nur der Aktivator wandert mit dem dafür vorgesehenen Mechanismus
(`setActivatorNodeRef` plus `listeners`/`attributes`) auf den Handle. **Tabs und Folder-Kacheln**
bleiben, wie sie sind: Dort ist das kompakte Element selbst der Griff, es gibt keine große freie
Fläche, die etwas Falsches verspräche.

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
Keine Auswahl + Klick auf ein Farbfeld   → wählt die Zellen dieser Farbe aus (Abschnitt 8)
```

*Überholt am 2026-09-20:* „Keine Auswahl + Klick → wirkungslos“. Ohne Auswahl gibt es nichts zu
färben, also ist der Klick dort die Primäraktion der Farbleiste: die Farbgruppe auswählen.

- **Die Auswahl bleibt nach dem Färben bestehen.** Man kann also erst Rot, dann Blau probieren, ohne
  neu auszuwählen. Das ist gleichzeitig der praktische Ersatz für ein Undo (Abschnitt 13).
- Leere und belegte Zellen werden vollkommen gleich behandelt.
- „Keine Farbe“ löscht den Eintrag. Wird die Farbtabelle dadurch leer, verschwindet sie ganz, sodass
  unberührte Konfigurationen byte-gleich zu Daten von vor diesem Feature bleiben.

---

## 8. Die Farbleiste ist ein Malwerkzeug (normativ seit 2026-09-20)

> **Farbe anklicken = mit dieser Farbe weiterarbeiten.**

Ein normaler Klick auf ein Farbfeld bedeutet **immer dasselbe**, ob etwas ausgewählt ist oder nicht:
diese Farbe wählen. Die Modifier sind die Grammatik des Grids, angewandt auf die Zellen, die diese
Farbe tragen (Abschnitt 4.1):

```
normaler Klick  = Farbe wählen (und eine vorhandene Auswahl damit färben)
Shift           = hinzufügen
Strg/Cmd        = entfernen   (macOS: Cmd)
```

Ein Farbfeld ist damit zweierlei: eine **Farbe**, die der Klick wählt, und der Name einer **Gruppe
von Zellen** — aller Zellen dieser Farbe im aktuell sichtbaren Grid —, die die Modifier adressieren.
„Keine Farbe“ ist beides ebenso: eine Wahl und die Gruppe der ungefärbten Zellen.

| Geste | Keine Auswahl | Auswahl vorhanden |
|---|---|---|
| **Klick** | Farbe **scharf stellen** — nichts wird ausgewählt, nichts geschrieben | Auswahl **färben** (die einzige schreibende Geste) und Farbe scharf stellen |
| **Shift + Klick** | Gruppe wird die Auswahl | Gruppe **zur Auswahl hinzufügen** |
| **Strg/Cmd + Klick** | **no-op** — es gibt nichts zu entfernen | Gruppe **aus der Auswahl entfernen** |

Die tragende Regel bleibt bestehen und wird sogar schärfer:

> **Nur der normale Klick auf eine vorhandene Auswahl schreibt.** Jede andere Geste auf der
> Farbleiste verändert ausschließlich die Auswahl.

- Gilt ausdrücklich **auch für leere gefärbte Zellen**.
- Strikt nur im **aktuell sichtbaren Grid-Kontext** — also in genau der Kategorie und genau der
  Variant, die gerade angezeigt wird. Niemals über andere Kategorien oder Varianten hinweg.
- **Ein Modifier auf einem Farbfeld stellt nie eine Farbe scharf** und schreibt nie. War Rot
  scharf und der Nutzer holt per `Shift + Blau` die blauen Zellen dazu, bleibt **Rot** die Farbe,
  die die nächste hinzugefügte Zelle bekommt — die blauen Zellen werden nicht umgefärbt.
  Mengen-Operationen der Leiste und Mal-Gesten im Grid bleiben bewusst getrennt.
- **Auswählen ist ein `hinzufügen`, kein `ersetzen`.** Dadurch gilt die panelweite Kontextregel
  (Abschnitt 4.2) unverändert: Ein **Shift**-Klick auf eine Farbleiste, deren Grid gerade keine
  Auswahl hält, holt den einen aktiven Kontext dorthin; Strg/Cmd greift nie über die Grid-Grenze.
  Ein normaler Klick verschiebt gar nichts — er wählt ja nur eine Farbe.
- Findet sich keine Zelle der Farbe, ist die Auswahl anschließend **leer**, ohne Meldung. Das leere
  Ergebnis ist die Antwort.
- Verglichen wird der **rohe gespeicherte Wert**, nicht die gerenderte CSS-Farbe. Ein `ocap:red` und
  ein zufällig gleich aussehendes Hex sind verschiedene Farben.
- Identisch in **Locked und Edit**; die Farbleiste ist operativ (Abschnitt 3).

**Zwei überholte Lesarten des normalen Klicks — beide am 2026-09-20:**

```
1. Strg + Klick auf Rot → Auswahl wird ERSETZT durch alle roten Zellen   (früh am Tag ersetzt)
2. Klick ohne Auswahl   → alle roten Zellen werden ausgewählt            (am selben Tag verworfen)
```

(1) war die einzige Stelle im Panel, an der Strg/Cmd nicht „entfernen" bedeutete; die damals bewusst
akzeptierte Asymmetrie ist aufgelöst. (2) war der Versuch, das Nützliche daran zu retten, und in der
manuellen Abnahme durchgefallen: Derselbe Klick hätte damit zwei unverwandte Dinge bedeutet, je nach
einem Zustand, den man nicht sieht. Eine Farbgruppe zu holen ist die Aufgabe der Modifier, und die
sagen auf jeder Fläche des Panels dasselbe. Der normale Klick gehört der Farbe.

### 8.1 Shift auf einem Farbfeld (entschieden 2026-09-18)

```
Shift + Klick auf Farbfeld
→ alle Zellen dieser Farbe zur bestehenden Auswahl hinzufügen
```

Damit ist `Shift + Rot`, dann `Shift + Blau` = alle roten **und** blauen Zellen gemeinsam
auswählen und in einem Zug umfärben. Konsistent mit „Shift = hinzufügen“ überall sonst, und es
schreibt nicht. Auf der Farbleiste eines **anderen** Grids wechselt es den einen aktiven Kontext
dorthin, genau wie ein Shift-Klick auf eine Zelle (Abschnitt 4.2). Die Farbleiste färbt immer nur
den aktiven Kontext.

Verworfen wurde „Shift = wie ein normaler Klick“: ein verrutschter Shift würde dann schreiben und
bräche die Regel *ein Modifier schreibt nie*.

`Strg+Shift` auf einem Farbfeld hat **keine eigene Bedeutung**. Es löst deterministisch nach
derselben Prioritätsregel auf wie auf einer Zelle — Shift gewinnt, die Geste ist also `hinzufügen`;
Tooltip und Cursor sagen genau das. *Ergänzt 2026-09-20:* „alle dieser Farbe aus der Auswahl
entfernen“ ist nicht mehr für später reserviert, sondern liegt jetzt auf Strg/Cmd allein.

### 8.2 Ephemere Auswahlfarbe (beschlossen 2026-09-18)

Wer eben Rot auf seine Auswahl angewendet hat und sie danach per Shift erweitert, meint fast immer:
**die neuen Zellen bitte auch rot.** Dafür gibt es keinen Pinsel und keinen Modus, sondern eine
Eigenschaft der *laufenden Auswahl*:

```
normaler Klick auf ein Farbfeld
→ diese Farbe ist ab jetzt die Auswahlfarbe
→ und falls eine Auswahl besteht: sie wird damit gefärbt
```

**Scharf stellen geht auch ohne Auswahl (normativ seit 2026-09-20).** Das ist der Kern des
Malwerkzeugs: erst die Farbe wählen, dann per Shift die Zellen aufsammeln, die sie bekommen sollen.
*Überholt:* Bis dahin hieß es „ohne Auswahl passiert nichts“ bzw. „ohne Auswahl wählt der Klick die
Farbgruppe aus“.

- **„Keine Farbe“ ist eine ebenso bewusste Wahl** und wird genauso scharf gestellt: danach
  hinzugefügte Zellen werden ungefärbt.
- **Modifier-Klicks auf Farbfeldern ändern sie nie** — sie schreiben nicht, und sie stellen nichts
  scharf. Die Regel „ein Modifier auf einem Farbfeld schreibt nie“ bleibt vollständig gültig.
- **Es gibt trotzdem keinen dauerhaft „bewaffneten“ Farbpinsel.** Die scharfe Farbe gehört der
  Auswahl-Session und stirbt mit ihr (Lebensdauer unten). Ein ausdrückliches „doch nicht“ —
  **Escape oder ein Klick auf freien Hintergrund** — beendet die Session und nimmt die Farbe mit,
  auch wenn noch gar nichts ausgewählt war.

**Wirkung:** Eine additive Geste — Shift-Klick wie Shift-Rechteck — färbt **genau die Zellen, die
sie neu hinzufügt**. Bereits ausgewählte Zellen werden nicht erneut angefasst, und ein
Strg-Entfernen färbt grundsätzlich nichts: Eine rote Zelle, die aus der Auswahl entfernt wird,
bleibt rot. Auswahl und Zellfarbe bleiben getrennte Konzepte.

**Lebensdauer:** Die Auswahlfarbe gehört der Auswahl-Session und stirbt mit ihr — Auswahl geleert,
Escape, Kategorie oder Variant gewechselt, Grid-Kontext gewechselt. Eine Regel deckt fast alle diese
Fälle ab, weil sie alle damit enden, dass die Auswahl ein anderes Grid oder gar keines mehr benennt.
**Genau eine Ausnahme (2026-09-20):** der Übergang von *keiner* Auswahl zu *einer* behält sie — eben
diese Geste soll die scharfe Farbe ja tragen. Ein Moduswechsel allein beendet nichts (Abschnitt 11). Sie wird **nicht persistiert**: nicht in `data.json`, nicht in den Settings,
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
| **Auswahl (Fläche)** | `box-shadow: inset` — eine Akzent-Tönung über die ganze Zelle |
| **Auswahl (Form)** | **durchgehende** Kontur um die tatsächliche Auswahlform (Abschnitt 9.2) |
| **Laufende Geste** | **ein** gestrichelter Rahmen um den Block der Geste (Abschnitt 9.1) |

Drei Ebenen, drei Fragen: *welche Zellen sind gewählt* (Tönung), *welche Form hat die Auswahl*
(Kontur) und *was tut die Hand gerade* (Geste).

Eine rote ausgewählte Zelle ist damit gleichzeitig eindeutig rot **und** eindeutig ausgewählt.

**Präzisierung 2026-09-18 (zweite Runde):** Ursprünglich stand hier `outline` in der Akzentfarbe,
nach innen versetzt — also ein Rahmen **pro Zelle**. Das war am laufenden Panel nicht lesbar: Bei
vier oder fünf Spalten kachelten die Rahmen, die 4-px-Lücken zerschnitten den Block in Einzelteile,
und die Auswahl las sich als „diese Zellen“ statt als eine Fläche. Für `Strg`-Entfernen gab es
überhaupt nichts zu zeigen — die betroffenen Zellen verloren einfach ihren Rahmen, sodass nicht zu
sehen war, *welcher* Block gerade abgewählt wird.

Die Auswahl ist deshalb jetzt eine **Tönung** (Zustand), und die Geste bekommt ihren **eigenen,
durchgehenden Rahmen** (Form). Genau diese Trennung fehlte.

Warum ein **inset `box-shadow`** für die Tönung: `background-color` ist die Zellfarbe und muss
sichtbar bleiben, `border-color` ist für Drop-Ziele und File-Drop-Ziele vergeben (diese Ringe
versprechen, wo ein Drop landet), `border-width` ist durch die Geometrie-Invariante gesperrt, eine
gestrichelte Outline bedeutet bereits „vom Kontext ausgeblendet“, und `opacity` ist ebenfalls belegt.
Ein inset `box-shadow` malt **über den Hintergrund und unter den Inhalt** der Zelle: Die Zellfarbe
bleibt erkennbar, das Tool darauf bleibt lesbar, und die 1-px-Border — Raster und Drop-Versprechen —
liegt außerhalb der Padding-Box, auf die der Schatten geclippt ist. Am Layout nimmt er nicht teil.

Die Tönung wird aus Obsidians eigenen Akzent-Komponenten abgeleitet (`--accent-h/s/l`), folgt also
dem Akzent des Nutzers und beiden Themes. Jede `var()`-Referenz trägt einen Fallback: Ein
undefiniertes `var()` in einer Farbe macht die ganze Deklaration ungültig, die Tönung fiele also
ersatzlos aus.

**Die Zellfarbe füllt die Zelle bis an ihre Kante, sichtbar über die Tool-Schaltfläche hinaus.** Das
ist nicht bloß Ästhetik: Es ist die einzige Möglichkeit, dem Nutzer beizubringen, dass die Farbe der
*Kachel* gehört und nicht dem Tool — die Voraussetzung dafür, dass „das Tool nimmt seine Farbe beim
Verschieben nicht mit“ nicht als Fehler gelesen wird.

Die Auswahl wird **nicht persistiert**. Sie existiert nur zur Laufzeit.

### 9.1 Die laufende Geste zeichnet sich selbst (2026-09-18)

Während eine Rechteck-Geste läuft, zeigt das Grid zusätzlich **genau einen** Rahmen um den ganzen
Block — **nicht** einen Rahmen pro Zelle. Er ist **gestrichelt** und liegt **über** der
persistenten Kontur (9.2): Eine Geste ist vorläufig, bis der Zeiger oben ist, und genau das heißt
eine gestrichelte Kante seit jeher. So müssen „was ist ausgewählt“ und „was tue ich gerade“ nie
allein an der Position auseinandergehalten werden.

- er spannt die Lücken zwischen den Zellen mit über, damit die Geste als **eine Fläche** liest.
  Dass die Auswahl darunter zellengerastert ist, bleibt davon unberührt;
- er ist **absolut positioniert** und damit außerhalb des Flusses: ein Grid-Item würde Tracks
  belegen und die automatisch platzierten Zellen verschieben;
- er ist **zeigerdurchlässig** und kann die Geste, die er zeichnet, deshalb nie schlucken;
- platziert wird er aus **vier ganzen Zahlen** (Zeile, Spalte, Zeilen, Spalten), die die Geste
  veröffentlicht, gegen die Track-Größen des Grids selbst. Kein Pixel wird gemessen, und der Rahmen
  bleibt bei jeder Panelbreite exakt;
- **Hinzufügen** zeichnet ihn in der Akzentfarbe, **Entfernen** in der Fehlerfarbe.

Und weil ein Entfernen sonst unsichtbar bleibt, bekommen die Zellen, die es fallen lässt, für die
Dauer der Geste eine eigene Tönung im selben Kanal: Sie wechseln **an Ort und Stelle** von
„ausgewählt“ auf „wird entfernt“, statt nur zu verschwinden. Das ist reine Darstellung — was
ausgewählt *ist*, entscheidet weiterhin allein Abschnitt 4a.4.

Der Rahmen und diese Markierung gehören ausschließlich der Geste: Loslassen, Escape,
`pointercancel` und ein Abbau der Komponente beenden beide sofort.

### 9.2 Die Auswahl hat eine bleibende Kontur (2026-09-19)

Die Tönung allein war zu weich. Nach dem Loslassen verschwand der Rahmen der Geste, und übrig blieb
eine Fläche ohne Grenze — die Auswahl war zwar zu sehen, aber nicht als **Form** zu lesen. Am
deutlichsten dort, wo die Form am interessantesten ist: nachdem ein Block per `Strg` aus einer
größeren Auswahl herausgeschnitten wurde.

Die aktuelle Auswahl bekommt deshalb eine **dauerhafte Kontur**, die die Geste überlebt.

**Sie zeichnet die tatsächliche Form nach, nie eine Bounding Box.** Die Regel dahinter ist eine
einzige:

> Eine Zelle zeichnet auf jeder Seite eine Kante, deren orthogonaler Nachbar **nicht** ausgewählt
> ist. Jedes Stück reicht dabei eine halbe Rinne weit zu jeder Seite, die einen Nachbarn im Grid
> hat.

Mehr braucht es nicht — die Topologie fällt dabei von selbst richtig heraus:

- ein voller Block ergibt **eine** geschlossene Kontur, weil die gemeinsamen Kanten im Inneren nie
  gezeichnet werden;
- ein **Loch** bekommt seine eigene innere Kontur, weil die Zellen ringsum Kanten nach innen haben;
- **getrennte Inseln** bekommen je eine eigene Kontur; nichts setzt voraus, dass die Auswahl
  zusammenhängt;
- zwei nur **diagonal** benachbarte Zellen bleiben zwei Formen — sie teilen sich keine Kante.

Die gleichmäßige halbe-Rinne-Ausdehnung ist das, was aus Kacheln eine Form macht: Zwei benachbarte
Stücke treffen sich exakt in der Mitte der Rinne, sodass eine Zellenreihe eine ununterbrochene Linie
ergibt. Weniger offensichtlich: Auch eine **einspringende Ecke** schließt exakt, weil das Stück über
der Ecke und das Stück daneben denselben Punkt erreichen. Würde man nur zu ausgewählten Nachbarn hin
ausdehnen, bliebe dort eine Kerbe.

An der Außenkante des Grids gibt es keine Rinne und nichts zu treffen; dort endet ein Stück an der
Zellkante, und die Kontur bleibt innerhalb des Grid-Rahmens.

**Ecken sind eckig.** Da je nach Nachbarschaft nur einzelne Seiten gezeichnet werden, würde ein
Radius als Haken am Ende einer Kante erscheinen, die keinen Partner zum Einkrümmen hat.

Die Kontur ist reine Darstellung und liegt, wie die Geste, als zeigerdurchlässiges Overlay über dem
Grid — sie kann weder eine Spur belegen noch einen Klick schlucken. Was ausgewählt *ist*,
entscheidet unverändert Abschnitt 4.

---

## 10. Die Farbleiste

**Ort:** beim Grid, **unterhalb des Grids** — seit 2026-09-19 in **beiden** Modi, denn Färben und
Auswählen verändern das Layout nicht (Abschnitt 3). Nicht schwebend über den Zellen (das
verdeckt genau die Zellen, die sie färbt) und nicht in der globalen Navigationsleiste (ein
panelweites Bedienelement für eine Geste, die einem einzelnen Grid gehört).

**Sichtbarkeit: dauerhaft, solange Auswahl möglich ist** (also nicht während einer Suche), nicht erst
bei bestehender Auswahl. *Überholt:* bis 2026-09-19 „dauerhaft im Edit Mode“. Zwei konkrete Gründe:

1. Eine Leiste, die bei der ersten Auswahl erscheint, **verschiebt das Grid unter dem Zeiger**. Der
   unmittelbar folgende Shift-Klick landet dann auf der falschen Zelle. Dauerhaft montiert bewegt
   sich nichts.
2. Ein Farbfeld ist ein **Auswahlwerkzeug** und muss ohne bestehende Auswahl funktionieren — seit
   2026-09-20 ist das sogar seine Primäraktion dort (Abschnitt 8). Eine Leiste, die es erst mit
   Auswahl gibt, kann das nicht leisten.

**Ohne Auswahl** sind die Swatches gedimmt. *Präzisiert 2026-09-20:* Die Dimmung sagt „hier ist
gerade nichts zu färben“, nicht „hier passiert nichts“ — ein Klick wählt dort die Farbgruppe aus.

**Gestalt:** kompakte Swatches von etwa 18–20 px mit rund 6 px Abstand, in einer umbrechenden Reihe.
Bewusst **deutlich kleiner als eine Grid-Zelle** — die Palette darf nie wie eine weitere Grid-Zeile
aussehen. „Keine Farbe“ ist ein Swatch desselben Formats in derselben Reihe, dargestellt als
diagonaler Strich auf transparentem Grund, ohne Text: Es ist dieselbe Art von Aktion und nimmt an
denselben Regeln teil.

**Zwei Anzeigen, bewusst verschieden laut (präzisiert 2026-09-20):**

| Was | Wann | Anzeige |
|---|---|---|
| **scharfe Farbe** (`selectionPaintColor`) | eine Farbe ist gewählt — auch ganz ohne Auswahl | **Ring** in der Akzentfarbe um das Swatch |
| **Farbe der Auswahl** | alle ausgewählten Zellen haben denselben Wert (auch „ungefärbt“) | Rand des Swatch in `--text-normal` |
| — | gemischte Farben, keine Auswahl, keine scharfe Farbe | nichts |

Der Ring ist die laute Anzeige, weil er einen Zustand zeigt, den man sonst **nirgends** sehen kann:
was der nächste Shift-Zug malen wird. Er hängt an der fachlichen Variablen, nicht an `:focus` —
er überlebt also einen Klick woanders hin und verschwindet, wenn die Farbe nicht mehr scharf ist.
Beides sind `outline` bzw. `border-color`: **kein Pixel der Leiste bewegt sich**, in keinem Theme.

### 10.1 Der Tooltip sagt genau eine Sache (normativ seit 2026-09-20)

> Der Tooltip beschreibt **die Wirkung dieses Klicks in genau diesem Zustand** — keine
> Bedienungsanleitung aller Gesten.

Er ändert sich live mit dem Zustand der Auswahl und mit der gehaltenen Taste:

| Zustand | Farbfeld „Blau“ | „Keine Farbe“ |
|---|---|---|
| keine Auswahl | `Paint with blue from now on` | `Paint with no color from now on` |
| Auswahl vorhanden | `Apply blue to selection` | `Clear color from selection` |
| Shift gehalten | `Add all blue cells to selection` | `Add all uncolored cells to selection` |
| Strg/Cmd + Auswahl | `Remove all blue cells from selection` | `Remove all uncolored cells from selection` |
| Strg/Cmd ohne Auswahl | `Nothing selected to remove from` | dasselbe |

Die letzte Zeile ist die konsequente Anwendung derselben Regel: Ein Tooltip, der „entfernen“
verspricht, wo nichts entfernt werden kann, wäre wieder eine Anleitung statt einer Aussage.

*Überholt am 2026-09-20:* der frühere Sammel-Tooltip `Klick: anwenden · Strg+Klick: diese Zellen
auswählen · Shift+Klick: hinzufügen`. Alle Beschriftungen laufen weiter über die bestehende
i18n-Mechanik (en, ru, zh).

**Der Cursor sagt dasselbe** (Abschnitt 4.5): Über einem Swatch gilt dieselbe Modifier-Anzeige wie
über einer Zelle — Shift das Plus, Strg/Cmd das Minus, sonst der Pointer. Es ist derselbe
Zustandsträger und derselbe Tracker, nicht eine zweite Tastaturüberwachung.

*Damit eingelöst (offen seit 2026-09-18):* die zurückgestellte Idee, die Leiste beim **Halten**
eines Modifiers sichtbar umschalten zu lassen. Umgesetzt ist die Aussage-Ebene — Tooltip und Cursor.
Nicht umgesetzt bleibt das Ausgrauen von Farben, die im aktuellen Grid nicht vorkommen; das bleibt
ein Polish-Kandidat.

---

## 11. Lebensdauer der Auswahl

Die Auswahl ist **ephemer** und wird nie gespeichert. Sie ist an die **fachliche Grid-Identität**
gebunden — `(categoryId, variantId)` —, nicht an die Position oder die Render-Identität des Grids.
Sie wird verworfen bei:

- Wechsel der Kategorie beziehungsweise Shift-Auswahl in einem anderen Grid (Abschnitt 4.2 —
  Strg/Cmd in einem anderen Grid ist dagegen ein No-op, ein normaler Tool-Klick ebenso);
- Wechsel der Dynamic Variant (Dropdown, ⇄-Flip, Duplicate, New, Delete);
- jedem anderen Wechsel des Grid-Kontexts — Kategorie gelöscht, statisches Grid dynamisch gemacht,
  Grid in eine Flow-Kategorie umgewandelt, Ansicht gewechselt, Kategorie eingeklappt, Ordner
  geschlossen, Plugin oder View neu geladen;
- einer Suche, die das Panel filtert (das Grid zeigt dann nicht die gespeicherte Belegung);
- Escape oder einem Klick auf leeren Hintergrund.

**Kein Grund zum Verwerfen (seit 2026-09-19):**

- **ein Moduswechsel Locked ↔ Edit.** Selection ist operativ, der Modus schützt nur das Layout; ein
  Wechsel ändert das Grid nicht. Auswahl, Kontur und `selectionPaintColor` bleiben stehen. *Überholt:*
  Bis dahin stand an erster Stelle dieser Liste „Verlassen des Edit Mode“.
- **ein Kategorie-Reorder.** Das Grid bleibt dasselbe, nur seine Position ändert sich. Während des
  Drags ersetzt die Vorschau das gezogene Grid; die Verwerfungsprüfung wartet deshalb, bis der Drop
  das echte Grid zurückgebracht hat, und fragt dann erneut.

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

Zellfarben sind **Inhalt** und deshalb in **jedem** Modus sichtbar, auch im Locked Mode. Seit
2026-09-19 sind auch die **Auswahl und die Farbleiste** in beiden Modi verfügbar (Abschnitt 3);
dem Edit Mode gehören nur noch die **Layout**-Affordances: `+`, Kontextmenüs, Layout-Drag, Resize.
*Überholt:* Bis dahin standen Auswahl und Farbleiste in dieser Aufzählung der Edit-only-Elemente.

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
- „Run selected“ (*Auswahl im Locked Mode* stand hier bis 2026-09-19 — sie ist jetzt normativ
  vorgesehen, Abschnitt 3)
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

*Nachtrag 2026-09-19:* Der **Kategorie-Handle** (Abschnitt 5a) folgt derselben Regel wie die
Resize-Rinne — nur im Edit-Mode sichtbar, sein Platz im Locked-Mode leer und zeigerdurchlässig
reserviert, damit Icon und Name beim Sperren nicht seitlich springen. Ebenso modusabhängig ist seit
dem Cursor-Modell (Abschnitt 4.5) die Greif-Hand über einem Tool; sie ist eine Aussage über das
Layout, keine Änderung daran.
