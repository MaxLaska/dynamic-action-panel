# OCAP – Generic Grid Cell Selection & Cell Colors: Architektur- und UX-Target-Design

- **Datum:** 2026-09-18
- **Ausgangs-HEAD:** `4bcce33` (`chore: clean up legacy Chinese source documentation`), Branch `master`, Working Tree sauber
- **Status:** Analyse und Target Design. **Es wurde nichts implementiert.** Kein Produktionscode, kein Format-, kein `settingsVersion`-Change.
- **Methode:** vier parallele read-only Subagents (A Grid/Interaction, B Data/State/Persistence, C UX/Selection-Modell, D Future Consumers), vom Hauptagenten integriert, Widersprüche am Code nachgeprüft, anschließend unabhängiger Review gegen den Code (Abschnitt 18).
- **Teststand zum Zeitpunkt des Audits:** `npm test` 602/602 (Vitest, **`environment: 'node'`**, kein jsdom), `tsc --noEmit` grün, Lint grün.

Konvention in diesem Dokument: Pfade relativ zur Repo-Wurzel; Zeilennummern beziehen sich auf `4bcce33`. Codebeispiele sind **Pseudocode/Typskizzen**, kein fertiger Produktionscode.

---

## 1. Executive Summary

1. **Primäre Selection Unit ist die Grid-Zelle (logische Koordinate `r<row>c<column>`)** innerhalb genau eines Grid-Kontexts `(categoryId, variantId | null)`. Placements, ToolDefinitions und „Objekte" werden von Aktionen **abgeleitet**, nie selbst selektiert. Das ist keine Geschmacksfrage: nur die Koordinate kann leere Zellen adressieren, nur sie ist resize-stabil, und sie ist exakt der Schlüssel, unter dem `cellStyles` bereits persistiert wird.
2. **Selection ist rein ephemerer UI-State**, lebt als React-State in `PanelContent` neben der bestehenden Variant-Auswahl und wird über einen eigenen Context verteilt. Nichts davon berührt `plugin.settings`. Persistent bleibt ausschließlich `cellStyles`.
3. **Interaktion: ein expliziter, pro Grid aktivierter „Select cells"-Sub-Mode innerhalb des Edit Mode.** Modifier-only-Selection im normalen Edit Mode ist am bestehenden Code nicht robust machbar: ein Plain-Click auf ein belegtes Tool **führt es auch im Edit Mode aus** (`SortableButtonItem.tsx:62-65`, kein Mode-Guard), und die gesamte Fläche einer leeren Zelle ist der `+`-Button (`PaletteGrid.css:333-339`).
4. **Technischer Kern der Interaktion ist eine Selection-Overlay-Schicht** (`GridSelectionLayer`), die im Select Mode absolut über dem Grid liegt und sämtliche Pointer-, Click-, Contextmenu- und HTML5-Drag-Events der Zellen abfängt. Damit müssen `Button.tsx`, `SlotAddButton`, das Button-Kontextmenü und der File-Drop **nicht** einzeln entschärft werden. Der `DndContext` bleibt dabei **unangetastet** — weder der Provider wird deaktiviert (Remount, siehe 2.4) noch werden Sensoren entfernt (siehe 5.3b).
5. **Click und Marquee sind eine einzige Geste** auf dieser Schicht: Pointer-Down → < 4 px Bewegung = Click auf die Zelle unter dem Zeiger, ≥ 4 px = Marquee. Hit-Testing über einmal beim Pointer-Down gemessene Zell-Rects, Auswertung durch eine pure Funktion.
6. **Dynamic Variants: Selection ist strikt variant-lokal.** Beim Betreten des Select Mode wird die angezeigte Variant explizit gepinnt (`selectVariant`), damit ein Kontextwechsel in Obsidian das Grid nicht unter dem Cursor austauschen kann. Jede Abweichung zwischen Selection-Kontext und angezeigtem Grid beendet den Mode.
7. **Cell Colors als erster Consumer:** ein purer Op `setCellColorsInState` in `categoryOps.ts`, Commit über den bestehenden `commitToolState`-Funnel. Das Datenmodell (`Hex` oder `ocap:<name>`) bleibt **unverändert und ist richtig**: benannte Farben werden erst beim Rendern auf Obsidians Theme-Variablen (`--color-red-rgb` …) aufgelöst — theme-kompatibel, ohne dass je ein `var(--…)` persistiert wird. Kein gespeichertes Palette-Objekt, kein `settingsVersion`-Bump, kein Template-Format-Change.
8. **Gefundene Lücke im Bestand (kein Architekturfehler, aber Voraussetzung):** `ResolvedGridView` trägt `cellStyles` nicht bis zum Renderer durch (`categoryVariants.ts:248-258`); heute liest **keine** Komponente `cellStyles`. Es gibt außerdem keinen öffentlichen Schreib-Op und keinen Color→CSS-Resolver.
9. **Action-Architektur: kein Registry.** Die Grenze ist ein **Wert** (`GridCellSelectionSnapshot`) plus gewöhnliche pure Funktionen/Hooks, die ihn annehmen — dasselbe Muster wie `ResolvedGridView`. Die Toolbar hält lokal ein kleines Descriptor-Array. `Create Note from Selection` und `Export Selected` sind damit ohne Umbau erreichbar; **heute ist dafür nichts vorzubereiten**.
10. **Empfohlene erste Implementierungsphase:** Phase A — purer Selection-Kern, Cell-Key-Helfer, Color-Resolver, `setCellColorsInState` samt Unit-Tests; keine UI.

---

## 2. Current Architecture Findings

### 2.1 Render-Pfad eines Grids

`ButtonsPanelView.renderPanel()` → `reactRoot.update()` → `ButtonsPanelApp` → `PanelContent` (`src/components/buttons-panel/PanelContent.tsx`) → `PanelVisibilityProvider` → `CategoryVariantProvider` → `ButtonDragProvider` → List/Tabs/Folder-Content → `CategoryButtonGrid` → `GridSlotCell` × `rows*columns`.

- `CategoryButtonGrid` hat **fünf Call-Sites**: `ListModeContent.tsx:280`, `TabsModeContent.tsx:181` (sortable-Zweig) und `:331` (nicht-sortable-Zweig), `FolderDetailOverlay.tsx:215`, `CategoryListDragPreview.tsx:57`. Nicht jede gerenderte Instanz ist eine **interaktive, sichtbare** Instanz:
  - `CategoryListDragPreview` (`enableEditMode={false}`, `sortableEnabled={false}`) existiert während eines Kategorie-Drags sogar **zweimal** für dieselbe Kategorie (Platzhalter + `DragOverlay`-Kopie).
  - `FolderModeContent.tsx:447-466` rendert während eines Drags einen **zweiten, versteckten** `FolderDetailOverlay` (`overlayStyle={{display:'none'}}`, `enableEditMode={false}`, `sortableEnabled={false}`), damit dnd-kits Sensor-Element überlebt — also einen weiteren vollständigen Grid-Baum.
  - `TabsModeContent.tsx:174-179` hält im Edit Mode **alle** Kategorie-Grids gemountet und versteckt die inaktiven per `display:none` — dieselbe Klasse von Falle wie die eingeklappte List-Kategorie (`ListModeContent.tsx:271`).
  Konsequenz für das Design: „dieses Grid ist selektierbar" darf nicht aus `(categoryId, variantId)` allein folgen, und „Instanz unmountet" ist kein verlässliches Signal (Abschnitt 7.2).
- Grid-Container: `CategoryButtonGrid.tsx:271-279`, besitzt ein echtes DOM-Ref `gridRef` (`:84`, kombiniert in `setRefs` `:88-94`), das `useGridResizeDrag` bereits für `getBoundingClientRect()` nutzt. Der Container hat **keine** React-Pointer-Handler.
- Zelle: `GridSlotCell.tsx:183-201`. Jede Zelle ist in jedem Modus gemountet, keyed by Slot (`slot-<n>`), einziges Datenattribut `data-slot`. Weder `categoryId` noch `variantId` noch Zeile/Spalte stehen im DOM.
- Geometrie (`PaletteGrid.css:11-47`): `grid-template-columns: repeat(var(--ocap-grid-columns,4), minmax(0,1fr))`, definite Zeilenhöhe (58 px, `icon-left` 42 px), `gap: 4px`, konstanter 1px-Rahmen pro Zelle in **jedem** Modus. Geometrie-Invarianz ist in `tests/paletteGridGeometry.test.ts` als CSS-Kontrakt gepinnt.
- Im Edit Mode ist das Grid in `.ocap-grid-frame` (bereits `position: relative`) → `.ocap-grid-frame-main` eingerahmt; die Resize-Zonen liegen in einer 16-px-Rinne **strikt außerhalb** der Grid-Box. In `PaletteGrid.css` gibt es keine `nth-child`/`last-child`-Selektoren auf Zellen — ein zusätzliches absolut positioniertes Kind des Grid-Containers ist geometrisch neutral.

### 2.2 Bestehende Gesten und ihre Mechanismen

| Interaktion | Owner | Mechanismus | Gating |
|---|---|---|---|
| Tool ausführen (Click) | `Button.tsx:141` → `useButtonClickHandler.ts` | React `onClick` | **kein Mode-Guard**; nur `if (buttonDrag?.isDragging) return` (`SortableButtonItem.tsx:62-65`) |
| Tool-Drag (Move/Swap) | `SortableButtonItem.tsx:49-81` | dnd-kit PointerSensor `distance: 4`, Touch Long-Press | gerendert nur bei `sortableEnabled`; `useSortable` bekommt nie `disabled` |
| Kategorie-Drag (List) | `SortableCategoryBlock.tsx:31-68` | dnd-kit; Listener auf dem Wrapper, der **das ganze Grid** umschließt | bedingtes Rendern (`categorySortEnabled`) |
| Zelle als Drop-Ziel | `GridSlotCell.tsx:112-115` | `useDroppable('slot:<cat>:<n>')` | `droppableEnabled` |
| Tool erzeugen (`+`) | `GridSlotCell.tsx:44-77` | React `onClick`; schluckt `pointerdown/mousedown/touchstart` per `stopPropagation` | `creationEnabled` (`CategoryButtonGrid.tsx:231`) |
| Vault-File-Drop | `GridSlotCell.tsx:129-194` → `useSlotFileDrop` | **natives HTML5** `dragenter/over/leave/drop` | `creationEnabled` + leere Zelle |
| Grid-Resize | `useGridResizeDrag.ts` | rohe Pointer-Events + `setPointerCapture`, Dokument-Listener | `enabled: isGrid && enableEditMode && !isDragging` (`CategoryButtonGrid.tsx:134`) |
| Button-Kontextmenü | `Button.tsx:108-117` → `useButtonMenu` | natives `contextmenu` | `enableEditMode` |
| Kontextmenü leere Zelle | — | **existiert nicht** | frei |
| Doppelklick | — | **existiert nirgends** | frei |
| Modifier-Keys | — | **kein einziger** `shiftKey/ctrlKey/metaKey/altKey`-Check in `src/` | frei |
| Escape | `useGridResizeDrag.ts:239-247` (nur bei laufendem Resize), `FolderDetailOverlay.tsx:96-109` (**Capture-Phase**, schließt den Folder) | Dokument-`keydown` | s. 5.6 |

Zwei Befunde entscheiden das Interaktionsmodell:

- **Plain-Click ist vergeben und potenziell destruktiv.** Im Edit Mode führt ein Click auf ein Tool dessen Actions aus (Script, Command, Datei öffnen). Es gibt keinen Edit-Mode-Guard.
- **Eine leere Zelle hat keine „Nicht-`+`-Fläche".** `.ocap-slot-add` ist `width/height: 100%`; der `+` schluckt seinen Press, damit in der List-View kein Kategorie-Drag startet. Ein React-`onPointerDown` am Grid-Container würde Presses auf leeren Zellen nie sehen.

### 2.3 State, der eine Geste überlebt — und warum Selection dort hingehört

- `renderPanel()` ruft `reactRoot.update(createAppElement())` (`ButtonsPanelView.tsx:253-269`), also `root.render()` mit demselben Komponententyp. **React-State in `PanelContent` überlebt jeden Commit und jeden Lock/Edit-Wechsel**; nur der Fehler-Fallback remountet. (Subagent A hatte das Gegenteil behauptet; am Code widerlegt und durch B und C unabhängig bestätigt.) Genau deshalb überlebt heute die Variant-Auswahl jeden Save.
- Präzedenz für nicht-persistenten UI-State: `variantSelection` in `PanelContent.tsx:99-148`, verteilt über `CategoryVariantContext` („pure UI state, never persisted"). Daneben Plugin-Felder `categoryOpenState`, `activeTabCategoryId` (`src/types/plugin.ts`).
- Konsequenz: Selection **muss explizit** beendet werden (Mode-Wechsel, Variant-Wechsel …) — sie verschwindet nicht von selbst durch ein Unmount.
- **Namenskollision:** `selection` / `VariantSelectionState` / `selectVariant` bezeichnen im Code bereits die **Variant-Auswahl**. Das neue Feature heißt deshalb durchgängig `cellSelection` / `GridCellSelection…`; ein nacktes `selection` ist im neuen Code verboten.

### 2.4 Warum „DnD per `enabled=false` abschalten" ausscheidet

`ButtonDragProvider` rendert bei `enabled === false` einen **anderen Baum** — nur die beiden Context-Provider, ohne `DndContext` (`ButtonDragContext.tsx:1067-1075`). Ein Umschalten während der Laufzeit ändert den Elementtyp an dieser Position und **remountet alle Kinder**: u. a. ginge `openCategoryId` in `FolderModeContent` verloren, der offene Folder würde beim Betreten des Select Mode zuklappen. (Die Suche nutzt diesen Pfad heute und nimmt das in Kauf.) Für den Select Mode ist das inakzeptabel.

Der naheliegende Ausweichhebel — `DndContext` gemountet lassen und ihm eine **leere Sensorliste** geben — scheidet ebenfalls aus: `useSensorSetup` übergibt `sensors.map(s => s.sensor)` als **Dependency-Array** eines `useEffect` (`node_modules/@dnd-kit/core/dist/core.esm.js:2334-2358`); eine wechselnde Sensorzahl ändert dessen Länge. dnd-kit markiert das selbst (`// TO-DO: Sensors length could theoretically change which would not be a valid dependency`). Ergebnis wären React-Warnungen bei jedem Toggle und ein Effekt, der nie neu läuft.

Nebenbefund (vorbestehend, nicht Teil dieses Features): `ButtonDragContext.tsx:359-376` ruft `useSensor(ScrollAwarePointerSensor, …)` **innerhalb eines bedingten Spreads** auf, abhängig von `isCoarsePointerDevice()`, das bei jedem Render `matchMedia` neu abfragt — eine latente Rules-of-Hooks-Verletzung mit genau dieser variablen Sensorzahl. Als eigener kleiner Fix vormerken.

Abschnitt 5.3b zeigt, dass der Select Mode **gar keinen** Eingriff in den `DndContext` braucht.

### 2.5 Datenmodell (v5) — Stand für `cellStyles`

- Typen: `GridCellKey`, `GridCellStyle { color? }`, `GridCellStyles`, `GridCellStyleFields` (`src/types/settings.ts:221-272`); auf `StoredCategory`/`StoredVariant` **und** auf den Runtime-Views `CategoryConfig`/`CategoryVariant`.
- Primitive (`src/utils/categoryGrid.ts:520-641`): `gridCellKey`, `parseGridCellKey`, `gridCellKeyOfSlot` (in `src/` heute **ungenutzt**, nur in Tests — die fertige Slot→Cell-Brücke), `isGridCellColor`, `isCellKeyInsideGrid`, `cloneGridCellStyles`, `resizeGridCellStyles`, `withCellStyles`. Erlaubte Werte: `#rgb|#rgba|#rrggbb|#rrggbbaa` oder `ocap:[a-z][a-z0-9-]{0,31}`.
- Bereits korrekt behandelt: Copy Category und Duplicate Variant (tief, unabhängig; `categoryOps.ts:615, 694-713`), Make dynamic (Styles wandern auf die erste Variant; `:758-776`), `grid → flow` (verworfen; `:882-892`), Resize (koordinatenstabil; `:488-508`), Export/Parse/Import (`templateExport.ts:46-61`, `templateParse.ts:382-410`, `templateImport.ts:132-137`). Tool-Drag bewegt bewusst **keine** Farbe — die Farbe gehört der Zelle.
- **Lücken:**
  1. `materializeCategory` kopiert `cellStyles` per `...rest` auf die View (`src/domain/tools.ts:101-114`) — als **dieselbe Objektreferenz** wie im Stored-Objekt. `ResolvedGridView` (`categoryVariants.ts:248-258`) reicht sie aber nicht weiter; `CategoryButtonGrid`/`GridSlotCell` kennen keine Farbe. Keine Komponente liest `cellStyles`.
  2. Es gibt **keinen öffentlichen Schreib-Op**; nur das dateiprivate `setCellStyles` (`categoryOps.ts:155-167`), genutzt von Resize und Duplicate.
  3. Es gibt **keine definierte `ocap:`-Palette** und **keinen Color→CSS-Resolver**. Beliebige `ocap:<name>` validieren heute schon und können per Import eintreffen — ein Resolver muss unbekannte Namen tolerieren.
  4. „Keine Farbe" hat **zwei Repräsentationen**: fehlender Key und `{}` (der Parser kann `styles[key] = {}` erzeugen, `templateParse.ts:398-407`). Ein einziger Accessor muss beides normalisieren.
- Grid-Kontext im Bestand: `(categoryId, variantId: string | null)`. Alle drei Write-Pfade lösen ihn identisch gegen die **Stored**-Kategorie auf (`useGridResize.ts:97-101`, `useSlotFileDrop.ts:51-58`, `useButtonCreation.ts:35-41`) und übergeben `null` für statische Grids. **Achtung:** `null` ist im Domain-Layer **nicht** selbstvalidierend — `resolveGridVariantId` (`categoryOps.ts:119-128`) deutet `null` bei einer **dynamischen** Kategorie als „erste Variant“. Nur `planStoredGridResize` (`categoryOps.ts:440-508`) legt einen zusätzlichen `findVariant`-Guard darüber. Ein neuer Op muss diesen Guard ausdrücklich selbst tragen (9.1).
- Commit-Funnel: `commitToolState(plugin, state)` (`src/utils/categoryStore.ts:92-100`). Der Materialisierungs-Memo ist per Stored-Category-**Identität** gekeyed (`tools.ts:123-141`): ein immutabler `cellStyles`-Write erzeugt ein neues Category-Objekt → korrektes Re-Rendering genau dieser Kategorie. Ein In-place-Mutieren wäre für Memo **und** React unsichtbar und würde wegen der geteilten Referenz direkt in die Settings schreiben.
- `saveSettings()` serialisiert `plugin.settings` **blind** (`main.ts:165-172`); `normalizeSettings` erhält unbekannte Top-Level-Keys. Ein versehentlich in Settings geratenes Selection-Feld würde persistiert **und** den Roundtrip überleben.

### 2.6 Bewertung der bestehenden `cellStyles`-Struktur

Kein Architekturfehler gefunden. Koordinaten-Key, Ownership auf dem Grid-Besitzer (Kategorie bzw. Variant), portable Farbwerte und „absent = ungefärbt" sind richtig und werden durch dieses Design bestätigt (insb. 9.2: die `ocap:`-Namen sind die Voraussetzung für theme-kompatible Farben ohne persistierte CSS-Variablen). Einzige Schärfung: der `{}`-vs-absent-Accessor (2.5 Punkt 4).

---

## 3. Selection Domain Model

### 3.1 Was wird selektiert?

| Kandidat | Leere Zelle adressierbar | Resize-stabil | Eindeutig bei doppelt platziertem Library-Tool | Passt zu `cellStyles` |
|---|---|---|---|---|
| ToolDefinition (Tool-ID) | nein | — | nein (eine Definition, n Placements; `tools.ts:156-158` antizipiert das) | nein |
| ToolPlacement | nein | — | Placement hat bewusst **keine eigene ID** (`settings.ts:153-163`) | nein |
| flacher Slot-Index | ja | **nein** (Slot 5 ist bei 3 vs. 4 Spalten eine andere Zelle) | ja | nein |
| gerenderter Slot (DOM) | ja | nein; zusätzlich drei konkurrierende Quellen (Resize-Preview, Drag-State, View) | ja | nein |
| **Zell-Koordinate `r<row>c<column>`** | **ja** | **ja** | **ja** | **identischer Key** |

**Entscheidung: die Zell-Koordinate.** Ein gemischtes Modell („Zellen und Tools") ist unnötig: jedes Tool in einem Grid steht auf genau einer Zelle, die Ableitung Zelle → Placement → Definition ist eine pure Funktion (3.4). Overflow-Placements (korrupte Daten, außerhalb des Grids gerendert) und Flow-Kategorien haben keine Zellen und sind per Konstruktion nicht selektierbar — eine bewusste Scope-Grenze.

### 3.2 Kontext-Schlüssel

~~~ts
/** The ONE grid a cell selection lives in — the owner of cellStyles/rows/columns. */
export interface GridSelectionContextKey {
    categoryId: string;
    /** null = the static grid of the category; otherwise the variant's own grid. */
    variantId: string | null;
}
~~~

`categoryId + variantId + row + column` reicht. **Kein String-Sentinel** für statische Grids: die UI-Write-Pfade übergeben dafür bereits `null`. Ausdrücklich **kein** optionales `variantId?`.

Der Key ist aber **nicht selbstvalidierend** (2.5): im Domain-Layer deutet `resolveGridVariantId` ein `null` bei einer dynamischen Kategorie als „erste Variant". Für Selection gilt deshalb die strengere Lesart als Invariante:

> **I-KEY:** `variantId === null` ⇔ die Kategorie ist ein **statisches** Grid. `variantId !== null` ⇔ die Kategorie ist dynamisch **und** besitzt genau diese Variant. Jede andere Kombination adressiert **kein** Grid: der Select Mode wird nicht angeboten, und ein Write ist ein No-op.

Das schließt auch den Randfall einer dynamischen Kategorie mit `variants: []` ab: `isDynamicCategory` ist dort wahr, `resolveGridViewForVariant` liefert eine leere View mit `variantId: null` (`categoryVariants.ts:260-268, 302-304`), `selectVariant` kann nichts pinnen und jeder Write liefe ins Leere. Nach I-KEY existiert für sie schlicht kein selektierbares Grid.

### 3.3 State-Form

~~~ts
export interface GridCellSelectionState {
    /** The grid in select mode, or null when no grid is. At most ONE per panel. */
    context: GridSelectionContextKey | null;
    /** Selected cells of that grid. Empty set = mode active, nothing selected. */
    cells: ReadonlySet<GridCellKey>;
    /** Last explicitly clicked cell: origin of Shift ranges. */
    anchor: GridCellKey | null;
}

export const NO_CELL_SELECTION: GridCellSelectionState = {
    context: null,
    cells: new Set(),
    anchor: null,
};
~~~

- `Set<GridCellKey>`: Mitgliedschaftstest pro Zelle beim Rendern, keine Duplikate. Immutable-per-edit wie alle Settings-Objekte: jede Änderung erzeugt ein neues Set.
- **`context !== null` ist der Select Mode.** Es gibt kein separates Boolean, das vom Kontext abweichen könnte.
- Marquee-Geometrie und Pipette-Zustand gehören **nicht** hierher (5.4, 9.4).

### 3.4 Snapshot und Resolver — die stabile Grenze zu allen Consumern

~~~ts
/** What any selection consumer receives. A plain value; nothing derived is stored on it. */
export interface GridCellSelectionSnapshot {
    context: GridSelectionContextKey;
    /** Dimensions of exactly that grid when the snapshot was taken. */
    dimensions: GridDimensions;
    /** Row-major, deduped, every key inside `dimensions`. */
    cells: GridCellKey[];
}

export interface ResolvedSelectedCell {
    cell: GridCellKey;
    row: number;
    column: number;
    slot: number;                    // slotAt(row, column, dimensions.columns)
    placement: ToolPlacement | null; // null = empty cell
    tool: ToolDefinition | null;     // null when empty or the toolId is unknown
    color: string | null;            // normalized: absent entry AND `{}` both → null
}

/** src/domain/gridSelection.ts — pure; one pass of placeStoredGrid. */
export function resolveSelectionGrid(
    state: ToolState,
    context: GridSelectionContextKey
): { dimensions: GridDimensions; placements: ToolPlacement[]; cellStyles?: GridCellStyles } | null;

export function resolveSelectedCells(
    state: ToolState,
    context: GridSelectionContextKey,
    cells: readonly GridCellKey[]
): ResolvedSelectedCell[];
~~~

Der Snapshot enthält **nichts Abgeleitetes**, kann also nie gegen die Settings veralten — dieselbe Regel, die `findStoredCategory` vor jedem Write verlangt. „Welches Tool steht in dieser Zelle" kommt **immer** aus `placeStoredGrid(...).slots[slot]` (`tools.ts:151-170`), der einen Selbstheilungs-Implementierung; der gerenderte Slot ist bei korrupten Daten nicht garantiert gleich `placement.slot`.

**Beides wird nicht in Phase A gebaut.** `setCellColorsInState` löst sein Ziel inline auf, genau wie `planStoredGridResize` es tut; `src/domain/gridSelection.ts` entsteht erst mit dem ersten Consumer, der Tools braucht (Create Note / Export Selected). Die Signaturen stehen hier nur, damit die Grenze feststeht und niemand sie später anders zieht.

### 3.5 Pure Selection-Operationen

Alle in `src/utils/gridCellSelection.ts`, registry-frei, ohne React, ohne Obsidian. Die Liste ist die **Zielform**; gebaut wird je Phase nur, was diese Phase benutzt (Spalte „Phase" in 16) — Phase C braucht lediglich `enter/toggle/selectRange/selectAll/clear/prune`:

~~~ts
enterSelection(context): GridCellSelectionState
toggleCell(state, cell): GridCellSelectionState            // plain click
selectRange(state, to, dimensions): GridCellSelectionState // Shift+click: rectangle anchor→to, ADDED
applyMarquee(base, hits, mode: 'add' | 'subtract'): ReadonlySet<GridCellKey>
selectAllCells(state, dimensions): GridCellSelectionState
clearCells(state): GridCellSelectionState                  // keeps context (mode stays on)
pruneToDimensions(cells, dimensions): ReadonlySet<GridCellKey>
cellsWithColor(styles, dimensions, color: string | null): GridCellKey[] // enumerates the GRID, not the sparse map
sameSelectionContext(a, b): boolean
toSnapshot(state, dimensions): GridCellSelectionSnapshot | null
~~~

Ergänzende Geometrie-Helfer neben `gridCellKey` in `src/utils/categoryGrid.ts`: `allGridCellKeys(dimensions)`, `sortCellKeysRowMajor(cells)`, `cellKeysInRect(a, b)`, `gridCellColorOf(styles, key): string | null` (der `{}`-Normalisierer).

---

## 4. State Ownership

| Option | Bewertung |
|---|---|
| State in `CategoryButtonGrid` (pro Grid lokal) | Nein. `PanelContent` (I-CTX), `FolderDetailOverlay` (Escape) und die Bar müssen ihn lesen; „höchstens ein Grid im Select Mode" wäre nicht erzwingbar. |
| `ButtonDragContext` | Nein. Drag-State; im Locked/Such-Zustand gar nicht als `DndContext` vorhanden. |
| `CategoryVariantContext` erweitern | Nein. Anderes Konzept, und der Name `selection` ist dort schon vergeben — Vermischung wäre die direkte Einladung zu Anti-Pattern „Dynamic-Variant-State vermischen". |
| Feld auf dem Plugin-Objekt (`plugin.cellSelection`) | Nein. Wäre leaf-übergreifend geteilt (mehrere Panel-Leaves möglich) und nicht reaktiv. (Nicht-persistente Plugin-Felder an sich haben Präzedenz — `categoryOpenState`, `activeTabCategoryId` —, das ist also nicht der Ablehnungsgrund.) |
| Externer Store/Controller (`useSyncExternalStore`) | Overengineering: es gibt genau einen Schreiber-Baum und React-State überlebt Commits (2.3). |
| **React-State in `PanelContent` + eigener `GridCellSelectionContext`** | **Ja.** Identische Lebensdauer, identischer Scope (ein Panel) und identisches Muster wie die Variant-Auswahl. |

~~~ts
// src/contexts/GridCellSelectionContext.tsx  (sketch)
interface GridCellSelectionValue {
    state: GridCellSelectionState;
    enter(context: GridSelectionContextKey): void;
    exit(): void;
    toggle(cell: GridCellKey): void;
    selectRangeTo(cell: GridCellKey, dimensions: GridDimensions): void;
    replaceCells(cells: ReadonlySet<GridCellKey>): void; // marquee commit
    selectAll(dimensions: GridDimensions): void;
    clear(): void;
}

/** Per-grid read: null unless THIS grid is the one in select mode. */
export function useGridCellSelectionFor(
    categoryId: string,
    variantId: string | null
): { cells: ReadonlySet<GridCellKey> } | null;

/** Cheap boolean for guards (folder Escape, keyboard click guard). */
export function useIsCellSelectionActive(): boolean;
~~~

**Mehrere Panel-Leaves:** jedes Leaf hat seinen eigenen React-Baum und damit seinen eigenen Selection-State. Zwei Leaves können gleichzeitig dasselbe Grid im Select Mode haben; das ist unkritisch, weil Selection nie geteilt wird und jeder Commit (`commitToolState` → `saveSettings` → `updatePanels()`, `main.ts:165-184`) beide Leaves neu rendert. Ändert das andere Leaf die Dimensionen, greift I-DIM (8).

**Wie wird verhindert, dass Selection-State in das persistente Modell gerät?**

1. Der State lebt ausschließlich in React; kein Pfad schreibt ihn auf `plugin` oder `plugin.settings`.
2. Die Selection-Typen liegen in `src/utils/gridCellSelection.ts`, **nicht** in `src/types/settings.ts`. `settings.ts` importiert nichts aus dem Selection-Modul.
3. Domain-Ops nehmen **explizite Argumente** (`context`, `cells`, `color`), nie das State-Objekt. Der Exporter lernt nie etwas über Selection; er bekommt Stored-Daten plus einen Scope.
4. Kein `selected`-Feld auf `GridCellStyle`/`StoredCategory`/`StoredVariant` — `exportCellStyles` kopiert Style-Einträge per `{...style}` (`templateExport.ts:58`), ein Fremdfeld dort würde sogar **exportiert**.
5. Ein Unit-Test pinnt: Settings vor und nach beliebigen Selection-Operationen sind `toEqual` und identitätsgleich (15.1).

---

## 5. Interaction Model

### 5.1 Bewertung der drei Modelle

| | A: expliziter Select-Sub-Mode | B: nur Modifier im Edit Mode | C: Sub-Mode + Ctrl/Cmd-Click als Einstieg |
|---|---|---|---|
| Discoverability | hoch (sichtbarer Toggle) | schlecht (kein Modifier existiert im Plugin, keine Statuszeile) | wie A, für Wiederholer schneller |
| Konflikt mit Click = Tool ausführen | keiner (Overlay) | **schwer**: ein verrutschter Modifier führt ein Script aus | ein lokaler Guard |
| Marquee auf belegter Zelle | möglich | Kampf gegen den 4-px-Sensor auf dem Item-Wrapper | wie A |
| Marquee auf leerer Zelle | möglich | **unmöglich**: `+` schluckt `pointerdown` | wie A |
| Touch | funktioniert (Tap = Toggle) | nicht möglich | wie A |
| Risiko | niedrig–mittel | hoch | A + ein Guard |

**Entscheidung: A, mit C als späterem, optionalem Beschleuniger (Phase F).** B scheitert nicht an Eleganz, sondern am Bestand (2.2).

### 5.2 Verhalten im Select Mode

Der Mode gehört **einem** Grid (`context`), nicht dem Panel. Für dieses Grid gilt:

| Im normalen Edit Mode | Im Select Mode dieses Grids |
|---|---|
| Click auf Tool → Actions laufen | Click → Zelle toggeln; **nichts** wird ausgeführt |
| Click auf leere Zelle → Create-Modal | Click → Zelle toggeln; kein `+` sichtbar |
| Drag auf Tool → Move/Swap | Drag → Marquee; kein Tool bewegt sich |
| File-Drop auf leere Zelle → Tool | **deaktiviert** (Overlay akzeptiert kein `dragover`; definierter Zustand, kein Zufall) |
| Grid-Resize aktiv | deaktiviert; Rahmen bleibt gemountet (keine Geometrieänderung), Zonen inert |
| Rechtsklick Tool → Edit/Copy/Delete | unterdrückt (später: Selection-Menü, Phase F) |
| Variant-Bar bedienbar | bleibt bedienbar; ein Wechsel beendet den Mode (7) |

Andere Grids im Panel verhalten sich **vollständig normal** — inklusive Drag (5.3b).

Der Select Mode existiert nur, wenn `interactionMode === 'edit'` **und** keine Suche aktiv ist (bei aktiver Suche zeigt das Grid gefilterte Belegung, und DnD ist ohnehin aus). **Im Locked Mode gibt es keine Selection:** dort hat ein Click genau eine Bedeutung, leere Zellen sind `aria-hidden` und haben keine Oberfläche, und die Variant wird vom Kontext bestimmt. „Mehrere Tools ausführen" hat mit `actions[]` + `executionMode` bereits eine erstklassige Antwort.

### 5.3 Technische Umsetzung: Overlay, ein Prop, zwei Gates

**(a) `GridSelectionLayer`** — ein absolut positioniertes Kind des Grid-Containers (`position: absolute; inset: 0`), nur gerendert, wenn dieses Grid im Select Mode ist. Der Container bekommt dafür `position: relative` (in jedem Modus, geometrisch neutral; absolut positionierte Kinder eines Grid-Containers nehmen keinen Track ein).

- Fängt `pointerdown/move/up/cancel`, `click`, `contextmenu`, `touchstart` und HTML5-Drag-Events ab; ruft auf `pointerdown`/`mousedown`/`touchstart`/`click` React-`stopPropagation()`.
  - Das verhindert den Kategorie-Drag der List-View — exakt derselbe Mechanismus, mit dem `SlotAddButton` das heute tut (`GridSlotCell.tsx:56-67`): dnd-kit-Listener sind React-Handler auf einem Vorfahren.
  - Das verhindert in der Folder-View, dass `closeOnBlankClick` den Folder schließt (`FolderDetailOverlay.tsx:168-175` reagiert auf jeden Click, der nicht auf einem `button` landet).
- **Gestoppt wird nur, was gestoppt werden muss:** `pointerdown`/`mousedown`/`touchstart` (Kategorie-Drag) und `click` (Folder-Blank-Click). Nebenwirkung, bewusst akzeptiert: für genau diese Clicks laufen auch keine dokumentweiten Click-Listener. `FolderDetailOverlay`s nativer `handleClickOutside` (`:77-93`) wäre ohnehin nicht betroffen — die Schicht liegt innerhalb von `detailRef`.
- **Reihenfolge:** Die Schicht wird **nach** allen Zellen gerendert und trägt `z-index: 1`. `button.buttons-panel-simple-button` ist `position: relative` (`PaletteGrid.css:724-727`), also ein positionierter Nachfahre in derselben Ebene — ohne das wäre das Hit-Testing Zufall der DOM-Reihenfolge.
- Touch: `touch-action` wird im Bestand über CSS-Variablen geschaltet (`DragTouchAction.css`, `ButtonDrag.css`); die Schicht muss sich dort einklinken statt ein flaches `touch-action: none` zu setzen. Relevant erst für das Marquee (Phase E) — Tap = Toggle funktioniert ohne. Touch ist nicht priorisiert, aber nicht verbaut.
- Konsequenz: `Button.tsx`, `SlotAddButton`, `useButtonMenu`, File-Drop-Handler **und `ButtonDragContext.tsx`** bleiben **unverändert**.

**(b) Kein Eingriff in den `DndContext`.** Geprüft und verworfen wurden: Provider-`enabled=false` (remountet den Baum, 2.4), eine leere Sensorliste (von dnd-kit selbst als ungültig markiert, 2.4). Nötig ist keiner von beiden:

- Aus dem selektierenden Grid kann **kein Drag starten** — das Overlay liegt als *Geschwister* über den Zellen; `SortableButtonItem`s Listener und das native `contextmenu` von `Button.tsx` sehen das Event gar nicht erst (Hit-Testing, nicht Propagation).
- Ein Drag aus einem **anderen** Grid *in* das selektierende Grid bleibt möglich (dnd-kit-Collision arbeitet auf Rects, nicht auf DOM-Events) — und ist **harmlos**: Selection ist zell-gekeyt, Farben gehören der Zelle, I-CTX bleibt erfüllt. Eine selektierte Zelle, in die ein Tool gedroppt wird, bleibt dieselbe selektierte Zelle.
- Sollte der Smoke-Test das als verwirrend zeigen, ist der vorgesehene Fallback lokal: `useDroppable({ disabled })` der Zellen des selektierenden Grids (`droppableEnabled`, bestehendes Prop) — **nicht** ein Eingriff in Sensoren.

**(c) Ein Prop und zwei Gates in `CategoryButtonGrid`:**

~~~ts
interface CategoryButtonGridProps {
    // …
    /** This instance is the visible, interactive rendering of its grid. */
    selectable: boolean;
}

// useGridCellSelectionFor(category.id, resolution.variantId) — null unless this grid is in select mode
const selecting = selectable && cellSelection !== null;
const creationEnabled = enableEditMode && !isDragging && !resizeDrag.preview && !selecting;
useGridResizeDrag({ ..., enabled: isGrid && enableEditMode && !isDragging && !selecting });
~~~

`selectable` setzen die fünf Call-Sites (2.1): List `enableEditMode && sortableEnabled && isOpen`; Tabs-sortable-Zweig `enableEditMode && sortableEnabled && visible`; Tabs-nicht-sortable-Zweig `false` (dort ist Suche aktiv oder locked); Folder-Overlay `enableEditMode && sortableEnabled`; Drag-Vorschau `false`. Der versteckte Stale-Folder-Overlay übergibt bereits `enableEditMode={false}` und `sortableEnabled={false}` und ist damit automatisch `false`.

`sortableEnabled` ist bei aktiver Suche `false` (`dragReorderEnabled`, `PanelContent.tsx:180`) — die Bedingung „keine Suche" braucht deshalb **kein** neues `isSearchActive`-Prop durch fünf Ebenen.

`selectable` gated **Bar und Layer**. Nur so erscheint die Schicht nie in einer Drag-Vorschau, nie im versteckten Stale-Overlay und nie in einem per `display:none` versteckten Tab. `useGridResizeDrag` baut einen laufenden Drag bereits ab, wenn `enabled` kippt (`useGridResizeDrag.ts:148-153`).

**(d) Tastatur-Guard:** Das Overlay blockiert Zeiger, nicht den Fokus. Ein per Tab fokussiertes Tool würde mit Enter weiterhin ausgeführt. Deshalb ein Guard nach bestehendem Muster in `SortableButtonItem.handleClick` (und `ButtonItem`): `if (cellSelectionActiveForThisGrid) return;` — direkt neben `if (buttonDrag?.isDragging) return;`.

### 5.4 Eine Geste: Click und Marquee (`useGridMarquee`)

Modelliert nach `useGridResizeDrag` (rohe Pointer-Events, `setPointerCapture`, **kein** dnd-kit):

1. `pointerdown` (nur `button === 0`): Zell-Rects **einmal** messen (`gridEl.querySelectorAll('[data-slot]')` → `getBoundingClientRect()`), zusammen mit `gridCellKeyOfSlot(slot, columns)`; Startpunkt und die Basis-Selection merken; Pointer capturen. (Einmal messen ist dieselbe Begründung wie beim Resize: Schwellen dürfen sich nicht unter dem Zeiger verschieben.)
2. Bewegung < 4 px (das bereits exportierte `RESIZE_DRAG_THRESHOLD_PX`, `categoryGrid.ts:220` — derselbe Wert wie der modulprivate Button-Drag-Schwellwert) → beim `pointerup` ein **Click** auf die Zelle unter dem Startpunkt; liegt er in einer 4-px-Lücke → nichts.
3. Bewegung ≥ 4 px → **Marquee rastet ein** (kein Rückfall zum Click, analog `isResizeDragGesture`); ab dann Live-Preview.
4. `pointerup` → Preview wird zur Selection. `pointercancel`, Escape, Unmount → Basis-Selection wird wiederhergestellt.

Die Marquee-Geometrie (Start/aktueller Punkt, Preview-Set) ist **lokaler State des Hooks**, nicht Teil von `GridCellSelectionState`.

### 5.5 Click-Semantik

| Geste | Wirkung |
|---|---|
| Click auf Zelle | **Toggle** dieser Zelle; Anchor = diese Zelle |
| Shift+Click | Rechteck Anchor→Zelle wird **hinzugefügt**; Anchor bleibt |
| Ctrl/Cmd+Click | identisch zu Click (hält die Muskelerinnerung ehrlich) |
| „Select all" (Bar) | alle `rows × columns` Zellen |
| „Clear" (Bar) | Selection leeren, Mode bleibt |
| „Done" (Bar) / Toggle erneut | Mode verlassen |

**Warum Toggle statt „Click ersetzt"?** Der Sub-Mode ist explizit (Konvention „Auswahlmodus" wie in Galerie-/Datei-Apps, nicht „Desktop-Listbox"): der Nutzer baut auf ≤ 25 Zellen eine **Menge** auf. Toggle macht Touch ohne Modifier vollwertig, und ein Plain-Click kann nie eine mühsam aufgebaute Auswahl verwerfen. „Ersetzen" ist `Clear` + Click. Rechteck-Range ist auf einem rows×columns-Grid die einzige sinnvolle Shift-Form (ganze Zeile, ganze Spalte, Block); eine lineare Range wäre bedeutungslos.

### 5.6 Escape und Click außerhalb

- **Escape:** Dokument-Listener in der **Capture-Phase**, nur während der Mode aktiv ist: läuft ein Marquee → abbrechen; sonst Selection nicht leer → leeren; sonst → Mode verlassen. `preventDefault()` + `stopPropagation()`.
- **Folder-View:** `FolderDetailOverlay` hat einen eigenen Capture-Listener am **selben** Target (`activeDocument`). `stopPropagation` verhindert andere Listener am selben Knoten nicht, und die Registrierungsreihenfolge ist **nicht stabil** (der Overlay registriert bei jeder Änderung von `onClose`/`isEditingName`/`locked`/`isDragging` neu). Auf Reihenfolge darf man sich also nicht verlassen. Lösung, reihenfolge-unabhängig und nach dortiger Präzedenz (`if (buttonDrag?.isDragging) return;`, `FolderDetailOverlay.tsx:100-102`): eine Zeile `if (cellSelectionActive) return;`.
- **Click außerhalb des Grids:** tut **nichts** (weder leeren noch verlassen). In der Folder-View ist „außerhalb" mehrdeutig mit dem Schließen des Folders; ein einheitliches „passiert nichts" ist vorhersehbarer als eine view-abhängige Regel. Clear/Done sind einen Click entfernt. Schließt der Nutzer den Folder, unmountet das Grid → Mode endet (7.2).

### 5.7 Ort der Bedienelemente

`GridSelectionBar`, gerendert von `CategoryButtonGrid` direkt unterhalb der Stelle, an der heute `VariantSelector` sitzt (`CategoryButtonGrid.tsx:339-347`) — gleicher Owner, gleicher React-Baum, gleiches bewährtes `flex-wrap`-Verhalten bis 150 px. Nur bei `selectable && isGrid` (5.3c) und nur, wenn I-KEY ein Grid adressiert (3.2).

- **Idle:** ein einzelner kleiner Icon-Button (Stil `.ocap-variant-action`), Tooltip zustandszuerst wie beim Lock-Toggle: `Select cells`.
- **Aktiv:** zweite, umbrechende Zeile: `N selected` (als `role="status" aria-live="polite"`, Präzedenz `GridResizeReadout`) · Swatches · `No color` · `Select all` · `Clear` · `Done`.

Verworfen: **NavigationBar** (eigener React-Root, `src/views/renderers/NavigationBarRenderer.tsx:33-95` — kein Zugriff auf den Context; außerdem globaler Toggle für eine Pro-Grid-Geste), **Variant-Bar** (nur dynamische Kategorien), **schwebende Toolbar über dem Grid** (verdeckt die Zellen, die sie färbt — der Resize-Readout sitzt aus genau diesem Grund außerhalb der Grid-Box). Kontextmenü-Einträge („Select cells…") sind ein billiger Zweitpfad für Phase F; Achtung: es gibt **zwei** fast identische Kategorie-Menü-Builder (`useCategoryMenu.ts` und `categoryMenuUtils.ts`), ein Eintrag müsste in beide. Command-Palette: nicht für v1; ein späteres `Select cells in active grid` bräuchte erst einen Begriff von „aktivem Grid".

---

## 6. Marquee Semantics

| Frage | Entscheidung |
|---|---|
| Wo darf der Drag starten? | Überall auf dem Overlay: leere Zelle, belegte Zelle, Lücke. Es gibt im Select Mode keine Fläche mit anderer Bedeutung. |
| Tool-Drag vs. Marquee | Im Select Mode ist **jeder** Drag ein Marquee; außerhalb gibt es kein Marquee. Keine Heuristik, kein Modifier zur Unterscheidung. |
| Treffer | **Intersection**: eine Zelle ist getroffen, sobald Marquee-Rect und Zell-Rect sich mit positiver Fläche überlappen. Bei 58-px-Zellen mit 4-px-Lücken ist „nur Cell-Center" unnötig streng und fühlt sich träge an. |
| Live-Preview | Ja; Preview = `applyMarquee(base, hits, mode)`, pro `pointermove` neu aus der **Basis** berechnet (nie inkrementell — Präzedenz „Previews von der Drag-Start-Baseline"). |
| Modus | Plain und Shift = **add**; Ctrl/Cmd (`ctrlKey || metaKey`) = **subtract**. Kein „replace"-Marquee — konsistent mit dem Toggle-Modell (5.5). Der Modus wird beim Pointer-Down festgelegt. |
| Escape während Marquee | Abbruch, Basis-Selection bleibt. |
| Click außerhalb | kein Effekt (5.6). |
| Über die Grid-Grenze hinaus | Pointer-Capture hält die Geste; das Marquee-Rect wird auf die Grid-Box **geklemmt**. Keine Auto-Scroll-Logik. |
| Grid-Größe | Alle Operationen nehmen `GridDimensions` explizit; Grenzen kommen aus `MAX_GRID_ROWS/COLUMNS`. Keine feste 25, keine Infinite-Grid-Annahme, keine Virtualisierung. |
| Sichtbarer Rahmen | Ein `div` im Overlay (`pointer-events: none`), Akzent-Rand + schwache Füllung. |

Bewusst **nicht**: Lasso, nicht-rechteckige Bereiche, Verschieben der Auswahl als Block, grid-übergreifende Auswahl.

Pure, testbare Kernfunktion:

~~~ts
export interface CellRect { cell: GridCellKey; left: number; top: number; right: number; bottom: number; }
export function cellsIntersectingRect(rects: readonly CellRect[], marquee: Rect): GridCellKey[];
export function cellAtPoint(rects: readonly CellRect[], x: number, y: number): GridCellKey | null;
~~~

---

## 7. Dynamic Variant Semantics

### 7.1 Grundregel

Selection ist **strikt variant-lokal**; `variantId` ist die Hälfte der Identität. Es wird **keine** Selection pro Variant aufbewahrt: ein Wechsel beendet den Mode. Vorhersehbar schlägt clever — eine beim Zurückwechseln „wieder auftauchende" Auswahl würde die nächste Farb-Aktion still umadressieren.

### 7.2 Eine Invariante statt vieler Sonderfälle

> **I-CTX:** Der Select Mode besteht nur, solange (1) `interactionMode === 'edit'`, (2) keine Suche aktiv ist, (3) die Kategorie existiert **und eine sichtbare, interaktive Instanz ihres Grids gerendert ist**, und (4) das für diese Kategorie **angezeigte** Grid exakt `context.variantId` hat. Ist eine Bedingung verletzt, wird der State auf `NO_CELL_SELECTION` gesetzt.

Umsetzung in zwei Teilen:

- **(1)(2)(4) und „Kategorie existiert"** prüft der Provider in `PanelContent` gegen `interactionMode`, `normalizedQuery`, die Mitgliedschaft in `filteredCategories` und `normalizedSelection[categoryId]?.current ?? null` — dieselbe normalisierte Quelle, aus der gerendert wird. Dynamische Kategorien haben dort einen Eintrag, statische keinen → `null`, deckungsgleich mit `ResolvedGridView.variantId`.
- **„Sichtbare, interaktive Instanz"** kann `PanelContent` nicht wissen. Das deckt das Prop `selectable` (5.3c) ab, **deklarativ pro Instanz** in `CategoryButtonGrid`:

~~~ts
// Only an instance that IS (or just was) the selectable rendering may end the mode.
useEffect(() => {
    if (cellSelection !== null && !selectable) exit();          // hidden: collapsed, inactive tab
}, [cellSelection, selectable]);
useEffect(() => {
    if (!selectable) return;
    return () => exitIfContextIs(category.id, variantId);       // unmounted: folder closed, view type changed
}, [selectable, category.id, variantId]);
~~~

Warum nicht einfach „Layer unmountet → `exit()`": dieselbe Kategorie ist zeitweise **mehrfach** gerendert (Drag-Vorschau zweimal, versteckter Stale-Folder-Overlay, 2.1). Würde jede Instanz beim Unmount den Mode beenden, stürbe er ohne sichtbaren Grund — der Kontext-Key `(categoryId, variantId)` ist bei allen identisch. Nur eine Instanz, die selbst `selectable` war, darf aufräumen; Vorschauen und Stale-Overlay sind es nie. Und umgekehrt bleiben eingeklappte List-Kategorien (`display:none`, `ListModeContent.tsx:271`) und inaktive Tabs (`TabsModeContent.tsx:174-179`) **gemountet** — dort greift der erste Effekt über `selectable → false`. Es braucht damit keine verstreuten `exit()`-Aufrufe in Collapse-, Tab- und den fünf `setOpenCategoryId`-Stellen des Folder-Views.

| Ereignis | Ergebnis |
|---|---|
| Nutzer wählt andere Variant / ⇄-Flip | Mode endet (I-CTX 4) |
| Duplicate / New Variant (beide rufen `onSelect(newId)`) | Mode endet. Die Kopie erbt die **Farben** (bestehende Semantik), nicht die Selection |
| Variant gelöscht | `selectedVariantOf` normalisiert auf eine andere Variant → Mode endet |
| Editieren einer aktuell **nicht** gematchten Variant | normal erlaubt — Selection gehört immer zu `Editing:`, nie zu `Active now:` |
| Fallback-Variant | eine Variant wie jede andere |
| Make dynamic auf selektierendem statischem Grid | Kontext wechselt von `null` auf eine Variant-ID → Mode endet |
| `grid → flow` | kein Grid mehr → die selektierbare Instanz verschwindet → Mode endet |
| Category Delete / Copy | Delete: Mode endet. Copy: Original unberührt, Mode bleibt; die Kopie erbt Farben, keine Selection |
| Lock | Mode endet (I-CTX 1) |
| Plugin-Reload / View-Reload | State weg (React-State) — gewollt |
| Commit (z. B. Farbe angewendet) | Mode **und** Selection bleiben (2.3) — gewollt: der Nutzer probiert oft mehrere Farbtöne |

### 7.3 Der eine gefährliche Fall: Kontextwechsel ohne explizite Variant-Wahl

Ohne explizite Wahl fällt `selectedVariantOf` auf die runtime-aufgelöste Variant zurück (`CategoryVariantContext.tsx:117-120`), und `normalizedSelection` rechnet bei jedem `workspaceContext`-Wechsel neu (`PanelContent.tsx:137-147`). Wechselt der Nutzer im Edit Mode die aktive Note, kann das angezeigte Grid einer nie explizit gewählten dynamischen Kategorie **unter dem Cursor wechseln**.

**Regel:** Beim Betreten des Select Mode einer **dynamischen** Kategorie ruft die Bar zuerst `selectVariant(categoryId, resolution.variantId)` (in `CategoryButtonGrid` verfügbar, `:102`; nach I-KEY dort nie `null`). Statische Grids brauchen keinen Pin — sie haben genau ein Grid. `PanelContent.selectVariant` behandelt genau diesen Fall bereits („Re-selecting what is already shown: make it explicit but keep the existing flip target", `:113-122`). Danach ist die Wahl explizit und kontextfest. Pin und `enter` passieren im selben Event-Handler, werden von React also gemeinsam gebatcht; sollte ein Kontextwechsel trotzdem dazwischenkommen, beendet I-CTX (4) den Mode sofort wieder — schlimmstenfalls muss der Nutzer erneut klicken, nie wird ein falsches Grid adressiert.

---

## 8. Grid Resize Semantics

Resize ist im Select Mode des Grids **deaktiviert** (5.3c); ein laufendes Marquee und ein Resize können daher nie gleichzeitig existieren, und die Resize-Preview (die Zellzahl und Slot-Indizes mitten in der Geste ändert) trifft nie auf eine Selection. Dimensionen können sich trotzdem von außen ändern (zweites Panel-Leaf, Sync/Reload, Import). Deshalb:

> **I-DIM:** Die wirksame Selection ist immer `pruneToDimensions(state.cells, dimensionsOfDisplayedGrid)`. Das Pruning ist **abgeleitet** (beim Lesen), kein Effekt — es kann nicht „vergessen" werden.

- Grid wächst → alle Keys bleiben gültig (Koordinaten-Key, kein Remapping) — identisch zu `resizeGridCellStyles`.
- Grid schrumpft → Keys des abgeschnittenen Streifens fallen aus der Selection — derselbe Streifen, aus dem Tools und `cellStyles` fallen.
- `setCellColorsInState` validiert zusätzlich jeden Key mit `isCellKeyInsideGrid` gegen den **aktuellen Stored-Stand**; ein veralteter Key kann nichts schreiben.
- `Anchor` außerhalb der Dimensionen → `null`.

---

## 9. Cell Color Consumer

### 9.1 Der Schreib-Op

~~~ts
// src/domain/categoryOps.ts — pure, ToolState in → ToolState out, never persists, never GCs.
export function setCellColorsInState(
    state: ToolState,
    context: GridSelectionContextKey,
    cells: readonly GridCellKey[],
    color: string | null // null = clear
): ToolState;
~~~

Verbindliche Regeln (alle aus dem Bestand abgeleitet):

1. Ziel-Auflösung **strikt nach I-KEY (3.2), inline und mit eigenem Guard** — ausdrücklich **nicht** über `resolveGridVariantId`, das `null` bei dynamischen Kategorien als „erste Variant" deutet: statisch ⇒ nur `variantId === null`; dynamisch ⇒ nur `variantId !== null` **und** `findVariant(...) !== null`. Jede andere Kombination → **unverändertes `state`** (Identität erhalten). Vorbild für den zusätzlichen Guard: `planStoredGridResize` (`categoryOps.ts:440-508`).
2. `color !== null` muss `isGridCellColor` bestehen — validiert im Op, nicht in der UI. Ungültig → unverändertes `state`.
3. Keys außerhalb der Dimensionen werden ignoriert (`isCellKeyInsideGrid`).
4. **Clear löscht den Key**; wird die Map leer, entfällt das Feld `cellStyles` ganz (via bestehendem `setCellStyles`), sodass unberührte Daten byte-gleich zu Pre-Feature-Daten bleiben.
5. Andere Felder eines `GridCellStyle` bleiben erhalten (`{ ...existing, color }`) — zukunftssicher, falls Styles je mehr als `color` tragen.
6. Berührt **nie** Registry, Placements oder eine andere Variant; ruft **nie** `gcTools`.
7. No-op (alle Zellen haben die Farbe schon) → dieselbe `state`-Referenz → kein Commit nötig.

Commit: `commitToolState(plugin, setCellColorsInState(toolStateOf(plugin), …))` im Hook `useCellColorActions` — der Hook löst gegen den **aktuellen** Stored-Stand auf, nie gegen eine gerenderte Projektionskopie. Leere und belegte Zellen werden vollkommen gleich behandelt; der Op weiß nicht, was auf einer Zelle steht.

Copy Category, Duplicate Variant, Make dynamic, Resize, Export/Import sind bereits korrekt (2.5) und werden **nicht angefasst**.

### 9.2 Farbdarstellung: das bestehende Wertemodell ist richtig

| Option | Bewertung |
|---|---|
| CSS-Klassen / `var(--…)` persistieren | Bleibt verboten: nicht portabel, vom Parser bereits abgelehnt. |
| Gespeicherte, editierbare Palette in den Settings | Nicht für v1: neues Root-Feld, Portabilitätsproblem (eine importierte `ocap:x` wäre im Ziel-Vault unauflösbar) → zöge Template-Format v2 nach sich. |
| **Feste eingebaute Namen, aufgelöst beim Rendern** | **Ja.** `ocap:red` wird erst zur Renderzeit zu `rgba(var(--color-red-rgb), α)`. Persistiert ist der portable Name; die Optik folgt dem Theme (hell/dunkel, Custom Themes). |
| Hex-Literale | Ja, als „Custom"; bewusst theme-**un**abhängig. |

~~~ts
// src/utils/gridCellColor.ts — pure
export const OCAP_CELL_COLOR_NAMES = [
    'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink',
] as const; // exactly Obsidian's --color-<name>-rgb set

/** CSS value for a stored color, or null for unknown/invalid/absent (renders as "no color"). */
export function resolveGridCellColorCss(value: string | undefined): string | null;
~~~

- **Unbekannte `ocap:`-Namen rendern als „keine Farbe"** und bleiben in den Daten unangetastet (sie können per Import eintreffen; nie umschreiben, nie ablehnen).
- 6-stelliges Hex wird mit derselben Deckkraft wie die benannten Farben gerendert (z. B. `color-mix`), 8-stelliges wörtlich. Die konkrete Deckkraft ist ein CSS-Token, in einer Zeile nachjustierbar.
- **Same-Color-Vergleich erfolgt auf dem rohen gespeicherten String**, nie auf dem aufgelösten CSS.

**Picker v1:** acht Swatches + `No color` in der Bar. **Phase F:** Custom-Hex über ein natives `<input type="color">` (schreibt `#rrggbb`). Keine Custom-Palette, kein Farbverlauf-Dialog.

### 9.3 Rendering (auch im Locked Mode)

- `ResolvedGridView` bekommt `cellStyles?: GridCellStyles`, gefüllt in `viewOfButtons`/`resolveGridViewFor*` aus genau dem Objekt, das auch `dimensions` liefert (Variant bzw. Kategorie). Referenz durchreichen, **nie mutieren**.
- `GridSlotCell` bekommt `color?: string` (bereits aufgelöstes CSS) → inline Custom Property `--ocap-cell-color` + Klasse `ocap-grid-slot--colored`; und `selected?: boolean` → Klasse `ocap-grid-slot--selected`.
- Farben sind **Inhalt**, kein Edit-Chrome: sie rendern in jedem Modus. Während einer Resize-Preview werden Styles außerhalb der Preview-Dimensionen einfach nicht gezeichnet (der Key existiert dann in keiner gerenderten Zelle).
- Die Farbe füllt den **Zell-Hintergrund**. Der Tool-Button ist standardmäßig `background-color: transparent` (`Button.css:1-4`), die Zellfarbe scheint also durch; nur `:hover` und per-Tool-`customCss` können sie überdecken — akzeptiert.
- **Spezifität ist ein Kontrakt, keine Prosa.** Die `--colored`-Regel muss `…--managed .ocap-grid-slot--filled { background-color: var(--background-secondary) }` (`PaletteGrid.css:310-312`, 0-3-0) schlagen, darf aber `body .buttons-panel .ocap-palette-grid .ocap-grid-slot--drop-target` (`:621-626`, 0-3-1) und `--file-target` (`:369-374`) **nicht** schlagen. Vorgabe: Selektor `body .buttons-panel .ocap-palette-grid .ocap-grid-slot--colored` (0-3-1) und **Position in der Datei vor** der `--file-target`-Regel — bei gleicher Spezifität entscheidet die Quellreihenfolge zugunsten der Target-Ringe. `…--empty:hover` (0-4-0) gewinnt gegen die Farbe; gewollt, der Hover einer leeren Zelle im Edit Mode bleibt sichtbares Feedback. Beides wird im CSS-Kontrakt-Test gepinnt (15.7).

### 9.4 Pipette (Phase F)

Transienter **lokaler State der Bar** (`pickArmed: boolean`), nicht Teil des Selection-Kerns: bewaffnet → der nächste Zell-Click **liest** `gridCellColorOf(styles, cell)` statt zu toggeln und setzt die „aktuelle Farbe" der Bar; die Waffe entlädt sich. Anwenden bleibt ein eigener Click auf die aktuelle Farbe. Zelle ohne Farbe → aktuelle Farbe = `No color` (ein gültiges, anwendbares Ergebnis). Escape entwaffnet zuerst.

### 9.5 Same-Color Selection (Phase F)

`cellsWithColor(styles, dimensions, color | null)` — iteriert das **Grid**, nicht die dünn besetzte Map, damit „alle ungefärbten" funktioniert; `{}` zählt als ungefärbt. Referenz = Anchor-Zelle. Strikt innerhalb des aktuellen Grid-Kontexts.

### 9.6 Fill Visible Cells

„Alle sichtbaren" = `allGridCellKeys(dimensions)` = `Select all`. Bei maximal 25 Zellen, die alle gerendert sind, gibt es keinen Viewport-Begriff; „Fill" ist `Select all` + Swatch. Keine eigene Infrastruktur.

---

## 10. Future Consumer Stress Tests

### 10.1 Action-Grenze: Wert statt Registry

Präzedenz im Code: Registries existieren **nur**, wo ein persistierter String zur Laufzeit aufgelöst werden muss (`ACTION_TYPES` in `src/actions/registry.ts`, `MIGRATION_STEPS`). Alles andere ist geschlossene Union + exhaustiver Switch. Eine Selection-Action ist transient, wird nie persistiert, nie per ID referenziert.

| Option | Urteil |
|---|---|
| `SelectionAction`-Registry mit `isAvailable/execute` | Verworfen: Indirektion, Lifecycle-Frage (wer registriert wann), opakes Kontextobjekt für Abhängigkeiten. Kein Bedarf, keine Präzedenz. |
| **`GridCellSelectionSnapshot` + gewöhnliche Funktionen/Hooks** | **Gewählt.** Spiegelt `ResolvedGridView`: ein schlichter Wert, von puren Resolvern erzeugt, von vielen konsumiert. |
| Descriptor-Array | Ja, aber als **UI-Detail innerhalb** `GridSelectionBar` (`{ id, label, icon, disabled, run }`), nicht als Architektur. Sollte je ein Command-Palette-Eintrag gewünscht sein, ist dieses Array die Stelle. |

`Apply Color` ist damit der erste Consumer, ohne dass ein Framework entsteht: die Bar ruft `useCellColorActions().applyColor(snapshot, color)`.

### 10.2 Create Note from Selection

Auswahl: PDF-Tool, Markdown-Note-Tool, Source-Note, leere farbige Zelle, URL-Tool, Script-Tool.

- Kette: `cell` → `slotAt(row, column, columns)` → `placeStoredGrid(...).slots[slot]` → `state.tools[placement.toolId]` → `definition.actions[]`. Jeder Schritt existiert; gebündelt in `resolveSelectedCells` (3.4).
- Repräsentierbarkeit je Action-Typ (`src/types/action.ts`, geschlossene Union): `file` → `[[path]]` bzw. `![[path]]`; `url` → `[name](url)`; `script` → Wikilink nach Re-Join von `scriptFolderPath + scriptName`, sonst Code-Span; `command` → nur Code-Span (interne ID); `create_file` → bewusst **nicht** als Link (Ziel existiert evtl. nicht, `{{DATE:…}}` wird erst zur Laufzeit aufgelöst). Leere farbige Zelle → Zeile mit Koordinate/Farbe oder auslassen — genau deshalb muss die Unit die Zelle sein.
- Mehrere Actions pro Tool: ein Eintrag pro **Zelle**, verschachtelte Punkte pro Action. Reihenfolge: row-major — dieselbe „räumliche Lesereihenfolge" wie bei `grid → flow`.
- **Braucht `ToolDefinition` heute eine „representation"-Fähigkeit? Nein.** Ein purer Adapter `describeToolForNote(def)` ist das Spiegelbild des bestehenden `buildVaultFileButtonDraft` (`src/utils/vaultFileButton.ts`). Ein persistiertes Capability-Feld müsste migriert, im Parser validiert und exportiert werden — hoher Preis für eine ableitbare Tatsache.
- Erzeugung: **nicht** `CreateFileService` (kein Content-Parameter, erzwingt Template/`.md`/Öffnen), sondern `app.vault.create(path, content)` wie `templateIo.ts`; danach optional `FileService.openFile`.
- **Heute vorzubereiten: nichts.**

### 10.3 Export Selected

- `buildTemplateDocument(state, categoryIds, meta)` (`templateExport.ts:182-207`) löst IDs gegen `state.categories` auf und sammelt Tools aus den **bereits exportierten** Placements (`referencedToolIds`). Ein Teil-Export ist daher ohne Exporter-Änderung möglich: transientes `StoredCategory` bauen (nur selektierte Placements, nur selektierte `cellStyles`) und `buildTemplateDocument({ tools: state.tools, categories: [transient] }, [transient.id], meta)` aufrufen. Legal, weil Export strikt read-only ist.
- **Volle Dimensionen + Original-Slots + Original-Keys behalten**, nicht auf die Bounding-Box croppen: Crop bräuchte eine Übersetzung von Slots **und** Keys, die nicht existiert (`remapSlot` kann nur Resize), und wäre ohne sie asymmetrisch verlustbehaftet (Out-of-Range-`cellStyles` werden beim Import verworfen, Out-of-Range-Slots selbstgeheilt → Farben weg, Tools verrutscht).
- Leere, gefärbte Zellen sind darstellbar — selbst eine Auswahl **nur** aus ihnen ergibt ein gültiges Template (`placements: []`, `tools: {}`).
- Falle bei dynamischen Kategorien: als **statisches Grid** exportieren. Eine einzelne Variant ohne Trigger und ohne `fallback: true` würde im Locked Mode nie matchen.
- UX-Hinweis: Import **erzeugt** immer eine neue Kategorie — „Export Selected → Import" ist ein Kopieren in eine neue Kategorie, kein Einfügen ins bestehende Grid.
- **Template-Format v1 reicht; heute nichts ändern.**

### 10.4 Batch-Aktionen — latente Kanten (nur notieren)

- `removeToolFromCategory(state, categoryId, toolId)` entfernt das Tool aus **allen** Variants (`categoryOps.ts:313-343`). Heute unkritisch (Ad-hoc-Tools sind 1:1 platziert), falsch, sobald ein Library-Tool zweimal platziert ist. „Delete selected" braucht später ein zell-skopiertes `removePlacementsAt(state, context, cells)` + ein `gcTools`. **Keine UX bauen, die die heutige Signatur für zell-skopiert hält.**
- Block-Move: `applySlotIdsToStoredCategory` bewegt Placements, aber **keine** `cellStyles`. Bräuchte denselben fehlenden Translate-Helfer wie der Bounding-Box-Crop.
- Copy-to-Variant: Vorlage ist `duplicateVariantInState`, nicht `copyToolInCategory`.
- Alle drei lassen sich in **einem** `commitToolState` bündeln (alle Ops sind pur `ToolState → ToolState`).

---

## 11. Accessibility / Visual State Notes

### 11.1 Visuelle Kanäle der Zelle

| Kanal | Belegt durch | Für das Feature |
|---|---|---|
| `border-color` (1 px, immer vorhanden) | Edit-Raster, Drop-Target- und File-Target-Ring | **tabu** — die Ringe versprechen, wo ein Drop landet |
| `border-width/-style` | Geometrie-Invariante | **verboten** |
| `background-color` der Zelle | filled/empty-Grund, Hover, Target-Zustände | **Zellfarbe**; muss filled/empty überstimmen, den Target-Zuständen weichen |
| `outline` der Zelle | unbenutzt | **selected**: `outline: 2px solid var(--interactive-accent); outline-offset: -2px` |
| `opacity` | Target-Zustände, context-hidden (auf dem Button) | nicht verwenden |
| gestrichelte Outline | „vom Kontext ausgeblendet" | nicht verwenden (semantisch belegt) |

`outline` nimmt nie am Layout teil → Geometrie-Invarianz bleibt; ein 2-px-Akzent-Outline **innerhalb** des Rahmens ist klar vom 1-px-Akzent-**Border** eines Drop-Ziels unterscheidbar und bleibt auf jeder Zellfarbe lesbar (Rahmen statt Farbüberlagerung). Drop-Ringe können im selektierenden Grid nur bei einem Drag aus einem **anderen** Grid erscheinen (5.3b); dann liegen 1-px-Border-Ring und 2-px-Outline nebeneinander und bleiben unterscheidbar. Neue Regeln dürfen **keine feste Größe** setzen (CSS-Kontrakt-Test).

Zustände: normal · hovered (Overlay-Cursor `cell`/`default`, optional dezente Grundaufhellung) · selected · selected+colored · belegt vs. leer (unverändert über den Grund) · Edit vs. Locked (Farbe in beiden; Auswahlrahmen nur im Select Mode).

### 11.2 ARIA — pragmatisches Minimum

- **Kein `role="grid"`:** verlangt `role="row"`-Kinder; das DOM ist ein flaches CSS-Grid, Row-Wrapper würden die gepinnte `grid-auto-rows`-Geometrie brechen. Außerdem umhüllt dnd-kit jedes Tool mit `role="button" tabIndex=0`.
- **v1 (Phasen C–E):** zeigergetriebene Selection; die Bar meldet `N cells selected` als `role="status" aria-live="polite"` (Präzedenz `GridResizeReadout`), die Schicht ist ein `role="group"` mit `aria-label`. **Kein** `aria-selected` auf den Zellen: eine Zelle ist ein rollenloses `<div>` (dort wäre das Attribut ungültig), und das Label einer belegten Zelle lebt auf dem inneren `<button>` (`Button.tsx:135-141`), nicht auf der Zelle. Ehrliche Einordnung: v1 ist für Screenreader **ankündigend, nicht bedienbar**.
- **Phase F (optional):** Tastaturmodell als `role="listbox" aria-multiselectable="true"` auf dem Overlay mit `role="option"`-Kindern (dort sind `aria-selected` und das zusammengesetzte Label „Row 2, column 3, empty, selected, color red" gültig; Hex wird als „custom color" angesagt), Roving-Tabindex, Pfeiltasten, Space = Toggle, Shift+Pfeil = Rechteck. Listbox/Option braucht keine Row-Elemente. Das ist additiv — nichts in C–E verbaut es.
- Fokus ≠ Auswahl: Fokus über den Standard-Fokusring, Auswahl über die Outline; beide dürfen gleichzeitig sichtbar sein.

Kein vollständiges Accessibility-Redesign; die bestehende Verschachtelung `role="button"`-Wrapper um einen echten `<button>` ist ein vorbestehender Befund, kein Teil dieses Features.

---

## 12. Risks / Anti-Patterns

| # | Risiko / Anti-Pattern | Gegenmaßnahme |
|---|---|---|
| R1 | Selection an Tool-ID statt Zelle koppeln | Unit = `GridCellKey`; Tools nur über den Resolver (3.4) |
| R2 | Selection persistieren | State nur in React; Typen außerhalb von `settings.ts`; Identitätstest (15.1) |
| R3 | „Color Mode" als isoliertes Sonderfeature | Selection-Kern kennt keine Farbe; Farbe ist ein Consumer des Snapshots. Pipette/aktuelle Farbe leben in der Bar |
| R4 | Pointer-/Drag-Konflikte | Overlay + `selectable` + zwei Gates (5.3); **weder** Provider-`enabled` **noch** Sensorliste anfassen (2.4) |
| R5 | Zu frühes Action-Framework | Wert + Funktionen; Descriptor-Array lokal (10.1) |
| R6 | React-State über falsche Ebenen verteilt | ein Owner (`PanelContent`), ein Context; Marquee-/Pipette-State lokal, wo er entsteht |
| R7 | Dynamic-Variant-State vermischen | eigener Context, eigener Name (`cellSelection`), Invariante I-CTX, Variant-Pin |
| R8 | `ToolPlacement` mutieren, obwohl nur Cell Style gemeint | `setCellColorsInState` fasst Placements/Registry nie an (9.1 Regel 6) |
| R9 | Copy/Duplicate-Semantik brechen | unverändert lassen; Regressionstests (15.6) |
| R10 | Import/Export unnötig anfassen | kein Format-Change, kein Parser-Change |
| R11 | Selection-Logik in mehreren Komponenten duplizieren | alle Regeln pur in `gridCellSelection.ts`; Komponenten rufen nur auf |
| R12 | `view.cellStyles` in place mutieren (gleiche Referenz wie Stored!) | nur immutable Ops; Test „Eingabe bleibt unverändert" |
| R13 | Folder-View: erstes Escape schließt den Folder; Click schließt ihn | Guard in `FolderDetailOverlay`; Overlay stoppt `click` (5.3, 5.6) |
| R14 | Kontextwechsel tauscht das Grid unter dem Cursor | Variant-Pin beim Betreten (7.3) |
| R15 | Versteckt-aber-gemountet (eingeklappte List-Kategorie, inaktiver Tab): Selection lebt unsichtbar weiter | deklarativ über `selectable → false` (7.2), keine verstreuten `exit()`-Aufrufe |
| R15b | Mehrfach gerenderte Kategorie (Drag-Vorschau ×2, versteckter Stale-Folder-Overlay): Schicht erscheint in einer Vorschau oder deren Unmount beendet den Mode | `selectable` gated Bar **und** Layer; nur eine selbst selektierbare Instanz räumt auf (7.2) |
| R15c | Dynamische Kategorie mit `variants: []`: Mode aktiv, jeder Write läuft ins Leere | I-KEY: es gibt dort kein selektierbares Grid (3.2) |
| R16 | Tastatur-Enter auf fokussiertem Tool führt es im Select Mode aus | Click-Guard in `SortableButtonItem`/`ButtonItem` (5.3d) |
| R17 | Touch: Marquee scrollt das Panel | `touch-action: none` auf dem Overlay; Touch ist nicht priorisiert, aber nicht verbaut (Tap = Toggle funktioniert ohne Marquee) |
| R18 | „Keine Farbe" doppelt repräsentiert (`{}` vs. absent) | ein Accessor `gridCellColorOf` überall |
| R19 | Unbekannte `ocap:`-Namen aus Importen | Resolver → „keine Farbe", Daten unangetastet |
| R20 | Namenskollision `selection` | durchgängig `cellSelection`/`GridCellSelection…` |
| R21 | Keine Komponententests möglich (Vitest läuft in `node`, kein jsdom) | Logik maximal in pure Funktionen; Verdrahtung per CSS-Kontrakt-Test + Obsidian-Smoke (15) |

---

## 13. Decision Matrix

| # | Frage | Optionen | Empfehlung | Begründung | Konsequenz |
|---|---|---|---|---|---|
| 1 | Primäre Selection Unit | Tool · Placement · Slot-Index · DOM-Slot · Zell-Koordinate · gemischt | **Zell-Koordinate `r<row>c<column>`** | adressiert leere Zellen; resize-stabil; identisch zum `cellStyles`-Key; eindeutig bei mehrfach platzierten Tools | Aktionen leiten Placement/Definition über einen puren Resolver ab; Overflow und Flow sind nicht selektierbar |
| 2 | Persistent vs. ephemeral | in `data.json` · auf `plugin` · React-State | **ephemeral, React-State** | Selection ist Arbeitszustand einer Geste; `saveSettings` serialisiert blind | endet bei Reload; nichts zu migrieren; persistent bleibt nur `cellStyles` |
| 3 | Select Mode vs. Modifier-only | A Sub-Mode · B Modifier · C Hybrid | **A; C später optional** | Click führt Tools aus; leere Zelle ist vollflächig `+`; Marquee sonst unmöglich | ein Toggle pro Grid; Overlay entschärft alle Gesten auf einmal |
| 4 | State-Owner | Grid-lokal · DragContext · VariantContext · Plugin · externer Store · `PanelContent` | **`PanelContent` + `GridCellSelectionContext`** | gleiche Lebensdauer/Scope wie Variant-Auswahl; State überlebt Commits; sitzt über dem Drag-Provider | höchstens ein Grid im Select Mode pro Panel; explizites Beenden nötig |
| 5 | Marquee-Verhalten | Center vs. Intersection · replace/add/subtract · eigener Startbereich | **Intersection, Live-Preview, add (Ctrl/Cmd = subtract), Start überall, 4-px-Schwelle, eine Geste mit Click** | große Zellen/kleine Lücken; konsistent mit Toggle-Modell; dieselbe Schwelle wie Drag/Resize | ein Hook, eine pure Hit-Test-Funktion |
| 6 | Selection bei Variant-Wechsel | behalten · pro Variant merken · beenden | **Mode beenden; beim Betreten Variant pinnen** | vorhersehbar; verhindert stilles Umadressieren der nächsten Aktion | eine Invariante (I-CTX) statt vieler Sonderfälle |
| 7 | Action-Architektur | Registry · Snapshot+Funktionen · Descriptor-Array | **Snapshot + Funktionen; Array nur lokal in der Bar** | Registries gibt es im Code nur für persistierte Strings | Create Note / Export Selected ohne Umbau; heute nichts vorzubereiten |
| 8 | Color Picker / Repräsentation | CSS-Klassen · gespeicherte Palette · feste `ocap:`-Namen · Hex | **8 feste `ocap:`-Namen (Render-Zeit → Theme-Variablen) + Hex als Custom (Phase F)** | portabel **und** theme-kompatibel; kein neues Settings-Feld | kein `settingsVersion`-, kein Format-Bump; unbekannte Namen = keine Farbe |
| 9 | Leere Zellen | ausschließen · gleich behandeln | **vollkommen gleich behandeln** | die Farbe gehört der Koordinate; der Op weiß nichts über Belegung | `+` und File-Drop ruhen im Select Mode dieses Grids |
| 10 | Grid Resize | erlaubt · gesperrt · Selection remappen | **im Select Mode gesperrt; wirksame Selection stets auf aktuelle Dimensionen geprunt** | kein gleichzeitiges Marquee+Resize; Koordinaten-Keys brauchen kein Remapping | Invariante I-DIM, abgeleitet statt Effekt |

---

## 14. Exact File-Level Implementation Map

### 14.1 Neue Dateien

| Datei | Rolle | Gehört ausdrücklich NICHT hinein |
|---|---|---|
| `src/utils/gridCellSelection.ts` | purer Selection-Kern: `GridSelectionContextKey`, `GridCellSelectionState`, `GridCellSelectionSnapshot`, alle Ops aus 3.5, `cellsIntersectingRect`, `cellAtPoint` | React, Obsidian, Settings-Typen-Erweiterungen, Farben |
| `src/utils/gridCellColor.ts` | `OCAP_CELL_COLOR_NAMES`, `resolveGridCellColorCss`, Label-Helfer für ARIA | Persistenz, Validierung (bleibt `isGridCellColor`), DOM |
| `src/domain/gridSelection.ts` | **erst mit dem ersten Tool-Consumer** (Create Note / Export Selected): `resolveSelectionGrid`, `resolveSelectedCells` | Schreib-Ops, UI-State |
| `src/contexts/GridCellSelectionContext.tsx` | Provider-Schale, `useGridCellSelection`, `useGridCellSelectionFor`, `useIsCellSelectionActive` | Regeln (liegen im puren Kern), Commit-Logik |
| `src/hooks/useGridMarquee.ts` | Pointer-Schicht: Capture, Schwelle, Rect-Messung, Preview, Escape/Cancel. Schreibt nichts Persistentes | dnd-kit, Settings-Zugriff |
| `src/hooks/useCellColorActions.ts` | `applyColor(snapshot, color \| null)`: Stored auflösen → `setCellColorsInState` → `commitToolState` | Selection-State-Verwaltung |
| `src/components/buttons-panel/GridSelectionLayer.tsx` | Overlay über dem Grid + Marquee-Rahmen; Unmount-Cleanup (`exit`) | Farb-UI, Commit |
| `src/components/buttons-panel/GridSelectionBar.tsx` | Toggle, Zähler (live region), Swatches, No color, Select all, Clear, Done; lokales Descriptor-Array; Variant-Pin beim Betreten | Hit-Testing, Domain-Logik |

Der bestehende Split bleibt gewahrt: `src/utils/*` pur und registry-frei, `src/domain/*` kennt `ToolState`. Keine neue Ordnerhierarchie (`src/selection/` wäre künstlich).

**Zum Umfang:** Für den ersten Consumer (Phasen A–D) entstehen **fünf** neue Dateien (`gridCellSelection.ts`, `gridCellColor.ts`, Context, Layer, Bar) plus `useCellColorActions`; `useGridMarquee` kommt mit Phase E, `gridSelection.ts` erst mit einem Tool-Consumer. Zum Vergleich: Grid-Resize brauchte einen Hook, eine Control-Komponente und einen Op. Der Mehraufwand ist der Preis dafür, dass Selection ein **eigener** Kern ist und kein Farbmodus — aber jede Datei muss sich in ihrer Phase durch tatsächliche Nutzung rechtfertigen; nichts wird auf Vorrat gebaut.

### 14.2 Zu ändernde Dateien

| Datei | Aktuelle Rolle | Geplante Änderung | NICHT |
|---|---|---|---|
| `src/utils/categoryGrid.ts` | pure Grid-Geometrie + Cell-Style-Primitive | `allGridCellKeys`, `sortCellKeysRowMajor`, `cellKeysInRect`, `gridCellColorOf` | Registry-/Tool-Wissen |
| `src/utils/categoryVariants.ts` | Variant-Auflösung, `ResolvedGridView` | `ResolvedGridView.cellStyles?`; `viewOfButtons`/`resolveGridViewFor*` reichen die Styles des Grid-Besitzers durch | Kopieren/Mutieren der Styles |
| `src/domain/categoryOps.ts` | alle v5-Schreib-Ops | `setCellColorsInState` (nutzt privates `setCellStyles`, `findCategory`, `withCategory`); ggf. kleiner privater `replaceVariant`-Helfer | GC, Placement-Änderungen |
| `src/components/buttons-panel/CategoryButtonGrid.tsx` | rendert Grid, Variant-Bar, Resize-Rahmen | `useGridCellSelectionFor`; Gates `!selecting` für `creationEnabled` und Resize; `color`/`selected` an Zellen; `GridSelectionBar` und `GridSelectionLayer` einhängen | Selection-Regeln, Hit-Testing |
| `src/components/buttons-panel/GridSlotCell.tsx` | universelle Zelle | Props `color?`, `selected?`; Klassen/Custom Property | Pointer-Handler für Selection (liegen im Overlay), `aria-selected` (11.2) |
| `src/components/buttons-panel/PaletteGrid.css` | Grid-/Zellen-Styling | `position: relative` am Grid; `--colored`, `--selected`, Layer, Marquee-Rahmen, Bar | feste Größen, Border-Änderungen |
| `src/components/buttons-panel/PanelContent.tsx` | verdrahtet Projektion, Variant-Auswahl, DnD | `cellSelection`-State + Provider; I-CTX-Prüfung (1)(2)(4) + Kategorie-Mitgliedschaft | Vermischung mit `variantSelection`; Eingriff in `ButtonDragProvider` |
| `src/components/button/SortableButtonItem.tsx`, `ButtonItem.tsx` | Tool-Item | Click-Guard für Tastatur (5.3d) | `useSortable({disabled})` — unnötig |
| `src/components/buttons-panel/FolderDetailOverlay.tsx` | Folder-Detail | eine Guard-Zeile im Escape-Handler | sonst nichts |
| `ListModeContent.tsx`, `TabsModeContent.tsx` (beide Zweige), `FolderDetailOverlay.tsx`, `CategoryListDragPreview.tsx` | die fünf Call-Sites von `CategoryButtonGrid` | je **ein** neues Prop `selectable` (Werte in 5.3c) | `exit()`-Aufrufe, Selection-Logik |
| `src/locales/en.json`, `zh.json`, `ru.json` | i18n | neue Keys (Bar, Tooltips, ARIA) in allen drei Locales | hartkodierte Strings |

**Unverändert bleiben ausdrücklich:** `src/contexts/ButtonDragContext.tsx`, `src/types/settings.ts`, `src/settings/settingsMigrations.ts`, `src/export/*`, `docs/ocap/template-format.md`, `src/utils/categoryStore.ts`, `Button.tsx`, `useButtonMenu.ts`, `useSlotFileDrop.ts`, `useGridResizeDrag.ts`.

---

## 15. Test Matrix

Rahmenbedingung: Vitest läuft in `environment: 'node'`, **ohne jsdom** (`vitest.config.ts`); React-Komponententests gibt es im Projekt nicht (HANDOFF §6.6: „jsdom-Editor-Tests weiterhin offen"). Das Design legt deshalb alle Regeln in pure Funktionen. Ebenen: **U** = pure Unit · **C** = CSS-Kontrakt (Stil von `tests/paletteGridGeometry.test.ts`) · **S** = Smoke in isolierter Obsidian-Instanz (nie der Produktiv-Vault).

### 15.1 Selection Basics — `tests/gridCellSelection.test.ts` (U)
- enter setzt Kontext, leeres Set, kein Anchor
- toggle: leer → selektiert → wieder leer; Anchor folgt
- toggle auf leerer vs. belegter Zelle: identisch (der Kern kennt keine Belegung)
- Shift-Range: Rechteck in alle vier Richtungen; ohne Anchor = toggle; Range **addiert**
- selectAll = `rows × columns` für 1×1, 1×3, 4×4, 5×5
- clear behält den Kontext; exit → `NO_CELL_SELECTION`
- `sameSelectionContext`: `null` ≠ `'v1'`; statisch = `null`
- toSnapshot: row-major, dedupliziert, innerhalb der Dimensionen
- **Immutabilität/Leak:** Eingabe-State unverändert; ein Settings-Objekt ist vor/nach beliebigen Selection-Ops `toEqual` und identitätsgleich

### 15.2 Marquee (U)
- `cellsIntersectingRect`: mehrere Zellen; **partielle** Überlappung zählt; Berührung nur der Kante (Fläche 0) zählt nicht; Rect ganz in einer Lücke → leer; umgekehrt aufgezogenes Rect (negativ) normalisiert
- `applyMarquee` add/subtract **gegen die Basis** (nicht inkrementell): Schrumpfen des Rahmens gibt Zellen wieder frei
- `cellAtPoint`: in Zelle / in Lücke / außerhalb
- Schwelle: < 4 px ist Click, ≥ 4 px rastet ein (pure Prädikatfunktion)

### 15.3 Modes (U + S)
- (U) I-CTX-Prädikat: locked → aus; Suche aktiv → aus; Variant abweichend → aus; alles ok → an
- (S) Select-Click auf leere Zelle öffnet **kein** Create-Modal; auf Tool führt **nichts** aus
- (S) Marquee über Tools bewegt kein Tool; `data.json` byte-gleich
- (S) File-Drop im Select Mode: Zelle leuchtet nicht, nichts wird erzeugt; nach `Done` funktioniert er wieder
- (S) Locked Mode: keine Bar, kein Overlay; Farben sichtbar
- (S) Tastatur: Enter auf fokussiertem Tool im Select Mode führt nichts aus
- (S) Betreten/Verlassen des Select Mode remountet nichts: offener Folder bleibt offen, Zell-Rects `worstΔ 0 px`
- (S) `selectable`: während eines Kategorie-Drags erscheint in **keiner** Vorschau eine Bar/Schicht, und das Ende des Drags beendet den Mode **nicht**; Tab-Wechsel und Einklappen beenden ihn; Folder schließen beendet ihn
- (S) Dynamische Kategorie ohne Variants: keine Select-Bar

### 15.4 Dynamic Variants (U + S)
- (U) Prädikat: Variant-Wechsel, gelöschte Variant, Make dynamic (`null` → id)
- (S) Betreten pinnt die Variant: danach Notizwechsel in Obsidian → Grid bleibt
- (S) Dropdown-Wechsel, ⇄, Duplicate, Delete → Mode endet
- (S) Farbe in Variant `Z` anwenden → alle anderen Variants byte-gleich; Fallback-Variant wie jede andere

### 15.5 Grid Resize (U + S)
- (U) `pruneToDimensions`: grow behält alles; shrink entfernt exakt den Streifen; Anchor außerhalb → `null`
- (U) `setCellColorsInState` ignoriert Keys außerhalb der aktuellen Dimensionen
- (S) Resize-Zonen im Select Mode inert, Rahmen gemountet, Zellgeometrie unverändert

### 15.6 Colors — `tests/gridCellStyles.test.ts` erweitern, `tests/gridCellColor.test.ts` neu (U)
- eine Zelle / viele Zellen / leere und belegte identisch
- clear löscht den Key; letzter Key weg → Feld `cellStyles` entfällt (Byte-Gleichheit mit ungefärbten Daten)
- bestehender Eintrag `{}` → nach apply `{ color }`; fremde Style-Felder bleiben erhalten
- ungültige Farbe (`var(--x)`, `rgb(…)`, `red`) → `state` identitätsgleich; No-op → identitätsgleich
- statisch vs. Variant; unbekannte Variant → unverändert; andere Variants/Kategorien identitätsgleich
- **I-KEY:** dynamische Kategorie + `variantId: null` → `state` identitätsgleich (**nicht** „erste Variant"); statische Kategorie + Variant-ID → identitätsgleich; dynamische Kategorie mit `variants: []` → identitätsgleich
- Registry-Identität erhalten; kein GC
- Eingabeobjekte (auch `cellStyles` der View) nicht mutiert
- Resolver: alle 8 Namen → `rgba(var(--color-<n>-rgb), …)`; Hex 3/4/6/8; unbekannter `ocap:`-Name, `undefined`, Müll → `null`
- `gridCellColorOf`: absent und `{}` → `null`
- `cellsWithColor`: Farbe X; `null` liefert alle ungefärbten inkl. `{}`-Einträgen; Vergleich auf Rohstring (`ocap:red` ≠ gleich aussehendes Hex)
- Durchreichen: `resolveGridViewForVariant`/`…ForContext` liefern die Styles des richtigen Besitzers (statisch/Variant)
- **Regression (bestehende Tests müssen unverändert grün bleiben):** Copy Category, Duplicate Variant, Make dynamic, `grid → flow`, Export/Import-Roundtrip mit per Op gesetzten Farben

### 15.7 CSS-Kontrakt — `tests/paletteGridGeometry.test.ts` erweitern (C)
- `--selected`/`--colored`-Regeln setzen weder `width/height/min-*`, `border-width`, `padding`, `margin` noch `border-color`
- **Spezifitäts-/Reihenfolge-Kontrakt (9.3):** der `--colored`-Selektor ist wörtlich `body .buttons-panel .ocap-palette-grid .ocap-grid-slot--colored`, und sein Regelindex liegt **vor** `--file-target` und `--drop-target`
- Layer ist `position: absolute` mit `z-index`; Marquee-Rahmen `pointer-events: none`; das Grid ist `position: relative`
- Harness-Vorsicht: der bestehende Test parst CSS per Regex `/([^{}]+)\{([^{}]*)\}/g` und `ruleBody` liefert die **erste** passende Regel. Neue Regeln deshalb ohne `@media`/`@supports`-Verschachtelung schreiben und Selektoren so wählen, dass die Test-Patterns eindeutig bleiben.

### 15.8 Regression bestehender Interaktionen (S, nach Phase C und E)
Move/Swap · File-Drop · slot-lokales `+` · Grid-Resize (Click und Drag) · normaler Button-Click · `No action assigned.`-Notice · Kategorie-Drag in der List-View · Kontextmenüs — jeweils **außerhalb** des Select Mode unverändert, und nach Verlassen des Modes sofort wieder funktionsfähig. Zusätzlich: Drag aus Grid B **in** das selektierende Grid A — Drop landet korrekt, Selection und Mode bleiben, `cellStyles` unverändert.

---

## 16. Recommended Implementation Phases

Jede Phase ist ein eigener, grüner, commitbarer Zustand.

| Phase | Inhalt | Sichtbar? | Tests |
|---|---|---|---|
| **A — Pure Core & Data** | `gridCellSelection.ts`, Helfer in `categoryGrid.ts`, `gridCellColor.ts`, `setCellColorsInState` | nein | 15.1, 15.2, 15.5 (U), 15.6 |
| **B — Farben rendern** | `ResolvedGridView.cellStyles`, `GridSlotCell` `color`, CSS | ja: importierte/gesetzte Farben erscheinen in allen Modi | 15.6 (Durchreichen), 15.7, kurzer Smoke |
| **C — Select Mode + Click-Selection** | Context/Provider, I-CTX, Variant-Pin, `GridSelectionLayer` (nur Click), Bar (Toggle, Zähler, Select all, Clear, Done), Prop `selectable` an fünf Call-Sites, zwei Gates, Escape, Folder-Guard, Click-Guard, i18n | ja | 15.3, 15.4, 15.8 |
| **D — Apply Color** | Swatches + No color, `useCellColorActions` | ja — **erster Consumer vollständig** | Smoke: Roundtrip, Variant-Lokalität, Copy/Duplicate |
| **E — Marquee** | `useGridMarquee`, Marquee-Rahmen, add/subtract | ja | 15.2, 15.8 erneut |
| **F — Polish (optional, einzeln)** | Pipette · Same-color · Custom Hex · Tastatur-Listbox · Kontextmenü-Einträge · Ctrl/Cmd-Click-Einstieg | ja | je Feature |

Reihenfolge-Begründung: **Farbe vor Marquee.** Auf ≤ 5×5 reichen Click + Shift-Range + Select all vollständig aus; Phase D liefert damit früh echten Nutzen, und das Marquee — das einzige Stück mit eigenem Pointer-Handling — kommt auf ein bereits benutztes, getestetes Fundament. Phase B vor C, weil sie isoliert und risikoarm ist und die Render-Lücke (2.5) schließt, von der alles Sichtbare abhängt.

---

## 17. Explicit Non-Goals

In diesem Auftrag wurde **nichts implementiert**. Ausdrücklich nicht Teil dieses Designs bzw. bewusst ausgeschlossen:

- Persistenz von Selection; `settingsVersion`-Erhöhung; Template-Format-Änderung; Änderungen an Export/Import-UX
- gespeicherte/editierbare Farbpalette; CSS-Klassen oder `var(--…)` als persistierte Werte
- Selection im Locked Mode; „Run selected"
- Selection in Flow-Kategorien; Selection von Overflow-Placements
- grid- oder variant-übergreifende Selection; Selection pro Variant aufbewahren
- Lasso, nicht-rechteckige Bereiche, Block-Move, Drag-Painting, Paint Mode
- Bounding-Box-Crop beim (künftigen) Export Selected; Slot-/Key-Translate-Helfer
- `representation`-Feld auf `ToolDefinition`; Action-Registry
- Tool Library UI, Infinite Grid, Text-/Note-Cells, Row-/Column-Reordering, Zell-Merging
- vollständiges Accessibility-Redesign (`role="grid"`)
- Deployment, Push, Eingriffe in einen produktiven Vault oder Obsidian-Prozess

---

## 18. Review-Protokoll

Ein unabhängiger read-only Subagent hat den Entwurf adversarial gegen den Code bei `4bcce33` geprüft (~45 Zeilenreferenzen stichprobenartig, dnd-kit-Quelltext in `node_modules`, alle fünf Grid-Call-Sites). Ergebnis und Konsequenzen:

**Bestätigt (unverändert übernommen):** Provider-`enabled=false` remountet den Baum; React-`stopPropagation` aus dem Overlay verhindert den Kategorie-Drag (gleicher Mechanismus wie `SlotAddButton`); das Overlay ist ein *Geschwister* der Zellen, Button-Listener sehen das Event nie; ein absolut positioniertes Kind eines Grid-Containers erzeugt keinen Track; nichts in CSS/JS hängt an der Kinderzahl oder -reihenfolge des Grids; Resize-Zonen liegen strikt außerhalb, `useGridResizeDrag` baut bei `enabled → false` ab; Click im Edit Mode führt Tools ungeschützt aus; `selectedVariantOf`-Fallback, `selectVariant`-„already shown"-Zweig, `onSelect(newId)` bei Duplicate/New; `cellStyles` per Referenz auf der View, Memo per Identität, `{}`-Einträge aus dem Parser, Spread in `exportCellStyles`; alle acht `--color-*-rgb`-Variablen sind real (`node_modules/obsidian/CHANGELOG.md`); Vitest `node` ohne jsdom. **Kein Fund zu versehentlicher Persistenz.**

**Eingearbeitete Funde:**

| Fund | Korrektur |
|---|---|
| `null` bedeutet im Domain-Layer **nicht** „statisches Grid": `resolveGridVariantId` deutet es bei dynamischen Kategorien als „erste Variant" | Invariante **I-KEY** (3.2); `setCellColorsInState` trägt den Guard selbst (9.1 Regel 1); Tests (15.6) |
| Dynamische Kategorie mit `variants: []`: Mode aktiv, Writes laufen ins Leere, Pin unmöglich | durch I-KEY ausgeschlossen (3.2, R15c) |
| Zwei übersehene Renderer (zweiter Tabs-Zweig, versteckter Stale-Folder-Overlay); Drag-Vorschau doppelt gerendert | 2.1 korrigiert |
| Schicht würde in Vorschauen/Stale-Overlay mounten; deren Unmount würde den Mode grundlos beenden | Prop `selectable` gated Bar **und** Layer; nur eine selbst selektierbare Instanz räumt auf (5.3c, 7.2) |
| Tab-Wechsel ist im Edit Mode **kein** Unmount (`display:none`) | deklarativ über `selectable → false` statt verstreuter `exit()`-Aufrufe (7.2) |
| Leere Sensorliste ändert die Länge eines `useEffect`-Dependency-Arrays in dnd-kit (dort selbst als TO-DO markiert) | **Sensor-Suspendierung ersatzlos gestrichen**; ein Cross-Grid-Drop ins selektierende Grid ist bei zell-gekeyter Selection harmlos (5.3b). `ButtonDragContext.tsx` bleibt unverändert |
| `useSensor` wird heute schon bedingt aufgerufen (latente Rules-of-Hooks-Verletzung) | als vorbestehender Nebenbefund dokumentiert (2.4) |
| `isSearchActive` ist in `CategoryButtonGrid` nicht erreichbar | nicht nötig: `sortableEnabled` ist bei aktiver Suche bereits `false` und geht in `selectable` ein (5.3c) |
| `--colored`-Spezifität nur als Prosa | konkreter Selektor + Quellreihenfolge als CSS-Kontrakt (9.3, 15.7) |
| Layer gewinnt Hit-Testing nur als letztes Kind (Button ist `position: relative`) | „nach den Zellen rendern" + `z-index` festgeschrieben (5.3a) |
| Escape-Argument stützte sich auf instabile Registrierungsreihenfolge | Begründung korrigiert; der Guard ist reihenfolge-unabhängig (5.6) |
| `aria-selected` auf rollenlosem `<div>` ist ungültig | v1 auf Live-Region + `role="group"` reduziert; Zell-Semantik erst mit der Listbox in Phase F (11.2) |
| `touch-action: none` ignoriert den bestehenden CSS-Variablen-Mechanismus | 5.3a |
| Schwellwert-Konstante ist modulprivat | `RESIZE_DRAG_THRESHOLD_PX` verwenden (5.4) |
| Mehrere Panel-Leaves nicht behandelt | Abschnitt 4 |
| CSS-Test-Harness ist fragil (Regex, erste passende Regel) | Hinweis in 15.7 |
| Overengineering: `gridSelection.ts`/Snapshot-Resolver für Consumer, die heute nichts brauchen | auf den ersten Tool-Consumer verschoben; Ops werden phasenweise gebaut (3.4, 3.5, 14.1) |
| Pfad `NavigationBarRenderer.tsx`, Zeile `planStoredGridResize` (440 statt 450), „ungenutzt" zu absolut | korrigiert |

**Bewusst nicht übernommen:** der Vorschlag, statt der Sensor-Suspendierung `useSortable({ disabled })` einzuführen — mit dem Overlay ist er gegenstandslos (aus dem selektierenden Grid kann kein Drag starten), und er würde `SortableButtonItem` ohne Not an den Selection-Context koppeln.
