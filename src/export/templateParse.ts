// export/templateParse.ts
// THE trust boundary of the template feature.
//
// A template file is EXTERNAL INPUT: it may be hand-written, truncated,
// produced by a newer build, or hostile. Everything downstream of this module
// (templateImport.ts) works on a TemplateDocument and may assume it is
// structurally sound, which is only true because nothing else is ever handed
// through.
//
// Rules applied here:
// - parse, then REBUILD. No parsed object is ever spread into the result and
//   no unknown property is ever adopted; every field is read by name and
//   copied explicitly, so a document cannot smuggle extra keys into settings;
// - object keys that come from the document (tool ids) are checked against
//   the prototype-pollution names before being used as map keys, and the
//   internal id maps are real `Map`s rather than object literals;
// - size and depth limits, so a malformed or malicious file cannot turn into
//   unbounded work;
// - actions and conditions are validated as DATA against the known unions.
//   Parsing never constructs an action object, never resolves a path and
//   never runs a script — importing a template does not execute anything;
// - external targets (file paths, script names, command ids) are accepted as
//   opaque strings. Whether they resolve in this vault is deliberately NOT
//   checked here (see templateImport.ts).
//
// Versioning: `formatVersion` is the PORTABLE version and has nothing to do
// with settingsVersion. A document from a newer format version is rejected
// with a clear reason instead of being best-effort guessed at; older versions
// would be migrated in `migrateTemplateDocument` below.

import type { ButtonAction, DocumentSectionRef, PdfDestination } from '@/types/action';
import type { ButtonCondition } from '@/types/conditions';
import type { GridCellStyle, GridCellStyles } from '@/types/settings';
import { isGridCellColor, parseGridCellKey } from '@/utils/categoryGrid';
import {
    OCAP_TEMPLATE_FORMAT,
    OCAP_TEMPLATE_FORMAT_VERSION,
    type TemplateCategory,
    type TemplateDocument,
    type TemplateParseError,
    type TemplateParseResult,
    type TemplatePlacement,
    type TemplateTool,
    type TemplateVariant,
} from '@/export/templateFormat';

// --- Limits -------------------------------------------------------------------
// Generous enough for any real panel, finite enough that a hostile file cannot
// turn an import into unbounded work or an unbounded settings file.

const MAX_CATEGORIES = 100;
const MAX_VARIANTS_PER_CATEGORY = 100;
const MAX_PLACEMENTS_PER_GRID = 1000;
const MAX_TOOLS = 5000;
const MAX_ACTIONS_PER_TOOL = 100;
const MAX_CELL_STYLES_PER_GRID = 1000;
const MAX_CONDITION_DEPTH = 32;
const MAX_CONDITION_CHILDREN = 100;
const MAX_ID_LENGTH = 200;
const MAX_NAME_LENGTH = 500;
/** Icons are stored SVG markup and custom CSS can be a block; both stay small. */
const MAX_TEXT_LENGTH = 100_000;

/** Keys that must never be used as an object key built from external data. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// --- Failure plumbing -----------------------------------------------------------

class TemplateValidationError extends Error {
    constructor(
        readonly error: TemplateParseError,
        message?: string
    ) {
        super(message ?? `${error.kind}${error.detail ? `: ${error.detail}` : ''}`);
        this.name = 'TemplateValidationError';
    }
}

function invalid(detail: string): never {
    throw new TemplateValidationError({ kind: 'invalid_structure', detail });
}

// --- Primitive readers ----------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function own(source: Record<string, unknown>, key: string): unknown {
    return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
}

function readObject(value: unknown, path: string): Record<string, unknown> {
    if (!isPlainObject(value)) {
        invalid(`${path} must be an object`);
    }
    return value;
}

function readArray(value: unknown, path: string, max: number): unknown[] {
    if (!Array.isArray(value)) {
        invalid(`${path} must be an array`);
    }
    if (value.length > max) {
        invalid(`${path} has more than ${max} entries`);
    }
    return value;
}

function readString(value: unknown, path: string, max: number): string {
    if (typeof value !== 'string') {
        invalid(`${path} must be a string`);
    }
    if (value.length > max) {
        invalid(`${path} is longer than ${max} characters`);
    }
    return value;
}

function readOptionalString(
    value: unknown,
    path: string,
    max: number
): string | undefined {
    return value === undefined ? undefined : readString(value, path, max);
}

function readId(value: unknown, path: string): string {
    const id = readString(value, path, MAX_ID_LENGTH);
    if (id.length === 0) {
        invalid(`${path} must not be empty`);
    }
    if (UNSAFE_KEYS.has(id)) {
        invalid(`${path} uses a reserved name`);
    }
    return id;
}

function readOptionalBoolean(value: unknown, path: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') {
        invalid(`${path} must be a boolean`);
    }
    return value;
}

function readOptionalInteger(
    value: unknown,
    path: string,
    min: number
): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
        invalid(`${path} must be an integer >= ${min}`);
    }
    return value;
}

// --- Conditions -----------------------------------------------------------------

const PATH_OPS = new Set(['equals', 'startsWith', 'contains']);
const FILE_NAME_OPS = new Set(['equals', 'startsWith', 'contains', 'endsWith']);
const FOLDER_OPS = new Set(['equals', 'startsWith']);
const PROPERTY_OPS = new Set(['exists', 'equals']);

function readOp(value: unknown, allowed: Set<string>, path: string): string {
    const op = readString(value, path, 64);
    if (!allowed.has(op)) {
        invalid(`${path} has unknown operator "${op}"`);
    }
    return op;
}

/**
 * Validate and REBUILD one condition node. The result is a fresh tree built
 * from known fields only — a document can neither add properties to a rule nor
 * hand through an object identity.
 */
function readCondition(value: unknown, path: string, depth = 0): ButtonCondition {
    if (depth > MAX_CONDITION_DEPTH) {
        invalid(`${path} nests deeper than ${MAX_CONDITION_DEPTH} levels`);
    }
    const node = readObject(value, path);

    if (own(node, 'all') !== undefined || own(node, 'any') !== undefined) {
        const kind = own(node, 'all') !== undefined ? 'all' : 'any';
        const children = readArray(
            own(node, kind),
            `${path}.${kind}`,
            MAX_CONDITION_CHILDREN
        ).map((child, index) =>
            readCondition(child, `${path}.${kind}[${index}]`, depth + 1)
        );
        return kind === 'all' ? { all: children } : { any: children };
    }
    if (own(node, 'not') !== undefined) {
        return { not: readCondition(own(node, 'not'), `${path}.not`, depth + 1) };
    }

    const rule = readString(own(node, 'rule'), `${path}.rule`, 64);
    switch (rule) {
        case 'viewType':
            return {
                rule: 'viewType',
                value: readString(own(node, 'value'), `${path}.value`, MAX_NAME_LENGTH),
            };
        case 'extension':
            return {
                rule: 'extension',
                value: readString(own(node, 'value'), `${path}.value`, MAX_NAME_LENGTH),
            };
        case 'tag':
            return {
                rule: 'tag',
                value: readString(own(node, 'value'), `${path}.value`, MAX_NAME_LENGTH),
            };
        case 'fileName':
            return {
                rule: 'fileName',
                op: readOp(own(node, 'op'), FILE_NAME_OPS, `${path}.op`) as
                    | 'equals'
                    | 'startsWith'
                    | 'contains'
                    | 'endsWith',
                value: readString(own(node, 'value'), `${path}.value`, MAX_TEXT_LENGTH),
            };
        case 'path':
            return {
                rule: 'path',
                op: readOp(own(node, 'op'), PATH_OPS, `${path}.op`) as
                    | 'equals'
                    | 'startsWith'
                    | 'contains',
                value: readString(own(node, 'value'), `${path}.value`, MAX_TEXT_LENGTH),
            };
        case 'folder':
            return {
                rule: 'folder',
                op: readOp(own(node, 'op'), FOLDER_OPS, `${path}.op`) as
                    | 'equals'
                    | 'startsWith',
                value: readString(own(node, 'value'), `${path}.value`, MAX_TEXT_LENGTH),
            };
        case 'property': {
            const op = readOp(own(node, 'op'), PROPERTY_OPS, `${path}.op`) as
                | 'exists'
                | 'equals';
            const raw = own(node, 'value');
            if (
                raw !== undefined &&
                typeof raw !== 'string' &&
                typeof raw !== 'number' &&
                typeof raw !== 'boolean'
            ) {
                invalid(`${path}.value must be a string, number or boolean`);
            }
            if (typeof raw === 'string' && raw.length > MAX_TEXT_LENGTH) {
                invalid(`${path}.value is longer than ${MAX_TEXT_LENGTH} characters`);
            }
            return {
                rule: 'property',
                key: readString(own(node, 'key'), `${path}.key`, MAX_NAME_LENGTH),
                op,
                ...(raw !== undefined ? { value: raw } : {}),
            };
        }
        default:
            invalid(`${path}.rule has unknown value "${rule}"`);
    }
}

function readOptionalCondition(
    value: unknown,
    path: string
): ButtonCondition | undefined {
    return value === undefined ? undefined : readCondition(value, path);
}

// --- Actions --------------------------------------------------------------------

/** A non-negative integer of an imported payload, or undefined. */
function optionalPageIndex(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
        ? value
        : undefined;
}

/**
 * Rebuild a PDF destination array, or drop it.
 *
 * `[pageIndex, { name }, …numbers-or-null]`. Rebuilt element by element like
 * everything else crossing this boundary; it is data a reader navigates by, and
 * a malformed one costs the precise landing, never the tool.
 */
function readDestination(value: unknown): PdfDestination | undefined {
    // Kept `unknown[]`: `Array.isArray` on an `unknown` widens to `any[]`, which
    // would silently disable every check below it.
    if (!Array.isArray(value) || value.length < 2) return undefined;
    const entries: unknown[] = value as unknown[];
    const page = optionalPageIndex(entries[0]);
    const kind = entries[1];
    if (page === undefined || !kind || typeof kind !== 'object' || Array.isArray(kind)) {
        return undefined;
    }
    const name = (kind as { name?: unknown }).name;
    if (typeof name !== 'string' || name.length === 0 || name.length > 32) return undefined;
    const rest: Array<number | null> = [];
    for (const entry of entries.slice(2)) {
        if (entry === null) rest.push(null);
        else if (typeof entry === 'number' && Number.isFinite(entry)) rest.push(entry);
        else return undefined;
    }
    return [page, { name }, ...rest];
}

/**
 * Rebuild the section description of a `file` action, or drop it.
 *
 * Deliberately lenient where the rest of this file is strict: a section is
 * DESCRIPTION, never instruction. Nothing is executed from it and nothing
 * depends on it, so a template carrying a damaged one should import with the
 * tool intact and the description gone — refusing the whole file would trade a
 * working shortcut for a missing tooltip. The title and page index are the
 * minimum that still describes something; without them there is nothing to keep.
 */
function readSection(value: unknown, path: string): DocumentSectionRef | undefined {
    if (value === undefined || value === null || typeof value !== 'object') {
        return undefined;
    }
    const node = value as Record<string, unknown>;
    const rawTitle = own(node, 'title');
    const pageIndex = optionalPageIndex(own(node, 'pageIndex'));
    if (typeof rawTitle !== 'string' || rawTitle.trim().length === 0 || pageIndex === undefined) {
        return undefined;
    }
    const title = readString(rawTitle, `${path}.title`, MAX_TEXT_LENGTH).trim();
    const parentsValue = own(node, 'parents');
    const parents = Array.isArray(parentsValue)
        ? (parentsValue as unknown[])
              .filter((entry): entry is string => typeof entry === 'string')
              .map((entry) => readString(entry, `${path}.parents[]`, MAX_TEXT_LENGTH).trim())
              .filter((entry) => entry.length > 0)
        : [];
    const rawLabel = own(node, 'pageLabel');
    const pageLabel =
        typeof rawLabel === 'string' && rawLabel.trim().length > 0
            ? readString(rawLabel, `${path}.pageLabel`, MAX_TEXT_LENGTH).trim()
            : undefined;
    const nextPageIndex = optionalPageIndex(own(node, 'nextPageIndex'));
    const dest = readDestination(own(node, 'dest'));

    return {
        title,
        level: optionalPageIndex(own(node, 'level')) ?? 0,
        ...(parents.length > 0 ? { parents } : {}),
        pageIndex,
        ...(dest ? { dest } : {}),
        ...(pageLabel !== undefined ? { pageLabel } : {}),
        ...(nextPageIndex !== undefined && nextPageIndex > pageIndex ? { nextPageIndex } : {}),
    };
}

/**
 * Validate and rebuild one action. Only the parameters the action type knows
 * are copied; external targets (file path, script name, command id, URL) are
 * carried through VERBATIM and are never resolved, normalized or executed.
 */
function readAction(value: unknown, path: string): ButtonAction {
    const node = readObject(value, path);
    const type = readString(own(node, 'type'), `${path}.type`, 64);
    const parameters = readObject(own(node, 'parameters'), `${path}.parameters`);

    switch (type) {
        case 'file':
            return {
                type: 'file',
                parameters: {
                    filePath: readString(
                        own(parameters, 'filePath'),
                        `${path}.parameters.filePath`,
                        MAX_TEXT_LENGTH
                    ),
                    ...(own(parameters, 'subpath') !== undefined
                        ? {
                              subpath: readString(
                                  own(parameters, 'subpath'),
                                  `${path}.parameters.subpath`,
                                  MAX_TEXT_LENGTH
                              ),
                          }
                        : {}),
                    // A section describes what the subpath points at. It is
                    // rebuilt rather than copied, like everything else crossing
                    // this boundary, and a malformed one is dropped instead of
                    // rejecting the template: the tool still opens and still
                    // navigates without it.
                    ...(() => {
                        const section = readSection(
                            own(parameters, 'section'),
                            `${path}.parameters.section`
                        );
                        return section ? { section } : {};
                    })(),
                },
            };
        case 'url':
            return {
                type: 'url',
                parameters: {
                    url: readString(
                        own(parameters, 'url'),
                        `${path}.parameters.url`,
                        MAX_TEXT_LENGTH
                    ),
                },
            };
        case 'script':
            return {
                type: 'script',
                parameters: {
                    scriptName: readString(
                        own(parameters, 'scriptName'),
                        `${path}.parameters.scriptName`,
                        MAX_TEXT_LENGTH
                    ),
                },
            };
        case 'command': {
            const args = own(parameters, 'args');
            if (args !== undefined && !Array.isArray(args)) {
                invalid(`${path}.parameters.args must be an array`);
            }
            return {
                type: 'command',
                parameters: {
                    commandId: readString(
                        own(parameters, 'commandId'),
                        `${path}.parameters.commandId`,
                        MAX_TEXT_LENGTH
                    ),
                    // Opaque payload of the stored command action; rebuilt as
                    // plain JSON so no object identity survives the boundary.
                    ...(args !== undefined
                        ? { args: JSON.parse(JSON.stringify(args)) as unknown[] }
                        : {}),
                },
            };
        }
        case 'create_file':
            return {
                type: 'create_file',
                parameters: {
                    fileName: readString(
                        own(parameters, 'fileName'),
                        `${path}.parameters.fileName`,
                        MAX_TEXT_LENGTH
                    ),
                    ...(own(parameters, 'folderPath') !== undefined
                        ? {
                              folderPath: readString(
                                  own(parameters, 'folderPath'),
                                  `${path}.parameters.folderPath`,
                                  MAX_TEXT_LENGTH
                              ),
                          }
                        : {}),
                    ...(own(parameters, 'templateName') !== undefined
                        ? {
                              templateName: readString(
                                  own(parameters, 'templateName'),
                                  `${path}.parameters.templateName`,
                                  MAX_TEXT_LENGTH
                              ),
                          }
                        : {}),
                },
            };
        default:
            invalid(`${path}.type has unknown value "${type}"`);
    }
}

// --- Cell styles -----------------------------------------------------------------

function readCellStyles(value: unknown, path: string): GridCellStyles | undefined {
    if (value === undefined) return undefined;
    const source = readObject(value, path);
    const keys = Object.keys(source);
    if (keys.length > MAX_CELL_STYLES_PER_GRID) {
        invalid(`${path} has more than ${MAX_CELL_STYLES_PER_GRID} entries`);
    }
    const styles: GridCellStyles = {};
    let count = 0;
    for (const key of keys) {
        // The key grammar (`r<row>c<column>`) is also what makes the key safe
        // to use as an object key: it can never be a prototype name.
        if (parseGridCellKey(key) === null) {
            invalid(`${path} has invalid cell key "${key}"`);
        }
        const entry = readObject(own(source, key), `${path}.${key}`);
        const color = own(entry, 'color');
        const style: GridCellStyle = {};
        if (color !== undefined) {
            if (!isGridCellColor(color)) {
                invalid(`${path}.${key}.color is not a portable color value`);
            }
            style.color = color;
        }
        styles[key] = style;
        count += 1;
    }
    return count === 0 ? undefined : styles;
}

// --- Document parts ----------------------------------------------------------------

function readPlacements(value: unknown, path: string): TemplatePlacement[] {
    if (value === undefined) {
        return [];
    }
    return readArray(value, path, MAX_PLACEMENTS_PER_GRID).map((entry, index) => {
        const node = readObject(entry, `${path}[${index}]`);
        const slot = readOptionalInteger(own(node, 'slot'), `${path}[${index}].slot`, 0);
        return {
            toolId: readId(own(node, 'toolId'), `${path}[${index}].toolId`),
            ...(slot !== undefined ? { slot } : {}),
        };
    });
}

function readTool(value: unknown, key: string, path: string): TemplateTool {
    const node = readObject(value, path);
    const declared = own(node, 'id');
    if (declared !== undefined && readString(declared, `${path}.id`, MAX_ID_LENGTH) !== key) {
        invalid(`${path}.id does not match its registry key "${key}"`);
    }
    const actions = readArray(
        own(node, 'actions') ?? [],
        `${path}.actions`,
        MAX_ACTIONS_PER_TOOL
    ).map((action, index) => readAction(action, `${path}.actions[${index}]`));

    const executionMode = own(node, 'executionMode');
    if (
        executionMode !== undefined &&
        executionMode !== 'sequential' &&
        executionMode !== 'parallel'
    ) {
        invalid(`${path}.executionMode must be "sequential" or "parallel"`);
    }
    const stopOnError = readOptionalBoolean(own(node, 'stopOnError'), `${path}.stopOnError`);
    const delay = readOptionalInteger(
        own(node, 'delayBetweenActions'),
        `${path}.delayBetweenActions`,
        0
    );
    const icon = readOptionalString(own(node, 'icon'), `${path}.icon`, MAX_TEXT_LENGTH);
    const tooltip = readOptionalString(own(node, 'tooltip'), `${path}.tooltip`, MAX_TEXT_LENGTH);
    const customCss = readOptionalString(
        own(node, 'customCss'),
        `${path}.customCss`,
        MAX_TEXT_LENGTH
    );
    const conditions = readOptionalCondition(own(node, 'conditions'), `${path}.conditions`);

    return {
        id: key,
        name: readString(own(node, 'name') ?? '', `${path}.name`, MAX_NAME_LENGTH),
        ...(icon !== undefined ? { icon } : {}),
        ...(tooltip !== undefined ? { tooltip } : {}),
        actions,
        ...(executionMode !== undefined
            ? { executionMode }
            : {}),
        ...(stopOnError !== undefined ? { stopOnError } : {}),
        ...(delay !== undefined ? { delayBetweenActions: delay } : {}),
        ...(customCss !== undefined ? { customCss } : {}),
        ...(conditions !== undefined ? { conditions } : {}),
    };
}

function readVariant(value: unknown, path: string): TemplateVariant {
    const node = readObject(value, path);
    const trigger = readOptionalCondition(own(node, 'trigger'), `${path}.trigger`);
    const fallback = readOptionalBoolean(own(node, 'fallback'), `${path}.fallback`);
    const rows = readOptionalInteger(own(node, 'rows'), `${path}.rows`, 1);
    const columns = readOptionalInteger(own(node, 'columns'), `${path}.columns`, 1);
    const cellStyles = readCellStyles(own(node, 'cellStyles'), `${path}.cellStyles`);
    return {
        id: readId(own(node, 'id'), `${path}.id`),
        name: readString(own(node, 'name') ?? '', `${path}.name`, MAX_NAME_LENGTH),
        ...(trigger !== undefined ? { trigger } : {}),
        ...(fallback === true ? { fallback: true } : {}),
        ...(rows !== undefined ? { rows } : {}),
        ...(columns !== undefined ? { columns } : {}),
        ...(cellStyles !== undefined ? { cellStyles } : {}),
        placements: readPlacements(own(node, 'placements'), `${path}.placements`),
    };
}

function readCategory(value: unknown, path: string): TemplateCategory {
    const node = readObject(value, path);
    const layout = own(node, 'layout');
    if (layout !== undefined && layout !== 'flow' && layout !== 'grid') {
        invalid(`${path}.layout must be "flow" or "grid"`);
    }
    const conditions = readOptionalCondition(own(node, 'conditions'), `${path}.conditions`);
    const rows = readOptionalInteger(own(node, 'rows'), `${path}.rows`, 1);
    const columns = readOptionalInteger(own(node, 'columns'), `${path}.columns`, 1);
    const cellStyles = readCellStyles(own(node, 'cellStyles'), `${path}.cellStyles`);

    const rawVariants = own(node, 'variants');
    let variants: TemplateVariant[] | undefined;
    if (rawVariants !== undefined) {
        variants = readArray(
            rawVariants,
            `${path}.variants`,
            MAX_VARIANTS_PER_CATEGORY
        ).map((variant, index) => readVariant(variant, `${path}.variants[${index}]`));

        const ids = new Set<string>();
        let fallbacks = 0;
        for (const variant of variants) {
            if (ids.has(variant.id)) {
                invalid(`${path}.variants has duplicate id "${variant.id}"`);
            }
            ids.add(variant.id);
            if (variant.fallback === true) fallbacks += 1;
        }
        // The domain allows at most one fallback per category; a document with
        // two would import into a state the operations themselves refuse.
        if (fallbacks > 1) {
            invalid(`${path}.variants declares more than one fallback variant`);
        }
    }

    return {
        id: readId(own(node, 'id'), `${path}.id`),
        name: readString(own(node, 'name') ?? '', `${path}.name`, MAX_NAME_LENGTH),
        ...(layout !== undefined ? { layout } : {}),
        ...(conditions !== undefined ? { conditions } : {}),
        ...(rows !== undefined ? { rows } : {}),
        ...(columns !== undefined ? { columns } : {}),
        ...(cellStyles !== undefined ? { cellStyles } : {}),
        placements: readPlacements(own(node, 'placements'), `${path}.placements`),
        ...(variants !== undefined ? { variants } : {}),
    };
}

/**
 * Future migration boundary. v1 is the only format there is, so this is a
 * pass-through today — but it is the ONE place a v1 document would be lifted
 * to v2, so that knowledge never spreads across the importer.
 */
function migrateTemplateDocument(document: TemplateDocument): TemplateDocument {
    return document;
}

// --- Entry points ---------------------------------------------------------------

/** Validate an already-parsed JSON value as a template document. */
export function validateTemplateDocument(raw: unknown): TemplateParseResult {
    try {
        const root = isPlainObject(raw) ? raw : null;
        if (!root || own(root, 'format') !== OCAP_TEMPLATE_FORMAT) {
            return {
                ok: false,
                error: {
                    kind: 'not_a_template',
                    detail: String(root ? own(root, 'format') : typeof raw),
                },
            };
        }

        const version = own(root, 'formatVersion');
        if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
            return {
                ok: false,
                error: { kind: 'invalid_structure', detail: 'formatVersion' },
            };
        }
        if (version > OCAP_TEMPLATE_FORMAT_VERSION) {
            return {
                ok: false,
                error: { kind: 'unsupported_version', detail: String(version) },
            };
        }

        const categories = readArray(
            own(root, 'categories'),
            'categories',
            MAX_CATEGORIES
        ).map((category, index) => readCategory(category, `categories[${index}]`));
        if (categories.length === 0) {
            invalid('categories must not be empty');
        }
        const categoryIds = new Set<string>();
        for (const category of categories) {
            if (categoryIds.has(category.id)) {
                invalid(`categories has duplicate id "${category.id}"`);
            }
            categoryIds.add(category.id);
        }

        const rawTools = readObject(own(root, 'tools') ?? {}, 'tools');
        const toolKeys = Object.keys(rawTools);
        if (toolKeys.length > MAX_TOOLS) {
            invalid(`tools has more than ${MAX_TOOLS} entries`);
        }
        // Built as a null-prototype record and keyed only by checked names, so
        // a document can never reach Object.prototype through a tool id.
        const tools: Record<string, TemplateTool> = Object.create(null) as Record<
            string,
            TemplateTool
        >;
        for (const key of toolKeys) {
            if (UNSAFE_KEYS.has(key)) {
                invalid(`tools uses the reserved key "${key}"`);
            }
            if (key.length === 0 || key.length > MAX_ID_LENGTH) {
                invalid('tools has an invalid key');
            }
            tools[key] = readTool(own(rawTools, key), key, `tools["${key}"]`);
        }

        // Internal completeness: every placement must resolve inside the
        // package. A dangling reference is a broken template, not something to
        // silently drop — dropping it would import a grid with holes the user
        // never designed.
        for (const category of categories) {
            const check = (placements: TemplatePlacement[], where: string): void => {
                for (const placement of placements) {
                    if (!Object.prototype.hasOwnProperty.call(tools, placement.toolId)) {
                        throw new TemplateValidationError({
                            kind: 'dangling_tool_reference',
                            detail: `${where} -> ${placement.toolId}`,
                        });
                    }
                }
            };
            check(category.placements, `category "${category.name || category.id}"`);
            for (const variant of category.variants ?? []) {
                check(
                    variant.placements,
                    `variant "${variant.name || variant.id}" of "${category.name || category.id}"`
                );
            }
        }

        const meta = own(root, 'meta');
        const document: TemplateDocument = {
            format: OCAP_TEMPLATE_FORMAT,
            formatVersion: version,
            ...(isPlainObject(meta)
                ? {
                      meta: {
                          ...(typeof own(meta, 'pluginVersion') === 'string'
                              ? { pluginVersion: own(meta, 'pluginVersion') as string }
                              : {}),
                          ...(typeof own(meta, 'exportedAt') === 'string'
                              ? { exportedAt: own(meta, 'exportedAt') as string }
                              : {}),
                      },
                  }
                : {}),
            categories,
            tools,
        };
        return { ok: true, document: migrateTemplateDocument(document) };
    } catch (error) {
        if (error instanceof TemplateValidationError) {
            return { ok: false, error: error.error };
        }
        return {
            ok: false,
            error: {
                kind: 'invalid_structure',
                detail: error instanceof Error ? error.message : String(error),
            },
        };
    }
}

/** Parse raw file content as a template document. */
export function parseTemplateDocument(content: string): TemplateParseResult {
    let raw: unknown;
    try {
        raw = JSON.parse(content);
    } catch (error) {
        return {
            ok: false,
            error: {
                kind: 'invalid_json',
                detail: error instanceof Error ? error.message : String(error),
            },
        };
    }
    return validateTemplateDocument(raw);
}
