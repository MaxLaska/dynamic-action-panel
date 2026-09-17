// id.test.ts
// The central id generator: collision-proof even inside one millisecond.
//
// The retired ad-hoc generators used `Date.now().toString()` (sometimes with
// entropy, sometimes without) — copying a button twice within the same
// millisecond could produce the same id. The central generator carries a
// monotonic counter, so uniqueness holds even with a frozen clock AND
// colliding entropy.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { freshId } from '@/utils/id';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('freshId', () => {
    it('is unique across many rapid calls', () => {
        const ids = new Set<string>();
        for (let i = 0; i < 10_000; i++) {
            ids.add(freshId());
        }
        expect(ids.size).toBe(10_000);
    });

    it('is unique even with a frozen clock and constant entropy (the old copyButton gap)', () => {
        vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
        vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

        const ids = new Set<string>();
        for (let i = 0; i < 1_000; i++) {
            ids.add(freshId());
        }
        expect(ids.size).toBe(1_000);
    });

    it('applies the prefix without changing uniqueness', () => {
        const a = freshId('var');
        const b = freshId('var');
        expect(a.startsWith('var-')).toBe(true);
        expect(b.startsWith('var-')).toBe(true);
        expect(a).not.toBe(b);
    });
});
