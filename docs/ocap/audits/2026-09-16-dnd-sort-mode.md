# DnD in Sort Mode — activation UX audit and fix (2026-09-16)

Scope: diagnosis (sections 1–7) and the implemented fix with its live verification (sections 8–11). Triggered by the observation that automated tests could only activate drag via a ~400ms long-press, while normal manual mouse use appeared non-functional.

**Status: fixed and verified.** Desktop activation is now `{ distance: 4 }`; see section 8.

## 1. Code inventory

- **Sensors** (`src/contexts/ButtonDragContext.tsx:185-202`): one `DndContext` shared by category and button dragging. `useCoarseTouchOnly = isCoarsePointerDevice()` (`window.matchMedia('(pointer: coarse)')`) decides whether the desktop pointer sensor is registered at all.
  - Desktop/mouse: `ScrollAwarePointerSensor` with `activationConstraint: { delay: 400, tolerance: 6 }` (`DESKTOP_LONG_PRESS_DELAY_MS = 400`, `DESKTOP_LONG_PRESS_TOLERANCE_PX = 6`).
  - Touch: `ScrollAwareTouchSensor` with `activationConstraint: { delay: 500, tolerance: 10 }` (`MOBILE_LONG_PRESS_DELAY_MS`, `SCROLL_CANCEL_DISTANCE_PX`).
  - **There is no `distance`-based activation constraint anywhere.** Both sensors use a pure `delay` constraint — i.e. both mouse and touch use the long-press model; desktop mouse never gets the "start dragging after N px of movement" behavior dnd-kit normally offers for pointer devices.
- **Activation constraint handling** (`src/sensors/scrollAwarePointerHandleMove.ts`, installed via `src/sensors/patchScrollAwareHandleMove.ts`): this file **fully replaces** dnd-kit's own `pointermove`/`touchmove` listener (`removeEventListener` + `addEventListener` on the sensor's internal listener list), so it is the only code that runs on move while a press is pending.
  - For a `delay` constraint (both sensors), the replacement handler calls `shouldCancelActivationForScroll(delta)` and nothing else. It does **not** read `activationConstraint.tolerance` — that branch of `isDistanceConstraint` is dead for both sensors, since neither uses `distance`. The desktop `tolerance: 6` value is set but never consulted.
  - `shouldCancelActivationForScroll` (`src/utils/touchScrollActivation.ts`) cancels only when movement is "scroll-shaped": dominant-axis movement past a hardcoded `SCROLL_CANCEL_DISTANCE_PX = 10`. Movement below 10px, or movement that isn't clearly axis-dominant, does **not** cancel — it just falls through to `handlePending`, which does not start the drag either.
  - Actual activation on the delay path comes from dnd-kit's own base sensor (`core.esm.js:1460`): `this.timeoutId = setTimeout(this.handleStart, activationConstraint.delay)`. This timer fires unconditionally after 400/500ms unless cancelled first — it does **not** require any movement to occur. This is why a plain "mousedown, hold still, then move" activates: the timer alone starts the drag.
- **Drag handles**: none. `SortableButtonItem.tsx:63-69` spreads `{...attributes} {...listeners}` on the whole item `<div>` — the entire button surface is the drag source. Category blocks (`SortableCategoryBlock.tsx`, `SortableCategoryTab.tsx`, `SortableCategoryFolder.tsx`) follow the same pattern (not separately re-verified line-by-line, but confirmed behaviorally: dragging the category title works).
- **Category reordering**: `ButtonDragContext.tsx` `handleDragOver`/`handleDragEnd` (category branch) + `src/utils/categoryDragItems.ts` (`applyCategoryDragOver`) + `persistCategoryOrder` (writes `plugin.settings.categories`, reassigns `.order`, calls `saveSettings()`).
- **Button reordering within a category**: same handlers (button branch) + `src/utils/buttonDragItems.ts` (`applyDragOverToItems`, same-container path) + `persistItems`.
- **Button move between categories**: `buttonDragItems.ts:113-181` (`applyDragOverToItems`) has an explicit `activeContainer !== overContainer` branch that rebuilds both source and target container arrays; `persistItems` then writes `category.buttons` for every affected category from `finalItems`. This is a real, general cross-container path, not a same-category special case.
- **Persistence**: both `persistItems` and `persistCategoryOrder` call `pluginInstance.saveSettings()` (writes `data.json`) and dispatch `buttons-panel-refresh`.
- **Visual feedback**: `DragOverlay` (`ButtonDragContext.tsx:734-758`) renders a floating preview (`CategoryDragOverlay` / `SimpleButton` clone) following the cursor (`snapCenterToCursor` modifier); the source item gets `sortable-button-item--dragging` class while active. No overlay/placeholder appears at all unless activation actually succeeds — so during a failed/cancelled desktop attempt there is zero visual feedback.

## 2. What Sort mode is supposed to do, per code

All three are implemented as first-class, general cases in the same DnD engine (not partial/stubbed):
- Reorder categories — yes.
- Reorder buttons within a category — yes.
- Move a button from one category to another — yes (general cross-container branch, not a special case).

## 3. Reproduction (isolated vault `C:\Users\flash\ObsidianTestVaults\ocap-smoke`, Obsidian 1.13.7, production build in `dist/`, production vault untouched)

Method: isolated Obsidian instance launched with a scratch `--user-data-dir` and `--remote-debugging-port`, driven via raw CDP (`Input.dispatchMouseEvent`) from a throwaway Node script — not the interactive browser tool, since Obsidian is an Electron app, not a Chrome tab. Only this scratch instance's process tree was touched; the pre-existing production Obsidian process (`user-data-dir=...\Roaming\obsidian`) was left running and untouched throughout. `interactionMode` in the fixture was already `"sort"`.

- **Normal/fast mouse** (`mousedown` → immediate `mousemove` × 3 → `mouseup`, all within well under 400ms, dragging a button ~60px sideways): `sortable-button-item--dragging` class never appeared, DOM order unchanged, `data.json` unchanged, no error, **no accidental click/action execution either** (verified via a script-run counter exposed by the fixture's test script: 0 executions). Net effect for the user: nothing happens at all — no feedback, no error, no side effect.
- **Long-press** (`mousedown` → 550ms idle with pointer still → then `mousemove` → `mouseup`): `dragging` class appeared **before any movement**, i.e. purely from the elapsed timer, confirming the dnd-kit base-sensor timeout is what activates it, not a movement threshold. Drag then followed the cursor and completed normally.
- Verified end-to-end with all three operations, each via long-press, each confirmed both in DOM and in the persisted `data.json` after restoring/rereading it:
  - Button reorder within a category: `Run Script`/`Alpha RENAMED` swapped, persisted.
  - Category reorder: `Alpha`/`Beta` swapped, persisted.
  - Cross-category move: `Beta Button` moved from `Beta` into `Alpha`, landed at the expected drop position, persisted.
- Test vault fixture (`data.json`) was restored to its original category/button order after the run; no other files touched.

## 4. Assessment

**Both a real design gap and a UX problem, not a functional bug in the reordering logic itself.**

- The reordering logic (collision detection, container resolution, persistence) is correct and works reliably once a drag actually starts — all three operations reproduce cleanly via long-press with no data corruption.
- The activation model is the defect: desktop mouse is wired to the exact same "long-press, no distance-based fast path" activation constraint as touch. Real dnd-kit pointer sensors normally support a `distance`-based constraint (start dragging after e.g. 4-8px of movement) which is the conventional desktop drag-and-drop feel (mousedown + immediate movement = drag). That path is not used here at all for either sensor; only `delay` is used. A normal, fast manual drag gesture on desktop (the overwhelmingly common way users try to reorder something) gets no visual response and produces no result — it reads as "not implemented" or "broken" even though the mechanism underneath is sound.
- Secondary, minor finding: the desktop `tolerance: 6` value configured alongside `delay: 400` is dead code in the current `scrollAwarePointerHandleMove` implementation — only `isDistanceConstraint` branches read `.tolerance`, and desktop uses a delay constraint, so that branch never runs for mouse. Whatever author intent existed for a 6px cancel-tolerance on desktop is currently not enforced (the only in-flight cancellation for a pending desktop drag is the shared `shouldCancelActivationForScroll` scroll-gesture heuristic tuned for touch scrolling, threshold 10px, axis-dominant only).

## 5. Root cause

Desktop mouse activation uses `activationConstraint: { delay, tolerance }` (a pure long-press/delay constraint copied from the touch/mobile pattern) instead of a `distance`-based constraint. dnd-kit's own delay timer (`setTimeout(handleStart, delay)`, `core.esm.js:1460`) starts the drag purely on elapsed time regardless of movement, so long-press works; fast immediate movement neither meets a distance threshold (there isn't one) nor reliably meets the scroll-cancel heuristic, so it typically just sits pending until `mouseup` cancels it — the drag never starts and there is no feedback of any kind.

## 6. Recommended change (NOT implemented — documentation only, per task instructions)

Give the desktop `ScrollAwarePointerSensor` a `distance`-based `activationConstraint` (e.g. `{ distance: 4 }`, mirroring dnd-kit's own default recommendation for `PointerSensor`) instead of `{ delay: 400, tolerance: 6 }`, while leaving the touch sensor's `delay`-based long-press untouched (long-press is the correct, conventional activation model for touch, where it must be distinguished from scrolling/tapping).

This is compatible with the existing `scrollAwarePointerHandleMove` code without further changes: it already has a working `isDistanceConstraint` branch (`hasExceededDistance(delta, activationConstraint.distance)` → `sensor.handleStart()`, plus an optional `.tolerance` cancel check) that is simply unreached today because desktop never passes a `distance` constraint. Switching the desktop constraint shape would exercise already-written, currently-dead code rather than requiring new logic.

Two secondary points to settle at implementation time (not decided here):
- Whether desktop should keep *any* fallback long-press affordance (e.g. for users who prefer press-and-hold), or move to distance-only.
- The dead `tolerance: 6` either needs to become a real `distance`-constraint tolerance (cancel a fast-but-jittery mousedown that isn't really a drag) or be removed — currently it's inert either way.

## 7. Estimated change scope

Small and low-risk if scoped to the recommendation above:
- 1 constant change + 1 object literal change in `src/contexts/ButtonDragContext.tsx` (replace `{ delay: DESKTOP_LONG_PRESS_DELAY_MS, tolerance: DESKTOP_LONG_PRESS_TOLERANCE_PX }` with a `distance`-based constraint for the desktop sensor only).
- No changes needed to `scrollAwarePointerHandleMove.ts`, `applyDragOverToItems`, `applyCategoryDragOver`, persistence, or overlay code — all already generic over activation constraint shape.
- Should be manually re-verified with both a normal fast mouse drag and a plain click (to confirm click-to-open/click-to-run actions still fire correctly and aren't swallowed by an over-eager 4px threshold) before merging; existing unit tests do not cover sensor/activation behavior (no jsdom environment), so this needs a live check, not just `npm test`.
- Touch sensor and its long-press/scroll-distinction logic stay untouched — no risk to mobile behavior from this change.

---

# Fix (implemented 2026-09-16)

## 8. Change made

`src/contexts/ButtonDragContext.tsx`: the desktop `ScrollAwarePointerSensor` now activates on distance instead of elapsed time.

```ts
const DESKTOP_DRAG_ACTIVATION_DISTANCE_PX = 4;
// ...
useSensor(ScrollAwarePointerSensor, {
    activationConstraint: { distance: DESKTOP_DRAG_ACTIVATION_DISTANCE_PX },
})
```

`DESKTOP_LONG_PRESS_DELAY_MS` and `DESKTOP_LONG_PRESS_TOLERANCE_PX` were removed (the latter was the dead value identified in section 4).

**Final desktop activation constraint: `{ distance: 4 }`, deliberately with no `tolerance`.** This is not cosmetic: for a *distance* constraint both dnd-kit (`core.esm.js:1540-1546`) and our `scrollAwarePointerHandleMove` check `tolerance` **first and cancel** when it is exceeded. A fast desktop drag delivers its first `pointermove` well past any small tolerance, so configuring `{ distance: 4, tolerance: 6 }` would abort exactly the gesture this fix enables. A regression test pins this (`tests/scrollAwarePointerHandleMove.test.ts`).

4px was kept as the value from the task brief: it is dnd-kit's own recommendation for `PointerSensor` and matches the Windows system drag threshold (`SM_CXDRAG`, 4px). The live sweep in section 9 confirmed it needs no adjustment.

**Touch behavior is unchanged.** `ScrollAwareTouchSensor` keeps `{ delay: MOBILE_LONG_PRESS_DELAY_MS (500), tolerance: SCROLL_CANCEL_DISTANCE_PX (10) }` and the `shouldCancelActivationForScroll` heuristic — long-press remains the correct model for touch, where a drag must be distinguished from scrolling and tapping.

No changes were needed to `scrollAwarePointerHandleMove.ts`, `applyDragOverToItems`, `applyCategoryDragOver`, persistence or overlay code. The fix activates the already-written distance branch that section 6 identified as dead.

### Scope note: the threshold only exists in sort mode

`PanelContent.tsx:89` gates the provider with `dragReorderEnabled = normalizedQuery.length === 0 && interactionMode === 'sort'`, and `ButtonDragProvider` returns early without rendering a `DndContext` at all when disabled (`ButtonDragContext.tsx:714`). In locked (consumption) mode no pointer sensor exists, so the 4px threshold can never turn a normal button click into a drag during regular use.

### Unit test added

`tests/scrollAwarePointerHandleMove.test.ts` (7 tests) covers the patched move handler directly in the Node environment: below/above threshold, single large jump (fast drag) activating rather than cancelling, the tolerance trap documented above, coordinate forwarding once activated, and the unchanged delay-constraint branch (scroll-shaped gesture cancels; movement alone never starts a drag).

## 9. Live verification (isolated vault `C:\Users\flash\ObsidianTestVaults\ocap-smoke`, Obsidian 1.13.7)

Method as in section 3: a separate Obsidian instance launched with a scratch `--user-data-dir` (registering only the smoke vault) plus `--remote-debugging-port`, driven via raw CDP `Input.dispatchMouseEvent`. The user's own Obsidian (production `user-data-dir`, which happened to have the smoke vault open) was left running and untouched; only the scratch instance's process tree was started and stopped. `window.onerror`, `unhandledrejection` and a `console.error` wrapper were active for the whole run.

All drags used the normal desktop gesture — `mousePressed`, then `mouseMoved` immediately, no dwell anywhere.

| # | Check | Result |
|---|---|---|
| 1 | Activation latency, plain mouse press + immediate move | **PASS** — 46ms, i.e. one CDP round trip; the 400ms timer is gone |
| 2 | Category reorder (Alpha dragged below Beta) | **PASS** — DOM + `data.json` |
| 3 | Second category reorder (Ctx dragged to top) | **PASS** — DOM + `data.json` |
| 4 | Button reorder within a category (Alpha) | **PASS** — DOM + `data.json` |
| 5 | Cross-category move (Beta Button → Alpha, position 0) | **PASS** — source category left empty, both categories rewritten in `data.json` |
| 6 | Persisted order re-read from `data.json` after every operation | **PASS** — `order` fields contiguous and consistent with the DOM |
| 7 | Plugin disable/enable reload, order re-checked | **PASS** — order survived; a fast drag still activated afterwards |
| 8 | Plain click (zero movement) on the script button | **PASS** — action executed exactly once (`__scriptEntryRan` +1, top-level counter unchanged at 1) |
| 9 | Click with small jitter | **PASS** — see threshold sweep below |
| 10 | Category collapse / expand by title click | **PASS** — collapsed then re-expanded, `aria-expanded` follows |
| 11 | Locked mode unaffected | **PASS** — 0 sortable wrappers rendered; a fast drag gesture produces no drag state and no reorder |
| 12 | Edit mode context menu | **PASS** — right-click opens Edit/Copy/Delete, Escape closes |
| 13 | Touch sensor config | **PASS** — unchanged in code, still `{ delay: 500, tolerance: 10 }` |
| 14 | `console.error` | **PASS** — none |
| 15 | `window.onerror` | **PASS** — none |
| 16 | `unhandledrejection` | **PASS** — none |
| 17 | React errors | **PASS** — none (React surfaces these through `console.error`, which was wrapped) |

### Click-vs-drag threshold sweep

Press, wiggle by (dx,dy), return to origin, release:

| movement | euclidean | drag starts | click fires |
|---|---|---|---|
| 0,0 · 1,0 · 2,0 · 3,0 | ≤3px | no | yes |
| 4,0 | 4.00px | no | yes |
| 2,2 | 2.83px | no | yes |
| 3,3 | 4.24px | yes | no |
| 5,0 | 5.00px | yes | no |
| 8,0 | 8.00px | yes | no |

The boundary is exactly "strictly greater than 4px". When a drag does start from jitter and is released on the origin, the click is correctly suppressed and nothing is reordered — the worst case is a no-op, never an accidental action execution.

The test vault fixture (`data.json`) was restored from a pre-run backup and verified byte-identical afterwards; no other vault files were touched.

## 10. Drag/drop feedback assessment (no UI rework performed)

Checked during live drags, per the task's instruction to evaluate but not rebuild the DnD UI. The feedback the audit's section 1 described is all present and — now that activation actually succeeds — visible:

- **Floating preview**: `DragOverlay` renders a `position: fixed`, `z-index: 999` clone centred on the cursor (`snapCenterToCursor`). Confirmed for both button drags (56×56 button clone) and category drags (full 487×62 category preview).
- **Source dimming**: the drag source drops to `opacity: 0.45` (`.button-drag-grid-placeholder` for buttons, `.sortable-category-item--dragging` for categories).
- **Landing position**: the sortable list reflows live — the source element carries a real transform (e.g. `matrix(1,0,0,1,0,-133)` while a category was dragged past its neighbour), so the gap showing where the item will land moves with the cursor.
- **Accessibility**: dnd-kit's live region announces the drag ("Draggable item … was moved over …").

**Conclusion: adequate, no change made.** The original complaint ("kaum erkennbar, dass Drag-and-Drop möglich ist") is fully explained by the activation defect — with the long-press constraint a normal gesture produced *no* overlay, *no* dimming and *no* reflow, because the drag never started. No separate defect was found suppressing existing feedback.

Remaining UX limits, recorded but **not** addressed here (they would need a real redesign, not a small fix):

- There is no **resting affordance** — nothing in sort mode signals "this is draggable" before you start dragging (no grip handle, no `cursor: grab`). Discoverability still rests entirely on the mode name.
- There is no explicit **drop indicator** (insertion line / highlighted gap). The landing spot is inferred from the reflow, which is subtle for cross-category moves where the target category has few buttons.

## 11. Summary

- Category reorder with a normal mouse: **PASS**
- Button reorder within a category: **PASS**
- Button move between categories: **PASS**
- Persistence (`data.json`, incl. across a plugin reload): **PASS**
- Click, collapse/expand, edit-mode context menu: **PASS**
- Locked mode: unaffected (no DnD context at all)
- Touch: unchanged long-press model
- Root cause (confirmed and fixed): the desktop pointer sensor used a pure `delay`-based long-press constraint copied from the touch pattern; dnd-kit's own `setTimeout(handleStart, delay)` meant only dwelling activated a drag, and no `distance` fast path existed.
- Fix: `{ distance: 4 }` on the desktop sensor only, no `tolerance`; the previously dead distance branch in `scrollAwarePointerHandleMove` now carries desktop activation.
- Follow-up candidate (UX, not a defect): resting drag affordance and an explicit drop indicator in sort mode.
