import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { setIcon } from 'obsidian';
import { slotDroppableId } from '@/utils/buttonDragItems';
import { slotColumn, slotRow } from '@/utils/categoryGrid';
import { t, tWithParams } from '@/utils/i18n';

/** Vault-file drop handling of ONE empty slot (edit mode only). */
export interface GridSlotFileDrop {
    /** Whether this drag carries something a slot can turn into a tool. */
    canAccept: (dataTransfer: DataTransfer | null) => boolean;
    onDrop: (dataTransfer: DataTransfer | null) => void;
}

interface GridSlotCellProps {
    categoryId: string;
    slot: number;
    /** Column count of THIS grid — the slot index is read against it. */
    columns: number;
    /** Registers the slot as a drop target (edit mode only). */
    droppableEnabled: boolean;
    /** The pointer currently targets this slot during a drag. */
    isDropTarget: boolean;
    /** Management modes outline the cells; locked mode keeps them bare. */
    showOutline: boolean;
    /**
     * Edit mode: creates a tool in exactly this slot. Passing it turns an
     * empty cell into an add affordance; a filled cell ignores it.
     */
    onCreate?: () => void;
    /** Edit mode: a vault file dropped on this empty cell becomes a tool. */
    fileDrop?: GridSlotFileDrop;
    /** The button occupying the slot, if any. */
    children?: React.ReactNode;
}

/**
 * The `+` of an empty cell.
 *
 * It must swallow its own press: in list view the whole category block carries
 * the category-drag listeners (upstream behaviour), so a press that bubbles
 * would start dragging the category instead of opening the tool modal.
 */
const SlotAddButton: React.FC<{ label: string; onClick: () => void }> = ({
    label,
    onClick,
}) => {
    const iconRef = React.useRef<HTMLSpanElement>(null);

    React.useEffect(() => {
        if (iconRef.current) {
            setIcon(iconRef.current, 'plus');
        }
    }, []);

    const swallow = (event: React.SyntheticEvent) => {
        event.stopPropagation();
    };

    return (
        <button
            type="button"
            className="ocap-slot-add"
            aria-label={label}
            onPointerDown={swallow}
            onMouseDown={swallow}
            onTouchStart={swallow}
            onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onClick();
            }}
        >
            <span ref={iconRef} className="ocap-slot-add-icon" />
        </button>
    );
};

/**
 * One cell of the grid — filled or empty.
 *
 * Every cell is always rendered and is always the SAME component, keyed by its
 * slot: that keeps the droppable cell nodes mounted across variant
 * switches, so their dnd-kit registrations and measured rects stay valid no
 * matter how the occupancy changes. (Mounting droppables per empty slot — the
 * previous model — made a drag started right after a variant switch race the
 * new cells' registration/measurement: the drop then fell through to the
 * container zone and was ignored.)
 *
 * A filled cell being a droppable also makes the WHOLE cell a drop target,
 * not only the button it contains; the collision ranking still prefers the
 * button when the pointer is over it, so the drop semantics are unchanged.
 *
 * In edit mode an empty cell is additionally the place where a tool is
 * CREATED: its `+` opens the tool modal already bound to this slot, and a
 * vault file dragged out of Obsidian's file explorer onto it becomes a tool
 * directly. Both use native HTML5 drag/click events and therefore cannot
 * interfere with OCAP's pointer-based (dnd-kit) button drag.
 */
export const GridSlotCell: React.FC<GridSlotCellProps> = ({
    categoryId,
    slot,
    columns,
    droppableEnabled,
    isDropTarget,
    showOutline,
    onCreate,
    fileDrop,
    children,
}) => {
    const filled = children !== null && children !== undefined;
    const { setNodeRef } = useDroppable({
        id: slotDroppableId(categoryId, slot),
        disabled: !droppableEnabled,
    });

    const [fileDragOver, setFileDragOver] = React.useState(false);
    const addable = !filled && onCreate !== undefined;
    const acceptsFiles = !filled && fileDrop !== undefined;

    // A filled cell must never keep a stale highlight from a drag that was
    // still in flight when the slot got occupied.
    React.useEffect(() => {
        if (!acceptsFiles && fileDragOver) {
            setFileDragOver(false);
        }
    }, [acceptsFiles, fileDragOver]);

    const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        if (!fileDrop?.canAccept(event.dataTransfer)) {
            return;
        }
        // Without preventDefault the browser refuses the drop outright.
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
        if (!fileDragOver) {
            setFileDragOver(true);
        }
    };

    const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
        // Moving onto the cell's own `+` is not leaving the cell.
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) {
            return;
        }
        setFileDragOver(false);
    };

    const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
        setFileDragOver(false);
        if (!fileDrop?.canAccept(event.dataTransfer)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        fileDrop.onDrop(event.dataTransfer);
    };

    const className = [
        'ocap-grid-slot',
        filled ? 'ocap-grid-slot--filled' : 'ocap-grid-slot--empty',
        !filled && showOutline && 'ocap-grid-slot--outlined',
        isDropTarget && 'ocap-grid-slot--drop-target',
        fileDragOver && acceptsFiles && 'ocap-grid-slot--file-target',
    ]
        .filter(Boolean)
        .join(' ');

    const emptyTooltip = addable
        ? tWithParams('grid_slot_add_tooltip', {
              row: slotRow(slot, columns) + 1,
              column: slotColumn(slot, columns) + 1,
          })
        : tWithParams('grid_slot_empty_tooltip', {
              row: slotRow(slot, columns) + 1,
              column: slotColumn(slot, columns) + 1,
          });

    return (
        <div
            ref={setNodeRef}
            className={className}
            data-slot={slot}
            aria-hidden={!filled && !showOutline ? true : undefined}
            title={!filled && showOutline ? emptyTooltip : undefined}
            aria-label={!filled && showOutline ? t('grid_slot_empty') : undefined}
            onDragEnter={acceptsFiles ? handleDragOver : undefined}
            onDragOver={acceptsFiles ? handleDragOver : undefined}
            onDragLeave={acceptsFiles ? handleDragLeave : undefined}
            onDrop={acceptsFiles ? handleDrop : undefined}
        >
            {children}
            {!filled && onCreate && (
                <SlotAddButton label={emptyTooltip} onClick={onCreate} />
            )}
        </div>
    );
};
