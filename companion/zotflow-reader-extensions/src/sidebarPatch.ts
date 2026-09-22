// sidebarPatch.ts
// The DOM effects, kept dull on purpose.
//
// Every decision worth arguing about lives in sidebarSide.ts (the stylesheet,
// the resize maths) or readerContract.ts (the selectors, the structure check).
// What is left here is the mechanical part: put the stylesheet in, put the
// toggle where the side says it goes, and leave a mark saying what was done so
// doing it twice costs nothing.
//
// Everything is written to be applied repeatedly. The reader re-renders its own
// toolbar, tabs open and close, and the preference can change while several
// readers are open — so "apply" has to be the only verb, and it has to be safe
// to call at any moment.

import {
    OWN,
    SELECTORS,
    probeReader,
    readerInstance,
    type ReaderParts,
} from './readerContract';
import { rightSidebarWidth, sidebarStylesheet, type SidebarSide } from './sidebarSide';

/**
 * An event target as something that can be asked about its ancestors.
 *
 * Deliberately duck-typed, and NOT `target instanceof Element`. Every node in
 * these events comes from the reader's iframe, which is a separate realm with
 * its own `Element` constructor — so an `instanceof` against this plugin's
 * `Element` is false for every element the reader will ever hand us, and every
 * handler guarded that way silently does nothing. That is not a hypothetical:
 * it cost the right-hand resize and the context menu a full smoke run.
 */
export function closestFrom(target: EventTarget | null, selector: string): Element | null {
    const candidate = target as { closest?: (s: string) => Element | null } | null;
    if (!candidate || typeof candidate.closest !== 'function') return null;
    return candidate.closest(selector);
}

/** The side currently applied to a reader document, if this plugin applied one. */
export function appliedSide(body: HTMLElement): SidebarSide | null {
    const value = body.getAttribute(OWN.appliedAttr);
    return value === 'left' || value === 'right' ? value : null;
}

/**
 * Puts this plugin's stylesheet in the reader document, once.
 *
 * Reused rather than replaced when it is already there: a fresh `<style>` on
 * every apply would leave a stack of identical sheets behind in a document that
 * survives dozens of toggles.
 */
function ensureStylesheet(parts: ReaderParts): void {
    const existing = parts.doc.getElementById(OWN.styleId);
    // Plain `createElement`, not Obsidian's `createEl`: this is the reader's
    // own iframe document, a separate realm whose prototypes Obsidian has
    // never patched, so the helper does not exist there. See the companion
    // override in eslint.config.mjs.
    const style = existing ?? parts.doc.createElement('style');
    if (!existing) {
        style.id = OWN.styleId;
        parts.doc.head.appendChild(style);
    }
    const css = sidebarStylesheet();
    // Comparing first keeps a re-apply from invalidating style resolution for
    // no reason; this runs on every layout change.
    if (style.textContent !== css) style.textContent = css;
}

/**
 * Moves the toggle to the side the sidebar is on, and nowhere else.
 *
 * The button and the sidebar are one control: a toggle on the left that opens a
 * panel on the right is the state this whole plugin exists to avoid. So the
 * move is not an extra feature of "right", it is the same operation.
 *
 * The divider that followed the toggle in the left group is hidden rather than
 * removed, so that going back to left is a class change and not a guess about
 * where a removed node belonged.
 */
function placeToggle(parts: ReaderParts, side: SidebarSide): void {
    const { toggle, toolbarStart, toolbarEnd } = parts;
    if (side === 'right') {
        const next = toggle.nextElementSibling;
        if (next && next.matches(SELECTORS.divider)) {
            next.classList.add(OWN.orphanDivider);
        }
        // Outermost element of the right group, past Appearance and Find.
        if (toolbarEnd.lastElementChild !== toggle) toolbarEnd.appendChild(toggle);
        return;
    }
    if (toolbarStart.firstElementChild !== toggle) {
        toolbarStart.insertBefore(toggle, toolbarStart.firstElementChild);
    }
    for (const orphan of Array.from(
        toolbarStart.querySelectorAll(`.${OWN.orphanDivider}`)
    )) {
        orphan.classList.remove(OWN.orphanDivider);
    }
}

/**
 * Puts Find before Appearance in the right-hand group.
 *
 * The reader ships them the other way round (Appearance, then Find), which puts
 * the button reached most often — search — furthest from the edge. Swapping the
 * two existing buttons is the whole change: nothing is replaced, nothing is
 * rebuilt, and the sidebar toggle still lands outside both of them because it
 * is appended after this runs.
 *
 * Unlike the sidebar side, this applies on BOTH sides. It is a reading-order
 * preference, not a consequence of where the sidebar sits.
 *
 * Both buttons are optional. A reader that shows only one of them, or neither,
 * is left alone rather than refused: the sidebar feature does not depend on it.
 */
function orderEndGroup(parts: ReaderParts, order: 'find-first' | 'reader-default'): void {
    const find = parts.doc.querySelector(SELECTORS.toolbarFind);
    const appearance = parts.doc.querySelector(SELECTORS.toolbarAppearance);
    if (!find || !appearance || find.parentElement !== appearance.parentElement) return;
    const [first, second] = order === 'find-first' ? [find, appearance] : [appearance, find];
    // Only act when they are actually the wrong way round, so the observer this
    // runs under does not see a mutation it caused itself.
    if (first.nextElementSibling === second) return;
    first.parentElement?.insertBefore(first, second);
}

/**
 * Brings one reader document to the requested side.
 *
 * Returns whether the document is now in the requested state — false means the
 * structure was not what this plugin expects and NOTHING was touched. There is
 * no third outcome on purpose: a partial patch of somebody else's reader is the
 * failure mode worth engineering against.
 */
export function applySide(doc: Document | null | undefined, side: SidebarSide): boolean {
    const parts = probeReader(doc);
    if (!parts) return false;
    ensureStylesheet(parts);
    orderEndGroup(parts, 'find-first');
    placeToggle(parts, side);
    parts.body.classList.toggle(OWN.rightClass, side === 'right');
    parts.body.setAttribute(OWN.appliedAttr, side);
    return true;
}

/**
 * Undoes everything this plugin put into a reader document.
 *
 * Used when the plugin unloads. A reader left with our class and our stylesheet
 * after the plugin is gone would be a sidebar stuck on the right with nothing
 * able to move it back.
 */
export function removePatch(doc: Document | null | undefined): void {
    const parts = probeReader(doc);
    if (!parts) return;
    placeToggle(parts, 'left');
    orderEndGroup(parts, 'reader-default');
    parts.body.classList.remove(OWN.rightClass);
    parts.body.removeAttribute(OWN.appliedAttr);
    parts.doc.getElementById(OWN.styleId)?.remove();
}

/** What one bound reader document needs torn down again. */
export interface ReaderBinding {
    disconnect(): void;
}

/**
 * Attaches the behaviour that CSS cannot express, once per reader document.
 *
 * Three things live here, and each is here for a measured reason:
 *
 * - **The right-hand resize.** The reader derives the sidebar width from the
 *   pointer's distance to the LEFT viewport edge, so on the right it is
 *   inverted. The drag is intercepted in the capture phase and recomputed. Two
 *   details are load-bearing: `setPointerCapture`, without which the drag dies
 *   the moment the pointer crosses the document iframe; and routing the new
 *   width through the reader's own `setSidebarWidth`, because the CSS variable
 *   belongs to the reader's React state and is overwritten on the next render.
 *   The reader stays the owner of the width — this plugin keeps no copy.
 *
 * - **The context menu.** A right-click on the toggle is claimed here and
 *   handed to the caller, which opens an Obsidian menu. Left-click is never
 *   touched, so the ordinary toggle keeps working exactly as before.
 *
 * - **A toolbar observer.** The toolbar is React-rendered and may be rebuilt
 *   under us, which would silently put the toggle back on the left while the
 *   sidebar stayed right. The observer re-asserts the placement instead of
 *   polling for it.
 */
export function bindReader(
    doc: Document,
    options: {
        currentSide(): SidebarSide;
        onToggleContextMenu(event: MouseEvent): void;
        onStructureLost(): void;
    }
): ReaderBinding {
    const win = doc.defaultView;
    if (!win) return { disconnect: () => undefined };

    let dragging = false;

    const onPointerDown = (event: Event): void => {
        if (options.currentSide() !== 'right') return;
        const handle = closestFrom(event.target, SELECTORS.sidebarResizer);
        if (!handle) return;
        const pointer = event as PointerEvent;
        // Claimed before the reader's own handler can start its left-edge drag.
        event.stopPropagation();
        event.preventDefault();
        dragging = true;
        try {
            handle.setPointerCapture(pointer.pointerId);
        } catch {
            // Capture is an optimisation for crossing the document iframe, not
            // a precondition; a browser that refuses it still drags, just not
            // past the iframe edge.
        }
    };

    const onPointerMove = (event: Event): void => {
        if (!dragging) return;
        const reader = readerInstance(win);
        if (!reader) return;
        reader.setSidebarWidth(
            rightSidebarWidth(win.innerWidth, (event as PointerEvent).clientX)
        );
    };

    const onPointerUp = (event: Event): void => {
        if (!dragging) return;
        dragging = false;
        const handle = doc.querySelector(SELECTORS.sidebarResizer);
        try {
            handle?.releasePointerCapture((event as PointerEvent).pointerId);
        } catch {
            // Releasing a capture that was never taken is not an error here.
        }
    };

    const onContextMenu = (event: Event): void => {
        if (!closestFrom(event.target, SELECTORS.sidebarToggleAny)) return;
        event.preventDefault();
        event.stopPropagation();
        options.onToggleContextMenu(event as MouseEvent);
    };

    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('pointermove', onPointerMove, true);
    doc.addEventListener('pointerup', onPointerUp, true);
    doc.addEventListener('contextmenu', onContextMenu, true);

    const toolbar = doc.querySelector(SELECTORS.toolbar);
    const observer = new win.MutationObserver(() => {
        const side = options.currentSide();
        // Re-assert rather than re-apply: this fires for our own moves too, and
        // applySide would be a loop. `placeToggle` is a no-op when the toggle
        // already sits where it belongs, which is the common case.
        if (!applySide(doc, side)) options.onStructureLost();
    });
    if (toolbar) observer.observe(toolbar, { childList: true, subtree: true });

    return {
        disconnect(): void {
            observer.disconnect();
            doc.removeEventListener('pointerdown', onPointerDown, true);
            doc.removeEventListener('pointermove', onPointerMove, true);
            doc.removeEventListener('pointerup', onPointerUp, true);
            doc.removeEventListener('contextmenu', onContextMenu, true);
        },
    };
}
