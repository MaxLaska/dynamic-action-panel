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
    /** Management modes outline empty slots; locked mode keeps them bare. */
    showOutline: boolean;
}

/**
 * An empty cell of the 4x4 palette grid.
 *
 * The cell is always rendered — that is what keeps the grid from collapsing
 * when a button is context-hidden — but it only carries visible chrome and a
 * drop target in the management modes. In locked mode it is an inert spacer.
 */
export const GridSlotCell: React.FC<GridSlotCellProps> = ({
    categoryId,
    slot,
    droppableEnabled,
    isDropTarget,
    showOutline,
}) => {
    const { setNodeRef } = useDroppable({
        id: slotDroppableId(categoryId, slot),
        disabled: !droppableEnabled,
    });

    const className = [
        'ocap-grid-slot',
        'ocap-grid-slot--empty',
        showOutline && 'ocap-grid-slot--outlined',
        isDropTarget && 'ocap-grid-slot--drop-target',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div
            ref={setNodeRef}
            className={className}
            data-slot={slot}
            aria-hidden={!showOutline}
            title={
                showOutline
                    ? tWithParams('grid_slot_empty_tooltip', {
                          row: slotRow(slot) + 1,
                          column: slotColumn(slot) + 1,
                      })
                    : undefined
            }
            aria-label={showOutline ? t('grid_slot_empty') : undefined}
        />
    );
};
