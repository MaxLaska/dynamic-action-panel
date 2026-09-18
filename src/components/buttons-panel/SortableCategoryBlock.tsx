import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { categorySortableId } from '@/utils/categoryDragItems';
import { useCategoryDragOptional } from '@/contexts/ButtonDragContext';
import { suppressDragOnSelectionModifier } from '@/utils/dragSelectionGuard';

interface SortableCategoryBlockProps {
    categoryId: string;
    className?: string;
    onClick?: React.MouseEventHandler<HTMLDivElement>;
    children: React.ReactNode;
    renderTitle: () => React.ReactNode;
    /** Placeholder preview of the whole block while dragging (the full category content) */
    renderDragPreview?: () => React.ReactNode;
}

/**
 * List view: the whole category block is sortable; a long press on any non-button area starts the drag and the expanded state is kept.
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

    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
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
     * A press carrying Shift or Ctrl/Cmd is a cell-selection gesture and must
     * not reorder the category. Presses inside a grid never reach here (the
     * grid claims them in the capture phase); this covers the header and the
     * block's own surface, where there is no cell to select either — the
     * modifier simply suppresses the drag.
     */
    const dragListeners = suppressDragOnSelectionModifier(listeners);

    const blockClassName = [
        ...(isDragSource ? [] : [className]),
        'sortable-category-item',
        'category-drag-handle',
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
            {...(isDragSource ? {} : attributes)}
            {...(isDragSource ? {} : dragListeners)}
        >
            {isDragSource ? (
                renderDragPreview ? (
                    renderDragPreview()
                ) : (
                    <>
                        {renderTitle()}
                        {children}
                    </>
                )
            ) : (
                <>
                    {renderTitle()}
                    {children}
                </>
            )}
        </div>
    );
};
