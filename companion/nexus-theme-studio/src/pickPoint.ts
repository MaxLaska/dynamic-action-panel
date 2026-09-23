// pickPoint.ts
// "Click somewhere in Obsidian": one transparent layer, one neutral hint.
//
// Shared by the colour sampler and by Inspect UI's fallback, because both are
// the same gesture — the pointer becomes a crosshair, the next click names a
// point, Escape or a right-click means "never mind".
//
// The layer is a SHIELD, not a drawing. It is fully transparent, so it adds no
// pixel to what is captured beneath it, and it takes the pointer, so nothing
// underneath is hovered while the user aims — a sampled surface is its resting
// colour, not its hover colour. The crosshair is the operating system's own
// cursor, which is never part of the page and cannot tint anything. The only
// visible element is a small neutral hint, removed before anything is read.

/** Where the click landed, in page (CSS) pixels. */
export interface PickedPoint {
    x: number;
    y: number;
}

/** A pick in progress. */
export interface PickSession {
    /** Resolves with the point, or null when the pick was cancelled. */
    readonly result: Promise<PickedPoint | null>;
    /** Cancels a pick that is still waiting. Harmless once it has settled. */
    cancel(): void;
    /** Takes the shield away. Call once whatever needed it held still is done. */
    release(): void;
}

/**
 * Starts a pick in a document.
 *
 * After a click the HINT goes at once but the SHIELD stays until `release()`:
 * the caller may need a frame of the page exactly as it was under the pointer,
 * and taking the shield away first would let whatever is under the click
 * switch to its hover state before that frame is captured.
 */
export function pickPoint(doc: Document, hint: string): PickSession {
    const shield = doc.createElement('div');
    shield.className = 'nexus-studio-pick-shield nexus-studio-isolated';
    shield.setAttribute('role', 'presentation');
    const note = doc.createElement('div');
    note.className = 'nexus-studio-pick-hint';
    note.textContent = hint;
    shield.appendChild(note);
    doc.body.appendChild(shield);

    let settle: (point: PickedPoint | null) => void = () => undefined;
    let settled = false;
    const result = new Promise<PickedPoint | null>((resolve) => {
        settle = (point) => {
            if (settled) return;
            settled = true;
            note.remove();
            doc.removeEventListener('keydown', onKey, true);
            resolve(point);
        };
    });

    const onClick = (event: MouseEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        settle({ x: event.clientX, y: event.clientY });
    };
    const onContextMenu = (event: MouseEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        settle(null);
        shield.remove();
    };
    const onKey = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        settle(null);
        shield.remove();
    };
    shield.addEventListener('click', onClick);
    shield.addEventListener('contextmenu', onContextMenu);
    doc.addEventListener('keydown', onKey, true);

    return {
        result,
        cancel(): void {
            settle(null);
            shield.remove();
        },
        release(): void {
            shield.remove();
        },
    };
}

/**
 * The longest `afterPaint` waits for a frame.
 *
 * A hidden or fully covered Obsidian window produces NO animation frames at
 * all — measured: none in three seconds — so a wait with no ceiling is a
 * sampler that never finishes and a pick layer that never goes away. Two frames
 * take ~33ms on a visible window; this is well past that and short enough that
 * nobody waits on it.
 */
export const PAINT_WAIT_MS = 150;

/**
 * Waits for the next painted frame, twice — once for style, once for paint —
 * or for `PAINT_WAIT_MS`, whichever comes first.
 */
export function afterPaint(doc: Document): Promise<void> {
    const win = doc.defaultView;
    if (!win) return Promise.resolve();
    return new Promise((resolve) => {
        const ceiling = win.setTimeout(resolve, PAINT_WAIT_MS);
        win.requestAnimationFrame(() =>
            win.requestAnimationFrame(() => {
                win.clearTimeout(ceiling);
                resolve();
            })
        );
    });
}
