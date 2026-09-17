# OCAP – Handoff (kompakter Snapshot)

Snapshot für neue Claude-Code-Sessions. Kein Verlauf — bei größeren
abgeschlossenen Arbeiten wird diese Datei ersetzt, nicht verlängert.

## 1. Projekt-/Git-Stand

- Repo: `H:\Dropbox\11-Projects\A1_Obsidian contextual action panel - OCAP`,
  Fork `MaxLaska/obsidian-contextual-action-panel`, independent fork von
  Buttons Panel 2.4.7.
- Branch `master`, HEAD `fix: keep grid geometry stable during drag`, lokal vor
  `origin/master` — nicht ohne Auftrag pushen.
- Settings-Version: **3** (`CURRENT_SETTINGS_VERSION`), forward-only
  Migrationskette `0 → 1 → 2 → 3` in `src/settings/settingsMigrations.ts`.
- Teststand: `npm test` **356/356** (Vitest, node env, `tests/`),
  `npm run lint` 0 Probleme, `npx tsc --noEmit` grün,
  `node esbuild.config.mjs production` grün.

## 2. Produktmodell

- Eine Grid-Kategorie ist **statisch** (ein volles 4×4-Grid in
  `category.buttons`) oder **dynamisch** (`category.variants`).
- Eine dynamische Kategorie hält mehrere **vollständige, unabhängige
  Variants**: eigene 4×4-Grids, eigene Button-IDs, nichts geteilt.
- Grid = **4×4, 16 stabile Slots** (`ButtonConfig.slot`, 0–15). Leere Slots
  bleiben leer; nichts rutscht nach.
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

## 3. Architektur & Invarianten

- **Ein zentraler Renderpfad:** `projectCategoriesForContext`
  (`src/context/panelProjection.ts`) entscheidet allein, was gerendert wird —
  locked: Runtime-Auflösung; sort/edit: die vom Nutzer editierte Variant.
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
- **Alle 16 Grid-Zellen sind permanente Droppables** (`GridSlotCell` rendert
  belegte und leere Zellen, keyed by Slot). Niemals zu per-Empty-Slot-
  Droppables zurückkehren — deren Mount/Unmount beim Variant-Wechsel war die
  Root Cause des intermittierenden „Drag tot"-Bugs (Registrierungs-/Rect-Race
  in dnd-kit). Die ganze Zelle ist die Hitbox; Collision-Ranking:
  Button > Slot-Zelle > Title/Tab/Container.
- **Desktop-DnD:** PointerSensor mit `distance: 4` px, bewusst OHNE
  `tolerance` (würde schnelle Drags canceln). Touch: Long-Press.
- **4 logische Spalten sind invariant** — `repeat(var(--ocap-grid-columns,4),
  minmax(0,1fr))`; kein Wrap bei schmaler Sidebar (verifiziert bis 150 px).
- **Grid-Geometrie ist modus- und variant-invariant:** jede Zelle trägt in
  jedem Modus einen konstanten 1px-Rahmen (transparent in locked); Chrome
  nur über Farben (`--managed`, `--sort` Container-Klassen).
- **Slot-Geometrie ist inhaltsunabhängig und während eines Drags stabil:** die
  Zeilenhöhe kommt aus einem definiten Track (`grid-auto-rows:
  var(--ocap-grid-row-height)` = Slot-Token + 2px Zellrahmen), nie aus dem
  momentanen Zellinhalt. Mit `auto`-Zeilen war eine Reihe mit Button um zwei
  Zellrahmen höher als eine komplett leere — ein Drag, der seine Quellreihe
  leerte oder in eine leere Reihe previewte, verschob dadurch mitten im Drag
  alle darunterliegenden Slots (live gemessen: 1,33 px). Keine Regel, die an
  Belegung/Ziel/Preview hängt, darf eine feste Größe setzen (gepinnt in
  `tests/paletteGridGeometry.test.ts`).
- Drag-Debugging: `window.__OCAP_DND_DEBUG = true` traced den kompletten
  dnd-kit-Lifecycle (flag-gated, kostenlos wenn aus).
- Settings-Objekte sind immutable-per-edit (Änderung = neue Objektidentität);
  React-Memos vergleichen Identität.
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
  Sichtbarkeitshelfer.
- `src/context/OCAPContextService.ts` — reaktiver Kontext-Snapshot-Store.
- `src/contexts/ButtonDragContext.tsx` — DndContext-Provider: Sensoren,
  Drag-State (`items`), Baseline-Previews, Persistierung, Debug-Tracing.
- `src/utils/buttonDragItems.ts` — pure Drag-State-Semantik: Slot-Droppable-
  IDs, `applyDragOverToItems` (move/swap/flow-Regeln),
  `resolveGridDropOutcome` (accept/blocked/no-cell).
- `src/utils/buttonDragCollision.ts` — Collision-Ranking der Button-Drags.
- `src/components/buttons-panel/CategoryButtonGrid.tsx` — rendert das 4×4-Grid
  einer Kategorie inkl. Variant-Selector-Einbindung und SortableContext.
- `src/components/buttons-panel/GridSlotCell.tsx` — die universelle Zelle:
  permanentes Droppable, gefüllt oder leer, keyed by Slot.
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
  Anlage/-Bearbeitung, Prioritätsübersicht.

## 5. Manueller UX-Stand

- Das Variant-Modell ist laut Nutzertest grundsätzlich verständlich und
  brauchbar; kein Modellwechsel geplant.
- Der intermittierende DnD-Ausfall nach Variant-Wechsel ist durch die
  permanenten Zell-Droppables behoben (live: >200 automatisierte Drags über
  Switch-/Flip-/Mode-Sequenzen, 0 Ausfälle, 0 Konsolenfehler).
- Das 4×4-Raster ist in Sort/Edit deutlich sichtbar (belegte Zellen solide,
  leere gestrichelt); locked bleibt chrome-frei bei identischer Geometrie.
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
   bewusst so belassen); bei Zellen <35 px werden Labels hart geclippt.
6. Packaging-/Release-Strategie + finale Manifest-ID; locked-mode Empty-State;
   jsdom-Editor-Tests weiterhin offen.

## 7. Arbeitsregel für neue Sessions

1. Zuerst `CLAUDE.md` und diese Datei (`docs/ocap/HANDOFF.md`) lesen.
2. Git prüfen (Branch, HEAD, Working Tree, origin-Abstand).
3. `STATUS.md`, `DECISIONS.md` und `docs/ocap/audits/` NICHT vollständig als
   Pflichtlektüre lesen — nur bei konkretem Bedarf gezielt konsultieren
   (Entscheidungsbegründungen, Migrationsdetails, Live-Test-Aufbauten).
4. Danach direkt die für die Aufgabe relevanten Source-Dateien lesen; bei
   Widerspruch gilt der Code, nicht die Doku.
