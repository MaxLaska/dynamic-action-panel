# Variant Grid — DnD robustness & UX polish (2026-09-17)

Polish round after the manual user test of the Phase-5 dynamic-category-variant
build. No new features; scope was: fix the intermittent "drag does not work
after a variant switch" bug, make the 4×4 grid visually explicit in the
management modes, make the drag preview geometrically identical to the final
slot rendering, and clarify the quick A/B switch and the priority wording.

## 1. Manual findings (user test)

1. **Intermittent DnD failure**: sort mode active, drags work; after switching
   the editing variant, buttons sometimes cannot be moved; re-selecting sort
   mode in the menu "fixes" it; not reliably reproducible by hand.
2. **Grid too implicit**: the 4×4 field was hard to see; empty positions and
   drop targets were not obvious.
3. **Drag preview misaligned**: the final button is centered in its cell, but
   the drop preview appeared left-aligned — the preview did not look like the
   result.
4. **Quick ⇄ switch** semantics took experimentation to understand.
5. **Priority wording** (`Move up (higher priority)`) did not state what
   priority *does*.

## 2. Root cause of the intermittent DnD failure

Established empirically against an isolated Obsidian 1.13.7 instance (CDP,
trusted input) with temporary lifecycle instrumentation on both the dnd-kit
events (`onDragPending` / `onDragStart` / `onDragEnd` / `onDragAbort`) and the
collision detection (per-frame dump of every slot droppable and its measured
rect).

**Reproduced failure signature** (sequence: select A → select B → drag `B1`
onto a slot that was OCCUPIED in A and EMPTY in B):

    pending b1 → dragStart b1 → dragEnd b1 over: container:dyn-cat

The drag started normally, but for its entire duration the collision detection
never saw the target slot's droppable — the release resolved to the category
container zone, which carries no position in a positional grid, so the drop
was (correctly, per the grid rules) ignored. The collision dump showed why: in
the first collision frames after drag start, dnd-kit's droppable-rect map
still described the PREVIOUS variant's set of empty-slot droppables, and the
freshly mounted cells had no measured rect yet.

**Mechanism.** Empty-slot droppables were mounted only for cells that are
empty in the variant currently on screen (occupied cells relied on the
button's own sortable droppable). A variant switch therefore unmounted and
mounted `GridSlotCell` components wherever the occupancy differs between the
two variants. `useDroppable` registers via a passive React effect and its rect
is measured lazily by dnd-kit's measuring pipeline — so a drag that starts
immediately after the switch races that registration/measurement. Depending on
timing, the target cell's droppable was either absent from the collision
candidates for the whole drag or present without a rect. Once the measurement
caught up (any later re-render — e.g. re-picking sort mode, which saves the
setting and refreshes the panel), everything worked again. That is exactly the
observed intermittence including the user's workaround.

A second, minor race was observed in automation only: a trusted pointerdown
dispatched in the same instant as the switch can land on the OLD variant's DOM
(the grid re-renders a frame later); the press then hits an empty cell or a
stale node and the category-block drag activates instead of a button drag.
A human drags what they see, so this needs no product change; the list
category block being draggable from any non-button area is unchanged upstream
behavior.

## 3. Fix

**Every grid cell is now a permanent droppable.** `GridSlotCell` renders both
empty and occupied cells (the button is passed as its child), keyed by slot.
The 16 cell nodes of a grid are therefore stable across every variant switch:
their dnd-kit registrations and measured rects stay valid no matter how the
occupancy changes, and there is nothing left to race. No remount hacks, no
timers, no forced re-measure.

Consequences, all verified:

- the collision ranking (`button > slot > title > tab > container`) is
  unchanged: the button is still preferred when the pointer is over it, so
  drop semantics (move / swap / flow→occupied refused) are identical;
- the WHOLE cell is now a drop target, occupied cells included — previously an
  occupied cell was only targetable through the button's own rect. This also
  answers the user's "do I have to hit the slot exactly?" concern;
- the pure drag-over/drop functions already handled slot-droppable ids on
  occupied cells (swap path); new unit tests pin that down.

The temporary collision instrumentation was removed; the cheap, flag-gated
lifecycle tracing (`window.__OCAP_DND_DEBUG = true`) was kept as debug
infrastructure in `ButtonDragContext` — zero cost while off, and it is exactly
the tool needed if a DnD lifecycle question comes up again.

## 4. Visual changes

- **Grid chrome (management modes)**: every cell of the 4×4 field now has a
  visible border and its own ground — occupied cells solid with a subtle
  background, empty cells dashed and hollow. Sort mode shows the field at
  full strength (plus hover on empty cells); edit mode is the same geometry,
  slightly calmer; locked mode carries no chrome at all.
- **Geometry is mode-invariant**: every cell always has a constant 1px border
  (transparent in locked mode), so switching modes never shifts the grid by a
  border width. Live check: 16 cells, uniform heights, identical rects across
  locked/edit/sort.
- **Drag preview alignment**: the in-cell drop preview (the placeholder
  rendering of the dragged tool) now fills its cell exactly like the final
  state — the `width: 100%` chain covers the placeholder wrapper, which the
  old child selectors missed. The floating `DragOverlay` button also fills its
  dnd-kit wrapper (which is sized to the measured source cell), so the tool
  "in hand", the preview, and the final rendering are geometrically identical.
  Measured live: preview and final button byte-equal in size (92.3×56 at the
  test width) and both centered in the cell within 0.1px; no jump on release.
- **4-column invariant**: `repeat(var(--ocap-grid-columns,4), minmax(0,1fr))`
  verified at sidebar widths 500/380/280/200/150 px — always 4 columns ×
  4 rows, no wrapping, no horizontal overflow; slot 16 reachable by drag at
  150 px. Buttons clamp to their cells (`max-width: 100%`, measured: button
  48.3px inside a 49.7px cell).
- **Variant bar at narrow widths**: the editing dropdown no longer collapses
  to an unreadable sliver — it keeps a 6em minimum and the row wraps.

## 5. Wording changes (quick switch, priority)

- The ⇄ quick-switch button already shows its target's name (`⇄ Source`) and
  the tooltip "Switch back to “{name}”" — verified visually; kept.
- Priority menu items now state the semantics instead of naming a mechanism:
  `Move up (wins earlier)` / `Move down (wins later)` (en/zh/ru).
- The `Trigger:` row tooltip now includes: "If several variants match the
  current context, the one higher in the list wins."
- `Editing:` vs `Active now:` unchanged and re-verified (including the
  runtime-preselection rule in a fresh session and the explicit-pick-wins rule
  in a running one).

## 6. Live verification (isolated Obsidian 1.13.7, CDP, trusted input)

Scratch `--user-data-dir` with a snapshot copy of `ocap-smoke` (own plugin
dir, own fixture: dynamic category with variants A/B/Z(fallback), a static
grid, a flow category with a script action). The user's Obsidian, config and
real vaults untouched. `window.onerror`, `unhandledrejection` and a
`console.error` wrapper active for the whole run: **0 errors**.

Every drag below is validated by DOM occupancy after the drop (the dragged
tool actually sits on the target slot), not just by "a drag started". After a
switch the harness waits only until the new grid is *rendered* (what a human
sees before grabbing), then drags immediately.

| Suite | Result |
|---|---|
| Sequenz 1: 20× A/B switch, drag immediately after each | 40/40 |
| Sequenz 2: 35 A/B/Z rotations + drags, sort mode never re-selected | 35/35 |
| Sequenz 3: new tool → drag; UI duplicate (variant bar + modal) → auto-selected copy → drag; priority reorder → drag; delete variant → drag | 6/6 |
| Sequenz 4: 20 quick-⇄ flips (trusted clicks) + drags | 20/20 |
| Sequenz 5: 20 sort/edit/sort transitions with variant changes + drags | 30/30 |
| Stress: 50 variant switches + immediate drags | 50/50 |
| Stress: 30 quick-⇄ flips + drags | 30/30 |
| Final clean-build re-run (after removal of the collision diagnostics): 20 switch+drag, 10 swap+drag | 30/30 |

Regression checks (all PASS): locked-mode runtime resolution folder-a→A,
folder-b→B, plain→fallback Z; locked shows no selector; 16 cells with uniform
geometry in locked; script action executes exactly once on a locked click;
static grid unchanged in every context; tabs view renders the 16-cell variant
grid and both plain and switch+drag work there; editing preselects the
runtime variant in a fresh session; explicit picks survive mode switches;
plugin reload keeps the dynamic category byte-identical.

Before the fix, the same harness reproduced the user's bug deterministically
(first A→B switch, first drag, `over: container` for the whole drag).

## 7. Tests

`npm test`: **340/340** (was 324; +16 in `tests/variantGridDnd.test.ts`):
slot-droppable semantics on occupied cells (move/swap/blocked), collision
ranking with synthetic rects (button beats its own cell, cell beats container,
active id never a hit), A→B→A drag-state round-trip, id-disjoint duplicates
with identical slot patterns, and the full `selectedVariantOf` normalization
surface (explicit pick wins; runtime preselection incl. fallback; deleted
current/previous can never survive; previous ≠ current; non-dynamic → null).

The DOM/dnd-kit lifecycle itself (droppable registration across variant
switches) is not representable in the node-based unit environment — that is
exactly what the live stress suites above automate; this split is deliberate.

`npm run lint` PASS (0 problems) · `npx tsc --noEmit` PASS · production build
PASS.

## 8. Known limits

- The harness cannot fully rule out human-timing effects faster than one
  render frame (< ~16 ms between seeing the new grid and pressing); the
  structural fix removes the raced object entirely, so no such window is
  known to remain.
- In list sort mode the whole category block is still draggable from any
  non-button area (upstream behavior); a press on an empty cell therefore
  starts a category drag, not nothing. Unchanged by design in this round.
- The `--ocap-grid-slot-min-height` empty-cell heights remain tied to the
  display style (56px icon-top / 40px icon-left); buttons shrink with the
  cell below that, which keeps 4 columns at extreme widths at the cost of
  clipped labels.
- Folder view was not separately stress-tested in this round (tabs and list
  were); its grid rendering shares the same components.
