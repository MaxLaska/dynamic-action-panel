// tests/helpers/stored.ts
// Shared builders for the v5 stored shapes (tool registry + placements), so
// the operation/lifecycle tests read as compactly as the old button fixtures.

import type {
    StoredCategory,
    StoredVariant,
    ToolDefinition,
    ToolPlacement,
    ToolRegistry,
} from '@/types/settings';
import type { ButtonCondition } from '@/types/conditions';
import type { ToolState } from '@/domain/categoryOps';

/** A minimal tool definition; name defaults to the id. */
export function tool(id: string, extra: Partial<ToolDefinition> = {}): ToolDefinition {
    return { id, name: id, actions: [], ...extra };
}

export function registryOf(...definitions: ToolDefinition[]): ToolRegistry {
    const tools: ToolRegistry = {};
    for (const definition of definitions) {
        tools[definition.id] = definition;
    }
    return tools;
}

/** A placement; slot omitted = flow / self-healed. */
export function p(toolId: string, slot?: number): ToolPlacement {
    return slot !== undefined ? { toolId, slot } : { toolId };
}

export function storedVariant(
    id: string,
    trigger: ButtonCondition | undefined,
    placements: ToolPlacement[],
    fallback = false,
    extra: Partial<StoredVariant> = {}
): StoredVariant {
    const variant: StoredVariant = { id, name: id, placements, ...extra };
    if (fallback) variant.fallback = true;
    else if (trigger !== undefined) variant.trigger = trigger;
    return variant;
}

export function storedGrid(
    placements: ToolPlacement[],
    extra: Partial<StoredCategory> = {}
): StoredCategory {
    return { id: 'cat', name: 'Tools', order: 0, layout: 'grid', placements, ...extra };
}

export function storedDynamic(
    variants: StoredVariant[],
    extra: Partial<StoredCategory> = {}
): StoredCategory {
    return {
        id: 'cat',
        name: 'Node Tools',
        order: 0,
        layout: 'grid',
        placements: [],
        variants,
        ...extra,
    };
}

export function storedFlow(
    placements: ToolPlacement[],
    extra: Partial<StoredCategory> = {}
): StoredCategory {
    return { id: 'cat', name: 'Flow', order: 0, placements, ...extra };
}

export function stateOf(tools: ToolRegistry, ...categories: StoredCategory[]): ToolState {
    return { tools, categories };
}
