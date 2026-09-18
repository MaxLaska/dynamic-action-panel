// export/templateExport.ts
// Building a portable template document out of the stored state.
//
// Export is STRICTLY READ-ONLY (architecture rule): it never mints ids, never
// normalizes or renumbers anything back into the settings, never collects
// garbage, never touches a ToolDefinition and never writes a `library` flag.
// It reads the current stored state and produces a new, fully detached
// document — every object here is freshly built, so the result cannot alias
// (and therefore cannot be used to mutate) anything that is persisted.
//
// Scope rule: only the categories the user asked for, and only the tool
// definitions those categories actually reference. Exporting one category
// never ships the whole vault registry.

import type { ToolState } from '@/domain/categoryOps';
import type {
    GridCellStyles,
    StoredCategory,
    StoredVariant,
    ToolDefinition,
    ToolPlacement,
    ToolRegistry,
} from '@/types/settings';
import {
    OCAP_TEMPLATE_FILE_EXTENSION,
    OCAP_TEMPLATE_FORMAT,
    OCAP_TEMPLATE_FORMAT_VERSION,
    type TemplateCategory,
    type TemplateDocument,
    type TemplateMeta,
    type TemplatePlacement,
    type TemplateTool,
    type TemplateVariant,
} from '@/export/templateFormat';

/**
 * Detach a JSON value from the stored graph. Actions and condition trees are
 * plain declarative data (no functions, no cycles — see types/conditions.ts),
 * so a structural round trip is both sufficient and the strongest guarantee
 * that nothing in the document still points into the settings.
 */
function detach<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function exportCellStyles(
    styles: GridCellStyles | undefined
): { cellStyles?: GridCellStyles } {
    if (!styles) {
        return {};
    }
    const keys = Object.keys(styles);
    if (keys.length === 0) {
        return {};
    }
    const next: GridCellStyles = {};
    for (const key of keys) {
        next[key] = { ...styles[key] };
    }
    return { cellStyles: next };
}

function exportDimensions(source: {
    rows?: number;
    columns?: number;
}): { rows?: number; columns?: number } {
    return {
        ...(typeof source.rows === 'number' ? { rows: source.rows } : {}),
        ...(typeof source.columns === 'number' ? { columns: source.columns } : {}),
    };
}

/**
 * Placements whose tool exists. A placement referencing an unknown tool is
 * corrupt data (the operations keep registry and placements consistent, and
 * materialization already skips such a ghost) — shipping it would produce a
 * document the importer's own dangling-reference check must reject.
 */
function exportPlacements(
    placements: readonly ToolPlacement[] | undefined,
    tools: ToolRegistry
): TemplatePlacement[] {
    const exported: TemplatePlacement[] = [];
    for (const placement of placements ?? []) {
        if (!tools[placement.toolId]) {
            continue;
        }
        exported.push({
            toolId: placement.toolId,
            ...(typeof placement.slot === 'number' ? { slot: placement.slot } : {}),
        });
    }
    return exported;
}

/**
 * A tool definition as it travels: the functional half, field by field. Built
 * explicitly rather than by spreading, so nothing internal (today `library`,
 * tomorrow whatever a refactor adds) can leak into a portable document by
 * accident.
 */
export function exportToolDefinition(definition: ToolDefinition): TemplateTool {
    return {
        id: definition.id,
        name: definition.name,
        ...(definition.icon !== undefined ? { icon: definition.icon } : {}),
        ...(definition.tooltip !== undefined ? { tooltip: definition.tooltip } : {}),
        actions: detach(definition.actions ?? []),
        ...(definition.executionMode !== undefined
            ? { executionMode: definition.executionMode }
            : {}),
        ...(definition.stopOnError !== undefined
            ? { stopOnError: definition.stopOnError }
            : {}),
        ...(definition.delayBetweenActions !== undefined
            ? { delayBetweenActions: definition.delayBetweenActions }
            : {}),
        ...(definition.customCss !== undefined ? { customCss: definition.customCss } : {}),
        ...(definition.conditions !== undefined
            ? { conditions: detach(definition.conditions) }
            : {}),
    };
}

function exportVariant(variant: StoredVariant, tools: ToolRegistry): TemplateVariant {
    return {
        id: variant.id,
        name: variant.name,
        ...(variant.trigger !== undefined ? { trigger: detach(variant.trigger) } : {}),
        ...(variant.fallback === true ? { fallback: true } : {}),
        ...exportDimensions(variant),
        ...exportCellStyles(variant.cellStyles),
        placements: exportPlacements(variant.placements, tools),
    };
}

function exportCategory(category: StoredCategory, tools: ToolRegistry): TemplateCategory {
    return {
        id: category.id,
        name: category.name,
        ...(category.layout !== undefined ? { layout: category.layout } : {}),
        ...(category.conditions !== undefined
            ? { conditions: detach(category.conditions) }
            : {}),
        ...exportDimensions(category),
        ...exportCellStyles(category.cellStyles),
        placements: exportPlacements(category.placements, tools),
        ...(Array.isArray(category.variants)
            ? {
                  variants: category.variants.map((variant) =>
                      exportVariant(variant, tools)
                  ),
              }
            : {}),
    };
}

/** Every tool id the exported categories reference, in first-seen order. */
function referencedToolIds(categories: readonly TemplateCategory[]): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    const visit = (placements: readonly TemplatePlacement[]): void => {
        for (const placement of placements) {
            if (seen.has(placement.toolId)) continue;
            seen.add(placement.toolId);
            ids.push(placement.toolId);
        }
    };
    for (const category of categories) {
        visit(category.placements);
        for (const variant of category.variants ?? []) {
            visit(variant.placements);
        }
    }
    return ids;
}

/**
 * Build the portable document for `categoryIds`, in the order given. Ids that
 * do not resolve are skipped; the result is a complete, self-contained
 * document (every placement's tool is present in `tools`).
 */
export function buildTemplateDocument(
    state: ToolState,
    categoryIds: readonly string[],
    meta?: TemplateMeta
): TemplateDocument {
    const stored = categoryIds
        .map((id) => state.categories.find((category) => category.id === id))
        .filter((category): category is StoredCategory => category !== undefined);

    const categories = stored.map((category) => exportCategory(category, state.tools));

    const tools: Record<string, TemplateTool> = {};
    for (const toolId of referencedToolIds(categories)) {
        const definition = state.tools[toolId];
        if (!definition) continue;
        tools[toolId] = exportToolDefinition(definition);
    }

    return {
        format: OCAP_TEMPLATE_FORMAT,
        formatVersion: OCAP_TEMPLATE_FORMAT_VERSION,
        ...(meta !== undefined ? { meta } : {}),
        categories,
        tools,
    };
}

/** The document as the file content it is written as. */
export function serializeTemplateDocument(document: TemplateDocument): string {
    return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * File name for an exported category: the category name reduced to characters
 * that are safe in a vault path, plus the template extension. Empty or fully
 * stripped names fall back to `template`.
 */
export function templateFileName(categoryName: string): string {
    const base = categoryName
        // Everything Obsidian/OS paths dislike, plus leading/trailing dots.
        .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\.+|\.+$/g, '')
        .trim();
    const safe = base.length > 0 ? base.slice(0, 80) : 'template';
    return `${safe}${OCAP_TEMPLATE_FILE_EXTENSION}`;
}
