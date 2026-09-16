import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * `@dnd-kit/utilities`' `getEventCoordinates` probes `getWindow(event.target)`
 * for a `TouchEvent` constructor. Under the Node test environment there is no
 * global `window`, so provide a minimal stub before importing the module under
 * test. `TouchEvent: undefined` short-circuits the touch branch, which is what
 * we want for synthetic pointer events.
 */
beforeAll(() => {
    (globalThis as { window?: unknown }).window = { TouchEvent: undefined };
});

const { scrollAwarePointerHandleMove } = await import(
    '@/sensors/scrollAwarePointerHandleMove'
);
const { SCROLL_CANCEL_DISTANCE_PX } = await import('@/utils/touchScrollActivation');

type Constraint = { distance: number; tolerance?: number } | { delay: number; tolerance: number };

function createSensor(activationConstraint: Constraint, activated = false) {
    return {
        activated,
        initialCoordinates: { x: 100, y: 100 },
        props: {
            onMove: vi.fn(),
            options: { activationConstraint },
        },
        handleStart: vi.fn(),
        handleCancel: vi.fn(),
        handlePending: vi.fn(),
    };
}

/** Synthetic pointermove at absolute viewport coordinates. */
function moveEvent(clientX: number, clientY: number): Event {
    return {
        clientX,
        clientY,
        target: null,
        cancelable: false,
    } as unknown as Event;
}

describe('scrollAwarePointerHandleMove — desktop distance constraint', () => {
    it('does not start the drag below the activation distance', () => {
        const sensor = createSensor({ distance: 4 });

        // 3px total movement — under the 4px threshold.
        scrollAwarePointerHandleMove(sensor, moveEvent(103, 100));

        expect(sensor.handleStart).not.toHaveBeenCalled();
        expect(sensor.handleCancel).not.toHaveBeenCalled();
        expect(sensor.handlePending).toHaveBeenCalledTimes(1);
    });

    it('starts the drag once the activation distance is exceeded', () => {
        const sensor = createSensor({ distance: 4 });

        scrollAwarePointerHandleMove(sensor, moveEvent(106, 100));

        expect(sensor.handleStart).toHaveBeenCalledTimes(1);
        expect(sensor.handleCancel).not.toHaveBeenCalled();
    });

    it('starts the drag on a single large jump (fast mouse drag)', () => {
        const sensor = createSensor({ distance: 4 });

        // A quick desktop drag delivers its first pointermove far from the
        // origin; this must activate rather than cancel.
        scrollAwarePointerHandleMove(sensor, moveEvent(160, 40));

        expect(sensor.handleStart).toHaveBeenCalledTimes(1);
        expect(sensor.handleCancel).not.toHaveBeenCalled();
    });

    it('cancels a distance-constrained press only when a tolerance is configured and exceeded', () => {
        const sensor = createSensor({ distance: 4, tolerance: 6 });

        scrollAwarePointerHandleMove(sensor, moveEvent(160, 40));

        // Documents why the desktop sensor deliberately configures no
        // tolerance: it is evaluated first and aborts fast drags.
        expect(sensor.handleCancel).toHaveBeenCalledTimes(1);
        expect(sensor.handleStart).not.toHaveBeenCalled();
    });

    it('forwards coordinates once activated', () => {
        const sensor = createSensor({ distance: 4 }, true);

        scrollAwarePointerHandleMove(sensor, moveEvent(140, 90));

        expect(sensor.props.onMove).toHaveBeenCalledWith({ x: 140, y: 90 });
        expect(sensor.handleStart).not.toHaveBeenCalled();
    });
});

describe('scrollAwarePointerHandleMove — touch delay constraint (unchanged)', () => {
    it('cancels the pending long press on a scroll-shaped gesture', () => {
        const sensor = createSensor({ delay: 500, tolerance: SCROLL_CANCEL_DISTANCE_PX });

        // Dominant-axis movement past the scroll threshold = scrolling.
        scrollAwarePointerHandleMove(sensor, moveEvent(100, 140));

        expect(sensor.handleCancel).toHaveBeenCalledTimes(1);
        expect(sensor.handleStart).not.toHaveBeenCalled();
    });

    it('never starts a drag from movement alone — the delay timer owns activation', () => {
        const sensor = createSensor({ delay: 500, tolerance: SCROLL_CANCEL_DISTANCE_PX });

        // Diagonal movement is not scroll-shaped, so it stays pending.
        scrollAwarePointerHandleMove(sensor, moveEvent(160, 160));

        expect(sensor.handleStart).not.toHaveBeenCalled();
        expect(sensor.handleCancel).not.toHaveBeenCalled();
        expect(sensor.handlePending).toHaveBeenCalledTimes(1);
    });
});
