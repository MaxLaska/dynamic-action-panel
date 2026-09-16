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

## Open decisions

The following are still open:

- visual condition editor design (and the related Button modal consolidation);
- category-level conditions and empty-category behavior in locked mode;
- final dynamic-component extension API;
- test coverage targets and component/UI testing approach (unit-test stack is decided: Vitest);
- packaging and release strategy for OCAP;
- final OCAP manifest `id` and public product naming details.
