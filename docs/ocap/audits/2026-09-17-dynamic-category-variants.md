# Dynamic Category Variants — implementation and live verification (2026-09-17)

Phase 5. The palette context-layer model from Phase 4b is **replaced** by
dynamic category variants: a deliberate product-model change after a manual
UX test, not an extension.

## 1. Why the layer model was retired

The Phase 4b model (base/pinned layer + context profiles + locked base slots +
per-layer button ownership) was technically sound and fully live-verified, but
the manual UX test showed it demands too much invisible state from the user:

- which layer is currently being edited;
- which layer a given tool belongs to;
- where to park tools while moving them between layers;
- which slots are blocked by which other layer.

The mental model did not scale. It is replaced, for grid categories, by a
model with **no inheritance, no pinned slots, no cross-layer blocking and no
mixed ownership inside one visible grid**.

## 2. The new model

A grid category is either:

- **STATIC** — one full 4×4 grid in `category.buttons`. Always the same
  tools, no context behavior. (A flow category stays what it always was.)
- **DYNAMIC** — one stable container (`category.variants`) holding several
  **complete** variants. Each variant is a full, independent 4×4 grid with a
  stable id, a name and exactly one trigger (`ButtonCondition`) — or it is the
  single **fallback** variant, which has no trigger.

Runtime (locked mode):

1. triggered variants are checked in array order — **first match wins**;
2. no match → the fallback variant, if one exists;
3. otherwise the category renders nothing and is hidden.

The fallback is modelled explicitly (`fallback: true`), never as a hidden
always-true trigger, so it can never shadow a triggered variant through its
position. An always-matching *triggered* variant is expressible explicitly as
`{ all: [] }` and respects priority like any other trigger — that is also how
the migration preserves the old "profile without condition" semantics.

Deliberate redundancy: if `Source` and `Topic` agree on 14 of 16 slots, those
buttons are stored twice. **Predictable, independently editable variants beat
normalized data.** Editing a button in one variant can never leak into
another (no shared object graphs; duplicate regenerates every button id).

The variant switch never moves the category: same id, same position, same
container — only the rendered grid content changes.

### Division of labour (unchanged pieces)

| | Grid category (static or dynamic) | Flow category |
|---|---|---|
| `ButtonConfig.conditions` | ignored at runtime (inert legacy data is preserved) | unchanged Phase-3 per-button filtering |
| `CategoryConfig.variants` | dynamic: decides which full grid renders | ignored |
| `CategoryConfig.conditions` | whole-category visibility only | category visibility, unchanged |

## 3. Architecture

### Pure core — `src/utils/categoryVariants.ts` (replaces `paletteLayers.ts`)

No Obsidian imports, no stored functions, nothing mutated.

- `resolveDynamicCategoryVariant(category, context)` → `{variant, reason:
  'trigger' | 'fallback' | 'none'}` — the runtime rule in one function.
- `resolveGridViewForContext` / `resolveGridViewForVariant` →
  `ResolvedGridView` (16 slots + overflow); locked mode resolves by context,
  the management modes by the user's selection (an unknown selection falls
  back to the first variant).
- Variant ops: `addVariant`, `updateVariant` (refuses a second fallback),
  `removeVariant`, `moveVariant` (order IS priority; the fallback is not
  movable — its position never matters), `duplicateVariant` (full copy, new
  variant id, new button ids, inserted below its source).
- Grid button placement across variants: `addButtonToGrid`,
  `removeButtonFromGridCategory`, `replaceButtonInGridCategory`,
  `findButtonVariantId`, `applySlotIdsToGridCategory` (drag write-back into
  exactly the on-screen grid; off-screen variants untouched; unclaimed
  overflow preserved).
- Conversions: `convertStaticGridToDynamic` (existing grid → first variant,
  nothing lost), `convertCategoryToGrid` (flow → static grid; a flow category
  WITH per-button conditions becomes a dynamic category — fallback = the
  condition-free tools, one full triggered variant per distinct condition —
  because a grid ignores per-button conditions and silently making
  conditional tools permanent would be data loss in disguise),
  `convertStaticGridToFlow`. Dynamic → flow is **refused**
  (`reason: 'dynamic_category'`): flattening several complete variants into
  one list would lose data. Dynamic → static is deliberately not offered in
  this phase.
- Composition rule shared with the migration: `composeFullVariant` (base grid
  + overlay on the slots the base leaves free — exactly the old effective
  runtime grid) and `composeFallbackVariant`.

### Editor UI

- `VariantSelector` (`src/components/buttons-panel/VariantSelector.tsx`),
  shown above the grid of a dynamic category in sort/edit mode:

      Editing: [ Source ▾ ]  [⇄ Topic]     [copy] [+] [⋮]
      Trigger: type = Source   ·   Active now: Topic

  - a **dropdown** (scales to many variants; the old chip row is gone);
  - **⇄ quick A/B flip** to the previously edited variant (pure UI state,
    labelled with that variant's name);
  - duplicate / new / options (`⋮`: edit name & trigger, move up/down,
    delete);
  - a second line separating the two concepts that must never be confused:
    the trigger of the variant being EDITED and the variant the current
    Obsidian context resolves to at RUNTIME (`Active now: …`, including
    `none (category hidden)` and `(fallback)`).
- Without an explicit pick, editing **preselects the runtime-active variant**,
  so switching from locked into a management mode never silently changes what
  the grid shows.
- `VariantModal` (create / edit / duplicate / make-dynamic): name, a fallback
  toggle (disabled while another variant holds the role; hides the trigger
  section), and the shared `ConditionEditor` as the trigger editor. An empty
  trigger is stored explicitly as `{ all: [] }` ("always matches").
- Deleting the last variant is refused with an explaining Notice; deleting a
  variant with tools lists them first.
- "Make dynamic…" lives in the category context menu of static grid
  categories; the modal prefills the category name.
- The button modals state the target variant instead of offering a condition
  editor; new tools land in the variant being edited.
- Markers: a dynamic category's title icon is `layers` (static grid keeps
  `layout-grid`, flow keeps `list`). Per-button pin/filter badges are gone
  inside grids — contextuality is a variant-level fact, stated by the
  selector and the title icon. Flow categories keep the condition-based
  badges unchanged.

### Rendering / projection / DnD

- `CategoryVariantContext` (replaces `PaletteLayerContext`) distributes the
  resolved grid views and owns the per-category `{current, previous}`
  selection (never persisted; normalized against existing variants, so a
  deleted variant can never leave the UI on a phantom grid).
- `projectCategoriesForContext` returns `gridViews` instead of `palettes`;
  locked mode resolves variants, management modes resolve the selection.
- DnD: `BlockedSlots`, pinned cells, reserved cells and locked cells are
  gone. The drag state mirrors the ONE grid on screen; a drag in `Source`
  cannot see `Topic`. `applySlotIdsToGridCategory` writes back into exactly
  that grid; a tool arriving from another category joins it. The only
  remaining grid rejection is flow → occupied slot (no well-defined position
  for the displaced tool in a flow list); it reverts the drag with a Notice.

### Settings — version 3

`CURRENT_SETTINGS_VERSION = 3`; chain `0 → 1 → 2 → 3` (forward-only, the v2
step is kept verbatim as internal legacy code so old documents still migrate).

`2 → 3` for each grid category with context profiles:

- every profile becomes ONE complete variant reproducing the old effective
  runtime grid: the base/pinned buttons on their exact slots plus the
  profile's buttons on the slots the base left free (collisions relocate by
  the same deterministic rule the v2 runtime used);
- base copies get deterministic derived ids (`<profileId>--<buttonId>`) so
  every button id stays unique across variants; profile-owned buttons keep
  their ids;
- profile order → variant priority; a profile's condition → the trigger; a
  conditionless profile → the explicit always-true trigger `{ all: [] }`
  (identical priority semantics);
- the base-only state (what v2 showed when nothing matched) becomes the
  fallback variant `Default` — the old runtime semantics survive exactly;
- `category.buttons` is emptied; `contextProfiles` is removed;
- a grid category WITHOUT profiles stays a **static** grid, untouched;
- malformed profile entries (which the v2 runtime filtered out and never
  rendered) are skipped, exactly mirroring the old behavior — they can not
  suddenly become active always-matching variants;
- flow categories and all other settings pass through untouched; the step is
  deterministic and idempotent.

## 4. Verification

- `npm test`: **324/324 PASS** (14 files). New: `categoryVariants` 54 (kind
  detection, trigger matching incl. the non-fail-open invalid-trigger rule,
  first-match/priority/fallback resolution, grid views, variant management,
  full-copy duplication with id regeneration and independence, cross-variant
  button placement, drag write-back incl. overflow safety, conversions,
  lifting, composition), `variantDrag` 9 (drag state mirrors the selected
  variant, move/swap isolation with byte-identical untouched variants,
  flow→grid rules, persistence round-trip). `settingsMigrations` 38 with the
  whole v2→v3 surface (composition, id uniqueness, config preservation,
  conditionless profiles, empty profiles, collisions, malformed data,
  priority, idempotence, flow untouched); `gridVisibility` rewritten onto
  variants; `categoryGrid` conversion tests updated.
- `npm run lint`: PASS (0 problems) · `npx tsc --noEmit`: PASS · production
  build: PASS.

## 5. Live smoke test (isolated Obsidian 1.13.7, 107 checks PASS, 0 errors)

Automated via CDP against an **isolated** instance: scratch `--user-data-dir`
registering only a snapshot copy of `ocap-smoke` with its own, non-symlinked
plugin directory and a **version-2 fixture** `data.json` (base + Source/Topic
profiles, a flow category with per-button conditions and a script action, a
static grid). The user's own Obsidian (4 running processes), its configuration
and both real vaults were never touched; the source vault's `data.json` was
verified unchanged afterwards. `window.onerror`, `unhandledrejection` and a
`console.error` wrapper were active before the plugin loaded: **0 errors**
across the entire run.

- **Migration (22):** version 3 on disk and in memory, byte-equal; profiles →
  full variants `Source`/`Topic` with the exact old effective slots; fallback
  `Default` = base-only with original ids; unique ids across variants; static
  grid stayed static with slots preserved; flow untouched; the panel rendered
  two 16-cell grids and exactly one variant bar.
- **Runtime (14):** Source note → Source grid, Topic note → Topic grid (same
  slot, different tool), plain note → fallback; byte-identical restoration on
  switching back; static grid identical in every context; flow per-button
  conditions still filter; locked mode shows no selector; edit mode
  preselects the runtime-active variant with correct trigger/Active-now
  lines.
- **Editor UX (31):** dropdown switching; "editing Topic while runtime is
  Source" stated side by side; ⇄ flip between the last two edited variants in
  both directions; duplicate prefills "`Source` copy" + the source trigger,
  auto-selects the copy, copies grid/actions/appearance with new variant and
  button ids, inserts below the source; a tool created afterwards lands in
  the copy on the lowest free slot with the modal naming the target variant
  and offering no condition editor; the original stays untouched; first
  match wins; Move up really changes the runtime winner; five variants stay
  usable in the dropdown; an empty new variant renders 16 empty cells and its
  empty trigger is stored as the explicit always-match; delete confirms.
- **DnD / persistence / conversion (32 + 8):** move to an empty slot and swap
  with an occupied one change only the dragged variant — the others are
  byte-identical, including across a plugin reload; **no cascading reorder**
  across crossed cells (see defect 2 below); flow → occupied slot rejected,
  reverted and explained; the script action executes exactly once; "Make
  dynamic…" converts the static grid to one fallback variant keeping every
  button and slot; deleting the last variant is refused; deleting the
  fallback (after confirmation naming its tools) makes the category
  disappear on a plain note (no match, no fallback) and reappear on a
  matching one.
- **Views / markers (11):** tabs and folder view render the variant grid as a
  real 16-cell grid; a locked-mode click on a variant tool executes its
  action exactly once; dynamic categories carry the `lucide-layers` title
  icon (list and tabs), flow keeps `lucide-list`.

A handful of first-attempt failures were test-harness artifacts (per-cell
`scrollIntoView` invalidating previously measured drag coordinates; Electron
pausing `requestAnimationFrame` for the occluded background window, fixed with
`--disable-backgrounding-occluded-windows`; state drift between phases). Each
was re-verified green; none was a product failure.

### Defects found and fixed during the live test

1. **The ⇄ flip had no target after an implicit selection.** The "previous"
   variant was recorded only for explicit picks, but the first grid a user
   sees in the editor is usually the implicit runtime-derived preselection —
   switching away from it left nothing to flip back to. The selection now
   records what was actually on screen (via the normalized state), so
   `Source (implicit) → Topic` immediately offers `⇄ Source`.
2. **Releasing a drag committed intermediate swaps from cells crossed on the
   way** (pre-existing since Phase 4a, but first observed here). The live
   preview was applied cumulatively per hovered cell, so dragging `Home` from
   slot 0 across occupied slots 1 and 2 to slot 3 shuffled all four tools —
   violating the documented rule "an occupied target swaps, nothing else
   moves". Previews and the final drop are now always computed from the
   drag-start baseline; a release over the dragged tool itself (which sits on
   its preview cell) keeps the preview instead of recomputing it against the
   baseline; a still-pending (rAF-deferred) drag-over is flushed synchronously
   before the drop is finalized.

Observation, not a defect: duplicating a variant passes its trigger through
the shared ConditionEditor, which canonicalizes a bare rule to `all [rule]`
(documented Phase-3 behavior, semantically identical).

## 6. UX assessment (against the eight questions of the task)

1. *Which variant am I editing?* — the dropdown is the loudest element of the
   bar, the hint line restates the trigger, and the preselection follows the
   runtime, so mode switches never silently change the grid. **Yes.**
2. *Fast Source ↔ Topic flipping?* — one click on ⇄, labelled with the target
   name, both directions verified. **Yes.**
3. *Is a staging container needed to manage tools across variants?* — no:
   each variant is complete; duplicate-then-edit replaces every cross-layer
   move workflow. **Not needed.**
4. *Duplicate Source into Topic without layer knowledge?* — one click,
   rename, retrigger, done; the copy is selected with its grid on screen.
   **Yes.**
5. *Which trigger belongs to which variant?* — the `Trigger:` line always
   describes the edited variant; the modal shows the full editor. **Yes.**
6. *Which variant is runtime-active?* — the `Active now:` line, including
   `none (category hidden)` and the `(fallback)` annotation. **Yes.**
7. *5–10 variants without UI chaos?* — a native dropdown; verified with 5;
   nothing in the bar grows with the variant count. **Yes.**
8. *Does the user need to know where a button is "stored internally"?* — no:
   a button lives in exactly the variant whose grid shows it, and the button
   modal states that variant by name. **Not needed.**

## 7. Known limits

- Dynamic → static (and dynamic → flow) conversion is deliberately not
  offered: it would collapse several complete grids into one. Delete
  variants first, or keep the grid.
- Duplicating a whole dynamic *category* regenerates ids but keeps variant
  names; the copy is fully independent (verified by `duplicateCategoryConfig`
  copying every variant).
- The A/B flip history is one step deep and session-local by design.
- A version-3 document opened by a pre-version-3 build shows a dynamic
  category as an empty grid (its variants live in a field that build does not
  know). Forward-only migration remains the policy.
- Grid dimensions remain fixed at 4×4; locked mode still reserves all four
  rows (unchanged Phase 4a trade-off).
- The variant bar's DOM is covered by the live test, not by unit tests (no
  jsdom environment; the pure resolution/ops layer is fully unit-tested).
