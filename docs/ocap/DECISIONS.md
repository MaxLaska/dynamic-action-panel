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

## 2026-09-20 – The mouse button carries the meaning (experimental prototype)

**Decision, to be judged by using it:** the panel drops the locked/edit mode
and puts part of the meaning on the mouse button instead.

    left                 use it: run the tool, or drag it to move it
    right                context: the menu for what is under the pointer
    right, dragged       reserved — no menu, no selection, no move
    Shift + right        add a cell or a rectangle to the selection
    Ctrl/Cmd + right     take one out of it

**Why this dissolves the mode.** The two modes existed for one ambiguity: a
filled cell cannot let ONE button mean both "run this tool" and "select this
one cell". Everything else the modes protected had already moved elsewhere —
click versus drag is decided by the 4px threshold, a category moves only by its
grip, and selection works in both modes anyway. With the selection on the
button that had no job in a grid of buttons, nothing is ambiguous, and there is
nothing left for a mode to protect. So every layout affordance — move, reorder,
resize, `+`, context menus — is simply always available.

**One decision per press.** Button and modifiers are read at pointer-down and
latched (`gridPointerIntent`); the click handler, the rectangle drag and the
context menu all read that latch instead of re-reading the event. A modifier
released mid-gesture cannot change what the gesture is, and a selection gesture
can never also open a menu — the native `contextmenu` is suppressed in the
grid's capture phase, before the tool's own listener sees it. A right press
that travelled past the threshold opens no menu on release either.

**A modifier no longer changes what the LEFT button does, anywhere.** Shift+left
runs a tool, Ctrl+left runs a tool, a modified left drag moves it. The guards
that used to swallow modified presses on the category handle, the tabs and the
folder tiles are gone, and so is the `+`'s "step aside while selecting" branch.
One button, one meaning.

**The palette stays on the left button.** A swatch is an explicit control, not a
piece of grid: plain click chooses the paint colour, Shift adds that colour's
cells, Ctrl/Cmd removes them — all with the left button. The asymmetry is
deliberate: in the grid the BUTTON decides, on a control the MODIFIER does.

**Reversibility was a requirement, not an afterthought.** `panelConfig
.interactionMode` keeps whatever it holds; nothing is migrated, no schema
version moves, and the runtime simply stops reading it
(`SINGLE_INTERACTION_MODE`). Restoring the switch is that one constant plus the
nav-bar button. A stored "locked" is proven at runtime to change nothing.

**Not decided here:** what a right-drag should eventually mean, and how an
outbound resource drag (a PDF from the panel into a note) will be told apart
from a left-drag move. Both are reserved, not solved.

## 2026-09-20 – Corrected: left uses, right moves

**Decision, after using the first attempt:**

    left click           use it — run the tool
    left drag            RESERVED: no move, no selection, and no run on release
    Shift + left         add to the selection (a cell, or a rectangle)
    Ctrl/Cmd + left      take out of the selection
    right click          the context menu
    right drag           move the tool / swap

This **supersedes "The mouse button carries the meaning"** of the same day,
which had the selection on the right button and the layout move on the left.
The idea survives — the button carries part of the meaning, and the mode is
gone — but the assignment was backwards: the left button is where a hand
expects "use this", and moving a tool around is the odd job that belongs on the
odd button. Selecting cells with the right button also fought every habit the
rest of the panel already had (the palette's modifiers are left-button), and
the two Shift gestures then meant different things depending on the button.

**The left drag is deliberately empty.** It is the obvious place for a future
outbound resource drag (a PDF from the panel into a note), so it is kept free
rather than given a second-best job now. It must not run the tool on release
either: a press that has travelled stays travelled, which is the same rule the
click check has always used, now latched instead of measured from the endpoint.

**Two drags, two buttons, one dnd-kit.** The sensor accepts both buttons and
each draggable filters the press (`activateOnButton`): a TOOL answers to the
right button, a CATEGORY grip to the left — and there, never while a selection
modifier is held, because there is no cell to select out there but reordering
under a held Shift would still be a surprise.

**One menu is swallowed after a right drag**, armed from the drag itself
(`suppressNextContextMenu`) rather than from the grid, because a button drag
remounts the category subtree and the grid forgets the press that started it.
It fires once and clears itself; there is no standing block.

**The cursor follows:** a tool rests on `pointer` — the left button runs it —
and shows the closed hand only for the duration of a real drag. The grip keeps
`grab`.

## 2026-09-20 – Die Bedienreferenz steht an einer Stelle, und ein Rechtsklick weiß, worum es geht

Zwei kleine Bausteine, die dasselbe Ziel haben: das Panel soll erklärbar sein
und seine Eingaben sollen benennbar werden.

**1. Eine Referenz, nicht mehrere.** `src/utils/interactionReference.ts` ist die
einzige Stelle, an der die Maus-Grammatik für den Nutzer geschrieben steht.
Das Hilfe-Modal rendert sie, die Settings könnten sie später ebenso rendern.
Eine zweite Kopie wäre keine Redundanz, sondern eine Garantie auf Drift: die
Grammatik hat sich innerhalb eines Tages zweimal geändert, und ein Hilfetext,
der eine abgeschaffte Geste beschreibt, ist schlechter als gar keiner. Die
Tests prüfen deshalb nicht die Formulierung, sondern dass keine der verworfenen
Regeln dort auftaucht (Linksdrag verschiebt, Auswahl auf der rechten Taste,
Locked/Edit, "Klick auf eine Farbe wählt alle Zellen dieser Farbe").

Der `?`-Knopf sitzt in der vorhandenen Panel-Toolbar neben dem Zahnrad. Er
ersetzt nichts und verschiebt nichts; das Modal ist ein gewöhnliches Obsidian-
Modal (Escape, Klick daneben, kein eigener Rahmen, kein eigenes Farbschema).

**2. Ein Rechtsklick hat ein Thema.** `resolveContextTarget` beantwortet genau
eine Frage: Geht es um das Tool unter dem Zeiger (**Tool Context**) oder um die
Auswahl, zu der es gehört (**Selection Context**)? Die Regel ist eine Zeile —
ein Rechtsklick **innerhalb** der Auswahl meint die Auswahl, überall sonst
meint er das Tool — und sie ist bewusst nicht mehr als das.

**Der Rechtsklick liest die Auswahl, er verändert sie nie.** Kein Ersetzen,
kein Erweitern, kein Leeren, auch nicht bei einem Klick außerhalb. Das ist die
harte Regel dieser Runde, live geprüft: die Auswahl ist vor und nach jedem
Kontextmenü identisch.

**Es wird nichts angeboten, was es nicht gibt.** Das Menü enthält weiterhin
genau Edit, Copy, Delete — beide Kontexte zeigen dasselbe, weil beide Aktionen
auf das geklickte Tool wirken. Kein "Coming soon", keine erfundenen Einträge,
keine Action-Registry. Neu ist nur, dass es eine Stelle gibt, an der ein
Selection-Menü später ansetzen kann, mit bereits aufgelöster Zellzahl und
Tool-Liste.

**Der Deskriptor ist bewusst tolerant.** Eine ausgewählte leere Zelle zählt als
Zelle, liefert aber kein Tool; eine Zelle, die der Grid nicht mehr kennt
(Resize, Variantenwechsel, gelöschtes Tool), liefert ebenfalls keines. Ein
Phantom-Tool wäre die einzige Art, wie diese Schicht Schaden anrichten könnte.

Der Grid veröffentlicht den Resolver über einen React-Context und liest die
Auswahl beim **Aufruf** aus einer Ref, nicht aus der Closure des Renders: ein
Menü, das nach einer Auswahländerung geöffnet wird, beschreibt sonst den
Zustand von vorhin.

## Open decisions

The following are still open:

- final dynamic-component extension API (`enabledWhen`, dynamic label/icon next);
- slot hotkeys (the slot identity is ready; the keybinding layer is not designed yet);
- whether grid dimensions stay fixed at 4x4 or become configurable per category;
- test coverage targets and component/UI testing approach (unit-test stack is decided: Vitest; editor DOM currently covered by live smoke tests only);
- locked-mode empty state when every category is context-hidden;
- packaging and release strategy for OCAP;
- final OCAP manifest `id` and public product naming details.

## 2026-09-22 – Reader extensions are a companion plugin, not part of DAP

**Decision:** Changes to the reader ZotFlow embeds live in a **separate Obsidian
plugin**, `zotflow-reader-extensions`, whose source sits in this repository
under `companion/zotflow-reader-extensions/` with its own manifest, its own
esbuild config, its own `data.json` and its own smoke-only deploy script. It is
not a DAP feature, does not import DAP code, and DAP does not import it.

**Reason:** the two have different owners and different lifetimes. DAP is a
panel in the Obsidian sidebar; this is a runtime adjustment to somebody else's
iframe, pinned to DOM names that belong to the Zotero reader fork and that a
ZotFlow update may move. Folding it into DAP would put a fragile,
version-coupled dependency inside a plugin that has none, and would make a
reader change a reason to reinstall the panel. Keeping it separate also keeps
the existing line intact: DAP still only ever *reads* ZotFlow.

It stays in this repository rather than getting its own one because it shares
this project's toolchain, its test runner and its deploy safety machinery, and
because the audit it rests on
(`audits/2026-09-22-zotflow-reader-sidebar-side.md`) is already here. A second
repository would buy separation that the directory boundary already provides.

**Consequence:** `scripts/deployCore.mjs` keeps pinning `PLUGIN_ID` to
`dynamic-action-panel` — deliberately, because an id that can vary is an id that
stops being part of the check. The companion brings its own pin in its own
script, reuses the allowlist, the link check and the `data.json` proof, and can
resolve only the `smoke` target. There is no companion path to the productive
vault at all.

**Scope of v1:** exactly one capability, `sidebarSide: "left" | "right"`. It is
not a patch framework, and a second capability is a new decision, not an
extension of this one.

## 2026-09-22 – A dropped outline entry is a section, not a page bookmark

**Decision:** Dragging an entry out of the reader's outline creates an ordinary
`file` tool — the same action a dropped annotation creates — carrying the
reader's own navigation subpath AND a `section` description of what that subpath
points at: title, depth, ancestor titles, page index, printed page label, and
the page where the next entry at the same or a shallower level begins.

**Reason:** the two halves answer different questions and age differently.
Navigation is solved by the channel that already exists, so it needed nothing
new: ZotFlow parses `annotation=<urlencoded JSON>` out of a subpath and hands
the parsed object straight to the reader's `navigate()`, which accepts a
position as readily as an annotation id — verified end to end against a live
reader. The description is what makes the tool a *section* rather than "page 106
of some PDF", and it is the part later work (extracting a section, acting on
several chapters at once) will read. A bare subpath would have thrown it away
at the moment of the drop, when it is the only moment it is free.

**Why not a new action type:** a new type makes every tool of that type inert in
any build that does not know it — including an older one, and including the
panel with the companion plugin uninstalled — and buys nothing, because the
behaviour is exactly "open this file at this subpath". `section` is additive and
optional: navigation is identical with or without it, and no settings version
bump is involved. The precedent is the annotation bookmark, decided the same way
for the same reason.

**Not stored, deliberately:** an end page. The outline gives a start and the
neighbour's start; a section's end is not in the document's table of contents,
and `nextPageIndex` is named for what it is — a neighbour's start — rather than
presented as a boundary that was measured. A successor that shares the page, or
has no destination, records nothing at all.

**Transport:** one MIME type, `application/x-dap-reader-object`, whose payload
names its own `kind`. A later reader object travels the same channel without a
second type and without the panel guessing from shape. The panel rebuilds the
payload field by field, like every other foreign input.

**Correlation:** the rendered row is matched to its node by its index PATH
through the list, never by `id="outline-N"` or `data-id` — those are positions in
the currently rendered sequence and renumber on every expand. Verified against a
fully expanded 211-entry outline: 211 of 211 rows resolved to the right node.

## 2026-09-22 – A section navigates by destination, because that branch ignores options

**Decision:** The subpath a section tool stores leads with a PDF **destination**
— `[pageIndex, { name: 'XYZ' }, left, top, null]` — and keeps the position
behind it as a fallback. The destination is the reader's own resolved point for
that outline entry, re-expressed in the standard explicit form; nothing is
measured, estimated, or converted to pixels, and nothing viewport-dependent is
stored. This **supersedes** the claim in the previous entry that the position
form "lands on the precise destination".

**Reason:** the reader's navigation has three branches, and only one of them is
free of options:

```js
navigate(e, t = {}) { t.block ||= "center"; …
  else if (e.dest)     pdfLinkService.goToDestination(e.dest)   // ignores t
  else if (e.position) navigateToPosition(e.position, t)        // honours t
```

ZotFlow's own glue calls `reader.navigate(x, {behavior:"smooth"})` — hardcoded,
with no `block` — so anything arriving through a subpath takes the position
branch and is **centred**. The reader's own outline does not go through that
glue at all: it calls the view directly with `{block:"start"}`, which puts the
destination at the top of the viewport. The two are half a viewport apart, and
there is no way to reach `block:"start"` from a payload, because the options are
not part of it. The destination branch sidesteps the question entirely.

**Measured**, scroll offset of the shortcut minus the same entry clicked in the
reader's own outline, from the same cold distance, every reading taken after the
scroll settled:

| entry | position form | original `Fit` dest | XYZ from the position |
|---|---|---|---|
| Deckblatt | −18 | 0 | **0** |
| Titelseite | −340 | −60 | **0** |
| Impressum | −1263 | −60 | **0** |
| Inhalt | −340 | −60 | **0** |
| Glossar | −340 | −60 | **0** |
| Stichwortverzeichnis | −14132 | −60 | **0** |

**Not the document's own destination.** These entries carry `[pageRef, Fit]`,
which lands at the page corner — a consistent 60px above where the outline
actually goes, because the reader resolves `Fit` to an inset point and then
aligns THAT. The reader's resolved point is the thing to preserve, not the raw
destination it came from.

**Nothing is imitated.** The scroll-versus-jump behaviour the user noticed is
the reader's own: `navigateToPosition` picks `smooth` when the target page is
already within one page of the visible range and `instant` otherwise. No rule of
ours reproduces it, and the destination branch leaves that decision to PDF.js.

**Legacy shortcuts keep working unchanged.** A tool stored before this has only
the position in its subpath, takes the position branch, and behaves exactly as
it did — right page, centred. It is not rewritten: a stored subpath is the
user's data, and the panel's file action is generic and has no business knowing
about readers. Re-dropping the entry produces the exact landing. No settings
version bump; `dest` is additive and optional.

**Derived in the panel, not sent by the companion**, so that a payload from an
older companion build gets the same destination as a new one. The companion
needed no change for this.

## 2026-09-22 – The theme owns the visual language, not a plugin

**Decision:** Every HOST surface of this project — the side docks, the ribbon,
the document plane, the tab strips, the resizable edges — is named in **one**
place: `theme/nexus/theme.css`, a real, selectable Obsidian theme named
**Nexus**, living in the repository at `theme/nexus/` and installed into
`.obsidian/themes/Nexus/`.

No plugin in this repository may define a host colour. The rules that used to
live in `companion/zotflow-reader-extensions/styles.css` moved there unchanged
in effect, and that file is now empty.

**Reason:** the experiment belonged in the companion — it was next to the reader
work it was serving and could be judged in one evening. Keeping it there had two
costs. Obsidian's workspace does not belong to a reader companion, so disabling
that plugin for an afternoon took the appearance of every dock with it. And a
colour that two files *may* define is a colour that will eventually be defined
twice, differently.

**Consequence:** the companion's `styles.css` stays as an EMPTY file rather than
being deleted. A deployment installs files and never removes them, so dropping
it from the build would leave the old copy installed in every vault that already
had one, still applying the rules that have moved. When no vault carries a stale
copy, it can go.

**Scope of v0.1:** eleven tokens covering the surfaces already understood, dark
theme only. A light theme is a different piece of work with different
judgements and has not been made; every rule in the file is scoped to
`body.theme-dark` and a test enforces it.

## 2026-09-22 – One token table, read by the theme, the editor and the bridge

**Decision:** `theme/nexus/src/tokens.ts` is the single source of truth for what
a Nexus token is called, what it means and what it is worth by default. The
theme's CSS, the Theme Studio's controls and the reader bridge's mirrored list
all derive from it. `theme.css` is hand-written — a theme should be readable as
a theme — and `tests/nexusTheme.test.ts` holds it to the table declaration by
declaration, in both directions.

**Reason:** a generator would have made the theme unreadable; two hand-kept
copies would have drifted. A checked equivalence is the third option and costs
one test.

**Consequence:** adding a knob to the Theme Studio is a row in the table plus a
rule in the CSS. The editor builds its controls from a control plan derived from
the table and names no token anywhere in its UI code, which a test also checks.

## 2026-09-22 – Nexus tokens are literal colours, not forwards

**Decision:** every `--nexus-*` default is a literal colour value. None of them
is `var(--color-base-30)` or similar.

**Reason:** Nexus *is* the theme. There is no theme underneath it to defer to,
and a token that quietly forwards to somebody else's variable is not a token a
colour picker can set. The defaults were taken by measuring what each surface
was already worth in Obsidian 1.13.7's default dark theme, so activating Nexus
changes nothing by itself — it only moves the steering wheel somewhere
reachable.

**One deliberate exception to "changes nothing":** Obsidian derives the root tab
strip from the *titlebar* colour and dims it while the window is unfocused.
Naming it `--nexus-document-chrome` makes it hold one colour instead. That is a
real change from stock Obsidian and the price of the token meaning a colour.

## 2026-09-22 – A profile is an override layer, never a second theme

**Decision:** the Nexus Theme Studio stores named **profiles** — sets of token
overrides on the Nexus theme — in its own `data.json`. A profile is never baked
into a theme directory of its own.

**Reason:** N theme copies would all have to be re-baked every time a rule
changed, to buy nothing the override layer does not already give. Baking stays
available as a deliberate later step (see
`docs/ocap/nexus-theme-workflow.md`, Phase 5).

**`Standard` is locked.** It cannot be renamed, deleted, or given an override,
and `normalizeSettings` rebuilds it from a constant whatever the file says.
"Switch to Standard" has to mean "the theme as its author left it", and a
Standard the user can edit stops meaning that after the first slider. A fresh
install therefore starts with TWO profiles: the locked baseline and an editable
`Custom`, so that the first slider has somewhere to write.

**Reset** clears the active profile's own overrides and scratch CSS, and touches
nothing else — not the theme's files, not another profile, not another plugin.

## 2026-09-22 – Overrides are inline custom properties on `<body>`

**Decision:** the Theme Studio applies token overrides with
`body.style.setProperty()`, not through an injected stylesheet and not with
`!important`. Scratch CSS is a single `<style>` element under a pinned id.

**Reason:** an inline declaration outranks every rule in every stylesheet by
construction, so an override wins over the theme without either of them knowing
the other's load order — and Obsidian loads a theme, snippets and plugin CSS in
an order this plugin does not control. It is also visible in DevTools as element
style on `<body>`, which is exactly where somebody asking "why is this colour
what it is" would look.

**Consequence:** every apply visits EVERY Nexus variable and removes the ones the
active profile does not declare. Switching from a profile with six overrides to
one with two must leave four back at the theme's value; "set what the new
profile says" alone would leave them frozen.

**Known limit of v0.1:** overrides are applied to the main window's document.
Pop-out windows are not covered.

## 2026-09-22 – The reader bridge mirrors values, and holds none

**Decision:** `companion/zotflow-reader-extensions` reads the host's *computed*
`--nexus-*` values and writes them onto the reader iframe's root element. It
stores no colour of its own, knows nothing about profiles or overrides, and has
no "is Nexus installed" check.

**Reason:** CSS custom properties do not cross a frame boundary, so a theme —
any theme — stops at the edge of the reader's iframe and something has to carry
the values across. Reading the *computed* value means whatever combination of
theme, profile and override produced the colour on screen is what gets mirrored,
with no second copy of the palette in flight.

**Fail-soft is the default, not a branch.** The injected stylesheet spends each
value as `var(<nexus token>, <the reader's own>)`. With no theme there is
nothing to read, nothing is written, and CSS's own fallback yields exactly the
appearance the plugin had before the theme existed. The failing case cannot rot,
because it is exercised by every reader opened without the theme.

**Live updates** travel on one ordinary DOM event on the host window,
`nexus-theme-tokens-changed`, declared in the token table so neither side owns a
private copy of the name. It carries no payload: the receiver reads the live
values itself. The sender does not need the receiver to exist and vice versa.

**Reach of v0.1:** the reader's own sidebar (TOGGLE PANEL) and the plane behind
its pages. The reader's toolbar is NOT re-themed: the pages render in a *nested*
iframe and the toolbar's own token names have not been established by
measurement yet. That is a Phase 1 discovery, not a guess to ship.

## 2026-09-22 – Style Settings is not adopted

**Decision:** the Nexus theme ships no Style Settings metadata block, and the
Nexus Theme Studio neither depends on nor integrates with that plugin.

**Reason:** the Theme Studio applies overrides as INLINE properties on `<body>`,
which by construction outrank anything Style Settings writes into a stylesheet.
Shipping both would mean a Style Settings slider that silently does nothing for
every token the active profile overrides — the worst kind of second source of
truth, because it looks like it works. Style Settings also keeps its own state
in its own `data.json`, giving two files that both claim to say what a token is
worth.

**Revisit when:** a reason appears to move overrides off inline style. Until
then one editor is authoritative, and that is the whole benefit.

## 2026-09-22 – Every movable edge speaks one language

**Decision:** the three structurally different families of Obsidian resize
handle — the side-dock handle, a vertical split's, a horizontal split's — share
one visual grammar: a neutral hairline inside Obsidian's own 3px hit zone,
brighter and wider on hover, brighter still while dragged, from
`--nexus-splitter-idle` / `-hover` / `-active`.

The three STATE colours are stated once, for every axis at once. Only the
GEOMETRY is written twice, because one axis draws a vertical line and the other
a horizontal one. A test asserts the colour rules are not axis-scoped.

**Reason:** they mean the same thing to the user — "this edge moves". The
horizontal case is the one that matters most in daily use here: a dock split
into a panel above and a note below had no visible line at all.

**The hit zone is not touched.** Obsidian sizes these handles and every Obsidian
user has the muscle memory. The line makes the edge legible; it does not move
it. Obsidian's accent fill on hover and drag is reset, through both
`background-color` and `border-color`: the accent means cell colour and
selection in this project, and an edge is not a meaning.

## 2026-09-23 – A control is a view of the value, and is re-read after every write

**Decision:** every control in a Theme Studio token row — swatch, pipette,
opacity, text, reset — writes a CSS string and then re-reads the stored state to
redraw itself. No control carries its own idea of what the value is.

**Reason:** the first version computed each control's state once, while
rendering, because a write deliberately does NOT re-render the tab (re-rendering
mid-drag tears the colour picker out from under the pointer). The per-token
reset arrow was therefore rendered disabled — correct at that instant for a
token with no override — and stayed disabled after the user changed the colour.
Pressing it did nothing, which is exactly what came back from first real use.

**Consequence:** the tab keeps a set of live row handles and re-syncs all of
them after a write. Eleven rows is nothing to refresh, and "one write changed
what *overridden* means" is true for more rows than the obvious one.
The reset handler also re-checks `isOverridden` itself: a button whose
correctness depends on a CSS class having been applied is the bug this rewrite
exists to remove.

## 2026-09-23 – The apply is synchronous; only the save is deferred

**Decision:** continuous edits (colour picker, opacity slider) go through
`updateLive`, which applies immediately and debounces `saveData` by 400ms.
Discrete actions (buttons, profile switches, resets) go through `update`, which
saves at once and cancels any pending debounce. `onunload` flushes.

**Reason:** live editing means an `input` event per frame. Applying each one is
the whole feature; persisting each one would be a hundred writes of `data.json`
for one decision about one grey.

## 2026-09-23 – The locator paints the token, not a list of selectors

**Decision:** resting the pointer on a token row temporarily sets THAT TOKEN's
custom property to a diagnostic magenta, on top of the active profile's real
declarations. Leaving the row re-applies the profile.

**Reason:** it answers "which surface is this?" without anyone maintaining a
second map from tokens to selectors. Every rule that spends the variable lights
up, wherever it lives — including rules inside the reader's iframe, which follow
through the existing bridge like any other change.

**Nothing is persisted, and that is structural rather than promised.** The
previewed variables live in a runtime field on the plugin; the only method that
saves does not read it; composing the preview is a pure function in
`overrides.ts` with no path to a file. Restoring needs no snapshot, because the
applied state is a pure function of the active profile. It is cleared on
pointer-leave, on any real write, when the tab is hidden, before the screen
sampler opens, and on unload.

**A 200ms delay before it paints.** Without one, sweeping the pointer down the
settings page flashes half the workspace magenta on the way past.

**Transient states need help.** Hovering "Splitter (hover)" can show nothing —
no edge is being hovered at that moment — so the registry gained `locateAlso`,
and those two tokens name the idle line. It is data, not a special case in code.

## 2026-09-23 – Opacity is a control where the token's default has one

**Decision:** `supportsAlpha` in the token registry decides whether a row gets
an opacity slider. It is set for exactly the tokens whose default value is
translucent — the three splitter states — and a test holds that equivalence.

**Reason:** those three were a text field while the other eight were colour
pickers, which is not a distinction the user should have to notice. Putting a
slider on all eleven would add a control to every row to serve three.

**The text stays authoritative.** `colorValue.ts` parses hex (3/4/6/8 digits),
`rgb()`/`rgba()` in both syntaxes, and `transparent`. Anything else —
`color-mix()`, `var()`, `oklch()`, a named colour — returns null, and that row
keeps its text field and loses its swatch rather than being rewritten into
something the parser happens to understand. Full opacity is written back as
plain `#rrggbb`, so a token dragged to opaque is textually equal to its default
rather than merely equivalent to it.

## 2026-09-23 – The pipette is the EyeDropper API, and its magnifier is not ours

**Decision:** the Theme Studio offers its own pipette button backed by
`window.EyeDropper`, feature-detected and never assumed. Where the API is
missing the button is not rendered at all.

**Reason:** the pipette the user found was Chromium's own, inside the native
popup that `<input type="color">` opens — and that popup is the problem. It is
an OS-level window that takes focus and covers the workspace, so "sample the
colour of the left dock" means sampling a dock behind a dialog. `EyeDropper` has
no dialog: it turns the pointer into a sampler over the whole screen and leaves
the workspace exactly where it was, which is where the colours worth sampling
are.

**The tinted magnifier grid is Chromium's** and is drawn by the browser, not by
this project. It cannot be restyled, and nothing here tries. A test asserts this
module draws no sampler UI of its own, so the claim stays true.

**Cancelling is a normal outcome.** `pickScreenColor` never rejects; Escape, an
unavailable API and a malformed result are all "no colour was chosen", and no
value changes.

## 2026-09-23 – Folding a group hides its list, never its items

> **SUPERSEDED the same day** by "The studio is a workspace view, not a settings
> tab". This fold never worked on screen, and one of the reasons given below is
> **wrong**: see "Why the settings-tab fold never folded" for the measured cause
> and the correction.

**Decision:** a collapsed token group gets a class on the group element and CSS
hides `.setting-items`. It is not implemented with per-item `visible`.

**Reason:** two things. The heading is where the chevron lives, and a
`visible`-based fold risks hiding its own way back; and `visible: false` also
removes a setting from Obsidian's settings search, which is precisely where
somebody who folded a section will go looking for it.

**One class name, never two separated by a space.** A group's `cls` reaches
`classList.add` unsplit, and that throws on a space — measured in Obsidian
1.13.7's `SettingGroup.addClass`, and it would have taken the whole group down
the first time anybody folded it.

**Which groups are folded is stored at the settings root, not in a profile.**
How you are working is not what you are working on: switching profile to compare
two greys should not also reshuffle the shape of the page.

## 2026-09-23 – Obsidian clips its own colour swatch, and the theme studio pays 4px

> **SUPERSEDED the same day** by the workspace view. The measurement below is
> correct and stays as the record, but the studio no longer styles Obsidian's
> colour input at all: the visible swatch is its own element with room round it,
> so there is nothing left to clip.

**Decision:** `.nexus-studio-token input[type=color]` is given
`height: calc(var(--swatch-height) + 4px)`.

**Reason, measured in Obsidian 1.13.7's `app.css`:** the input is
`calc(var(--swatch-width) + 4px)` WIDE and `var(--swatch-height)` TALL, while
`::-webkit-color-swatch-wrapper` has `padding: 2px` and the swatch itself is
`--swatch-width` × `--swatch-height`. The horizontal `+ 4px` exists to pay for
that padding, leaving 2px each side for the 2px hover and focus ring. The height
has no such allowance, so the round swatch reaches the element's edges with
nothing left over and the ring — an outer `box-shadow` — is clipped top and
bottom. The fix is the missing counterpart of a line Obsidian already wrote, it
covers keyboard focus and pointer hover alike because both draw the same shadow,
and it does not change the row's height.

## 2026-09-23 – Why the settings-tab fold never folded (a correction)

**What was measured, in Obsidian 1.13.7's own settings renderer:** a
`SettingDefinitionGroup` is created once — heading, `cls`, `extraButtons` — and
on every later `update()` the SAME group element is reconciled: its heading is
reset and its items re-rendered, and nothing else. `cls` and the header buttons
are never applied again. The studio's chevron changed `cls` between renders, so
the class that would have folded the group never reached the element. The click
WAS stored — the smoke vault's `data.json` held three "collapsed" groups the user
had never once seen collapse.

**The correction.** The entry "Folding a group hides its list, never its items"
also claimed that a group's `cls` reaches `classList.add` unsplit and throws on a
space. That was wrong: the same renderer calls
`addClass.apply(group, cls.split(" ").filter(Boolean))`. Nothing ever threw. The
single-class workaround it motivated was harmless and is gone with the settings
tab.

**What made it invisible:** every test of the fold read source text. None
rendered the panel and clicked it. That is why the studio now has DOM tests
(`tests/nexusStudioView.test.ts`, under happy-dom), and a mutation check — the
fold line removed — fails six of them.

## 2026-09-23 – The studio is a workspace view, not a settings tab

**Decision:** Nexus Theme Studio is an Obsidian `ItemView` of type
`nexus-theme-studio`, opened by one command, **Open Nexus Theme Studio** (id
`open-theme-studio`, unchanged, so an existing hotkey keeps working). It has no
settings tab, no ribbon button and no window or docking logic of its own.

**Reason:** it stopped being plugin configuration and became a design tool, and
a settings tab is a modal over the very workspace being designed. You could not
see the dock you were colouring, and the pipette could not sample it. A view
lives IN the workspace — right dock, split, tab, pop-out window — and Obsidian
already does all of that, including remembering where the user put it.

**Opening is `Workspace.ensureSideLeaf`, not hand-written.** Measured in 1.13.7:
it takes the first existing leaf of the type wherever it is (either dock, the
main area, a pop-out), creates one in the requested dock only if there is none,
loads it if deferred, reveals it, and focuses it with `active`. That is exactly
single-instance "open or reveal".

**A second view is not prevented, and not a problem.** Obsidian's own split and
"open in new window" can duplicate the tab; fighting the native UI is what this
project decided not to do. Every studio view reads the same settings and is told
about every change — found through `getLeavesOfType`, never held by the plugin,
because a plugin that keeps its views keeps closed ones alive.

**Studio leaves are not detached on unload.** Obsidian keeps them in the layout
and restores them where the user left them.

**The panel owns its DOM.** `studioPanel.ts` is built on standard DOM (`dom.ts`)
and knows nothing about Plugin or ItemView — everything arrives through a host
interface. That is what lets it be rendered and clicked in happy-dom tests, and
it is why a fold is now a `hidden` attribute on an element the panel created,
toggled by a `<button>` the panel created.

**The theme note follows the theme.** "Nexus is not the selected theme" is
re-checked on Obsidian's `css-change` and refilled in place, because a view that
stays open while the user picks a theme under Appearance would otherwise keep
saying something false. Found in live use, not in review.

## 2026-09-23 – A token row is a design control first and a CSS form second

**Decision:** a row shows the swatch, the name, one line of description, the
opacity where the registry says so, a compact value readout, the pipette and the
reset. The raw CSS value is behind the readout, which is a disclosure button:
closed by default, opened on demand, and authoritative when used.

**Reason:** the user designs by looking, not by editing `rgba()` — but the raw
value is how `oklch()`, `var()` and `color-mix()` get in, and it must never be
hidden when it is the thing in effect. So a value the picker cannot represent is
still painted by the swatch (which paints the stored string itself), the readout
says `CSS` in the accent colour, and its full text is on hover.

**One tooltip for the reset, whatever the value:** "Reset to default". The value
was noise; the meaning is the button.

**Narrow first.** The panel is a CSS size container; below 300px of VIEW width
the actions move under the label. The studio's primary home is a right dock a
couple of hundred pixels wide, and a studio in a narrow dock of a wide window is
still narrow.

## 2026-09-23 – Settings version 2 drops the fold state version 1 stored

**Decision:** the Theme Studio's `data.json` is now version 2. Reading a
version-1 file (or one with no version) keeps every profile, override, scratch
CSS and the active choice exactly, and discards `collapsedGroups`.

**Reason:** see "Why the settings-tab fold never folded". A v1 fold records
clicks on a control that visibly did nothing. Honouring it would open the new
view with sections mysteriously shut — the old bug resurfacing somewhere else.

**Fold state is studio UI state:** stored once at the settings root, never in a
profile, never a token. A profile switch does not change it; a restart keeps it.
It is saved through its own path (`updateUi`), which neither re-applies the
theme nor re-sends every token to every reader.

## 2026-09-23 – DOM tests use happy-dom, per file

**Decision:** tests that need a document declare
`// @vitest-environment happy-dom` at the top of the file. The suite as a whole
stays in the Node environment. `happy-dom` is a dev dependency, at 20.x.

**Reason:** see the correction above — a UI whose behaviour is only ever checked
by reading its source will eventually ship a control that does nothing. This
extends the 2026-09-16 Vitest decision rather than reversing it: it is not
browser or E2E infrastructure, and only files that ask for a DOM get one.

**Version floor:** happy-dom 17 was installed first and was flagged critical
(VM-context escape) by `npm audit`. It was replaced before anything was
committed. The 20.x line is not flagged.

**The live half is a script, not a unit test.**
`companion/nexus-theme-studio/scripts/smokeView.mjs` drives a real Obsidian over
CDP — on its own `--user-data-dir` and a throwaway vault, never the user's
instance — and checks what only a running Obsidian can: one view in the right
dock, the fold under Obsidian's own stylesheets, the locator repainting a real
dock, `input` repainting it live, `window.EyeDropper` opening from the view's
window, the theme note following `css-change`, and a plugin reload with the view
open leaving nothing behind and nothing doubled.

## 2026-09-23 – The studio is a control plane, and does not paint itself with what it edits

**Rule:** Nexus Theme Studio does not consume the user-editable Nexus
presentation tokens for its own critical UI.

**Decision:** the studio, its modals and its pick layer carry
`.nexus-studio` / `.nexus-studio-isolated`. These re-point every Obsidian
variable that Nexus re-points (backgrounds, borders, text, icons, interface font,
UI sizes, tight line height) to an internal palette, `--nexus-studio-*`. That
palette is built only from Obsidian's own `--color-base-*` scale and from
`--font-default` / `--font-interface-override`. It is not in the token registry,
cannot be exported, and has no row. The studio's context menu is the OS-native
menu (`Menu.setUseNativeMenu(true)`, a public API), which no theme CSS reaches.

**Reason:** a user may set the text colour to the surface colour, by accident
or on the way to another value. They must still be able to read the control
that undoes it. The same holds for typography: a 30px UI font must not push the
studio's own controls out of its dock.

**The locator** paints the token, so it paints every surface that uses it. The
studio is no longer one of those surfaces. Checked live: with text set to
`#111111` on a `#141414` dock, the studio stays at `rgb(218, 218, 218)` on
`rgb(33, 33, 33)`, and the magenta locator never reaches the studio.

**Tests hold the rule:**

- Every non-Nexus variable that `theme.css` re-points must also be re-pointed
  in the studio palette. There is one documented exception.
- The palette may reference nothing except the base scale and the default fonts.
- `theme.css` may never declare `--color-base-*`.

## 2026-09-23 – UI typography rides Obsidian's own variables, with no weight

**Decision:** three new tokens form a `Typography` group. Each has a
`controlType` in the registry; there is no forms engine.

| Token | Obsidian variable it drives | Control |
| --- | --- | --- |
| `--nexus-ui-font-family` | `--font-interface-theme`, the theme slot of `--font-interface` | font family: visible value, free text, six suggestions |
| `--nexus-ui-font-size` (13px) | `--font-ui-small`, with `-smaller`, `-medium` and `-large` scaled 12 : 15 : 20 against 13 | slider, 10–20px, raw CSS behind the readout |
| `--nexus-ui-line-height` (1.3) | `--line-height-tight`, the UI line height (notes use `--line-height-normal`) | slider, 1–2 |

The size scale applies on desktop only (`:not(.is-mobile)`). On mobile, Obsidian
derives the UI sizes from `--font-text-size`, and a fixed scale would fight it.
The user's own interface font (`--font-interface-override`) still wins over the
theme slot, as Obsidian intends.

**No UI font weight.** Obsidian has no UI weight variable. `--font-weight` is
the weight of note text, bold is derived from it, and `body` sets no weight. A
weight token would have needed its own list of selectors, and the theme's token
model forbids that.

**Validation is per token:**

- lengths: 6–48px, or 0.4–3em/rem;
- numbers: 0.8–3;
- a `calc()`, `clamp()`, `min()`, `max()` or `var()` is accepted as written.

An out-of-range stored value is ignored, not clamped.

**Not a font manager:** the suggestions are CSS font stacks and nothing is
downloaded. A family that is not installed simply falls through to the next
entry in the stack.

## 2026-09-23 – Contrast assist measures real pairs, and never writes

**Decision:** a `Contrast` section lists the pairs that really meet in Nexus
(`NEXUS_CONTRAST_PAIRS`):

- primary text on the docks, and on the page;
- muted text on the docks, and on the page;
- muted text on the tab strip, where tab titles are drawn
  (`--tab-text-color-focused` and `--nav-item-color` are both `--text-muted`).

Each row shows the WCAG 2 ratio, rounded down to one decimal:

- ✓ at 4.5:1 or above;
- ⚠ at 3:1 or above, enough for large text only;
- ✗ below 3:1.

The section heading counts the rows below 4.5:1.

**The reader panel is excluded.** The reader draws its sidebar text itself. No
Nexus text token is painted on that surface, so a figure there would describe a
pair nobody sees.

**How it measures:**

- Relative luminance uses the 0.04045 threshold. Translucent text is first
  composited over the surface.
- Some values cannot be read directly by the parser (`var()`, `color-mix()`,
  `oklch()`). For these, the browser resolves the value in a hidden probe
  element and the studio reads back the computed colour. This includes
  Chromium's `color(srgb …)` serialisation.
- If the surface is itself translucent, or a value does not resolve, the row
  shows "not measured" rather than a guess.

**Stated in the UI:** it checks only the pairs listed, not every combination on
screen, and it is not an accessibility audit.

## 2026-09-23 – Auto contrast is not built; Assist is

**Decision:** there is no Manual / Assist / Auto mode. The studio measures and
flags (Assist, above), and it never changes a value on its own.

**Reasons:**

1. **A text token has no single right answer.** `--nexus-text-primary` is read on
   the docks and on the page, and those two surfaces can be set far apart. A
   text colour that clears one surface can fail the other, so "auto" would have
   to choose which surface loses.
2. **It would be the first derived token.** Every token today is a value the
   user owns. A computed token touches the locator, the reader bridge, the row
   UI, export, reset and the override model, so it is not a small change.
3. **The light/dark candidate pair has no home.** Nexus is dark-only. A
   computed "dark text on a light surface" would be a colour that nothing else
   defines.

**What would make it tractable:** per-surface text tokens, such as text on the
docks and text on the page, so that each pair has exactly one text token to
adjust. Auto could then be an explicit "fix this pair" action rather than a
mode, and it would still never override a value the user set by hand.

## 2026-09-23 – Inspect UI is DevTools' own picker, reached through documented APIs

**Decision:** a Discovery button and an **Inspect UI** command start DevTools'
element picker from the studio. The flow uses only documented Electron APIs:

1. Attach `webContents.debugger`, a Chrome DevTools Protocol client.
2. Switch on the protocol's `Overlay` inspect mode. It draws the same hover
   highlight that DevTools itself draws.
3. When the user clicks, send the centre of the clicked node's box to
   `webContents.inspectElement(x, y)`, which opens DevTools on that element.
4. Detach the client.

Escape, the button again, the view closing and the plugin unloading all switch
the picker off and detach.

**No shortcut simulation.** If something else already holds the protocol
client, the fallback is still an API call: a crosshair click, then
`inspectElement` at that point. Only the hover highlight is lost. If
`webContents` cannot be reached at all, the button is disabled and says why.

**Found live, fixed:** once `inspectElement` has been used, the next
`Overlay.enable` replays `Overlay.inspectNodeRequested` for that earlier node.
It arrives 5ms in, before `setInspectMode` resolves, with no click. Taken at face
value, it opened DevTools the moment the picker started. Picks now count only
after the inspect mode is armed. A unit test replays the event, and it is
mutation-checked.

That the replay comes from Chromium's overlay agent keeping the pending node is
an inference from the timing. The Chromium source was not opened to confirm it.

## 2026-09-23 – The red eyedropper grid is Electron's, and the studio samples its own window

**Cause, from source:**

- Chromium's `components/eye_dropper/eye_dropper_view.cc` paints the magnifier
  grid, border and rings from ColorProvider ids.
- `components/eye_dropper/color_mixer.cc` maps those ids to greys, black and
  white.
- Electron's `electron_browser_main_parts.cc` registers the Chrome colour mixers
  but not the eye-dropper mixer.
- An unmapped id resolves to `gfx::kPlaceholderColor`, which is `SK_ColorRED`.
  Chromium documents it as "should never be visible and is red as a visual flag
  for misbehaving code".

Not verified: the body of Electron's `AddChromeColorMixers`, which would be the
last link. Nothing in the page can restyle that view.

**Decision:** where it can, the pipette samples the Obsidian window itself:

1. A transparent layer covering the whole window, with a crosshair and a
   neutral hint, takes one click.
2. The layer's own paint is waited out: two frames, or at most 150ms in a
   window whose frames are throttled.
3. `webContents.capturePage` captures that one pixel, which is decoded without
   colour conversion.

Escape or a right click cancels. Nothing is written before the click.

For the common case this supersedes the entry "The pipette is the EyeDropper
API, and its magnifier is not ours". The native `EyeDropper` is now only the
fallback where `capturePage` is unavailable, and its grid stays as it is.

**Limit:** the capture sampler sees only its own window. It cannot see a
popped-out window or other applications. That is the price of not building a
screen-capture platform.

**Take colour** in the Discovery area is the same sampler without a token. It
copies the hex value to the clipboard.

## 2026-09-23 – The live smoke runs in a window Windows believes is visible

**Decision:** the smoke Obsidian is started with
`--disable-features=CalculateNativeWinOcclusion`. The smoke script turns off
background throttling and closes any DevTools a previous run left open.

**Reason, measured:** once other windows covered the scratch window, Chromium
reported it as hidden and delivered no input at all. That applied to CDP key
and mouse events and to Electron's `sendInputEvent` alike, although the window
was visible, not minimised, and focused. Every click-driven check failed for a
reason unrelated to the studio.

Throttling in the same state stretched a 200ms timer to 488ms and stopped
animation frames. That is why the sampler waits for frames only up to a 150ms
ceiling.

## 2026-09-23 – A colour is edited in one place: the Nexus colour picker

**Decision:** a colour token row is a swatch, a compact readout (`#333333`, and
`28%` where the token has an opacity) and a reset. The swatch opens the Nexus
colour picker, a small popover of the studio's own. Everything else about a
colour lives only there: the saturation/brightness square, the hue bar, the
opacity, HEX/RGB/HSL values, Pick from Obsidian, the palette, and the raw CSS
value. The row's pipette, its opacity slider, its raw CSS disclosure and the
hidden native `<input type="color">` are gone.

**Why the native picker could not stay, as facts rather than taste:**

- `<input type="color">` opens Chromium's colour popup. The popup is browser
  UI drawn outside the page: no CSS reaches it, no DOM can be added to it, and
  it has no API. It cannot hold an opacity, a palette, or a different pipette.
- Its built-in pipette is Chromium's EyeDropper, which in Electron draws the
  red magnifier grid (see "The red eyedropper grid is Electron's").
- So the popup could be replaced, not extended. The studio no longer creates a
  native colour input anywhere; a test holds that.

**Why one place:** four ways into the same value (swatch popup, pipette,
opacity slider, raw field) made the user choose a method before choosing a
colour. The picker is one tool; the row only says what the value is.

**Placement:** on the document body, `position: fixed`, beside the swatch.
Below the swatch when there is room, above it when there is more room there,
and shifted left rather than cut off at the window edge, because the studio's
usual home is the right dock. A swatch with no box (a folded group) centres it.
It carries `.nexus-studio-isolated` and paints only from `--nexus-studio-*`,
so the colours being edited never style the picker. Checked live with the text
token at near-black.

**One picker at a time.** Opening another swatch commits the open one first,
as a click outside would. The same swatch closes it.

## 2026-09-23 – A picker is a session: drafts are shown, not saved

**Decision:** while the picker is open, every change is a DRAFT. A draft is
applied to the workspace immediately (and to the reader, through the same
tokens-changed path as any value) but is not part of the profile. Closing the
picker decides what happens to it:

| Gesture | Outcome |
| --- | --- |
| Done, Enter in a field or the square, a click outside, another swatch | COMMIT: one ordinary override write on the live path (applied, saved on the usual 400ms debounce). A draft equal to the starting value writes nothing. |
| Escape, Revert | CANCEL: the draft is dropped. The value from before the picker opened is back exactly, because the profile was never changed. |
| A rebuild (profile switch, import, reset profile), the view closing, the plugin unloading | CANCEL. A draft is not carried into a state it was not made for. |

**How:** the plugin holds drafts in a runtime-only map (`sessionValues`), next
to the locator's `previewVariables` and for the same reason: the save path
cannot see it. `withSession` lays the drafts over the profile's declarations,
and `withPreview` lays the locator over both. The row, the contrast figures and
every open studio view read the draft while it exists.

**Why not debounced saving while open:** with it, Escape could only restore
the look, not the stored value; the file would already hold the experiment.
With drafts, "experiment freely, Escape goes home" is exact, and nothing about
the debounce changes: a commit is the same write a slider makes.

**The locator** is off while a picker is open (a hover would paint over the
draft), and opening the picker takes a running locator down first.

**Not the same semantics for everything:** slider rows and the font field keep
writing directly on the live path. Only the picker is a session.

## 2026-09-23 – One colour model: RGBA; HEX, RGB and HSL are views of it

**Decision:** `colorValue.ts` has one model, RGBA (channels 0–255, alpha 0–1).
HEX, RGB and HSL are display and input forms. The STORED form is always what
`formatColorValue` writes: `#rrggbb` when opaque, `rgba()` otherwise.
Switching the display format writes nothing, so it cannot change a value.
`hsl()`/`hsla()` are now parsed as well.

HSV exists only for the square and the hue bar. The picker keeps its own hue
while the colour is grey or black, where RGB has no hue to give, so dragging
through black does not throw the hue bar back to red.

The chosen display format is a UI preference (`pickerFormat`) and is saved as
UI state.

**Custom CSS stays authoritative.** A value the model cannot read
(`color-mix()`, `var()`, `oklch()`) opens the picker as **Custom CSS**: the raw
field is in front, and the visual controls are hidden. Closing it does not
change the value. Convert to colour turns it into a plain colour only when
asked, using the colour the browser resolves it to, and says so when it
cannot. A plain colour typed into the CSS field becomes a colour again.

## 2026-09-23 – The palette is global to the studio

**Decision:** saved swatches (`savedSwatches`) live at the settings root, like
the fold state. They are not stored per token, per group or per profile. A
swatch keeps its opacity and is shown over a checkerboard.

Operations:

- `+` saves the current colour.
- Clicking a swatch loads it into the picker as a draft. The swatch itself is
  never changed by that, so "base colour, variant, save the variant" works.
- The swatch menu (right-click) offers Replace with current colour and Delete.
- The Delete key removes a focused swatch.

Duplicates are refused. The palette holds at most 48 swatches. A translucent
swatch loaded on a token without an opacity arrives opaque.

**Why global:** the palette is the user's working colours, carried from token
to token and from profile to profile. Comparing two profiles with the same
greys at hand is the point. A profile is what the theme looks like; the
palette is what the user works with.

**Counter-argument considered:** a profile export does not carry the palette.
That is accepted. An export is a theme variant for someone else, not the
user's workbench. There is no reordering (drag and drop) in this version.

## 2026-09-23 – No native EyeDropper anywhere; Copy colour is a developer utility

**Decision:** the native `window.EyeDropper` is no longer a fallback. The
sampler (`sampler.ts`) is capture-only. Where `webContents.capturePage` cannot
be reached, there is no Pick from Obsidian, and never the red grid.
`eyedropper.ts` is deleted. This supersedes the fallback half of "The red
eyedropper grid is Electron's", and the "EyeDropper API" entry.

**Pick from Obsidian lives in the picker.** While aiming, the picker hides
(`visibility: hidden`) so whatever is under it can be sampled too. The taken
pixel lands in the open picker as a draft, keeping the draft's opacity. The
picker comes back with the focus on the button. While aiming, Escape belongs
to the sampler: it ends the pick and leaves the picker, with its draft, open.
The click that takes the pixel does not count as a click outside.

**Copy colour** (formerly Take colour) stays in Discovery beside Inspect UI.
It is a developer utility: it copies the hex of any point, including surfaces
that have no token, which is a discovery question. Its label and tooltip say
it is not how a token is edited.

## 2026-09-23 – The sampler can be aimed with the keyboard

**Decision:** while aiming:

- the arrow keys move a reticle one CSS pixel, and Shift+arrow moves it ten;
- Enter or Space takes the pixel under the reticle;
- Escape cancels.

A page cannot move the operating system's cursor, so the reticle is drawn by
the sampler. It is a black-and-white cross, neutral on any surface. It starts
at the last pointer position, and moving the mouse hands aiming back to the
mouse. Like the hint, the reticle is removed before the pixel is captured.
Enter and Space are taken and default-prevented, so the button behind the
layer is not pressed.

**Honest note:** the user reported arrow-key aiming and Space already working.
Before this change the sampler handled no key except Escape, so whatever moved
the cursor then was not this code. It may have been an operating-system
feature such as Mouse Keys; that was not checked. What is described here is
what the code does now, and it is tested (unit tests, and live: the reticle
moved one pixel per arrow and Enter took the dock's colour).

## 2026-09-23 – Studio settings version 3

**Decision:** `SETTINGS_VERSION` is 3. It adds `savedSwatches` (default `[]`)
and `pickerFormat` (default `hex`). A version-2 file reads unchanged, with an
empty palette. A damaged palette is read fail-soft: non-colours and duplicates
are dropped, and the list is capped. Profile operations carry both fields
through.

Nothing transient is stored: not the open picker, its position, a draft, or
the sampling cursor.

## 2026-09-23 – The colour library has two memories: Recent and Saved

**Decision:** the picker's single palette becomes two sections, kept by the
colour library (`colorLibrary.ts`):

| | RECENT | SAVED |
| --- | --- | --- |
| Written by | a committed picker session that changed a colour, only | the user, explicitly (`+`, Replace, Delete, Import, Clear) |
| Size | at most 16 (`RECENT_LIMIT`): two rows in the picker; the oldest falls off the right | at most 48 (`SAVED_LIMIT`); nothing falls off |
| Order | newest on the left; a colour used again moves to the front and is not doubled | the order it was kept in |
| Controls | none: no `+`, no menu, no sorting | `+`, `⋯` (replace or delete the loaded colour, import, export, copy as CSS variables, clear), Delete key, right-click |
| Exported | no: working memory, not something to hand on | yes, as a palette file |

Clicking any swatch in either section loads it into the picker as a DRAFT. The
entry itself is never changed by that. A variant is committed or saved as a
new colour.

**Why two:** one list that was history, library and active colour at once made
every choice a trade-off: save something to find it again, and clutter the
library with it. Photoshop's split is the model here, but only the split is
adopted: no groups, presets or names.

**Global, both:** neither belongs to a profile, a token or a group. Recent is
the designer's recent work, and Saved is the designer's library. Both survive a
restart.

## 2026-09-23 – A colour is identified by its canonical RGBA

**Decision:** both memories compare and store colours in the canonical form
`rgbaToCss(parseRgba(value))`: `#rrggbb`, or `rgba()` below full opacity.
`#ffffff`, `rgb(255,255,255)` and `rgba(255,255,255,1)` are one colour. Alpha is
part of the colour: `rgba(255,255,255,0.5)` is a different colour from
`#ffffff`.

**Consequence for existing data:** stored lists are canonicalised on read. A
colour's spelling may change (for example `rgba(0,0,0,0.5)` becomes
`rgba(0, 0, 0, 0.5)`), but the colour and its opacity do not. Only non-colours
and duplicates are dropped. The smoke vault's `savedSwatches` read unchanged.

## 2026-09-23 – Recent means a changed colour, committed

**Decision:** a colour enters Recent in exactly one case: a picker session
COMMITS a colour whose canonical form differs from the token's value when the
picker opened. It is recorded in the same write as the token, on the live path,
so the save debounce is unchanged.

Not recorded:

- any draft: dragging, fields, loading a swatch, Pick from Obsidian while open;
- Escape or Revert;
- a commit with no change, including the same colour typed in another spelling;
- a Custom CSS value such as `color-mix()`, which is not a colour;
- the locator.

Loading a Recent or Saved colour that is different from the token's value, and
then committing it, IS a use: the token got that colour. A colour taken with
Pick from Obsidian counts once the session commits, and a cancelled pick adds
nothing.

## 2026-09-23 – Saved colours are a library, and a palette file

**Decision:**

- `+` keeps the current colour. A colour already saved (by canonical colour) is
  not saved twice: nothing is written, and the existing swatch is briefly
  outlined.
- A loaded saved colour is marked, and `⋯` then offers Replace with current
  colour and Delete for it. The normal workflow therefore needs no context
  menu; right-click and the Delete key still work.
- Replace refuses a colour that is already saved elsewhere.
- Clear asks first, and empties Saved only (not Recent, and not any theme
  value).

**The file** (`nexus-color-palette`, `version: 1`):

```json
{ "format": "nexus-color-palette", "version": 1, "name": "Nexus palette",
  "colors": [{ "value": "#333333" }, { "value": "rgba(255, 255, 255, 0.28)" }] }
```

It holds exactly the saved colours, with alpha. The name is asked for in the
export dialog, with *Nexus palette* as the default. It is flat on purpose: a
later group would be a named list of the same entries, and nothing here
prevents that.

**Import MERGES.** Colours are added at the end, and canonical duplicates are
skipped. Nothing is removed. The user is told how many colours were added, were
already saved, were skipped as not a colour, or did not fit.

Refused with a reason:

- a file that is not JSON;
- a file in another format, including a profile file;
- a file with a newer version.

An import changes Saved only: no token, profile, theme or Recent. There is no
"Replace palette": Clear followed by Import does that in two deliberate steps.

**Profile and palette stay apart:** `nexus-theme-profile` holds token overrides
and scratch CSS, and `nexus-color-palette` holds colours. Neither parser
accepts the other.

**Copy as CSS variables** (`--nexus-palette-01: …;`) was cheap and is included.
It is a convenience copy, not a storage form; the JSON is the palette.

## 2026-09-23 – Palette transfer is text and a file you choose, not a save dialog

**Checked:**

- Obsidian's Electron exposes `remote.dialog`, and Node's `fs` is available on
  desktop.
- A real save dialog would therefore be possible, but it would mean the studio
  writes a file outside its own `data.json` through Node, which the profile
  export deliberately does not do.

**Decision:**

- **Export** shows the JSON with a name field, a suggested file name
  (`<name>.nexus-color-palette.json`) and Copy.
- **Import** takes pasted JSON, or a file chosen with a standard
  `<input type="file">`. That is reading only: Electron shows the system's open
  dialog and hands over the text.

The live smoke drives the file import with CDP `DOM.setFileInputFiles`, so no
dialog opens.

## 2026-09-23 – The colour library is a module, not a service

**Decision:** `colorLibrary.ts` holds the pure rules:

- canonical identity;
- recent push, dedupe and trim;
- saved add, replace, remove and merge;
- palette serialise and parse;
- CSS variables.

It imports only `colorValue.ts`: no DOM, no Obsidian, no settings. A test holds
that. `profiles.ts` stores what it returns (`recentColors`, `savedSwatches`),
and returns the same settings object when nothing changed, so an unchanged
library is never saved. The picker is one client. It shows the lists and asks
for changes through a small `PickerLibrary` interface, and it owns no list.

Another Nexus tool, or DAP, can reuse the same functions over its own storage.
Nothing is shared across plugins at runtime; that would be a service, and none
is built.

**Settings stay at version 3.** `recentColors` is one more optional field with
an empty default. A v3 file without it is a file with no recent colours yet,
and nothing existing is read differently.

## 2026-09-23 – Recent records finished colour actions, not picker sessions (supersedes "Recent means a changed colour, committed")

**Found in use:** Recent changed only when the picker closed and committed. To
see the colour just tried among the recent ones, the picker had to be closed
and opened again, which is exactly the friction Recent was meant to remove.

**Decision:** three levels, kept apart.

| Level | What it is | What it writes |
| --- | --- | --- |
| INTERACTION COMMIT | one finished colour action, with the picker still open | the colour to the front of Recent, at once, visibly |
| PICKER SESSION COMMIT | Done, Enter, a click outside; or Escape and Revert as its cancel | the theme token (commit), or nothing (cancel) |
| SAVED | what the user keeps on purpose | the saved colours, only on `+`, Replace, Delete, Import, Clear |

**The interaction commits:**

- **The square:** on pointer release, a click or a whole drag records ONE
  colour, its end value. Pointer moves only change the draft. Arrow keys record
  on key up.
- **Hue and opacity bars:** `change` records, which fires once for the pointer
  when the bar is let go. From the keyboard, `change` fires on every step while
  a key is held, so the key going up records.
- **Fields** (HEX, RGB, HSL, opacity percent, CSS value): a confirmed value
  records, meaning `change` (Enter, or leaving the field). Keystrokes do not.
- **A Recent swatch clicked:** it becomes the draft and moves to the front. No
  duplicate is created; the canonical-RGBA dedupe is unchanged.
- **A Saved swatch clicked:** it becomes the draft and goes to the front of
  Recent. The saved colour itself is untouched.
- **Pick from Obsidian:** a taken pixel records, and a cancelled pick does not.
- **Convert to colour** records.
- **Not an interaction commit:** a format switch, `+`, a Custom CSS value,
  drafts in progress, and the locator.

**Escape and Revert keep Recent.** They return the TOKEN to its value from
before the picker, and every colour tried during the session stays in Recent.
Recent is working history, not theme state.

**Persistence, separate from the token:** an interaction commit goes through
`updateUiLater`. The settings take the new Recent at once, nothing is re-applied
to the theme, and the file is written 1.5s after the actions pause
(`LIBRARY_SAVE_DEBOUNCE_MS`). The debounce is flushed on unload. Tokens keep
their own path: drafts in the session layer, and one `updateLive` write on
commit (400ms debounce). A pointer move never writes anything.

**Redrawing:** only the Recent row is redrawn after an interaction commit, so
the control in use keeps the focus. After a Recent or Saved click, the focus
follows to the clicked colour.

**No selection model:** the newest Recent colour and the current colour may be
the same; Recent is not marked as "selected".

## 2026-09-23 – One format button, and the pipette as an icon

**Decision:** the value line is the fields, one format button, and the pipette.

- **The format button** shows the active format and cycles HEX → RGB → HSL →
  HEX. It is a real `<button>`, so Enter and Space work as for any button. Its
  tooltip is "Change colour format". Switching writes no value; only
  `pickerFormat` is remembered.
- **The pipette** is an icon button (`clickable-icon`, Lucide `pipette`). Its
  label is "Pick from Obsidian", and its tooltip explains the keyboard aiming.
  It replaces the wide text button.

Keyboard sampling is unchanged: arrows 1px, Shift+arrows 10px, Enter or Space
takes, Escape cancels.

**Limit:** the value line is part of the colour controls, so in Custom CSS
mode, where they are hidden, the pipette is hidden too. *Convert to colour*
comes first.
