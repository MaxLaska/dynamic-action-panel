import { PointerSensor, type SensorProps, type PointerSensorOptions } from '@dnd-kit/core';
import { patchScrollAwareHandleMove } from '@/sensors/patchScrollAwareHandleMove';

export type ScrollAwarePointerSensorProps = SensorProps<PointerSensorOptions>;

/**
 * Pointer events from touch or pen: the same scroll versus long-press logic as ScrollAwareTouchSensor.
 */
export class ScrollAwarePointerSensor extends PointerSensor {
    constructor(props: ScrollAwarePointerSensorProps) {
        super(props);
        patchScrollAwareHandleMove(this, 'pointermove');
    }
}
