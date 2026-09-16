import React from 'react';
import { setIcon } from 'obsidian';
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
    /**
     * Another palette layer reserves this slot, so the layer on screen cannot
     * use it. The cell stays visible (positions must never shift) but rejects
     * drops and says why.
     */
    blocked?: boolean;
    /** Names of the context profiles reserving the slot, for the tooltip. */
    reservedBy?: readonly string[];
    /**
     * A pinned base tool rendered inside a context layer. The cell still holds
     * content, but it must behave like a wall: it registers a disabled
     * droppable so the palette's background container cannot absorb a drop
     * aimed at it (which would commit the drag's last intermediate position).
     */
    locked?: boolean;
    children?: React.ReactNode;
}

/**
 * An empty cell of the 4x4 palette grid.
 *
 * The cell is always rendered — that is what keeps the grid from collapsing
 * when a tool is not part of the active layer — but it only carries visible
 * chrome and a drop target in the management modes. In locked mode it is an
 * inert spacer.
 */
export const GridSlotCell: React.FC<GridSlotCellProps> = ({
    categoryId,
    slot,
    droppableEnabled,
    isDropTarget,
    showOutline,
    blocked = false,
    reservedBy,
    locked = false,
    children,
}) => {
    // A blocked cell stays a registered droppable ON PURPOSE. It outranks the
    // palette's background container in the collision detection, so a drop
    // aimed at it is recognised as this cell and refused explicitly, instead of
    // falling through to the container and silently committing the drag's last
    // intermediate position. The refusal itself lives in the drop semantics
    // (applyDragOverToItems / resolveGridDropOutcome).
    const { setNodeRef } = useDroppable({
        id: slotDroppableId(categoryId, slot),
        disabled: !droppableEnabled,
    });

    const className = [
        'ocap-grid-slot',
        locked ? 'ocap-grid-slot--filled' : 'ocap-grid-slot--empty',
        locked && 'ocap-grid-slot--locked',
        !locked && showOutline && 'ocap-grid-slot--outlined',
        !locked && blocked && 'ocap-grid-slot--reserved',
        isDropTarget && 'ocap-grid-slot--drop-target',
    ]
        .filter(Boolean)
        .join(' ');

    const reservedLabel =
        reservedBy && reservedBy.length > 0
            ? tWithParams('palette_slot_reserved', { contexts: reservedBy.join(', ') })
            : t('palette_slot_reserved_short');

    const title = locked
        ? t('palette_slot_pinned_locked')
        : blocked
          ? reservedLabel
          : showOutline
            ? tWithParams('grid_slot_empty_tooltip', {
                  row: slotRow(slot) + 1,
                  column: slotColumn(slot) + 1,
              })
            : undefined;

    return (
        <div
            ref={setNodeRef}
            className={className}
            data-slot={slot}
            aria-hidden={!showOutline && !blocked && !locked}
            title={title}
            aria-label={
                locked
                    ? t('palette_slot_pinned_locked')
                    : blocked
                      ? reservedLabel
                      : showOutline
                        ? t('grid_slot_empty')
                        : undefined
            }
        >
            {children}
            {!locked && blocked && showOutline && (
                <span
                    className="ocap-grid-slot-reserved-icon"
                    ref={(el) => el && setIcon(el, 'filter')}
                />
            )}
        </div>
    );
};
