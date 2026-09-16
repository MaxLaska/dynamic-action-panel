# OCAP – Status

Last updated: 2026-09-17 (Phase 4a – Palette Grid Foundation)

## Current state

- GitHub fork `MaxLaska/obsidian-contextual-action-panel`, local repo in `H:\Dropbox\11-Projects\A1_Obsidian contextual action panel - OCAP`, branch `master`.
- Stabilization phase 1 complete (baseline `4d233de`); Phase 2 Context Engine foundation complete (`5995ee5`); Phase 3 visual condition rules complete (`a88d92e`); desktop DnD activation fixed (`3267842`). Details in git history and the documents under `docs/ocap/audits/`.
- **Phase 4a (palette grid) is implemented and live-verified**: categories can switch to a 4x4 grid of 16 stable slots where hidden buttons leave real holes, persistent vs. contextual elements are visually distinguishable everywhere, grid DnD is positional (move/swap), 231 unit tests, 74 automated live checks in Obsidian 1.13.7 (0 errors).

## Phase 4a architecture – palette grid

### Slot model (`src/utils/categoryGrid.ts`)

- `CategoryConfig.layout?: 'flow' | 'grid'` (absent = `flow` = historical behavior) and `ButtonConfig.slot?: number` (0..15, only consulted inside a grid). `GRID_COLUMNS/ROWS = 4`, `GRID_SLOT_COUNT = 16`.
- The slot lives **on the button**, so a hole is unambiguous (slot *i* is empty iff no button claims it) and survives every operation that filters `category.buttons` — context projection and search included — without extra bookkeeping.
- `placeButtonsOnGrid(buttons)` is the single render-time resolver: honours valid free slots, gives everything else the lowest free slot in `order` sequence, and returns anything past 16 as `overflow` instead of dropping it. Deterministic, pure, never mutates.
- Conversion helpers `convertCategoryToGrid` / `convertCategoryToFlow` / `applyCategoryLayout` follow the immutable-edit convention (new category and button objects). Converting a category with more than 16 buttons is **refused** with an explaining Notice; nothing is truncated.

### DnD (`src/utils/buttonDragItems.ts`, `src/contexts/ButtonDragContext.tsx`)

- One drag representation covers both layouts: `ButtonDragItems = Record<categoryId, (string | null)[]>`. For flow the index is the order (dense, unchanged); for grid the index **is the slot** and `null` is an empty slot. `applyDragOverToItems` takes a `ContainerLayouts` map to know which reading applies.
- Semantics (see DECISIONS): within a grid and grid→grid, an empty slot relocates and an occupied slot **swaps**; flow→grid accepts empty slots only; grid→flow is the ordinary list insert and leaves a hole. Area zones carry no position in a grid and are ignored.
- Empty slots are real droppables (`slot:<categoryId>:<index>`), ranked directly below buttons in `buttonDragCollision` — both are single cells and cannot overlap.
- `dropTargetSlot` drives the target ring and is computed only for targets this drag would actually accept, so a rejected flow→grid drop never advertises a landing spot.
- Grid sorting previews are disabled (`SortingStrategy` returning `null`): the live drag state already shows the post-drop arrangement, so no sliding animation is needed or wanted.
- `persistItems` writes `slot` for grid categories, deletes it for flow ones, and now also preserves buttons that no container claimed (previously such a button would have been dropped from settings).

### Status markers

- `hasConditions()` (`src/context/conditions.ts`) decides persistent vs. contextual by **presence**, not validity, so a configured-but-invalid rule is still surfaced for correction.
- `ContextStatusBadge` (`src/components/shared/ContextStatusBadge.tsx`) renders Lucide `pin` (persistent) / `filter` (contextual), with an inactive variant when a contextual rule does not currently match. Tooltip + `aria-label` on every marker; the two glyphs differ in silhouette so the marker never depends on color.
- `OCAPVisibilityContext` now also carries `interactionMode` (default `locked`), so renderers pick the presentation: sort/edit show both states explicitly, locked marks only contextual elements and in a reduced variant.
- Markers appear on buttons, list category titles, tabs and folder tiles.

### Rendering

- `CategoryButtonGrid` gained a grid branch: always 16 cells, `display: grid` with 4 columns. Empty cells stay in the DOM in every mode — that is what keeps positions stable — and only their chrome is mode-dependent (outlined in sort/edit, bare in locked).
- Works in all three view modes (list, tabs, folder detail), all of which already route buttons through `CategoryButtonGrid`.
- `CategoryEditModal` / `CategoryCreateModal` gained a Layout dropdown with a live explanation line; the actual positioning happens in sort mode.

### Settings

- **No migration and no version bump** (`settingsVersion` stays 1): both new fields are additive and optional, and categories created as flow persist no `layout` field at all, so pre-palette builds keep reading the same data.

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

## Verification (2026-09-17)

- `npm test`: **231/231 PASS** (12 files). New: `categoryGrid` 38 (geometry, placement, duplicate/out-of-range repair, overflow, conversions both ways, identity convention), `gridDragItems` 27 (slot droppable ids, all four drop semantics, flow regression, holes in the drag state), `gridVisibility` 23 (the product guarantee: hidden button leaves its slot empty, neighbours do not move, exact restoration, management-mode markers, legacy flow untouched). `settingsMigrations` extended to 17 with palette back-compat cases.
- `npm run lint`: PASS (0 problems) · `npx tsc --noEmit`: PASS · production build (`node esbuild.config.mjs production`, dist-only): PASS.

## Live smoke test (2026-09-17, 74/74 PASS, 0 errors)

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

The palette grid is the spatial foundation the following features were waiting for. In rough order of leverage:

1. **Slot hotkeys** — the slot identity is already stable and independent of the button; only the keybinding layer is missing.
2. **Toggle tools** (OFF/ON state with separate actions and appearance) — needs a tool-type notion on `ButtonConfig`; nothing in the grid model blocks it.
3. **Rich tooltip / description** — name, description, status, hotkey in one hover surface; the status marker already occupies the button corner, so the two should be designed together.
4. `enabledWhen` and dynamic labels/icons on the existing condition model.
5. Category/palette export-import — the schema is JSON-serializable and free of runtime functions, so this stays a serialization exercise.

Still open from earlier phases: context-specific locked-mode empty state, optional jsdom-based editor unit tests, packaging/release strategy + manifest id decision.
