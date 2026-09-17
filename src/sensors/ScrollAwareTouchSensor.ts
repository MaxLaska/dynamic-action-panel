import { TouchSensor, type SensorProps, type TouchSensorOptions } from '@dnd-kit/core';
import { patchScrollAwareHandleMove } from '@/sensors/patchScrollAwareHandleMove';

export type ScrollAwareTouchSensorProps = SensorProps<TouchSensorOptions>;

/**
 * Mobile touch sensor: dragging starts only after a long press, and a clear swipe intent (mostly vertical or horizontal) cancels it so native scrolling is kept.
 */
export class ScrollAwareTouchSensor extends TouchSensor {
    constructor(props: ScrollAwareTouchSensorProps) {
        super(props);
        patchScrollAwareHandleMove(this, 'touchmove');
    }
}
