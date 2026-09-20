import React from 'react';
import { setIcon } from 'obsidian';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { categorySortableId } from '@/utils/categoryDragItems';
import { useCategoryDragOptional } from '@/contexts/ButtonDragContext';
import { activateOnButton } from '@/utils/dragActivator';
import { MOUSE_BUTTON } from '@/utils/gridPointerIntent';

/** The one place a list category can be picked up (CategoryDrag.css). */
export const CATEGORY_DRAG_HANDLE_CLASS = 'ocap-category-drag-handle';

interface SortableCategoryBlockProps {
    categoryId: string;
    className?: string;
    onClick?: React.MouseEventHandler<HTMLDivElement>;
    children: React.ReactNode;
    /** Renders the header; `handle` is the drag handle and goes first in it. */
    renderTitle: (handle: React.ReactNode) => React.ReactNode;
    /** Placeholder preview of the whole block while dragging (the full category content) */
    renderDragPreview?: () => React.ReactNode;
}

/**
 * List view: the whole category block is the SORTABLE ITEM — it moves, it is
 * measured, it is what a drop lands on — but only its handle ACTIVATES a drag.
 *
 * The block used to be its own activator, which made every free pixel of a
 * category (the header, the grid's gutters, the space below the palette) a
 * grab surface, and the header both "fold" and "move". The handle separates
 * the two: handle = move, header = fold, everything else = nothing layout-wise.
 * dnd-kit's own mechanism does it (`setActivatorNodeRef` plus the listeners
 * and attributes on that node); the sortable, the drop, the preview and the
 * animation are untouched.
 */
export const SortableCategoryBlock: React.FC<SortableCategoryBlockProps> = ({
    categoryId,
    className,
    onClick,
    children,
    renderTitle,
    renderDragPreview,
}) => {
    const categoryDrag = useCategoryDragOptional();
    const panelDragging = categoryDrag?.isDragging ?? false;

    const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
        useSortable({
            id: categorySortableId(categoryId),
            animateLayoutChanges: () => false,
        });

    /**
     * The drag source is identified by the context's activeCategoryId rather than useSortable.isDragging,
     * and the sortable transform is always applied so the placeholder follows the live categoryIds order.
     * Forcing transform:none while isDragging would leave the placeholder at its last swapped DOM position when dragging back.
     */
    const isDragSource =
        panelDragging && categoryDrag?.activeCategoryId === categoryId;

    const style: React.CSSProperties = {
        transform: transform ? CSS.Translate.toString(transform) : undefined,
        transition: panelDragging ? undefined : transition,
        ...(isDragSource ? { visibility: 'visible' } : {}),
    };

    /**
     * A category moves on a LEFT drag from its grip — the grip has no other
     * meaning, so it answers to the ordinary button (a TOOL moves on the right
     * one). A press carrying a selection modifier is swallowed: there is no
     * cell to select out here, but reordering under a held Shift would be a
     * surprise.
     */
    const dragListeners = activateOnButton(listeners, MOUSE_BUTTON.left, {
        blockSelectionModifier: true,
    });

    const bindHandleIcon = React.useCallback((el: HTMLSpanElement | null) => {
        setActivatorNodeRef(el);
        if (el) {
            setIcon(el, 'grip-vertical');
        }
    }, [setActivatorNodeRef]);

    // The handle sits INSIDE the header, whose click folds the category. A
    // click on the handle means nothing — it must not fold, and it is not
    // panel background either (see selectionBackdrop).
    const handle = (
        <span
            ref={bindHandleIcon}
            className={CATEGORY_DRAG_HANDLE_CLASS}
            {...attributes}
            {...dragListeners}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
        />
    );

    const blockClassName = [
        ...(isDragSource ? [] : [className]),
        'sortable-category-item',
        isDragSource ? 'sortable-category-item--dragging' : '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={blockClassName}
            data-category-drag-source={isDragSource || undefined}
            onClick={onClick}
        >
            {isDragSource ? (
                renderDragPreview ? (
                    renderDragPreview()
                ) : (
                    <>
                        {renderTitle(null)}
                        {children}
                    </>
                )
            ) : (
                <>
                    {renderTitle(handle)}
                    {children}
                </>
            )}
        </div>
    );
};

/**
 * Where the handle would be, when there is none: a category that cannot be
 * reordered right now (locked mode, a search, a tool drag in flight) keeps the
 * handle's SPACE, empty and inert, so the header does not shift sideways when
 * the mode changes — the same rule as the resize gutter (cell-selection-colors
 * §19).
 */
export const CategoryDragHandleSpace: React.FC = () => (
    <span
        className={`${CATEGORY_DRAG_HANDLE_CLASS} ${CATEGORY_DRAG_HANDLE_CLASS}--inert`}
        aria-hidden="true"
    />
);
