import React from 'react';
import { PointerSensor, type SensorProps, type PointerSensorOptions } from '@dnd-kit/core';
import { patchScrollAwareHandleMove } from '@/sensors/patchScrollAwareHandleMove';
import { MOUSE_BUTTON } from '@/utils/gridPointerIntent';

export type ScrollAwarePointerSensorProps = SensorProps<PointerSensorOptions>;

/**
 * Pointer events from touch or pen: the same scroll versus long-press logic as ScrollAwareTouchSensor.
 *
 * It also accepts the RIGHT button, which dnd-kit's own activator refuses: a
 * tool moves on a right drag now (cell-selection-colors.md §3a). Accepting a
 * button is not the same as claiming it — which draggable listens to which
 * button is decided per draggable in `activateOnButton`, because the grip and
 * the tool answer to different ones.
 */
export class ScrollAwarePointerSensor extends PointerSensor {
    static activators = [
        {
            eventName: 'onPointerDown' as const,
            handler: (
                { nativeEvent: event }: React.PointerEvent,
                options: PointerSensorOptions
            ) => {
                if (
                    !event.isPrimary ||
                    (event.button !== MOUSE_BUTTON.left &&
                        event.button !== MOUSE_BUTTON.right)
                ) {
                    return false;
                }
                options.onActivation?.({ event });
                return true;
            },
        },
    ];

    constructor(props: ScrollAwarePointerSensorProps) {
        super(props);
        patchScrollAwareHandleMove(this, 'pointermove');
    }
}
