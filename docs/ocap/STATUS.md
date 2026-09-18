# OCAP – Status

Last updated: 2026-09-17 (Phase 5.1 – Variant Grid DnD robustness & UX polish)

## Current state

- GitHub fork `MaxLaska/dynamic-action-panel`, local repo in `H:\Dropbox\11-Projects\A1_Obsidian contextual action panel - OCAP`, branch `master`.
- Stabilization phase 1 complete (baseline `4d233de`); Phase 2 Context Engine foundation (`5995ee5`); Phase 3 visual condition rules (`a88d92e`); desktop DnD activation fix (`3267842`); Phase 4a palette grid (`31199ae`); Phase 4b palette context layers (`90f5b38`); Phase 5 dynamic category variants (`3177f1d`). Details in git history and `docs/ocap/audits/`.
- **Phase 5 (dynamic category variants) is implemented and live-verified.** The Phase 4b layer model (Base/Pinned + context profiles + locked/reserved slots) was **retired after a manual UX test** — too much invisible state. A grid category is now either STATIC (one full grid) or DYNAMIC (complete, independent variants; first matching trigger wins, explicit fallback, else hidden). Settings version 3 with a forward-only migration that reproduces the old runtime grids exactly. Full detail: `docs/ocap/audits/2026-09-17-dynamic-category-variants.md`.
- **Phase 5.1 (polish round after the manual user test) is complete.** The intermittent "drag dead after a variant switch" bug is root-caused and structurally fixed: empty-slot droppables used to mount/unmount per variant switch, so a drag started right after a switch raced their dnd-kit registration/measurement and the drop fell through to the container zone (self-healing on any later re-render — hence the "re-select sort mode" workaround). **Every grid cell is now a permanent droppable** (`GridSlotCell` renders filled and empty cells, keyed by slot), which also makes the whole cell the drop hitbox. Plus: explicit 4×4 grid chrome in the management modes with mode-invariant geometry, drag preview/overlay geometrically identical to the final slot rendering, priority wording ("wins earlier/later"), variant bar readable at narrow widths. 340 unit tests; ~215 automated live drags/checks in an isolated Obsidian 1.13.7 (0 errors). Full detail: `docs/ocap/audits/2026-09-17-variant-grid-dnd-ux-polish.md`.

- **Future-Settings-Schutz (2026-09-18).** Eine `data.json` mit höherer `settingsVersion` als dieser Build versteht, wird jetzt als **read-only** behandelt statt überschrieben. Der Migrations-Pipeline war der Fall immer bekannt (`status: 'future'`), das Signal wurde aber nur geloggt — die nächste beliebige Benutzeraktion schrieb die verlustbehaftete In-Memory-Sicht zurück und behielt dabei die höhere Version, sodass kein späterer Build den Schaden erkannt hätte. Schutz sitzt in `src/utils/settingsWriteGuard.ts` (`persistSettings` ist der einzige `saveData`-Aufruf); die drei Commit-Funnels lehnen **vor** der Mutation ab und liefern `boolean`, damit keine Aufrufstelle Erfolg meldet, den es nicht gab. Zustand pro Plugin-Instanz, bei jedem Laden neu abgeleitet. Lesen, Navigieren und Tool-Ausführung bleiben vollständig nutzbar; Settings-Tab disabled mit Erklärung; Export erlaubt (mit Vollständigkeits-Hinweis), Import abgelehnt. Kein Downgrade. Dazu ein zweiter, schwererer Fund aus dem Review: eine *unbrauchbare* `settingsVersion` (String, Float, `Infinity`) fiel auf 0 zurück, wurde durch die ganze Migrationskette gejagt — was jede `placements`-Liste leerte — und beim Start geschrieben; jetzt `status: 'unreadable'` und ebenfalls read-only. 43 neue Tests in `tests/futureSettings.test.ts`. Detail in `DECISIONS.md` und `HANDOFF.md` §1b.
- **Build/Deploy-Trennung (2026-09-18).** `npm run build` baut nur noch (`tsc` + esbuild → `dist/`) und fasst keinen Vault an; das automatische Deploy am Ende ist entfernt. Installiert wird über `npm run deploy:smoke` bzw. `npm run deploy:prod` (letzteres nur mit `--confirm-production`), gegen eine Ziel-Allowlist in `scripts/deployCore.mjs`. **Deploy schreibt `data.json` nicht mehr** — kein Überschreiben, kein Zurückkopieren, kein Löschen des Plugin-Ordners (gelesen wird sie nur zum Hashen und fürs Prod-Backup); stattdessen Staging-Datei + Rename je Artefakt und ein SHA256-Vergleich von `data.json` vorher/nachher. Die Dev-Junction ist entfallen (sie war die Quelle von `dist/data.json`), ersetzt durch `npm run dev:smoke`. 59 neue Tests in `tests/deploySafety.test.ts`. Detail in `HANDOFF.md` §1a.
- **Template Library (2026-09-18).** Panel templates now live in one fixed, visible vault folder `Dynamic Action Panel/Templates/` instead of the vault root. Export writes there without a dialog, the primary import lists that folder in a `FuzzySuggestModal`, the OS file picker survives as the explicitly secondary `Import template from file…`, and `Open template folder` opens it in Explorer/Finder using only public API (`FileSystemAdapter#getFilePath` + `window.open(url, '_external')`). The path is deliberately NOT configurable and is NOT `pathConfig.templateFolderPath`. No format or settings-version change. Detail in `DECISIONS.md` and `docs/ocap/template-format.md` §9.

> Note: the sections below still describe the state at Phase 5.1 (2026-09-17) and are stale in two known places — `CURRENT_SETTINGS_VERSION` is 5, not 3, and the suite is 907 tests in 34 files, not 340 in 15. The ZotFlow annotation work and the template library are not reflected in them.

## Phase 5 architecture – dynamic category variants

### Product model (see DECISIONS.md, superseding decision)

- **Static category**: flow (historical) or static grid — one full 4×4 grid in `CategoryConfig.buttons`, no context behavior.
- **Dynamic category**: `CategoryConfig.variants: CategoryVariant[]` — one stable container, several COMPLETE variants. Each variant: stable `id`, `name`, exactly one `trigger` (`ButtonCondition`) **or** `fallback: true` (at most one), and its own full `buttons` grid.
- Runtime: first matching trigger in array order → else fallback → else the category is hidden. No merging, no inheritance, no pinned slots, no cross-variant blocking. Redundant storage across variants is deliberate.
- A variant switch changes only the rendered grid inside the same category container (same id, position, name).
- A grid ignores per-button conditions (`ButtonConfig.conditions` is inert legacy data there); flow categories keep the Phase-3 per-button model. `CategoryConfig.conditions` stays whole-category visibility only.

### Pure core (`src/utils/categoryVariants.ts`, replaces `paletteLayers.ts`)

- `resolveDynamicCategoryVariant(category, context)` → `{variant, reason: 'trigger'|'fallback'|'none'}`; `resolveGridViewForContext` / `resolveGridViewForVariant` → `ResolvedGridView` (16 slots + overflow). An invalid trigger never matches (non-fail-open, so a corrupt variant cannot shadow the rest); an absent trigger never matches — always-match is explicit `{ all: [] }`.
- Variant ops (pure, immutable): add / update (refuses a second fallback) / remove / move (fallback not movable) / `duplicateVariant` (full copy, new variant + button ids, inserted below source).
- Button placement across variants: `addButtonToGrid`, `removeButtonFromGridCategory`, `replaceButtonInGridCategory`, `findButtonVariantId`, `applySlotIdsToGridCategory` (drag write-back into exactly the on-screen grid; off-screen variants byte-identical; unclaimed overflow preserved).
- Conversions: `convertStaticGridToDynamic` (grid → first variant, lossless); `convertCategoryToGrid` (flow → static grid, or → dynamic with fallback + one full variant per distinct per-button condition); dynamic → flow/static **refused** (`'dynamic_category'`).
- `composeFullVariant` / `composeFallbackVariant` — the composition rule shared with the v2→v3 migration.

### Editor UI

- `VariantSelector` above a dynamic grid (sort/edit): `Editing: [Source ▾]` dropdown (scales to many variants), **⇄ quick A/B flip** to the previously edited variant, duplicate / new / `⋮` menu (edit name & trigger, move up/down, delete), plus a status line `Trigger: … · Active now: …` separating EDITED variant from RUNTIME-active variant (`none (category hidden)`, `(fallback)` annotations included).
- Without an explicit pick, editing preselects the runtime-active variant (no silent grid change on mode switch). Selection incl. the ⇄ history is session-local UI state (`CategoryVariantContext`), normalized so a deleted variant can never stay selected.
- `VariantModal` (create/edit/duplicate/make-dynamic): name, fallback toggle (disabled when taken; hides the trigger section), shared `ConditionEditor` as trigger editor; empty trigger saved as explicit `{ all: [] }`.
- Deleting the last variant is refused (Notice); deleting a variant with tools confirms and names them. "Make dynamic…" sits in the context menu of static grid categories.
- Button modals state the target variant instead of a condition editor; new tools land in the edited variant.
- Markers: dynamic category title icon `layers`, static grid `layout-grid`, flow `list`. No per-button pin/filter badges inside grids any more (variant-level contextuality); flow badges unchanged. Locked mode shows no selector.

### Rendering / DnD

- `projectCategoriesForContext` returns `gridViews` (locked: runtime resolution; sort/edit: the selected variant) — `panelProjection.ts`.
- Drag state mirrors the ONE grid on screen; a drag in `Source` cannot touch `Topic`. `BlockedSlots`, pinned/reserved/locked cells are gone. Only remaining grid rejection: flow → occupied slot (reverted + Notice).
- **Drag previews and drops are computed from the drag-start baseline** (`ButtonDragContext`): crossing occupied cells leaves no trail of intermediate swaps; release over the dragged tool itself keeps the preview; a pending rAF drag-over is flushed synchronously at drop. (Fixes a pre-existing Phase-4a defect found live.)
- **Every grid cell is a permanent droppable** (Phase 5.1): `GridSlotCell` renders filled AND empty cells keyed by slot, so the 16 droppable nodes and their measured rects survive variant switches — the root cause of the intermittent "drag dead after variant switch" bug. Collision ranking (button > slot > zones) unchanged; the whole cell is the drop hitbox. Grid chrome: `--managed` (edit+sort) shows all 16 cells (solid filled / dashed empty), `--sort` at full strength; constant 1px cell border in every mode keeps geometry mode-invariant. Flag-gated DnD lifecycle tracing: `window.__DYNAMIC_ACTION_PANEL_DND_DEBUG = true`.

### Settings – version 3

`CURRENT_SETTINGS_VERSION = 3`, chain `0 → 1 → 2 → 3` (the v1→v2 step lives on as internal legacy code in `settingsMigrations.ts`). v2→v3: every context profile → one complete variant (base + profile on the old effective slots, deterministic derived ids `<profileId>--<buttonId>` for base copies), base-only state → fallback `Default`, profile order → priority, conditionless profile → `{ all: [] }`. Grid categories without profiles stay static; malformed profile entries (dead in v2) are skipped; flow categories untouched; deterministic + idempotent. **Accepted:** a v3 document in a pre-v3 build shows a dynamic category as an empty grid.

## Unchanged foundations

- Phase 2: versioned settings + forward-only migrations; `WorkspaceContextService` snapshot store (`useSyncExternalStore`); declarative serializable conditions, fail-open, pure interpreter.
- Phase 3: one central rendering projection; locked filters / management marks; `ConditionEditor` (visual builder + explicit-apply JSON) shared by all modals; category `conditions` = visibility only.
- Phase 4a: 4×4 grid, 16 stable slots, slot lives on the button, holes are real, `placeButtonsOnGrid` self-heals deterministically; positional drop semantics (move to empty / swap occupied / flow→grid empty-only / grid→flow list insert); desktop DnD distance activation (4px, no long press).

## Verification (2026-09-17, after Phase 5.1)

- `npm test`: **340/340 PASS** (15 files). Phase 5 added `categoryVariants` 54, `variantDrag` 9, `settingsMigrations` 38; Phase 5.1 added `variantGridDnd` 16 (slot droppables on occupied cells, collision ranking, A→B→A drag-state round-trip, duplicate id-disjointness, `selectedVariantOf` normalization incl. deletion).
- `npm run lint`: PASS (0 problems) · `npx tsc --noEmit`: PASS · production build: PASS.

## Live smoke test (2026-09-17, Phase 5, 107 checks PASS, 0 errors)

Automated via CDP against an isolated Obsidian 1.13.7 (scratch `--user-data-dir`, snapshot copy of `ocap-smoke`, non-symlinked plugin dir, **version-2 fixture** so the run exercised the real migration; the user's running Obsidian and both real vaults untouched, source `data.json` verified unchanged). Error monitors active before plugin load: **0 errors** throughout.

- **Migration (22):** v3 on disk+memory byte-equal; profiles → full variants with exact old effective slots; base-only → fallback `Default`; unique button ids; static grid stayed static; flow untouched.
- **Runtime (14):** Source/Topic/plain notes resolve to the right full grids with stable slots and byte-identical restoration; flow conditions still filter; locked shows no selector; editing preselects the runtime variant.
- **Editor UX (31):** dropdown switching, ⇄ flip both ways, duplicate workflow end-to-end (prefill, auto-select, full copy, new ids, original untouched), tool creation into the edited variant, priority + Move-up changing the runtime winner, 5 variants usable, delete confirm.
- **DnD/persistence/conversion (40):** move/swap change only the dragged variant (others byte-identical, also across plugin reloads); no cascading reorder across crossed cells; flow→occupied rejected+reverted+explained; script action runs once; make-dynamic lossless; last-variant delete refused; no-match+no-fallback hides the category.
- **Views/markers (11):** tabs+folder render 16-cell variant grids; locked click executes once; `layers`/`list` title icons correct.

Two defects were found and fixed during the run (⇄ flip after implicit selection; cumulative drag-preview swaps — a pre-existing 4a defect). Detail: `docs/ocap/audits/2026-09-17-dynamic-category-variants.md`.

## Live verification (2026-09-17, Phase 5.1 — DnD stress, ~215 checks PASS, 0 errors)

Isolated Obsidian 1.13.7 (scratch `--user-data-dir`, snapshot vault, own fixture A/B/Z). Every drag validated by post-drop DOM occupancy; after each switch the harness waited only until the new grid was rendered, then dragged immediately. Results: 40/40 A/B switch+drag; 35/35 A/B/Z rotation; 6/6 create/duplicate(UI)/delete/priority + drags; 20/20 quick-⇄+drag; 30/30 sort/edit/sort transitions; 50/50 switch+drag stress; 30/30 quick-⇄ stress; 30/30 clean-build re-run. Regression: locked runtime resolution (A/B/fallback), script click once, static grid, tabs-view grid + drags, runtime preselection, reload byte-identity. Preview alignment measured: preview/overlay/final byte-equal size, centered within 0.1px. 4-column invariant verified at widths 500→150px, slot 16 drag at 150px. Before the fix the same harness reproduced the user's bug deterministically. Detail: `docs/ocap/audits/2026-09-17-variant-grid-dnd-ux-polish.md`.

## Caveats / open points

- Dynamic → static/flow conversion is deliberately not offered (data-loss path); delete variants first or keep the grid.
- The ⇄ flip history is one step deep and session-local by design.
- Migration redundancy: base tools are duplicated into every variant — intended, but a large v2 palette with many profiles grows accordingly.
- The `ConditionEditor` canonicalizes a bare-rule trigger to `all [rule]` on save (semantically identical; visible in stored JSON after editing/duplicating).
- A v3 document opened by a pre-v3 build shows a dynamic category as an empty grid (forward-only migration policy).
- Variant-bar DOM is covered by the live smoke test only (no jsdom); the pure core is fully unit-tested.
- A grid always reserves four rows; dimensions fixed at 4×4 (unchanged).
- Live-test mode/view switches went through the settings API (same code path as the nav menu); DnD, menus and all modal flows used real trusted CDP input. Note for future live runs: launch the isolated instance with `--disable-backgrounding-occluded-windows`, or rAF-driven previews pause while the window is occluded.
- Pre-existing: 6 dev-dependency `npm audit` findings; Dropbox can transiently lock `node_modules`.

## Next step

1. **Slot hotkeys** — slot identity is stable and variant-independent; only the keybinding layer is missing.
2. **Toggle tools** (OFF/ON state with separate actions/appearance) — needs a tool-type notion on `ButtonConfig`.
3. **Rich tooltip / description** — name, description, variant, hotkey in one hover surface.
4. Category/variant export-import — a dynamic category is a self-contained JSON tree.
5. `enabledWhen` and dynamic labels/icons on the existing condition model.

Still open from earlier phases: context-specific locked-mode empty state, optional jsdom-based editor unit tests, packaging/release strategy + manifest id decision.
