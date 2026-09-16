import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
    SortableContext,
    rectSortingStrategy,
    type SortingStrategy,
} from '@dnd-kit/sortable';
import type { CategoryConfig, ButtonConfig } from '@/types';
import type { ButtonsPanelPlugin } from '@/types/plugin';
import type { App } from 'obsidian';
import { SortableButtonItem } from '@/components/button/SortableButtonItem';
import { ButtonItem } from '@/components/button/ButtonItem';
import { containerDroppableId } from '@/utils/buttonDragItems';
import { useButtonDragOptional } from '@/contexts/ButtonDragContext';
import { ButtonDragEmptySlot } from '@/components/buttons-panel/ButtonDragEmptySlot';
import { GridSlotCell } from '@/components/buttons-panel/GridSlotCell';
import {
    GRID_COLUMNS,
    isGridCategory,
    placeButtonsOnGrid,
} from '@/utils/categoryGrid';

/**
 * Sorting strategy for the palette grid: never translate anything.
 * A grid is positional — a button stays on its slot until the drop actually
 * reassigns it, so the list-style "make room" animation would be a lie.
 */
const NO_SORT_TRANSFORM: SortingStrategy = () => null;

interface CategoryButtonGridProps {
    category: CategoryConfig;
    orderedButtons: ButtonConfig[];
    contentClass: string;
    displayStyle: 'icon_left' | 'icon_top';
    enableAnimation: boolean;
    enableEditMode: boolean;
    plugin: ButtonsPanelPlugin;
    app: App;
    sortableEnabled: boolean;
    children?: React.ReactNode;
}

export const CategoryButtonGrid: React.FC<CategoryButtonGridProps> = ({
    category,
    orderedButtons,
    contentClass,
    displayStyle,
    enableAnimation,
    enableEditMode,
    plugin,
    app,
    sortableEnabled,
    children,
}) => {
    const buttonDrag = useButtonDragOptional();
    const isGrid = isGridCategory(category);
    const showDragEmptySlot =
        (buttonDrag?.isDragging ?? false) && orderedButtons.length === 0 && !isGrid;

    const { setNodeRef } = useDroppable({
        id: containerDroppableId(category.id),
        disabled: !sortableEnabled,
    });

    const gridRef = React.useRef<HTMLDivElement>(null);
    const isDragging = buttonDrag?.isDragging ?? false;

    // 必须在任何提前 return 之前无条件调用，保证 sortableEnabled 切换分支时 hooks 数量一致。
    const setRefs = React.useCallback(
        (node: HTMLDivElement | null) => {
            setNodeRef(node);
            (gridRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        },
        [setNodeRef]
    );

    /**
     * Grid layout: slot occupancy of all GRID_SLOT_COUNT cells. During a drag
     * this comes from the live drag state so the preview is positional too;
     * otherwise it is resolved straight from the stored slots. Buttons already
     * removed by the context projection simply leave their slot empty — which
     * is the whole point of the palette.
     */
    const gridSlots = React.useMemo(() => {
        if (!isGrid) return null;
        if (sortableEnabled && buttonDrag) {
            return buttonDrag.getGridSlotButtons(category);
        }
        return placeButtonsOnGrid(category.buttons).slots;
    }, [isGrid, sortableEnabled, buttonDrag, category]);

    /** Buttons that could not be placed (corrupt data); never dropped. */
    const gridOverflow = React.useMemo(
        () => (isGrid ? placeButtonsOnGrid(category.buttons).overflow : []),
        [isGrid, category.buttons]
    );

    const dropTargetSlot =
        buttonDrag?.dropTargetSlot?.categoryId === category.id
            ? buttonDrag.dropTargetSlot.slot
            : null;

    const renderButton = (button: ButtonConfig, index: number) =>
        sortableEnabled ? (
            <SortableButtonItem
                key={button.id}
                button={button}
                category={category}
                index={index}
                displayStyle={displayStyle}
                enableAnimation={enableAnimation && !isDragging}
                enableEditMode={enableEditMode}
                plugin={plugin}
                app={app}
                positional={isGrid}
            />
        ) : (
            <ButtonItem
                key={button.id}
                button={button}
                category={category}
                index={index}
                displayStyle={displayStyle}
                enableAnimation={enableAnimation}
                enableEditMode={enableEditMode}
                plugin={plugin}
                app={app}
            />
        );

    if (isGrid && gridSlots) {
        // Empty cells stay in the DOM in every mode so positions never shift;
        // only their chrome is mode-dependent.
        const showSlotOutlines = sortableEnabled || enableEditMode;
        const gridClassName = [
            contentClass,
            'ocap-palette-grid',
            showSlotOutlines && 'ocap-palette-grid--managed',
        ]
            .filter(Boolean)
            .join(' ');

        const cells = gridSlots.map((button, slot) =>
            button ? (
                // The live drag state already shows the post-drop arrangement,
                // so the target cell is usually filled by then — it still gets
                // the target ring so "this is where it lands" stays explicit.
                <div
                    className={[
                        'ocap-grid-slot',
                        'ocap-grid-slot--filled',
                        dropTargetSlot === slot && 'ocap-grid-slot--drop-target',
                    ]
                        .filter(Boolean)
                        .join(' ')}
                    key={`slot-${slot}`}
                    data-slot={slot}
                >
                    {renderButton(button, slot)}
                </div>
            ) : (
                <GridSlotCell
                    key={`slot-${slot}`}
                    categoryId={category.id}
                    slot={slot}
                    droppableEnabled={sortableEnabled}
                    isDropTarget={dropTargetSlot === slot}
                    showOutline={showSlotOutlines}
                />
            )
        );

        const overflowSection = gridOverflow.length > 0 && (
            <div className="ocap-palette-grid-overflow">
                {gridOverflow.map((button, index) => renderButton(button, index))}
            </div>
        );

        const body = (
            <div
                ref={setRefs}
                className={gridClassName}
                style={{ '--ocap-grid-columns': GRID_COLUMNS } as React.CSSProperties}
            >
                {cells}
            </div>
        );

        return (
            <>
                {sortableEnabled ? (
                    <SortableContext
                        items={gridSlots
                            .filter((b): b is ButtonConfig => b !== null)
                            .map((b) => b.id)}
                        // A palette is positional: no sliding preview, the
                        // highlighted target slot shows where the drop lands.
                        strategy={NO_SORT_TRANSFORM}
                    >
                        {body}
                    </SortableContext>
                ) : (
                    body
                )}
                {overflowSection}
                {enableEditMode && !isDragging && (
                    <div className="ocap-palette-grid-actions">{children}</div>
                )}
            </>
        );
    }

    const buttonIds = orderedButtons.map((b) => b.id);
    const renderButtons = () => orderedButtons.map((button, index) => renderButton(button, index));

    if (!sortableEnabled) {
        return (
            <div ref={setNodeRef} className={contentClass}>
                {orderedButtons.length === 0 ? (
                    showDragEmptySlot ? (
                        <ButtonDragEmptySlot displayStyle={displayStyle} />
                    ) : (
                        children
                    )
                ) : (
                    <>
                        {renderButtons()}
                        {children}
                    </>
                )}
            </div>
        );
    }

    return (
        <div ref={setRefs} className={contentClass}>
            <SortableContext items={buttonIds} strategy={rectSortingStrategy}>
                {orderedButtons.length === 0 ? (
                    showDragEmptySlot ? (
                        <ButtonDragEmptySlot displayStyle={displayStyle} />
                    ) : null
                ) : (
                    renderButtons()
                )}
            </SortableContext>
            {!isDragging && children}
        </div>
    );
};
