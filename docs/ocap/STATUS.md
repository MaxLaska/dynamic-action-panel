# OCAP – Status

Last updated: 2026-09-20 (The colour bar is a paint tool: choose a
colour, then work with it — arming needs no selection and the chosen
colour is visible; implemented locally and live-smoke-tested in an
isolated Obsidian; awaiting the user's own manual acceptance)

## Newest work first

- **A swatch is a paint colour (2026-09-20) — implemented locally,
  live-smoke-tested, deployed only to the disposable smoke vault. Not pushed,
  not in the productive vault.** Normative: `cell-selection-colors.md` §8,
  §8.2, §10, §10.1; `DECISIONS.md` "A swatch is a paint colour: choose it,
  then work with it".
  - **A plain click always means "paint with this"**: it chooses the colour,
    and paints the selection too if there is one. It never selects — that is
    what Shift (add the colour's cells) and Ctrl/Cmd (remove them) are for, and
    those never paint and never change the chosen colour.
  - **Supersedes the same day's "plain click with nothing selected selects that
    colour group"**, which failed manual acceptance as a hidden special case.
  - **Arming needs no selection**: the paint survives exactly the transition
    from no selection to one, so "choose red, then Shift-collect cells" paints
    them red. Escape and a background click drop it, selection or not.
  - **The chosen colour is visible**: an accent ring on its swatch (the loud
    marker, for the state with no other representation); what the selection
    currently is keeps a quiet border. Neither moves a pixel.
  - Tests **1305/1305**, `tsc`, `eslint`, build green. **Live smoke 411/411**
    over twelve stages, 0 console problems.

- **A container is not a control (2026-09-20) — implemented locally,
  live-smoke-tested, deployed only to the disposable smoke vault. Not pushed,
  not in the productive vault.** Normative: `cell-selection-colors.md` §4.4;
  `DECISIONS.md` "A container is not a control because it holds one".
  - **The backdrop list now names only elements whose own click acts.** The
    colour palette and the variant bar were on it as containers, so `closest`
    walled off their whitespace and the user had to hunt for the strip between
    two categories to deselect. Their buttons stay excluded on their own
    account; the grid stays listed, because the grid decides what a press on a
    cell means.
  - **The surface is this view's `view-content`**, so the empty room below the
    last category clears too. Editor, modal and other leaves stay out.
  - Click-vs-drag, the travel threshold and every control's own action are
    unchanged.
  - Tests **1295/1295**, `tsc`, `eslint`, build green. **Live smoke 398/398**
    over twelve stages, 0 console problems. The variant bar's whitespace is
    covered by unit tests only — see HANDOFF §2l.

- **The palette speaks the grammar of the grid (2026-09-20) — implemented
  locally, live-smoke-tested, deployed only to the disposable smoke vault. Not
  pushed, not in the productive vault.** Normative:
  `cell-selection-colors.md` §8, §10.1, §7.2, §4.2, §8.2; `DECISIONS.md` "The
  palette speaks the grammar of the grid".
  - **plain = primary action, Shift = add, Ctrl/Cmd = remove**, on swatches as
    on cells. With nothing selected a plain click selects that colour's cells
    (clear = the uncoloured ones); with a selection it paints it. Ctrl removes
    that group, or does nothing when there is nothing to remove from.
  - **Supersedes `Ctrl + swatch = replace the selection`** and the asymmetry it
    carried. Selecting is an ADD, so the one-active-context rule holds
    unchanged across grids.
  - **Only a plain click with a selection writes**, and only it arms the paint
    colour.
  - **The tooltip states this click's effect in this state** and follows the
    held key live; the swatch wears the same plus/minus cursors as a cell, from
    the same tracker.
  - One pure decision (`src/utils/cellPaletteAction.ts`) feeds click, tooltip
    and cursor.
  - Tests **1286/1286** (new `tests/cellPaletteAction.test.ts`), `tsc`,
    `eslint`, build green. **Live smoke 375/375** over eleven stages, 0 console
    problems.

- **Honest cursors and a category drag handle (2026-09-19) — implemented
  locally, live-smoke-tested, deployed only to the disposable smoke vault. Not
  pushed, not in the productive vault.** Normative:
  `cell-selection-colors.md` §4.5 (the cursor model), §5a (the handle), §4.4,
  §19; `DECISIONS.md` "The cursor tells the truth, and a category moves only by
  its handle".
  - **The cursor says what a press does here:** a drag in flight `grabbing`,
    Ctrl/Cmd a bold minus, Shift `cell`, a movable tool `grab`, otherwise the
    surface's own (`pointer` on a tool that runs and on the `+`, `default` on a
    cell or gutter). Priority is one custom property with per-surface
    fallbacks, not a specificity race; the minus is an embedded SVG data URI
    (no native minus cursor exists); `grabbing` is the single `!important`,
    tied to dnd-kit's active drag.
  - **A list category moves only by a grip handle** at the head of its header,
    before the icon. The header folds and does nothing else; grid, empty cells
    and the free block area start no reorder. Same sortable, same reorder
    logic — only the activator moved (`setActivatorNodeRef`). Edit-only, with
    its space reserved in locked so the header never shifts.
  - **Background clear:** a press that ever travelled past the threshold
    forfeits its click, now that the free area has no drag engine to do it.
  - Tests **1261/1261** (new `tests/cursorModel.test.ts`), `tsc`, `eslint`,
    build green. **Live smoke 306/306** over ten stages, 0 console problems.

- **One selection context, grab-surface clear, modifier cursor (2026-09-19) —
  implemented locally, live-smoke-tested, deployed only to the disposable smoke
  vault. Not pushed, not in the productive vault.** Normative:
  `cell-selection-colors.md` §4.2, §4.4, §4.5, §4a.6, §8.1, §11;
  `DECISIONS.md` "One active selection context; Shift moves it, Ctrl never
  reaches across".
  - **Exactly one active context panel-wide**, keyed on `(categoryId,
    variantId)`. Shift click / drag / swatch in another grid clears the old
    one and starts there; Ctrl/Cmd in another grid is a no-op; a plain tool
    click in another grid runs it and keeps the selection. The armed paint
    colour is not carried across; Escape mid-gesture restores the old grid's
    whole selection.
  - **The free category grab surface clears on a click** and still reorders on
    a drag (root cause: dnd-kit's `role="button"` on the block). Tabs and
    folder tiles stay excluded.
  - **Shift or Ctrl/Cmd held → `cursor: cell`** on all grid surfaces, both
    modes, visual only.
  - Tests **1224/1224**; `tsc`, `eslint`, build green. **Live smoke 248/248**
    over nine stages, 0 console problems.

- **The operative model (2026-09-19) — implemented locally, live-smoke-tested,
  deployed only to the disposable smoke vault. Not pushed, not in the productive
  vault.** Normative: `docs/ocap/cell-selection-colors.md` §3 (rewritten), §4.1,
  §10, §11, §12; `DECISIONS.md` "Locked protects the layout; using and selecting
  work in both modes" (supersedes "Edit mode manages, locked mode executes").
  - **Plain click = USE, modifier = SELECT, in both modes.** A plain click on a
    tool runs it in edit mode too, and no longer replaces the selection; a click
    on an empty cell does nothing. Shift/Ctrl(Cmd) click and drag select in
    locked mode too, and never run the tool. The grid decides in the capture
    phase via the pure, mode-free `gridClickMeaning` / `isClickNotDrag`. The
    closing click of a layout drag is swallowed even when a tool returns to its
    own cell, so moving never runs anything.
  - **Locked = layout locked, nothing else.** `interactionMode.ts` now exports
    one predicate, `allowsLayoutEditing`. Move/swap, category reorder, resize,
    the `+` and the restructuring menus stay edit-only; selection, rectangles,
    the palette, Escape/background clear and file drops work in both.
  - **A mode toggle keeps the selection**, its contour and the armed paint
    colour. The selection gate no longer mentions the mode or `sortableEnabled`
    (the latter took every grid offline during any category drag — the root
    cause of "a category reorder drops the selection"); only a search suspends
    it (`available` on the selection context). The PanelContent guard compares
    the variant the projection actually renders, right in both modes.
  - **A category reorder keeps the selection** — including when the dragged
    category is the one holding it: its grid is swapped for the preview during
    the drag, so the deferred "is it gone?" check stands down while a category
    drag is active (`CellSelectionLayoutDragHold`) and re-asks after the drop.
  - **Escape works after the focused element was unmounted** (a replaced tool, a
    block rebuilt by a toggle): it now counts from anywhere in the panel's leaf
    or from `<body>`. Found by the live run, not by review.
  - **A drop onto an occupied cell is silent** (no confirm, no warning, no
    success notice); a drop onto an empty cell keeps its notice. The grid tells
    the hook via `replacing`.
  - No schema bump, no template bump, no second create path, no outbound drag.
  - Tests: **1208/1208** (43 files; +36, incl. `tests/operativeSelection.test.ts`
    with the pure click decision). `tsc --noEmit`, `eslint .`, `npm run build`
    green.
  - **Live smoke: 198/198** across eight stages in an isolated Obsidian 1.13.7,
    0 console errors. New stage (55): in BOTH modes a plain click runs the tool
    and selects nothing, Shift/Ctrl click select and do not run it, rectangles,
    palette apply / Ctrl- / Shift-swatch, Escape and background clear; a toggle
    in either direction keeps selection, contour and paint colour; dragging the
    category that holds the selection, and the other one, keeps it; in edit a
    plain drag moves and does not run; in locked a plain drag moves nothing and
    there are no resize edges; an empty-cell drop is announced and a replacing
    drop is silent. The seven older stages were adapted where they encoded the
    old click model (selection-starting clicks became Shift-clicks; "edit click
    selects" became "edit click runs"; "locked shows no selection" became
    "locked keeps it").
  - Harness note: a fresh scratch vault now shows Obsidian's "trust the author"
    prompt; the run accepts it inside the disposable instance (the copy's only
    plugin is this build).

- **Two productivity additions (2026-09-19) — implemented locally,
  live-smoke-tested, deployed only to the disposable smoke vault. Not pushed,
  not in the productive vault.** The selection visuals were accepted by the user
  as finished and were NOT redesigned. Specification:
  `docs/ocap/cell-selection-colors.md` §3, §4.2, §4.4; two new entries in
  `DECISIONS.md`.
  - **A selection now ends with Escape OR a click on empty panel background.**
    Escape was already correct and was left alone (verified live, including for
    a selection of empty cells). The background click is new: what counts as
    background is an EXCLUSION list (`src/utils/selectionBackdrop.ts`) — the
    grid, its frame and cells, tools, the palette, the category title, the
    variant bar and every ordinary control keep their meaning. The decision is
    made on the CLICK, never the press, because that same background is the
    list-view category drag handle; an activated drag forfeits its click
    outright. This supersedes "a click outside the grid has no effect" (§4.2).
  - **Locked is the working mode: a file dropped on a cell creates a tool
    there**, and a drop on an OCCUPIED cell replaces it with no confirmation.
    The line is not between the modes but between bringing something IN and
    rearranging what is there — move, swap, reorder, resize, selection, colours
    and the `+` all stay edit-only. It coincides with a technical line that
    keeps it safe: a file drop is a native HTML5 drag from outside, while the
    plugin's own drag is pointer-based and still follows `sortableEnabled`.
    Locked mode was NOT made DnD-capable.
  - Replacing is opt-in at the call site (`createToolInCategory`'s
    `replaceOccupied`) so the `+`, the modal and copy keep dodging to a free
    slot. The displaced definition is collected by the ORDINARY `gcTools` rule:
    a tool still placed in another variant, another category, or marked
    `library`, survives. The renderer now tells the hook which variant the drop
    landed on — in locked mode there is no editing selection, and the old
    fallback ("the first variant") would have filed the tool into a grid nobody
    was looking at.
  - New: `src/utils/selectionBackdrop.ts`,
    `src/components/buttons-panel/CellSelectionBackdrop.tsx`. No schema bump, no
    template bump, no second create path, no new notice.
  - Tests: **1172/1172** (42 files; +43). `tsc --noEmit`, `eslint .`,
    `npm run build` green.
  - **Live smoke: 143/143 checks** across seven stages in an isolated Obsidian
    1.13.7, 0 console errors. New stage (26): Escape clears filled AND empty
    cell selections with their contour; a background click clears; a cell click
    still replaces; a title click still only collapses; a category drag produces
    no click at all for the backdrop listener to act on; a drag starting on the
    background does not clear; in LOCKED mode an empty and an occupied cell both
    light up as drop targets, the drop creates and replaces, no dialog opens,
    the displaced definition is collected (tool count unchanged) and the
    replacement persists; an internal tool drag is still refused; a tool click
    still executes; the drop still works in edit mode.
  - Observed, pre-existing and unchanged: a category REORDER drops the cell
    selection (a grid-context change per §11). It is not caused by the new
    background click — the live probe shows a category drag fires no click.

- **Persistent selection contour (2026-09-19) — implemented locally,
  live-smoke-tested, deployed only to the disposable smoke vault. Not pushed,
  not in the productive vault.** The selection visuals are now three distinct
  layers. Specification: `docs/ocap/cell-selection-colors.md` §9, §9.1, §9.2;
  one new entry in `DECISIONS.md`.
  - **The selection keeps an outline that survives the gesture**, and it traces
    the REAL shape, never a bounding box. The wash alone was too soft to read as
    a form, and the gesture's outline vanished on release — so the most
    interesting selections, the ones built by subtracting a block from a larger
    one, were exactly the ones with no shape to see.
  - One rule does all of it (`src/utils/gridSelectionOutline.ts`, pure): *a cell
    draws a border on each side whose orthogonal neighbour is not selected, and
    every piece reaches half a gutter toward every side that has an in-grid
    neighbour.* Following the cells' own edges makes the topology correct for
    free — **holes get their own inner contour, disconnected islands each get
    their own, a diagonal touch stays two shapes** — with no polygon tracing and
    no SVG. The uniform reach is what turns tiles into one shape: neighbouring
    pieces meet exactly in the middle of the gutter, and a concave corner closes
    exactly for the same reason.
  - **The gesture preview became dashed** and is drawn above the contour, so
    "provisional" and "settled" differ in style rather than position; both sit
    on the same gutter midline so they never nest. Both overlays now share one
    piece of track arithmetic (`.ocap-grid-overlay`).
  - New: `src/utils/gridSelectionOutline.ts`,
    `src/components/buttons-panel/GridSelectionOutline.tsx`. Selection logic,
    gesture semantics, DnD precedence, paint and persistence all untouched; no
    schema bump.
  - Tests: **1129/1129** (40 files; +24, incl. a randomised closed-contour
    invariant over 200 shapes). `tsc --noEmit`, `eslint .`, `npm run build`
    green.
  - **Live smoke: 117/117 checks** across six stages in an isolated Obsidian
    1.13.7 (parity 18, rectangle 19, paint 18, regression 14, visuals 26,
    contour 22), 0 console errors. Verified live: the contour stands after
    mouse-up; a 2×3 block draws its perimeter and no inner edge; removing the
    middle 2×2 from a full grid yields 16 + 8 = 24 edges, i.e. the hole gets its
    own contour; two isolated cells are two contours; adjacent pieces meet
    within 0.75px in the gutter and neither draws the shared edge; a click in an
    outlined gutter still behaves as before; a coloured cell keeps colour, wash
    and contour; Escape clears all of it; locked mode shows none of it.

- **Selection readability + the collapsed-category drag bug (2026-09-18, third
  round) — implemented locally, live-smoke-tested, deployed only to the
  disposable smoke vault. Not pushed, not in the productive vault.** Both came
  out of the user's manual test of the rectangle feature: it worked, but it was
  not readable. Specification: `docs/ocap/cell-selection-colors.md` §9 and §9.1;
  two new entries in `DECISIONS.md`.
  - **Selection is a STATE, the gesture is a SHAPE.** A selected cell is now
    *washed* with a translucent accent tint (inset `box-shadow`, the one free
    channel — it paints above the cell background and below its contents, so a
    coloured cell stays coloured and the tool stays legible). The running
    gesture draws **one continuous outline** around the whole block, gutters
    included, placed from four integers against the grid's own tracks. Before,
    both questions were answered by the same per-cell accent ring: at four or
    five columns the rings tiled, the gaps cut the block apart, and a
    `Ctrl`-removal had nothing to show at all — its cells just stopped being
    ringed. A removal now also marks the cells it is dropping, in the error
    colour and in the same channel, so they change **in place** from "selected"
    to "leaving". The selection LOGIC is untouched.
  - **A drag no longer touches a collapse state.** `ListModeContent` revealed
    *every* collapsed category for the duration of *any* button drag and folded
    them back on release, so dragging a tool at the bottom of the panel unfolded
    a category at the top and moved everything in between mid-gesture. The
    collapsed grid now stays hidden throughout (still MOUNTED, so its droppables
    keep their registration), and the 0.4s drag-hover that expanded a collapsed
    category was removed with it. Consequence, accepted: a collapsed category is
    not a drop target; expanding it first is the visible way in.
  - Tests: **1104/1104** (38 files; +23). `tsc --noEmit`, `eslint .` and
    `npm run build` green.
  - **Live smoke: 95/95 checks** across five stages in an isolated Obsidian
    1.13.7 (parity 18, new visuals 26, rectangle 19, paint 18, regression 14),
    0 console errors. Verified live: the wash is an inset shadow and not an
    outline, it moves no cell, it survives on a coloured cell; exactly one
    preview box exists during a gesture and it spans the whole block including
    gaps; it is out of flow and pointer-transparent, and the 16 cells are not
    displaced; a removal marks the right cells and colours the outline
    differently; Escape clears both; a collapsed category stays collapsed
    before, during and after a drag in another category, chevron included.

- **Locked/Edit visual parity + modifier rectangle selection + ephemeral paint
  colour (2026-09-18, second round) — implemented locally, live-smoke-tested,
  deployed only to the disposable smoke vault. Not pushed, not in the productive
  vault, awaiting Max's manual UX acceptance.** Specification:
  `docs/ocap/cell-selection-colors.md` §4a, §8.2, §19; three new entries in
  `DECISIONS.md`.
  - **Locked and edit now render the same panel.** The manual test reported that
    the design "jumps" on a mode switch, and it did, for four reasons — three of
    them accidents: (a) `.icon-top`/`.icon-left` pin a FIXED button width at
    0-4-2, which the grid's `width: 100%` only beat in edit mode because the drag
    wrapper adds a class, so a locked tool sat 56px wide and left-aligned in a
    much wider cell; (b) the same collision killed the tool's hover ground in
    BOTH modes, leaving only a drop shadow whose size jumped with (a); (c) the
    raster and the outer frame were gated on `--managed`, i.e. on edit mode; and
    (d) — found only by measuring in a running Obsidian — the 16px resize gutter
    exists only in edit mode, so every cell of a 4-column grid grew by 4px on
    locking. Fixed by naming the layout class (0-5-2), giving the slot a real
    hover ground that loses to the coloured-cell rule, drawing the raster in
    every mode, and reserving the gutter as an empty pointer-through spacer in
    locked. `--managed` now gates only genuine editing chrome (empty-cell hover,
    grab cursor).
  - **Shift-drag adds a rectangle of cells, Ctrl/Cmd-drag removes one** — the
    same semantics as the click, applied to an area. Cell-gridded, never pixel
    geometry; direction-free; the pointer always resolves to the nearest track so
    gutters and the grid edge have no dead zones. Below the 4px threshold the
    gesture IS the existing single-cell click. Every step derives from the
    pointer-down BASELINE, so grow/shrink inside one gesture is exact. Escape and
    `pointercancel` restore the baseline and write nothing.
  - **A modifier press reserves the selection**: no tool move, no swap, no
    category reorder, on filled and empty cells alike. Claimed in the capture
    phase inside a grid, and by wrapping dnd-kit's activator on the list-view
    category block, the tabs and the folder tiles. No global switch, nothing that
    a key-up can leave stuck.
  - **Ephemeral selection paint colour:** applying a colour arms it for that
    selection session, so a following additive gesture paints exactly the cells
    it adds ("no colour" included). Modifier swatch clicks never arm it. Nothing
    is written during a drag; pointer-up produces ONE bundled write, and the
    preview is held until the stored styles carry it. Never persisted.
  - **No settings-version bump, no template-format bump, no data change.**
  - Tests: **1081/1081** (38 files; +61 over the previous round in
    `tests/gridRectangleSelection.test.ts`,
    `tests/cellSelectionGesturePrecedence.test.ts` and the extended
    `tests/paletteGridGeometry.test.ts`). `tsc --noEmit`, `eslint .` and
    `npm run build` all green.
  - **Live smoke (2026-09-18): 69/69 checks in a real, isolated Obsidian
    1.13.7**, driven by trusted CDP mouse and key input against a snapshot of the
    smoke vault in a scratch Electron profile (the user's Obsidian and both real
    vaults untouched). Verified live: identical grid/cell/tool geometry and
    raster in both modes, slot-wide hover, locked execution, edit selection;
    rectangles 1xN, Nx1, 2x3, reverse diagonal, grow-and-shrink, Ctrl removal,
    sub-threshold clicks, live preview, Escape restore, the cross-grid rule, and
    a rectangle from all 16 start cells; a Shift drag on a tool never moving it
    while a plain drag still does; category reorder suppressed with a modifier
    and working without one; paint carried through Shift rectangles with exactly
    ONE settings write, Ctrl removal writing nothing, Escape committing nothing,
    "no colour" armed the same way, and no paint state anywhere in the settings;
    `Ctrl`/`Shift` + swatch unchanged and still write-free; colours in locked
    mode and across a plugin reload; the resize-edge drag. Console: no errors, no
    unhandled rejections.

- **Cell Selection + Cell Colors v1 (2026-09-18) — implemented locally and
  live-smoke-tested; NOT yet validated by the user, and NOT in the productive
  vault.** Deployed only to the disposable smoke vault, not pushed.
  Normative specification: `docs/ocap/cell-selection-colors.md`; durable
  decisions in `DECISIONS.md` (six entries dated 2026-09-18); technical detail
  in `HANDOFF.md` §2d.
  - **Edit mode no longer executes tools** (click and Enter/Space); locked mode
    unchanged. This is a deliberate, user-visible behavior change.
  - Selection is the **cell coordinate** in one grid context, ephemeral React
    state in `PanelContent`, never persisted. Gestures: plain = replace,
    Shift = add, Ctrl/Cmd = remove. No toggle, no range, no marquee, no
    sub-mode, no multi-drag. *(Superseded in part the same day: a modifier DRAG
    now spans a cell rectangle — see the entry above. A free pixel marquee and
    the Shift-click range remain non-goals.)*
  - Colors use the **existing `cellStyles`** — no `settingsVersion` bump, no
    template format bump. One commit per color application, whatever the
    selection size.
  - The `+` of an empty cell became an 18px top-right corner target; a modifier
    held over it selects instead of creating.
  - Palette of six colors plus clear below the grid, permanently mounted in edit
    mode; `Ctrl/Shift + swatch` selects by color and never writes.
  - Colors render in locked mode too (they are content).
  - Tests: **1020/1020** (36 files; +113 new in `tests/gridCellSelection.test.ts`,
    `tests/cellColors.test.ts` and the extended `tests/paletteGridGeometry.test.ts`).
    `tsc --noEmit`, `eslint .` and `npm run build` all green.
  - **Live smoke pass (2026-09-18): 84/84 checks in a real, isolated Obsidian
    1.13.7**, driven by trusted CDP input (real mouse presses/moves/releases
    with modifiers, real key events) against a snapshot of the smoke vault in a
    scratch profile. Verified live: locked-mode execution and Enter/Space,
    plain/Shift/Ctrl selection on filled AND empty cells, drag move/swap with
    the selection and colour staying on the coordinate, the corner `+` incl.
    modifier suppression, colouring/clearing, the palette's active indicator,
    `Ctrl`/`Shift` + swatch (and that they never write), variant and grid scope,
    Escape (including that an Obsidian modal still closes while a selection is
    held), the real resize-edge gesture, persistence across a plugin reload,
    the vault-file drop, the template export/import roundtrip of `cellStyles`,
    and the read-only future-settings guard. Console: no errors, no unhandled
    rejections. Two real defects were found live and fixed (below), plus one
    visual defect from screenshot review.
  - An independent adversarial review ran against the finished code and found
    one **high-severity** defect plus four smaller ones, all fixed before the
    commits: the Escape handler swallowed the key globally (breaking drag
    cancel, resize cancel, inline rename and very likely Obsidian's own modals
    while a selection existed); the palette stayed live during a resize preview
    and searched a different grid than the one on screen; the grid gutters
    silently stopped being a category-drag handle; the `+` accepted a click
    after a short drag inside it; and the click threshold used a per-axis test
    where the drag sensor uses a euclidean one, leaving a narrow band where a
    press did nothing at all. Detail in `HANDOFF.md` §2d.
  - Found by the LIVE run, not by the review: (a) a tool drag cleared the cell
    selection every time, because list view changes the category block’s element
    type while a drag is in flight and React therefore rebuilds the whole grid —
    an unmount alone cannot mean “this grid is gone”; (b) growing a grid back after
    a shrink resurrected the cells the shrink had removed from the selection,
    because pruning was derived on read only. Found by screenshot review: (c) the
    Gray swatch rendered pure white in a dark theme.

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
