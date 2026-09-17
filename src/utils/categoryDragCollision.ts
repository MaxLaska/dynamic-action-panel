import {
    pointerWithin,
    type ClientRect,
    type Collision,
    type CollisionDetection,
    type DroppableContainer,
} from '@dnd-kit/core';
import { parseCategorySortableId } from '@/utils/categoryDragItems';

function getRect(container: DroppableContainer): ClientRect | null {
    return container.rect.current;
}

function sortCategoryContainers(containers: DroppableContainer[]): DroppableContainer[] {
    return [...containers].sort((a, b) => {
        const ra = getRect(a);
        const rb = getRect(b);
        if (!ra || !rb) return 0;
        const rowDelta = ra.top - rb.top;
        if (Math.abs(rowDelta) > 4) return rowDelta;
        return ra.left - rb.left;
    });
}

function isSameRow(a: ClientRect, b: ClientRect): boolean {
    const threshold = Math.min(a.height, b.height) * 0.5;
    return Math.abs(a.top - b.top) <= threshold;
}

/** Horizontal: the pointer must cross the target tab's midline to swap (same as dragging into a wide tab from the left). */
function passesHorizontalMidpoint(
    activeIndex: number,
    overIndex: number,
    pointerX: number,
    overMidX: number
): boolean {
    if (activeIndex < overIndex) {
        return pointerX >= overMidX;
    }
    if (activeIndex > overIndex) {
        return pointerX <= overMidX;
    }
    return false;
}

/** Vertical (across rows in a wrapped tab bar): the pointer must cross the target's midline to swap. */
function passesVerticalMidpoint(
    activeIndex: number,
    overIndex: number,
    pointerY: number,
    overMidY: number
): boolean {
    if (activeIndex < overIndex) {
        return pointerY >= overMidY;
    }
    if (activeIndex > overIndex) {
        return pointerY <= overMidY;
    }
    return false;
}

function resolveMidpointCategoryCollision(
    args: Parameters<CollisionDetection>[0],
    axis: 'horizontal' | 'grid'
): Collision[] {
    const activeId = String(args.active.id);
    if (!parseCategorySortableId(activeId)) return [];

    const pointer = args.pointerCoordinates;
    if (!pointer) return [];

    const hits = pointerWithin(args).filter(
        (c) => parseCategorySortableId(String(c.id)) && c.id !== args.active?.id
    );
    if (hits.length === 0) return [];

    const sortableContainers = sortCategoryContainers(
        args.droppableContainers.filter((c) => parseCategorySortableId(String(c.id)))
    );

    const activeContainer = sortableContainers.find((c) => c.id === args.active.id);
    const overContainer = args.droppableContainers.find((c) => c.id === hits[0]!.id);
    if (!activeContainer || !overContainer) return [];

    const activeIndex = sortableContainers.findIndex((c) => c.id === activeContainer.id);
    const overIndex = sortableContainers.findIndex((c) => c.id === overContainer.id);
    if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) return [];

    const overRect = getRect(overContainer);
    const activeRect = getRect(activeContainer);
    if (!overRect) return [];

    const useHorizontal =
        axis === 'horizontal' || (axis === 'grid' && activeRect && isSameRow(activeRect, overRect));

    if (useHorizontal) {
        const overMidX = overRect.left + overRect.width / 2;
        if (!passesHorizontalMidpoint(activeIndex, overIndex, pointer.x, overMidX)) {
            return [];
        }
    } else {
        const overMidY = overRect.top + overRect.height / 2;
        if (!passesVerticalMidpoint(activeIndex, overIndex, pointer.y, overMidY)) {
            return [];
        }
    }

    return [hits[0]!];
}

function pickCategoryCollision(collisions: Collision[]): Collision[] {
    const filtered = collisions.filter((c) => {
        const id = String(c.id);
        return parseCategorySortableId(id) !== null;
    });
    if (filtered.length === 0) return [];
    return [filtered[0]!];
}

/**
 * Tabs view: any pointer entry into a tab counts as a hit (no midline threshold),
 * which drives both the hover timer and the drop swap.
 */
export const categoryTabDragCollision: CollisionDetection = (args) => {
    const activeId = String(args.active.id);
    if (!parseCategorySortableId(activeId)) return [];

    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length === 0) return [];

    const withoutActive = pointerCollisions.filter((c) => c.id !== args.active?.id);
    return pickCategoryCollision(withoutActive);
};

/** List view: any pointer entry into a category counts as a hit. */
export const categoryDragCollisionDetection: CollisionDetection = (args) => {
    const activeId = String(args.active.id);
    if (!parseCategorySortableId(activeId)) return [];

    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length === 0) return [];

    const withoutActive = pointerCollisions.filter((c) => c.id !== args.active?.id);
    return pickCategoryCollision(withoutActive);
};

/** Single-row tab bar: swap on the horizontal midline. */
export const categoryHorizontalTabDragCollision: CollisionDetection = (args) =>
    resolveMidpointCategoryCollision(args, 'horizontal');

/** Wrapped multi-row tab bar: horizontal midline within a row, vertical midline across rows. */
export const categoryGridTabDragCollision: CollisionDetection = (args) =>
    resolveMidpointCategoryCollision(args, 'grid');
