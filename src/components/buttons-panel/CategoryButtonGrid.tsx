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
import { VariantSelector } from '@/components/buttons-panel/VariantSelector';
import { GRID_COLUMNS, isGridCategory } from '@/utils/categoryGrid';
import {
    useCategoryVariants,
    useGridViewResolution,
} from '@/contexts/CategoryVariantContext';
import {
    isDynamicCategory,
    resolveDynamicCategoryVariant,
} from '@/utils/categoryVariants';
import { useOCAPContext } from '@/hooks/useOCAPContext';
import { useButtonCreation } from '@/hooks/useButtonCreation';
import { useSlotFileDrop } from '@/hooks/useSlotFileDrop';
import type { ContextStatus } from '@/components/shared/ContextStatusBadge';

/**
 * Sorting strategy for the grid: never translate anything.
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
    const isDynamic = isDynamicCategory(category);
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

    // --- Dynamic category variants ----------------------------------------
    // The resolution decides which grid the category shows: the selected
    // variant in the management modes, the first matching trigger (or the
    // fallback) in locked mode. A static grid category always shows its one
    // grid.
    const { manageable, selection, selectVariant } = useCategoryVariants();
    const resolution = useGridViewResolution(category);
    const ocapContext = useOCAPContext();

    // Creating a tool is a property of the CELL, not of the category: the slot
    // the user points at already says where the tool goes, so neither entry
    // point has to ask for a position afterwards. Both resolve their target
    // variant from the same (normalized) selection the grid renders from.
    const { createButton } = useButtonCreation();
    const { canAcceptFileDrag, dropFileOnSlot } = useSlotFileDrop();
    const selectionEntry = isDynamic ? (selection[category.id] ?? null) : null;
    const runtimeResolution = React.useMemo(
        () =>
            isDynamic
                ? resolveDynamicCategoryVariant(category, ocapContext)
                : { variant: null, reason: 'none' as const },
        [isDynamic, category, ocapContext]
    );

    /**
     * Grid layout: slot occupancy of all GRID_SLOT_COUNT cells. During a drag
     * this comes from the live drag state so the preview is positional too;
     * otherwise it is the resolved grid. An empty slot simply stays empty —
     * which is the whole point of the grid: positions never shift.
     */
    const gridSlots = React.useMemo(() => {
        if (!isGrid) return null;
        if (sortableEnabled && buttonDrag) {
            return buttonDrag.getGridSlotButtons(category);
        }
        return resolution.slots;
    }, [isGrid, sortableEnabled, buttonDrag, category, resolution]);

    /** Buttons that could not be placed (corrupt data); never dropped. */
    const gridOverflow = isGrid ? resolution.overflow : [];

    const dropTargetSlot =
        buttonDrag?.dropTargetSlot?.categoryId === category.id
            ? buttonDrag.dropTargetSlot.slot
            : null;

    const renderButton = (
        button: ButtonConfig,
        index: number,
        contextStatus?: ContextStatus | 'none'
    ) =>
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
                contextStatus={contextStatus}
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
                contextStatus={contextStatus}
            />
        );

    if (isGrid && gridSlots) {
        // Empty cells stay in the DOM in every mode so positions never shift;
        // only their chrome is mode-dependent. There is one management mode
        // (edit), so one chrome class: `--managed`.
        const showSlotOutlines = sortableEnabled || enableEditMode;

        const gridClassName = [
            contentClass,
            'ocap-palette-grid',
            showSlotOutlines && 'ocap-palette-grid--managed',
        ]
            .filter(Boolean)
            .join(' ');

        // Creation affordances belong to empty cells in edit mode only, and
        // they vanish while a button drag is in flight (the live preview is
        // then what the cell has to show). A full 4x4 grid therefore offers no
        // `+` at all — there is no way to aim a 17th tool at it.
        const creationEnabled = enableEditMode && !isDragging;

        // Every cell is the same keyed component whether filled or empty, so
        // the 16 droppable cell nodes survive variant switches (see
        // GridSlotCell). The target cell keeps its ring even when the live
        // preview already fills it — "this is where it lands" stays explicit.
        const cells = gridSlots.map((button, slot) => (
            <GridSlotCell
                key={`slot-${slot}`}
                categoryId={category.id}
                slot={slot}
                droppableEnabled={sortableEnabled}
                isDropTarget={dropTargetSlot === slot}
                showOutline={showSlotOutlines}
                onCreate={
                    creationEnabled
                        ? () => createButton(category, undefined, slot)
                        : undefined
                }
                fileDrop={
                    creationEnabled
                        ? {
                              canAccept: canAcceptFileDrag,
                              onDrop: (dataTransfer) =>
                                  dropFileOnSlot(category, slot, dataTransfer),
                          }
                        : undefined
                }
            >
                {button ? renderButton(button, slot, 'none') : null}
            </GridSlotCell>
        ));

        const overflowSection = gridOverflow.length > 0 && (
            <div className="ocap-palette-grid-overflow">
                {gridOverflow.map((button, index) => renderButton(button, index, 'none'))}
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

        const sortableIds = gridSlots
            .map((button) => button?.id ?? null)
            .filter((id): id is string => id !== null);

        return (
            <>
                {manageable && isDynamic && (
                    <VariantSelector
                        category={category}
                        selectedVariantId={selectionEntry?.current ?? null}
                        previousVariantId={selectionEntry?.previous ?? null}
                        runtime={runtimeResolution}
                        onSelect={(variantId) => selectVariant(category.id, variantId)}
                    />
                )}
                {sortableEnabled ? (
                    <SortableContext
                        items={sortableIds}
                        // A grid is positional: no sliding preview, the
                        // highlighted target slot shows where the drop lands.
                        strategy={NO_SORT_TRANSFORM}
                    >
                        {body}
                    </SortableContext>
                ) : (
                    body
                )}
                {overflowSection}
                {/* No global "Add button" entry under a grid: the position is
                    part of the gesture now, and a button created without one
                    would have to guess a slot. `children` (the callers' add
                    entry) is therefore deliberately not rendered here — flow
                    categories below still use it. */}
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
