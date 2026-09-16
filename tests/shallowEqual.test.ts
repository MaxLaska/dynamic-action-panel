import { describe, expect, it } from 'vitest';
import { shallowEqualExcept } from '@/utils/shallowEqual';

/**
 * shallowEqualExcept is the comparison logic behind ButtonItem's React.memo
 * (see areButtonItemPropsEqual). The scenarios below mirror the button
 * rendering contract: content edits replace the ButtonConfig object, so a
 * changed identity must invalidate the memo, while ignored keys (index) and
 * identical identities keep it.
 */
describe('shallowEqualExcept', () => {
    const button = { id: 'b1', name: 'Button', actions: [{ type: 'command' }] };
    const category = { id: 'c1', name: 'Category', buttons: [button] };

    it('returns true for identical prop identities', () => {
        const props = { button, category, displayStyle: 'icon_top', index: 0 };
        expect(shallowEqualExcept(props, { ...props }, ['index'])).toBe(true);
    });

    it('ignores listed keys', () => {
        const prev = { button, category, index: 0 };
        const next = { button, category, index: 5 };
        expect(shallowEqualExcept(prev, next, ['index'])).toBe(true);
        expect(shallowEqualExcept(prev, next)).toBe(false);
    });

    it('detects a replaced button object even when its content is equal', () => {
        const prev = { button, category, index: 0 };
        const next = {
            button: { ...button, actions: button.actions.map((a) => ({ ...a })) },
            category,
            index: 0,
        };
        expect(shallowEqualExcept(prev, next, ['index'])).toBe(false);
    });

    it('detects an edited button (new identity with changed actions)', () => {
        const prev = { button, category, index: 0 };
        const next = {
            button: { ...button, actions: [{ type: 'script' }] },
            category,
            index: 0,
        };
        expect(shallowEqualExcept(prev, next, ['index'])).toBe(false);
    });

    it('detects changed scalar props', () => {
        const prev = { button, category, enableEditMode: false };
        const next = { button, category, enableEditMode: true };
        expect(shallowEqualExcept(prev, next)).toBe(false);
    });

    it('handles differing key sets', () => {
        const prev: Record<string, unknown> = { a: 1 };
        const next: Record<string, unknown> = { a: 1, b: 2 };
        expect(shallowEqualExcept(prev, next)).toBe(false);
    });

    it('treats NaN as equal to itself (Object.is semantics)', () => {
        expect(shallowEqualExcept({ delay: NaN }, { delay: NaN })).toBe(true);
    });
});
