import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { slotDroppableId } from '@/utils/buttonDragItems';
import { slotColumn, slotRow } from '@/utils/categoryGrid';
import { t, tWithParams } from '@/utils/i18n';

interface GridSlotCellProps {
    categoryId: string;
    slot: number;
    /** Registers the slot as a drop target (sort mode only). */
    droppableEnabled: boolean;
    /** The pointer currently targets this slot during a drag. */
    isDropTarget: boolean;
    /** Management modes outline the cells; locked mode keeps them bare. */
    showOutline: boolean;
    /** The button occupying the slot, if any. */
    children?: React.ReactNode;
}

/**
 * One cell of the 4x4 grid — filled or empty.
 *
 * Every cell is always rendered and is always the SAME component, keyed by its
 * slot: that keeps the 16 droppable cell nodes mounted across variant
 * switches, so their dnd-kit registrations and measured rects stay valid no
 * matter how the occupancy changes. (Mounting droppables per empty slot — the
 * previous model — made a drag started right after a variant switch race the
 * new cells' registration/measurement: the drop then fell through to the
 * container zone and was ignored.)
 *
 * A filled cell being a droppable also makes the WHOLE cell a drop target,
 * not only the button it contains; the collision ranking still prefers the
 * button when the pointer is over it, so the drop semantics are unchanged.
 */
export const GridSlotCell: React.FC<GridSlotCellProps> = ({
    categoryId,
    slot,
    droppableEnabled,
    isDropTarget,
    showOutline,
    children,
}) => {
    const filled = children !== null && children !== undefined;
    const { setNodeRef } = useDroppable({
        id: slotDroppableId(categoryId, slot),
        disabled: !droppableEnabled,
    });

    const className = [
        'ocap-grid-slot',
        filled ? 'ocap-grid-slot--filled' : 'ocap-grid-slot--empty',
        !filled && showOutline && 'ocap-grid-slot--outlined',
        isDropTarget && 'ocap-grid-slot--drop-target',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div
            ref={setNodeRef}
            className={className}
            data-slot={slot}
            aria-hidden={!filled && !showOutline ? true : undefined}
            title={
                !filled && showOutline
                    ? tWithParams('grid_slot_empty_tooltip', {
                          row: slotRow(slot) + 1,
                          column: slotColumn(slot) + 1,
                      })
                    : undefined
            }
            aria-label={!filled && showOutline ? t('grid_slot_empty') : undefined}
        >
            {children}
        </div>
    );
};
