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

**Decision:** Workspace context lives in one plugin-level `OCAPContextService` holding an immutable `OCAPContextSnapshot`. Obsidian events (workspace/metadataCache/vault) rebuild the snapshot, which is only replaced (and subscribers notified) when it changed semantically. React subscribes via `useSyncExternalStore` (`useOCAPContext()`); no polling, no DOM observation, no new document CustomEvents. The context describes the last active **content leaf in the root split** — focusing the buttons panel or sidebars never changes it.

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

**Decision:** `projectCategoriesForContext(categories, context, interactionMode)` in `src/context/conditions.ts` is the single decision point for context visibility: locked mode gets filtered categories, sort/edit get untouched references plus `hiddenButtonIds`/`hiddenCategoryIds` marker sets (distributed via `OCAPVisibilityContext`). View modes never evaluate conditions themselves.

**Marker semantics:** an element is marked context-hidden iff its **own** condition fails (categories are not marked merely because all their buttons are hidden — the dimmed buttons already show that). Category markers use the same `ocap-context-hidden` class on the list title / tab / folder tile.

**Reason:** One projection keeps the three view modes and the DnD provider consistent, is unit-testable in isolation, and gives later features (dynamic behaviors) a single extension point.

## 2026-09-16 – Category conditions do not bump the settings version

**Decision:** `settingsVersion` stays at 1. `CategoryConfig.conditions` is a purely additive optional field: absent means "always visible", no existing persisted data needs transformation, and version-1 data written by Phase 3 remains loadable by Phase 2 builds. Version bumps are reserved for actual data transformations or incompatible semantic changes.

**Reason:** Reflexive version bumps would force no-op migrations on every synced device and create artificial "future version" states in mixed-version vaults.

## 2026-09-16 – Context snapshot rebuilds on every layout-change

**Decision:** `OCAPContextService` rebuilds the snapshot on every `layout-change` (deduplicated via `contextSnapshotsEqual`), not only when the tracked leaf was detached. A leaf can swap its view in place (empty tab → file opened in the same tab) without emitting `active-leaf-change` or `file-open`.

**Reason:** Live-verified gap: after closing all tabs and opening a file in the new tab, the context stayed stale and conditioned categories never reappeared.

## Open decisions

The following are still open:

- final dynamic-component extension API (`enabledWhen`, dynamic label/icon next);
- test coverage targets and component/UI testing approach (unit-test stack is decided: Vitest; editor DOM currently covered by live smoke tests only);
- locked-mode empty state when every category is context-hidden;
- packaging and release strategy for OCAP;
- final OCAP manifest `id` and public product naming details.
