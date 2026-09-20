import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import { tabDroppableId } from '@/utils/buttonDragItems';
import { categorySortableId } from '@/utils/categoryDragItems';
import { useButtonDragOptional, useCategoryDragOptional } from '@/contexts/ButtonDragContext';

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
    if (typeof ref === 'function') {
        ref(value);
        return;
    }
    if (ref) {
        (ref as React.MutableRefObject<T | null>).current = value;
    }
}

interface SortableCategoryFolderProps {
    categoryId: string;
    className?: string;
    onClick: () => void;
    innerRef?: React.Ref<HTMLDivElement>;
    buttonDropDisabled?: boolean;
    children: React.ReactNode;
}

/**
 * Folder view: a folder tile that can be reordered with a long-press drag and also accepts buttons dropped from other categories.
 */
export const SortableCategoryFolder: React.FC<SortableCategoryFolderProps> = ({
    categoryId,
    className,
    onClick,
    innerRef,
    buttonDropDisabled = false,
    children,
}) => {
    const buttonDrag = useButtonDragOptional();
    const categoryDrag = useCategoryDragOptional();
    const buttonSortableEnabled = buttonDrag?.enabled ?? false;
    const panelCategoryDragging = categoryDrag?.isDragging ?? false;
    const categorySortableEnabled =
        ((categoryDrag?.enabled ?? false) || panelCategoryDragging) &&
        !(buttonDrag?.isDragging ?? false);

    const categoryDragId = categorySortableId(categoryId);

    const {
        attributes,
        listeners,
        setNodeRef: setSortableRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: categoryDragId,
        disabled: !categorySortableEnabled,
        animateLayoutChanges: () => false,
    });

    // The left button belongs to the layout, whatever key is held: selecting
    // moved to the right button, so nothing here has to step aside for a
    // modifier any more.
    const dragListeners = listeners;

    const { setNodeRef: setButtonDropRef, isOver: isButtonDropOver } = useDroppable({
        id: tabDroppableId(categoryId),
        disabled: buttonDropDisabled || !buttonSortableEnabled || panelCategoryDragging,
    });

    const setNodeRef = React.useCallback(
        (node: HTMLDivElement | null) => {
            setSortableRef(node);
            setButtonDropRef(node);
            assignRef(innerRef, node);
        },
        [setSortableRef, setButtonDropRef, innerRef]
    );

    const style: React.CSSProperties = {
        transform: transform ? CSS.Transform.toString(transform) : undefined,
        transition: panelCategoryDragging ? undefined : transition,
    };

    const classNames = [
        className,
        'sortable-category-folder',
        categorySortableEnabled ? 'category-drag-handle' : '',
        categorySortableEnabled ? 'folder-reorder-enabled' : '',
        isDragging ? 'sortable-category-folder--dragging' : '',
        buttonSortableEnabled && buttonDrag?.isDragging && isButtonDropOver
            ? 'button-drag-folder-over'
            : '',
    ]
        .filter(Boolean)
        .join(' ');

    const handleClick = () => {
        if (categoryDrag?.isDragging || buttonDrag?.isDragging) return;
        onClick();
    };

    return (
        <div
            ref={setNodeRef}
            className={classNames}
            style={style}
            {...attributes}
            {...dragListeners}
            onClick={handleClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                handleClick();
            }}
        >
            {children}
        </div>
    );
};
