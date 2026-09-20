# OCAP – Decisions

This file records durable decisions only. Do not use it as a work log.

## 2026-09-16 – Separate technical memory from project cockpit

**Decision:** The repository is the technical source of truth for code-adjacent project memory. Notion is the human-facing project cockpit.

**Repository responsibilities:**
- current technical handoff in `docs/ocap/STATUS.md`;
- durable architecture/product decisions in this file;
- substantial audits and investigations under `docs/ocap/audits/`.

**Notion responsibilities:**
- concise project status;
- next steps;
- important decisions;
- links to repository, local project and relevant Obsidian context.

**Reason:** A new coding-agent session must be able to recover the technical state directly from the repository, while the user should not have to navigate code-oriented documentation to understand project progress.

## 2026-09-16 – Develop OCAP as an independent fork

**Decision:** Buttons Panel is the starting codebase, but OCAP will evolve as an independent product rather than trying to preserve routine upstream merge compatibility.

**Upstream policy:**
- keep Buttons Panel as a reference source;
- review important upstream releases and commits;
- selectively port useful fixes or ideas into OCAP;
- do not treat automatic upstream merging as a design constraint.

**Reason:** The initial audit found no stable extension API for the core features OCAP needs. Context-aware visibility, settings migrations, dynamic rendering, action-registry cleanup and future component extensibility all require changes in actively changing core files. Preserving merge compatibility would therefore constrain the same areas that need architectural improvement.

## 2026-09-16 – Stabilize before adding the Context Engine

**Decision:** Do not build the first OCAP context feature directly on the audited baseline. First create a minimal automated test safety net and fix the highest-confidence baseline defects.

**Initial stabilization scope:**
- React hook-order defects in `NavigationBar` and `FolderModeContent`;
- stale-render risk in `ButtonItem` memoization;
- unsafe metadata evaluation in `ScriptService.getScriptMeta`;
- exact pinning of fragile dnd-kit dependencies;
- controlled removal of clearly dead code;
- baseline verification through install/lint/typecheck/build where appropriate.

**Reason:** The upstream code has no automated tests and the most fragile areas overlap with the architecture OCAP will extend.

## 2026-09-16 – Vitest as the unit-test foundation

**Decision:** Unit tests run on Vitest (3.x) with a Node environment, tests under `tests/`, and a minimal `obsidian` module mock (`tests/mocks/obsidian.ts`) wired via resolve alias. No browser/E2E infrastructure in this phase.

**Reason:** The project is esbuild-based ESM TypeScript; Vitest executes it natively with near-zero configuration and stays fast. Services and pure logic (later: Context Engine, condition resolver) are testable without a full Obsidian app. Vitest 5 currently conflicts with the build's pinned esbuild 0.25.5 (its Vite 8 requires esbuild ≥0.27 as peer); revisit the major upgrade together with a deliberate esbuild upgrade.

## 2026-09-16 – Object identity signals content change for memoized React components

**Decision:** Settings objects (`ButtonConfig`, `CategoryConfig`) shared between React and `plugin.settings` are treated as immutable-per-edit: code that changes an object's content must replace it with a new object (as `ButtonEditModal` now does). React memo comparators compare these props by identity (`shallowEqualExcept`), never by deep value.

**Reason:** Prop-based value comparison can never detect in-place mutation (prev and next props read the same object), and deep equality across replaced objects would keep stale identities captured in event handlers. Identity comparison is only correct if edits produce new identities — this contract must be preserved by future edit paths.

## 2026-09-16 – Settings are versioned with a forward-only migration pipeline

**Decision:** Persisted settings carry `settingsVersion` (current: 1). Loading runs `migrateSettings` (`src/settings/settingsMigrations.ts`): a deterministic, pure chain of `{from, apply}` steps (`0 = unversioned upstream` → 1 → …). Migrated data is persisted exactly once via `saveData`. Data from an unknown **future** version is loaded best-effort, keeps its higher version number and is never rewritten or downgraded. Nested config objects are deep-merged over defaults; categories/buttons and unknown keys are preserved as-is.

**Reason:** The upstream shallow-merge silently lost new nested defaults and offered no path for schema changes. OCAP's schema will keep evolving (conditions today, dynamic behaviors later); migrations must be testable, idempotent and safe against version skew between synced devices.

## 2026-09-16 – Declarative serializable condition model, evaluated fail-open

**Decision:** Button visibility conditions are a JSON-serializable tree (`src/types/conditions.ts`): groups `all`/`any`/`not` plus atomic rules discriminated by `rule` (`viewType`, `path`, `folder`, `extension`, `property`, `tag`). No function strings, no eval, no dynamic JS. Evaluation is a pure interpreter (`src/context/conditions.ts`). Semantics: a button without conditions is always visible; **structurally invalid condition data fails open** (button stays visible, surfaced at edit time); missing context values evaluate rules to false; `all []` holds, `any []` does not.

**Reason:** A second eval path beside ScriptService would reopen the audit's High finding class. Fail-open guarantees corrupt settings can never lock users out of their buttons. The discriminated-union model stays extensible (new rules, later `enabledWhen` etc.) without breaking stored data.

## 2026-09-16 – Central context store with useSyncExternalStore subscription

**Decision:** Workspace context lives in one plugin-level `WorkspaceContextService` holding an immutable `WorkspaceContextSnapshot`. Obsidian events (workspace/metadataCache/vault) rebuild the snapshot, which is only replaced (and subscribers notified) when it changed semantically. React subscribes via `useSyncExternalStore` (`useWorkspaceContext()`); no polling, no DOM observation, no new document CustomEvents. The context describes the last active **content leaf in the root split** — focusing the buttons panel or sidebars never changes it.

**Reason:** One store avoids a second parallel state world and keeps re-renders bounded by real context changes. The content-leaf rule prevents conditioned buttons from disappearing the moment the user focuses the panel to click them, mirroring the existing action-execution semantics (`lastActiveContentLeaf`).

## 2026-09-16 – Conditions hide buttons in locked mode only; sort/edit mark instead of hide

**Decision:** Context conditions filter buttons centrally in `PanelContent` **only in locked interaction mode** (normal usage). In sort and edit mode every button stays rendered and fully manageable (drag, context menu, edit); context-hidden buttons are visually marked (`ocap-context-hidden`: dimmed + dashed outline). Conditions currently control visibility only.

**Reason:** Locked is the consumption mode; sort/edit are management modes where hiding configuration targets would make conditioned buttons uneditable (edit mode has the context menu, sort mode the drag surface). Filtering in one place keeps all view modes and the DnD provider consistent, and DnD (sort-only) always operates on unfiltered lists.

## 2026-09-16 – One visual condition editor operating directly on the condition model

**Decision:** The visual condition builder (`src/components/input/ConditionEditor.ts`) edits the declarative `ButtonCondition` tree directly through pure immutable helpers (`src/context/conditionTree.ts`). There is no second/parallel editing model. The editor is a reusable, self-contained imperative component (constructor + `getResult()`), shared by button and category modals and available to future consumers (`enabledWhen`, …); no broader modal consolidation was performed because none was needed for reuse.

**Canonicalization:** the editor normalizes a bare-rule root to a group on load (`all [x] ≡ x`, semantically identical); NOT groups always hold exactly one child (deleting the child deletes the NOT; converting a multi-child group to NOT wraps the children losslessly in a group of the previous kind).

**Editor-state rule:** control callbacks must read the live node at their tree path (`currentRuleAt`), never the rule object captured at render time — text inputs update the tree without re-rendering, so captured objects go stale (this caused a real data-loss bug found in the live test).

**Reason:** A parallel editing model would drift from the persisted schema and double the validation surface. Pure tree helpers keep all manipulation logic unit-testable without DOM.

## 2026-09-16 – Advanced JSON view stays, bidirectional but explicit, never silently saved

**Decision:** The JSON textarea remains as a collapsed "Advanced: JSON" section inside the ConditionEditor. Builder → JSON syncs live; JSON → builder only via the explicit Apply button (validated). Unapplied JSON edits take precedence at save time and are validated there: invalid JSON or schema violations block the save with a Notice. Structurally invalid stored conditions (which fail open at runtime) are surfaced in this section for correction. Incomplete builder state (e.g. property rule without key) also blocks the save.

**Reason:** Full keystroke-level bidirectional sync would fight the user mid-typing; an explicit Apply keeps both representations consistent without data loss, and the save-time validation guarantees nothing invalid is ever silently persisted or dropped.

## 2026-09-16 – Category visibility semantics in locked mode

**Decision:** `CategoryConfig.conditions?: ButtonCondition` uses the identical condition model and fail-open rules as buttons. In locked (consumption) mode a category is rendered iff (1) its own condition holds or none is set AND (2) at least one of its buttons is context-visible. A category with zero visible buttons — including a category with no buttons at all — disappears entirely. This applies uniformly to list, tabs and folder mode because filtering happens centrally before the modes render.

**Reason:** Locked mode is for consumption; a category offering nothing actionable is noise. Tying the rule to "visible buttons" (not "was emptied by conditions") keeps the semantics simple and predictable.

## 2026-09-16 – One central rendering projection

**Decision:** `projectCategoriesForContext(categories, context, interactionMode)` in `src/context/conditions.ts` is the single decision point for context visibility: locked mode gets filtered categories, sort/edit get untouched references plus `hiddenButtonIds`/`hiddenCategoryIds` marker sets (distributed via `PanelVisibilityContext`). View modes never evaluate conditions themselves.

**Marker semantics:** an element is marked context-hidden iff its **own** condition fails (categories are not marked merely because all their buttons are hidden — the dimmed buttons already show that). Category markers use the same `ocap-context-hidden` class on the list title / tab / folder tile.

**Reason:** One projection keeps the three view modes and the DnD provider consistent, is unit-testable in isolation, and gives later features (dynamic behaviors) a single extension point.

## 2026-09-16 – Category conditions do not bump the settings version

**Decision:** `settingsVersion` stays at 1. `CategoryConfig.conditions` is a purely additive optional field: absent means "always visible", no existing persisted data needs transformation, and version-1 data written by Phase 3 remains loadable by Phase 2 builds. Version bumps are reserved for actual data transformations or incompatible semantic changes.

**Reason:** Reflexive version bumps would force no-op migrations on every synced device and create artificial "future version" states in mixed-version vaults.

## 2026-09-16 – Context snapshot rebuilds on every layout-change

**Decision:** `WorkspaceContextService` rebuilds the snapshot on every `layout-change` (deduplicated via `contextSnapshotsEqual`), not only when the tracked leaf was detached. A leaf can swap its view in place (empty tab → file opened in the same tab) without emitting `active-leaf-change` or `file-open`.

**Reason:** Live-verified gap: after closing all tabs and opening a file in the new tab, the context stayed stale and conditioned categories never reappeared.

## 2026-09-17 – Palette grid: 4x4, 16 stable slots, holes are real

**Decision:** A category can opt into `layout: 'grid'` — a fixed 4x4 field of 16 slots with stable identities `0..15`. A slot holds at most one button, and an empty slot **stays empty**: buttons never slide up to fill a hole, not after a reload, a context change, a visibility change, a drag, an edit or a save. `layout` absent or `'flow'` keeps the historical reflowing behavior, which remains the default.

**Representation:** the slot lives on the button (`ButtonConfig.slot?: number`), not in a separate array on the category. A hole is therefore unambiguous — slot *i* is empty iff no button of the category claims it — and it survives every operation that filters `category.buttons` (context projection, search) with no extra bookkeeping, because the surviving buttons carry their own slot. Missing, out-of-range or duplicate slots are repaired deterministically at render time by `placeButtonsOnGrid` (`src/utils/categoryGrid.ts`): valid free slots are honoured, everything else takes the lowest free slot in `order` sequence, and anything beyond 16 is reported as `overflow` rather than dropped.

**Reason:** Users must be able to memorize spatial positions ("top left is always slot 1"). A sorted list cannot represent a hole, so any list-based model would silently close gaps the moment a conditional tool disappeared — exactly the behavior the palette exists to prevent.

## 2026-09-17 – The slot is the future hotkey identity

**Decision:** A slot index is a property of the *position*, not of the tool that currently sits there. Slot ids stay stable and independent of the button occupying them, so a later slot-hotkey feature can bind `Alt+Q` to slot 0 without touching button configuration. No keybindings are implemented yet.

**Reason:** Binding hotkeys to tools would move the shortcut whenever the palette is rearranged; binding them to positions keeps muscle memory intact, which is the same reason the slots are stable in the first place.

## 2026-09-17 – Grid drop semantics: positional, never a cascading reorder

**Decision:** Dropping in a grid is positional, not list-like. Three rules, in full:

- **within one grid / grid → grid across categories:** an empty target slot relocates the button; an occupied target slot **swaps** the two buttons. Nothing else moves — no chain of neighbours shifts.
- **flow → grid:** only empty slots accept the button. An occupied slot is rejected (the drop does nothing and the target ring is not shown), because there is no well-defined position for the displaced button in a flow list.
- **grid → flow:** ordinary flow insert semantics; the vacated grid slot becomes a hole.

Area zones (category container / tab / title) carry no position in a grid and are ignored; the user must target a cell. Sorting previews are disabled inside a grid (`SortingStrategy` returning `null`): the live drag state already shows the post-drop arrangement, so a sliding "make room" animation would be a lie.

**Reason:** The task's hard constraint is no surprising auto-reorder heuristics. Swap is the only displacement rule that is symmetric, reversible and explainable in one sentence; rejecting the one genuinely ambiguous case beats inventing a rule the user cannot predict.

## 2026-09-17 – Button-level conditions stay, and a hidden button leaves its slot empty

> **Superseded for grid palettes** by "Contextuality of a palette lives in its
> layers, not in its buttons" (2026-09-17, below). It still describes the
> unchanged behavior of flow categories.

**Decision:** Categories and buttons keep independent conditions (Phase 3 semantics unchanged, fail-open included). In a grid, a button hidden by its own condition leaves its slot empty and no other button moves. A category hidden by its own condition still disappears entirely in locked mode, exactly as before. This falls out of the model rather than being special-cased: `filterCategoriesByContext` removes the button from `category.buttons`, and the remaining buttons keep their slots.

**Reason:** Category-level and button-level dynamics answer different questions ("is this toolset relevant at all?" vs. "is this one tool applicable?"). Collapsing them into one level would force users to split categories just to make one button conditional.

## 2026-09-17 – Persistent vs. contextual is visible, and the marker is quieter in locked mode

**Decision:** Every category and button carries a status marker: **persistent** (no condition, Lucide `pin`) or **contextual** (a condition exists, Lucide `filter`). Presence of `conditions` decides — not validity — so a configured-but-invalid rule is still surfaced for correction even though it fails open at runtime (`hasConditions`, `src/context/conditions.ts`).

Presentation by mode:
- **sort / edit (management):** both states are shown explicitly, so the configuration is fully transparent; a contextual element whose rule does not currently match additionally gets the inactive variant alongside the existing `ocap-context-hidden` dimming.
- **locked (consumption):** only contextual elements are marked, in a reduced variant. Persistent tools show nothing, because a palette of static tools would otherwise be covered in pins for no information gain.

Icons are chosen so the two differ in silhouette; color only reinforces them. Each marker carries a tooltip and an `aria-label`.

**Reason:** The previous UI gave no way to tell a static tool from a conditional one, which made an empty slot unexplainable. Marking both states everywhere was too noisy in the consumption mode, where "always there" is the unremarkable default.

## 2026-09-17 – Grid layout needs no settings migration

> **Superseded** by "Palette context layers bump the settings version to 2"
> (2026-09-17, below): the layer model is a real data transformation, so it
> does get a version. The reasoning about *reflexive* bumps still stands.

**Decision:** `settingsVersion` stays at 1. `CategoryConfig.layout` and `ButtonConfig.slot` are purely additive optional fields: an absent layout means the historical flow behavior and an absent slot is only consulted inside a grid category, so no stored data needs transforming and version-1 data written today stays loadable by pre-palette builds. Categories created as flow do not persist a `layout` field at all.

Converting a category with more than 16 buttons to the grid is **refused** with an explaining Notice instead of truncating, overflowing or silently dropping buttons; the modal stays open so the user can fix it.

**Reason:** Same rule as category conditions (2026-09-16): version bumps are reserved for actual data transformations. Reflexive bumps force no-op migrations on every synced device and create artificial "future version" states in mixed-version vaults.

## 2026-09-17 – A palette is a layered surface: base/pinned plus context profiles

> **SUPERSEDED** by "Dynamic category variants replace the palette layer
> model" (2026-09-17, below), together with the four layer-model decisions
> that follow it. Kept for the history of settings version 2.

**Decision:** A `layout: 'grid'` category is a layered palette.

- `CategoryConfig.buttons` is the **base / pinned layer**: present in every
  context.
- `CategoryConfig.contextProfiles?: ContextProfile[]` are named alternative
  layers, each with a stable id, a name, **exactly one** condition (the same
  `ButtonCondition` model, edited with the same `ConditionEditor`) and its own
  buttons carrying their own slots.

At runtime: load the base layer, take the **first** profile whose condition
matches, apply its slots only where the base layer leaves them free. The result
is a pure value (`resolvePaletteForContext`, `src/utils/paletteLayers.ts`); no
stored configuration is mutated. Flow categories are untouched by all of this.

**Reason:** Five tools that belong to the same context needed five independent
per-button rules, which is neither writable nor readable. A profile states the
context once and owns the tools that belong to it.

## 2026-09-17 – Base slots are reserved in every context profile

> **SUPERSEDED** — see "Dynamic category variants replace the palette layer
> model" below. There are no pinned or reserved slots any more.

**Decision:** A slot occupied by the base layer is blocked in **all** context
profiles: it cannot be taken, overwritten or swapped from there. The reverse
also holds while the base layer is being edited — slots that context profiles
occupy are reserved against base edits, because taking one would make that
profile's tool unplaceable.

Blocked slots are never silently overwritten and never silently displace
anything: the drop is refused, the cell says why (pinned badge / reserved
marker + tooltip), and a release on a blocked cell reverts the whole drag with
an explaining Notice rather than committing the drag's last intermediate
position (`resolveGridDropOutcome`). Blocked cells register a real but refusing
droppable so the palette's background container cannot absorb such a drop.

**Reason:** The pinned layer is the part of the palette the user memorizes.
A rule that "base always wins, everywhere" is the only one that keeps that
promise without exceptions, and refusing beats inventing a displacement rule the
user cannot predict.

## 2026-09-17 – First matching profile wins; profiles are never merged

> **SUPERSEDED** in form, preserved in substance: first-match-wins,
> no-merging and the non-fail-open rule for invalid conditions carry over
> verbatim to variant triggers (see below).

**Decision:** Context profiles are ordered, and order **is** priority: the first
profile whose condition matches becomes active and the rest are ignored. Merging
several matching profiles is explicitly rejected. The user reorders profiles
(and thereby the priority) from the palette's layer selector.

A profile **without** a condition always matches — a deliberate fallback layer,
useful as the last entry. A profile whose condition is structurally **invalid**
does **not** match. This is the one place where OCAP does not fail open: a
corrupt always-matching profile would shadow every profile below it and make
their tools permanently unreachable, whereas a skipped profile only loses its
own tools in locked mode and stays fully visible and editable in the management
modes, where it can be repaired (and is marked as broken in the selector).

**Reason:** Merging would make a slot's content depend on an unpredictable
combination of rules. One winner keeps every filled slot attributable to exactly
one layer, which is what makes the palette explainable at all.

## 2026-09-17 – Contextuality of a palette lives in its layers, not in its buttons

> **SUPERSEDED** in form, preserved in substance: a grid still ignores
> per-button conditions; contextuality now lives at the variant level.

**Decision:** Inside a grid palette, `ButtonConfig.conditions` is **ignored at
runtime**. Contextuality is modelled by context profiles only, so a palette
never has two independent context systems driving the same slots. Flow
categories keep the Phase-3 per-button conditions unchanged — that is the
dividing line.

The retired model is converted rather than dropped, by one shared rule
(`liftButtonConditionsToProfiles`): buttons without a condition stay in the base
layer; buttons sharing the same **valid** condition become one profile, named
from the rule itself, losing the now-redundant per-button copy; a button with a
**structurally invalid** condition stays in the base layer and keeps that
condition untouched, because it failed open in version 1 (it was always visible)
— base is the behavior-preserving home and nothing is discarded. The same rule
runs in the settings migration and in the flow → palette conversion, so
palette → flow → palette is lossless. The button modals hide the per-button
condition editor inside a palette and state the target layer instead.

**Reason:** Two context systems on one slot cannot be reasoned about, and the
UI must not be able to express the retired one.

## 2026-09-17 – Palette visibility and context profiles are different questions

**Decision:** `CategoryConfig.conditions` keeps exactly one meaning: whether the
**whole palette** is shown. It is not the profile mechanism and is documented as
such in the field, the editor description and the i18n strings.

A palette carrying pinned base tools therefore stays visible no matter which
profile matches, or whether any does. It disappears only when its own visibility
condition fails, or when it has nothing at all to offer in the current context
(the Phase-3 "no visible buttons" rule, unchanged).

**Reason:** "Is this toolset relevant at all?" and "which tools belong to this
context?" are different questions; collapsing them would make a pinned tool
disappear because an unrelated profile did not match.

## 2026-09-17 – The selected layer is the management context

> **SUPERSEDED** — the layer selector is gone; the selected VARIANT is the
> management context now (see below).

**Decision:** In sort and edit mode a palette shows a layer selector
(`[Base / Pinned] [Type A] … [+ Context]`), and the selected layer decides what
the grid shows, what a drag operates on and where a newly created tool lands.
There is no separate "pinned" or "contextual" switch anywhere: pinned means "it
is in the base layer", contextual means "it is in a profile".

Base tools stay **visible** inside a context layer for orientation, but are
locked there: not draggable, no context menu, dimmed, marked with a pin. Sort
mode uses the same selector, so sorting never touches a layer the user is not
looking at. The layer selection is UI state, never persisted; a selection
pointing at a deleted profile falls back to the base layer.

**Reason:** A checkbox would let the two facts (where a tool is stored, what the
user is editing) drift apart. Deriving both from one visible selection makes the
question "which layer am I changing?" impossible to get wrong.

## 2026-09-17 – Palette context layers bump the settings version to 2

**Decision:** `CURRENT_SETTINGS_VERSION = 2`, with a forward-only `1 → 2`
migration that transforms grid categories as described above. This is a real
semantic transformation of stored data, not an additive field, so the reflexive
"keep version 1 because the fields are optional" rule from 2026-09-16 does not
apply here.

The migration is deterministic and reproducible — profile ids are derived from
the category id (`<categoryId>-ctx-<n>`), never from a clock or a random source
— materializes the current arrangement before splitting layers so nothing moves,
and loses no button. The chain now normalizes its result against the current
defaults, which makes `migrateSettings` idempotent over its own output.

**Consequence, accepted:** a version-2 document opened by a pre-version-2 build
shows only the base layer of a palette. Forward-only migration remains the
policy; this is simply the first release where it is user-visible in a
mixed-version vault.

**Reason:** Version bumps are for actual data transformations, and this is one.

## 2026-09-17 – SUPERSEDING DECISION: Dynamic category variants replace the palette layer model

**Decision:** The version-2 model for grid categories (base/pinned layer +
context profiles + reserved/locked slots + per-layer button ownership) is
**retired** after a manual UX test. A grid category is now either:

- **static** — one full 4×4 grid in `category.buttons`, always the same
  tools, no context behavior; or
- **dynamic** — one stable container holding several **complete** variants
  (`category.variants`). Each variant is a full, independent 4×4 grid with
  exactly one trigger, or it is the single explicit **fallback** variant.

Rules, in full:

- runtime picks exactly one variant: first matching trigger in array order,
  else the fallback, else the category is hidden. Variants are never merged;
- **no inheritance, no overrides, no pinned slots, no slot blocking, no
  mixed ownership** inside one visible grid. If two variants agree on most
  slots, those buttons are stored twice — deliberate redundancy; simple and
  predictable UX beats data normalization;
- a variant is independently editable: changing a tool in one variant can
  never change another (duplicate regenerates every button id; no shared
  object graphs);
- **Duplicate Variant is the primary workflow**: copy the working variant,
  rename it, change the trigger, adjust the few differing slots. It is
  reachable directly from the variant selector;
- the editor states, at all times, both the variant being EDITED (dominant
  dropdown + trigger line) and the variant the current context resolves to
  at RUNTIME (`Active now:`), and offers a one-click ⇄ flip between the last
  two edited variants (session-local UI state);
- without an explicit pick, editing preselects the runtime-active variant,
  so switching modes never silently changes what the grid shows;
- a switch of the active variant changes only the rendered grid content —
  the category keeps its id, position, container and name;
- the fallback is modelled explicitly (`fallback: true`, at most one, not
  movable — its position never affects resolution), never as a hidden
  always-true trigger. An always-matching *triggered* variant is expressed
  explicitly as `{ all: [] }` and respects priority;
- an invalid trigger does not match (unchanged non-fail-open rule: a corrupt
  variant must not shadow the ones below it);
- a grid (static or dynamic) ignores per-button conditions; flow categories
  keep the Phase-3 per-button model unchanged — that dividing line stands;
- static → dynamic conversion turns the existing grid into the first variant
  (nothing lost); dynamic → static/flow is deliberately **not** offered in
  this phase (it would collapse several complete grids into one);
- flow → grid: a flow category without per-button conditions becomes a
  static grid; one WITH per-button conditions becomes a dynamic category
  (fallback = condition-free tools, one full variant per distinct condition);
- drag previews and drops are computed from the drag-start baseline: a
  release means exactly "the dragged tool lands on the release cell, an
  occupant takes the vacated slot" — cells crossed on the way leave no trace.

**Reason (why v2 was retired):** the layer model demanded too much invisible
state — which layer is being edited, which layer owns a button, where to park
tools between layers, which slots other layers block. It scaled mentally
badly. Full variants make every question answerable by looking at the screen.

## 2026-09-17 – Dynamic category variants bump the settings version to 3

**Decision:** `CURRENT_SETTINGS_VERSION = 3`, forward-only step `2 → 3` (the
`1 → 2` step is kept verbatim as internal legacy code so the chain still
carries v0/v1/v2 documents). Every v2 context profile becomes one COMPLETE
variant reproducing the old effective runtime grid (base + profile on the
slots the base left free); the base-only state becomes the fallback variant
`Default`; profile order becomes priority; a conditionless profile gets the
explicit `{ all: [] }` trigger. Base copies get deterministic derived ids
(`<profileId>--<buttonId>`); nothing depends on a clock or randomness, and
the step is idempotent. Grid categories without profiles stay static;
malformed profile entries (dead data in v2) are skipped, mirroring the old
runtime filter. Flow categories pass through untouched.

**Consequence, accepted:** the migration duplicates base tools into every
variant (redundancy by design), and a v3 document opened by a pre-v3 build
shows a dynamic category as an empty grid.

**Reason:** A real semantic transformation of stored data; the old runtime
behavior is preserved exactly, with zero data loss.

## 2026-09-17 – Every grid cell is a permanent droppable; the cell is the hitbox

**Decision:** A 4×4 grid renders all 16 cells through one keyed component
(`GridSlotCell`), filled or empty, and every cell registers a dnd-kit
droppable (`slot:<categoryId>:<slot>`) whenever sorting is enabled — occupied
cells included. Droppables must never be mounted per *empty* slot again.

**Reason:** Slot droppables that mount/unmount with the occupancy race their
own registration/measurement when the occupancy changes right before a drag —
this was the root cause of the intermittent "drag dead after a variant
switch" bug (live-reproduced: the drop resolved to the container zone for the
whole drag and was ignored, self-healing on any later re-render). Stable cell
nodes make the race structurally impossible, and they make the WHOLE cell the
drop target, which is what a positional grid should offer anyway. The
collision ranking (button > slot > area zones) keeps the drop semantics
unchanged when the pointer is over a button.

**Consequence:** grid geometry must stay identical in every interaction mode
(constant cell border, chrome via colors only), so the persistent cells never
shift between locked/edit/sort.

## 2026-09-17 – A drag target without an addressable cell changes nothing

**Decision:** While a grid drag is held, a target that names no cell — the
gutter between two cells, the grid background, a title/tab zone
(`resolveGridDropOutcome` → `no-cell`) — updates neither the preview nor the
target ring, and a release on such a target commits exactly what the preview
shows instead of recomputing. The drop result also stays authoritative until
the saved settings reach the provider again.

**Reason:** `applyDragOverToItems` reports "nothing to do" by returning its
input, and during a drag that input is the drag-start baseline. Applying it
put the dragged tool back on its source slot — live-measured as 2–3 refills
per drag, 30–50 ms each, because the pointer crosses a 4 px gutter between any
two cells — and a release in a gutter silently cancelled the whole drag.
Clearing `activeButtonId` before the persisted settings arrive caused the same
one-frame fallback right after the drop.

**Consequence:** the source slot's visual state is a function of the drag
alone, never of which destination is currently hovered. Releasing next to a
cell now lands on the last cell the pointer addressed rather than reverting;
only an explicitly refused target (`blocked`) and a release outside the button
area still revert.

## An annotation bookmark keeps its source but not its page

**Decision:** a dropped ZotFlow annotation is an ordinary `file` tool — an
operational bookmark, not a second annotation store and not a knowledge node.
Its hover text is split by lifetime: the compact source (`Bieker, Westerholt
2021`) is a **snapshot** taken once at drop time, while the **page is resolved
when the hover text is needed** — from an open reader if there is one, otherwise
from ZotFlow's own `.zf.json` sidecar, read-only. The page captured at drop time
remains the fallback. Navigation never depends on any of this: it stays
(PDF vault path + annotation id), carried in the action's `subpath`.

**Reason:** the two halves age differently. A book's authors do not change, so
re-deriving them on every render would buy nothing and couple the panel to
metadata it does not own. A page label is not a fixed property of a highlight:
ZotFlow lets the user correct it afterwards ("Edit Page Number", which sends
only `{ id, pageLabel }`), and that is routine because PDFs almost always carry
an offset between the physical page and the printed folio. A bookmark that
conserved the capture-time page was therefore quietly wrong from the moment the
user fixed it — found in productive use, not in testing.

**Consequence:** the source is never synchronized and the page is never
synchronized either — it is simply looked up on demand, so there is no store, no
watcher and no sync layer. The lookup is two `getFileByPath` probes (the
installed ZotFlow build patches the sidecar path order, so both layouts are
tried) plus one `cachedRead`; the render path does no I/O. Anything unresolvable
— deleted annotation, missing sidecar, ZotFlow disabled — silently keeps the
captured page, and hovering never raises a notice. Because a name belongs to
the user and is never rewritten, no page is ever put on the button's face.
Reading the sidecar was listed as a non-goal in the original audit; that
exclusion is superseded (its section 20.6) and now covers writing only.

## 2026-09-18 – Panel templates live in one fixed, visible vault folder

**Decision:** Exported panel templates are written to, and normally imported
from, `Dynamic Action Panel/Templates/` in the vault. The path is **fixed and
deliberately not configurable**, and it is not `pathConfig.templateFolderPath`
— that field belongs to the note templates of the `create_file` action and
keeps its meaning. The folder is created on demand. The file extension stays
`.ocap.json` and the format stays `formatVersion: 1`.

**Reason:** the question a user actually has is "where are my templates?", and
every answer that involves a dialog gets it wrong. A save dialog asks the
destination again on every export; the OS open dialog cannot even be told where
to start — no web API can set a file input's initial directory — so it kept
opening wherever the user had last been, which during testing was a disposable
vault. A folder that is always the same, sits next to the notes rather than
under `.obsidian`, and can be opened in Explorer or Finder from inside the
plugin answers the question once and stays answered. Making it configurable
would reintroduce exactly the uncertainty it removes; it can still be added
later if several vaults ever need to share one external folder.

**Consequence:** the folder IS the collection. There is no index, no import
history and no second database, so a `.ocap.json` copied in from a backup drive
is importable with no further step, and one deleted behind Obsidian's back is
simply gone. The listing reads that one folder — not the vault — and offers
direct children only. The OS file picker survives as an explicitly secondary
path for files outside the vault, where its unsteerable starting directory no
longer matters. `Open template folder` is built only from public API
(`FileSystemAdapter#getFilePath` plus `window.open(url, '_external')`, the same
mechanism as Obsidian's own "Show in system explorer"), so it needs no Electron
import; on mobile it names the folder instead of opening it.

## 2026-09-18 – A newer settings schema makes the configuration read-only

**Decision:** a build that cannot interpret a stored `settingsVersion` treats
that configuration as **read-only and never persists over it**. Two cases fall
under this: a version *higher* than the one it understands, and a version that
is present but not a usable number at all. A *missing* key still counts as
unversioned upstream data and migrates normally. It reads what it can, shows what it can, and refuses every
write until the plugin is updated. There is deliberately no downgrade path:
nothing guesses at unknown fields, converts future tools, or lowers a version
number.

**Reason:** the migration pipeline already declined to migrate such a document,
precisely so it would not be downgraded — but the decision was taken at load and
then forgotten, so the next ordinary save wrote anyway. That write is worse than
it looks: the in-memory settings are a lossy VIEW of the file. Unknown top-level
keys survive the normalization, but `tools` is coerced to a record, `categories`
to an array, `panelConfig`/`pathConfig` get this build's defaults merged
underneath, and an unrecognised `interactionMode` is rewritten to `edit`.
Persisting that view would keep the higher `settingsVersion`, so no later build
would ever recognise the file as damaged or repair it. The loss would be silent
and permanent — the worst shape a data bug can take.

**Consequence:** the write lives in one place (`persistSettings` in
`src/utils/settingsWriteGuard.ts`) and every path reaches disk through it. The
three commit funnels refuse BEFORE mutating, so the panel never shows an edit the
file does not have, and each returns whether it committed so no caller can
announce a success that did not happen. The block is per plugin instance and
re-derived on every load — the panel re-reads settings each time it opens — so it
follows the file rather than the session and lifts by itself once a supported
document is loaded. The user is told once when the configuration is opened and
once on the first refused change, not per attempt. Reading, navigating, running
tools and switching views stay fully available; the settings tab renders disabled
with an explanation, because a form is the one place a visible read-only state
beats a refusal after the fact. Export stays enabled — it only reads and writes
its own file, and it is how someone rescues a category from a configuration this
build cannot edit — but it says the copy may be incomplete rather than implying
it is a backup.

## 2026-09-18 – Edit mode manages, locked mode executes

> **Superseded on 2026-09-19** by "Locked protects the layout; using and selecting work in both modes" below. Kept for the record of why the operative model exists.

**Decision:** A normal activation of a tool in **edit mode no longer runs its
actions** — neither a left click nor Enter/Space on the focused tool. Edit mode
is the management surface, where activating a cell means **selecting** it;
locked mode is the consumption surface and executes exactly as before. There is
no third mode and no "select cells" sub-mode: the panel has had exactly two
interaction modes since settings version 4.

The guard lives in `useButtonClickHandler` (`src/hooks/`), which is the one hook
both item components use. A tool is a real `<button>`, so Enter and Space
produce an ordinary click on that same path — one guard therefore covers pointer
and keyboard, and a future item component cannot bypass it.

**Reason:** the previous behavior was an accident of the upstream code — there
was no interaction-mode guard anywhere in the click path, so a slipped click
while rearranging the panel could run a script. It is also what makes cell
selection possible without a sub-mode: the plain click is free precisely because
executing was the wrong meaning in this mode to begin with.

**Consequence, accepted:** testing a tool means switching to locked mode. No
"run" entry was added to the context menu, and no one-time notice explains the
change — the selection outline on the clicked cell and the permanently mounted
palette below the grid explain it on the first click.

## 2026-09-18 – The selection unit is the cell coordinate, and it is ephemeral

**Decision:** Grid selection selects **cells**, identified by the coordinate
`r<row>c<column>` inside exactly one grid context `(categoryId, variantId |
null)`. Never a tool id, never the flat slot index. Empty and occupied cells are
indistinguishable to the selection core.

The state is **ephemeral UI state** (React state in `PanelContent`, distributed
through `GridCellSelectionContext`): never in `data.json`, never in a template,
never in a settings version. It survives ordinary re-renders and a cell-color
commit — the user usually tries a second color right after — and is dropped when
edit mode ends, the search filters the panel, the category disappears or stops
being a grid, the displayed variant changes, the rendering instance stops being
the visible one, or Escape is pressed.

`variantId === null` means the **static** grid, strictly. The domain layer's
`resolveGridVariantId` reads a null id on a dynamic category as "the first
variant"; for a selection that would silently address the wrong grid, so
`setCellColorsInState` carries its own guard and refuses every mismatched
combination instead.

**Reason:** only a coordinate can address an empty cell, only a coordinate
survives a resize unchanged (a flat slot index means a different cell as soon as
the column count changes), and it is exactly the key `cellStyles` is already
stored under. Persisting a selection would make a work-in-progress gesture part
of the configuration and would have to be migrated, exported and validated
forever.

## 2026-09-18 – Replace / add / remove, and never a toggle

**Decision:** The three selection gestures are fixed:

```
plain click = replace    Shift = add    Ctrl (Cmd on macOS) = remove
```

Shift **never** deselects, Ctrl **never** selects, and a second plain click on
the only selected cell leaves it selected. There is no toggle, no range and no
rectangle selection, and no marquee. Shift+Ctrl resolves deterministically to
`add`; on macOS Ctrl+click is the secondary click and is ignored entirely, so a
context menu can never open together with a selection change.

Shift and Ctrl are inert on a grid that does not already hold the selection —
only a plain click moves the selection to another grid. At most one grid carries
a selection.

**Reason:** this is the classic desktop/DCC model the user asked for, and its
value is that each key has exactly one direction. A toggle would make "what does
this click do?" depend on invisible state; a modifier that reaches across grids
would create a selection spanning two categories, which nothing downstream could
address.

## 2026-09-18 – A cell color belongs to the coordinate, and `cellStyles` stays its only home

**Decision:** Cell colors are written through one pure operation
(`setCellColorsInState`, `src/domain/categoryOps.ts`) into the **existing**
`cellStyles` field — on the category for a static grid, on the variant for a
dynamic one. No second color persistence, no `settingsVersion` bump, no template
format bump. Clearing a color removes the entry, and an emptied map removes the
field, so untouched data stays byte-identical to data written before cell colors
existed.

Coloring a whole selection is **one** operation and **one** commit, never one
per cell. The operation returns the same state object when it changes nothing,
so a no-op never causes a save or a panel refresh.

Stored values stay portable (`ocap:<name>` or a hex literal) and are resolved to
CSS only at render time: `ocap:red` becomes `rgba(var(--color-red-rgb), …)`, so
the color follows the theme without a `var(--…)` ever being persisted. **Gray**
has no Obsidian color variable and resolves through `--mono-rgb-100`, the same
theme-neutral mechanism the grid raster already uses.

The resolver deliberately understands **more values than the palette offers** —
all eight Obsidian color names and every hex literal — because a template import
can carry them at any time, and a value this build could not draw would look
exactly like data loss. An unknown name renders as uncolored and is never
rewritten.

**Reason:** the data model was designed for this in advance and needed no
change. The one thing that had to be added was the render path: `ResolvedGridView`
did not carry `cellStyles`, so no component could see a color.

## 2026-09-18 – Cell colors are content; selection is chrome

**Decision:** Cell colors render in **every** interaction mode, locked included,
because they are content: a colored empty cell is a separator, a group marker or
a reserved place. Such a cell stops being `aria-hidden` in locked mode but never
becomes a control. The selection outline, the palette and the `+` exist only in
edit mode.

Visually the two are separate channels and neither may take the other's: the
**color** is the cell background, the **selection** is
`outline: 2px solid var(--interactive-accent)` inset by 2px. `border-color` is
reserved for the drop-target rings that promise where a drop lands, `border-width`
is frozen by the grid's geometry contract, `1px dashed var(--text-faint)` already
means "hidden by its context", and `opacity` is used by the target states. The
specificity needed to beat the managed ground while still losing to the drop
rings is pinned in `tests/paletteGridGeometry.test.ts` rather than left to
authoring order.

**Reason:** a red selected cell has to read as red *and* as selected at the same
time, and an outline is the only free channel that never takes part in layout —
which the grid requires, because its cell rects must not move between modes.

## 2026-09-18 – The `+` becomes a corner affordance so the cell surface can be selected

**Decision:** The `+` of an empty cell is no longer the cell. It is an 18px
target in the top-right corner, inset 2px, dimmed at rest and stronger when the
pointer is on its cell. The cell surface it vacated is the selection surface.

**With Shift or Ctrl held the `+` is not a button at all**: the click is treated
as an ordinary cell click and no create modal opens. A stray corner hit in the
middle of building a selection is the worst misclick this feature can produce,
so it is ruled out rather than made unlikely.

Because the `+` used to swallow the press of an entire empty cell (which is what
kept a press on it from starting the list view's category drag), the grid
container now does that for bare cell surface instead. A press on a tool is left
untouched, so the button drag and every existing category-drag path behave
exactly as before.

**Reason:** a full-cell `+` made the empty cell unselectable, which was the one
structural blocker against modifier-only selection. Moving it is what removed
the need for a "select cells" sub-mode entirely.

## 2026-09-18 – A modifier on the palette never writes

> **Partly superseded on 2026-09-20** by "The palette speaks the grammar of the
> grid": `Ctrl + swatch` no longer REPLACES the selection with the colour
> group — it removes that group from the selection, and the plain click does
> the selecting when there is nothing to paint. The rule that only a plain
> click can write survives, in a sharper form.

**Decision:** In the color palette a **plain click is the only gesture that
changes the configuration**. `Ctrl + swatch` replaces the selection with every
cell of that color, `Shift + swatch` adds them to it, and both work on `No
color` too (selecting the uncolored cells of the grid). The search is strictly
inside the grid on screen — never another variant, never another category.

The palette is mounted for the whole of edit mode rather than appearing with the
first selection, for two reasons that are both about not moving things under the
pointer: a bar that appears on the first click pushes the grid down so the next
Shift-click lands on the wrong cell, and `Ctrl + swatch` is a selection tool that
must work before anything is selected.

**Accepted asymmetry:** Ctrl means "remove" on a cell and "replace" on a swatch.
They are different surfaces; what unites them is the rule above, and it is stated
in the swatch tooltip rather than left to intuition.

**Reason:** the palette is the one place where a slipped modifier could rewrite
many cells at once. Making every modifier gesture read-only turns it into a
surface the user can explore without risk.

## 2026-09-18 – A mode change changes what a press means, never the layout

**Decision:** Locked and edit mode render the **same panel**. The grid raster —
the visible border of every cell and the frame around the field — is drawn in
both, occupied cells carry the same ground in both, the tool fills its cell in
both, and the 16px resize gutter is reserved in both (empty and pointer-through
in locked). Only the *affordances* are mode-specific: the selection outline, the
corner `+`, the colour palette, the resize handles and the variant selector
belong to edit; executing a tool belongs to locked.

**Reason:** the previous split made the same grid look like two different panels,
and the manual test named exactly that as the problem — the design "jumped" on a
mode switch. Three of the four differences turned out to be accidents rather than
intent (two CSS specificity collisions with the upstream `.icon-top`/`.icon-left`
rules, plus the raster being gated on `--managed`); the fourth, the resize
gutter, was real but is space, not affordance, and space can be reserved.

**Consequence for new chrome:** anything that is only *usable* in one mode may be
hidden in the other, but it may not change a single cell rect when it goes. If it
occupies layout, its space stays reserved. Pinned in
`tests/paletteGridGeometry.test.ts`.

## 2026-09-18 – The rectangle is a modifier DRAG, not a Shift-click range

**Decision:** Shift-drag adds a rectangular block of cells to the selection,
Ctrl/Cmd-drag removes one. It is the existing click semantics applied to an area:
`Shift click = add one cell` / `Shift drag = add a rectangle`. Below the 4px drag
threshold the gesture *is* the click and behaves exactly as before. There is no
new mode — the panel still knows only `locked` and `edit`, and a modifier is a
temporary gesture.

This **supersedes** the v1 non-goal "no rectangle/marquee" in
`docs/ocap/cell-selection-colors.md` §4.1 and §15.

**Three things it deliberately is not:**

- **not a Windows-Explorer range.** `click r1c1` then `Shift-click r1c5` still
  adds exactly one cell. A drag expresses the same intent more flexibly and
  without an invisible anchor;
- **not a brush.** The path between anchor and pointer is irrelevant; only the
  rectangle between them counts;
- **not a free pixel marquee.** The unit is the cell, so there is no overlap
  percentage and never a half-selected button. The live preview is the existing
  selection rendering snapping to whole cells; a free preview rectangle stays a
  later option if the snapping turns out to feel coarse.

**Two invariants carry it:**

1. **A modifier press reserves the selection.** Decided at pointer-down and never
   revised: no tool move, no swap, no category reorder, on filled and empty cells
   alike. Enforced in the capture phase inside a grid and by wrapping dnd-kit's
   activator outside it — no global switch that a key-up could leave stuck.
2. **Every step derives from the baseline** captured at pointer-down, never from
   the previous step, so growing and shrinking within one gesture always lands on
   `baseline ± rectangle`.

**Reason:** selecting a dozen cells is the most common action in this surface and
was the most tedious. The gesture had to be added without introducing a mode, a
second interaction framework, or a second meaning for an ordinary drag.

## 2026-09-18 – The paint colour belongs to the selection, not to the panel

**Decision:** Applying a colour to a selection also **arms** that colour for the
rest of that selection session. An additive gesture — Shift-click or Shift
rectangle — then paints exactly the cells it newly adds. "No colour" is armed the
same way, because choosing it is just as deliberate. A modifier click on a swatch
never arms anything (it still never writes), and with nothing selected nothing is
armed at all.

The armed colour is **ephemeral**: React state in `PanelContent`, dropped the
moment the selection names a different grid or no grid — which covers cleared,
Escape, mode change, category change, variant change in one rule. It is never
written to `data.json`, the settings or a template.

**Write behaviour:** nothing is saved during a drag; the cells show the colour as
a preview. Pointer-up produces exactly **one** bundled persistence operation for
the newly added cells. The preview is held until the stored colours actually
carry it, for the same reason the resize preview holds its geometry.

**Explicitly separate:** `Ctrl` removal never paints. A red cell removed from the
selection stays red — selection and cell colour remain different concepts.

**Reason:** having just painted a block red, extending it almost always means
"these too". The alternative — a persistent paint tool or an armed brush — would
be a second mode with invisible state, which this project has already retired
once (Phase 4b).

## 2026-09-18 – Selection is a STATE, the gesture is a SHAPE

**Decision:** A selected cell is **washed** with a translucent accent tint; the
running rectangle gesture draws **one continuous outline** around the whole
block, gaps included. Two signals, two questions: which cells are chosen, and
what is the hand doing right now.

**Reason:** the first version answered both with the same per-cell accent ring,
and it answered neither well. At four or five columns the rings tiled and the
4px gutters cut the block into pieces, so a selection read as "these cells" and
never as an area. Worse, `Ctrl`-removal had nothing to show at all: its cells
merely stopped being ringed, so the user could see selection disappearing
without seeing which block was doing it. Splitting state from shape is what the
feature was missing.

**Consequences, all deliberate:**

- the wash is an **inset `box-shadow`**, the one channel still free. It paints
  above the cell's background and below its contents, so a coloured cell stays
  recognisably coloured and the tool on it stays legible; the 1px border — the
  raster and the drop promises — is outside the padding box it is clipped to;
- the outline is placed from **four integers** (row, column, rows, columns)
  against the grid's own track sizes, so it is exact at any panel width and
  nothing measures pixels. It is absolutely positioned (an in-flow grid item
  would occupy tracks and displace the auto-placed cells) and
  pointer-transparent (it must never swallow the gesture it draws);
- a removal additionally marks the cells it is dropping, in the same channel and
  in the error colour, so they change **in place** from "selected" to "leaving";
- the tints derive from Obsidian's own accent components, each `var()` carrying
  a fallback — an undefined variable inside a colour invalidates the whole
  declaration, and the wash would silently not render.

None of this touches what is selected. The selection logic is unchanged.

## 2026-09-18 – A drag never changes a category's collapse state

**Decision:** Collapsing and expanding a category in list view is the user's
alone, through the category's own title. No drag — of a tool, of a category, of
anything — may change that state, not even for the length of the gesture. A
collapsed category is consequently **not a drop target**; expanding it first is
the way in, and it is visible.

**Reason:** the previous behaviour revealed *every* collapsed category for the
duration of *any* button drag and folded them all back on release. Dragging a
tool at the bottom of the panel therefore unfolded a category at the top, moved
everything below it mid-gesture, and put it back afterwards. The state looked
like it had changed by itself, because it had. The companion mechanism — a 0.4s
drag-hover that expanded a collapsed category — was removed with it: it changed
the same state without being asked on the category itself, and it did not even
undo itself afterwards.

**Bonus:** one fewer layout change while a drag is in flight, which slot
geometry is better off without (the same reasoning as the definite row track).

## 2026-09-19 – The selection keeps a contour of its real shape

**Decision:** The current selection carries a **persistent outline** that
survives the gesture which produced it, and that outline traces the selection's
actual shape — never a bounding box. Holes get their own inner contour,
disconnected islands each get their own, and a diagonal touch stays two shapes.

Three layers now, three questions: the **wash** says which cells are chosen, the
**contour** says what shape they make, and the **dashed gesture box** says what
the hand is doing right now.

**Reason:** the wash alone was too soft to read as a form, and the gesture's own
outline disappeared on release — so the most interesting selections, the ones
built by subtracting a block from a larger one, were exactly the ones with no
shape to see.

**How, and why it is this small:** one rule does all of it —

> a cell draws a border on each side whose orthogonal neighbour is not selected,
> and every piece reaches half a gutter toward every side that has an in-grid
> neighbour.

Following the cells' own edges means the topology is correct for free; no
polygon is computed, no contour is traced, no SVG is needed. The uniform reach
is what turns tiled boxes into one shape: two neighbouring pieces meet exactly
in the middle of the gutter, and — less obviously — a CONCAVE corner closes
exactly for the same reason. Reaching only toward *selected* neighbours would
leave a notch there. At the grid's own boundary there is nothing to meet, so a
piece stops at the cell edge and the contour stays inside the grid frame.

**Consequences:**

- corners are square: with only some sides drawn, a radius renders as a hook off
  the end of a border with no neighbour to curve into;
- the gesture preview became **dashed** and is drawn above the contour, so
  "provisional" and "settled" are told apart by style rather than by position.
  Both are placed on the same gutter midline, so where an add-rectangle happens
  to coincide with the resulting shape they sit on one line instead of nesting;
- both overlays share one piece of track arithmetic (`.ocap-grid-overlay`), so
  neither can drift when a track size is tuned.

The selection logic is untouched. This is presentation only.

## 2026-09-19 – A selection ends with Escape or with a click on nothing

**Decision:** Besides Escape, a click on empty panel background clears the cell
selection outright. Both cost nothing: no button, no mode, no new state.

**What counts as background is an EXCLUSION list**, not an allowlist of
backdrop elements. A backdrop is not something anyone renders; it is what is
left between the things that are, so naming the leftovers would mean inventing
a class for every gap in every view and keeping it right forever — and the
first one forgotten would swallow a click that belonged to a control. Naming
the CONTROLS is the shorter and more honest list, and a control that forgets to
appear in it fails loudly (its click also clears) rather than silently (its
click stops working). Excluded: the grid, its frame and cells, tools, the
palette, the category title, the variant bar, and every ordinary button, input
or link.

**The decision is made on the CLICK, never on the press.** In list view that
same background is the category drag handle, so clearing at pointer-down would
destroy the selection at the start of every category drag. The press is only
remembered; the clear waits until the gesture has proved to be a click — at
most 4px of travel, the threshold shared with every other click check — and an
activated drag forfeits its click outright, whatever the distance.

This **supersedes** "a click outside the grid has no effect" in
`cell-selection-colors.md` §4.2. That rule was argued from ambiguity — "outside"
means different things per view — which does not apply to *empty* background: a
surface with no action of its own cannot lose one.

## 2026-09-19 – Locked is the working mode: files may be dropped there

**Decision:** Dropping a file from Obsidian onto a grid cell creates a tool
there in LOCKED mode too, and a drop on an OCCUPIED cell replaces it without a
confirmation. Locked stops being "read-only" and becomes what its name always
implied: the mode where the panel is *used*.

**The line is not between the modes, it is between bringing something IN and
rearranging what is already there.** A drop brings something in. Moving,
swapping, reordering, resizing and the `+` rearrange (selecting and colouring
were listed here too until the operative model below moved them out), and
all of them stay edit-only.

That line happens to coincide with a technical one, which is what keeps it
cheap and safe to hold: a file drop is a **native HTML5 drag from outside**,
while the plugin's own drag is pointer-based (dnd-kit). Only the file-drop gate
was taken off the mode; `droppableEnabled` — the internal one — still follows
edit mode exactly as before. Locked mode was NOT made "DnD capable".

**No confirmation on replace.** Aiming a file at a particular cell is already
the deliberate act; a dialog on top of it would only be a second one. The
displaced tool is collected by the ORDINARY rule (`gcTools`), so a definition
still placed in another variant, another category, or marked `library`,
survives losing this one placement. Replacing is opt-in at the call site
(`createToolInCategory`'s `replaceOccupied`), because every other entry point —
the `+`, the modal, a copy — means "put this somewhere" and must keep dodging to
a free slot.

**One implementation.** The drop path is the same parse → draft → create →
commit it has always been; only the gate moved. The renderer now also tells the
hook which variant the drop landed on, because in locked mode there is no
editing selection and the old fallback ("the first variant") would file the tool
into a grid nobody was looking at.

## 2026-09-19 – Locked protects the layout; using and selecting work in both modes

**Decision:** The two modes differ in exactly one thing — whether the LAYOUT may
change (`allowsLayoutEditing`). Everything operative works the same in both:

    plain click       = USE the tool         (locked AND edit)
    Shift / Ctrl(Cmd) = SELECT cells         (locked AND edit)
    locked / edit     = layout locked / layout editable

Selection, rectangles, the colour palette, select-by-colour, Escape and the
background clear, and file drops are available in locked mode. Edit adds the
spatial manipulation of what is already there: move, swap, category reorder,
resize, the `+`, and the restructuring context menus.

This **supersedes** "Edit mode manages, locked mode executes" (2026-09-18).

**A plain click no longer touches the selection.** It runs the tool — in edit
mode too — and a click on an empty cell does nothing. The old rule "plain click
= replace the selection with this cell" is gone: it collided with using the
tools, and choosing cells is now always an explicit, modified gesture. `replace`
survives only as a set operation (a rectangle's live preview; since 2026-09-20
the palette no longer uses it either).

**Who decides what a click means:** the grid, in the CAPTURE phase, before the
tool sees it (`gridClickMeaning`, pure and mode-free): `run-tool`, `select`, or
`ignore` for the click that ends a drag or a rectangle and for macOS' Ctrl
secondary click. The protection the old model existed for — a slipped click
starting a script while rearranging — is kept by a different, narrower rule: a
DRAG never runs a tool (its closing click is swallowed even when the tool comes
back to its own cell), and a MODIFIER click never runs one.

**A mode toggle is not a change of grid.** The selection is bound to the
domain-level grid identity `(categoryId, variantId)`, not to a mode and not to a
render position, so toggling keeps the selection, its contour and the armed
paint colour. The same holds for a category reorder: the dragged category's
grid is replaced by its preview for the length of the drag, so the deferred
"is this grid gone?" check stands down while a category drag is active and asks
again once the drop has remounted the real grid. (Before, gating selection on
`sortableEnabled` took every grid offline during any category drag, because the
drag provider pauses button sorting while a category moves.) Real context
changes — another category, variant or grid, a search, Escape, the background
click — still end it.

**Escape from nowhere.** With the selection now outliving a toggle, pressing
Escape right after one is normal — and a toggle rebuilds the category blocks,
unmounting whatever had focus, which then falls back to `<body>`. Escape now
counts when it comes from anywhere in the panel's leaf (toolbar included) or
from `<body>`; a modal, a menu or the editor still hold focus themselves and are
still left alone.

**Reason:** the previous split had two everyday costs that outweighed its
protection: tools stopped working the moment the panel was unlocked, and the
working set of cells vanished the moment it was locked. What locking is actually
for is the layout, and that it still protects completely.

## 2026-09-19 – One active selection context; Shift moves it, Ctrl never reaches across

**Decision:** The panel holds exactly one selection context at a time — the
domain identity `(categoryId, variantId)` of one grid, never a render position.
Across a grid boundary:

- **Shift** click, Shift drag or Shift + swatch in grid B while A holds the
  selection clears A and makes B the context with exactly the new cells.
- **Ctrl/Cmd** click or drag in B is a **no-op**: A stays, B gets nothing, no
  tool runs.
- A **plain click** on a tool in B runs it; A stays.

The move does not carry A's armed paint colour into B, and Escape during a
context-moving Shift rectangle restores A's whole selection rather than leaving
nothing.

**Reason:** since a plain click no longer replaces (operative model), Shift is
the only gesture that *starts* a selection. Keeping the old "modifiers are inert
on a foreign grid" rule would have made every grid but the current one
unreachable without Escape first. Ctrl can remove nothing where nothing is
selected, so it must not discard anything elsewhere either.

This **supersedes** the cross-grid bullet of `cell-selection-colors.md` §4.2
(plain click moves the selection, Shift/Ctrl inert on a foreign grid).

**Also decided in the same round:**

- **The category grab surface is background.** The free area of a list
  category block — where the grab cursor shows — clears on a short click and
  stays a category drag above the threshold. The block carries dnd-kit's
  `role="button"`, which had hidden it behind the exclusion list; exactly
  `.sortable-category-item` is now treated as an inert drag surface. Tabs and
  folder tiles are drag handles too, but their click does something, so they
  stay excluded.
- **A held modifier shows a selection cursor.** Shift or Ctrl/Cmd turns every
  grid surface to `cursor: cell`, in both modes. Visual only: one class on the
  panel content, no state, no event stopped.

## 2026-09-19 – The cursor tells the truth, and a category moves only by its handle

**Decision, one sentence:** the cursor says what a press does at exactly this
spot, and the two things a category header used to do at once are separated in
space.

**The cursor model**, highest priority first:

1. a layout drag in flight -> `grabbing`
2. Ctrl/Cmd held -> a bold minus (remove from the selection)
3. Shift held -> `cell`, the system's bold plus (add)
4. edit mode, a tool that can be moved -> `grab`
5. otherwise the surface's own meaning: a tool that runs and the `+` ->
   `pointer`, a cell or a gutter -> `default`

An empty cell shows the plain arrow because there is nothing there to pick up —
the old grab hand covered whole categories and promised one. A tool in edit
mode shows the hand on the BUTTON as well as on its drag wrapper: the pointer
is over the button, whose own `cursor: pointer` used to win, so the movable
thing looked like a mere click target. The hand appears exactly when the drag
wrapper exists, i.e. when the tool really can be moved.

With both modifiers held the cursor shows ADD, because that is what the press
would do (Shift wins). A cursor that promises something other than the gesture
is worse than none.

**Priority is built in, not left to specificity.** The panel carries
`data-ocap-selection-intent`, which sets ONE custom property, and every grid
surface names its own cursor merely as that property's fallback:
`cursor: var(--ocap-selection-cursor, grab)`. There is no native "minus"
cursor (`zoom-out` is a magnifier and means something else), so it is a small
embedded SVG data URI drawn like the plus of `cell` — white bar, black rim,
hotspot in the middle — falling back to `cell`. Step 1 is the only rule that
must beat everything, Obsidian's cursors included, and it is the model's only
`!important`; it lives for exactly as long as dnd-kit reports an active drag.

**The category drag handle:** in list view the whole block used to be the drag
activator, so every free pixel moved the category and the header both folded
and moved. A small grip (`grip-vertical`) now sits first in the header, before
the icon, and is the only place a reorder starts. The header folds, and nothing
else — grid, empty cells, the space below the grid and the rest of the block
start nothing. The block stays the sortable ITEM; only the activator moves, via
dnd-kit's own `setActivatorNodeRef`. Reorder, drop, preview, animation and
state are untouched.

A click on the handle does nothing at all: it does not fold (it stops its own
click before the header sees it) and it does not clear the selection (it is on
the backdrop exclusion list). A modifier suppresses the drag there too. Being a
LAYOUT affordance it exists only where layout editing does; elsewhere its space
stays reserved but empty and pointer-transparent, the same rule the resize
gutter follows, so the header does not shift when the mode changes.

Tabs and folder tiles keep the old arrangement: the compact element is its own
handle and has no large free area to make a false promise.

**Consequence for the background clear:** the free category area is no longer a
drag surface, so no drag engine forfeits a click there any more. A press that
has EVER travelled past the threshold now forfeits its click by itself, which
keeps "wander off and come back" from clearing the selection.

## 2026-09-20 – The palette speaks the grammar of the grid

**Decision:** a swatch names a GROUP of cells — the cells of that colour in the
grid on screen, with "no colour" being the uncoloured group — and the palette
answers the same three gestures as the grid:

|                | nothing selected            | something selected        |
|----------------|-----------------------------|---------------------------|
| plain click    | select that colour's cells  | paint the selection       |
| Shift + click  | add that group              | add that group            |
| Ctrl/Cmd click | nothing to remove: no-op    | remove that group         |

This **supersedes** `Ctrl + swatch = replace the selection with every cell of
this colour` (DECISIONS, 2026-09-18) and with it the "accepted asymmetry" that
Ctrl meant *remove* on a cell and *replace* on a swatch. It was the only place
left in the panel where Ctrl/Cmd did not mean remove. What replace was good for
— "give me every blue cell" — is now the plain click, and precisely where that
click had nothing to paint anyway. Removing a colour group from a selection,
which the old rule had left for later, falls out for free.

The rule that made the bar safe to explore survives in a sharper form: **only a
plain click with a selection present writes**, and only that one arms the
selection's paint colour (§8.2). Building a selection out of colour groups
never arms anything.

**Selecting is an ADD, never a REPLACE.** That is what it is — an add onto an
empty selection — and it keeps the panel-wide context rule (§4.2) intact: an
add may move the one active context to this grid, a remove may never reach
across. So a plain swatch click in a grid that holds no selection takes the
context there, and Ctrl in a foreign grid stays a no-op, exactly as on cells.

**The tooltip states the effect of THIS click in THIS state** — "Select all
blue cells", "Apply blue to selection", "Add all blue cells to selection",
"Remove all blue cells from selection" — and changes live with the keys held.
It replaces the old three-in-one manual (`Click: apply · Ctrl+click: select
these cells · Shift+click: add them`). With Ctrl held and nothing selected it
says that nothing would happen, rather than promising a removal: a tooltip that
describes a state other than the current one is the manual again.

**One decision function** (`cellPaletteAction.ts`) yields the action, the
selection gesture and the tooltip key, so the click handler and the tooltip
cannot drift apart; the cursor follows from the same held-modifier tracker the
grid already uses (a swatch shows the plus and the minus like a cell does).
Both modifiers held resolve as everywhere else — Shift wins, and tooltip and
cursor say "add".

## 2026-09-20 – A container is not a control because it holds one

**Decision:** the backdrop's exclusion list names only elements whose OWN click
does something. A bar that merely holds controls never belongs on it.

The list is matched with `closest`, so every entry walls off its whole subtree.
That is right for a control — its icon and its label are part of it — and wrong
for a container: the colour palette and the variant bar were listed, so every
free pixel beside their buttons stopped clearing the selection, and the user had
to hunt for the thin strip between two categories to deselect. Both are off the
list; their buttons are `button` elements and stay excluded on their own
account.

The grid stays on the list, and not as a control: what a press on a cell means
is the grid's decision (run the tool, select with a modifier, drop a file), and
the 4px gutter between two cells deliberately means nothing. An empty cell is a
drop target and a creation spot, not leftover space. The two groups are named
separately in the source so the reason for each entry is visible.

**The surface is the whole view, not just the rendered panel.** The listener
sits on this view's `view-content`, so the empty room below the last category
counts like the gap between two of them. It stops at the view: the editor, a
modal and another leaf remain none of the panel's business.

Click-vs-drag is unchanged: nothing happens on the press, a click decides, and a
press that ever travelled past the shared threshold forfeits its click.

## 2026-09-20 – A swatch is a paint colour: choose it, then work with it

**Decision:** a plain click on a swatch always means the same thing — paint
with this colour. With cells selected it paints them and stays chosen; with
nothing selected it just gets chosen, and the next Shift gesture in the grid
carries it onto the cells it brings in. Shift and Ctrl/Cmd keep addressing that
colour's cells as a SET (add / remove) and never paint, never change the chosen
colour.

This **supersedes**, on the same day, "with nothing selected, a plain click
selects that colour's cells" (the rule that replaced `Ctrl + swatch = replace
the selection`). Manual acceptance rejected it: the same gesture would have
meant two unrelated things depending on a state the user cannot see — and a
swatch that sometimes selects instead of painting is a special case, not a
grammar. Fetching a colour's cells is what the modifiers are for, and they say
the same thing on every surface of the panel.

**Arming needs no selection.** The paint colour could previously only be set by
applying it, so it was reset by the very transition that now has to keep it:
from no selection to one. The context watcher keeps the colour across exactly
that step and disarms on every other change, and an explicit "never mind" —
Escape or a click on free background — drops it outright, which is why both of
those now stay active while a colour is armed and nothing is selected.

**The chosen colour is visible.** It gets the loud marker — an accent ring
around its swatch — because it is the one state with no other representation on
screen: what the next Shift gesture will paint. What the SELECTION currently is
keeps a quieter one, the swatch's own border in `--text-normal`. Both are
outline/border only, so no pixel of the bar moves, and both follow the domain
values rather than `:focus`.

## Open decisions

The following are still open:

- final dynamic-component extension API (`enabledWhen`, dynamic label/icon next);
- slot hotkeys (the slot identity is ready; the keybinding layer is not designed yet);
- whether grid dimensions stay fixed at 4x4 or become configurable per category;
- test coverage targets and component/UI testing approach (unit-test stack is decided: Vitest; editor DOM currently covered by live smoke tests only);
- locked-mode empty state when every category is context-hidden;
- packaging and release strategy for OCAP;
- final OCAP manifest `id` and public product naming details.
