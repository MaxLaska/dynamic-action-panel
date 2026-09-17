import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    DndContext,
    DragOverlay,
    MeasuringStrategy,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragOverEvent,
    type DragStartEvent,
} from '@dnd-kit/core';
import { ScrollAwarePointerSensor } from '@/sensors/ScrollAwarePointerSensor';
import { ScrollAwareTouchSensor } from '@/sensors/ScrollAwareTouchSensor';
import {
    MOBILE_LONG_PRESS_DELAY_MS,
    SCROLL_CANCEL_DISTANCE_PX,
} from '@/utils/touchScrollActivation';
import { isCoarsePointerDevice } from '@/utils/isCoarsePointerDevice';
import { setPanelTouchDragLock } from '@/utils/touchDragLock';
import { Notice, setIcon, type App } from 'obsidian';
import type { ButtonConfig, CategoryConfig } from '@/types';
import type { ButtonsPanelPlugin } from '@/types/plugin';
import { usePluginContext } from '@/contexts/PluginContext';
import { SimpleButton } from '@/components/button/Button';
import { CategoryListDragPreview } from '@/components/buttons-panel/CategoryListDragPreview';
import { CategoryFolderTile } from '@/components/buttons-panel/CategoryFolderTile';
import {
    applyDragOverToItems,
    buildButtonDragItems,
    buildContainerLayouts,
    collectButtonsById,
    findContainerForButtonId,
    getGridSlotButtonsFromAllCategories,
    getOrderedButtonsFromAllCategories,
    resolveGridDropOutcome,
    itemsShallowEqual,
    parseSlotDroppableId,
    resolveOverContainerId,
    type ButtonDragItems,
} from '@/utils/buttonDragItems';
import {
    getCategoryLayout,
    isValidSlotIndex,
    placeButtonsOnGrid,
    type CategoryLayout,
} from '@/utils/categoryGrid';
import {
    applySlotIdsToGridCategory,
    type ResolvedGridView,
} from '@/utils/categoryVariants';
import type { VariantSelectionMap } from '@/context/panelProjection';
import {
    applyCategoryDragOver,
    buildCategoryDragIds,
    categoryIdsEqual,
    categorySortableId,
    getOrderedCategoriesFromIds,
    parseCategorySortableId,
} from '@/utils/categoryDragItems';
import {
    createPanelDragCollisionDetection,
    type CategoryDragLayout,
} from '@/utils/panelDragCollision';
import { snapCenterToCursor } from '@/utils/dndModifiers';
import { PANEL_AUTO_SCROLL_OPTIONS } from '@/utils/panelAutoScroll';
import { t } from '@/utils/i18n';

/**
 * Desktop mouse: start dragging after a small deliberate movement instead of a
 * long press. No `tolerance` is configured on purpose — for a distance
 * constraint dnd-kit checks tolerance first and *cancels* the pending drag when
 * it is exceeded, which would abort exactly the fast drag gestures this enables.
 */
const DESKTOP_DRAG_ACTIVATION_DISTANCE_PX = 4;

/**
 * Debug infrastructure for DnD lifecycle investigations: set
 * `window.__OCAP_DND_DEBUG = true` in the developer console to trace every
 * dnd-kit lifecycle transition. A pointerdown without a `pending` log means
 * the activation guard rejected the attempt; `pending` without `dragStart`
 * after movement means the sensor died before onStart. Zero cost while the
 * flag is off — callers must check `isDndDebug()` before building log args.
 */
function isDndDebug(): boolean {
    return (window as unknown as { __OCAP_DND_DEBUG?: boolean }).__OCAP_DND_DEBUG === true;
}

function dndDebug(...args: unknown[]): void {
    if (isDndDebug()) {
        console.debug('[OCAP-DND]', ...args);
    }
}
/** 标签视图：悬停目标标签满此时长后才视为可放置位置 */
const CATEGORY_TAB_DROP_HOVER_MS = 400;

export interface ButtonDragContextValue {
    enabled: boolean;
    isDragging: boolean;
    activeButtonId: string | null;
    getOrderedButtons: (category: CategoryConfig) => ButtonConfig[];
    /** Live slot occupancy of a grid category (index = slot, null = empty). */
    getGridSlotButtons: (category: CategoryConfig) => (ButtonConfig | null)[];
    /** Slot the pointer currently targets, for the drop highlight. */
    dropTargetSlot: { categoryId: string; slot: number } | null;
    registerCategoryHover: (handler: ((categoryId: string) => void) | null) => void;
}

export interface CategoryDragContextValue {
    enabled: boolean;
    isDragging: boolean;
    activeCategoryId: string | null;
    categoryIds: string[];
    /** 标签视图：悬停满 0.4s 后确认的目标分类 id（用于高亮） */
    categoryTabDropTargetId: string | null;
    getOrderedCategories: (categories: CategoryConfig[]) => CategoryConfig[];
    setListCategoryOpenById: (openByCategoryId: Map<string, boolean>) => void;
    getListCategoryOpen: (categoryId: string) => boolean;
}

const ButtonDragContext = createContext<ButtonDragContextValue | null>(null);
const CategoryDragContext = createContext<CategoryDragContextValue | null>(null);

const disabledButtonContextValue: ButtonDragContextValue = {
    enabled: false,
    isDragging: false,
    activeButtonId: null,
    getOrderedButtons: (category) => [...category.buttons].sort((a, b) => a.order - b.order),
    getGridSlotButtons: (category) => placeButtonsOnGrid(category.buttons).slots,
    dropTargetSlot: null,
    registerCategoryHover: () => {},
};

const disabledCategoryContextValue: CategoryDragContextValue = {
    enabled: false,
    isDragging: false,
    activeCategoryId: null,
    categoryIds: [],
    categoryTabDropTargetId: null,
    getOrderedCategories: (categories) =>
        [...categories].sort((a, b) => a.order - b.order),
    setListCategoryOpenById: () => {},
    getListCategoryOpen: () => true,
};

export type CategoryDragOverlayVariant = 'list' | 'tabs' | 'folder';

interface ButtonDragProviderProps {
    categories: CategoryConfig[];
    /**
     * Resolved grid (the selected variant, or the static grid) per grid
     * category. The drag state mirrors exactly what is on screen, so a drag in
     * one variant can never touch another one.
     */
    gridViews?: ReadonlyMap<string, ResolvedGridView>;
    /** Variant each dynamic category is being edited on; decides where a
     * dropped tool lands. */
    variantSelection?: VariantSelectionMap;
    enabled: boolean;
    displayStyle: 'icon_left' | 'icon_top';
    enableAnimation: boolean;
    categoryDragOverlayVariant?: CategoryDragOverlayVariant;
    categoryDragLayout?: CategoryDragLayout;
    folderShowBtnCount?: boolean;
    children: React.ReactNode;
}

/**
 * Grid cell the pointer is currently over, for the drop highlight: either an
 * empty slot droppable or the cell of the button being hovered. Returns null
 * for flow containers and for area zones, which have no addressable cell, and
 * for targets this particular drag would be rejected on — the ring must only
 * promise landings that actually happen.
 */
function resolveGridDropTarget(
    activeId: string,
    overId: string,
    items: ButtonDragItems,
    layouts: Record<string, CategoryLayout>
): { categoryId: string; slot: number } | null {
    let target: { categoryId: string; slot: number } | null = null;

    const slotTarget = parseSlotDroppableId(overId);
    if (slotTarget) {
        target = layouts[slotTarget.categoryId] === 'grid' ? slotTarget : null;
    } else {
        const categoryId = findContainerForButtonId(overId, items);
        if (categoryId && layouts[categoryId] === 'grid') {
            const slot = items[categoryId]!.indexOf(overId);
            target = isValidSlotIndex(slot) ? { categoryId, slot } : null;
        }
    }

    if (!target) {
        return null;
    }

    // Flow -> grid only accepts empty slots (see applyDragOverToItems), so an
    // occupied cell must not advertise itself as a landing spot.
    const activeContainer = findContainerForButtonId(activeId, items);
    if (
        activeContainer &&
        activeContainer !== target.categoryId &&
        layouts[activeContainer] !== 'grid' &&
        (items[target.categoryId]?.[target.slot] ?? null) !== null
    ) {
        return null;
    }

    return target;
}

/** 统一面板拖拽：按钮与分类共用一个 DndContext */
export const ButtonDragProvider: React.FC<ButtonDragProviderProps> = ({
    categories,
    gridViews,
    variantSelection,
    enabled,
    displayStyle,
    enableAnimation,
    categoryDragOverlayVariant = 'list',
    categoryDragLayout = 'vertical',
    folderShowBtnCount = true,
    children,
}) => {
    const { plugin, app } = usePluginContext();
    const [items, setItems] = useState<ButtonDragItems>(() =>
        buildButtonDragItems(categories, gridViews)
    );
    const [categoryIds, setCategoryIds] = useState<string[]>(() =>
        buildCategoryDragIds(categories)
    );
    const [activeButtonId, setActiveButtonId] = useState<string | null>(null);
    const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
    /** 标签视图：锁定拖拽预览宽度，避免脱离 tab-bar 后换行导致字形变化 */
    const [categoryTabOverlayWidth, setCategoryTabOverlayWidth] = useState<number | null>(
        null
    );
    const [categoryTabDropTargetId, setCategoryTabDropTargetId] = useState<string | null>(
        null
    );
    const [categoryListDragOpen, setCategoryListDragOpen] = useState(true);
    /** Grid palette: slot the pointer currently targets (drop highlight). */
    const [dropTargetSlot, setDropTargetSlot] = useState<{
        categoryId: string;
        slot: number;
    } | null>(null);
    const itemsRef = useRef(items);
    /**
     * Drag state at the moment the CURRENT drag started. Every drag-over
     * preview is computed from this baseline, never cumulatively from the
     * previous preview: crossing an occupied cell on the way to the target
     * must not leave a trail of intermediate swaps behind — releasing on a
     * cell means exactly "active moves there, its occupant takes the vacated
     * slot", nothing else moves (see DECISIONS.md).
     */
    const dragStartItemsRef = useRef<ButtonDragItems | null>(null);
    /**
     * Settings the last drop was committed against.
     *
     * Clearing `activeButtonId` re-enables the rebuild effect below one or
     * more renders BEFORE the saved settings reach this component, so the
     * effect would rebuild the PRE-drop arrangement from still-stale props and
     * flash the dropped tool back into its old slot for a frame. While the
     * props are still these exact objects the drop result is the newer truth;
     * any later settings object releases the guard, so a failed save or an
     * external change can never leave the state frozen.
     */
    const committedPropsRef = useRef<{
        categories: CategoryConfig[];
        gridViews: ReadonlyMap<string, ResolvedGridView> | undefined;
    } | null>(null);
    const categoryIdsRef = useRef(categoryIds);
    const categoryHoverRef = useRef<((categoryId: string) => void) | null>(null);
    const lastNotifiedHoverContainerRef = useRef<string | null>(null);
    const dragOverFrameRef = useRef<number | null>(null);
    const pendingDragOverRef = useRef<{
        activeId: string;
        overId: string;
        /** The target names a cell/position this drag can actually land on. */
        addressable: boolean;
    } | null>(null);
    const lastAppliedDragOverRef = useRef<{ activeId: string; overId: string } | null>(null);
    const lastAppliedCategoryDragOverRef = useRef<{ activeId: string; overId: string } | null>(
        null
    );
    const listCategoryOpenByIdRef = useRef<Map<string, boolean>>(new Map());
    const categoryTabDragStartIdsRef = useRef<string[]>([]);
    /** 列表视图：拖拽开始时的分类顺序，用于对比是否变更 */
    const categoryListDragStartIdsRef = useRef<string[]>([]);
    const categoryTabHoverOverIdRef = useRef<string | null>(null);
    const categoryTabCommittedOverIdRef = useRef<string | null>(null);
    const categoryTabHoverTimerRef = useRef<number | null>(null);
    /**
     * 文件夹模式：拖出展开的文件夹外松手时取消拖拽 → 阻止 handleDragEnd 错误持久化
     *
     * That flow cancels mid-drag and dnd-kit still delivers a drag end, which
     * consumes the flag. A keyboard cancel (Escape) delivers NO drag end, so
     * the flag has to be cleared when the next drag starts — otherwise that
     * drag's drop is silently discarded.
     */
    const dragForceCancelledRef = useRef(false);

    itemsRef.current = items;
    categoryIdsRef.current = categoryIds;

    const isCategoryDragActive = activeCategoryId !== null;
    const isButtonDragActive = activeButtonId !== null;

    const collisionDetection = useMemo(
        () => createPanelDragCollisionDetection(categoryDragLayout),
        [categoryDragLayout]
    );

    /** Per-container layout, so index means order (flow) or slot (grid). */
    const containerLayouts = useMemo(() => buildContainerLayouts(categories), [categories]);
    const containerLayoutsRef = useRef(containerLayouts);
    containerLayoutsRef.current = containerLayouts;

    const variantSelectionRef = useRef(variantSelection);
    variantSelectionRef.current = variantSelection;

    const gridViewsRef = useRef(gridViews);
    gridViewsRef.current = gridViews;

    /** Drag state matching the stored data for the grids currently on screen. */
    const buildBaselineItems = useCallback(
        () => buildButtonDragItems(categories, gridViewsRef.current),
        [categories]
    );

    const cancelDragOverFrame = useCallback(() => {
        if (dragOverFrameRef.current !== null) {
            cancelAnimationFrame(dragOverFrameRef.current);
            dragOverFrameRef.current = null;
        }
        pendingDragOverRef.current = null;
    }, []);

    const useCoarseTouchOnly = isCoarsePointerDevice();

    const sensors = useSensors(
        ...(useCoarseTouchOnly
            ? []
            : [
                  useSensor(ScrollAwarePointerSensor, {
                      activationConstraint: {
                          distance: DESKTOP_DRAG_ACTIVATION_DISTANCE_PX,
                      },
                  }),
              ]),
        useSensor(ScrollAwareTouchSensor, {
            activationConstraint: {
                delay: MOBILE_LONG_PRESS_DELAY_MS,
                tolerance: SCROLL_CANCEL_DISTANCE_PX,
            },
        })
    );

    useEffect(() => {
        if (activeButtonId) {
            dndDebug('items-rebuild skipped (drag active)', activeButtonId);
            return;
        }
        const committed = committedPropsRef.current;
        if (committed) {
            if (
                committed.categories === categories &&
                committed.gridViews === gridViews
            ) {
                dndDebug('items-rebuild skipped (drop newer than settings)');
                return;
            }
            committedPropsRef.current = null;
        }
        const next = buildButtonDragItems(categories, gridViews);
        setItems((prev) => {
            const same = itemsShallowEqual(prev, next);
            if (isDndDebug()) {
                dndDebug('items-rebuild', same ? 'unchanged' : 'changed', JSON.stringify(next));
            }
            return same ? prev : next;
        });
    }, [categories, gridViews, activeButtonId, enabled]);

    useEffect(() => {
        if (activeCategoryId) return;
        const next = buildCategoryDragIds(categories);
        setCategoryIds((prev) => (categoryIdsEqual(prev, next) ? prev : next));
    }, [categories, activeCategoryId, enabled]);

    useEffect(() => () => cancelDragOverFrame(), [cancelDragOverFrame]);

    useEffect(() => {
        if (isButtonDragActive || isCategoryDragActive) {
            setPanelTouchDragLock(true);
            return;
        }
        setPanelTouchDragLock(false);
    }, [isButtonDragActive, isCategoryDragActive]);

    useEffect(() => () => setPanelTouchDragLock(false), []);

    const registerCategoryHover = useCallback(
        (handler: ((categoryId: string) => void) | null) => {
            categoryHoverRef.current = handler;
        },
        []
    );

    const getOrderedButtons = useCallback(
        (category: CategoryConfig) =>
            getOrderedButtonsFromAllCategories(category, categories, items),
        [categories, items]
    );

    const getGridSlotButtons = useCallback(
        (category: CategoryConfig) =>
            getGridSlotButtonsFromAllCategories(category, categories, items),
        [categories, items]
    );

    const getOrderedCategories = useCallback(
        (source: CategoryConfig[]) => getOrderedCategoriesFromIds(source, categoryIds),
        [categoryIds]
    );

    const setListCategoryOpenById = useCallback((openByCategoryId: Map<string, boolean>) => {
        listCategoryOpenByIdRef.current = openByCategoryId;
    }, []);

    const getListCategoryOpen = useCallback((categoryId: string) => {
        return listCategoryOpenByIdRef.current.get(categoryId) ?? true;
    }, []);

    const activeButton = useMemo(() => {
        if (!activeButtonId) return null;
        // Palette tools can live in a context-profile layer, not only in
        // `category.buttons`, so the lookup spans every layer.
        return collectButtonsById(categories).get(activeButtonId) ?? null;
    }, [activeButtonId, categories]);

    const activeButtonCategory = useMemo(() => {
        if (!activeButtonId) return null;
        const containerId = findContainerForButtonId(activeButtonId, items);
        return categories.find((c) => c.id === containerId) ?? null;
    }, [activeButtonId, categories, items]);

    const activeCategory = useMemo(() => {
        if (!activeCategoryId) return null;
        return categories.find((c) => c.id === activeCategoryId) ?? null;
    }, [activeCategoryId, categories]);

    const notifyCategoryHover = useCallback((categoryId: string) => {
        if (lastNotifiedHoverContainerRef.current === categoryId) return;
        lastNotifiedHoverContainerRef.current = categoryId;
        categoryHoverRef.current?.(categoryId);
    }, []);

    const resetButtonDragHoverState = useCallback(() => {
        lastNotifiedHoverContainerRef.current = null;
        lastAppliedDragOverRef.current = null;
        setDropTargetSlot(null);
        cancelDragOverFrame();
    }, [cancelDragOverFrame]);

    const clearCategoryTabHoverTimer = useCallback(() => {
        if (categoryTabHoverTimerRef.current !== null) {
            window.clearTimeout(categoryTabHoverTimerRef.current);
            categoryTabHoverTimerRef.current = null;
        }
    }, []);

    const resetCategoryTabDragHoverState = useCallback(() => {
        clearCategoryTabHoverTimer();
        categoryTabHoverOverIdRef.current = null;
        categoryTabCommittedOverIdRef.current = null;
        setCategoryTabDropTargetId(null);
    }, [clearCategoryTabHoverTimer]);

    const scheduleCategoryTabDropTarget = useCallback(
        (overSortableId: string) => {
            if (categoryTabHoverOverIdRef.current === overSortableId) {
                return;
            }
            clearCategoryTabHoverTimer();
            categoryTabHoverOverIdRef.current = overSortableId;
            categoryTabCommittedOverIdRef.current = null;
            setCategoryTabDropTargetId(null);

            categoryTabHoverTimerRef.current = window.setTimeout(() => {
                categoryTabHoverTimerRef.current = null;
                categoryTabCommittedOverIdRef.current = overSortableId;
                const categoryId = parseCategorySortableId(overSortableId);
                setCategoryTabDropTargetId(categoryId);
            }, CATEGORY_TAB_DROP_HOVER_MS);
        },
        [clearCategoryTabHoverTimer]
    );

    useEffect(
        () => () => {
            clearCategoryTabHoverTimer();
        },
        [clearCategoryTabHoverTimer]
    );

    const persistItems = useCallback(
        async (finalItems: ButtonDragItems, pluginInstance: ButtonsPanelPlugin) => {
            const storedCategories = pluginInstance.settings.categories;
            // Buttons of every variant, so a drag state referencing a
            // variant's tool resolves just like any other.
            const allButtons = collectButtonsById(storedCategories);
            const selection = variantSelectionRef.current ?? {};

            // Every button the drag state accounts for. Buttons outside this
            // set were never part of the drag (e.g. grid overflow from
            // hand-edited data) and must stay in their category instead of
            // being dropped by the rewrite below.
            const placedIds = new Set<string>();
            for (const ids of Object.values(finalItems)) {
                for (const id of ids) {
                    if (id !== null) placedIds.add(id);
                }
            }

            pluginInstance.settings.categories = storedCategories.map((category) => {
                const ids = finalItems[category.id];
                if (!ids) return category;

                if (getCategoryLayout(category) === 'grid') {
                    // A grid writes back into the ONE grid on screen: the
                    // index IS the slot, tools arriving from another category
                    // join the selected variant (or the static grid), and
                    // every off-screen variant is left completely untouched.
                    return applySlotIdsToGridCategory(
                        category,
                        ids,
                        allButtons,
                        selection[category.id] ?? null,
                        placedIds
                    );
                }

                const nextButtons: ButtonConfig[] = [];
                for (const id of ids) {
                    if (id === null) continue;
                    const button = allButtons.get(id);
                    if (!button) continue;
                    const { slot: _slot, ...rest } = button;
                    nextButtons.push(rest);
                }
                // Preserve buttons of this category that no container claimed.
                for (const button of category.buttons) {
                    if (!placedIds.has(button.id)) {
                        nextButtons.push(button);
                    }
                }
                return {
                    ...category,
                    buttons: nextButtons.map((button, index) => ({
                        ...button,
                        order: index,
                    })),
                };
            });

            await pluginInstance.saveSettings();
            activeDocument.dispatchEvent(new CustomEvent('buttons-panel-refresh'));
        },
        []
    );

    const persistCategoryOrder = useCallback(
        async (finalIds: string[], pluginInstance: ButtonsPanelPlugin) => {
            const orderedIds = finalIds
                .map((id) => parseCategorySortableId(id))
                .filter((id): id is string => id !== null);

            const byId = new Map(
                pluginInstance.settings.categories.map((c) => [c.id, c])
            );
            const reordered: CategoryConfig[] = [];
            for (const id of orderedIds) {
                const cat = byId.get(id);
                if (cat) reordered.push(cat);
            }
            for (const cat of pluginInstance.settings.categories) {
                if (!reordered.some((c) => c.id === cat.id)) {
                    reordered.push(cat);
                }
            }

            pluginInstance.settings.categories = reordered;
            reordered.forEach((cat, idx) => {
                cat.order = idx;
            });

            await pluginInstance.saveSettings();
            activeDocument.dispatchEvent(new CustomEvent('buttons-panel-refresh'));
        },
        []
    );

    const flushButtonDragOver = useCallback(() => {
        dragOverFrameRef.current = null;
        const pending = pendingDragOverRef.current;
        pendingDragOverRef.current = null;
        if (!pending) return;

        const { activeId, overId, addressable } = pending;
        const last = lastAppliedDragOverRef.current;
        if (last?.activeId === activeId && last?.overId === overId) {
            return;
        }

        const prev = itemsRef.current;
        // Previews are computed from the drag-start baseline (see
        // dragStartItemsRef), so target resolution must read it as well.
        const base = dragStartItemsRef.current ?? prev;
        const hoverActiveContainer = findContainerForButtonId(activeId, base);
        const hoverOverContainer = resolveOverContainerId(overId, base);
        if (
            hoverActiveContainer &&
            hoverOverContainer &&
            hoverActiveContainer !== hoverOverContainer
        ) {
            notifyCategoryHover(hoverOverContainer);
        }

        dndDebug('dragOver', activeId, '->', overId, addressable ? 'apply' : 'hold');

        // A target without an addressable cell carries no drop position, so
        // the preview must not be recomputed: `applyDragOverToItems` reports
        // "nothing to do" by returning the input, and the input is the
        // drag-start baseline — committing it would put the dragged tool back
        // into its source slot for as long as the pointer stays there. The
        // preview keeps standing on the last cell the pointer really
        // addressed; `lastAppliedDragOverRef` is deliberately left pointing at
        // that cell so returning to it is a no-op.
        if (!addressable) {
            return;
        }

        const next = applyDragOverToItems(
            base,
            activeId,
            overId,
            containerLayoutsRef.current
        );
        lastAppliedDragOverRef.current = { activeId, overId };
        if (!itemsShallowEqual(next, prev)) {
            itemsRef.current = next;
            setItems(next);
        }
    }, [notifyCategoryHover]);

    const scheduleButtonDragOver = useCallback(
        (activeId: string, overId: string, addressable: boolean) => {
            pendingDragOverRef.current = { activeId, overId, addressable };
            if (dragOverFrameRef.current !== null) {
                return;
            }
            dragOverFrameRef.current = window.requestAnimationFrame(flushButtonDragOver);
        },
        [flushButtonDragOver]
    );


    const handleDragStart = useCallback(
        (event: DragStartEvent) => {
            const activeId = String(event.active.id);
            dndDebug('dragStart', activeId);
            dragForceCancelledRef.current = false;
            const categoryId = parseCategorySortableId(activeId);
            if (categoryId) {
                lastAppliedCategoryDragOverRef.current = null;
                if (categoryDragOverlayVariant === 'tabs') {
                    categoryTabDragStartIdsRef.current = [...categoryIdsRef.current];
                    resetCategoryTabDragHoverState();
                    const initial = event.active.rect.current.initial;
                    setCategoryTabOverlayWidth(initial?.width ?? null);
                } else {
                    categoryListDragStartIdsRef.current = [...categoryIdsRef.current];
                    setCategoryListDragOpen(getListCategoryOpen(categoryId));
                }
                setActiveCategoryId(categoryId);
                setActiveButtonId(null);
                return;
            }
            resetButtonDragHoverState();
            committedPropsRef.current = null;
            dragStartItemsRef.current = itemsRef.current;
            setActiveButtonId(activeId);
            setActiveCategoryId(null);
            setCategoryTabOverlayWidth(null);
        },
        [
            categoryDragOverlayVariant,
            getListCategoryOpen,
            resetButtonDragHoverState,
            resetCategoryTabDragHoverState,
        ]
    );

    const handleDragOver = useCallback(
        (event: DragOverEvent) => {
            const { active, over } = event;
            const activeId = String(active.id);

            if (parseCategorySortableId(activeId)) {
                if (!over || active.id === over.id) {
                    if (categoryDragOverlayVariant === 'tabs') {
                        clearCategoryTabHoverTimer();
                        categoryTabHoverOverIdRef.current = null;
                    }
                    return;
                }

                const overId = String(over.id);
                if (!parseCategorySortableId(overId)) return;

                if (categoryDragOverlayVariant === 'tabs') {
                    scheduleCategoryTabDropTarget(overId);
                    return;
                }

                const last = lastAppliedCategoryDragOverRef.current;
                if (last?.activeId === activeId && last?.overId === overId) {
                    return;
                }

                const prev = categoryIdsRef.current;
                const next = applyCategoryDragOver(prev, activeId, overId);
                lastAppliedCategoryDragOverRef.current = { activeId, overId };
                if (next === prev) return;

                categoryIdsRef.current = next;
                setCategoryIds(next);
                return;
            }

            if (!over || active.id === over.id) {
                // 指针离开按钮区（如磁贴区）：回退到拖拽开始时的位置
                if (!over) {
                    setDropTargetSlot(null);
                    const baseline = buildBaselineItems();
                    if (!itemsShallowEqual(baseline, itemsRef.current)) {
                        itemsRef.current = baseline;
                        setItems(baseline);
                        lastAppliedDragOverRef.current = null;
                    }
                }
                return;
            }
            const overIdStr = String(over.id);
            const base = dragStartItemsRef.current ?? itemsRef.current;
            // The gap between two grid cells, the grid background, a
            // title/tab zone: the pointer is over the grid but not over a
            // cell, so this frame carries no new drop position. Everything
            // visible has to hold — preview AND target ring — because the
            // pointer crosses a gap on its way between any two cells, and a
            // fallback there is exactly what made the source slot flicker.
            const addressable =
                resolveGridDropOutcome(
                    base,
                    activeId,
                    overIdStr,
                    containerLayoutsRef.current
                ) !== 'no-cell';
            // The hover notification still has to run (it opens the category
            // under the pointer), so the target is scheduled either way.
            scheduleButtonDragOver(activeId, overIdStr, addressable);
            if (!addressable) {
                return;
            }
            setDropTargetSlot(
                resolveGridDropTarget(
                    activeId,
                    overIdStr,
                    base,
                    containerLayoutsRef.current
                )
            );
        },
        [
            buildBaselineItems,
            categoryDragOverlayVariant,
            clearCategoryTabHoverTimer,
            scheduleButtonDragOver,
            scheduleCategoryTabDropTarget,
        ]
    );

    const handleDragEnd = useCallback(
        async (event: DragEndEvent) => {
            const { active, over } = event;
            const activeId = String(active.id);
            dndDebug('dragEnd', activeId, 'over:', over ? String(over.id) : null);

            if (parseCategorySortableId(activeId)) {
                // ... category drag end logic unchanged ...
                const isTabsVariant = categoryDragOverlayVariant === 'tabs';
                const baseline = isTabsVariant
                    ? categoryTabDragStartIdsRef.current
                    : categoryListDragStartIdsRef.current.length > 0
                      ? categoryListDragStartIdsRef.current
                      : buildCategoryDragIds(categories);

                let finalIds: string[];
                if (isTabsVariant) {
                    finalIds = baseline;
                    const committedOverId =
                        categoryTabCommittedOverIdRef.current ??
                        (categoryTabDropTargetId
                            ? categorySortableId(categoryTabDropTargetId)
                            : null);
                    if (committedOverId) {
                        finalIds = applyCategoryDragOver(baseline, activeId, committedOverId);
                    }
                } else {
                    // 列表/文件夹视图：以 dragOver 累积的 categoryIdsRef 为准（触屏松手时 over 常为 null）
                    finalIds = categoryIdsRef.current;
                    if (active && over && active.id !== over.id) {
                        const overId = String(over.id);
                        if (parseCategorySortableId(overId)) {
                            finalIds = applyCategoryDragOver(finalIds, activeId, overId);
                        }
                    }
                }

                categoryIdsRef.current = finalIds;
                setCategoryIds(finalIds);
                setActiveCategoryId(null);
                lastAppliedCategoryDragOverRef.current = null;
                categoryListDragStartIdsRef.current = [];
                setCategoryTabOverlayWidth(null);
                resetCategoryTabDragHoverState();
                setCategoryListDragOpen(true);

                if (!categoryIdsEqual(baseline, finalIds)) {
                    try {
                        await persistCategoryOrder(finalIds, plugin);
                    } catch (error) {
                        console.error('保存分类排序时出错:', error);
                        setCategoryIds(baseline);
                        categoryIdsRef.current = baseline;
                    }
                }
                return;
            }

            // Apply a still-pending drag-over synchronously instead of
            // discarding it: the release may happen before the scheduled
            // animation frame ran, and the preview must reflect the last
            // hovered target before the drop is finalized below.
            if (dragOverFrameRef.current !== null) {
                cancelAnimationFrame(dragOverFrameRef.current);
                dragOverFrameRef.current = null;
            }
            flushButtonDragOver();

            // 文件夹拖拽取消：跳过位置应用与持久化
            if (dragForceCancelledRef.current) {
                dragForceCancelledRef.current = false;
                setActiveButtonId(null);
                dragStartItemsRef.current = null;
                resetButtonDragHoverState();
                return;
            }

            // 碰撞检测返回空（如拖到磁贴区松手）→ 回退到原始位置
            if (!over) {
                const baseline = buildBaselineItems();
                itemsRef.current = baseline;
                setItems(baseline);
                setActiveButtonId(null);
                dragStartItemsRef.current = null;
                resetButtonDragHoverState();
                return;
            }

            // A release over the dragged tool itself means the pointer rests
            // on the PREVIEW position of that tool — the baseline-derived
            // preview already is the final arrangement, so nothing must be
            // recomputed (recomputing against the baseline would read the
            // tool's OLD slot and undo the move).
            if (active && over && String(over.id) !== activeId) {
                const overId = String(over.id);

                const base = dragStartItemsRef.current ?? itemsRef.current;
                const outcome = resolveGridDropOutcome(
                    base,
                    activeId,
                    overId,
                    containerLayoutsRef.current
                );

                // Released on a cell the grid rules refuse: a flow tool on an
                // occupied slot. The preview may already show the tool on the
                // last accepted cell it crossed — committing that would drop
                // the tool where the user never aimed. The whole drag is
                // therefore reverted and the refusal is explained.
                if (outcome === 'blocked') {
                    const baseline = buildBaselineItems();
                    itemsRef.current = baseline;
                    setItems(baseline);
                    setActiveButtonId(null);
                    dragStartItemsRef.current = null;
                    resetButtonDragHoverState();
                    new Notice(t('grid_drop_occupied'));
                    return;
                }

                // The final arrangement is computed from the drag-start
                // baseline: the release target is the only thing that counts,
                // cells crossed on the way must leave no trace.
                //
                // A `no-cell` release — the gap between two cells, the grid
                // background — names no position at all, so the preview
                // already IS the result. Recomputing it would read the
                // baseline back and silently undo a drag that looked finished.
                if (outcome === 'accept') {
                    const prev = itemsRef.current;
                    const next = applyDragOverToItems(
                        base,
                        activeId,
                        overId,
                        containerLayoutsRef.current
                    );
                    if (!itemsShallowEqual(next, prev)) {
                        itemsRef.current = next;
                        setItems(next);
                    }
                }
            }

            const finalItems = itemsRef.current;
            const baseline = buildBaselineItems();
            const changed = !itemsShallowEqual(baseline, finalItems);

            // The drop result outlives the props it was computed from until
            // the saved settings arrive (see committedPropsRef).
            committedPropsRef.current = changed
                ? { categories, gridViews: gridViewsRef.current }
                : null;
            setActiveButtonId(null);
            dragStartItemsRef.current = null;
            resetButtonDragHoverState();

            if (changed) {
                try {
                    await persistItems(finalItems, plugin);
                } catch (error) {
                    console.error('保存按钮排序时出错:', error);
                    committedPropsRef.current = null;
                    itemsRef.current = baseline;
                    setItems(baseline);
                }
            }
        },
        [
            buildBaselineItems,
            flushButtonDragOver,
            categories,
            categoryDragOverlayVariant,
            categoryTabDropTargetId,
            persistCategoryOrder,
            persistItems,
            plugin,
            resetButtonDragHoverState,
            resetCategoryTabDragHoverState,
        ]
    );

    const handleDragCancel = useCallback(() => {
        dndDebug('dragCancel');
        dragForceCancelledRef.current = true;
        cancelDragOverFrame();
        committedPropsRef.current = null;
        dragStartItemsRef.current = null;
        setActiveButtonId(null);
        setActiveCategoryId(null);
        lastAppliedCategoryDragOverRef.current = null;
        setCategoryTabOverlayWidth(null);
        resetCategoryTabDragHoverState();
        setCategoryListDragOpen(true);
        resetButtonDragHoverState();
        const buttonBaseline = buildBaselineItems();
        const categoryBaseline =
            categoryListDragStartIdsRef.current.length > 0
                ? categoryListDragStartIdsRef.current
                : categoryTabDragStartIdsRef.current.length > 0
                  ? categoryTabDragStartIdsRef.current
                  : buildCategoryDragIds(categories);
        categoryListDragStartIdsRef.current = [];
        itemsRef.current = buttonBaseline;
        categoryIdsRef.current = categoryBaseline;
        setItems(buttonBaseline);
        setCategoryIds(categoryBaseline);
    }, [
        buildBaselineItems,
        cancelDragOverFrame,
        categories,
        resetButtonDragHoverState,
        resetCategoryTabDragHoverState,
    ]);

    // 文件夹模式：拖出文件夹外松手时取消拖拽
    const handleDragCancelRef = useRef(handleDragCancel);
    handleDragCancelRef.current = handleDragCancel;
    useEffect(() => {
        const onFolderDragCancel = () => handleDragCancelRef.current();
        activeDocument.addEventListener('buttons-panel-folder-drag-cancel', onFolderDragCancel);
        return () => activeDocument.removeEventListener('buttons-panel-folder-drag-cancel', onFolderDragCancel);
    }, []);

    const buttonEnabled = enabled && !isCategoryDragActive;
    const categoryEnabled = enabled && !isButtonDragActive;

    const buttonContextValue = useMemo<ButtonDragContextValue>(
        () => ({
            enabled: buttonEnabled,
            isDragging: isButtonDragActive,
            activeButtonId,
            getOrderedButtons,
            getGridSlotButtons,
            dropTargetSlot: isButtonDragActive ? dropTargetSlot : null,
            registerCategoryHover,
        }),
        [
            buttonEnabled,
            isButtonDragActive,
            activeButtonId,
            getOrderedButtons,
            getGridSlotButtons,
            dropTargetSlot,
            registerCategoryHover,
        ]
    );

    const categoryContextValue = useMemo<CategoryDragContextValue>(
        () => ({
            enabled: categoryEnabled,
            isDragging: isCategoryDragActive,
            activeCategoryId,
            categoryIds,
            categoryTabDropTargetId:
                categoryDragOverlayVariant === 'tabs' ? categoryTabDropTargetId : null,
            getOrderedCategories,
            setListCategoryOpenById,
            getListCategoryOpen,
        }),
        [
            categoryEnabled,
            isCategoryDragActive,
            activeCategoryId,
            categoryIds,
            categoryDragOverlayVariant,
            categoryTabDropTargetId,
            getOrderedCategories,
            setListCategoryOpenById,
            getListCategoryOpen,
        ]
    );

    if (!enabled) {
        return (
            <ButtonDragContext.Provider value={disabledButtonContextValue}>
                <CategoryDragContext.Provider value={disabledCategoryContextValue}>
                    {children}
                </CategoryDragContext.Provider>
            </ButtonDragContext.Provider>
        );
    }

    return (
        <ButtonDragContext.Provider value={buttonContextValue}>
            <CategoryDragContext.Provider value={categoryContextValue}>
                <DndContext
                    sensors={sensors}
                    collisionDetection={collisionDetection}
                    measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
                    autoScroll={PANEL_AUTO_SCROLL_OPTIONS}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragEnd={(e) => void handleDragEnd(e)}
                    onDragCancel={handleDragCancel}
                    onDragPending={(e) => dndDebug('pending', String(e.id))}
                    onDragAbort={(e) => dndDebug('ABORT', String(e.id))}
                >
                    {children}
                    <DragOverlay dropAnimation={null} modifiers={[snapCenterToCursor]}>
                        {activeCategory ? (
                            <CategoryDragOverlay
                                category={activeCategory}
                                orderedButtons={getOrderedButtons(activeCategory)}
                                variant={categoryDragOverlayVariant}
                                tabOverlayWidth={categoryTabOverlayWidth}
                                displayStyle={displayStyle}
                                plugin={plugin}
                                app={app}
                                listCategoryOpen={categoryListDragOpen}
                                showCount={folderShowBtnCount}
                            />
                        ) : activeButton && activeButtonCategory ? (
                            <SimpleButton
                                button={activeButton}
                                category={activeButtonCategory}
                                displayStyle={displayStyle}
                                enableAnimation={false}
                                plugin={plugin}
                                app={app}
                                className="button-drag-overlay"
                            />
                        ) : null}
                    </DragOverlay>
                </DndContext>
            </CategoryDragContext.Provider>
        </ButtonDragContext.Provider>
    );
};

const CategoryDragOverlay: React.FC<{
    category: CategoryConfig;
    orderedButtons: ButtonConfig[];
    variant: CategoryDragOverlayVariant;
    tabOverlayWidth: number | null;
    displayStyle: 'icon_left' | 'icon_top';
    showCount?: boolean;
    plugin: ButtonsPanelPlugin;
    app: App;
    listCategoryOpen: boolean;
}> = ({
    category,
    orderedButtons,
    variant,
    tabOverlayWidth,
    displayStyle,
    plugin,
    app,
    listCategoryOpen,
    showCount = true,
}) => {
    const { plugin: pluginCtx } = usePluginContext();
    const iconRef = React.useRef<HTMLSpanElement>(null);
    const isActiveTab =
        variant === 'tabs' && pluginCtx.activeTabCategoryId === category.id;

    React.useEffect(() => {
        if (iconRef.current && variant === 'tabs') {
            setIcon(iconRef.current, 'layout-grid');
        }
    }, [variant]);

    if (variant === 'tabs') {
        const tabStyle: React.CSSProperties | undefined = tabOverlayWidth
            ? {
                  width: tabOverlayWidth,
                  minWidth: tabOverlayWidth,
                  boxSizing: 'border-box',
              }
            : undefined;

        return (
            <div
                className={[
                    'buttons-panel-tab',
                    'category-drag-overlay-tab',
                    isActiveTab ? 'is-active' : '',
                ]
                    .filter(Boolean)
                    .join(' ')}
                style={tabStyle}
            >
                <span className="tab-icon" ref={iconRef} />
                <span className="tab-label">{category.name}</span>
            </div>
        );
    }

    if (variant === 'folder') {
        return (
            <div className="category-drag-overlay-folder">
                <CategoryFolderTile
                    category={category}
                    previewButtons={orderedButtons}
                    showCount={showCount}
                />
            </div>
        );
    }

    const categoryClassName = [
        'buttons-panel-category',
        listCategoryOpen ? 'list-category-open' : 'list-category-closed',
    ].join(' ');

    return (
        <CategoryListDragPreview
            category={category}
            orderedButtons={orderedButtons}
            isOpen={listCategoryOpen}
            displayStyle={displayStyle}
            plugin={plugin}
            app={app}
            categoryClassName={categoryClassName}
            titleClassName="buttons-panel-category-title is-collapsible"
            className="category-drag-overlay-list"
        />
    );
};

export function useButtonDrag(): ButtonDragContextValue {
    const ctx = useContext(ButtonDragContext);
    if (!ctx) {
        throw new Error('useButtonDrag must be used within ButtonDragProvider');
    }
    return ctx;
}

export function useButtonDragOptional(): ButtonDragContextValue | null {
    return useContext(ButtonDragContext);
}

export function useCategoryDragOptional(): CategoryDragContextValue | null {
    return useContext(CategoryDragContext);
}
