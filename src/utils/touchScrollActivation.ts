/** Long-press delay before a touch drag activates (milliseconds). */
export const MOBILE_LONG_PRESS_DELAY_MS = 500;

/** Minimum movement that is treated as a scroll gesture (pixels). */
export const SCROLL_CANCEL_DISTANCE_PX = 10;

/**
 * Before the drag activates: if the movement looks more like a scroll (mostly vertical
 * or mostly horizontal), cancel the long press and hand the gesture back to native scrolling.
 */
export function shouldCancelActivationForScroll(
    delta: { x: number; y: number },
    threshold = SCROLL_CANCEL_DISTANCE_PX
): boolean {
    const dx = Math.abs(delta.x);
    const dy = Math.abs(delta.y);

    if (dy > threshold && dy > dx) {
        return true;
    }

    if (dx > threshold && dx > dy) {
        return true;
    }

    return false;
}
