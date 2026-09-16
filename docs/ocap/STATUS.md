# OCAP – Status

Last updated: 2026-09-17 (Phase 4b – Palette Context Layers)

## Current state

- GitHub fork `MaxLaska/obsidian-contextual-action-panel`, local repo in `H:\Dropbox\11-Projects\A1_Obsidian contextual action panel - OCAP`, branch `master`.
- Stabilization phase 1 complete (baseline `4d233de`); Phase 2 Context Engine foundation complete (`5995ee5`); Phase 3 visual condition rules complete (`a88d92e`); desktop DnD activation fixed (`3267842`); Phase 4a palette grid complete (`31199ae`). Details in git history and the documents under `docs/ocap/audits/`.
- **Phase 4b (palette context layers) is implemented and live-verified**: a grid category is now a layered palette — a base/pinned layer plus named context profiles, each with exactly one condition — replacing the per-button conditions that previously drove grid slots. Settings version 2 with a forward-only migration. 330 unit tests, 95 automated live checks in Obsidian 1.13.7 (0 errors). Full detail: `docs/ocap/audits/2026-09-17-palette-context-layers.md`.

## Phase 4b architecture – palette context layers

### Data model (`src/types/settings.ts`)

- `CategoryConfig.buttons` is the **base / pinned layer** of a grid category: present in every context, and the slots it occupies are reserved in every context profile.
- `CategoryConfig.contextProfiles?: ContextProfile[]` — named alternative layers, in priority order. Each has a stable `id`, a `name`, exactly one `conditions` tree (same model, same `ConditionEditor`) and its own `buttons` carrying their own `slot`.
- Fully JSON-serializable, no stored functions: a category is a self-contained tree (base layer + profiles), which is what a later palette export/import needs.

### Pure core (`src/utils/paletteLayers.ts`)

- `resolvePaletteLayer(category, layerId)` is the single resolver; `resolvePaletteForContext` wraps it and picks the layer from the context, the management UI passes the layer the user selected. Both return `ResolvedPalette`: 16 `PaletteSlot`s (`button`, `source`, `pinned`, `reservedBy`, `blocked`) plus `overflow`.
- Runtime semantics: base layer → **first** matching profile → its slots applied only where base leaves them free → effective 4x4 grid. Profiles are never merged; nothing stored is mutated.
- A profile without a condition always matches (deliberate fallback layer); a structurally **invalid** one does not (the single non-fail-open case, so a corrupt profile cannot shadow the ones below it).
- `blockedSlotsForLayer` holds the hard rule: a profile is blocked by every pinned slot, and the base layer is blocked by slots other profiles use.
- `liftButtonConditionsToProfiles` is the shared split rule used by the settings migration and by the flow → palette conversion.
- `placeButtonsOnGrid` gained a `blocked` option, so a stored slot that collides with a pinned one is relocated deterministically instead of overwriting it or being dropped.

### Projection (`src/context/panelProjection.ts`, new module)

`projectCategoriesForContext` moved out of `src/context/conditions.ts` (which must stay palette-free to avoid a module cycle). It additionally returns `palettes: Map<categoryId, ResolvedPalette>` and accepts the management-mode `selectedLayers`. Locked mode hands the renderer the resolved effective buttons; sort/edit pass categories through with identity intact plus the selected layer's resolution.

### Rendering

- `PaletteLayerContext` distributes the resolutions and owns the per-category layer selection (UI state, never persisted; a selection pointing at a deleted profile falls back to base).
- `PaletteLayerSelector` renders `[Base / Pinned] [Type A] [Type B] [+ Context]` plus a hint line in the management modes; right-click (or `⋮` on the selected chip) gives Edit / Duplicate / Move up / Move down / Delete. Chip order **is** priority order.
- A pinned base tool inside a context layer renders as a locked cell (dimmed, disabled, no context menu, not draggable, pin badge + tooltip). An empty slot other profiles use is marked reserved (dotted accent outline, filter glyph, tooltip naming them).
- The status marker on a palette tool follows the **layer** it lives in (base → `pin`, profile → `filter`), not `hasConditions`; flow categories keep the condition-based marker.
- The button modals hide the per-button condition editor inside a palette and state the target layer instead.

### DnD

- The drag state mirrors the layer on screen (`buildButtonDragItems` takes the resolutions), so a drag in one profile cannot see or move another.
- `applyDragOverToItems` takes a `BlockedSlots` map and refuses blocked slots; `resolveGridDropOutcome` classifies a release as `accept` / `blocked` / `no-cell`, and a `blocked` release reverts the whole drag with an explaining Notice.
- `persistItems` writes back per layer (`applySlotIdsToPalette`): tools keep their layer, a tool arriving from another category joins the layer on screen, off-screen layers stay untouched.

### Settings – version 2

`CURRENT_SETTINGS_VERSION = 2`, forward-only `1 → 2`. Only `layout: 'grid'` categories are transformed: the arrangement is materialized first, conditionless tools stay in base, tools sharing the same valid condition become ONE profile (named from the rule, `<categoryId>-ctx-<n>` ids, deterministic), invalid conditions stay in base untouched. Flow categories and everything else pass through. The chain now normalizes its result against current defaults, making `migrateSettings` idempotent over its own output.

**Accepted consequence:** a v2 document opened by a pre-v2 build shows only the base layer of a palette.

## Phase 4a architecture – palette grid

### Slot model (`src/utils/categoryGrid.ts`)

- `CategoryConfig.layout?: 'flow' | 'grid'` (absent = `flow` = historical behavior) and `ButtonConfig.slot?: number` (0..15, only consulted inside a grid). `GRID_COLUMNS/ROWS = 4`, `GRID_SLOT_COUNT = 16`.
- The slot lives **on the button**, so a hole is unambiguous (slot *i* is empty iff no button claims it) and survives every operation that filters `category.buttons` — context projection and search included — without extra bookkeeping.
- `placeButtonsOnGrid(buttons)` is the single render-time resolver: honours valid free slots, gives everything else the lowest free slot in `order` sequence, and returns anything past 16 as `overflow` instead of dropping it. Deterministic, pure, never mutates.
- Conversion helpers `convertCategoryToGrid` / `convertCategoryToFlow` / `applyCategoryLayout` follow the immutable-edit convention (new category and button objects). Converting a category with more than 16 buttons is **refused** with an explaining Notice; nothing is truncated. *(Phase 4b moved them to `src/utils/paletteLayers.ts` and made them layer-aware.)*

### DnD (`src/utils/buttonDragItems.ts`, `src/contexts/ButtonDragContext.tsx`)

- One drag representation covers both layouts: `ButtonDragItems = Record<categoryId, (string | null)[]>`. For flow the index is the order (dense, unchanged); for grid the index **is the slot** and `null` is an empty slot. `applyDragOverToItems` takes a `ContainerLayouts` map to know which reading applies.
- Semantics (see DECISIONS): within a grid and grid→grid, an empty slot relocates and an occupied slot **swaps**; flow→grid accepts empty slots only; grid→flow is the ordinary list insert and leaves a hole. Area zones carry no position in a grid and are ignored.
- Empty slots are real droppables (`slot:<categoryId>:<index>`), ranked directly below buttons in `buttonDragCollision` — both are single cells and cannot overlap.
- `dropTargetSlot` drives the target ring and is computed only for targets this drag would actually accept, so a rejected flow→grid drop never advertises a landing spot.
- Grid sorting previews are disabled (`SortingStrategy` returning `null`): the live drag state already shows the post-drop arrangement, so no sliding animation is needed or wanted.
- `persistItems` writes `slot` for grid categories, deletes it for flow ones, and now also preserves buttons that no container claimed (previously such a button would have been dropped from settings).

### Status markers

- `hasConditions()` (`src/context/conditions.ts`) decides persistent vs. contextual by **presence**, not validity, so a configured-but-invalid rule is still surfaced for correction. *(Phase 4b: inside a palette the marker follows the tool's layer instead; this still describes flow categories.)*
- `ContextStatusBadge` (`src/components/shared/ContextStatusBadge.tsx`) renders Lucide `pin` (persistent) / `filter` (contextual), with an inactive variant when a contextual rule does not currently match. Tooltip + `aria-label` on every marker; the two glyphs differ in silhouette so the marker never depends on color.
- `OCAPVisibilityContext` now also carries `interactionMode` (default `locked`), so renderers pick the presentation: sort/edit show both states explicitly, locked marks only contextual elements and in a reduced variant.
- Markers appear on buttons, list category titles, tabs and folder tiles.

### Rendering

- `CategoryButtonGrid` gained a grid branch: always 16 cells, `display: grid` with 4 columns. Empty cells stay in the DOM in every mode — that is what keeps positions stable — and only their chrome is mode-dependent (outlined in sort/edit, bare in locked).
- Works in all three view modes (list, tabs, folder detail), all of which already route buttons through `CategoryButtonGrid`.
- `CategoryEditModal` / `CategoryCreateModal` gained a Layout dropdown with a live explanation line; the actual positioning happens in sort mode.

### Settings

- Phase 4a needed **no migration and no version bump** (`settingsVersion` stayed 1): both new fields were additive and optional. *(Superseded by Phase 4b, which introduces version 2 for the layer model; see above.)*

## Phase 2 architecture (unchanged foundations)

- Versioned settings + forward-only migration pipeline (`src/settings/settingsMigrations.ts`), `CURRENT_SETTINGS_VERSION = 1`.
- `OCAPContextService` (`src/context/OCAPContextService.ts`): central reactive context snapshot (root-split content leaf), React binding via `useOCAPContext()` / `useSyncExternalStore`.
- Declarative serializable condition model (`src/types/conditions.ts`) + pure interpreter (`src/context/conditions.ts`): groups `all`/`any`/`not`, rules `viewType`/`path`/`folder`/`extension`/`property`/`tag`; fail-open on invalid data; depth-capped validation (`MAX_CONDITION_DEPTH = 32`, now exported).

## Phase 3 architecture

### Central rendering projection (`src/context/conditions.ts`)

- `projectCategoriesForContext(categories, context, interactionMode)` is the single place deciding visibility; returns `{categories, hiddenButtonIds, hiddenCategoryIds}`.
- **Locked**: categories are filtered via `filterCategoriesByContext` — a category is rendered only when its own condition holds (or none is set) AND at least one context-visible button remains. A category with zero visible buttons (including a category with no buttons at all) disappears entirely. Button filtering unchanged from Phase 2. Identity preserved when nothing is filtered.
- **Sort/Edit**: full data passes through untouched (same references, DnD safe); `hiddenButtonIds` (button's own condition fails) and `hiddenCategoryIds` (category's own condition fails) are provided for markers.
- `PanelContent.tsx` consumes only the projection; List/Tab/Folder modes receive already-projected categories, so all three collapse categories consistently in locked mode.
- `OCAPVisibilityContext` now carries both id sets; markers: buttons via `ocap-context-hidden` on the button (Phase 2), categories via `ocap-context-hidden` on the list category title / tab / folder tile (dimmed + dashed outline, PanelContent.css).

### Category conditions

- `CategoryConfig.conditions?: ButtonCondition` — same model, optional, additive; **no settingsVersion bump** (no data transformation needed; absent field = always visible; old settings stay byte-compatible). `settingsVersion` remains 1.
- Fail-open semantics identical to buttons (`isCategoryVisibleInContext`).
- Category copy (`{...category}` spread) carries conditions along.

### Visual condition editor

- `src/components/input/ConditionEditor.ts` (+ `.css`): reusable imperative component (Obsidian modal world, no React), used by `ButtonCreateModal`, `ButtonEditModal`, `CategoryCreateModal`, `CategoryEditModal`; later consumers (`enabledWhen`, …) can reuse it via `new ConditionEditor(container, initial, {name?, description?})` / `getResult()`.
- Edits the real condition model directly through pure immutable tree helpers in `src/context/conditionTree.ts` (path-addressed add/remove/replace, group-kind conversion with lossless NOT wrapping/unwrapping, rule-kind conversion preserving typed values, depth helpers) — no parallel editing model.
- Root is canonicalized to a group (`all [x] ≡ x`); NOT groups always hold exactly one child (deleting the child deletes the NOT).
- Rule rows: kind dropdown + operator dropdown + value/key inputs (view-type input has a datalist of common view types). Text input edits update the tree without re-render; all handlers read the live node at their path (never the render-time closure object — that was a real bug found in the live test, fixed via `currentRuleAt`).
- Advanced JSON section (collapsed `details`): mirrors the builder live, `Apply JSON` validates and loads back into the builder; **unapplied JSON edits are validated at save time and invalid JSON blocks the save** (never silently dropped). Structurally invalid stored conditions (fail-open at runtime) are surfaced there for correction.
- Incomplete builder state (property rule without key) also blocks the save (`conditions_incomplete`).
- Old `ConditionsInput` (JSON textarea) removed. i18n keys en/zh/ru.

### Modals

- `CategoryEditModal` edits name + conditions and **replaces the category object** (identity convention from DECISIONS.md) instead of mutating in place.
- `CategoryCreateModal` gained the editor; `onCreate` callback now `(name, conditions)`; `useCategoryCreation` stores them.
- Button modals swapped `ConditionsInput` → `ConditionEditor`; no further modal consolidation was needed for reuse (the editor is a self-contained section).

### Context service fix (live-test finding)

- `layout-change` now always rebuilds the snapshot: a leaf can swap its view in place (empty tab → file opened in the same tab) without `active-leaf-change`/`file-open` firing; previously the snapshot went stale. Deduplicated via `contextSnapshotsEqual`. Regression test added.

## Desktop DnD activation fix (2026-09-16)

- The sort-mode pointer sensor used a long-press constraint copied from the touch pattern, so a normal mouse drag never started a drag at all. `src/contexts/ButtonDragContext.tsx` now gives the desktop `ScrollAwarePointerSensor` `activationConstraint: { distance: 4 }` — **no `tolerance`**, because for a distance constraint dnd-kit evaluates tolerance first and *cancels*, which would abort fast drags. Touch keeps its `{ delay: 500, tolerance: 10 }` long-press unchanged.
- This activates the distance branch in `scrollAwarePointerHandleMove.ts` that already existed but was unreachable; no reordering, persistence or overlay code changed.
- DnD only exists in sort mode (`ButtonDragProvider` renders no `DndContext` otherwise), so the 4px threshold cannot affect normal clicks in locked mode.
- Live-verified (isolated Obsidian 1.13.7, CDP, 17/17 + threshold sweep, 0 errors): category reorder, same-category button reorder, cross-category move, persistence across a plugin reload, click/collapse/context-menu behavior. Drag feedback (cursor-following `DragOverlay`, 0.45 source dimming, live list reflow) was found adequate once activation works; details and the remaining UX gaps in `docs/ocap/audits/2026-09-16-dnd-sort-mode.md`.

## Verification (2026-09-17, Phase 4b)

- `npm test`: **330/330 PASS** (14 files). New: `paletteLayers` 50 (base layer, profiles, priority, resolution, blocking, profile management, layer-aware placement, conversion round-trip, drag write-back), `paletteDragLayers` 27 (layer-mirroring drag state, pinned/reserved blocking, cross-profile safety, cross-category drops, rejection outcomes, no-profile regression). `settingsMigrations` extended to 30 with the whole version-2 surface; `gridVisibility` rewritten onto the layer model.
- `npm run lint`: PASS (0 problems) · `npx tsc --noEmit`: PASS · production build (`node esbuild.config.mjs production`, dist-only): PASS.

## Live smoke test (2026-09-17, Phase 4b, 95/95 PASS, 0 errors)

Automated via CDP against an isolated Obsidian 1.13.7 instance: scratch `--user-data-dir` registering only a snapshot copy of `ocap-smoke` with its own, non-symlinked plugin directory. The user's own Obsidian (which had the smoke vault open), its configuration and the production vault were never touched; the source vault's `data.json` was verified unchanged afterwards. Error monitoring active throughout: **0 errors** in every phase. The fixture was written at **version 1**, so each run exercised the real migration.

- **Phase 1 – migration and layer UI (28):** version bump; conditionless tools stay in base with exact slots; same-condition tools become ONE named profile with slots preserved and their own conditions dropped; an invalid condition survives on its base tool; flow categories keep all per-button conditions. Layer selector, hint line, matching-profile marker. Creating `Type A`/`Type B` through `+ Context` with the visual builder; tools created on a layer land in that layer; the button modal states the target layer and offers no condition editor; a base tool skips every slot a profile uses; pinned/reserved chrome correct.
- **Phase 2 – runtime and profile management (29):** the three contexts resolve to the three expected arrangements with identical pinned slots, 16 cells everywhere and byte-identical restoration; locked mode marks only contextual tools and shows no selector; first matching profile wins; Move up/down really changes the winner; duplicate/edit/delete behave, delete asks first and names the tools, cancel loses nothing.
- **Phase 3 – DnD, persistence, legacy (32):** base and context drags move/swap within their own layer with the other layers provably untouched; drops on pinned and reserved slots are rejected, fully reverted and explained; the palette survives a plugin reload byte-for-byte; flow categories, their per-button conditions and script actions still work; the migrated legacy palette resolves its lifted profile; palettes render as real 4x4 grids in tabs and folder view.
- **Phase 4 – feel and category operations (6):** a normal mouse drag activates in well under 300 ms; duplicating a palette copies base **and** every profile with fresh ids; a contextual tool executes in locked mode.

Five defects were found and fixed during the run (rejected-drop revert, locked-cell droppable, lossless flow→palette conversion, "+ + Context" label, locked-cell visual weight). Detail: `docs/ocap/audits/2026-09-17-palette-context-layers.md`.

## Live smoke test (2026-09-17, Phase 4a, 74/74 PASS, 0 errors)

Automated via CDP against an isolated Obsidian 1.13.7 instance (scratch `--user-data-dir`). **The user's own Obsidian had the `ocap-smoke` vault open at the time**, so the run used a snapshot copy of that vault with its own (non-symlinked) plugin directory — identical build, zero chance of racing on the shared `data.json`. The production instance, its config and the production vault were never touched. `window.onerror`, `unhandledrejection` and a `console.error` wrapper were active throughout: **0 errors** in every run.

- **Rendering (9):** 4x4 grid with `display: grid`, 16 cells and 4 columns in list, tabs and folder-detail views × locked/sort/edit. Holes render exactly where configured; flow categories are untouched.
- **Grid DnD (8):** move to empty slot; same-category swap; grid→grid to an empty slot; grid→grid swap across categories; flow→grid onto an empty slot; flow→grid onto an occupied slot correctly **rejected**; grid→flow list insert leaving a hole; persistence across a plugin reload. All drags used a normal fast mouse gesture — no long press anywhere.
- **Slot stability (33):** with three real markdown contexts isolating the button rule from the category rule — hidden button leaves slot 1 empty, all three neighbours stay on their slots, the pre-existing hole stays a hole, the button returns to *exactly* slot 1 on context switch back, and the whole grid is byte-identical to the original context. Locked mode marks only contextual elements (quiet variant) and draws no slot outlines; sort and edit render every configured element, mark persistent and contextual explicitly, and flag non-matching ones as inactive.
- **Category editor (12):** context menu → Edit shows the Layout dropdown and a live hint; switching to grid converts FlowCat losslessly to slots 0..1 and renders it as a 16-cell grid; clicking a grid button runs its action exactly once; collapse/expand still works.
- **Refusal (6):** a 17-button category refuses the grid conversion, writes no slots, loses no button, explains why in a Notice and keeps the modal open.
- **Legacy regression (6):** flow reorder within a category and flow→flow cross-category move both still work; grid slots untouched by flow drags; flow categories persist with no `slot` fields; grid buttons show `cursor: grab` in sort mode.

### Defects found and fixed during the live test

1. Palette CSS lost to `PanelContent.css` on source order in tabs/folder views, which use `buttons-panel-content` rather than `buttons-panel-grid` outside sort mode — the grid silently fell back to `display: flex`. Fixed by raising specificity (`body .buttons-panel .ocap-palette-grid`) and keying on the palette class alone.
2. The drop-target ring only existed on *empty* cells, but the live preview fills the target cell before the pointer arrives — the ring almost never showed. Filled cells now carry it too.
3. The ring appeared even for flow→grid drops onto occupied slots, which are rejected. `resolveGridDropTarget` now returns null for targets this drag would not accept.
4. Long tool names overflowed their slot into the neighbouring cells (a flex row tolerated it, a fixed grid cell does not). Grid cells now clip and ellipsize the label.
5. `grid-2x2` is not in this Obsidian's Lucide set, so grid categories rendered no title icon at all. Grid categories now use `layout-grid` and flow categories `list`, both verified present in the live DOM.
6. `persistItems` rewrote `category.buttons` purely from the drag state, which would have dropped any button the drag state did not carry (grid overflow from hand-edited data). It now preserves unclaimed buttons.

## Live smoke test (2026-09-16, 19/19 PASS + extra checks)

Automated via CDP against an isolated Obsidian 1.13.7 instance (`--user-data-dir` scratch profile registering only `C:\Users\flash\ObsidianTestVaults\ocap-smoke`; production instance/vault untouched — no other Obsidian process was running). Error monitoring (`window.onerror`, `unhandledrejection`, `console.error`) active throughout: **0 errors**. Modals were driven through the real UI (trusted CDP input for right-click/context menu/menu items/buttons).

1. Visual builder: Add condition → ALL group with viewType rule; JSON mirror correct — PASS.
2. Folder rule added visually (kind dropdown, op startsWith, value typed) — PASS.
3. Property rule (key `status`, op equals, value `done`) — PASS (after fixing the stale-closure editor bug this flow uncovered).
4. ALL group with 3 rules saved; persisted exactly as built — PASS.
5. ANY group built visually on another button — PASS.
6. Nested NOT group (`any [tag, not extension]`) built via group-kind switch — PASS.
7. Reopened editor prefilled; folder value edited and saved — PASS.
8. Root delete → empty state ("No conditions — always visible"), save clears conditions — PASS.
9. Advanced JSON: invalid JSON blocks save (Notice + error marker, modal stays open); Apply of valid JSON loads it into the builder; cancel discards — PASS.
10. Category condition (folder startsWith notes) created through category context menu → CategoryEditModal; saved with **new object identity**, buttons preserved — PASS.
11. Locked mode: category with false condition disappears despite a visible button — PASS.
12. Locked mode: category vanishes when 0 buttons remain visible (empty view) — PASS.
13. Context switch back (notes/note-a.md): categories reappear (required the layout-change fix above) — PASS.
14. Sort and edit mode show all categories/buttons; hidden category marked on title (list), tab and folder tile; hidden buttons marked — PASS.
15. Context-hidden button still manageable (context menu opens in edit mode) — PASS.
16. DnD (sort mode, trusted input): reorder within category, DOM + persisted `data.json` — PASS. (Activation was a 400ms long-press at the time; superseded by the distance-based fix above.)
17. Static button unchanged/inert, no errors — PASS.
18. Script action executes exactly once (entry + top level) — PASS.
19. Zero React/console/unhandled errors across the whole run — PASS.

Extra: tabs and folder view checked in locked (Beta collapsed) and sort (Beta marked) mode.

## Caveats / open points

### Palette context layers

- Profiles are reordered through the chip context menu, not by dragging the chips.
- A version-2 document opened by a pre-version-2 build shows only the base layer of a palette (its profiles live in a field that build does not know). Forward-only migration remains the policy; this is the first release where it has a user-visible consequence in a mixed-version vault.
- Base-layer edits are blocked by slots that context profiles occupy. That is deliberate (no silent displacement), but it means freeing such a slot requires visiting the profile that holds it; the tooltip names the profiles, there is no jump-to-profile affordance.
- The category modal's context-profile section is a read-only priority overview; all profile editing happens on the palette's layer selector.
- `ButtonConfig.conditions` still exists on palette buttons when it was structurally invalid at migration time. It is inert there by design (a palette ignores per-button conditions) and is only preserved so nothing is discarded.

### Palette grid

- A grid always reserves all four rows, so a mostly-empty palette costs vertical space in locked mode. This is the deliberate price of memorizable positions, but a "trim trailing empty rows" option may be worth offering later.
- Grid dimensions are fixed at 4x4. Nothing in the model depends on the constants except the 16-slot cap, so making them per-category configurable is a contained change if it becomes desirable.
- A slot is only labelled by its row/column tooltip; there is no visible slot number. That becomes worth revisiting when slot hotkeys arrive.
- The grid overflow path (more than 16 buttons in a `layout: 'grid'` category) is only reachable through hand-edited `data.json`, since conversion refuses and cross-category drops cannot exceed 16. It is unit-tested and renders below the grid, but has no dedicated UI affordance for fixing it.
- Grid cells clip long tool names to one ellipsized line; the full name is still available through the existing button tooltip.
- When **all** categories are context-hidden in locked mode, the panel shows the generic "No categories yet, switch to edit mode to add" hint — a context-specific empty-state text would be nicer.
- The visual editor stores property `equals` values as strings; loose scalar comparison makes this equivalent for numbers/booleans, but hand-written JSON keeps its original scalar types until edited.
- Editor DOM behavior is covered by the live smoke test, not by unit tests (no jsdom environment in the Vitest setup; pure tree logic is fully unit-tested).
- Live-test mode/view switches went through the settings API (same code path as the nav menu); DnD and all modal flows used real trusted input.
- Popout windows / selection context: unchanged Phase 2 limitations.
- Pre-existing: 6 dev-dependency `npm audit` findings; Dropbox can transiently lock `node_modules`.

## Next step

The palette now has both a stable spatial identity (Phase 4a) and a
context-layer model (Phase 4b). In rough order of leverage:

1. **Slot hotkeys** — slot identity is stable and independent of both the tool and the layer, so a binding on slot 0 stays correct across every context; only the keybinding layer is missing.
2. **Toggle tools** (OFF/ON state with separate actions and appearance) — needs a tool-type notion on `ButtonConfig`; nothing in the layer model blocks it.
3. **Rich tooltip / description** — name, description, layer, status, hotkey in one hover surface; the status marker already occupies the button corner, so the two should be designed together.
4. Category/palette export-import — a palette is now a self-contained JSON tree (base layer + profiles), so this stays a serialization exercise.
5. `enabledWhen` and dynamic labels/icons on the existing condition model.

Still open from earlier phases: context-specific locked-mode empty state, optional jsdom-based editor unit tests, packaging/release strategy + manifest id decision.
