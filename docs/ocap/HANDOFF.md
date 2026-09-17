# OCAP – Handoff (kompakter Snapshot)

Snapshot für neue Claude-Code-Sessions. Kein Verlauf — bei größeren
abgeschlossenen Arbeiten wird diese Datei ersetzt, nicht verlängert.

## 1. Projekt-/Git-Stand

- Repo: `H:\Dropbox\11-Projects\A1_Obsidian contextual action panel - OCAP`,
  Fork `MaxLaska/obsidian-contextual-action-panel`, independent fork von
  Buttons Panel 2.4.7.
- Branch `master`, HEAD `feat: support resizable action grids`, lokal vor
  `origin/master` — nicht ohne Auftrag pushen.
- Settings-Version: **4** (`CURRENT_SETTINGS_VERSION`), forward-only
  Migrationskette `0 → 1 → 2 → 3 → 4` in `src/settings/settingsMigrations.ts`.
  Ein Tool ohne Action ist **kein** Schemawechsel — `actions: []` war immer
  darstellbar, nur die Save-Validierung hat es verhindert.
- Teststand: `npm test` **455/455** (Vitest, node env, `tests/`),
  `npm run lint` 0 Probleme, `npx tsc --noEmit` grün,
  `node esbuild.config.mjs production` grün.

## 2. Produktmodell

- Eine Grid-Kategorie ist **statisch** (ein volles Grid in `category.buttons`)
  oder **dynamisch** (`category.variants`).
- Eine dynamische Kategorie hält mehrere **vollständige, unabhängige
  Variants**: eigene Grids inkl. eigener Größe, eigene Button-IDs, nichts
  geteilt.
- **Das Grid ist größenveränderlich: `rows` × `columns`, 1×1 bis 5×5.** Slots
  sind flache, zeilenweise gelesene Indizes (`slot = row * columns + column`),
  weiterhin stabile Identitäten (`ButtonConfig.slot`). Leere Slots bleiben
  leer; nichts rutscht nach.
- **Größe gehört zu genau dem Grid, das sie beschreibt:** `rows`/`columns`
  liegen auf der **Variant** (dynamisch) bzw. auf der **Kategorie** (statisch).
  Eine dynamische Kategorie trägt selbst keine Größe — sonst gäbe es zwei
  Wahrheiten.
- **Fehlende Felder sind die Abwärtskompatibilität:** ein gespeichertes Grid
  ohne `rows`/`columns` ist das historische **4×4**
  (`LEGACY_GRID_DIMENSIONS`). Keine Migration, kein Rewrite bestehender
  `data.json` — nur wirklich resizte und **neu angelegte** Grids schreiben die
  Felder. **Neue** Grids starten bei **1×3** (`DEFAULT_GRID_DIMENSIONS`); eine
  neue Variant erbt die Größe des Grids, das die Kategorie schon hat.
- **Resize ist koordinatenbewusst** (`remapSlot`/`resizeGridButtons`): ein
  Button behält seine logische Zeile/Spalte, auch wenn sein flacher Index sich
  ändert. `+ column` auf `A B C / D E F` ergibt `A B C . / D E F .`, nie
  `A B C D / E F . .`.
- **Verkleinert wird nur am Rand:** die äußerste rechte Spalte und die unterste
  Reihe. Ist der Streifen leer, verschwindet er sofort; hält er Tools, fragt
  eine Obsidian-Modal-Bestätigung (`GridResizeConfirmModal`) und nennt sie
  namentlich. **Bestätigt gelöscht heißt heute wirklich gelöscht** — ein Tool
  existiert nur auf seinem Grid. Sobald eine Tool-Library Definition und
  Placement trennt, ist genau diese Modal die Stelle, die sich ändert.
- Jede Variant hat **genau einen Trigger** (`ButtonCondition`) **oder** ist
  die einzige explizite **Fallback**-Variant.
- Runtime: **first matching trigger wins** (Array-Reihenfolge = Priorität),
  sonst Fallback, sonst Kategorie ausgeblendet. Ungültiger Trigger matcht
  nie (nicht fail-open — darf nichts überschatten).
- **Duplicate Variant ist der Hauptworkflow** (kopieren, umbenennen, Trigger
  ändern, wenige Slots anpassen); Kopie bekommt neue Variant- und Button-IDs.
- **Keine** Base/Pinned-Layer, **keine** Vererbung, **keine** Overrides,
  **keine** gesperrten/reservierten Slots. Redundante Speicherung zwischen
  Variants ist beabsichtigt.
- Grids ignorieren per-Button-Conditions (inertes Legacy-Feld); Flow-
  Kategorien behalten das per-Button-Modell. `CategoryConfig.conditions`
  bleibt reine Kategorie-Sichtbarkeit.
- Dynamisch → statisch/flow wird bewusst nicht angeboten (Datenverlustpfad).
- **Zwei Interaktionsmodi, nicht drei:** `locked` (normale Nutzung, kein DnD,
  keine Edit-Controls) und `edit` (DnD + Kontextmenüs + Add/Create + Variant-
  Selector). Der frühere `sort`-Modus ist in `edit` aufgegangen; gespeichertes
  `sort` migriert auf `edit` (Settings-Version 4) und wird beim Laden auch in
  nicht migrierbaren Daten in-memory normalisiert.
- **Der Lock-Toggle zeigt den ZUSTAND, nicht die Aktion:** geschlossenes
  Schloss = gerade locked, offenes = gerade edit; Tooltip nennt erst den
  Zustand, dann den Klick (`Locked — click to edit`). Global fürs ganze Panel,
  kein per-Category-Lock.
- **Ein Tool darf vor seiner Action existieren.** Name/Icon/Slot zuerst und
  die Action später ist ein legitimer Zustand; OCAP schreibt keine
  Konfigurationsreihenfolge vor. Beim Speichern werden **unberührte**
  Action-Zeilen verworfen, eine **halb** ausgefüllte blockiert weiterhin (sie
  stillschweigend zu verwerfen hieße, Eingaben wegzuwerfen). Ein Klick auf ein
  actionloses Tool sagt das (`No action assigned.`) statt zu schweigen.
- **Die Position ist Teil der Geste, nicht ein Formularfeld.** Ein Tool
  entsteht in der Zelle, auf die der Nutzer zeigt — über das `+` einer leeren
  Zelle oder über eine Vault-Datei, die aus Obsidians File Explorer auf sie
  gezogen wird. Deshalb gibt es unter einem Grid **keinen globalen
  `Add button`-Eintrag** mehr (Flow-Kategorien behalten ihn, dort gibt es keine
  Slots). Ein **volles** Grid bietet folgerichtig kein `+` — der Weg hinein ist
  dann eine Spalte oder Reihe mehr.

## 3. Architektur & Invarianten

- **Ein zentraler Renderpfad:** `projectCategoriesForContext`
  (`src/context/panelProjection.ts`) entscheidet allein, was gerendert wird —
  locked: Runtime-Auflösung; edit: die vom Nutzer editierte Variant.
  Liefert `gridViews` (aufgelöstes Grid pro Kategorie) an Rendering UND DnD.
- **Kontext:** `OCAPContextService` hält einen immutablen Snapshot
  (`useSyncExternalStore`); Quelle ist der zuletzt aktive Content-Leaf —
  Panel-Fokus ändert den Kontext nie.
- **Variant-spezifisches DnD:** Der Drag-State spiegelt exakt das EINE Grid
  auf dem Bildschirm; ein Drag in Variant A kann B nie berühren.
  `applySlotIdsToGridCategory` schreibt nur in die editierte Variant zurück.
  Previews/Drops werden von der Drag-Start-Baseline berechnet (keine
  Zwischentäusche über gekreuzte Zellen).
- **Ein Ziel ohne adressierbare Zelle ändert nichts** (`resolveGridDropOutcome`
  → `no-cell`: Lücke zwischen Zellen, Grid-Hintergrund, Title-/Tab-Zone):
  Preview UND Ziel-Ring bleiben stehen, ein Release dort committet genau das
  Sichtbare. Grund: `applyDragOverToItems` meldet „keine Änderung" als
  Rückgabe der Eingabe — und die Eingabe ist die Baseline; sie zu übernehmen
  ließ den gezogenen Button kurz im Startslot aufblitzen (der Zeiger kreuzt
  zwischen je zwei Zellen 4 px Lücke). Nur `blocked` und ein Release außerhalb
  des Button-Bereichs setzen noch auf die Baseline zurück.
- **Das Drop-Ergebnis überlebt die Props, aus denen es berechnet wurde**
  (`committedPropsRef`): `activeButtonId` wird vor Eintreffen der gespeicherten
  Settings geleert, ein Rebuild aus den noch alten Props würde den Button für
  einen Frame zurückspringen lassen. Jedes spätere Settings-Objekt löst die
  Sperre — ein fehlgeschlagener Save kann den Zustand nicht einfrieren.
- `dragForceCancelledRef` (Folder-Cancel) wird bei **jedem Drag-Start**
  zurückgesetzt: ein Escape-Cancel liefert kein `dragEnd`, das die Flag
  konsumiert, und verwarf sonst den Drop des nächsten Drags.
- **Alle Grid-Zellen sind permanente Droppables** (`GridSlotCell` rendert
  belegte und leere Zellen, keyed by Slot). Niemals zu per-Empty-Slot-
  Droppables zurückkehren — deren Mount/Unmount beim Variant-Wechsel war die
  Root Cause des intermittierenden „Drag tot"-Bugs (Registrierungs-/Rect-Race
  in dnd-kit). Die ganze Zelle ist die Hitbox; Collision-Ranking:
  Button > Slot-Zelle > Title/Tab/Container.
- **Desktop-DnD:** PointerSensor mit `distance: 4` px, bewusst OHNE
  `tolerance` (würde schnelle Drags canceln). Touch: Long-Press.
- **Die Spaltenzahl kommt aus den Daten, nicht aus der Breite** —
  `repeat(var(--ocap-grid-columns,4), minmax(0,1fr))`, gesetzt aus
  `ResolvedGridView.dimensions.columns`; kein Wrap bei schmaler Sidebar
  (verifiziert bis 150 px). Der CSS-Fallback `4` ist bewusst die Legacy-Zahl.
- **Der Drag-State ist so groß wie sein Grid** (`buildButtonDragItems` baut ihn
  aus derselben `ResolvedGridView`, aus der gerendert wird). Nichts darf mehr
  eine feste 16 annehmen: `isValidSlotIndex(value, slotCount)` verlangt die
  Grenze explizit, `parseSlotDroppableId` prüft nur noch die **Form** der Id,
  und die Obergrenze wird dort gezogen, wo der Live-Zustand des Containers
  bekannt ist.
- **Grid-Geometrie ist variant- und drag-invariant:** jede Zelle trägt in
  jedem Modus einen konstanten 1px-Rahmen (transparent in locked); Chrome nur
  über Farben (eine Container-Klasse `--managed`). Während eines Drags ändert
  sich kein Slot-Rect (live per-Frame gemessen: **worstΔ 0 px** in 4×5 und
  3×5).
- **Die Resize-Controls kosten Layout — und bleiben deshalb während eines Drags
  stehen.** Der Edit-Mode rahmt das Grid mit zwei schmalen Streifen
  (`.ocap-grid-frame`: Spalten rechts, Reihen unten, je ~18 px + 2 px Gap).
  Damit ist die frühere Zusage „Locked ↔ edit ändert die Slot-Rects um 0 px"
  **horizontal nicht mehr wahr**: im Edit-Mode ist das Grid um die Rinne
  schmaler (live gemessen: 15 px Versatz / 5 px Zellbreite bei 4 Spalten);
  vertikal bleibt alles gleich (dy = dh = 0 px). Bewusst so: eine dauerhaft
  reservierte Rinne würde im normalen (locked) Gebrauch Platz verschenken.
  **Der Rahmen wird beim Drag NICHT ausgehängt** — die Buttons werden nur
  deaktiviert; ihn zu entfernen gäbe die Rinne mitten im Drag ans Grid zurück
  und verbreiterte jede Zelle.
- **Slot-Geometrie ist inhaltsunabhängig und während eines Drags stabil:** die
  Zeilenhöhe kommt aus einem definiten Track (`grid-auto-rows:
  var(--ocap-grid-row-height)` = Slot-Token + 2px Zellrahmen), nie aus dem
  momentanen Zellinhalt. Mit `auto`-Zeilen war eine Reihe mit Button um zwei
  Zellrahmen höher als eine komplett leere — ein Drag, der seine Quellreihe
  leerte oder in eine leere Reihe previewte, verschob dadurch mitten im Drag
  alle darunterliegenden Slots (live gemessen: 1,33 px). Keine Regel, die an
  Belegung/Ziel/Preview hängt, darf eine feste Größe setzen (gepinnt in
  `tests/paletteGridGeometry.test.ts`).
- **Datei-Drop und Button-DnD sind zwei getrennte Mechanismen und können sich
  nicht stören:** OCAPs Button-DnD ist pointer-basiert (dnd-kit) und erzeugt
  nie HTML5-Drag-Events; der Drop aus dem File Explorer ist ein nativer
  HTML5-Drag und läuft ausschließlich über `dragenter/dragover/drop` auf der
  Zelle. Eine belegte Zelle akzeptiert den `dragover` gar nicht erst — ein
  Datei-Drop kann nichts überschreiben.
- **Der Drag aus dem File Explorer wird über `app.dragManager.draggable`
  gelesen** (Obsidians eigene Drag-Buchführung, die einzige Quelle, die
  während `dragover` überhaupt lesbar ist — der HTML5-Standard verbietet dort
  das Lesen von DataTransfer-*Inhalten*). Fallback beim Drop ist `text/plain`;
  der File Explorer schreibt dort real `obsidian://open?vault=…&file=…`
  (live gemessen), andere Quellen Linktext. **Nicht** die Browser-`File`-API:
  ein Vault-Drag trägt TFiles, `dataTransfer.files` ist dabei leer.
- **Ein gedroppter File wird auf die BESTEHENDEN Actions abgebildet**, nie auf
  einen neuen Mechanismus: `.js` innerhalb des konfigurierten Script-Ordners →
  `script` mit dem ordnerrelativen Namen, den `ScriptService` erwartet
  (`<scriptFolderPath>/<scriptName>`); `.js` außerhalb → `file` plus Hinweis,
  weil `Run script` es gar nicht adressieren kann; alles andere → `file` mit
  dem exakten Vault-Pfad.
- Drag-Debugging: `window.__OCAP_DND_DEBUG = true` traced den kompletten
  dnd-kit-Lifecycle (flag-gated, kostenlos wenn aus).
- Settings-Objekte sind immutable-per-edit (Änderung = neue Objektidentität);
  React-Memos vergleichen Identität.
- **Trigger sind lesbar ohne Editor:** `summarizeCondition` /
  `summarizeVariantTrigger` (`src/utils/conditionSummary.ts`) sind die EINE
  Quelle für Trigger-Text (Variant-Bar und Variant-Übersicht im Category-Modal
  nutzen beide sie). Kompakt statt vollständig: >3 Kinder kollabieren zu
  `+n more`, harte Länge 120 Zeichen.
- **Eine dynamische Kategorie signalisiert sich nur über ihr Icon**
  (`git-branch`, akzentfarben, Tooltip `Dynamic category — content changes
  with context`, `src/utils/categoryIcon.ts`) — nie zusätzlich über das
  Legacy-`ContextStatusBadge` (pin/filter), das gleichzeitig „pinned" behaupten
  würde. Flow-Kategorien behalten ihr Badge. Gilt in List, Tabs und Folder.
- **Produktiv-Vault (`H:\Dropbox\01_Uni\A1_Nexus`) niemals für Tests
  verwenden.** Live-Tests nur in isolierter Obsidian-Instanz (scratch
  `--user-data-dir` + `--disable-backgrounding-occluded-windows`, Snapshot
  von `C:\Users\flash\ObsidianTestVaults\ocap-smoke`).

## 4. Wichtigste Source-Dateien

- `src/utils/categoryVariants.ts` — pure Kern: Variant-Auflösung
  (`resolveDynamicCategoryVariant`, `resolveGridViewForContext/-Variant`),
  Variant-Ops (add/update/move/duplicate/remove), Drag-Write-back,
  Konvertierungen.
- `src/context/panelProjection.ts` — zentrale Projektion Settings + Kontext +
  Modus → gerenderte Kategorien, Marker-Sets, `gridViews`.
- `src/context/conditions.ts` — Condition-Interpreter (fail-open) +
  Sichtbarkeitshelfer. Regeln: `fileName` (equals/startsWith/contains/
  endsWith, voller Name inkl. Endung, leerer Wert matcht nichts), `folder`,
  `path`, `extension`, `property`, `tag`, `viewType`.
- `src/utils/conditionSummary.ts` — pure Trigger-/Condition-Zusammenfassung.
- `src/utils/categoryIcon.ts` — Icon pro Kategorie-Art (dynamic/static/flow).
- `src/context/OCAPContextService.ts` — reaktiver Kontext-Snapshot-Store.
- `src/contexts/ButtonDragContext.tsx` — DndContext-Provider: Sensoren,
  Drag-State (`items`), Baseline-Previews, Persistierung, Debug-Tracing.
- `src/utils/buttonDragItems.ts` — pure Drag-State-Semantik: Slot-Droppable-
  IDs, `applyDragOverToItems` (move/swap/flow-Regeln),
  `resolveGridDropOutcome` (accept/blocked/no-cell).
- `src/utils/buttonDragCollision.ts` — Collision-Ranking der Button-Drags.
- `src/utils/categoryGrid.ts` — **pure Grid-Geometrie**: `GridDimensions`,
  `readGridDimensions` (fehlend = Legacy 4×4), `DEFAULT_GRID_DIMENSIONS` (1×3),
  Grenzen 1–5, `remapSlot`, `resizeGridButtons`, `placeButtonsOnGrid`
  (dimensionsbewusst), `fitGridDimensions` für flow → grid.
- `src/components/buttons-panel/CategoryButtonGrid.tsx` — rendert das Grid
  einer Kategorie inkl. Variant-Selector-Einbindung, SortableContext und
  (nur im Edit-Mode) des Resize-Rahmens.
- `src/components/buttons-panel/GridResizeControls.tsx` — die beiden
  Control-Streifen (−/+ rechts für Spalten, −/+ unten für Reihen).
- `src/hooks/useGridResize.ts` — löst Ziel-Kategorie und -Variant wie `+` und
  File-Drop auf, fragt bei belegtem Streifen nach und persistiert; rechnet vor
  dem Commit gegen den **aktuellen** Stand neu (die Bestätigung ist async).
- `src/components/modal/GridResizeConfirmModal.ts` — die Bestätigung.
- `src/components/buttons-panel/GridSlotCell.tsx` — die universelle Zelle
  (kennt die Spaltenzahl nur für ihre Zeile/Spalte-Tooltips):
  permanentes Droppable, gefüllt oder leer, keyed by Slot; im Edit Mode
  zusätzlich das `+` und das native Datei-Drop-Ziel einer leeren Zelle.
- `src/utils/vaultFileButton.ts` — **pure** Abbildung Vault-Datei → Tool
  (Name, Icon-Id, `file`/`script`-Action, `resolveScriptName`). Obsidian-frei
  und direkt testbar.
- `src/utils/obsidianFileDrag.ts` — Lesen des Obsidian-Drags
  (`app.dragManager.draggable`, `parseDraggedLinkText` als Fallback).
- `src/hooks/useSlotFileDrop.ts` — persistiert das Drop-Ergebnis in genau dem
  Slot und genau der editierten Variant.
- `src/actions/ActionSequence.ts` — `collectConfiguredActions()` ist die EINE
  Regel „was wird gespeichert": unberührte Zeilen fallen weg, halb gefüllte
  blockieren. `IButtonAction.isEmpty()` unterscheidet beides.
- `src/components/buttons-panel/VariantSelector.tsx` — `Editing:`-Dropdown,
  ⇄-Flip, Duplicate/Neu/⋮-Menü, `Trigger:`/`Active now:`-Statuszeile.
- `src/contexts/CategoryVariantContext.tsx` — Session-lokale Variant-Auswahl
  (`selectedVariantOf`: explizite Wahl > Runtime-Variant > erste; nie eine
  gelöschte).
- `src/components/buttons-panel/PanelContent.tsx` — verdrahtet Projektion,
  Variant-Selection-State und DnD-Provider.
- `src/components/buttons-panel/PaletteGrid.css` — Grid-/Zellen-/Variant-Bar-
  Styling inkl. Geometrie-Invarianz.
- `src/settings/settingsMigrations.ts` — versionierte Migrationskette.
- `src/components/modal/VariantModal.ts` + `CategoryEditModal.ts` — Variant-
  Anlage/-Bearbeitung; das Category-Modal hält die editierbare Variant-/
  Trigger-Übersicht (nutzt dieselbe `VariantModal` und dieselben puren
  Variant-Ops wie der Variant-Selector).
- `src/components/input/ConditionEditor.ts` — visueller Condition-Builder
  (Regelreihenfolge, Hints, Advanced-JSON).
- `src/components/shared/NavigationBar.tsx` — u. a. der globale Lock-Toggle.

## 5. Manueller UX-Stand

- Das Variant-Modell ist laut Nutzertest grundsätzlich verständlich und
  brauchbar; kein Modellwechsel geplant.
- Der intermittierende DnD-Ausfall nach Variant-Wechsel ist durch die
  permanenten Zell-Droppables behoben (live: >200 automatisierte Drags über
  Switch-/Flip-/Mode-Sequenzen, 0 Ausfälle, 0 Konsolenfehler).
- Das Raster ist im Edit-Modus deutlich sichtbar (belegte Zellen solide,
  leere gestrichelt, Hover auf leeren Zellen); locked bleibt chrome-frei.
- Drag-Vorschau, Overlay und Endzustand sind geometrisch identisch
  (zentriert, gleiche Größe, kein Sprung beim Drop).
- Der Startslot bleibt während des gesamten Drags ruhig: kein Aufblitzen beim
  Zielwechsel und keiner beim Drop (live per-Frame gemessen). Erscheint dort
  ein anderes Tool, ist das die gewollte Swap-Vorschau; fährt der Zeiger auf
  den Startslot zurück, zeigt er korrekt wieder „hier ändert sich nichts".
- ⇄ wechselt zwischen den letzten beiden editierten Variants und zeigt den
  Zielnamen (`⇄ Source`); Historie bewusst 1 Schritt tief, session-lokal.
- Priorität: erste passende Variant gewinnt; UI-Wording „Move up (wins
  earlier)" / „Move down (wins later)" + Hinweis im Trigger-Tooltip.
- `Editing:` vs. `Active now:` bleibt immer beides sichtbar; ohne explizite
  Wahl wird die runtime-aktive Variant vorausgewählt.
- Das Category-Modal zeigt **alle Variants auf einen Blick** (Spalten
  Priority / Variant / Trigger, Fallback als `—`), jede Zeile mit Pencil
  (öffnet dieselbe `VariantModal`) und ↑/↓ — kein Durchklicken einzelner
  Variants mehr, nur um die Konfiguration zu verstehen.
- **Slot-lokale Erstellung live verifiziert** (isolierte Obsidian 1.13.7,
  scratch `--user-data-dir`, Snapshot von `ocap-smoke`, CDP-getrieben,
  Error-Monitore aktiv: **0 Fehler** über den ganzen Lauf): Edit Mode zeigt
  genau in den freien Zellen ein `+` (12/12 bzw. 16/16), locked 0; ein echter
  Mausklick auf ein konkretes `+` öffnet das Create-Modal **ohne** einen
  Kategorie-Drag auszulösen; Save mit Name + Icon und leerer Action landet in
  exakt diesem Slot mit `actions: []`; ein Klick darauf zeigt
  `No action assigned.`; ein volles 4×4-Grid hat 0 `+` und akzeptiert auch
  keinen Datei-Drop. Grid-Geometrie edit↔locked war damals **worstΔ 0 px**;
  seit den Resize-Controls gilt das nur noch vertikal (siehe Abschnitt 3).
- **Datei-Drop live verifiziert** mit echtem `dragstart` auf der
  File-Explorer-Zeile (Obsidians eigener Handler füllt `dragManager`, nichts
  gefälscht): `other/Becker_Westerholt.pdf` → `file`-Tool mit exaktem Pfad,
  Klick öffnet das PDF in einem `pdf`-Leaf; `scripts/test.js` → `script`-Tool
  mit `scriptName: "test.js"`, Klick führt den Script-Entry genau einmal aus
  („Script lief"). Hover hebt genau eine Zelle hervor und lässt beim Verlassen
  wieder los. Drop auf eine **belegte** Zelle: `dragover` wird nicht akzeptiert,
  Daten unverändert. Fallback geprüft, indem `dragManager.draggable` gezielt
  geleert wurde — die `obsidian://`-URI aus `text/plain` reicht allein.
- **Dynamic Variants treffen:** mit ausgewählter Variant `Z` landeten `+`-Save
  (Slot 3) und PDF-Drop (Slot 14) **nur** in `Z`; die vier anderen Variants
  blieben byte-gleich. Das Modal nennt das Ziel („Belongs to").
- **Bestehendes DnD unverändert:** 12/12 echte Move-/Swap-Drags korrekt
  (auch auf leere Zellen, wo der Zeiger über dem `+` liegt), Hin- und
  Rückdrags stellen den Ausgangszustand wieder her. Geprüft in List-, Tabs-
  und Folder-View; in allen dreien ist der globale `Add button` unter einem
  Grid verschwunden und bei Flow-Kategorien erhalten.
- **Variables Grid live verifiziert** (isolierte Obsidian 1.13.7, scratch
  `--user-data-dir`, Snapshot von `ocap-smoke`, **Legacy-Fixture ohne
  `rows`/`columns`**, CDP mit echtem Maus-Input, Fehlermonitore aktiv:
  **0 Fehler** über den ganzen Lauf):
  - Legacy-Daten rendern als **4×4 / 16 Zellen**, Buttons auf ihren
    gespeicherten Slots; die Kategorie bekommt dabei **keine** Größenfelder.
  - `+ column` 4×4 → 4×5 verschiebt B von Slot 5 auf 6 und P von 15 auf 18 —
    beide bleiben in **derselben Zeile/Spalte**. `+ row` lässt alles stehen.
  - Bei 5×5 sind beide `+` deaktiviert; bei 1×1 beide `−`.
  - Leere äußere Reihe/Spalte verschwindet **ohne** Nachfrage; belegte fragt
    (`Remove the right column? 1 tool will be deleted.` mit Namensliste),
    **Cancel lässt das Grid byte-gleich**, `Remove` schneidet **nur** diesen
    Streifen ab.
  - Neue Grid-Kategorie über das echte Modal: gespeichert als
    `rows: 1, columns: 3`, gerendert als 3 Zellen mit 3 `+`.
  - Locked: **0 Resize-Streifen, 0 `+`**. Zellhöhen locked ↔ edit identisch
    (dy = dh = 0 px), Breite um die Rinne schmaler (siehe Abschnitt 3).
  - DnD in **4×5, 3×5 und 2×4**: Move und Swap korrekt, Zell-Geometrie
    während des Drags per-Frame gemessen **0 px** Abweichung.
  - Slot-`+` in einer **neu hinzugefügten Spalte** legt das Tool genau dort an
    (Slot 4 = Zeile 0, Spalte 4).
  - Datei-Drop (`other/Becker_Westerholt.pdf`, echter `dragstart` auf der
    File-Explorer-Zeile) auf eine **erst durch den Resize entstandene** Zelle
    (Slot 9 = Zeile 1, Spalte 4) erzeugt das `file`-Tool dort; genau eine Zelle
    leuchtet, beim Verlassen wieder aus; eine **belegte** Zelle akzeptiert den
    `dragover` weiterhin nicht.
  - Variant-Größen sind unabhängig: `VarA` auf 2×3 verkleinert, `VarB` blieb
    byte-gleich 4×4 und wurde danach eigenständig auf 4×5 gebracht
    (B2 5 → 6, gleiche Zeile/Spalte). Legacy-Kategorie unberührt.
  - `Make dynamic…` über das echte Kontextmenü: die erzeugte Variant trägt
    `rows: 2, columns: 4`, die Kategorie danach **keine** Größe mehr. `Copy`
    kopiert die Größe mit.
  - Nach vollem Window-Reload: Dimensionen und alle Buttons unverändert.
- Der Condition-Editor startet mit `File name` (verständlichste Regel) und
  erklärt `File name` und `View type` mit einer Hint-Zeile — `View type` wurde
  im Nutzertest als „Node Type" missverstanden.

## 6. Offene Punkte / nächste Baustellen

1. **Slot-Hotkeys** (nächstes geplantes Feature) — Slot-Identität ist stabil
   und variant-unabhängig; nur die Keybinding-Schicht fehlt.
2. **Toggle-Tools** (OFF/ON mit eigenen Actions/Appearance) — braucht einen
   Tool-Typ-Begriff auf `ButtonConfig`.
3. Rich Tooltips und Kategorie-/Variant-Export/Import (reine Serialisierung).
4. **Flow-Kategorien haben dieselbe Falle wie zuvor das Grid:** ein Release auf
   dem Container-Hintergrund derselben Flow-Kategorie rechnet gegen die
   Baseline zurück und verwirft die Umsortierung (live reproduziert, nicht
   Teil des Grid-Fixes). Normales Ziehen Button→Button funktioniert.
5. Kategorie-Block ist in der Liste von jeder Nicht-Button-Fläche ziehbar —
   Press auf leere Zelle startet einen Kategorie-Drag (Upstream-Verhalten,
   bewusst so belassen); bei Zellen <35 px werden Labels hart geclippt. Das
   `+` schluckt seinen eigenen Press (`pointerdown`/`mousedown`/`touchstart`),
   sonst würde ein Klick darauf die Kategorie ziehen statt das Modal zu öffnen.
6. Packaging-/Release-Strategie + finale Manifest-ID; locked-mode Empty-State;
   jsdom-Editor-Tests weiterhin offen.
7. Restpunkte des Slot-Create-Pass:
   - Ein per Drop erzeugtes Tool bekommt ein generisches Icon
     (`file` / `file-text` / `file-code`, über Obsidians `getIcon` als SVG
     gespeichert — dieselbe Form, die der Icon-Picker schreibt). Eine echte
     Icon-Automatik gibt es bewusst noch nicht.
   - Ein Drop bringt nur **eine** Datei ins Ziel (eine Zelle = ein Tool);
     Multi-Select-Drags legen nicht mehrere Slots an.
   - Ein Drop auf eine **belegte** Zelle tut nichts (kein Replace-Dialog).
   - `.js` außerhalb des Script-Ordners wird zu `Open file` plus Hinweis;
     `Run script` kann es nicht adressieren (Pfade relativ zum Ordner, kein
     `../`).
8. Restpunkte des Variable-Grid-Pass:
   - Entfernt werden nur die **äußerste rechte Spalte** und die **unterste
     Reihe**; kein Einfügen/Löschen in der Mitte, oben oder links.
   - Eine bestätigte Entfernung **löscht** die Tools des Streifens (siehe
     Abschnitt 2) — kein Undo außer „nicht bestätigen".
   - Der Edit-Mode ist horizontal um die Control-Rinne schmaler als locked
     (Abschnitt 3); bewusst, aber sichtbar.
   - Die Dimension einer **dynamischen** Kategorie hängt an der Variant, also
     kann ein Kontextwechsel im locked Mode die Panelhöhe ändern, wenn zwei
     Variants unterschiedlich groß sind. Gewollt — eine Variant ist ein
     vollständiges eigenes Grid.
   - `flow → grid` wählt jetzt die kleinste passende Größe (ab 1×3, bis 5×5)
     und verweigert erst ab **26** Buttons (vorher 17).
9. Bewusst nicht umgesetzt (kommt später): Tool-/Button-Library und die
   Trennung von Button-Definition und Placement, Panel-Templates, JSON
   Import/Export, per-Category-Lock, „Pin active dynamic variant",
   Toggle-Tools, Slot-Hotkeys, Icon-Picker, ZotFlow-Annotationen auf Slots.

## 7. Arbeitsregel für neue Sessions

1. Zuerst `CLAUDE.md` und diese Datei (`docs/ocap/HANDOFF.md`) lesen.
2. Git prüfen (Branch, HEAD, Working Tree, origin-Abstand).
3. `STATUS.md`, `DECISIONS.md` und `docs/ocap/audits/` NICHT vollständig als
   Pflichtlektüre lesen — nur bei konkretem Bedarf gezielt konsultieren
   (Entscheidungsbegründungen, Migrationsdetails, Live-Test-Aufbauten).
4. Danach direkt die für die Aufgabe relevanten Source-Dateien lesen; bei
   Widerspruch gilt der Code, nicht die Doku.
