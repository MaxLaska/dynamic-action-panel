// export/templateImport.ts
// Turning a validated template document into the NEXT stored state — purely,
// in one piece, without touching anything that already exists.
//
// Rules (see docs/ocap/template-format.md):
// - IMPORT CREATES, IT NEVER MERGES. Every category, variant and tool gets a
//   FRESH OCAP id and every reference inside the package is rewritten to it.
//   Ids in a document are package-local references, never identities, so two
//   imports of the same file produce two independent sets and an import can
//   never overwrite an existing object just because an id happens to match;
// - no deduplication against the existing registry. An imported tool that
//   looks exactly like one already in the vault stays a separate definition —
//   matching on name/action/icon/hash would create invisible coupling between
//   the user's own tools and imported ones (a later, explicit feature);
// - a tool referenced by two placements INSIDE the document stays one
//   definition afterwards, because that is what the exported panel was;
// - external targets (file paths, script names, command ids) are carried
//   through byte for byte. Whether they resolve here is not the import's
//   business: the runtime already fails lazily with a Notice, which is what
//   makes a template usable before its files exist;
// - the plan is DATA. The caller commits it through the one existing commit
//   funnel (commitToolState), so a failed validation leaves no half category,
//   no half tool and no registry corpse behind.

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
    clampGridDimensions,
    readGridDimensions,
    resizeGridCellStyles,
    withCellStyles,
} from '@/utils/categoryGrid';
import type {
    TemplateCategory,
    TemplateDocument,
    TemplatePlacement,
    TemplateTool,
    TemplateVariant,
} from '@/export/templateFormat';

/** The kinds of identity an import mints. */
export type TemplateIdKind = 'cat' | 'var' | 'tool';

export interface TemplateImportOptions {
    /** Fresh OCAP id factory (production: `(kind) => freshId(kind)`). */
    newId: (kind: TemplateIdKind) => string;
    /**
     * Word used to mark an imported category whose name is already taken,
     * e.g. `Research` -> `Research (imported)`. Supplied by the caller so the
     * pure planner stays locale-free.
     */
    importedSuffix?: string;
}

export interface TemplateImportSummary {
    /** Categories created. */
    categoryCount: number;
    /** Tool definitions created. */
    toolCount: number;
    /** Names the categories ended up with (after collision handling). */
    categoryNames: string[];
}

export interface TemplateImportPlan {
    /** The complete next state — commit it in ONE step. */
    state: ToolState;
    summary: TemplateImportSummary;
}

const DEFAULT_IMPORTED_SUFFIX = 'imported';

/**
 * A name that is not in use yet.
 *
 * Duplicate category names are technically harmless in OCAP (ids are the
 * identity, and "Copy category" already produces two categories with the same
 * name), so this is purely about the user being able to tell the imported
 * panel from the one they already had: `Research` -> `Research (imported)` ->
 * `Research (imported 2)`. A name that is free is never touched.
 */
function uniqueCategoryName(name: string, taken: Set<string>, suffix: string): string {
    if (!taken.has(name)) {
        return name;
    }
    const first = `${name} (${suffix})`;
    if (!taken.has(first)) {
        return first;
    }
    for (let n = 2; n < 1000; n += 1) {
        const candidate = `${name} (${suffix} ${n})`;
        if (!taken.has(candidate)) {
            return candidate;
        }
    }
    return `${name} (${suffix} ${taken.size + 1})`;
}

/** Placements with their tool references rewritten to the fresh ids. */
function importPlacements(
    placements: readonly TemplatePlacement[],
    toolIds: Map<string, string>
): ToolPlacement[] {
    const imported: ToolPlacement[] = [];
    for (const placement of placements) {
        const toolId = toolIds.get(placement.toolId);
        if (toolId === undefined) {
            // The parser guarantees every reference resolves; this is the
            // belt-and-braces branch that keeps the state consistent even if
            // that ever stopped being true.
            continue;
        }
        imported.push({
            toolId,
            ...(placement.slot !== undefined ? { slot: placement.slot } : {}),
        });
    }
    return imported;
}

/**
 * Cell styles of an imported grid, restricted to cells that grid actually has.
 * Same rule the resize uses: a key names a logical cell, and a cell outside
 * the grid does not exist.
 */
function importCellStyles(
    styles: GridCellStyles | undefined,
    dimensionFields: { rows?: number; columns?: number }
): GridCellStyles | undefined {
    return resizeGridCellStyles(styles, readGridDimensions(dimensionFields));
}

function importDimensions(source: {
    rows?: number;
    columns?: number;
}): { rows?: number; columns?: number } {
    if (source.rows === undefined && source.columns === undefined) {
        // No size in the document means the historical 4x4 — write nothing, so
        // the imported grid keeps reading exactly like the exported one did.
        return {};
    }
    const clamped = clampGridDimensions(readGridDimensions(source));
    return { rows: clamped.rows, columns: clamped.columns };
}

function importVariant(
    variant: TemplateVariant,
    toolIds: Map<string, string>,
    newId: (kind: TemplateIdKind) => string
): StoredVariant {
    const dimensions = importDimensions(variant);
    const cellStyles = importCellStyles(variant.cellStyles, dimensions);
    return {
        id: newId('var'),
        name: variant.name,
        ...(variant.fallback === true
            ? { fallback: true as const }
            : variant.trigger !== undefined
              ? { trigger: variant.trigger }
              : {}),
        ...dimensions,
        ...withCellStyles(cellStyles),
        placements: importPlacements(variant.placements, toolIds),
    };
}

function importCategory(
    category: TemplateCategory,
    order: number,
    name: string,
    toolIds: Map<string, string>,
    newId: (kind: TemplateIdKind) => string
): StoredCategory {
    const dimensions = importDimensions(category);
    const cellStyles = importCellStyles(category.cellStyles, dimensions);
    const imported: StoredCategory = {
        id: newId('cat'),
        name,
        order,
        ...(category.layout !== undefined ? { layout: category.layout } : {}),
        ...(category.conditions !== undefined ? { conditions: category.conditions } : {}),
        ...dimensions,
        ...withCellStyles(cellStyles),
        placements: importPlacements(category.placements, toolIds),
    };
    if (category.variants !== undefined) {
        imported.variants = category.variants.map((variant) =>
            importVariant(variant, toolIds, newId)
        );
    }
    return imported;
}

/** The definition an imported tool becomes: functional half only, fresh id. */
function importToolDefinition(tool: TemplateTool, id: string): ToolDefinition {
    return {
        id,
        name: tool.name,
        ...(tool.icon !== undefined ? { icon: tool.icon } : {}),
        actions: tool.actions,
        ...(tool.executionMode !== undefined ? { executionMode: tool.executionMode } : {}),
        ...(tool.stopOnError !== undefined ? { stopOnError: tool.stopOnError } : {}),
        ...(tool.delayBetweenActions !== undefined
            ? { delayBetweenActions: tool.delayBetweenActions }
            : {}),
        ...(tool.customCss !== undefined ? { customCss: tool.customCss } : {}),
        ...(tool.conditions !== undefined ? { conditions: tool.conditions } : {}),
        // Deliberately no `library`: an imported tool is an ordinary ad-hoc
        // tool owned by its imported placements, exactly like a created one.
    };
}

/** Document tool ids that any exported placement actually references. */
function referencedToolIds(document: TemplateDocument): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    const visit = (placements: readonly TemplatePlacement[]): void => {
        for (const placement of placements) {
            if (seen.has(placement.toolId)) continue;
            seen.add(placement.toolId);
            ids.push(placement.toolId);
        }
    };
    for (const category of document.categories) {
        visit(category.placements);
        for (const variant of category.variants ?? []) {
            visit(variant.placements);
        }
    }
    return ids;
}

/**
 * Plan the import of a validated document against the current state.
 *
 * Pure: `state` is not mutated and the result is a complete next state, ready
 * for exactly ONE commit. A document with several categories imports as
 * several categories, appended in document order.
 */
export function planTemplateImport(
    state: ToolState,
    document: TemplateDocument,
    options: TemplateImportOptions
): TemplateImportPlan {
    const suffix = options.importedSuffix ?? DEFAULT_IMPORTED_SUFFIX;

    // One fresh definition per DOCUMENT tool id: a tool the package shares
    // between two placements stays shared afterwards (that is what the
    // exported panel was), while nothing is ever shared with the tools that
    // already live in this vault.
    const toolIds = new Map<string, string>();
    const tools: ToolRegistry = { ...state.tools };
    for (const documentToolId of referencedToolIds(document)) {
        const tool = document.tools[documentToolId];
        if (!tool) continue;
        const id = options.newId('tool');
        toolIds.set(documentToolId, id);
        tools[id] = importToolDefinition(tool, id);
    }

    const taken = new Set(state.categories.map((category) => category.name));
    const categories = [...state.categories];
    const categoryNames: string[] = [];
    document.categories.forEach((category, index) => {
        const name = uniqueCategoryName(category.name, taken, suffix);
        taken.add(name);
        categoryNames.push(name);
        categories.push(
            importCategory(
                category,
                state.categories.length + index,
                name,
                toolIds,
                options.newId
            )
        );
    });

    return {
        state: { tools, categories },
        summary: {
            categoryCount: document.categories.length,
            toolCount: toolIds.size,
            categoryNames,
        },
    };
}

/**
 * External targets a document references, for the post-import summary.
 *
 * Purely informational: a missing target is reported, never repaired and never
 * a reason to refuse the import. There is no path fixing, no fuzzy matching
 * and no substitute file — a template is allowed to be partly unsatisfied in
 * the vault it lands in.
 */
export interface TemplateExternalReferences {
    filePaths: string[];
    scriptNames: string[];
}

export function collectTemplateExternalReferences(
    document: TemplateDocument
): TemplateExternalReferences {
    const filePaths = new Set<string>();
    const scriptNames = new Set<string>();
    for (const toolId of Object.keys(document.tools)) {
        for (const action of document.tools[toolId]?.actions ?? []) {
            if (action.type === 'file' && action.parameters.filePath) {
                filePaths.add(action.parameters.filePath);
            } else if (action.type === 'script' && action.parameters.scriptName) {
                scriptNames.add(action.parameters.scriptName);
            }
        }
    }
    return { filePaths: [...filePaths], scriptNames: [...scriptNames] };
}
