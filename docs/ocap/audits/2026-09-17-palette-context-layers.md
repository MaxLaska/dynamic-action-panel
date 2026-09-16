# Palette Context Layers — implementation and live verification (2026-09-17)

Phase 4b. The 4×4 palette grid from Phase 4a gains a layer model: a stable
palette with a base/pinned layer plus named context profiles, replacing the
per-button conditions that previously drove grid slots.

Scope note: slot hotkeys, toggle tools, source-mode toggle, rich tooltips,
import/export, dynamic actions and dynamic labels/icons are deliberately **not**
implemented here. The model prepares them; nothing was built.

## 1. What the model is

A grid category is a palette with two kinds of layer:

- **Base / Pinned** — `CategoryConfig.buttons`. Present in every context. The
  slots it occupies are reserved in *every* context profile.
- **Context profiles** — `CategoryConfig.contextProfiles: ContextProfile[]`,
  each with a stable `id`, a `name`, exactly one `conditions` tree and its own
  `buttons` (carrying their own `slot`).

Runtime resolution (`resolvePaletteForContext`, `src/utils/paletteLayers.ts`):

1. load the base layer;
2. determine the **first** profile whose condition matches;
3. apply its slot assignments only to slots the base layer leaves free;
4. produce the effective 4×4 grid.

Profiles are never merged, so every filled slot is attributable to exactly one
layer, and a context switch changes *what* sits on a slot, never *where* a tool
sits.

## 2. Architecture

### Pure core — `src/utils/paletteLayers.ts`

No Obsidian imports, no stored functions, nothing mutated.

- `resolvePaletteLayer(category, layerId)` — the one resolver. The runtime
  variant (`resolvePaletteForContext`) is a thin wrapper that picks the layer
  from the context; the management UI passes the layer the user selected. Both
  return the same `ResolvedPalette`: 16 `PaletteSlot`s carrying `button`,
  `source`, `pinned`, `reservedBy` and `blocked`, plus `overflow`.
- `blockedSlotsForLayer(category, layerId)` — the hard rule in one function: a
  profile is blocked by every pinned base slot; the base layer is blocked by
  slots that context profiles already use.
- `liftButtonConditionsToProfiles(buttons, idPrefix)` — the split rule shared by
  the settings migration and the flow → palette conversion, so both produce
  exactly the same shape.
- Profile management (`add/update/remove/duplicate/moveContextProfile`),
  layer-aware button placement (`addButtonToLayer`, `removeButtonFromPalette`,
  `replaceButtonInPalette`) and the drag write-back (`applySlotIdsToPalette`).

`placeButtonsOnGrid` gained a `blocked` option so a profile's placement can
never land on a pinned slot; a stored slot that would collide is relocated
deterministically to the lowest free unblocked slot rather than overwriting the
block or being dropped.

### Projection — `src/context/panelProjection.ts` (new module)

`projectCategoriesForContext` moved out of `src/context/conditions.ts` (which
must stay free of any palette dependency, otherwise the two modules import each
other). It now also returns `palettes: Map<categoryId, ResolvedPalette>` and
takes the management-mode `selectedLayers`.

- **locked**: a palette is resolved and handed to the renderer with its
  effective buttons; a flow category keeps the Phase-3 per-button filtering.
- **sort/edit**: categories pass through with their identity intact, and the
  `palettes` map carries the selected layer's resolution.

### Rendering

- `PaletteLayerContext` (new) distributes the resolutions and owns the per
  category layer selection; a selection pointing at a deleted profile falls back
  to the base layer, so a deleted profile can never leave the UI on a phantom
  layer.
- `PaletteLayerSelector` (new) renders `[Base / Pinned] [Type A] [Type B]
  [+ Context]` above the grid in the management modes, plus a one-line
  statement of what editing the selected layer means. A right-click (or the `⋮`
  affordance on the selected chip) opens Edit / Duplicate / Move up / Move down
  / Delete. Chip order **is** priority order.
- `CategoryButtonGrid` renders the resolved layer. A pinned base tool inside a
  context layer is rendered as a locked cell: dimmed, disabled, no context menu,
  not draggable, with a pin badge whose label says it is reserved in every
  context. An empty slot that other profiles use is marked reserved (dotted
  accent outline + filter glyph + tooltip naming the profiles).
- The status marker on a palette tool now follows the LAYER it lives in
  (base → `pin`, profile → `filter`), not `hasConditions`. Flow categories keep
  the condition-based marker unchanged.

### DnD

- The drag state mirrors the layer **on screen**: `buildButtonDragItems` takes
  the resolutions, so a drag in "Type A" cannot see, let alone move, "Type B".
- `applyDragOverToItems` gained a `BlockedSlots` map and refuses blocked slots.
- `resolveGridDropOutcome` classifies the release target as
  `accept` / `blocked` / `no-cell`. A `blocked` release reverts the whole drag
  and explains itself with a Notice (see defect 1 below).
- `persistItems` writes back per layer via `applySlotIdsToPalette`: every tool
  keeps the layer it belonged to, a tool arriving from another category joins
  the layer on screen, and layers that are not on screen are left untouched.

### Settings — version 2

`CURRENT_SETTINGS_VERSION = 2`, forward-only step `1 → 2`
(`migrateV1toV2`). Only `layout: 'grid'` categories are transformed:

1. the current arrangement is materialized first (`placeButtonsOnGrid`), so
   splitting the layers cannot move anything;
2. buttons without a condition stay in the base layer;
3. buttons sharing the same **valid** condition become ONE profile, in
   first-appearance order, named from the rule itself (`type = A`, `#todo`,
   `markdown`, …) with a `Context N` fallback, and lose the now-redundant
   per-button copy;
4. buttons with a **structurally invalid** condition stay in the base layer and
   keep that condition untouched — it failed open in version 1 (the button was
   always visible), so base is the behavior-preserving home, and the data is
   kept rather than discarded.

Profile ids are derived from the category id (`<categoryId>-ctx-<n>`), so the
migration is deterministic and reproducible. Flow categories, their per-button
conditions and every other setting pass through untouched.

The migration chain now also normalizes its result against the current defaults
(the `current` branch always did), which makes `migrateSettings` idempotent over
its own output and means a v1 → v2 upgrade no longer misses nested defaults
added since the data was written.

## 3. The two condition systems, separated

| | Grid palette | Flow category |
|---|---|---|
| `ButtonConfig.conditions` | **ignored at runtime**; lifted into profiles by the migration and by the flow → palette conversion | unchanged Phase-3 behavior |
| `CategoryConfig.contextProfiles` | decides which tools fill the free slots | ignored |
| `CategoryConfig.conditions` | palette visibility only — whether the palette is shown at all | category visibility, unchanged |

The button modals drop the per-button condition editor inside a palette and
state the target layer instead, so the UI cannot express the retired model.

A palette with pinned base tools therefore never disappears because no profile
matches. It disappears only when its own visibility condition fails, or when it
has nothing at all to offer in the current context.

## 4. Verification

- `npm test`: **330/330 PASS** (14 files). New: `paletteLayers` 50 (base layer,
  profiles, priority, resolution, blocking, profile management, layer-aware
  placement, conversion round-trip, drag write-back), `paletteDragLayers` 27
  (layer-mirroring drag state, pinned/reserved blocking, cross-profile safety,
  cross-category drops, rejection outcomes, no-profile regression).
  `settingsMigrations` extended to 30 with the whole version-2 surface;
  `gridVisibility` rewritten onto the layer model.
- `npm run lint`: PASS (0 problems) · `npx tsc --noEmit`: PASS · production
  build: PASS.

## 5. Live smoke test (2026-09-17, 95/95 PASS, 0 errors)

Automated via CDP against an **isolated** Obsidian 1.13.7: scratch
`--user-data-dir` registering only a snapshot copy of `ocap-smoke` with its own,
non-symlinked plugin directory. The user's own Obsidian (which had the smoke
vault open), its configuration and the production vault were never touched; the
source vault's `data.json` was verified unchanged afterwards. `window.onerror`,
`unhandledrejection` and a `console.error` wrapper were active throughout: **0
errors** in every phase. The fixture was written at **version 1**, so each run
exercised the real migration.

**Phase 1 — migration and layer UI (28):** version bumped to 2; conditionless
tools stayed on the base layer with their exact slots; the two `type = A`
buttons became ONE profile named `type = A` with slots 1 and 5 preserved and
their own conditions dropped; the invalid-condition tool stayed in base with its
data intact; flow categories kept all five per-button conditions. The layer
selector, its hint line and the migrated profile's chip (marked as currently
matching) rendered correctly. Creating `Type A` and `Type B` through `+ Context`
with the visual condition builder persisted exactly one condition each, in
priority order, and selected the new profile. Tools created on a layer landed in
that layer on its lowest usable slot; the button modal stated the target layer
and offered no condition editor. A base tool skipped every slot a profile uses.
Pinned slots showed as locked, disabled, non-draggable, with an explaining
label; reserved slots showed as reserved in the base layer.

**Phase 2 — runtime and profile management (29):** type A, type B and "neither"
resolved to the three expected arrangements with the pinned slots identical in
all three, 16 cells everywhere, and byte-identical restoration on switching
back. Locked mode marked only contextual tools, rendered no layer selector and
no locked/reserved chrome. With two matching profiles the first won; Move up /
Move down really changed which profile won; duplicate inserted the copy below
its source with identical tools/slots and fresh ids; edit prefilled name and
condition and the rename kept the tools; deleting a profile with tools asked
first and named them, cancel lost nothing, confirm removed exactly that profile
and left every other layer untouched.

**Phase 3 — DnD, persistence, legacy (32):** base tools draggable and swappable;
context tools moved and swapped inside their own profile with the other profile
and the base layer provably untouched; drops on pinned and on reserved slots
were rejected, fully reverted and explained by a Notice; the whole palette
survived a plugin reload byte-for-byte and still resolved correctly; flow
categories still rendered as flow lists and still filtered by their per-button
conditions; a script action still executed; the migrated legacy palette resolved
its lifted profile and kept its invalid-condition tool permanently visible;
palettes rendered as real 4×4 grids in tabs and folder view.

**Phase 4 — feel and category-level operations (6):** a normal mouse drag
activated in well under 300 ms (no long press); duplicating a palette copied the
base layer *and* every context profile with fresh ids and identical
conditions/slots; clicking a contextual tool in locked mode ran its action.

### Defects found and fixed during the live test

1. **A rejected drop committed the drag's last intermediate position.** The live
   drag state follows the pointer, so by the time it reached a blocked cell it
   already showed the tool on the last accepted cell it had crossed; releasing
   there persisted that. Now `resolveGridDropOutcome` reports `blocked` and the
   whole drag is reverted with an explaining Notice. Unit-tested.
2. **The palette's background container absorbed drops aimed at a locked cell.**
   A locked base cell had no droppable of its own, so the container (which spans
   the whole grid) won the collision and the release read as "no addressable
   cell". Locked and reserved cells now register a real — but refusing —
   droppable, which outranks the container; the refusal lives in the drop
   semantics. A release over the genuine background is deliberately left alone,
   because it is the normal case once the preview already fills the target cell
   and thereby removes that cell's droppable.
3. **flow → palette silently made conditional tools permanent.** Conversion left
   per-button conditions on the buttons, where a palette ignores them. It now
   lifts them into profiles with the same rule as the migration, so
   palette → flow → palette is lossless. Unit-tested as a round trip.
4. **The add-context chip read "+ + Context"** (plus icon plus a "+" in the
   label). Label shortened to "Context".
5. **Locked base cells were visually louder than the editable contextual
   tools** (solid box vs. no chrome). Management modes now outline every cell
   uniformly and a locked cell recedes (dashed border, no fill, dimmed button),
   so the tools that *are* editable on the selected layer read first.

## 6. UX assessment

- `Base / Pinned` and the profile chips are understandable without explanation;
  the hint line under the selector states what editing the selected layer means,
  and the selected chip is marked by border, weight and colour together.
- Pinned slots are unmistakably blocked inside a profile: dimmed, dashed,
  disabled, pin badge, tooltip. Reserved slots in the base layer use a dotted
  accent outline plus a filter glyph and a tooltip naming the profiles.
- Priority is legible from left-to-right chip order and is restated as
  "Priority N" in the category modal's read-only overview; a dot marks the
  profile that matches the current context.
- In locked mode a contextual slot carries the quiet filter badge, so a changed
  slot is recognisable without any spatial reorientation — positions never move.

No redesign was attempted; the five fixes above were the only UI changes.

## 7. Known limits

- A palette still reserves all four rows, so a mostly-empty one costs vertical
  space in locked mode (unchanged from Phase 4a).
- Profiles are reordered through the chip context menu, not by dragging the
  chips.
- A v2 document opened by a pre-v2 build would show only the base layer of a
  palette (its profiles live in a field that build does not know). Forward-only
  migration is the documented policy; this is the first release where it has a
  user-visible consequence in a mixed-version vault.
- The condition editor's DOM is covered by the live test, not by unit tests
  (no jsdom environment).
- Grid dimensions remain fixed at 4×4.
