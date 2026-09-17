import type { Modifier } from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';

const IDENTITY_TRANSFORM = { x: 0, y: 0, scaleX: 1, scaleY: 1 };

/** Centers the drag preview on the pointer instead of keeping the pointer's relative offset inside the element. */
export const snapCenterToCursor: Modifier = ({
    activatorEvent,
    draggingNodeRect,
    activeNodeRect,
    transform,
}) => {
    const base = transform ?? IDENTITY_TRANSFORM;
    const nodeRect = draggingNodeRect ?? activeNodeRect;

    if (!nodeRect || !activatorEvent) {
        return base;
    }

    const activatorCoordinates = getEventCoordinates(activatorEvent);
    if (!activatorCoordinates) {
        return base;
    }

    const offsetX = activatorCoordinates.x - nodeRect.left;
    const offsetY = activatorCoordinates.y - nodeRect.top;

    return {
        ...base,
        x: base.x + offsetX - nodeRect.width / 2,
        y: base.y + offsetY - nodeRect.height / 2,
    };
};
