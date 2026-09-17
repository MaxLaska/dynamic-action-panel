// id.ts
// The single id generator for every persisted identity (tools/buttons,
// categories, variants). Ids are opaque strings; nothing may parse them.
//
// Format: `[prefix-]<time base36>-<counter base36>-<entropy>`. The monotonic
// process-local counter is what makes the id collision-proof even when two
// ids are created in the same millisecond with colliding entropy — the
// weakness the old ad-hoc `Date.now().toString()` generators had (a real
// gap: copying a button twice within one millisecond produced one id).
//
// Existing stored ids keep whatever shape they were written with; only NEW
// ids come from here.

let counter = 0;

/** A practically collision-proof unique id, optionally prefixed for readability. */
export function freshId(prefix?: string): string {
    counter += 1;
    const id = `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 9)}`;
    return prefix ? `${prefix}-${id}` : id;
}
