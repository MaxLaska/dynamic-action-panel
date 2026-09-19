import React from 'react';
import { setIcon } from 'obsidian';
import type { ButtonConfig, CategoryConfig } from '@/types';
import type { ButtonsPanelPlugin } from '@/types/plugin';
import type { App } from 'obsidian';
import { CategoryButtonGrid } from '@/components/buttons-panel/CategoryButtonGrid';
import { CATEGORY_DRAG_HANDLE_CLASS } from '@/components/buttons-panel/SortableCategoryBlock';

interface CategoryListDragPreviewProps {
    category: CategoryConfig;
    orderedButtons: ButtonConfig[];
    isOpen: boolean;
    displayStyle: 'icon_left' | 'icon_top';
    plugin: ButtonsPanelPlugin;
    app: App;
    /** Category container class matching the list item, e.g. list-category-open */
    categoryClassName: string;
    /** Header class matching the list item, e.g. is-collapsible */
    titleClassName: string;
    className?: string;
}

/** List view category drag: the full content of both the placeholder and the follow preview (header plus button area) */
export const CategoryListDragPreview: React.FC<CategoryListDragPreviewProps> = ({
    category,
    orderedButtons,
    isOpen,
    displayStyle,
    plugin,
    app,
    categoryClassName,
    titleClassName,
    className,
}) => {
    const iconRef = React.useRef<HTMLSpanElement>(null);
    const layoutGridRef = React.useRef<HTMLSpanElement>(null);
    const handleRef = React.useRef<HTMLSpanElement>(null);
    const contentClass = `buttons-panel-grid ${displayStyle === 'icon_top' ? 'icon-top' : 'icon-left'}`;

    React.useEffect(() => {
        if (iconRef.current) {
            setIcon(iconRef.current, isOpen ? 'chevron-down' : 'chevron-right');
        }
        if (handleRef.current) {
            setIcon(handleRef.current, 'grip-vertical');
        }
        if (layoutGridRef.current) {
            setIcon(layoutGridRef.current, 'layout-grid');
        }
    }, [isOpen]);

    const rootClass = [categoryClassName, className].filter(Boolean).join(' ');

    return (
        <div className={rootClass}>
            <div className={titleClassName}>
                {/* Drawn, not wired: the header being dragged looks like the header. */}
                <span className={CATEGORY_DRAG_HANDLE_CLASS} ref={handleRef} aria-hidden="true" />
                <span className="category-icon-left" ref={layoutGridRef} />
                {category.name}
                <span className="category-icon" ref={iconRef} />
            </div>
            {isOpen && (
                <CategoryButtonGrid
                    category={category}
                    orderedButtons={orderedButtons}
                    contentClass={contentClass}
                    displayStyle={displayStyle}
                    enableAnimation={false}
                    enableEditMode={false}
                    plugin={plugin}
                    app={app}
                    sortableEnabled={false}
                    // A drag preview renders the same category a second (and
                    // third) time with the identical grid context key; it must
                    // never own or end the real selection.
                    selectable={false}
                />
            )}
        </div>
    );
};
