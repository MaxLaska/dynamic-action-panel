# OCAP – Status

Last updated: 2026-09-16 (Phase 3 – Usable Context Rules)

## Current state

- GitHub fork `MaxLaska/obsidian-contextual-action-panel`, local repo in `H:\Dropbox\11-Projects\A1_Obsidian contextual action panel - OCAP`, branch `master`.
- Stabilization phase 1 complete (baseline `4d233de`); Phase 2 Context Engine foundation complete (`5995ee5`); details in git history and `docs/ocap/audits/2026-09-16-initial-audit.md`.
- **Phase 3 is implemented and live-verified**: a reusable visual condition builder replaces the JSON textarea as primary UX, category-level conditions exist on the same condition model, locked mode collapses non-matching/empty categories via one central projection, management modes mark (never hide) context-hidden elements, 132 unit tests, full automated live smoke test in Obsidian 1.13.7 (0 errors).

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

## Verification (2026-09-16)

- `npm test`: **132/132 PASS** (8 files; new `conditionTree` 22, extended `conditions` with category/projection/mode/back-compat coverage, context-service regression test).
- `npm run lint`: PASS (0 problems) · `npx tsc --noEmit`: PASS · production build (`node esbuild.config.mjs production`, dist-only): PASS.

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
16. DnD (sort mode, 400ms long-press, trusted input): reorder within category, DOM + persisted `data.json` — PASS.
17. Static button unchanged/inert, no errors — PASS.
18. Script action executes exactly once (entry + top level) — PASS.
19. Zero React/console/unhandled errors across the whole run — PASS.

Extra: tabs and folder view checked in locked (Beta collapsed) and sort (Beta marked) mode.

## Caveats / open points

- When **all** categories are context-hidden in locked mode, the panel shows the generic "No categories yet, switch to edit mode to add" hint — a context-specific empty-state text would be nicer.
- The visual editor stores property `equals` values as strings; loose scalar comparison makes this equivalent for numbers/booleans, but hand-written JSON keeps its original scalar types until edited.
- Editor DOM behavior is covered by the live smoke test, not by unit tests (no jsdom environment in the Vitest setup; pure tree logic is fully unit-tested).
- Live-test mode/view switches went through the settings API (same code path as the nav menu); DnD and all modal flows used real trusted input.
- Popout windows / selection context: unchanged Phase 2 limitations.
- Pre-existing: 6 dev-dependency `npm audit` findings; Dropbox can transiently lock `node_modules`.

## Next step

Phase 4 candidates: first dynamic behaviors on the same condition model (`enabledWhen`, dynamic label/icon), context-specific locked-mode empty state, optional jsdom-based editor unit tests, packaging/release strategy + manifest id decision.
