# Dynamic Action Panel – Handoff (kompakter Snapshot)

Snapshot für neue Claude-Code-Sessions. Kein Verlauf — bei größeren
abgeschlossenen Arbeiten wird diese Datei ersetzt, nicht verlängert.

## 1. Projekt-/Git-Stand

- **Produktname: `Dynamic Action Panel`.** Früher „Obsidian Contextual Action
  Panel (OCAP)". Das Rebranding ist abgeschlossen; Details und die Liste der
  bewusst behaltenen Legacy-Identifier:
  `docs/ocap/rebranding-dynamic-action-panel.md`. **Kein Akronym** —
  ausgeschrieben schreiben, `DAP` ist kein Projektbegriff. Intern gilt
  Domänensprache (Panel, Grid, Tool, Category, Variant, Cell, Template),
  kein Produktname in Identifiern.
- **Plugin-ID ist `dynamic-action-panel`** (seit der Identity-Migration, siehe
  Abschnitt „Plugin identity migration" in
  `docs/ocap/rebranding-dynamic-action-panel.md`). Damit ist der
  Installationsordner `.obsidian/plugins/dynamic-action-panel/` und die
  Command-IDs sind `dynamic-action-panel:*` (Obsidian leitet den Namespace aus
  der ID ab; unsere Sub-IDs sind unverändert). Grund war **nicht** das
  Rebranding, sondern die Update-Kollision mit dem veröffentlichten Upstream
  `buttons-panel`. `buttons-panel` als Plugin-ID ist ab hier rein historisch.
- **Bewusst NICHT umbenannt** (Contracts, keine Namen): View-Type
  `buttons-panel-view` (unabhängig von der Plugin-ID — genau deshalb überlebt
  ein gespeichertes Panel-Leaf die ID-Migration), CSS-Klassen
  `buttons-panel-*` / `ocap-*`, Custom Properties `--ocap-*`, DOM-Events
  `buttons-panel-refresh` / `-search`, die persistierten Farbwerte
  `ocap:<name>`, das Template-Format `ocap-template` / `.ocap.json` samt
  `OCAP_TEMPLATE_*`-Konstanten, die `ButtonsPanel*`-TS-Identifier (sie
  spiegeln genau diese Contracts) und der Pfad `docs/ocap/`. In älteren
  Audits steht `OCAP` weiterhin als der damalige Projektname — Historie
  nicht umschreiben.
- Repo: `H:\Dropbox\11-Projects\A1_Obsidian contextual action panel - OCAP`,
  Fork `MaxLaska/dynamic-action-panel`, independent fork von Buttons Panel
  2.4.7. Das GitHub-Repository ist umbenannt, About und Topics sind gesetzt,
  und der lokale `origin` zeigt auf
  `https://github.com/MaxLaska/dynamic-action-panel.git`. Das Rebranding ist
  damit vollständig abgeschlossen.
- Branch `master`. Stand nach dem Rebranding-Pass: Working Tree sauber, fünf
  Commits (internal naming / public branding / HANDOFF / CSS- und
  Keyword-Nachzug / Review-Findings). Davor war `2ba2cf1` gepusht und `master`
  mit `origin/master` synchron.
- Settings-Version: **5** (`CURRENT_SETTINGS_VERSION`), forward-only
  Migrationskette `0 → 1 → 2 → 3 → 4 → 5` in
  `src/settings/settingsMigrations.ts`. v5 ist der Tool-Registry-Refactor
  (Definition + Placement getrennt, siehe Abschnitt 2a und
  `docs/ocap/audits/2026-09-17-architecture-audit-target-model.md`).
- **Produktiv-Vault (`A1_Nexus`) läuft auf v5.** Der v5-Build ist deployt, die
  produktive `data.json` steht auf `settingsVersion: 5`. Die byte-genaue Kopie
  der damaligen v4-`data.json` liegt weiterhin als Fixture unter
  `tests/fixtures/data-v4-real.json` und ist in
  `tests/realDataMigration.test.ts` verlustfrei gepinnt.
- **Produktive Installation liegt seit der Identity-Migration unter
  `.obsidian/plugins/dynamic-action-panel/`**; die `data.json` wurde dabei
  byte-identisch übernommen (keine Migration, kein Rewrite). Der alte Ordner
  `buttons-panel` ist entfernt, ein vollständiges Backup liegt unter
  `C:\Users\flash\ObsidianTestVaults\ocap-backups\`.
- Teststand: `npm test` **602/602** (Vitest, node env, `tests/`),
  `npm run lint` 0 Probleme, `npx tsc --noEmit` grün,
  `node esbuild.config.mjs production` grün.
- Achtung: `npm run build` deployt zusätzlich nach `VAULT_PATH` aus `.env`
  (aktuell der Smoke-Vault `ocap-smoke`). Für reine Verifikation
  `node esbuild.config.mjs production` direkt verwenden.

## 2a. Persistenzmodell v5: Tool-Registry + Placements

- **Gespeichert wird seit v5 in zwei Hälften:** die funktionale
  `ToolDefinition` (id, name, icon als SVG-Markup, actions,
  executionMode/stopOnError/delay, customCss, conditions, `library?`)
  liegt genau EINMAL im Root-Record `settings.tools` (Key = Tool-ID);
  die Platzierung ist ein `ToolPlacement` (`{ toolId, slot? }`) in
  `category.placements` bzw. `variant.placements` (`StoredCategory` /
  `StoredVariant` in `src/types/settings.ts`).
- **Grid-Position hat nur noch eine Wahrheit:** `placement.slot` (row-major).
  Es gibt kein `order`-Feld mehr auf Grid-Placements; die Selbstheilung
  kaputter Slots nutzt die Placement-Array-Reihenfolge als Tiebreaker
  (dieselbe `placeButtonsOnGrid`-Implementierung wie immer, über
  Index-Platzhalter — `placeStoredGrid` in `src/domain/tools.ts`).
- **Flow-Kategorien nutzen dasselbe Modell** (F4): slotlose Placements,
  Array-Reihenfolge = sichtbare Reihenfolge; per-Tool-`conditions` liegen auf
  der Definition und wirken unverändert nur in Flow.
- **`ButtonConfig`/`CategoryConfig`/`CategoryVariant` sind seit v5 die
  RUNTIME-VIEW-Shapes:** die EINE Materialisierungsgrenze ist
  `ButtonsPanelView.getCategoriesForRender()` →
  `materializeCategoriesForRuntime` (`src/domain/tools.ts`, per-Kategorie
  gememoized über Objekt-Identität). Renderer, DnD-State, Projektion und
  Modals konsumieren weiter exakt die alten Shapes; jeder Write-Pfad löst
  die STORED Category per id auf.
- **Alle Mutationen laufen über pure Domain-Ops**
  (`src/domain/categoryOps.ts`, Zustand `{ tools, categories }`) und den
  Commit-Funnel (`commitToolState` / `commitStoredCategory` /
  `commitCategories` in `src/utils/categoryStore.ts`). Kein Hook/Modal
  editiert Placement-Arrays oder die Registry von Hand.
- **Lifecycle/GC (F1):** Create (`+`, File-Drop, Copy) registriert Definition
  UND Placement in einem Schritt, ohne `library`-Flag. Eine
  Nicht-Library-Definition wird genau dann entfernt, wenn eine EXPLIZITE
  Remove-/Delete-Operation (Tool löschen, Variant löschen, Kategorie
  löschen, bestätigter Resize-Cut) ihre letzte Referenz nimmt (`gcTools`).
  Moves, Swaps, Drag-Rewrites und Previews sammeln NIE; ein
  Cross-Category-Move kann keine Definition verlieren. Keine Refcounts,
  keine Hintergrund-GC — Referenzen werden live aus dem State bestimmt.
- **`library: true` ist ein UI-loses Domain-Feld** (F3): die Definition
  überlebt dann auch mit 0 Placements und überlebt jede GC. Edit-Roundtrips
  durch die View-Shape erhalten das Flag (`updateToolDefinition`).
- **Copy/Duplicate sind Vollkopien (F2):** Button-Copy, Duplicate Variant
  und Copy Category erzeugen frische Tool-IDs mit tief kopierten
  Definitionen — niemals implizites Sharing; Kopien starten ohne
  `library`-Flag. Geteilte Definitionen entstehen erst später durch
  explizites Platzieren desselben Library-Tools.
- **Migration v4→v5** (`migrateV4toV5`): Button-IDs werden zu Tool-IDs
  (unverändert), Grids werden vor der Zerlegung mit der bestehenden
  Selbstheilung materialisiert (nichts verrutscht), `rows`/`columns` gehen
  Feld-für-Feld durch (fehlend bleibt Legacy-4×4), vault-weite doppelte IDs
  werden deterministisch geheilt (`--dupN`), inerte `buttons` dynamischer
  Kategorien überleben als inerte Placements. Kein migriertes Tool bekommt
  `library`. Importe (später) remappen grundsätzlich auf frische IDs (F5).
- **Fehlende Datei-Referenzen sind kein Fehlerzustand:** Action-Parameter
  tragen Vault-Pfade unverändert; das Runtime scheitert lazy mit Notice
  (`File not found: …`, live verifiziert).

## 2b. Portables Template-Format (Export/Import)

- **Eine Kategorie (inkl. aller Dynamic Variants und aller referenzierten
  Tools) ist als Datei transportierbar:** `Research.ocap.json`, Format-Id
  `ocap-template`, **eigene** `formatVersion: 1`
  (`OCAP_TEMPLATE_FORMAT_VERSION`) — bewusst UNABHÄNGIG von
  `settingsVersion`, sonst würde jede interne Migration alle je exportierten
  Templates entwerten. Vollständige Spezifikation:
  `docs/ocap/template-format.md`.
- **Die interne `data.json` ist NICHT das Exportformat.** Das Dokument trägt
  weder `order` (Position = Array-Reihenfolge bzw. Importer-Sache) noch
  `library` (vault-lokale Lifecycle-Entscheidung).
- **IDs im Dokument sind paketlokale REFERENZEN, keine Identitäten.** Der
  Import erzeugt für Kategorie, Variants und Tools frische IDs
  (`freshId`) und schreibt alle Referenzen um. Deshalb kann ein Import nichts
  Bestehendes überschreiben, und dieselbe Datei lässt sich zweimal
  kollisionsfrei importieren. Ein Tool, das das Dokument zwischen zwei
  Placements teilt, bleibt danach geteilt — das war das exportierte Panel.
- **Import erzeugt, Import merged nicht.** Keine Deduplizierung nach Name,
  Action, Icon, Pfad oder Hash; ein importiertes Tool bleibt eine eigene
  Definition. Namenskollisionen bekommen ein lesbares Suffix
  (`Research` → `Research (imported)` → `Research (imported 2)`), kein
  Merge-Dialog. Importierte Kategorien werden ans Ende gehängt.
- **Atomar:** parse → validate → interne Referenzen prüfen → IDs remappen →
  nächsten `ToolState` planen → **ein** `commitToolState`. Alles davor ist
  pure Planung, also lässt eine kaputte/fremde/zu neue Datei den Zustand
  byte-gleich (keine halbe Kategorie, keine halben Tools, keine
  Registry-Leichen).
- **Export ist strikt read-only:** keine IDs, keine normalisierte und
  persistierte Reihenfolge, kein GC, keine Migration, kein `library`-Flag,
  keine `ToolDefinition` angefasst. Nur die tatsächlich referenzierten Tools
  der exportierten Kategorien landen im Paket.
- **Externe Ziele bleiben unverändert** (`Literatur/Bieker_Westerholt.pdf`
  bleibt exakt dieser String). Eine fehlende Datei blockiert den Import NIE;
  die bestehende Lazy-Fail-Notice (`File not found: …`) ist die richtige
  Stelle. Die Import-Zusammenfassung meldet die Zahl fehlender Ziele, ohne
  Pfade zu korrigieren, zu raten oder zu ersetzen.
- **Ein Template ist Daten, kein Code.** Der Parser validiert Actions und
  Condition-Bäume als Werte gegen die bekannten Unions und BAUT NEU (kein
  Spread unvalidierter Objekte, keine unbekannte Property wird übernommen);
  Dokument-Keys werden gegen `__proto__`/`constructor`/`prototype` geprüft und
  die Tool-Registry wird mit `Object.create(null)` gebaut; Größen- und
  Tiefenlimits begrenzen die Arbeit; dangling interne Tool-Referenzen und ein
  zweites Fallback werden abgelehnt. Importieren führt nichts aus.
- **Template Library:** Export und Import laufen über einen festen, sichtbaren
  Vault-Ordner `Dynamic Action Panel/Templates/` (`src/export/templateLibrary.ts`).
  Er wird bei Bedarf angelegt, beide Ebenen einzeln geprüft; ein verlorenes
  Rennen gegen Sync zählt als Erfolg, solange der Ordner danach da ist. Der Pfad
  ist **absichtlich nicht konfigurierbar** — der Sinn ist, dass der User ihn
  ohne Nachschlagen kennt. `pathConfig.templateFolderPath` ist etwas anderes
  (Notiz-Templates der `create_file`-Action) und wird NICHT mitbenutzt.
- **Export** schreibt `<Category>.ocap.json` in die Library, mit der bisherigen
  Kollisionsleiter (`Research 1`, `Research 2`, …). Der Ordnerpräfix hängt an
  jedem Zweig inklusive dem Timestamp-Fallback nach 999 Kollisionen — genau das
  pinnen die Tests, weil ein Zweig ohne Präfix wieder in der Vault-Wurzel landen
  würde. Schlägt die Ordneranlage fehl, wird gar nicht geschrieben.
- **Import (primär)** ist ein `FuzzySuggestModal` über die `.ocap.json` in
  genau diesem Ordner (`src/export/TemplateSuggestModal.ts`), sortiert nach dem
  angezeigten Namen (numerisch, damit `Research 2` vor `Research 10` steht).
  Kein Index, kein Cache: eine per Hand hineinkopierte Datei ist sofort da.
  Nur direkte Kinder, keine Unterordner, kein Vault-Scan.
- **Import (sekundär)** bleibt der OS-Dateidialog (`Import template from file…`)
  für Dateien AUSSERHALB des Vaults. Wo er aufgeht, bestimmt das OS — kein
  Web-API kann das Startverzeichnis setzen, und genau deshalb ist er nicht mehr
  der Normalweg.
- **`Open template folder`** öffnet die Library im Explorer/Finder über
  `window.open(FileSystemAdapter#getFilePath(pfad), '_external')` — derselbe
  Mechanismus wie Obsidians eigenes „Show in system explorer", aber nur aus
  öffentlicher API, ohne `require('electron')` und ohne undokumentiertes
  `App`-Member. Mobile bekommt eine Notice mit dem Ordnernamen statt eines
  Crashes.
- **UI-Einstiege:** Kategorie-Kontextmenü und Rechtsklick auf den
  `+`-Add-Category-Button tragen beide die volle Gruppe (Export, Import,
  Import-from-file, Open-folder); der `+`-Weg existiert, weil ein LEERES Panel
  kein Kategorie-Kontextmenü hat — der Zustand eines Backup-Restores. Dazu die
  Commands `dynamic-action-panel:import-template` und
  `dynamic-action-panel:open-template-folder` sowie eine Zeile
  „Panel templates" in den Settings unter „Path".

## 2c. Grid Cell Styles (Datenmodell vorbereitet, KEINE UI)

- **Die Farbe gehört zur ZELLE, nicht zum Tool** — auch eine LEERE Zelle muss
  später eine tragen können. Deshalb weder auf `ToolDefinition` noch auf
  `ToolPlacement`, sondern auf dem Grid:
  `cellStyles?: Record<GridCellKey, { color?: string }>` auf der Kategorie
  (statisches Grid) bzw. auf der **Variant** (dynamisch) — genau wie
  `rows`/`columns`.
- **Der Key ist die logische Zelle `r<row>c<column>` (z. B. `r2c3`), NICHT der
  flache Slot-Index.** Ein flacher Index benennt bei anderer Spaltenzahl eine
  andere Zelle (Row 1/Col 2 ist Slot 5 bei 3 Spalten und Slot 6 bei 4). Mit
  Koordinaten-Key braucht **Wachsen gar kein Remapping** und **Schrumpfen
  verwirft exakt die Keys des weggeschnittenen Streifens** — derselbe
  Streifen, aus dem auch die Tools fallen.
- **Portable Farbwerte:** Hex-Literal (`#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`)
  ODER ein namespaced Palette-Eintrag (`ocap:<name>`). CSS-Klassen und
  `var(--…)` werden abgelehnt — das Präfix macht die Regel „keine
  DOM-Klassen als persistente Wahrheit" prüfbar statt nur behauptet.
- Semantik steht bereits: Copy Category / Duplicate Variant kopieren sie
  **unabhängig**; `Make dynamic…` verschiebt sie auf die erste Variant (Teil
  des Grid-Zustands); Resize remappt koordinatenstabil; `grid → flow`
  verwirft sie mit dem Grid; Export/Import tragen sie pro Variant und
  verwerfen Styles von Zellen, die das importierte Grid nicht hat.
- **KEIN `settingsVersion`-Bump nötig:** optionales, rein additives Feld,
  dessen Abwesenheit „keine Zelle gefärbt" bedeutet — exakt wie
  `rows`/`columns`. Kein gespeichertes Datum muss transformiert werden, und
  von diesem Build geschriebene Settings bleiben für ältere Builds ladbar.
- **Es gibt noch KEINE Farb-UI:** kein Picker, kein Auswahlrahmen, keine
  Pipette, kein Paint Mode, keine sichtbare Einfärbung.

## 2. Produktmodell

- Eine Grid-Kategorie ist **statisch** (ein volles Grid, gespeichert als
  `category.placements`) oder **dynamisch** (`category.variants`).
- Eine dynamische Kategorie hält mehrere **vollständige, unabhängige
  Variants**: eigene Grids inkl. eigener Größe, eigene Button-IDs, nichts
  geteilt.
- **Das Grid ist größenveränderlich: `rows` × `columns`, 1×1 bis 5×5.** Slots
  sind flache, zeilenweise gelesene Indizes (`slot = row * columns + column`),
  weiterhin stabile Identitäten (seit v5 `ToolPlacement.slot`; in der
  Runtime-View weiterhin als `ButtonConfig.slot` sichtbar). Leere Slots
  bleiben leer; nichts rutscht nach.
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
  namentlich. **Seit v5 entfernt die Bestätigung die PLACEMENTS des
  Streifens; die Definitionen werden per GC-Regel entfernt** — d. h. genau
  dann, wenn sie weder `library: true` tragen noch anderswo platziert sind.
  Ohne Library-Flag ist das sichtbar exakt das alte Verhalten (Tool weg).
- **Zwei Gesten auf EINER Resize-Semantik:** Klick und Drag enden beide in
  `resizeGridTo` → `planGridResize`. Es gibt keine zweite Resize-Logik; die
  Edge-Zone ist reine Interaktionsschicht.
- **Der ganze Rand des Grids ist der Griff:** die **komplette rechte Kante**
  (volle Grid-Höhe) resized Spalten, die **komplette untere Kante** (volle
  Breite) Reihen. Kein Zielen auf ein Icon mehr. Ein Klick auf die Zone fügt
  eins hinzu, ein Ziehen rastet auf ganze Spalten/Reihen — das `+` in der
  Mitte der Zone ist nur noch die sichtbare Marke für den Klick, nicht mehr
  die Hitbox.
- **Die Zone ist nie `disabled`** (ein disabled Button bekommt keine
  Pointer-Events, und Ziehen nach innen ist von 5×5 aus der einzige Weg
  zurück) — am Maximum verblasst nur das `+` und das Tooltip sagt, dass ein
  Klick dort nichts tut.
- **Die `−`-Stepper sind entfallen.** Verkleinern ist Ziehen nach innen; die
  Sicherheitslogik (leer → sofort, belegt → eine Confirmation, Cancel →
  unverändert) hängt am Commit-Pfad, nicht am Control, und ist deshalb
  unverändert.
- **Ein Drag schreibt nichts.** Er erzeugt eine Preview; **genau ein** Commit
  passiert beim Pointer-Up, durch dieselbe Bestätigung wie der Stepper. Ein
  Drag über mehrere Streifen fragt **einmal** mit der Gesamtzahl
  (`Remove 2 columns? 8 tools will be deleted.`), nicht pro Streifen. Escape,
  `pointercancel` und ein Unmount brechen ohne Commit ab.
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
  die Action später ist ein legitimer Zustand; das Plugin schreibt keine
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
- **Kontext:** `WorkspaceContextService` hält einen immutablen Snapshot
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
  **Der Rahmen wird beim Drag NICHT ausgehängt** — die Zonen werden nur
  deaktiviert; ihn zu entfernen gäbe die Rinne mitten im Drag ans Grid zurück
  und verbreiterte jede Zelle. Die Rinne ist seit dem Edge-Pass **16 px**
  (vorher 18 + 2 px Gap), das Grid ist im Edit-Mode also 4 px breiter als
  zuvor.
- **Hitbox und sichtbarer Griff sind bewusst verschieden:**
  `--ocap-grid-edge-size: 16px` ist die Hitbox, `--ocap-grid-grip-size: 8px`
  der sichtbare Balken darin (beide am `.ocap-grid-frame`). Gezielt wird mit
  dem Auge, getroffen mit dem Zeiger. Drei Zustände, nur über Farbe: idle
  `rgba(var(--mono-rgb-100), 0.16)`, Hover/Focus/Drag `--interactive-accent`;
  das `+` wechselt dabei auf `--text-on-accent`, sonst verschwände es im
  Balken.
- **Die Edge-Zone überlappt das Grid NICHT.** Sie beginnt exakt an dessen
  Rand und liegt vollständig in der Rinne (live geprüft: 3 px innerhalb der
  Grid-Kante trifft die Zelle, 3 px außerhalb die Zone). Würde sie überlappen,
  schluckte sie Klicks, Button-Drags und Datei-Drops der äußersten Zellen.
- **Obsidian gibt jedem `button` eine feste Höhe (30 px)** — und eine
  Cross-Size, die nicht `auto` ist, nimmt das Flex-Item von `stretch` aus. Die
  „volle Höhe" der rechten Zone war dadurch 30 px neben einem 182 px hohen
  Grid; `height: auto` gibt sie zurück (gepinnt in
  `tests/paletteGridGeometry.test.ts`).
- **Der Resize-Drag ist bewusst KEIN dnd-kit-Drag** (`useGridResizeDrag`):
  schlichte Pointer-Events mit `setPointerCapture`. Die Geste besitzt ihren
  Pointer von down bis up und braucht nichts, wofür dnd-kit existiert — keine
  Collision Detection, keine Droppables, kein Overlay. Das Capture ist auch
  die Trennung zum Button-DnD: ein Press auf dem Handle erreicht weder den
  Kategorie-Drag (zusätzlich `stopPropagation`) noch einen Sensor.
- **Pixel → ganze Schritte** (`snapResizeSteps`, `clampResizeSteps`,
  `applyResizeSteps`, alle pur in `categoryGrid.ts`): die Schrittgröße
  (`resizeStepSize` = Zelle + Gap) wird **einmal beim Pointer-Down** aus der
  Grid-Box gemessen und für die ganze Geste festgehalten — würde man sie aus
  der laufenden Preview neu rechnen, verschieben sich die Schwellen unter dem
  Zeiger. Umgeschaltet wird bei einer halben Zelle **plus 0,2 Zellen
  Hysterese**, damit ein ruhender Zeiger auf einer Zellgrenze nicht flackert.
  Die **Schritte** (nicht nur die Zielgröße) werden geklemmt: wer weit über
  das Maximum hinauszieht, verkleinert beim Zurückziehen sofort wieder und
  muss nicht erst die verbotene Strecke zurücklegen.
- **Klick und Drag am selben Control:** ab 4 px Weg (dieselbe Schwelle wie der
  Button-Drag-Sensor) ist es ein Drag, und das **rastet ein**
  (`isResizeDragGesture`) — wer zurück zum Ausgangspunkt zieht und loslässt,
  löst **nicht** zusätzlich die Klick-Aktion aus. Pointer-Klicks am Handle
  werden im `onClick` verschluckt (der Pointer-Up-Pfad bedient sie schon);
  nur eine **Tastatur**-Aktivierung (`event.detail === 0`) handelt dort.
- **Die Preview rechnet mit demselben Kern wie der Commit**
  (`previewResizedSlots` = `resizeGridButtons` + `placeButtonsOnGrid`), kann
  ihm also nicht widersprechen. Tools auf einem weggeschnittenen Streifen sind
  während der Preview nur **unsichtbar**, nicht gelöscht — in den Settings
  stehen sie bis zum bestätigten Pointer-Up unverändert.
- **Die Preview überlebt den Pointer.** Speichern ist async und das Panel
  rendert aus einem `buttons-panel-refresh`-Event — die Preview beim
  Pointer-Up zu verwerfen zeigte deshalb für **4 gemessene Frames** wieder das
  Grid VOR dem Drag, obwohl `settings` die neue Größe schon hatte. Sie bleibt
  jetzt stehen (`preview.committed = true`), bis die gespeicherten Dimensionen
  wirklich die gezogenen sind — oder der Save gescheitert ist (`onSettled`).
  Dieselbe Idee wie `committedPropsRef` im ButtonDragContext: das Ergebnis
  einer Geste überlebt die Props, aus denen es berechnet wurde. Gemessen:
  **0 abweichende Frames** über Wachsen und Schrumpfen, beide Achsen.
  **Ausnahme Confirmation:** dort ist noch nichts committet, also fällt das
  Grid bewusst sofort auf die gespeicherte Größe zurück
  (`resizeGridTo` meldet `committed` / `confirming` / `none`).
- **Geste und Größe sind getrennt:** Readout und leuchtender Griff hängen an
  `preview.committed === false`, die Geometrie an `preview.dimensions`. Beim
  Pointer-Up endet also die Geste sofort, während die Geometrie hält.
- **Die Größenanzeige (`columns × rows`) ist absolut positioniert** im
  `.ocap-grid-frame` und `pointer-events: none`: sie annotiert die Preview und
  darf sie niemals umbrechen oder den Drag schlucken. Sie erscheint, sobald
  die Geste zum Drag wird — auch bei 0 Schritten, denn genau dann hat der
  Nutzer noch keine ganze Zelle zurückgelegt. Sie sitzt **über** der oberen
  rechten Grid-Ecke, also außerhalb der Grid-Box: damit verdeckt sie keine
  Zelle mehr (bei 1×1 war das vorher die einzige).
- **Das Edit-Raster ist reine Farbe.** Jede Zelle trägt ohnehin in jedem Modus
  einen 1px-Rahmen (transparent in locked), also ändern die sichtbaren Linien
  nur dessen `border-color`; der äußere Grid-Rahmen ist ein `outline`, das
  niemals am Layout teilnimmt. Live gemessen: Zell-Rects mit und ohne
  `--managed` **worstΔ 0 px** bei identischer Grid-Box. Die Linienfarbe kommt
  aus `rgba(var(--mono-rgb-100), 0.28)` — weiß im dunklen, schwarz im hellen
  Theme, ohne hartkodiertes Weiß.
- **Hover darf am Raster nur den Grund ändern, nie den Rahmen.** `:hover`
  fügt dem Selektor eine Klassenebene hinzu und würde sonst die
  Drop-Target-/File-Target-Ringe überstimmen, die versprechen, wo ein Drop
  landet (live geprüft: der Ring ist beim Datei-Hover weiterhin akzentfarben).
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
  nicht stören:** Das Button-DnD des Plugins ist pointer-basiert (dnd-kit) und erzeugt
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
- Drag-Debugging: `window.__DYNAMIC_ACTION_PANEL_DND_DEBUG = true` traced den kompletten
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

- `src/domain/tools.ts` — **Registry-Hälfte des v5-Modells** (pur):
  `buttonToDefinition`/`definitionToButton`, Materialisierung
  (`materializeCategoriesForRuntime`, gememoized), `placeStoredGrid`
  (eine Selbstheilung für beide Welten), Dekomposition, `findToolVariantId`,
  `collectReferencedToolIds`, **`gcTools` (DIE GC-Regel)**.
- `src/domain/categoryOps.ts` — **alle v5-Schreiboperationen** (pur, über
  `ToolState = { tools, categories }`): `createToolInCategory`,
  `updateToolDefinition`, `copyToolInCategory`, `removeToolFromCategory`,
  Drag-Write-back (`applySlotIdsToStoredCategory`,
  `applyFlowIdsToStoredCategory` — nie GC), `planStoredGridResize` +
  `commitStoredGridResize`, Variant-Ops (add/duplicate/remove mit GC),
  `duplicateCategoryInState`, `deleteCategoryFromState`,
  `convertStoredStaticGridToDynamic`, `applyStoredCategoryLayout`.
- `src/export/templateFormat.ts` — Format-Id, `OCAP_TEMPLATE_FORMAT_VERSION`,
  Dokumenttypen. `src/export/templateExport.ts` (read-only Exporter),
  `src/export/templateParse.ts` (**die Trust-Grenze**: Validierung +
  Rebuild + Migrationshaken), `src/export/templateImport.ts` (purer Planner,
  ID-Remapping, externe Referenzen), `src/export/templateIo.ts`
  (Obsidian-I/O + der EINE Commit). Spezifikation:
  `docs/ocap/template-format.md`.
- `src/utils/id.ts` — der EINE Id-Generator (`freshId`, zählerbasiert
  kollisionssicher); alle Create/Copy/Duplicate-Pfade nutzen ihn.
- `src/utils/categoryStore.ts` — **Commit-Funnel**: `findStoredCategory`,
  `commitStoredCategory`, `commitCategories`, `toolStateOf`,
  `commitToolState`, `dispatchPanelRefresh`. Jeder Write endet hier.
- `src/utils/categoryVariants.ts` — pure Kern der READ-Seite + shape-
  generische Accessors (arbeiten auf Stored- UND View-Shape):
  Variant-Auflösung (`resolveDynamicCategoryVariant`,
  `resolveGridViewForContext/-Variant`), Metadaten-Ops
  (update/move/removeVariant), Condition-Lifting und die
  View-Konvertierungskerne (`composeFullVariant`, `convertCategoryToGrid`,
  `convertStaticGridToFlow`) für Migrationen und Layout-Wechsel.
- `src/context/panelProjection.ts` — zentrale Projektion Settings + Kontext +
  Modus → gerenderte Kategorien, Marker-Sets, `gridViews`.
- `src/context/conditions.ts` — Condition-Interpreter (fail-open) +
  Sichtbarkeitshelfer. Regeln: `fileName` (equals/startsWith/contains/
  endsWith, voller Name inkl. Endung, leerer Wert matcht nichts), `folder`,
  `path`, `extension`, `property`, `tag`, `viewType`.
- `src/utils/conditionSummary.ts` — pure Trigger-/Condition-Zusammenfassung.
- `src/utils/categoryIcon.ts` — Icon pro Kategorie-Art (dynamic/static/flow).
- `src/context/WorkspaceContextService.ts` — reaktiver Kontext-Snapshot-Store.
- `src/contexts/ButtonDragContext.tsx` — DndContext-Provider: Sensoren,
  Drag-State (`items`), Baseline-Previews, Persistierung, Debug-Tracing.
- `src/utils/buttonDragItems.ts` — pure Drag-State-Semantik: Slot-Droppable-
  IDs, `applyDragOverToItems` (move/swap/flow-Regeln),
  `resolveGridDropOutcome` (accept/blocked/no-cell).
- `src/utils/buttonDragCollision.ts` — Collision-Ranking der Button-Drags.
- `src/utils/categoryGrid.ts` — **pure Grid-Geometrie** (inkl. der Cell-Style-
  Primitiven `gridCellKey`/`parseGridCellKey`/`resizeGridCellStyles`/
  `isGridCellColor`): `GridDimensions`,
  `readGridDimensions` (fehlend = Legacy 4×4), `DEFAULT_GRID_DIMENSIONS` (1×3),
  Grenzen 1–5, `remapSlot`, `resizeGridButtons`, `placeButtonsOnGrid`
  (dimensionsbewusst), `fitGridDimensions` für flow → grid — und die
  Drag-Mathematik `resizeStepSize` / `snapResizeSteps` / `clampResizeSteps` /
  `applyResizeSteps` / `isResizeDragGesture`.
- `src/components/buttons-panel/CategoryButtonGrid.tsx` — rendert das Grid
  einer Kategorie inkl. Variant-Selector-Einbindung, SortableContext und
  (nur im Edit-Mode) des Resize-Rahmens.
- `src/components/buttons-panel/GridResizeControls.tsx` — `GridResizeEdgeZone`
  (die ganze rechte bzw. untere Kante als Griff, mit dem `+` als sichtbarer
  Klick-Marke) plus die `GridResizeReadout`-Anzeige.
- `src/hooks/useGridResizeDrag.ts` — die **Pointer-Schicht**: Capture,
  Snapping, Preview-State, Klick-vs.-Drag, Escape/Cancel. Schreibt nichts.
- `src/hooks/useGridResize.ts` — löst Ziel-Kategorie und -Variant wie `+` und
  File-Drop auf, fragt bei belegtem Streifen **einmal** nach und persistiert;
  rechnet vor dem Commit gegen den **aktuellen** Stand neu (die Bestätigung
  ist async). `resizeGridTo` ist der eine Commit-Pfad beider Gesten.
- `src/components/modal/GridResizeConfirmModal.ts` — die Bestätigung, mit
  eigener Formulierung für einen vs. mehrere Streifen und ein vs. mehrere
  Tools.
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
- `src/settings/settingsMigrations.ts` — versionierte Migrationskette inkl.
  `migrateV4toV5` (Registry-Split) und Load-Normalisierung der Reihenfolge
  (ersetzt den entfallenen in-place-Sort in `saveSettings`).
- `tests/fixtures/data-v4-real.json` + `tests/realDataMigration.test.ts` —
  byte-genaue Kopie der produktiven v4-`data.json`, Migration verlustfrei
  gepinnt (der erste produktive v5-Start transformiert exakt dieses
  Dokument).
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
- **Drag-Resize live verifiziert** (gleicher Aufbau, echte CDP-Maus-Events,
  Fehlermonitore aktiv: **0 Fehler** über den ganzen Lauf):
  - Klick auf den rechten Handle: 1×3 → 1×4, persistiert. Klick auf den
    unteren: +1 Reihe.
  - Ziehen nach rechts: Preview 1×5 mit Anzeige `5 × 1`; **die Settings waren
    während gedrücktem Pointer nachweislich noch auf 4 Spalten**, erst das
    Loslassen hat committet.
  - Weiter ziehen als erlaubt: Preview bleibt bei 5 stehen, Anzeige ebenfalls.
    Zurückziehen über mehrere Zellen in **einer** Geste: 5 → 4 → 3 → 1.
  - Vertikal analog: 1 → 3 → 4 → 5 Reihen und in einem Zug zurück auf 1.
  - Escape mitten im Drag: nichts committet, Settings byte-gleich.
  - **Belegter Multi-Spalten-Shrink** auf dem vollen 4×4: Preview zeigt 3×4
    dann 2×4, Settings während des Drags unverändert, **eine** Bestätigung
    `Remove 2 columns? 8 tools will be deleted.` mit allen acht Namen. Cancel
    → Grid und Settings byte-gleich; Remove → genau die zwei rechten Spalten
    weg, der Rest behält seine logische Zeile/Spalte. Multi-Reihen analog
    (`Remove 2 rows? 4 tools will be deleted.`).
  - Locked Mode: **0** Frames, Streifen, Handles, Readouts und `+`.
  - Nach einem Drag-Resize: Move und Swap korrekt, Slot-`+` in einer erst
    durch den Drag entstandenen Zelle, PDF-Drop ebenfalls (Zelle leuchtet,
    belegte Zelle lehnt den `dragover` weiter ab).
  - Dynamic Variant: `VarA` per Drag auf 2×5 (A2 4 → 6, gleiche Zeile/Spalte),
    `VarB` blieb byte-gleich 2×2. Nach Reload alles unverändert.
- **Greifbare Kante + Edit-Raster live verifiziert** (gleicher Aufbau, echte
  CDP-Maus-Events, **0 Fehler**):
  - Rechte Zone = volle Grid-Höhe, untere = volle Breite; Drag **von oben,
    Mitte und unten** der rechten Kante und **von links, Mitte und rechts** der
    unteren — jedes Mal korrekt resized (3→4→5 Spalten bzw. Reihen).
  - Hit-Test: alle sechs Randpunkte treffen die Zone, die **Mitte der
    äußersten Zelle** bleibt die Zelle; 3 px innerhalb der Grid-Kante = Zelle,
    3 px außerhalb = Zone.
  - Am Maximum: Label `Maximum of 5 columns — drag to resize`, Zone **nicht**
    disabled, Klick fügt nichts hinzu, Ziehen nach innen funktioniert (5→3,
    leere Spalten, keine Nachfrage).
  - Belegter Shrink: eine Confirmation `Remove 2 columns? 2 tools will be
    deleted.`, Cancel byte-gleich, Remove schneidet nur den Streifen ab.
  - Minimum: weit nach innen ziehen bleibt bei 1 Spalte bzw. 1 Reihe.
  - Klick auf die Zone (Mitte **und** oberer Rand) → genau +1.
  - **Kein `−`-Control mehr im DOM.**
  - Raster: Zell-Rects mit/ohne `--managed` **worstΔ 0 px**, Grid-Box
    identisch; Zellrahmen im Edit `rgba(255,255,255,0.28)`, in locked
    vollständig transparent und `outline: none`; locked hat 0 Zonen, 0 Frames,
    0 `+`.
  - Danach unverändert: Swap hin und zurück, Slot-`+`, PDF-Drop auf die
    **äußerste** Zelle (Ring weiterhin akzentfarben).
- **Commit-Ruhe live gemessen** (rAF-Sampler, der pro Frame die gerenderte
  Spalten-/Zellenzahl gegen die gespeicherte Größe protokolliert): vorher
  **4 Frames** mit der Größe VOR dem Drag, obwohl `settings` schon die neue
  trug; nach der Umstellung **0 abweichende Frames** über fünf Resizes
  (Wachsen und Schrumpfen, Spalten und Reihen). Griff-Zustände einzeln
  geprüft: idle `rgba(255,255,255,0.16)`, Hover `rgb(138,92,245)` mit weißem
  `+`, und jede Achse leuchtet nur für sich.
- Der Condition-Editor startet mit `File name` (verständlichste Regel) und
  erklärt `File name` und `View type` mit einer Hint-Zeile — `View type` wurde
  im Nutzertest als „Node Type" missverstanden.
- **v5-Smoke live verifiziert** (isolierte Obsidian 1.13.7, frisches
  Scratch-Profil, CDP mit echten Maus-Events, Fehlermonitore aktiv:
  **0 Konsolenfehler/Exceptions über alle Phasen**; Datenbasis: byte-genaue
  Kopie der produktiven v4-`data.json`):
  - Erster v5-Start migriert **genau einmal**: Disk `settingsVersion: 5`,
    3 Tools unter ihren Original-IDs, keine `buttons`-Arrays mehr; alle 4
    Kategorien, Variant 2×3 mit Slots 0/3, Legacy-Variants ohne
    Größenfelder; Panel rendert alle Buttons mit Original-Namen/Icons.
  - Klick auf `Open file` mit hier fehlender Datei → `File not found: …`
    (Lazy-Fail, kein invalider Zustand).
  - Slot-`+` (Zeile 1, Spalte 2) → Modal → Name → Save: Tool mit
    `actions: []`, ohne `library`, exakt auf Slot 1 der editierten Variant;
    Klick darauf → `No action assigned.`; Schwester-Variant byte-gleich.
  - Move (Slot 1→2, Loch bleibt) und Swap (0↔3) korrekt; Registry dabei
    unverändert (Definitionen werden von Drags nie berührt).
  - Resize-Klick 2×3→2×4 koordinatenstabil (Slot 3→4); Drag-Shrink der
    belegten unteren Reihe: **eine** Confirmation mit Namensliste, Cancel
    byte-gleich, Remove entfernt das Placement **und** GC't die Definition
    (Registry 4→3).
  - Copy Button: neue Definition mit frischer ID auf dem niedrigsten freien
    Slot; Delete der Kopie entfernt Placement + Definition (GC).
  - `Make dynamic…` auf dem Legacy-Static-Grid erzeugt die erste Variant;
    Duplicate Variant kopiert Größe + Slots mit **disjunkten neuen
    Tool-IDs** (Registry +2); Copy Category kopiert alle 3 Variants mit
    komplett neuen Definitionen (Registry 5→9), Original unberührt.
  - Window-Reload: Settings-State identisch, `data.json` **byte-gleich**
    (keine zweite Migration), Panel rendert unverändert.
  - Nicht UI-getrieben in diesem Smoke (Codepfade identisch zu vorher und
    unit-getestet): echter File-Explorer-Drop, Run Script, Variant
    Delete/Move, Cross-Category-Drag.

- **Template-Export/-Import live verifiziert** (isolierte Obsidian 1.13.7,
  scratch `--user-data-dir`, Snapshot von `ocap-smoke`, CDP mit echten
  Maus-Events, Fehlermonitore aktiv: **0 Konsolenfehler/Exceptions über alle
  Phasen**):
  - Static-Grid-Kategorie über das echte `+`-Modal angelegt (`rows: 1,
    columns: 3`); `other/Becker_Westerholt.pdf` per echtem File-Explorer-
    `dragstart` auf Slot 0 gedroppt (`app.dragManager` real gefüllt); zweites
    Tool über das Slot-`+` mit URL-Action konfiguriert.
  - *(Historisch — dieser Lauf fand vor der Template Library statt. Menü und
    Zielordner sehen heute anders aus, siehe Abschnitt 2b.)* Kategorie-Kontextmenü
    zeigt `Edit / Make dynamic… / Copy / Export template… / Import template… /
    Delete`. `Export template…` schreibt `Smoke.ocap.json` in die Vault-Wurzel;
    die Settings sind danach **byte-gleich** (Export ist read-only).
  - Kategorie gelöscht (Registry 11 → 9), dann über `Import template…` +
    echten (abgefangenen) OS-Dateidialog reimportiert: neue Kategorie mit
    frischen `cat-`/`tool-`-IDs, 1×3, Slots 0/1, beide Actions vollständig.
    *(Heute wäre das der sekundäre Weg `Import template from file…`.)*
  - Klick auf den importierten PDF-Button im locked Mode öffnet das echte
    PDF-Leaf (`other/Becker_Westerholt.pdf`).
  - **Zweiter Import derselben Datei:** zusätzliche Kategorie
    `Smoke (imported)`, disjunkte Tool-IDs, nichts überschrieben.
  - **Dynamic Roundtrip** (`Research`, 3 Variants): Trigger
    (`fileName startsWith SRC_`, `extension md`), Fallback, eigene Größen
    (3×4 / 2×5 / 1×2), synthetische Cell Styles pro Variant
    (`r2c3: ocap:red`, `r1c4: #a1b2c3`), Placements/Slots — alles erhalten,
    alle IDs frisch, Name als `Research (imported)` entkollidiert.
  - **Fehlendes Datei-Ziel blockiert nicht:** Import erfolgreich mit
    `… 1 referenced file was not found in this vault.`; der Klick meldet
    danach `File not found: Literatur/Nope_Missing.pdf`.
  - **Ablehnungen lassen den Zustand byte-gleich** (je mit klarer Notice):
    kaputtes JSON, fremdes Format, eine rohe interne `data.json`,
    `formatVersion: 99`, dangling Tool-Referenz.
  - Nach `disablePlugin`/`enablePlugin`: State identisch, `data.json`
    **byte-gleich** (keine Migration, kein Rewrite), Cell Styles auf Platte
    variant-lokal erhalten.

## 6. Offene Punkte / nächste Baustellen

- **Nächstes zentrales Feature: generische Grid-Cell-Selection mit Cell Colors
  als erstem Consumer.** Der Architektur- und UX-Pass ist abgeschlossen:
  `docs/ocap/audits/2026-09-18-selection-color-architecture.md` (Target Design,
  Entscheidungsmatrix, File-Level-Map, Testmatrix, Phasenplan; unabhängig gegen
  den Code reviewt). **Es ist noch NICHTS implementiert** — keine Selection,
  keine Farb-UI, kein Format-/`settingsVersion`-Change.
  Kernentscheidungen: Selection Unit = Zell-Koordinate `r<row>c<column>` im
  Kontext `(categoryId, variantId | null)`; rein ephemerer React-State in
  `PanelContent` (heißt `cellSelection` — `selection` ist schon die
  Variant-Auswahl); expliziter Select-Sub-Mode pro Grid im Edit Mode über eine
  Overlay-Schicht; `DndContext` bleibt unangetastet; `ocap:<name>`-Farben werden
  erst beim Rendern auf Obsidians `--color-*-rgb` aufgelöst.
  **Empfohlene nächste Phase: A — purer Kern + Daten** (`gridCellSelection.ts`,
  Cell-Key-Helfer, `gridCellColor.ts`, `setCellColorsInState`, Unit-Tests; keine
  UI). Danach B (Farben rendern: `ResolvedGridView` reicht `cellStyles` heute
  NICHT bis zum Renderer durch), C (Select Mode), D (Apply Color), E (Marquee).
- **ZotFlow-Annotation-Shortcuts: IMPLEMENTIERT** (Analyse:
  `docs/ocap/audits/2026-09-18-zotflow-annotation-integration.md` inkl.
  Implementierungs-Addendum). Eine ZotFlow-Markierung auf eine freie Zelle
  gezogen wird zu einem **operativen Lesezeichen**: ein normales
  `file`-Tool, dessen Klick den Reader öffnet und genau diese Annotation
  selektiert und zentriert.
  - **Kein eigener Tool-/Action-Typ**, kein `settingsVersion`-Bump, kein
    Template-Format-Bump. Lokale Annotation = `file` mit
    `FileActionParams.subpath` (generischer Obsidian-Subpath:
    `#page=<pageIndex+1>#annotation=<urlencoded {annotationID,pageIndex}>`,
    Reihenfolge `page` vor `annotation` ist zwingend). Library-Annotation =
    bestehende `url`-Action mit `obsidian://zotflow?type=open-annotation…`.
  - **Erfassung:** Regelfall ist der Drag-Payload `![[<SourceNote>#^<id>]]`
    → Annotation-ID + Frontmatter `zotflow-local-attachment` → PDF (Level 1).
    Ohne Source Note schreibt ZotFlow nur ein Leerzeichen; dann liest ein
    isolierter Adapter (`src/utils/zotflowReader.ts`, die **einzige** Stelle
    mit ZotFlow-Internas) `_draggingAnnotationIDs` aus dem Same-Origin-Reader-
    Iframe. Nur ZotFlows exakte Signatur (ein Leerzeichen, sonst nichts auf
    dem DataTransfer) betritt diesen Pfad; bei mehreren Readern entscheidet
    Fokus, dann `getMostRecentLeaf()`, sonst **kein Tool** plus Notice.
  - **Label vs. Tooltip sind getrennt:** Button-Text = Zitat-Anriss
    (umbenennbar), Tooltip (neues optionales `ToolDefinition.tooltip`) =
    `<Quelle> <Jahr> · S. <gedruckte Seite>`, z. B.
    `Bieker, Westerholt 2021 · S. 44`. Obsidian bindet ihn als `aria-label`.
  - **Quelle kommt aus dem Ordnernamen** (`Authors (Year) - Title`,
    `src/utils/sourceLabel.ts`, pur). Nicht aus Präferenz: im Vault existieren
    **keine** bibliografischen Daten (Source Notes tragen nur
    `zotflow-locked` + `zotflow-local-attachment`; kein `.bib`/CSL, kein
    Citekey), und PDF-Metadaten sind nachweislich falsch (keine
    Publikationsjahre, abgeschnittene Autorenlisten, ein Grafiker als Autor).
  - **Seite = `pageLabel`, niemals `pageIndex+1` für die Anzeige:** die beiden
    weichen in 10 von 13 realen Annotationen ab (Offsets 1, 3 und >100, gegen
    gedruckte Folios verifiziert). Fehlt `pageLabel`, entfällt die Seite —
    keine plausibel aussehende falsche Seitenzahl. `S.` ist eine feste
    Abkürzung (kein `de`-Locale vorhanden).
  - **Snapshot für die Quelle, Live für die Seite:** die Kurzquelle und das
    Label werden EINMAL beim Drop erfasst und nie nachgezogen. Die **Seite**
    dagegen wird beim Hover aufgelöst (`src/utils/liveTooltip.ts`): offener
    Reader zuerst, sonst ZotFlows `.zf.json` **read-only** über
    `vault.cachedRead`; der Sidecar-Pfad wird nicht blind abgeleitet, sondern
    in beiden Reihenfolgen (Stock/Patch) per `getFileByPath` probiert. Grund:
    ZotFlows „Edit Page Number" korrigiert `pageLabel` nachträglich (nur
    `{id, pageLabel}`, `pageIndex` und ID bleiben) — ein konservierter Wert
    wäre ab da falsch. Die Capture-Seite ist nur noch **Fallback** (gelöschte
    Annotation, fehlende Sidecar, ZotFlow deaktiviert → dann ist auch dessen
    Ordner-Einstellung nicht lesbar). Kein Store, kein Watcher, keine Sync;
    Hover erzeugt nie eine Notice und der Render-Pfad keine I/O. Die
    Navigation hängt unverändert allein an PDF-Pfad + Annotation-ID.
    ZotFlow bleibt Owner der Annotation. Siehe `DECISIONS.md`.
  - **DAP schreibt ausschließlich sein eigenes `data.json`** — kein
    Nexus-Node, keine Source Note, keine `.zf.json`, keine Zotero-Daten.
  - **Known limitation:** wird das PDF umbenannt/verschoben, zeigt der Klick
    `File not found` (wie bei jedem `file`-Tool; kein Rename-Tracking).
  - **Später geplant, NICHT implementiert:** Annotation-Farbe als Initialfarbe
    einer Zelle. Verfügbar ist sie: `color` steht im Reader-Record als
    lowercase Hex (`#ffd400`, `#2ea8e5`, `#ff6666`, `#f19837` real gesehen;
    Palette als offen behandeln). Beim Capture würde sie einmalig in
    `cellStyles` wandern und danach unabhängig sein — keine Dauer-Sync.

0. **Produktiv-Deployment des v5-Builds ist erledigt** (Abschnitt 1), ebenso die
   Plugin-Identity-Migration auf `dynamic-action-panel`.
   Es folgen die restlichen Audit-Phasen: Library-Semantik sichtbar
   machen (Promote/„aus Grid entfernen, Tool behalten“) und die Farb-UI.
   Das **Export-/Import-Fundament (F5) ist gebaut** (Abschnitt 2b), das
   **Cell-Style-Datenmodell ebenfalls** (Abschnitt 2c) — KEINE Library-UI und
   KEINE Farb-UI; `library` bleibt ein reines Domain-Feld ohne UI.
1. **Slot-Hotkeys** (geplantes Feature) — Slot-Identität ist stabil
   und variant-unabhängig; nur die Keybinding-Schicht fehlt.
2. **Toggle-Tools** (OFF/ON mit eigenen Actions/Appearance) — braucht einen
   Tool-Typ-Begriff auf `ButtonConfig`.
3. Rich Tooltips. (Kategorie-Export/Import ist gebaut — Abschnitt 2b;
   offen bleiben eine Multi-Category-Export-UI und ein Export ganzer
   Panel-Sets, die das Format bereits trägt.)
4. **Flow-Kategorien haben dieselbe Falle wie zuvor das Grid:** ein Release auf
   dem Container-Hintergrund derselben Flow-Kategorie rechnet gegen die
   Baseline zurück und verwirft die Umsortierung (live reproduziert, nicht
   Teil des Grid-Fixes). Normales Ziehen Button→Button funktioniert.
5. Kategorie-Block ist in der Liste von jeder Nicht-Button-Fläche ziehbar —
   Press auf leere Zelle startet einen Kategorie-Drag (Upstream-Verhalten,
   bewusst so belassen); bei Zellen <35 px werden Labels hart geclippt. Das
   `+` schluckt seinen eigenen Press (`pointerdown`/`mousedown`/`touchstart`),
   sonst würde ein Klick darauf die Kategorie ziehen statt das Modal zu öffnen.
6. Packaging-/Release-Strategie weiterhin offen (die Manifest-ID ist mit
   `dynamic-action-panel` entschieden); locked-mode Empty-State;
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
   - Beim Pointer-Up endet die Preview sofort; während die Bestätigung offen
     ist, zeigt das Grid also schon wieder die **alte** Größe. Bewusst so —
     es ist bis zum `Remove` tatsächlich noch nichts passiert — aber es ist
     ein Kandidat für späteren Feinschliff.
   - Die Edge-Zone ist Maus-/Pointer-first. Per Tastatur aktiviert sie nur
     ihr `+` (+1); es gibt keine Pfeiltasten-Variante des Drags und keine
     Tastatur-Verkleinerung mehr, seit `−` entfallen ist.
   - **Ein Klick irgendwo auf der Zone fügt eins hinzu**, nicht nur auf dem
     `+`. Bewusst so — eine control-große Fläche, die Klicks ignoriert, ist
     ein Bug, kein Polish — aber es macht ein versehentliches +1 etwas
     wahrscheinlicher als vorher. Trivial rückgängig zu machen, zerstört nie
     Daten.
   - Rasterlinie (`--ocap-grid-line`, 0.28) und Griffstärke
     (`--ocap-grid-grip-size`, 8px) sind je **ein** Token und lassen sich nach
     manuellem Test in einer Zeile nachjustieren.
   - Beim Pointer-Up fällt der Griff sofort von Akzent auf idle zurück (die
     Geste ist vorbei), während die Geometrie noch kurz gehalten wird. Das ist
     gewollt, aber es ist der einzige verbliebene Zustandswechsel in dieser
     Sekunde.
9. Bewusst nicht umgesetzt (kommt später): die sichtbare Tool-Library-UI
   (die Trennung Definition/Placement selbst ist seit v5 GEBAUT), die
   **Farb-UI** (Picker, Auswahlrahmen, Pipette, „alle Zellen gleicher Farbe",
   Paint Mode, Fill Visible Cells, Drag-Painting, sichtbare Einfärbung — nur
   das Datenmodell steht, Abschnitt 2c), eine Multi-Category-/Panel-Set-
   Export-UI, per-Category-Lock, „Pin active dynamic variant", Toggle-Tools,
   Slot-Hotkeys, Icon-Picker, ZotFlow-Annotationen auf Slots,
   Placement-Overrides (lokaler Name/Icon), Infinite Grid / Scroll-Navigation,
   Text-/Notiz-Zellen, Zell-Merging, Row-/Column-Reordering.

## 7. Arbeitsregel für neue Sessions

1. Zuerst `CLAUDE.md` und diese Datei (`docs/ocap/HANDOFF.md`) lesen.
2. Git prüfen (Branch, HEAD, Working Tree, origin-Abstand).
3. `STATUS.md`, `DECISIONS.md` und `docs/ocap/audits/` NICHT vollständig als
   Pflichtlektüre lesen — nur bei konkretem Bedarf gezielt konsultieren
   (Entscheidungsbegründungen, Migrationsdetails, Live-Test-Aufbauten).
4. Danach direkt die für die Aufgabe relevanten Source-Dateien lesen; bei
   Widerspruch gilt der Code, nicht die Doku.
