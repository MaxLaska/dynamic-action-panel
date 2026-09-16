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
import { PaletteLayerSelector } from '@/components/buttons-panel/PaletteLayerSelector';
import { GRID_COLUMNS, isGridCategory } from '@/utils/categoryGrid';
import {
    selectedLayerOf,
    usePaletteLayers,
    usePaletteResolution,
} from '@/contexts/PaletteLayerContext';
import { findContextProfile, selectActiveProfile } from '@/utils/paletteLayers';
import { useOCAPContext } from '@/hooks/useOCAPContext';
import type { ContextStatus } from '@/components/shared/ContextStatusBadge';
import { t, tWithParams } from '@/utils/i18n';

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

    // --- Palette context layers -------------------------------------------
    // The resolution decides which layer the grid shows: base/pinned plus the
    // selected context profile in the management modes, base plus the first
    // matching profile in locked mode.
    const { manageable, selection, selectLayer } = usePaletteLayers();
    const resolution = usePaletteResolution(category);
    const ocapContext = useOCAPContext();
    const selectedLayerId = selectedLayerOf(category, selection);
    const matchingProfile = React.useMemo(
        () => (isGrid ? selectActiveProfile(category, ocapContext) : null),
        [isGrid, category, ocapContext]
    );

    /**
     * Grid layout: slot occupancy of all GRID_SLOT_COUNT cells. During a drag
     * this comes from the live drag state so the preview is positional too;
     * otherwise it is the resolved layer. A tool that is not part of the layer
     * on screen simply leaves its slot empty — which is the whole point of the
     * palette: positions never shift.
     */
    const gridSlots = React.useMemo(() => {
        if (!isGrid) return null;
        if (sortableEnabled && buttonDrag) {
            return buttonDrag.getGridSlotButtons(category);
        }
        return resolution.slots.map((slot) => slot.button);
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
        contextStatus?: ContextStatus
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
        // only their chrome is mode-dependent.
        const showSlotOutlines = sortableEnabled || enableEditMode;
        // The layer currently on screen: base/pinned, or a context profile
        // (selected by the user in management modes, decided by the context in
        // locked mode).
        const layerIsBase = resolution.activeProfileId === null;
        // A base tool inside a context layer is shown for orientation but
        // belongs to the base layer, so it is locked here.
        const lockedInLayer = (slot: number) =>
            manageable && !layerIsBase && resolution.slots[slot]?.pinned === true;

        const gridClassName = [
            contentClass,
            'ocap-palette-grid',
            showSlotOutlines && 'ocap-palette-grid--managed',
            !layerIsBase && 'ocap-palette-grid--context-layer',
        ]
            .filter(Boolean)
            .join(' ');

        const cells = gridSlots.map((button, slot) => {
            const meta = resolution.slots[slot];
            if (button) {
                const isBaseTool = layerIsBase || meta?.pinned === true;
                const locked = lockedInLayer(slot);

                // A pinned base tool inside a context layer keeps a registered
                // (but refusing) droppable, so a drop aimed at it is rejected
                // explicitly instead of falling through to the palette's
                // background container.
                if (locked) {
                    return (
                        <GridSlotCell
                            key={`slot-${slot}`}
                            categoryId={category.id}
                            slot={slot}
                            droppableEnabled={sortableEnabled}
                            isDropTarget={false}
                            showOutline={showSlotOutlines}
                            blocked
                            locked
                        >
                            <ButtonItem
                                button={button}
                                category={category}
                                index={slot}
                                displayStyle={displayStyle}
                                enableAnimation={false}
                                enableEditMode={false}
                                plugin={plugin}
                                app={app}
                                contextStatus="persistent"
                                layerLocked
                            />
                        </GridSlotCell>
                    );
                }

                // The live drag state already shows the post-drop arrangement,
                // so the target cell is usually filled by then — it still gets
                // the target ring so "this is where it lands" stays explicit.
                return (
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
                        {renderButton(button, slot, isBaseTool ? 'persistent' : 'contextual')}
                    </div>
                );
            }
            return (
                <GridSlotCell
                    key={`slot-${slot}`}
                    categoryId={category.id}
                    slot={slot}
                    droppableEnabled={sortableEnabled}
                    isDropTarget={dropTargetSlot === slot}
                    showOutline={showSlotOutlines}
                    blocked={meta?.blocked === true}
                    reservedBy={meta?.reservedBy}
                />
            );
        });

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

        // Only tools of the layer being edited are draggable; base tools shown
        // inside a context layer are not part of its sortable set.
        const sortableIds = gridSlots
            .map((button, slot) => (button && !lockedInLayer(slot) ? button.id : null))
            .filter((id): id is string => id !== null);

        const selectedProfile = layerIsBase
            ? null
            : findContextProfile(category, resolution.activeProfileId!);

        return (
            <>
                {manageable && (
                    <>
                        <PaletteLayerSelector
                            category={category}
                            selectedLayerId={selectedLayerId}
                            matchingProfileId={matchingProfile?.id ?? null}
                            onSelect={(layerId) => selectLayer(category.id, layerId)}
                        />
                        <div className="ocap-layer-hint">
                            {layerIsBase
                                ? t('palette_hint_base')
                                : tWithParams('palette_hint_context', {
                                      name: selectedProfile?.name ?? '',
                                  })}
                        </div>
                    </>
                )}
                {sortableEnabled ? (
                    <SortableContext
                        items={sortableIds}
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
