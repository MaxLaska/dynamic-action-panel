# OCAP – Status

Last updated: 2026-09-16 (Phase 2 Foundation)

## Current state

- GitHub fork `MaxLaska/obsidian-contextual-action-panel`, local repo in `H:\Dropbox\11-Projects\A1_Obsidian contextual action panel - OCAP`, branch `master`.
- Stabilization phase 1 complete (baseline `4d233de`); details in git history and `docs/ocap/audits/2026-09-16-initial-audit.md`.
- **Phase 2 Foundation is implemented and live-verified**: versioned settings with a migration pipeline, a central reactive `OCAPContextService`, a declarative condition model with a pure evaluator, context-based button visibility integrated into the panel, a minimal advanced conditions UI, 65 new unit tests, and a full automated live smoke test in Obsidian 1.13.7.

## Phase 2 architecture

### Settings versioning & migration (`src/settings/settingsMigrations.ts`)

- `ButtonsPanelPluginSettings.settingsVersion`, current version **1** (`CURRENT_SETTINGS_VERSION` in `src/types/settings.ts`).
- `migrateSettings(raw)` is pure/deterministic and returns `{settings, changed, status, fromVersion}` with status `defaults | current | migrated | future`.
- Pipeline of `{from, apply}` steps; step `0→1` adopts unversioned upstream data: nested `panelConfig`/`pathConfig` are deep-merged over defaults (fixes the upstream shallow-merge gap), categories/buttons are preserved untouched, unknown top-level keys survive.
- Future versions (`settingsVersion > CURRENT`) are loaded best-effort, keep their higher version number and are **never rewritten or downgraded** (`main.ts` skips the persist in that case and warns).
- `main.ts loadSettings()` runs the migration and persists a migrated result exactly once via `saveData` (no render side effects during load).

### Context Engine (`src/context/`)

- `OCAPContext.ts`: immutable `OCAPContextSnapshot` (viewType, filePath, fileName, fileBaseName, fileExtension, folderPath, tags, properties) + pure `buildContextSnapshot` / `contextSnapshotsEqual` / `extractTagsFromCache` (inline + frontmatter tags, deduped, `#` stripped). No Obsidian runtime dependency.
- `OCAPContextService.ts`: plugin-level service (created/started in `onload`, stopped in `onunload`, `refresh()` re-run on `onLayoutReady`). Subscribes to `workspace active-leaf-change / file-open / layout-change`, `metadataCache changed` (context file only), `vault rename / delete` (context file only). Emits a new snapshot **only** when `contextSnapshotsEqual` says the context changed semantically; snapshot reference is stable otherwise.
- Context source semantics: the snapshot describes the **last active content leaf in the root split**. Focusing the buttons panel or sidebars does not change the context (mirrors `lastActiveContentLeaf`); if the tracked leaf is detached, `layout-change` falls back to `getMostRecentLeaf()`.
- React binding: `useOCAPContext()` (`src/hooks/useOCAPContext.ts`) via `useSyncExternalStore` on the service; no polling, no DOM observation, no new CustomEvents. The legacy `buttons-panel-refresh` bus is untouched (still used by modals).

### Conditions (`src/types/conditions.ts` + `src/context/conditions.ts`)

- Declarative, JSON-serializable tree: groups `all` / `any` / `not` plus atomic rules discriminated by `rule`: `viewType`, `path` (equals/startsWith/contains), `folder` (equals/segment-aware startsWith), `extension`, `property` (exists/equals incl. list properties, loose scalar compare), `tag` (nested-tag aware, `#` tolerant). No function strings, no eval.
- Pure interpreter: `isValidCondition` (structural validation, depth-capped), `evaluateCondition` (deterministic; missing context values evaluate rules to false; `all []` = true, `any []` = false), `isButtonVisibleInContext` (no conditions ⇒ visible; **invalid conditions fail open** ⇒ visible), `filterCategoriesByContext` (identity-preserving), `collectContextHiddenButtonIds`.

### Integration

- `ButtonConfig.conditions?: ButtonCondition` (optional; absent ⇒ 100 % upstream behavior).
- Single central integration point in `PanelContent.tsx`: in **locked** mode categories are filtered through `filterCategoriesByContext` before reaching the mode contents and the DnD provider; in **sort/edit** mode nothing is filtered — hidden buttons get the class `ocap-context-hidden` (dimmed + dashed outline) via `OCAPVisibilityContext` consumed in `SimpleButton`. DnD is only active in sort mode, i.e. always operates on unfiltered lists.
- Conditions affect **visibility only** in this phase (no enabled/name/icon/action/styling dynamics yet; model kept open for those).

### UI

- Minimal advanced editor `ConditionsInput` (`src/components/input/ConditionsInput.ts`): JSON textarea in `ButtonCreateModal` and `ButtonEditModal`, validated on save (`JSON.parse` + `isValidCondition`), invalid input blocks the save with a Notice + error marker, empty input clears conditions. i18n keys added to en/zh/ru. A visual condition builder is deliberately deferred.

## Verification (2026-09-16)

- `npm test`: **94/94 PASS** (7 files; 65 new across `settingsMigrations` 13, `ocapContextSnapshot` 15, `conditions` 26, `ocapContextService` 11 with a fake workspace/metadataCache/vault).
- `npm run lint`: PASS (0 problems) · `npx tsc --noEmit`: PASS · production build (`node esbuild.config.mjs production`, dist-only): PASS.

## Live smoke test (2026-09-16, all PASS)

Automated via CDP against an **isolated Obsidian 1.13.7 instance** (`--user-data-dir` in a scratch folder registering only the test vault `C:\Users\flash\ObsidianTestVaults\ocap-smoke`; the user's running production instance/vault and the global vault registry were never touched). Error monitoring (`window.onerror`, `unhandledrejection`, `console.error`) active throughout: **0 errors**.

1. Live migration: unversioned phase-1 `data.json` loaded, `settingsVersion: 1` persisted, all categories/buttons intact — PASS.
2. Static buttons visible in every mode; script button executes (top level + entry exactly once, Notice shown) — PASS.
3. viewType condition: visible on markdown, disappears when all tabs closed (`empty` view) — PASS.
4. Folder condition reacts to file switch `notes/` ↔ `other/` — PASS.
5. Tag condition reacts, including a **live frontmatter edit** (tag added via `processFrontMatter` → button appears via metadataCache event) — PASS.
6. Nested `all` (viewType + property equals) — PASS.
7. Locked mode hides non-matching button; focusing the panel itself does **not** change the context — PASS.
8. Sort and edit mode render the hidden button with the `ocap-context-hidden` marker; it stays manageable — PASS.
9. Real context-menu → edit-modal flow: conditions textarea prefilled; invalid JSON blocks save (Notice, nothing persisted); valid edit saves name + conditions, DOM updates immediately — PASS.
10. DnD (sort mode, long-press): two condition buttons reordered and persisted — PASS.

Final build re-verified live after the last lint refactor (context reactivity + filtering re-checked, 0 errors).

## Caveats / open points

- Categories whose buttons are all context-hidden keep their header/tile in locked mode (not collapsed away yet).
- Conditions UI is a JSON textarea (advanced); the visual condition builder is the documented next UI step and should trigger the planned modal consolidation (audit §12).
- Mode switches in the live test went through the settings API (same code path as the nav menu) rather than mouse clicks on the nav dropdown.
- Popout-window leaves are not context sources (root-split only); selection/cursor context not implemented (later phase).
- Pre-existing: 6 dev-dependency `npm audit` findings (unchanged baseline); Dropbox can transiently lock `node_modules` (EBUSY on `npm ci`).

## Next step

Phase 3 candidates: visual condition editor (with `ButtonCreateModal`/`ButtonEditModal` consolidation), category-level conditions / empty-category collapsing in locked mode, then the first dynamic behaviors (enabledWhen, dynamic label/icon) on top of the same condition model.
