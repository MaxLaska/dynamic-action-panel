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

## Open decisions

The following are still open:

- final dynamic-component extension API (`enabledWhen`, dynamic label/icon next);
- slot hotkeys (the slot identity is ready; the keybinding layer is not designed yet);
- whether grid dimensions stay fixed at 4x4 or become configurable per category;
- test coverage targets and component/UI testing approach (unit-test stack is decided: Vitest; editor DOM currently covered by live smoke tests only);
- locked-mode empty state when every category is context-hidden;
- packaging and release strategy for OCAP;
- final OCAP manifest `id` and public product naming details.
