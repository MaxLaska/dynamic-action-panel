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
    type BlockedSlots,
    type ButtonDragItems,
} from '@/utils/buttonDragItems';
import {
    getCategoryLayout,
    isGridCategory,
    isValidSlotIndex,
    placeButtonsOnGrid,
    type CategoryLayout,
} from '@/utils/categoryGrid';
import {
    BASE_LAYER_ID,
    applySlotIdsToPalette,
    blockedSlotsForLayer,
    type PaletteLayerSelection,
    type ResolvedPalette,
} from '@/utils/paletteLayers';
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
     * Resolved palettes (base/pinned + the selected context layer) per grid
     * category. The drag state mirrors exactly what is on screen, so a drag in
     * one context profile can never touch another one.
     */
    palettes?: ReadonlyMap<string, ResolvedPalette>;
    /** Layer each palette is being edited on; decides where a dropped tool lands. */
    layerSelection?: PaletteLayerSelection;
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
    layouts: Record<string, CategoryLayout>,
    blocked: BlockedSlots
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

    // A slot another palette layer reserves rejects the drop, so it must not
    // advertise itself as a landing spot either.
    if (blocked[target.categoryId]?.[target.slot] === true) {
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
    palettes,
    layerSelection,
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
        buildButtonDragItems(categories, palettes)
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
    const categoryIdsRef = useRef(categoryIds);
    const categoryHoverRef = useRef<((categoryId: string) => void) | null>(null);
    const lastNotifiedHoverContainerRef = useRef<string | null>(null);
    const dragOverFrameRef = useRef<number | null>(null);
    const pendingDragOverRef = useRef<{ activeId: string; overId: string } | null>(null);
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

    /**
     * Slots the currently displayed palette layer may not occupy: pinned base
     * slots while a context profile is on screen, and slots other profiles use
     * while the base layer is being edited. Enforced in the drop semantics and
     * in the drop-target highlight, so a blocked slot never even promises a
     * landing spot.
     */
    const blockedSlots = useMemo<BlockedSlots>(() => {
        const blocked: Record<string, readonly boolean[]> = {};
        for (const category of categories) {
            if (!isGridCategory(category)) continue;
            blocked[category.id] = blockedSlotsForLayer(
                category,
                layerSelection?.[category.id] ?? BASE_LAYER_ID
            );
        }
        return blocked;
    }, [categories, layerSelection]);
    const blockedSlotsRef = useRef(blockedSlots);
    blockedSlotsRef.current = blockedSlots;

    const layerSelectionRef = useRef(layerSelection);
    layerSelectionRef.current = layerSelection;

    const palettesRef = useRef(palettes);
    palettesRef.current = palettes;

    /** Drag state matching the stored data for the layers currently on screen. */
    const buildBaselineItems = useCallback(
        () => buildButtonDragItems(categories, palettesRef.current),
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
        if (activeButtonId) return;
        const next = buildButtonDragItems(categories, palettes);
        setItems((prev) => (itemsShallowEqual(prev, next) ? prev : next));
    }, [categories, palettes, activeButtonId, enabled]);

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
            // Buttons of every layer, so a drag state referencing a context
            // profile's tool resolves just like a base one.
            const allButtons = collectButtonsById(storedCategories);
            const selection = layerSelectionRef.current ?? {};

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
                    // A palette writes back per layer: the index IS the slot,
                    // buttons keep the layer they belong to, tools arriving
                    // from another category join the layer on screen, and
                    // off-screen layers are left completely untouched.
                    return applySlotIdsToPalette(
                        category,
                        ids,
                        allButtons,
                        selection[category.id] ?? BASE_LAYER_ID,
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

        const { activeId, overId } = pending;
        const last = lastAppliedDragOverRef.current;
        if (last?.activeId === activeId && last?.overId === overId) {
            return;
        }

        const prev = itemsRef.current;
        const hoverActiveContainer = findContainerForButtonId(activeId, prev);
        const hoverOverContainer = resolveOverContainerId(overId, prev);
        if (
            hoverActiveContainer &&
            hoverOverContainer &&
            hoverActiveContainer !== hoverOverContainer
        ) {
            notifyCategoryHover(hoverOverContainer);
        }

        const next = applyDragOverToItems(
            prev,
            activeId,
            overId,
            containerLayoutsRef.current,
            blockedSlotsRef.current
        );
        lastAppliedDragOverRef.current = { activeId, overId };
        if (next !== prev) {
            itemsRef.current = next;
            setItems(next);
        }
    }, [notifyCategoryHover]);

    const scheduleButtonDragOver = useCallback(
        (activeId: string, overId: string) => {
            pendingDragOverRef.current = { activeId, overId };
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
            setDropTargetSlot(
                resolveGridDropTarget(
                    activeId,
                    overIdStr,
                    itemsRef.current,
                    containerLayoutsRef.current,
                    blockedSlotsRef.current
                )
            );
            scheduleButtonDragOver(activeId, overIdStr);
        },
        [
            buildBaselineItems,
            categoryDragOverlayVariant,
            clearCategoryTabHoverTimer,
            scheduleButtonDragOver,
            scheduleCategoryTabDropTarget,
        ]
    );

    // 文件夹模式：拖出展开的文件夹外松手时取消拖拽 → 阻止 handleDragEnd 错误持久化
    const dragForceCancelledRef = useRef(false);

    const handleDragEnd = useCallback(
        async (event: DragEndEvent) => {
            const { active, over } = event;
            const activeId = String(active.id);

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

            cancelDragOverFrame();

            // 文件夹拖拽取消：跳过位置应用与持久化
            if (dragForceCancelledRef.current) {
                dragForceCancelledRef.current = false;
                setActiveButtonId(null);
                resetButtonDragHoverState();
                return;
            }

            // 碰撞检测返回空（如拖到磁贴区松手）→ 回退到原始位置
            if (!over) {
                const baseline = buildBaselineItems();
                itemsRef.current = baseline;
                setItems(baseline);
                setActiveButtonId(null);
                resetButtonDragHoverState();
                return;
            }

            if (active && over) {
                const overId = String(over.id);

                // Released on a cell the palette rules refuse: a slot another
                // layer reserves, or a flow tool on an occupied slot. The live
                // drag state follows the pointer, so it may already show the
                // tool on the last accepted cell it crossed — committing that
                // would drop the tool where the user never aimed. The whole
                // drag is therefore reverted and the refusal is explained.
                // (A release over the palette's background, `no-cell`, is left
                // alone: it is the normal case once the preview already fills
                // the target cell, which removes that cell's droppable.)
                if (
                    resolveGridDropOutcome(
                        itemsRef.current,
                        activeId,
                        overId,
                        containerLayoutsRef.current,
                        blockedSlotsRef.current
                    ) === 'blocked'
                ) {
                    const baseline = buildBaselineItems();
                    itemsRef.current = baseline;
                    setItems(baseline);
                    setActiveButtonId(null);
                    resetButtonDragHoverState();
                    new Notice(t('palette_drop_blocked'));
                    return;
                }

                const prev = itemsRef.current;
                const next = applyDragOverToItems(
                    prev,
                    activeId,
                    overId,
                    containerLayoutsRef.current,
                    blockedSlotsRef.current
                );
                if (next !== prev) {
                    itemsRef.current = next;
                    setItems(next);
                }
            }

            const finalItems = itemsRef.current;
            const baseline = buildBaselineItems();

            setActiveButtonId(null);
            resetButtonDragHoverState();

            if (!itemsShallowEqual(baseline, finalItems)) {
                try {
                    await persistItems(finalItems, plugin);
                } catch (error) {
                    console.error('保存按钮排序时出错:', error);
                    setItems(baseline);
                }
            }
        },
        [
            buildBaselineItems,
            cancelDragOverFrame,
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
        dragForceCancelledRef.current = true;
        cancelDragOverFrame();
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
