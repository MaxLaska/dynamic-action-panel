/**
 * Shallow equality helpers for React.memo prop comparison.
 *
 * These helpers compare values with Object.is. They intentionally do NOT deep
 * compare: settings objects in this plugin are shared by identity between the
 * React tree and plugin.settings, so a changed identity is the reliable signal
 * that content changed (see ButtonEditModal, which replaces the edited
 * ButtonConfig instead of mutating it). Deep value comparison would be blind
 * to in-place mutation (prev and next would read the same mutated object) and
 * would also keep stale object identities captured in event handlers.
 */

/**
 * Shallowly compares two props objects with Object.is, skipping the given
 * keys. Returns true when all non-ignored properties are identical.
 */
export function shallowEqualExcept<T extends object>(
    prev: T,
    next: T,
    ignoredKeys: readonly string[] = []
): boolean {
    if (Object.is(prev, next)) {
        return true;
    }
    const prevRecord = prev as Record<string, unknown>;
    const nextRecord = next as Record<string, unknown>;
    const prevKeys = Object.keys(prevRecord).filter((key) => !ignoredKeys.includes(key));
    const nextKeys = Object.keys(nextRecord).filter((key) => !ignoredKeys.includes(key));
    if (prevKeys.length !== nextKeys.length) {
        return false;
    }
    for (const key of prevKeys) {
        if (!Object.prototype.hasOwnProperty.call(nextRecord, key)) {
            return false;
        }
        if (!Object.is(prevRecord[key], nextRecord[key])) {
            return false;
        }
    }
    return true;
}
