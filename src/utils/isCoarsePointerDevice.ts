/** True for coarse pointer devices such as touch screens (used to register only the Touch sensor and avoid conflicts with Pointer). */
export function isCoarsePointerDevice(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }
    return window.matchMedia('(pointer: coarse)').matches;
}
