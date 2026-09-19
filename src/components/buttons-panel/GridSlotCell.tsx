import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { setIcon } from 'obsidian';
import { slotDroppableId } from '@/utils/buttonDragItems';
import { RESIZE_DRAG_THRESHOLD_PX, slotColumn, slotRow } from '@/utils/categoryGrid';
import { hasSelectionModifier } from '@/utils/cellSelectionGesture';
import { t, tWithParams } from '@/utils/i18n';

/** Vault-file drop handling of ONE slot, empty or filled, in either mode. */
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
    /** Registers the slot as a target of the INTERNAL layout drag (edit mode only). */
    droppableEnabled: boolean;
    /** The pointer currently targets this slot during a drag. */
    isDropTarget: boolean;
    /**
     * A management mode is on.
     *
     * NOT about the cell's outline any more: the raster is drawn in every mode
     * (locked and edit must not look like two different panels — see
     * PaletteGrid.css). What this still gates is the EDITING vocabulary of an
     * empty cell: its "add a tool here" tooltip and label, and whether it is an
     * announced surface at all.
     */
    managed: boolean;
    /**
     * Edit mode: creates a tool in exactly this slot. Passing it turns an
     * empty cell into an add affordance; a filled cell ignores it.
     */
    onCreate?: () => void;
    /** Edit mode: a vault file dropped on this empty cell becomes a tool. */
    fileDrop?: GridSlotFileDrop;
    /**
     * Already resolved CSS background of this cell, if it carries a color.
     * Content, not chrome: it renders in locked mode too.
     */
    color?: string;
    /** Edit mode: this cell is part of the current selection. */
    selected?: boolean;
    /**
     * A running REMOVE rectangle is about to drop this cell.
     *
     * Transient, and only ever true while the pointer is down: it exists
     * because a removal is otherwise invisible — the cell just stops being
     * selected, so the user cannot see which block is doing it.
     */
    deselecting?: boolean;
    /** The button occupying the slot, if any. */
    children?: React.ReactNode;
}

/**
 * The `+` of an empty cell — a small corner affordance, not the cell.
 *
 * It used to fill the whole cell, which made the cell surface unclickable for
 * anything else. Now the cell surface belongs to the selection and the `+` is a
 * corner target, inset from the edge so the cell's outer band always selects
 * and two neighbouring `+` targets never touch.
 *
 * It must swallow its own press: in list view the whole category block carries
 * the category-drag listeners (upstream behaviour), so a press that bubbles
 * would start dragging the category instead of opening the tool modal. That
 * stays true with a modifier held — only the CLICK changes meaning.
 *
 * Modifier priority: with Shift or Ctrl/Cmd down the user is building a
 * selection, so a stray hit on the corner must not open a modal. The click is
 * then not handled here at all and bubbles to the grid, which treats it as an
 * ordinary click on this cell.
 */
const SlotAddButton: React.FC<{ label: string; onClick: () => void }> = ({
    label,
    onClick,
}) => {
    const iconRef = React.useRef<HTMLSpanElement>(null);
    /** Where the press started, so a drag inside the `+` is not a click. */
    const originRef = React.useRef<{ x: number; y: number } | null>(null);

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
            onPointerDown={(event) => {
                originRef.current =
                    event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
                swallow(event);
            }}
            onMouseDown={swallow}
            onTouchStart={swallow}
            onClick={(event) => {
                const origin = originRef.current;
                originRef.current = null;
                if (hasSelectionModifier(event)) {
                    // Let the grid read it as a cell click.
                    return;
                }
                // Same rule as everywhere else in the grid: past the drag
                // threshold it was a drag, not a click. The `+` is only 18px,
                // so a press that travels and still ends inside it would
                // otherwise open the modal.
                if (event.detail !== 0 && origin !== null) {
                    const dx = event.clientX - origin.x;
                    const dy = event.clientY - origin.y;
                    if (Math.sqrt(dx * dx + dy * dy) > RESIZE_DRAG_THRESHOLD_PX) {
                        event.preventDefault();
                        event.stopPropagation();
                        return;
                    }
                }
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
 * interfere with the plugin's pointer-based (dnd-kit) button drag.
 */
export const GridSlotCell: React.FC<GridSlotCellProps> = ({
    categoryId,
    slot,
    columns,
    droppableEnabled,
    isDropTarget,
    managed,
    onCreate,
    fileDrop,
    color,
    selected = false,
    deselecting = false,
    children,
}) => {
    const filled = children !== null && children !== undefined;
    const { setNodeRef } = useDroppable({
        id: slotDroppableId(categoryId, slot),
        disabled: !droppableEnabled,
    });

    const [fileDragOver, setFileDragOver] = React.useState(false);
    const addable = !filled && onCreate !== undefined;
    // A file may land on ANY cell, filled or not: aiming it at an occupied one
    // means "this one instead", and the drop is the deliberate act. Creating a
    // tool through the `+` stays empty-cells-only — that is editing, and the
    // cell has nothing to say about what should replace what.
    const acceptsFiles = fileDrop !== undefined;

    // A cell must never keep a stale highlight from a drag that was still in
    // flight when dropping stopped being allowed.
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
        color && 'ocap-grid-slot--colored',
        selected && 'ocap-grid-slot--selected',
        deselecting && 'ocap-grid-slot--deselecting',
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
            style={
                color ? ({ '--ocap-cell-color': color } as React.CSSProperties) : undefined
            }
            // A colored EMPTY cell is real content in locked mode (a separator,
            // a reserved place), so it must stop being aria-hidden there — but
            // it stays a surface, never a control.
            aria-hidden={!filled && !managed && !color ? true : undefined}
            title={!filled && managed ? emptyTooltip : undefined}
            aria-label={!filled && managed ? t('grid_slot_empty') : undefined}
            // Cells are role-less divs, so aria-selected would be invalid here.
            // data-selected keeps the state inspectable (and testable) without
            // claiming a listbox semantics the DOM does not have.
            data-selected={selected ? 'true' : undefined}
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
