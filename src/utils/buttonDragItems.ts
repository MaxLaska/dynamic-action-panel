import { arrayMove } from '@dnd-kit/sortable';
import type { ButtonConfig, CategoryConfig } from '@/types';
import {
    buildGridSlotIds,
    getCategoryLayout,
    gridSlotCount,
    isGridCategory,
    isSlotIndexValue,
    moveIdToSlotWithinGrid,
    type CategoryLayout,
} from '@/utils/categoryGrid';
import {
    allCategoryButtons,
    gridDimensionsOf,
    type ResolvedGridView,
} from '@/utils/categoryVariants';

/**
 * Live drag state per category.
 *
 * - flow categories: a dense array of button ids, the index is the order;
 * - grid categories: an array sized by that grid's own slot count, where the
 *   index IS the slot and `null` marks an empty slot.
 *
 * One representation covers both layouts, so container resolution, collision
 * handling and persistence stay shared; only the semantics of "index" differ,
 * which is exactly the difference between the two layouts.
 */
export type ButtonDragItems = Record<string, (string | null)[]>;

/** Layout of each drag container, needed to interpret the index. */
export type ContainerLayouts = Record<string, CategoryLayout>;

export const CONTAINER_PREFIX = 'container:';
export const TAB_PREFIX = 'tab:';
/** Dropping onto a folder header always appends to the end. */
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
 *
 * Only the SHAPE of the slot is checked here — grids no longer share one slot
 * count, so the upper bound belongs to the container the id names and is
 * applied where that container's live state is available.
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
    if (!isSlotIndexValue(slot)) {
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

/** Dropping onto a category area (container / tab / header) appends to its end. */
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
 * For a grid category the state describes the ONE grid currently on screen:
 * the static grid, or the selected/active variant. Variants that are not on
 * screen are simply absent from the drag state, which is what keeps a drag in
 * "Source" from touching "Topic".
 */
export function buildButtonDragItems(
    categories: CategoryConfig[],
    gridViews?: ReadonlyMap<string, ResolvedGridView>
): ButtonDragItems {
    const items: ButtonDragItems = {};
    for (const category of categories) {
        if (isGridCategory(category)) {
            const resolved = gridViews?.get(category.id);
            items[category.id] = resolved
                ? resolved.slots.map((button) => button?.id ?? null)
                : buildGridSlotIds(
                      category.buttons,
                      gridDimensionsOf(category, null)
                  );
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
 *
 * The length comes from the live drag state, which was built from the resolved
 * view of exactly this grid — so the rendered grid keeps its shape (and its
 * size) while a drag is in flight. Without a drag state the stored dimensions
 * decide.
 */
export function getGridSlotButtonsFromAllCategories(
    category: CategoryConfig,
    categories: CategoryConfig[],
    items: ButtonDragItems
): (ButtonConfig | null)[] {
    const ids = items[category.id];
    const slotCount = ids?.length ?? gridSlotCount(gridDimensionsOf(category, null));
    const allButtons = collectButtonsById(categories);
    const slots = new Array<ButtonConfig | null>(slotCount).fill(null);
    if (!ids) {
        return slots;
    }
    for (let i = 0; i < slotCount; i++) {
        const id = ids[i] ?? null;
        slots[i] = id === null ? null : (allButtons.get(id) ?? null);
    }
    return slots;
}

/**
 * Every button reachable from the given categories, variants included — a
 * drag state may legitimately reference a button that lives in a variant
 * rather than in `category.buttons`.
 */
export function collectButtonsById(
    categories: CategoryConfig[]
): Map<string, ButtonConfig> {
    const allButtons = new Map<string, ButtonConfig>();
    for (const cat of categories) {
        for (const button of allCategoryButtons(cat)) {
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
        // A cell id that outlives its grid (a droppable still registered from
        // a larger size) names no cell any more.
        return slotTarget.categoryId === overContainer &&
            slotTarget.slot < overSlots.length
            ? slotTarget.slot
            : null;
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
 * - `blocked`: a flow tool aimed at an occupied slot — there is no
 *   well-defined position for the displaced button in a flow list, so the
 *   grid rules refuse it;
 * - `no-cell`: the pointer is over the grid but not over an addressable
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
    layouts: ContainerLayouts = {}
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
 */
function applyGridDragOver(
    prev: ButtonDragItems,
    activeId: string,
    activeContainer: string,
    overContainer: string,
    overId: string,
    activeIsGrid: boolean
): ButtonDragItems {
    const overSlots = prev[overContainer]!;
    const targetSlot = resolveGridTargetSlot(overId, overContainer, overSlots);
    if (targetSlot === null) {
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
 * Computes the next items from a dragOver event; returns `prev` by identity when nothing
 * changed, which avoids the React #185 infinite update loop.
 * `layouts` decides whether a container's index means order (flow) or slot (grid).
 */
export function applyDragOverToItems(
    prev: ButtonDragItems,
    activeId: string,
    overId: string,
    layouts: ContainerLayouts = {}
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
            activeIsGrid
        );
    }

    const activeItems = prev[activeContainer];
    const overItems = prev[overContainer];
    const activeIndex = activeItems.indexOf(activeId);
    if (activeIndex === -1) return prev;

    if (activeContainer === overContainer) {
        // Dropping onto the header means: end of the same category.
        if (isTitleZoneOverId(overId)) {
            const lastIndex = overItems.length - 1;
            if (activeIndex === lastIndex) return prev;
            return withContainerItems(
                prev,
                overContainer,
                arrayMove([...overItems], activeIndex, lastIndex)
            );
        }
        // Within one category: the grid container covers the whole button area, so a pointer passing over a placeholder would also hit the container and make the item flip between its slot and the end.
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
