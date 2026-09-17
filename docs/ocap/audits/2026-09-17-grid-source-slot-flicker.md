# 2026-09-17 – Source-slot flicker during a grid drag

Scoped bugfix. No new architecture, no DnD rework.

## 1. Symptom

While a grid drag was held, the dragged tool blinked back into its source slot
for a fraction of a second whenever the pointer moved from one destination
cell to the next, and occasionally once more at the drop.

## 2. Root causes (both live-reproduced, not inferred)

**A – a target without an addressable cell fell back to the baseline.**
Grid cells are separated by a 4 px gutter, so the pointer crosses the grid
container between *any* two cells. There the only droppable containing the
pointer is `container:<categoryId>`, which names no cell.
`applyDragOverToItems` signals "nothing to do" by returning its input — and
the input is the drag-start baseline, in which the tool still sits on its
source slot. `flushButtonDragOver` compared that return value against the
*current preview*, found them different and committed the baseline.

Measured before the fix (per-frame sampler, one held drag across 15 cells):
2–3 refills of the source slot with the dragged tool itself, 33–50 ms each,
every one of them with the pointer inside the grid but outside every cell.

The same fallback made a release inside a gutter revert the whole drag
(`resolveGridDropOutcome` → `no-cell`, then recompute from the baseline),
contradicting the comment that already claimed such a release is "left alone".
Live: 1 of 8 gutter releases kept its result before, 8 of 8 after.

**B – the drop result was overwritten by still-stale props.**
`handleDragEnd` clears `activeButtonId` before the saved settings reach the
provider, which re-enables the items-rebuild effect one or more renders too
early. The rebuild read the pre-drop props and put the tool back on its old
slot for one frame (~15 ms, measured at every drop).

**C – (found while testing cancel, pre-existing, unrelated to A/B)**
`dragForceCancelledRef` was only cleared inside `handleDragEnd`. A keyboard
cancel (Escape) delivers `onDragCancel` without a drag end, so the flag
survived and the *next* drag's drop was silently discarded.

## 3. Fix

- `handleDragOver` classifies the target once with `resolveGridDropOutcome`.
  A `no-cell` target is still scheduled (the category-hover notification must
  keep working) but marked non-addressable: the preview holds, the target ring
  holds, `lastAppliedDragOverRef` keeps pointing at the last real cell.
- `handleDragEnd` recomputes only for an `accept` release; `blocked` still
  reverts with the notice, `no-cell` commits the visible preview.
- `committedPropsRef` keeps the drop result authoritative while the props are
  still the exact objects it was computed from. Any later settings object
  releases the guard, so a failed save cannot freeze the state.
- `dragForceCancelledRef` is cleared at every drag start.

No timers, no debounce, no animation, no remount.

## 4. Verification

Unit: `tests/gridDragSourceStability.test.ts` (12 tests) pins the
classification and the trap behind it — a `no-cell` recompute returns the
baseline object itself, while every cell (empty, occupied, or the button on
it) stays `accept`. `npm test` 352/352, lint clean, `tsc --noEmit` clean,
production build clean.

Live (isolated Obsidian 1.13.7, CDP, per-frame DOM sampler, scratch
`--user-data-dir` + snapshot vault; the user's Obsidian and both real vaults
untouched):

| Suite | before | after |
|---|---|---|
| 20 normal drags across 8 destinations each | 88/120 | 120/120 |
| 6 swap drags | 25/36 | 36/36 |
| 4 releases inside the gutter | 1/8 | 8/8 |
| 3 drag cancels | 3/6 | 6/6 |
| 3 drags directly after a cancel | – | 18/18 |
| 20 variant switch → immediate drag | 82/120 | 120/120 |
| 10 quick-⇄ → drag | 41/60 | 60/60 |
| narrow sidebar (220 px, 150 px) | 13/16 | 16/16 |
| preview alignment | 3/3 | 3/3 |
| plugin reload persistence | 1/1 | 1/1 |
| **total** | **260/372** | **390/390** |

Plus 8/8 targeted regression checks: off-screen variants byte-identical after
5 drags, edited variant changed, other categories untouched, slot 16
reachable, flow category reorders and persists, static grid renders 16 cells
and its drag persists. `console.error`, `window.onerror` and
`unhandledrejection` monitored throughout: **0**.

## 5. Known limits

- Another tool appearing in the source slot is the intended swap preview, and
  hovering the source slot again correctly previews "nothing changes" — both
  were separated from the bug metric explicitly.
- Flow categories still carry the same trap in their own shape: releasing on
  the container background of the *same* flow category recomputes against the
  baseline and drops the reorder. Live-reproduced, left untouched here
  (see HANDOFF open points).
