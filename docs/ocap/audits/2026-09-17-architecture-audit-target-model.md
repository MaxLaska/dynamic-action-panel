# Architektur-Audit & Zielmodell-Entwurf: Tool / Placement / Grid / Persistenz

Datum: 2026-09-17 · HEAD: `702c997` · Branch `master` · Working Tree bei Audit-Beginn sauber.
Reines Audit — keine Code-, Daten- oder UI-Änderungen. Grundlage: vollständige
Lektüre der Persistenz-, Domänen- und Write-Pfade (Dateiverweise jeweils inline).

---

## 1. Executive Summary

OCAP speichert heute **ein einziges Objekt pro Tool**, das gleichzeitig
Definition (Name, Icon, Actions), Platzierung (`slot`, `order`) und
Container-Zugehörigkeit (Position im `buttons`-Array einer Category/Variant)
ist. Es gibt keine Tool-Identität außerhalb eines Grids: Entfernen aus dem Grid
= Löschen der Definition (`resizeGridButtons.removed`, `removeButtonFromGridCategory`).

Das ist für den heutigen Funktionsumfang konsistent und robust — die pure
Kernschicht (`categoryGrid.ts`, `categoryVariants.ts`) ist bereits sauber von
UI und Persistenz getrennt, es existiert eine versionierte Migrationskette
(`settingsVersion` 0→4), und praktisch alle Grid-Mutationen laufen durch
wenige pure Funktionen (`addButtonToGrid`, `removeButtonFromGridCategory`,
`replaceButtonInGridCategory`, `applySlotIdsToGridCategory`, `planGridResize`).

**Kernbefund:** Der spätere Refactor ist kleiner als befürchtet, weil diese
puren Funktionen die Choke-Points sind — wer ihre Interna auf ein
`ToolDefinition + Placement`-Modell umstellt, erfasst damit fast alle
Schreibpfade, ohne Hooks/Modals/DnD anzufassen. Was fehlt, ist:

1. eine **Tool-Registry** (`settings.tools`) mit Placements, die per `toolId`
   referenzieren — Empfehlung: **ein** Modell für Ad-hoc- und Library-Tools,
   Library-Mitgliedschaft ist nur ein Flag, Lebensdauer über deterministische
   GC beim Entfernen des letzten Placements (verhält sich ohne Flag exakt wie
   heute);
2. ein **Settings-Version-5**-Migrationsschritt (Buttons → Definition +
   Placement, Button-IDs bleiben erhalten);
3. ein **Commit-Funnel** (heute wiederholt jeder Hook find→replace→save→refresh
   und `saveSettings()` mutiert beim Sortieren);
4. ein **separates portables Exportformat** mit eigener `schemaVersion`
   (nicht das interne Settings-Schema) — fehlende Datei-Referenzen sind dank
   des bereits lazy-fehlschlagenden Runtimes (`FileService.getFileByPath` →
   Notice) **kein** neuer Zustand, sondern nur eine Import-Warnung.

Nicht gebaut werden sollten: universelles Item-System, Placement-Overrides
(Alias/Icon pro Slot), Farbvererbung, Event Bus, Template-Objekttyp.

---

## 2. Ist-Datenmodell

### 2.1 Persistenz-Root (`data.json`)

- Geladen in `main.ts` → `loadSettings()` (`src/main.ts:126`): `this.loadData()`
  → `migrateSettings(raw)` (`src/settings/settingsMigrations.ts:391`) →
  `this.settings`. Migrierte Daten werden **einmal** direkt per `saveData`
  persistiert (bewusst nicht `saveSettings`, keine Render-Seiteneffekte).
- Gespeichert in `saveSettings()` (`src/main.ts:147`): sortiert vorher
  `categories` und jedes `category.buttons` **in place** nach `order`
  (Mutation des Settings-Objekts!), dann `saveData` + `updatePanels()`.
- Root-Typ: `ButtonsPanelPluginSettings` (`src/types/settings.ts:279`):
  `{ settingsVersion, categories, panelConfig, pathConfig }`.
- `panelConfig` enthält u. a. `interactionMode: 'locked' | 'edit'`;
  `pathConfig` `templateFolderPath`/`scriptFolderPath`.

### 2.2 Category (`CategoryConfig`, `src/types/settings.ts:165`)

`{ id, name, order, buttons, variants?, conditions?, layout?, rows?, columns? }`

- `layout` fehlt/`'flow'` = historisches Flow-Verhalten (Reihenfolge über
  `order`); `'grid'` = Slot-Palette.
- **Statisches Grid**: ein volles Grid in `category.buttons`, Größe auf der
  Category (`rows`/`columns`, fehlend = Legacy 4×4, `LEGACY_GRID_DIMENSIONS`
  in `src/utils/categoryGrid.ts:55`).
- **Dynamische Category**: `variants` vorhanden, `buttons` leer; die Category
  trägt selbst **keine** Größe.
- `conditions` = Sichtbarkeit der ganzen Category (unabhängig vom
  Variant-Mechanismus).

### 2.3 Variant (`CategoryVariant`, `src/types/settings.ts:133`)

`{ id, name, trigger?, fallback?, rows?, columns?, buttons }`

- Vollständig unabhängiges Grid inkl. eigener Größe und eigener Button-IDs;
  bewusst redundant, nichts geteilt.
- Runtime-Auflösung: `resolveDynamicCategoryVariant`
  (`src/utils/categoryVariants.ts:180`) — erste passende Triggered-Variant
  (Array-Reihenfolge = Priorität), sonst Fallback, sonst `none`. Fehlender
  oder invalider Trigger matcht nie (bewusst nicht fail-open).
- Ops (alle pur, `categoryVariants.ts`): `addVariant` (erbt aktuelle
  Grid-Größe), `updateVariant`, `removeVariant`, `duplicateVariant` (neue
  Variant- **und** Button-IDs, tiefe Action-Kopien, Größe kopiert),
  `moveVariant` (Fallback nicht beweglich).

### 2.4 Button / Tool (`ButtonConfig`, `src/types/settings.ts:48`)

`{ id, name, icon?, actions, order, customCss?, executionMode?, stopOnError?, delayBetweenActions?, conditions?, slot? }`

- **`icon` ist gespeichertes SVG-Markup** (nicht eine Icon-ID): der Icon-Picker
  und der File-Drop schreiben `getIcon(id)?.outerHTML`
  (`src/hooks/useSlotFileDrop.ts:68`).
- `actions: ButtonAction[]` (`src/types/action.ts:59`) — 5 Typen:
  `file {filePath}`, `command {commandId, args?}`, `url {url}`,
  `create_file {folderPath?, fileName, templateName?}`, `script {scriptName}`.
  Vault-Pfade liegen **inline in den Parametern**. `actions: []` ist ein
  legitimer Zustand (Klick → Notice `button_no_action`,
  `src/hooks/useButtonActions.ts:28`).
- `conditions` ist in Grid-Categories **inertes Legacy-Feld** (nur Flow wertet
  es aus, `panelProjection.ts`).
- `customCss` ist ein bereits existierendes Presentation-Feld auf dem Button
  (Upstream-Erbe).

### 2.5 Slot / Position

- Der Slot liegt **auf dem Button** (`ButtonConfig.slot`), row-major
  (`slot = row * columns + column`). Ein Loch ist „kein Button beansprucht
  Slot i".
- `order` existiert **parallel** und wird in Grids überall mitnormalisiert
  (z. B. `resizeGridButtons`, `applySlotIdsToGridCategory`,
  `addButtonToGrid`); es dient dort nur noch als deterministischer Tiebreaker
  für die Selbstheilung (`placeButtonsOnGrid`, `src/utils/categoryGrid.ts:354`:
  fehlende/doppelte/blockierte Slots → niedrigster freier Slot in
  `order`-Folge, nie Datenverlust) und als Sortierschlüssel im mutierenden
  `saveSettings()`-Sort. **Zwei Wahrheiten pro Grid-Button.**
- Umrechnung flach ↔ Zeile/Spalte ausschließlich in `categoryGrid.ts`
  (`slotRow`/`slotColumn`/`slotAt`/`remapSlot`).

### 2.6 IDs heute

Sechs ad-hoc Generatoren, alle Zeitstempel-basiert:

| Stelle | Format | Kollisionsrisiko |
|---|---|---|
| `buttonFactory.ts:11` / `ButtonCreateModal.ts:68` | `Date.now() + random(7)` | gering |
| `useButtonOperations.copyButton:44` | **nur `Date.now().toString()`** | real (2 Kopien in derselben ms) |
| `useCategoryCreation.ts:37` | nur `Date.now().toString()` | gering (eine Category pro Modal) |
| `categoryStore.freshId():42` | `Date.now(36)-counter-random` | praktisch null |
| `useVariantOperations.newId():20` | `prefix-Date.now(36)-random` | gering |
| `categoryMenuUtils.ts:35` | `var-Date.now(36)-random` | gering |

Globale Eindeutigkeit der Button-IDs wird implizit vorausgesetzt
(`collectButtonsById`, `src/utils/buttonDragItems.ts:217`, eine flache Map über
alle Categories und Variants). Migrationen sichern das über abgeleitete IDs
(`<variantId>--<buttonId>`).

### 2.7 Versionierung / Migration heute

`CURRENT_SETTINGS_VERSION = 4`; forward-only Kette 0→1→2→3→4 in
`settingsMigrations.ts` (pur, deterministisch, mutationsfrei, getestet in
`tests/settingsMigrations.test.ts`). Unbekannte **Zukunfts**-Versionen werden
best-effort geladen, nie heruntergeschrieben. `normalizeSettings` deep-merged
nested Defaults und normalisiert `interactionMode` in-memory.
**Abwärtskompatibilität durch fehlende Felder** ist das tragende Muster:
fehlende `rows`/`columns` = 4×4, fehlendes `layout` = flow, fehlende
`conditions` = sichtbar.

---

## 3. Ist-Datenflüsse (Write-Pfade konkret)

Alle Schreibpfade folgen demselben Muster: **stored Category per id auflösen**
(`findStoredCategory`, weil gerenderte Objekte Projektionskopien sein können)
→ pure Funktion → `replaceStoredCategory` (Index-Mutation des
`categories`-Arrays, `src/utils/categoryStore.ts:27`) → `plugin.saveSettings()`
→ `refresh()` bzw. `buttons-panel-refresh`-Event.

| Fluss | Einstieg | Pure Kernfunktion | Persistenz |
|---|---|---|---|
| Create (globales Modal & Slot-`+`) | `useButtonCreation` → `ButtonCreateModal.saveButton` (`:254`) | `addButtonToGrid(stored, targetVariantId, tempButton, targetSlot)` | Modal selbst |
| Edit | `ButtonEditModal.saveButton` (`:252`) | `replaceButtonInGridCategory` | Modal selbst |
| Copy Button | `useButtonOperations.copyButton` | `addButtonToGrid` (gleiche Variant) | Hook |
| Delete Button | `useButtonOperations.deleteButton` → `ButtonDeleteModal` | `removeButtonFromGridCategory` | Hook |
| File-Drop | `useSlotFileDrop.dropFileOnSlot` | `buildVaultFileButtonDraft` (pur) + `addButtonToGrid(…, slot)` | Hook |
| DnD Move/Swap | `ButtonDragContext.persistItems` (`:525`) | `applySlotIdsToGridCategory` pro Category; Flow: manueller Rewrite | ersetzt `settings.categories` als neues Array, dann `saveSettings` |
| Category-Reihenfolge | `persistCategoryOrder` (`:591`) | — (mutiert `cat.order` in place) | dito |
| Resize (Klick & Drag) | `useGridResize.resizeGridTo` (`:104`) | `planGridResize` (Plan!), Re-Plan nach async Confirm | Hook; **`removed` wird endgültig gelöscht** |
| Variant-Ops | `useVariantOperations.replaceCategory` (`:36`) | add/update/move/duplicate/removeVariant | Hook (Index-Mutation) |
| Make dynamic | `categoryMenuUtils.openMakeDynamicModal` | `convertStaticGridToDynamic` (Größe wandert zur Variant) | Util |
| Category Copy | `categoryMenuUtils` | `duplicateCategoryConfig` (frische IDs, alle Variants) | Util |
| Layout-Wechsel | `CategoryEditModal` (`:368`) | `applyCategoryLayout` → `convertCategoryToGrid` / `convertStaticGridToFlow`; dynamic→flow verweigert | Modal |
| Panel-/Pfad-Settings | `ButtonsPanelSettingTab`, `NavigationBarRenderer` | — (direkte Feldmutation) | dort |

Renderpfad (read-only): `projectCategoriesForContext`
(`src/context/panelProjection.ts:176`) → `gridViews`
(`ResolvedGridView { variantId, reason, dimensions, slots, overflow }`) → an
Rendering **und** DnD; `effectiveGridButtons` materialisiert Slots zurück in
ButtonConfig-Listen. Runtime-Ausführung: `useButtonActions` → Notice bei
`actions: []` → `ActionDispatcher` → Services; `FileService.getFileByPath`
(`src/services/FileService.ts:61`) zeigt bei fehlender Datei eine Notice —
**tote Referenzen sind heute schon ein harmloser Lazy-Runtime-Fehler, kein
invalider Zustand.**

Import-artige Hilfsfunktionen existieren nicht; die einzigen
„Serialisierungs"-Bausteine sind die Migrationskette und
`duplicateCategoryConfig`.

---

## 4. Problematische Kopplungen (Feature → heutige Kopplung → Konsequenz)

1. **Library / wiederverwendbares Tool.** Ein Tool existiert nur als Element
   von `category.buttons` bzw. `variant.buttons`; Definition = Placement =
   ein Objekt. Es gibt keinen Ort für ein unplatziertes Tool.
   → Ohne Strukturänderung müsste eine Library Kopien halten (Divergenz) oder
   Buttons in-place markieren (kein „aus Grid entfernen, Tool behalten").
   Betroffen: `types/settings.ts`, alle Funktionen aus §3.

2. **Löschen einer Row/Column ≠ Löschen der Definition.** `planGridResize`
   liefert `removed`; der Commit in `useGridResize` verwirft sie endgültig,
   `GridResizeConfirmModal` formuliert „will be deleted". HANDOFF.md nennt
   genau diese Modal als die Stelle, die sich mit einer Library ändert.
   → Heute ist „vom Grid nehmen" untrennbar „vernichten".

3. **Tool in mehreren Grids.** `copyButton`/`duplicateVariant`/
   `duplicateCategoryConfig` erzeugen stets tiefe Kopien mit neuen IDs. Zwei
   Vorkommen desselben Tools sind zwei fremde Objekte; eine Korrektur (z. B.
   Pfad geändert) muss n-fach nachgezogen werden. Für Variants ist die
   Redundanz **bewusst** (DECISIONS) — für eine künftige Library ist sie es
   nicht.

4. **Placement-Farbe.** Es gibt keine Placement-Entität; das einzige
   persistente Objekt am Slot ist der Button selbst. Eine Slot-Farbe müsste
   heute auf `ButtonConfig` landen — und würde beim Verschieben mitwandern
   statt beim Slot/Placement zu bleiben, bzw. bei einem Library-Tool alle
   Vorkommen färben. Falsche Ebene ohne neue Struktur.

5. **Variant-/Category-Accent.** Kein Feld vorhanden — aber hier ist das
   Modell schon richtig geschnitten: `CategoryConfig`/`CategoryVariant` sind
   die korrekten Träger; rein additiv lösbar (§8).

6. **Export.** (a) Kein portables Schema, nur das interne Settings-Objekt
   inkl. `panelConfig`/`pathConfig`. (b) `icon` als volles SVG bläht Pakete
   auf, ist aber immerhin selbst-enthalten (kein Icon-Resolver nötig — eher
   Vorteil als Problem). (c) Vault-Pfade inline in Action-Parametern — für
   Export okay, aber nirgends als „externe Referenz" ausgezeichnet, ein
   Exporter muss Action-Typ-Wissen haben, um sie aufzulisten.

7. **Import.** (a) IDs sind nur vault-lokal eindeutig; `collectButtonsById`
   setzt globale Eindeutigkeit voraus — kollidierende importierte IDs würden
   DnD und Edit korrumpieren. (b) Kein Einfüge-Pfad außer den puren
   Add-Funktionen (die aber wiederverwendbar sind — gut). (c) Fehlende Dateien:
   kein Problem im Modell (Lazy-Fail existiert, s. §3), nur Validierung fehlt.

8. **Ad-hoc-Item vs. Library-Müll.** Da jedes Tool sofort ein vollwertiger
   persistierter Button ist, gäbe es bei „Library = alle Tools" sofort
   Zumüllung durch File-Drops. Das Modell kennt keine
   Sichtbarkeits-/Lebensdauer-Unterscheidung.

9. **Verstreute Writes + mutierendes `saveSettings`.** ~12 Stellen mutieren
   `plugin.settings` direkt (§3); `saveSettings()` sortiert in place. Jede
   neue Invariante (Registry-Konsistenz, GC, Referenzzählung) müsste an allen
   Stellen einzeln durchgesetzt werden. Außerdem: `persistCategoryOrder`
   mutiert `order` auf den **bestehenden** Objekten — ein Bruch der
   Immutable-per-edit-Konvention, der bei Memo-Vergleichen nur zufällig nicht
   auffällt.

10. **Batch-/Workspace-Items (langfristig).** `ResolvedGridView.slots` ist
    `(ButtonConfig | null)[]`, `GridSlotCell` rendert genau ButtonItems. Ein
    anderer Inhaltstyp bräuchte heute einen Fake-Button. Kein akutes Problem —
    aber ein Grund, Placements nicht hart als „ButtonConfig-Referenz" zu
    verdrahten, sondern per `toolId`-Indirektion (die spätere Erweiterung um
    einen `kind`-Diskriminator ist dann additiv).

11. **`order`/`slot`-Doppelwahrheit** (§2.5). Jede Schreiboperation muss beide
    pflegen; ein künftiges Placement-Modell sollte in Grids nur noch `slot`
    kennen.

---

## 5. Zielmodell

### 5.1 Optionen für Ad-hoc vs. Library

**Option A — Inline-Definition im Placement.** Placement enthält entweder
`toolId` (Library) oder eine eingebettete Definition (ad-hoc).
✓ Ad-hoc bleibt strukturell „wie heute". ✗ Zwei Placement-Arten in jedem
Codepfad (DnD, Edit, Export, Suche); „promoten" ist eine Strukturtransformation;
Cross-Grid-Move eines Ad-hoc-Tools muss die Definition umziehen.

**Option B — Eine Registry für alles (empfohlen).** Jedes Tool ist eine
`ToolDefinition` in `settings.tools`; jedes Placement referenziert per
`toolId`. Library-Mitgliedschaft ist **nur ein Metadatum** (`library: true`).
Lebensdauer: Definition ohne `library`-Flag wird beim Entfernen ihres letzten
Placements gelöscht (deterministische GC im Remove-Pfad — exakt heutige UX).
✓ Ein Modell, null Sonderfälle in DnD/Edit/Export; „promoten" = ein Flag;
Mehrfach-Placement fällt gratis ab. ✗ Eine Indirektion beim Lesen (Projektion
muss `toolId` auflösen); Migration muss alle Buttons zerlegen.

**Option C — Library als separater Kopie-Store.** Bestehendes Modell bleibt;
Library ist eine eigene Liste von Tool-Snapshots („ins Grid stellen" = Kopie).
✓ Kleinste Migration (keine). ✗ Zwei divergierende Repräsentationen desselben
Tools; „Tool in mehreren Grids" bleibt Kopie-Semantik; Export/Placement-Farbe
lösen es nicht; das eigentliche Kopplungsproblem (§4.1–4.4) bleibt bestehen.

**Empfehlung: B.** Sie ist die kleinste Struktur, die *alle* Anforderungen
A–D des Auftrags trägt, und sie minimiert Sonderfälle: Ad-hoc und Library
unterscheiden sich in genau einem Bit, nicht in der Struktur. Der scheinbare
Mehraufwand (Registry-Auflösung) landet an genau einer Stelle — der Projektion.

### 5.2 Konkrete Zielstruktur (TypeScript-nah)

~~~ts
// --- Definition -------------------------------------------------------------
interface ToolDefinition {
    id: string;                       // global eindeutig im Vault
    name: string;
    icon?: string;                    // weiterhin SVG-Markup (kein Umbau)
    actions: ButtonAction[];          // unverändert, [] erlaubt
    executionMode?: 'sequential' | 'parallel';
    stopOnError?: boolean;
    delayBetweenActions?: number;
    customCss?: string;               // Legacy, wandert mit
    conditions?: ButtonCondition;     // nur Flow-relevant, inert in Grids (wie heute)
    library?: boolean;                // true = in der Library sichtbar UND vor GC geschützt
}

// --- Placement ---------------------------------------------------------------
interface Placement {
    toolId: string;
    slot: number;                     // Grid: row-major Index. KEIN order mehr.
    // später additiv: color?: string  (Placement-Präsentation, §7)
}

// --- Grid / Category / Variant ----------------------------------------------
interface GridDimensionFields { rows?: number; columns?: number; }  // fehlend = Legacy 4×4

interface CategoryVariant extends GridDimensionFields {
    id: string;
    name: string;
    trigger?: ButtonCondition;
    fallback?: boolean;
    placements: Placement[];          // ersetzt buttons
    // später additiv: accent?: string
}

interface CategoryConfig extends GridDimensionFields {
    id: string;
    name: string;
    order: number;
    layout?: 'flow' | 'grid';
    conditions?: ButtonCondition;
    placements?: Placement[];         // statisches Grid; Flow: Array-Reihenfolge = Ordnung, slot entfällt
    variants?: CategoryVariant[];
    // später additiv: accent?: string
}

// --- Root ---------------------------------------------------------------------
interface OcapSettings {
    settingsVersion: 5;
    tools: Record<string, ToolDefinition>;   // Registry; Key = ToolDefinition.id
    categories: CategoryConfig[];
    panelConfig: PanelConfig;
    pathConfig: PathConfig;
}
~~~

Bewusste Entscheidungen darin:

- **`tools` als Record, nicht Array**: O(1)-Auflösung in der Projektion,
  Eindeutigkeit strukturell erzwungen, keine „order" einer Registry, die
  niemand sieht. (JSON-serialisierbar, diff-freundlich.)
- **Placement ohne eigene ID** (§6): `(containerId, slot)` identifiziert es
  vollständig.
- **Flow-Categories nutzen dasselbe `Placement`** (ohne `slot`; Reihenfolge =
  Array-Reihenfolge). Damit gibt es genau ein Speicher- und Exportmodell und
  Flow-Tools sind library-fähig; die Flow-*Semantik* (per-Button-Conditions,
  Reflow) bleibt unangetastet. Alternative — Flow unmigriert lassen — ist die
  einzige echte Verkleinerungsoption (§17, F4).
- **`order` entfällt auf Grid-Placements.** Selbstheilung doppelter/fehlender
  Slots (heute `placeButtonsOnGrid` mit `order` als Tiebreaker) nutzt künftig
  die Array-Reihenfolge der Placements als Tiebreaker — gleiche Determinik,
  eine Wahrheit weniger. Das mutierende Sortieren in `saveSettings()` entfällt
  für Grids ersatzlos.
- **Kein `kind`-Diskriminator jetzt.** Die `toolId`-Indirektion ist bereits
  der Erweiterungspunkt für spätere Workspace-Items; ein optionales
  Diskriminator-Feld wäre dann rein additiv.

---

## 6. Identity-Modell

| Entität | Stabile ID? | Begründung |
|---|---|---|
| **Tool** | **ja** | Wird von Placements (mehrfach), Export-Paketen und der Library referenziert. Entsteht bei Create/Drop/Copy/Import. |
| **Category** | ja (existiert) | Referenziert von Variant-Selection, `categoryOpenState`, DnD-Container-IDs. |
| **Variant** | ja (existiert) | Referenziert von Selection, DnD-Write-back, Trigger-Verwaltung. |
| **Placement** | **nein** | Vollständig identifiziert durch `(Container, slot)`; ein Slot hält höchstens ein Placement. Eine eigene ID wäre eine dritte Identität ohne Konsumenten — Slot-Hotkeys binden ausdrücklich an den Slot (HANDOFF §6.1). |
| **Grid** | nein | 1:1 mit seinem Owner (Category oder Variant); dessen ID genügt. |
| **Action** | nein | Positionsidentität innerhalb `actions[]` genügt; niemand referenziert eine Action von außen. |
| **Export-Paket** | nein (persistent) | Paket-Metadaten (`exportedAt`, Name) reichen; eine Paket-ID hätte keinen Konsumenten, solange es keine Update-/Marketplace-Semantik gibt — die ist ausgeschlossen (§15). |

**ID-Entstehung und -Erzeugung:** genau ein zentraler Generator (das Muster
von `categoryStore.freshId()`: `Date.now(36)-counter-random`), verwendet von
allen Create/Copy/Duplicate-Pfaden. Behebt nebenbei die reale Kollisionslücke
in `useButtonOperations.copyButton` (nur `Date.now().toString()`).

**Copy/Duplicate:** erzeugen neue Tool-IDs (Kopie = neues Tool) — heutige
Semantik. `duplicateVariant` kopiert Placements **und** die referenzierten
Definitionen (siehe Entscheidung F2, §17); `duplicateCategoryConfig` analog.

**Import-Konflikte:** Import **remappt grundsätzlich alle IDs** auf frische
(Tool-, Variant-, Category-IDs; Placement-Referenzen innerhalb des Pakets
werden mitgeschrieben). Damit existiert die Konfliktklasse nicht; eine
„gleiches Tool wiedererkennen"-Semantik (Content-Hash o. ä.) wird bewusst
nicht gebaut.

---

## 7. Ownership & Lifecycle / Tool vs. Placement

### 7.1 Lifecycle-Regeln (klein, deterministisch)

**Ad-hoc (Slot-`+`, File-Drop):**
1. Create erzeugt `ToolDefinition` (ohne `library`-Flag) **und** ein Placement
   in genau dem Ziel-Slot — ein Commit.
2. Die Definition „gehört" faktisch ihrem einzigen Placement.
3. Entfernen des Placements (Delete-Menü, bestätigter Resize-Cut): wenn
   `library !== true` **und** kein weiteres Placement existiert → Definition
   wird im selben Commit gelöscht. **Exakt heutige UX, keine Karteileichen,
   keine Library-Zumüllung.**
4. GC läuft **nur** in expliziten Remove-Operationen — niemals implizit in
   `applySlotIds`-Rewrites oder Projektionsläufen (ein Cross-Category-Drag
   entfernt und platziert im selben Commit; dazwischen darf nichts sammeln).
   Kein Hintergrund-Job, kein Referenzzähler-Feld: die Placement-Zählung wird
   bei Bedarf live ermittelt (Datenmenge trivial).

**Shared / Reusable:**
1. „Behalten": `library: true` setzen — reine Metadaten-Änderung, keine Kopie,
   keine Umstrukturierung. (UI dafür kommt später; das Modell muss es nur
   können.)
2. Ein Library-Tool überlebt das Entfernen seines letzten Placements
   (unplatziert, nur in der Library sichtbar).
3. Mehrfach-Placement desselben Tools: erlaubt; **Edit wirkt auf alle
   Vorkommen** — das ist der Sinn eines geteilten Tools, nicht ein Bug.
4. „Tool löschen" (aus der Library) = Definition + alle Placements entfernen,
   mit Bestätigung, die die betroffenen Grids nennt (Analogie zur heutigen
   Resize-Confirm).

### 7.2 Property-Zuordnung

**Tool:** `name`, `icon`, `actions` (inkl. Pfade/Scripts), `executionMode`/
`stopOnError`/`delay`, `customCss`, `conditions` (Flow), `library`.
**Placement:** `slot`, später `color`. Sonst nichts.

**Grenzfälle, bewusst entschieden:**

- **Name/Icon pro Placement überschreibbar?** Nein (v1). Kosten: Suche,
  Export, Library-Anzeige, Edit-Modal und Tooltips müssten überall
  „effektiver Name = override ?? tool.name" rechnen; Nutzen ist spekulativ.
  Für Ad-hoc-Tools (1 Placement) ist „im Grid umbenennen" ohnehin identisch
  mit „Tool umbenennen" — die heutige UX bleibt also vollständig erhalten.
  Falls der Bedarf real wird: optionale Override-Felder auf `Placement` sind
  später rein additiv.
- **Größe pro Placement?** Nein — Slots sind uniform; es gibt kein
  Spanning-Konzept und keines ist geplant.
- **Farbe:** Placement (§4.4). Row/Column-Coloring ist dann nur ein
  Bulk-Edit über mehrere Placements — keine Vererbung im Modell.

---

## 8. Category-/Variant-Accent

- `CategoryConfig.accent?: string` (Default für alle Variants und das
  statische Grid) und `CategoryVariant.accent?: string` (Override).
- Auflösung `variant.accent ?? category.accent ?? none` an genau einer
  Stelle: der Projektion — `ResolvedGridView` bekommt ein optionales
  `accent`-Feld, Renderer konsumieren nur das (dieselbe Disziplin wie
  `dimensions`).
- Wertformat: benannte Preset-Keys (z. B. `'red' | 'yellow' | …`) statt freier
  Hex-Werte — theme-fest via CSS-Variablen, exportstabil, triviale Validierung.
- Rein additive optionale Felder; für sich genommen kein Version-Bump nötig,
  praktisch aber Teil von v5.

---

## 9. Export-/Import-Fundament (nur Grundlage, kein Feature-Design)

**Internes vs. portables Schema: getrennt.** Begründung: (a) das interne
Schema enthält Nicht-Portables (`panelConfig`, `pathConfig`, `order` der
Categories); (b) es evolviert per interner Migrationskette — ein Exportformat
muss langsamer und dokumentiert altern; (c) ein Paket muss selbst-enthalten
sein (alle referenzierten Tools eingebettet), was im internen Schema kein
Begriff ist. Der Import ist ein Adapter „Paket → aktuelle interne Ops", nie
ein Byte-Copy. Das interne Schema *wiederzuverwenden* würde jede interne
Umbenennung zum Breaking Change aller je exportierten Dateien machen.

Skizze (`*.ocap.json` als Arbeitstitel ist okay — ein Format, `kind`
unterscheidet den Inhalt; keine getrennten Dateiformate pro Ebene):

~~~ts
interface OcapPackage {
    format: 'ocap-package';        // Selbstidentifikation beim Öffnen fremder JSON
    schemaVersion: 1;              // EIGENE Versionslinie, unabhängig von settingsVersion
    exportedAt: string;            // ISO
    kind: 'tool' | 'grid' | 'category';
    tools: ToolDefinition[];       // ALLE referenzierten Definitionen, self-contained
    payload:
        | { kind: 'tool'; toolId: string }
        | { kind: 'grid'; rows?: number; columns?: number; placements: Placement[] }
        | { kind: 'category'; category: PortableCategory /* inkl. variants+accent, ohne order */ };
}
~~~

- **Referenzen:** Placements → `toolId`, gültig nur paketintern; beim Import
  werden alle IDs remappt (§6). „Template" ist kein eigener Objekttyp — ein
  Template **ist** ein Paket.
- **Fehlende Dateien:** Action-Parameter tragen die Vault-Pfade unverändert;
  der Import validiert Pfade **nicht als Vorbedingung**. Kein persistenter
  „unresolved"-Zustand nötig: das Runtime scheitert bereits heute lazy und
  benutzerfreundlich (`FileService` → Notice `file_not_found`;
  `ScriptService` analog). Kleinste Lösung: eine nicht-blockierende
  Import-Zusammenfassung („2 referenzierte Dateien existieren hier nicht"),
  danach normale Nutzung — Name/Icon/übrige Actions funktionieren, der Pfad
  ist im Edit-Modal ersetzbar. Ein optionaler visueller „Referenz tot"-Marker
  wäre später eine reine Projektion-Ableitung (live gegen den Vault geprüft,
  nie gespeichert).
- **`library`-Flag im Import:** wird übernommen wie exportiert; ein als Paket
  importiertes Grid schützt seine Tools nicht automatisch (gleiche
  GC-Semantik wie lokal erzeugte).

---

## 10. Schema-Versionierung & Migration

- Vorhanden und tragfähig: `settingsVersion`-Kette, `MigrationStep`-Registry,
  Future-Schutz, Einmal-Persistierung nach Migration (§2.7). **Der Refactor
  ist ein regulärer Schritt v4→v5 in exakt dieser Infrastruktur** — zentrale
  Stelle bleibt `settingsMigrations.ts`, kein zweiter Mechanismus.

**`migrateV4toV5` konkret:**

1. `tools: {}` anlegen.
2. Pro Grid-Category / pro Variant: Buttons zunächst mit
   `placeButtonsOnGrid(buttons, readGridDimensions(owner))` materialisieren
   (dasselbe Muster wie v1→v2, `settingsMigrations.ts:185` — fehlende/doppelte
   Slots heilen dadurch **identisch** zur heutigen Render-Selbstheilung,
   nichts verrutscht; Overflow-Buttons werden als Placements hinter den
   letzten Slot gelegt bzw. behalten ihren gespeicherten Zustand analog der
   heutigen Overflow-Behandlung).
3. Jeder `ButtonConfig` wird zerlegt: Definitionsfelder → `tools[button.id]`
   (**ID bleibt erhalten** — keine Referenz bricht, Tests/Fixtures bleiben
   lesbar), `slot` → `Placement { toolId: id, slot }`. `order` entfällt.
4. Doppelte Button-IDs über den ganzen Vault (nur in hand-editierten Daten
   möglich): zweites Vorkommen bekommt eine frische ID — Registry-Keys müssen
   eindeutig sein; heute wäre so ein Zustand ohnehin still fehlerhaft
   (`collectButtonsById` überschreibt).
5. Flow-Categories: gleiche Zerlegung, Placements in `order`-Reihenfolge ohne
   `slot` (falls Entscheidung F4 = migrieren).
6. `rows`/`columns` werden **unverändert kopiert bzw. weggelassen** — die
   Legacy-4×4-Semantik über fehlende Felder bleibt exakt bestehen, ebenso
   `layout`-fehlend = flow.
7. `library` wird **nicht** gesetzt (alle migrierten Tools verhalten sich wie
   heute: Placement weg → Tool weg).
8. Statische Grids: `buttons` → `placements` auf der Category; dynamische:
   pro Variant; `category.buttons` (leer) entfällt.

Damit sind alle geforderten Bestände abgedeckt: Static/Dynamic Categories,
Variants, Fallback (Flag unverändert), Trigger (unverändert), Dimensionen
(Feld-für-Feld), Buttons/Actions (Definition unverändert), Slots (materialisiert
= exakt das, was der Nutzer sah). Migration pur + Fixture-Tests
(reale `data.json`-Kopien aus dem Test-Vault) + Idempotenz über die Kette;
Datenverlust ist strukturell ausgeschlossen, weil jeder Button in genau eine
Definition + ein Placement zerfällt.

---

## 11. Runtime-/Write-APIs

Kein Service-Layer im Enterprise-Sinn. Zwei gezielte Zentralisierungen:

1. **Commit-Funnel** (Ausbau von `categoryStore.ts`):
   `commitCategoryChange(plugin, nextCategory)` und
   `commitSettingsChange(plugin, mutate)` — kapseln
   find→replace→save→refresh, die heute in ~12 Stellen dupliziert sind.
   Gleichzeitig: `saveSettings()` verliert sein in-place-Sortieren
   (Normalisierung passiert, wo geschrieben wird); `persistCategoryOrder`
   hört auf, bestehende Objekte zu mutieren.

2. **Fachliche Operationen als pure Planner + dünner Commit** — das Muster von
   `planGridResize` ist bereits das richtige und wird zur Norm:

   | Operation | Status |
   |---|---|
   | `createTool(draft, target)` | neu (kapselt Registry-Insert + Placement; ersetzt die Interna von `addButtonToGrid`-Aufrufern) |
   | `placeTool(toolId, target)` | neu (Library→Grid; von `createTool` mitbenutzt) |
   | `removePlacement(target)` | neu — **die eine Stelle mit GC-Regel** |
   | `deleteTool(toolId)` | neu (Definition + alle Placements) |
   | `updateTool(tool)` | ersetzt `replaceButtonInGridCategory`-Interna |
   | `applyDrag(slotIds, …)` | existiert (`applySlotIdsToGridCategory`), Interna auf Placements umgestellt; **ohne GC** |
   | `resizeGrid` | existiert (`planGridResize` + `resizeGridTo`); Cut-Streifen ruft `removePlacement`-Semantik |
   | `resolveVariant` / Projektion | existiert, unverändert; löst zusätzlich `toolId → ToolDefinition` auf |
   | Variant-Ops | existieren pur, Interna umgestellt |
   | `serializeExport` / `importPackage` | später, als pures Modul (§12) |

   Nicht zentralisiert werden: reine Panel-/Pfad-Settings-Writes
   (SettingTab, NavigationBar) — dort gibt es keine Invarianten zu schützen;
   nur der Commit-Funnel wird mitbenutzt.

Ziel erfüllt: neue Features (Library-UI, Export) docken an
`placeTool`/`removePlacement`/`deleteTool` an, statt Arrays zu kennen.

---

## 12. Modulgrenzen

Die bestehende Organisation ist im Kern richtig (pure Domäne in `utils/`,
Verdrahtung in `hooks/`, UI in `components/`). Nur drei Schnitte mit
nachweisbarem Nutzen:

1. **`src/domain/tools.ts` (neu):** `ToolDefinition`-Typ, Registry-Helfer,
   `placeTool`/`removePlacement`/`deleteTool`-Planner, GC-Regel. Begründung:
   diese Logik existiert heute nirgends und darf nicht über Hooks verstreut
   entstehen — der Fehler, den §4.9 für die alte Welt beschreibt.
   (`categoryGrid.ts`/`categoryVariants.ts` bleiben wo und was sie sind; ein
   Verschieben nach `domain/` wäre reine Ästhetik.)
2. **`categoryStore.ts` wird der Commit-Funnel** (§11.1) — er ist heute schon
   die Brücke Rendering↔Persistenz, bekommt aber die Save/Refresh-Hälfte dazu.
3. **`src/export/` (erst mit dem Feature):** pures Paket-Serialisieren/-Parsen
   + ID-Remap, Obsidian-frei und direkt testbar (dasselbe Muster wie
   `vaultFileButton.ts`).

Ausdrücklich **nicht**: `persistence/`-Abstraktionsschicht über `loadData`/
`saveData` (Obsidians API ist die Schnittstelle), Repository-Pattern,
Event-Bus, Aufteilen von `types/settings.ts` in fünf Dateien.

---

## 13. Kompatibilitäts-Invarianten → Regression-Checkliste

Nach dem Refactor (Phase A–C, vor jeder Library-UI) muss gelten — Prüfweg in
Klammern (T = bestehende Testdatei, L = Live-Smoke im Scratch-Vault nach dem
Muster aus HANDOFF §5):

1. Bestehende `data.json` (v0–v4) lädt verlustfrei; alle Buttons auf ihren
   Slots, Namen/Icons/Actions identisch (T: `settingsMigrations.test.ts` +
   neue v4→v5-Fixtures; L: Legacy-Fixture ohne `rows`/`columns` rendert 4×4).
2. Static Categories rendern ihr Grid unverändert (T: `variableGrid.test.ts`).
3. Dynamic: erste passende Variant gewinnt, Fallback greift, nichts matcht →
   Category versteckt; invalider Trigger matcht nie (T:
   `categoryVariants.test.ts`, `gridVisibility.test.ts`).
4. Locked/Edit-Toggle; `sort`-Altdaten → `edit` (T: Migrationstests).
5. Gridgrößen 1×1–5×5; Legacy-fehlend = 4×4; neue Grids 1×3; Variant-Größen
   unabhängig (T: `variableGrid.test.ts`; L: Resize-Durchlauf).
6. Resize koordinatenstabil (`remapSlot`-Semantik), Klick + Drag über
   `resizeGridTo`, eine Confirmation pro Geste, Cancel byte-gleich
   (T: `categoryGrid.test.ts`, `gridResizeDrag.test.ts`; L).
7. Slot-`+` erzeugt im gezeigten Slot der gezeigten Variant; volles Grid ohne
   `+` (T: `slotButtonCreation.test.ts`; L).
8. Tool ohne Action speicherbar; Klick → `No action assigned.`; halb gefüllte
   Action-Zeile blockiert Save (T: `slotButtonCreation.test.ts`; L).
9. File-Drop: Datei → `file`-Tool mit exaktem Pfad, `.js` im Script-Ordner →
   `script`, `.js` außerhalb → `file` + Hinweis; belegte Zelle akzeptiert kein
   `dragover` (T: Tests zu `vaultFileButton`; L).
10. Open File / Run Script ausführbar; fehlende Datei → Notice (L).
11. Move/Swap im Grid, Cross-Category-Drag, Flow-Sortierung; nur die editierte
    Variant wird beschrieben (T: `gridDragItems`, `variantGridDnd`,
    `variantDrag`, `gridDragSourceStability`; L).
12. Copy Button bleibt in seiner Variant; Category Copy kopiert alle Variants
    mit frischen IDs; Variant Duplicate = unabhängige Vollkopie (T:
    `categoryVariants.test.ts`).
13. Make dynamic: Grid wird erste Variant, Größe wandert zur Variant (T/L).
14. flow→grid-Konvertierung inkl. Condition-Lifting; dynamic→flow verweigert
    (T: `categoryVariants.test.ts`).
15. Icons (gespeicherte SVGs) unverändert gerendert (L).
16. Grid-Geometrie-Invarianten unverändert (T: `paletteGridGeometry.test.ts`).
17. `npm test` vollständig grün, `tsc --noEmit`, Lint, Production-Build (heute
    491/491 — die Zahl wächst, sinkt aber nie).

---

## 14. Stufenplan

**Phase 0 — Vorfeld (kein Schemawechsel).**
Ziel: Risiko aus Phase A nehmen. Inhalt: zentraler `freshId()`-Generator
überall (fixt die `copyButton`-Kollisionslücke), Commit-Funnel in
`categoryStore.ts`, Hooks/Modals auf den Funnel umgestellt, `saveSettings()`
ohne in-place-Sort, `persistCategoryOrder` ohne Objektmutation.
Dateien: `categoryStore.ts`, `main.ts`, alle §3-Aufrufstellen (mechanisch).
Sichtbares Verhalten: keins. Migration: keine. Tests: bestehende + Funnel-Unit.
Exit: Checkliste §13/17 grün. Risiko: **niedrig** (mechanische Umstellung).

**Phase A — Neues Schema + Migration + Lesepfad (der eine große Schritt).**
Ziel: v5-Storage (`tools` + `placements`), Runtime äußerlich unverändert.
Inhalt: Typen (§5.2), `migrateV4toV5` (§10), Projektion löst `toolId` auf und
materialisiert weiterhin ButtonConfig-förmige Objekte für die Renderer
(Adapter in `panelProjection`/`categoryVariants` — Renderer, DnD-State und
Modals sehen zunächst dieselben Shapes wie heute), Interna der puren
Choke-Points umgestellt (`addButtonToGrid` → create+place,
`removeButtonFromGridCategory` → removePlacement+GC,
`replaceButtonInGridCategory` → updateTool, `applySlotIdsToGridCategory`,
`planGridResize`, Variant-Ops, `duplicateCategoryConfig`).
Warum nicht weiter teilbar: sobald der Storage wechselt, müssen Lese- und
Schreibpfad im selben Commit wechseln; die Teilung liegt davor (Phase 0) und
danach (B/C). Mitigation: fast alle Schreibpfade laufen durch die genannten
puren Funktionen — Hooks/Modals ändern sich kaum.
Sichtbares Verhalten: keins (Invarianten §13 vollständig).
Migration: v4→v5, Fixture-getestet, einmal persistiert.
Tests: bestehende Suites auf neue Interna portiert + Migrationstests +
GC-Unit-Tests (Placement entfernen: mit/ohne `library`, mit/ohne zweites
Placement; Drag-Rewrite sammelt nie).
Exit: §13 komplett, Live-Smoke im Scratch-Vault mit echter v4-`data.json`.
Risiko: **mittel** (größter Commit; begrenzt durch Choke-Point-Architektur).

**Phase B — Lifecycle explizit (API-Ebene, keine UI).**
Ziel: `library`-Flag wirksam, `placeTool`/`deleteTool` als Operationen,
Resize-Cut und Delete laufen über `removePlacement`.
Sichtbares Verhalten: unverändert (Flag setzt noch niemand); die
Resize-Confirm-Formulierung bleibt „deleted", solange kein Library-Tool
betroffen ist. Tests: Lifecycle-Matrix. Exit: §13 + Lifecycle-Suite.
Risiko: niedrig.

**Phase C — Presentation-Felder (additiv).**
Ziel: `accent` auf Category/Variant, `color` auf Placement — nur Modell,
Projektion und Tests; keine UI. Migration: keine (optional additiv).
Risiko: sehr niedrig.

**Phase D — Export/Import-Fundament.**
Ziel: `src/export/` mit `serializePackage`/`parsePackage`/`remapIds` (pur,
Obsidian-frei) + minimaler Import-Pfad über `placeTool`/Category-Insert;
Import-Warnung für fehlende Pfade. UI minimal (Kommandos).
Exit: Roundtrip-Tests (Export→Import in leeren Settings = äquivalente
Struktur mit neuen IDs); §13 unberührt. Risiko: niedrig.

**Phase E — Library-UI** (außerhalb dieses Audits; baut nur noch auf
`library`-Flag + `placeTool` auf).

Nach jeder Phase: funktionierender, releasebarer Zwischenstand; Phasen 0, B,
C, D sind einzeln trivial revertierbar, Phase A über die forward-only-Kette
bewusst nicht (deshalb die Fixture-Disziplin dort).

---

## 15. Was bewusst NICHT gebaut/abstrahiert wird

- **Kein universelles Item-/Entity-System.** Placements referenzieren Tools;
  der spätere Diskriminator ist additiv möglich und wird erst mit einem
  realen zweiten Inhaltstyp eingeführt.
- **Keine Batch-/Workflow-Engine, kein Event Bus.** Das bestehende
  `buttons-panel-refresh`-Event genügt.
- **Keine Placement-Overrides (Alias/Icon/Name) in v1** (§7.2).
- **Keine Row-/Column-Farbvererbung.** Row-Coloring = späteres Bulk-Edit über
  Placement-Farben.
- **Kein Template-Objekttyp, kein Marketplace.** Template = Export-Paket.
- **Keine Normalisierung der Variants.** Redundante Vollkopien bleiben
  Produktentscheidung (DECISIONS); die Registry erzwingt kein Sharing.
- **Kein Icon-Referenz-Umbau.** SVG-Markup bleibt; für Export sogar von
  Vorteil (selbst-enthalten). Nur beobachten (Paketgröße).
- **Kein Umbau der Flow-Semantik** (per-Button-Conditions, Reflow bleiben).
- **Keine „unresolved reference"-Persistenz** — Lazy-Runtime + Import-Warnung
  genügen (§9).
- **Kein Referenzzähler-Feld, kein GC-Hintergrundjob** — Zählung live, GC nur
  in Remove-Pfaden.

---

## 16. Risiken

1. **Phase-A-Größe.** Ein Storage-Wechsel ist nicht inkrementell testbar
   gegen halbe Zustände. Mitigation: Phase 0 vorab, Choke-Point-Umbau statt
   Hook-Umbau, Fixture-Migrationen aus echten `data.json`-Kopien, Live-Smoke.
2. **GC-Fehlklassifikation.** Ein Rewrite-Pfad (Drag, Resize-Preview), der
   fälschlich als „Remove" zählt, würde Tools vernichten. Mitigation: GC
   ausschließlich in `removePlacement`/`deleteTool`; explizite Tests
   „Cross-Category-Drag löscht nie eine Definition".
3. **Doppelte IDs in Altbeständen.** Registry-Keys erzwingen Eindeutigkeit;
   die Migration muss Duplikate re-iden statt still zu überschreiben (§10.4).
4. **Renderer-Adapter-Drift.** Solange Renderer ButtonConfig-Shapes sehen,
   existieren übergangsweise zwei Repräsentationen (Storage vs. View).
   Mitigation: Materialisierung nur in der Projektion (eine Stelle), und die
   View-Shape ist read-only.
5. **Obsidian-Sync/Dropbox-Konflikte** auf `data.json` bleiben wie heute
   (Last-write-wins) — durch den Refactor weder besser noch schlechter; die
   Registry macht Merge-Konflikte nicht gefährlicher (ein Tool = ein Key).
6. **Export-Paketgröße durch SVG-Icons** — akzeptiert, beobachten.
7. **Versteckte Semantik im mutierenden `saveSettings`-Sort:** Nach dessen
   Entfall (Phase 0) muss die Flow-`order`-Normalisierung nachweislich an den
   Schreibstellen passieren (Test: unsortierte Altdaten laden → Flow-Reihenfolge
   stabil).

---

## 17. Offene Entscheidungen (menschlich zu treffen)

**F1 — Modellierung Ad-hoc vs. Library.**
A: Eine Registry für alle Tools, Library = Flag, GC beim letzten Placement
(§5.1 B). B: Inline-Definition im Placement, Registry nur für Library-Tools
(§5.1 A). C: Library als Kopie-Store, Kernmodell unverändert (§5.1 C).
Konsequenzen: A = eine Struktur, ein Migrationsschritt, GC-Regel nötig;
B = zwei Placement-Arten in jedem Feature; C = keine Migration, aber die
Kopplungen aus §4 bleiben ungelöst.
**Empfehlung: A** — kleinste Struktur, die alle Ziel-Features trägt; die
GC-Regel ist der einzige neue Mechanismus und deterministisch testbar.

**F2 — Duplicate Variant / Copy Category: Tools kopieren oder teilen?**
A: Weiterhin Vollkopie (neue Tool-IDs) — Variants bleiben unabhängig,
heutige Semantik exakt erhalten; Sharing entsteht nur durch bewusstes
Platzieren eines Library-Tools. B: Kopien teilen die Definitionen — weniger
Redundanz, aber Edit-in-Kopie wirkt auf das Original und kippt die
DECISIONS-Grundsatzentscheidung „nichts geteilt".
**Empfehlung: A** — B wäre ein Produkt-Semantikwechsel durch die Hintertür.

**F3 — Was zeigt die spätere Library?**
A: Nur `library: true`-Tools (explizites Kuratieren; Drops bleiben unsichtbar).
B: Alle Tools, gefiltert/gruppiert nach Flag (nichts ist „versteckt", dafür
Grundrauschen durch Ad-hoc-Tools). Das Datenmodell ist bei beiden identisch —
aber die GC-Regel hängt daran: bei B müsste Entfernen des letzten Placements
das Tool wohl behalten (sonst zeigt die Library Dinge, die beim Entfernen
verschwinden), womit die Karteileichen-Frage zurückkehrt.
**Empfehlung: A** — sie ist es, die „Drops müllen die Library nicht zu"
strukturell garantiert.

**F4 — Flow-Categories mitmigrieren?**
A: Ja — ein Speichermodell, Flow-Tools sind library-/exportfähig; Kosten: der
v5-Schritt und die Flow-Schreibpfade (DnD-Flow-Rewrite, Flow-Modals) wachsen
mit. B: Nein — Flow behält eingebettete `ButtonConfig`s; kleinerer Refactor,
aber dauerhaft zwei Modelle und Flow bleibt von Library/Export ausgeschlossen
(oder braucht später doch dieselbe Migration).
**Empfehlung: A**, sofern Flow-Kategorien im eigenen Vault real in Gebrauch
sind; andernfalls ist B ein legitimer Scope-Cut mit bewusster Schuld.

**F5 — Import-ID-Politik.**
A: Immer alle IDs remappen (keine Konfliktklasse, Re-Import = Duplikat).
B: IDs erhalten und bei Konflikt fragen/mergen (ermöglicht „Update eines
früher importierten Pakets", kostet Konflikt-UX und Wiedererkennungs-Logik).
**Empfehlung: A** — B ist Marketplace-Denken; ausdrücklich nicht Ziel (§15).

*(Die Frage internes vs. portables Schema ist bewusst keine offene
Entscheidung — die Abwägung in §9 ist eindeutig: getrennt.)*

---

## 18. Empfohlener nächster Implementierungsauftrag

**„OCAP Phase 0 + Phase A: Tool-Registry und Placements (settingsVersion 5)"**
— nach menschlicher Entscheidung von F1–F5 (Vorschlag: A/A/A/A/A):

1. Phase 0: zentraler `freshId()`, Commit-Funnel in `categoryStore.ts`,
   `saveSettings` ohne in-place-Sort, `persistCategoryOrder` immutable.
   Abnahme: alle Tests grün, Verhalten identisch.
2. Phase A: Typen aus §5.2, `migrateV4toV5` nach §10 (Fixtures aus echten
   v0–v4-`data.json`-Kopien), Projektion mit `toolId`-Auflösung,
   Choke-Point-Interna umgestellt (§11-Tabelle), GC-Regel in
   `removePlacement` inkl. Test-Matrix.
   Abnahme: Regression-Checkliste §13 vollständig (Tests + Live-Smoke im
   Scratch-Vault `ocap-smoke` mit einer echten v4-`data.json`).

Explizit **nicht** Teil dieses Auftrags: Library-UI, Export/Import, Farben,
Placement-Overrides. Phasen B–D folgen als separate, kleine Aufträge.
