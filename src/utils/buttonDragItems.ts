import { arrayMove } from '@dnd-kit/sortable';
import type { ButtonConfig, CategoryConfig } from '@/types';
import {
    GRID_SLOT_COUNT,
    buildGridSlotIds,
    getCategoryLayout,
    isGridCategory,
    isValidSlotIndex,
    moveIdToSlotWithinGrid,
    type CategoryLayout,
} from '@/utils/categoryGrid';
import { allPaletteButtons, type ResolvedPalette } from '@/utils/paletteLayers';

/**
 * Live drag state per category.
 *
 * - flow categories: a dense array of button ids, the index is the order;
 * - grid categories: a length-GRID_SLOT_COUNT array where the index IS the
 *   slot and `null` marks an empty slot.
 *
 * One representation covers both layouts, so container resolution, collision
 * handling and persistence stay shared; only the semantics of "index" differ,
 * which is exactly the difference between the two layouts.
 */
export type ButtonDragItems = Record<string, (string | null)[]>;

/** Layout of each drag container, needed to interpret the index. */
export type ContainerLayouts = Record<string, CategoryLayout>;

/**
 * Slots a drag may not land on, per grid container.
 *
 * This is what enforces the palette's hard layer rule: a slot occupied by the
 * base/pinned layer is reserved in every context profile, and while the base
 * layer itself is being edited the slots other context profiles occupy are
 * reserved the other way round. A blocked slot simply rejects the drop — no
 * swap, no silent overwrite, no data loss.
 */
export type BlockedSlots = Record<string, readonly boolean[]>;

function isSlotBlocked(
    blocked: BlockedSlots | undefined,
    containerId: string,
    slot: number
): boolean {
    return blocked?.[containerId]?.[slot] === true;
}

export const CONTAINER_PREFIX = 'container:';
export const TAB_PREFIX = 'tab:';
/** 拖到文件夹标题区 → 始终追加到末尾 */
export const TITLE_PREFIX = 'title:';
/** Grid palette: one droppable per empty slot, `slot:<categoryId>:<index>`. */
export const SLOT_PREFIX = 'slot:';

export function containerDroppableId(categoryId: string): string {
    return `${CONTAINER_PREFIX}${categoryId}`;
}

export function tabDroppableId(categoryId: string): string {
    return `${TAB_PREFIX}${categoryId}`;
}

export function titleDroppableId(categoryId: string): string {
    return `${TITLE_PREFIX}${categoryId}`;
}

export function slotDroppableId(categoryId: string, slot: number): string {
    return `${SLOT_PREFIX}${categoryId}:${slot}`;
}

/**
 * Parse a slot droppable id. Category ids are user-generated timestamps but
 * could in principle contain ':', so the slot is taken from the LAST segment
 * and everything between the prefix and it is the category id.
 */
export function parseSlotDroppableId(
    overId: string | number
): { categoryId: string; slot: number } | null {
    const id = String(overId);
    if (!id.startsWith(SLOT_PREFIX)) {
        return null;
    }
    const rest = id.slice(SLOT_PREFIX.length);
    const separator = rest.lastIndexOf(':');
    if (separator <= 0) {
        return null;
    }
    const slot = Number(rest.slice(separator + 1));
    if (!isValidSlotIndex(slot)) {
        return null;
    }
    return { categoryId: rest.slice(0, separator), slot };
}

export function isContainerZoneOverId(overId: string | number): boolean {
    return String(overId).startsWith(CONTAINER_PREFIX);
}

export function isTabZoneOverId(overId: string | number): boolean {
    return String(overId).startsWith(TAB_PREFIX);
}

export function isTitleZoneOverId(overId: string | number): boolean {
    return String(overId).startsWith(TITLE_PREFIX);
}

export function isSlotZoneOverId(overId: string | number): boolean {
    return String(overId).startsWith(SLOT_PREFIX);
}

/** 拖放到分类区域末尾（容器 / 标签 / 标题区） */
export function isAppendToCategoryEndOverId(overId: string | number): boolean {
    return isContainerZoneOverId(overId) || isTabZoneOverId(overId) || isTitleZoneOverId(overId);
}

export function buildContainerLayouts(categories: CategoryConfig[]): ContainerLayouts {
    const layouts: ContainerLayouts = {};
    for (const category of categories) {
        layouts[category.id] = getCategoryLayout(category);
    }
    return layouts;
}

/**
 * Live drag state for every container.
 *
 * For a grid palette the state describes the layer view currently on screen,
 * so it is taken from the resolved palette (base/pinned + the selected or
 * active context profile) rather than from `category.buttons` alone. Layers
 * that are not on screen are simply absent from the drag state, which is what
 * keeps a drag in "Type A" from touching "Type B".
 */
export function buildButtonDragItems(
    categories: CategoryConfig[],
    palettes?: ReadonlyMap<string, ResolvedPalette>
): ButtonDragItems {
    const items: ButtonDragItems = {};
    for (const category of categories) {
        if (isGridCategory(category)) {
            const resolved = palettes?.get(category.id);
            items[category.id] = resolved
                ? resolved.slots.map((slot) => slot.button?.id ?? null)
                : buildGridSlotIds(category.buttons);
            continue;
        }
        const sorted = [...category.buttons].sort((a, b) => a.order - b.order);
        items[category.id] = sorted.map((b) => b.id);
    }
    return items;
}

export function findContainerForButtonId(
    buttonId: string,
    items: ButtonDragItems
): string | undefined {
    return Object.keys(items).find((categoryId) => items[categoryId]!.includes(buttonId));
}

export function resolveOverContainerId(
    overId: string | number,
    items: ButtonDragItems
): string | null {
    const id = String(overId);
    const slotTarget = parseSlotDroppableId(id);
    if (slotTarget) {
        return slotTarget.categoryId;
    }
    if (id.startsWith(CONTAINER_PREFIX)) {
        return id.slice(CONTAINER_PREFIX.length);
    }
    if (id.startsWith(TAB_PREFIX)) {
        return id.slice(TAB_PREFIX.length);
    }
    if (id.startsWith(TITLE_PREFIX)) {
        return id.slice(TITLE_PREFIX.length);
    }
    return findContainerForButtonId(id, items) ?? null;
}

/** Buttons of a container in their live drag order, empty slots removed. */
export function getOrderedButtonsFromAllCategories(
    category: CategoryConfig,
    categories: CategoryConfig[],
    items: ButtonDragItems
): ButtonConfig[] {
    const ids = items[category.id] ?? [];
    const allButtons = collectButtonsById(categories);
    return ids
        .map((id) => (id === null ? undefined : allButtons.get(id)))
        .filter((b): b is ButtonConfig => b !== undefined);
}

/**
 * Live slot occupancy of a grid container: index = slot, null = empty slot.
 * Always GRID_SLOT_COUNT entries, so the rendered grid keeps its shape while a
 * drag is in flight.
 */
export function getGridSlotButtonsFromAllCategories(
    category: CategoryConfig,
    categories: CategoryConfig[],
    items: ButtonDragItems
): (ButtonConfig | null)[] {
    const ids = items[category.id];
    const allButtons = collectButtonsById(categories);
    const slots = new Array<ButtonConfig | null>(GRID_SLOT_COUNT).fill(null);
    if (!ids) {
        return slots;
    }
    for (let i = 0; i < GRID_SLOT_COUNT; i++) {
        const id = ids[i] ?? null;
        slots[i] = id === null ? null : (allButtons.get(id) ?? null);
    }
    return slots;
}

/**
 * Every button reachable from the given categories, context-profile layers
 * included — a drag state may legitimately reference a button that lives in a
 * profile rather than in `category.buttons`.
 */
export function collectButtonsById(
    categories: CategoryConfig[]
): Map<string, ButtonConfig> {
    const allButtons = new Map<string, ButtonConfig>();
    for (const cat of categories) {
        for (const button of allPaletteButtons(cat)) {
            allButtons.set(button.id, button);
        }
    }
    return allButtons;
}

function arraysEqual(a: (string | null)[] | undefined, b: (string | null)[]): boolean {
    if (!a || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function withContainerItems(
    prev: ButtonDragItems,
    containerId: string,
    nextItems: (string | null)[]
): ButtonDragItems {
    if (arraysEqual(prev[containerId] ?? [], nextItems)) {
        return prev;
    }
    const next = { ...prev, [containerId]: nextItems };
    return itemsShallowEqual(prev, next) ? prev : next;
}

/**
 * Slot a drop targets inside a grid container, or null when the pointer is not
 * over an addressable cell (a plain container/tab/title zone gives no position,
 * and in a positional grid there is no meaningful "append to the end").
 */
function resolveGridTargetSlot(
    overId: string,
    overContainer: string,
    overSlots: (string | null)[]
): number | null {
    const slotTarget = parseSlotDroppableId(overId);
    if (slotTarget) {
        return slotTarget.categoryId === overContainer ? slotTarget.slot : null;
    }
    if (isAppendToCategoryEndOverId(overId)) {
        return null;
    }
    const index = overSlots.indexOf(overId);
    return index === -1 ? null : index;
}

/**
 * What releasing on `overId` means for a grid target.
 *
 * - `accept`: an ordinary drop (also every flow target);
 * - `blocked`: a slot another palette layer reserves, or a flow tool aimed at
 *   an occupied slot — the palette rules refuse it;
 * - `no-cell`: the pointer is over the palette but not over an addressable
 *   cell (the container/tab/title area), which carries no position in a
 *   positional grid.
 *
 * Both non-accepting outcomes must revert the whole drag. The live drag state
 * follows the pointer, so by the time it reaches such a target it may already
 * show the tool on the last accepted cell it crossed; committing that would
 * drop the tool somewhere the user never aimed at.
 */
export type GridDropOutcome = 'accept' | 'blocked' | 'no-cell';

export function resolveGridDropOutcome(
    items: ButtonDragItems,
    activeId: string,
    overId: string,
    layouts: ContainerLayouts = {},
    blocked?: BlockedSlots
): GridDropOutcome {
    const overContainer = resolveOverContainerId(overId, items);
    if (!overContainer || layouts[overContainer] !== 'grid') {
        return 'accept';
    }
    const overSlots = items[overContainer];
    if (!overSlots) return 'accept';

    const targetSlot = resolveGridTargetSlot(overId, overContainer, overSlots);
    if (targetSlot === null) {
        return 'no-cell';
    }
    if (isSlotBlocked(blocked, overContainer, targetSlot)) {
        return 'blocked';
    }

    const activeContainer = findContainerForButtonId(activeId, items);
    if (!activeContainer || activeContainer === overContainer) {
        return 'accept';
    }
    // flow -> grid accepts empty slots only.
    const occupant = overSlots[targetSlot] ?? null;
    return layouts[activeContainer] !== 'grid' && occupant !== null && occupant !== activeId
        ? 'blocked'
        : 'accept';
}

/**
 * Drop semantics when the target container is a grid.
 *
 * - within one grid: move onto an empty slot, swap with an occupied one; the
 *   grid is positional, so nothing else shifts;
 * - grid -> grid across categories: the same move/swap, with the displaced
 *   button taking the dragged button's former slot;
 * - flow -> grid: only empty slots accept the button. An occupied slot is
 *   rejected rather than inventing a cross-layout swap, because there is no
 *   well-defined position for the displaced button in a flow list.
 *
 * On top of that, a slot blocked by another palette layer rejects the drop
 * outright (see BlockedSlots): pinned base slots are reserved in every context
 * profile, and slots other profiles use are reserved while the base layer is
 * being edited.
 */
function applyGridDragOver(
    prev: ButtonDragItems,
    activeId: string,
    activeContainer: string,
    overContainer: string,
    overId: string,
    activeIsGrid: boolean,
    blocked?: BlockedSlots
): ButtonDragItems {
    const overSlots = prev[overContainer]!;
    const targetSlot = resolveGridTargetSlot(overId, overContainer, overSlots);
    if (targetSlot === null) {
        return prev;
    }
    if (isSlotBlocked(blocked, overContainer, targetSlot)) {
        return prev;
    }

    const occupantId = overSlots[targetSlot] ?? null;
    if (occupantId === activeId) {
        return prev;
    }

    if (activeContainer === overContainer) {
        return withContainerItems(
            prev,
            overContainer,
            moveIdToSlotWithinGrid(overSlots, activeId, targetSlot)
        );
    }

    const activeItems = prev[activeContainer]!;

    if (!activeIsGrid) {
        // Flow -> grid: empty slots only.
        if (occupantId !== null) {
            return prev;
        }
        const nextOver = [...overSlots];
        nextOver[targetSlot] = activeId;
        const nextActive = activeItems.filter((id) => id !== activeId);
        const next: ButtonDragItems = {
            ...prev,
            [activeContainer]: nextActive,
            [overContainer]: nextOver,
        };
        return itemsShallowEqual(prev, next) ? prev : next;
    }

    const fromSlot = activeItems.indexOf(activeId);
    if (fromSlot === -1) {
        return prev;
    }
    const nextOver = [...overSlots];
    nextOver[targetSlot] = activeId;
    const nextActive = [...activeItems];
    // The displaced button (or the hole) moves into the vacated slot.
    nextActive[fromSlot] = occupantId;

    const next: ButtonDragItems = {
        ...prev,
        [activeContainer]: nextActive,
        [overContainer]: nextOver,
    };
    return itemsShallowEqual(prev, next) ? prev : next;
}

/**
 * 根据 dragOver 计算下一 items；若无变化则返回 prev（同一引用），避免 React #185 无限更新。
 * `layouts` decides whether a container's index means order (flow) or slot (grid).
 */
export function applyDragOverToItems(
    prev: ButtonDragItems,
    activeId: string,
    overId: string,
    layouts: ContainerLayouts = {},
    blocked?: BlockedSlots
): ButtonDragItems {
    const activeContainer = findContainerForButtonId(activeId, prev);
    const overContainer = resolveOverContainerId(overId, prev);

    if (!activeContainer || !overContainer) return prev;
    if (!prev[activeContainer] || !prev[overContainer]) return prev;

    const activeIsGrid = layouts[activeContainer] === 'grid';
    const overIsGrid = layouts[overContainer] === 'grid';

    if (overIsGrid) {
        return applyGridDragOver(
            prev,
            activeId,
            activeContainer,
            overContainer,
            overId,
            activeIsGrid,
            blocked
        );
    }

    const activeItems = prev[activeContainer];
    const overItems = prev[overContainer];
    const activeIndex = activeItems.indexOf(activeId);
    if (activeIndex === -1) return prev;

    if (activeContainer === overContainer) {
        // 拖到标题区 → 同一分类末尾
        if (isTitleZoneOverId(overId)) {
            const lastIndex = overItems.length - 1;
            if (activeIndex === lastIndex) return prev;
            return withContainerItems(
                prev,
                overContainer,
                arrayMove([...overItems], activeIndex, lastIndex)
            );
        }
        // 同分类内：网格 container 铺满按钮区，指针穿透占位符会误命中 container 导致与「末尾」来回跳
        if (isContainerZoneOverId(overId)) {
            return prev;
        }
        if (isTabZoneOverId(overId)) {
            const lastIndex = overItems.length - 1;
            if (activeIndex === lastIndex) return prev;
            return withContainerItems(
                prev,
                overContainer,
                arrayMove([...overItems], activeIndex, lastIndex)
            );
        }
        const overIndex = overItems.indexOf(overId);
        if (overIndex === -1 || activeIndex === overIndex) return prev;
        return withContainerItems(
            prev,
            overContainer,
            arrayMove([...overItems], activeIndex, overIndex)
        );
    }

    const filteredOverItems = overItems.filter((id) => id !== activeId);

    let overIndex: number;
    if (isAppendToCategoryEndOverId(overId)) {
        overIndex = filteredOverItems.length;
    } else {
        const overIdx = filteredOverItems.indexOf(overId);
        overIndex = overIdx >= 0 ? overIdx : filteredOverItems.length;
    }

    const nextOverItems = [
        ...filteredOverItems.slice(0, overIndex),
        activeId,
        ...filteredOverItems.slice(overIndex),
    ];

    // Leaving a grid keeps the grid's shape: the vacated slot becomes a hole
    // instead of collapsing the array.
    const nextActiveItems = activeIsGrid
        ? activeItems.map((id) => (id === activeId ? null : id))
        : activeItems.filter((id) => id !== activeId);

    const next: ButtonDragItems = {
        ...prev,
        [activeContainer]: nextActiveItems,
        [overContainer]: nextOverItems,
    };

    return itemsShallowEqual(prev, next) ? prev : next;
}

export function itemsShallowEqual(a: ButtonDragItems, b: ButtonDragItems): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
        const arrA = a[key];
        const arrB = b[key];
        if (!arrA || !arrB || arrA.length !== arrB.length) return false;
        for (let i = 0; i < arrA.length; i++) {
            if (arrA[i] !== arrB[i]) return false;
        }
    }
    return true;
}
