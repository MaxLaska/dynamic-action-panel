# OCAP – Status

Last updated: 2026-09-16 (stabilization phase 1)

## Current state

- GitHub fork `MaxLaska/obsidian-contextual-action-panel`, local repo in `H:\Dropbox\11-Projects\A1_Obsidian contextual action panel - OCAP`, branch `master` @ upstream v2.4.7 baseline (`a20369c`).
- Initial read-only audit accepted (`docs/ocap/audits/2026-09-16-initial-audit.md`).
- **Stabilization phase 1 is complete**: baseline verified, test foundation established, all five confirmed audit findings fixed, live smoke test in Obsidian 1.13.7 fully green (details below).
- No OCAP feature implementation (Context Engine etc.) has started yet.

## Baseline verification (2026-09-16)

- Node v24.14.0, npm 11.9.0.
- `npm ci`: OK. Note: first attempts failed with `EBUSY` because **Dropbox locks `node_modules` during sync** — deleting `node_modules` and reinstalling resolved it; expect this to recur occasionally.
- `npm run lint`: PASS (0 problems) — before and after the changes.
- `npx tsc --noEmit`: PASS — before and after.
- Safe build without vault deploy: `node esbuild.config.mjs production` (writes only `dist/`) — PASS. `npm run build/dev` would additionally call `scripts/deploy.mjs`, which exits silently when no `.env` exists (none exists here; only `.env.example`).
- Pre-existing: `npm audit` reports 6 dev-dependency vulnerabilities (2 moderate, 4 high) — present at the unmodified baseline, untouched per scope.

## Test foundation

- **Vitest 3.x** (`npm test` = `vitest run`, `npm run test:watch`). Chosen because the project is esbuild-based ESM TypeScript: Vitest runs TS natively via esbuild, needs near-zero config, and is easily extended later for the Context Engine / condition resolver. Vitest 5 was rejected for now because its Vite 8 dependency requires esbuild ≥0.27 as a peer while the build pins esbuild 0.25.5.
- `vitest.config.ts`: alias `@` → `src`, alias `obsidian` → `tests/mocks/obsidian.ts` (the real package is a type-only stub without runtime), Node environment, tests under `tests/`.
- `eslint.config.mjs`: obsidianmd runtime rules disabled for `tests/**` and `vitest.config.ts` (Node-side tooling, not plugin runtime code).
- 29 tests in 3 files: `tests/scriptMetaParser.test.ts`, `tests/scriptService.getScriptMeta.test.ts`, `tests/shallowEqual.test.ts`. All PASS.

## Fixed audit findings

1. **NavigationBar hook order** (`src/components/shared/NavigationBar.tsx`): early `return null` on `showTopNavBar` moved below the `useState`/`useRef` calls.
2. **FolderModeContent hook order** (`src/components/buttons-panel/FolderModeContent.tsx`): the empty-categories early return moved below `handleRename` (`useCallback`) and its derived values. The masking remount workaround `key={'folder-'+filteredCategories.length}` in `PanelContent.tsx` was removed: it was introduced together with the folder view without other documented purpose, its only correctness effect was forcing a remount exactly when the early-return condition (`categories.length === 0`) could flip, and the state resets it caused as a side effect are covered by existing effects (open category disappearing closes the detail). Behavior change: an open folder detail no longer force-closes when the filtered category count changes (e.g. while typing a search query). Verified in the live smoke test (see below).
3. **ButtonItem memoization** (`src/components/button/ButtonItem.tsx` + `src/utils/shallowEqual.ts` + `src/components/modal/ButtonEditModal.ts`): the audit's framing was adjusted after checking the real data flow. Settings objects are shared by identity between React and `plugin.settings`, and `ButtonEditModal` used to edit buttons by in-place `Object.assign` — so **no prop comparator can ever detect an edit by value** (prev and next props read the same mutated object). Fix: (a) `ButtonEditModal` now replaces the edited `ButtonConfig` with a new object; (b) `ButtonItem` memo now compares all props by identity (`shallowEqualExcept`, ignoring the unused `index`). This both fixes the stale-render gap (changed actions/execution config now re-render, and freshly captured identities keep context-menu/click handlers pointing at live settings objects) and keeps memoization for the common identity-stable re-renders (drag, search typing). Convention going forward: **content edits must replace objects, not mutate them** (see DECISIONS.md).
4. **ScriptService.getScriptMeta** (`src/services/ScriptService.ts` + `src/utils/scriptMetaParser.ts` + `src/types/script.ts`): metadata is now extracted by a **static parser** — no `AsyncFunction`, no eval, no script execution. The parser scans for the last `module.exports = { ... }` assignment outside strings/comments and statically reads string/object/array literals for `name`/`description`/`tags`; non-static values (identifiers, calls, interpolated templates, spreads) are skipped in a controlled way; malformed literals yield `null`; an `entry` property must be present (mirrors the previous runtime contract). `getScriptMeta` now returns the new display-only type `ScriptFileMeta` (no entry function); the only consumer (`ScriptAction` → suggestion dropdown) uses name/description only. Script *execution* (`runScript`) still evaluates the module as before — that is the product feature.
5. **dnd-kit pinned exactly** (`package.json`): `@dnd-kit/core 6.3.1`, `@dnd-kit/sortable 10.0.0`, `@dnd-kit/utilities 3.2.2` (previous lockfile versions, carets removed). No upgrades performed.

## Verification after changes

- Tests: PASS (29/29) · Lint: PASS · `tsc --noEmit`: PASS · Build (`node esbuild.config.mjs production`): PASS.
- `git status` reviewed: no `node_modules`, no `.env`, no vault files, `dist/` remains gitignored. `package-lock.json` diff is large but consists only of the vitest/vite dev-dependency tree plus the dnd-kit pinning; all packages resolve from registry.npmjs.org; root esbuild stays 0.25.5 (vite uses its own nested copy).

## Live smoke test (2026-09-16, all PASS)

Automated live test of the real production build in **Obsidian 1.13.7**, run via the Chrome DevTools Protocol against the throwaway vault `C:\Users\flash\ObsidianTestVaults\ocap-smoke` (junction `.obsidian/plugins/buttons-panel` → repo `dist/`; deploy via `.env` + `node scripts/deploy.mjs dev`). `window.onerror`, `unhandledrejection` and `console.error` were monitored throughout: **0 errors observed**.

1. NavigationBar toggle (4× via the real settings path): nav bar mounts/unmounts correctly, no hook-order crash — PASS.
2. Folder view empty↔non-empty (categories 0→1→0→2): correct empty hint/tiles, no hook crash without the remount key — PASS.
3. Folder detail + search (remount key removed): detail stays open while its category matches, auto-closes when filtered out; no-hit state and filter reset correct — PASS.
4. Button edit through the real context-menu → edit-modal → save flow: settings updated, object identity replaced, panel DOM shows the new name immediately — PASS.
5. Script metadata: `scripts/test.js` with a measurable top-level side effect; `getScriptMeta` returned localized name/description/tags with the side-effect counter staying 0; a subsequent button click executed top level + entry exactly once — PASS.
6. Drag & drop regression (sort mode, 400 ms long-press): drag activated, two buttons reordered and persisted — PASS.

The production vault (`H:\Dropbox\01_Uni\A1_Nexus`) was never opened or modified (Obsidian's vault registry was temporarily pointed at the test vault and byte-identically restored afterwards); source code was unchanged during the whole smoke test.

**Known test limitations (documented honestly):** (a) tests 1–2 triggered state changes through the settings API — the same code path the settings tab uses, but not via mouse clicks in the settings UI; (b) test 5 called `getScriptMeta` directly instead of focusing the script input field with the mouse — the suggester's prefetch calls exactly this method.

## Caveats / open points

- The static metadata parser is intentionally conservative: exotic but valid metadata (computed values, concatenation, `exports.name = ...` style) now yields `undefined`/`null` instead of a value. UI falls back to the file basename.
- Chinese hardcoded UI string in `FolderDetailOverlay.tsx` and other audit cleanup items (dead code, duplicate menus) remain untouched (out of scope for phase 1).
- Local dev deploy is configured via gitignored `.env` → test vault `C:\Users\flash\ObsidianTestVaults\ocap-smoke`; `npm run dev`/`build` will deploy there (and only there) until `.env` is changed.

## Next step

Start the OCAP foundation: `settingsVersion` + settings migration pipeline, followed by the first `OCAPContext`/ContextService with a declarative `conditions` model (see audit §12).
