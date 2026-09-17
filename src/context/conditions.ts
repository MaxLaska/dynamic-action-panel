// conditions.ts
// Pure validation and evaluation of the declarative condition model
// (src/types/conditions.ts) against an OCAPContextSnapshot.
//
// Guarantees:
// - deterministic pure functions, no exceptions for legitimate inputs;
// - missing context values (no file, no frontmatter) evaluate rules to false
//   instead of throwing;
// - structurally invalid condition data is detected by isValidCondition and
//   treated as "no condition" (fail-open: the button stays visible) so corrupt
//   settings can never lock users out of their buttons.

import type {
    ButtonCondition,
    ConditionRule,
    ConditionScalar,
} from '@/types/conditions';
import type { ButtonConfig, CategoryConfig } from '@/types/settings';
import type { OCAPContextSnapshot } from '@/context/OCAPContext';

/** Maximum nesting depth accepted by the validator (guards against cycles). */
export const MAX_CONDITION_DEPTH = 32;

const PATH_OPS = ['equals', 'startsWith', 'contains'] as const;
const FILE_NAME_OPS = ['equals', 'startsWith', 'contains', 'endsWith'] as const;
const FOLDER_OPS = ['equals', 'startsWith'] as const;
const PROPERTY_OPS = ['exists', 'equals'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is ConditionScalar {
    return (
        typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    );
}

function isValidRule(node: Record<string, unknown>): boolean {
    switch (node['rule']) {
        case 'viewType':
        case 'extension':
        case 'tag':
            return typeof node['value'] === 'string';
        case 'path':
            return (
                typeof node['value'] === 'string' &&
                PATH_OPS.includes(node['op'] as (typeof PATH_OPS)[number])
            );
        case 'fileName':
            return (
                typeof node['value'] === 'string' &&
                FILE_NAME_OPS.includes(node['op'] as (typeof FILE_NAME_OPS)[number])
            );
        case 'folder':
            return (
                typeof node['value'] === 'string' &&
                FOLDER_OPS.includes(node['op'] as (typeof FOLDER_OPS)[number])
            );
        case 'property': {
            if (typeof node['key'] !== 'string' || node['key'].length === 0) {
                return false;
            }
            if (!PROPERTY_OPS.includes(node['op'] as (typeof PROPERTY_OPS)[number])) {
                return false;
            }
            // 'equals' requires a scalar comparison value; 'exists' must not carry one.
            return node['op'] === 'equals'
                ? isScalar(node['value'])
                : node['value'] === undefined;
        }
        default:
            return false;
    }
}

function isValidConditionAtDepth(value: unknown, depth: number): boolean {
    if (depth > MAX_CONDITION_DEPTH || !isRecord(value)) {
        return false;
    }

    const groupKeys = (['all', 'any', 'not'] as const).filter((key) => key in value);
    if (groupKeys.length > 1) {
        return false;
    }

    const groupKey = groupKeys[0];
    if (groupKey !== undefined) {
        // Group nodes must be pure group nodes (no stray rule fields).
        if ('rule' in value) {
            return false;
        }
        if (groupKey === 'not') {
            return isValidConditionAtDepth(value['not'], depth + 1);
        }
        const children = value[groupKey];
        return (
            Array.isArray(children) &&
            children.every((child) => isValidConditionAtDepth(child, depth + 1))
        );
    }

    return isValidRule(value);
}

/**
 * Structural validation of untyped condition data (e.g. parsed JSON or
 * settings loaded from disk).
 */
export function isValidCondition(value: unknown): value is ButtonCondition {
    return isValidConditionAtDepth(value, 0);
}

/** Normalize a vault path for comparison: trim, forward slashes, no leading/trailing '/', lowercase. */
function normalizePathForCompare(value: string): string {
    return value
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '')
        .toLowerCase();
}

/** Segment-aware folder prefix match: 'a' matches 'a' and 'a/b' but not 'ab'. */
function folderStartsWith(folder: string, prefix: string): boolean {
    if (prefix.length === 0) {
        return true;
    }
    return folder === prefix || folder.startsWith(prefix + '/');
}

/** Loose scalar equality: primitives compared by normalized string, case-insensitive. */
function scalarEquals(actual: unknown, expected: ConditionScalar): boolean {
    if (
        typeof actual !== 'string' &&
        typeof actual !== 'number' &&
        typeof actual !== 'boolean'
    ) {
        return false;
    }
    return (
        String(actual).trim().toLowerCase() === String(expected).trim().toLowerCase()
    );
}

/** Tag match with nested-tag semantics: 'project' matches 'project' and 'project/x'. */
function tagMatches(contextTag: string, wanted: string): boolean {
    const tag = contextTag.toLowerCase();
    return tag === wanted || tag.startsWith(wanted + '/');
}

function evaluateRule(rule: ConditionRule, context: OCAPContextSnapshot): boolean {
    switch (rule.rule) {
        case 'viewType': {
            if (context.viewType === null) {
                return false;
            }
            return (
                context.viewType.trim().toLowerCase() === rule.value.trim().toLowerCase()
            );
        }
        case 'path': {
            if (context.filePath === null) {
                return false;
            }
            const path = normalizePathForCompare(context.filePath);
            const value = normalizePathForCompare(rule.value);
            switch (rule.op) {
                case 'equals':
                    return path === value;
                case 'startsWith':
                    return path.startsWith(value);
                case 'contains':
                    return path.includes(value);
            }
            return false;
        }
        case 'fileName': {
            if (context.fileName === null) {
                return false;
            }
            // Case-insensitive like every other string rule here; an empty
            // needle would make `startsWith`/`contains` match every file, so
            // an unfilled rule matches nothing instead.
            const name = context.fileName.trim().toLowerCase();
            const value = rule.value.trim().toLowerCase();
            if (value.length === 0) {
                return false;
            }
            switch (rule.op) {
                case 'equals':
                    return name === value;
                case 'startsWith':
                    return name.startsWith(value);
                case 'contains':
                    return name.includes(value);
                case 'endsWith':
                    return name.endsWith(value);
            }
            return false;
        }
        case 'folder': {
            if (context.folderPath === null) {
                return false;
            }
            const folder = normalizePathForCompare(context.folderPath);
            const value = normalizePathForCompare(rule.value);
            return rule.op === 'equals' ? folder === value : folderStartsWith(folder, value);
        }
        case 'extension': {
            if (context.fileExtension === null) {
                return false;
            }
            const wanted = rule.value.trim().toLowerCase().replace(/^\./, '');
            return context.fileExtension === wanted;
        }
        case 'property': {
            const hasKey = Object.prototype.hasOwnProperty.call(
                context.properties,
                rule.key
            );
            if (rule.op === 'exists') {
                return hasKey;
            }
            const expected = rule.value;
            if (!hasKey || expected === undefined) {
                return false;
            }
            const actual = context.properties[rule.key];
            if (Array.isArray(actual)) {
                return actual.some((entry) => scalarEquals(entry, expected));
            }
            return scalarEquals(actual, expected);
        }
        case 'tag': {
            const wanted = rule.value.trim().replace(/^#/, '').toLowerCase();
            if (wanted.length === 0) {
                return false;
            }
            return context.tags.some((tag) => tagMatches(tag, wanted));
        }
    }
    return false;
}

/**
 * Evaluate a (structurally valid) condition tree against a context snapshot.
 * Group semantics: `all` of [] holds; `any` of [] does not hold.
 */
export function evaluateCondition(
    condition: ButtonCondition,
    context: OCAPContextSnapshot
): boolean {
    if ('all' in condition) {
        return condition.all.every((child) => evaluateCondition(child, context));
    }
    if ('any' in condition) {
        return condition.any.some((child) => evaluateCondition(child, context));
    }
    if ('not' in condition) {
        return !evaluateCondition(condition.not, context);
    }
    return evaluateRule(condition, context);
}

/**
 * Visibility of a button in the given context.
 * - No conditions: always visible (100% upstream behavior).
 * - Invalid condition data: visible (fail-open; invalid data is surfaced at
 *   edit time in the conditions input, never by hiding buttons).
 */
export function isButtonVisibleInContext(
    button: ButtonConfig,
    context: OCAPContextSnapshot
): boolean {
    const conditions = button.conditions;
    if (conditions === undefined || conditions === null) {
        return true;
    }
    if (!isValidCondition(conditions)) {
        return true;
    }
    return evaluateCondition(conditions, context);
}

/**
 * Visibility of a category's own condition in the given context.
 * Same semantics as buttons: no condition => visible; structurally invalid
 * condition data fails open (visible).
 * Note: this only evaluates the category's own condition; whether the
 * category is actually rendered in locked mode additionally requires at
 * least one visible button (see filterCategoriesByContext).
 */
export function isCategoryVisibleInContext(
    category: CategoryConfig,
    context: OCAPContextSnapshot
): boolean {
    const conditions = category.conditions;
    if (conditions === undefined || conditions === null) {
        return true;
    }
    if (!isValidCondition(conditions)) {
        return true;
    }
    return evaluateCondition(conditions, context);
}

/**
 * Whether an element is configured with a visibility condition at all —
 * i.e. whether it is "contextual" rather than "persistent".
 *
 * Deliberately based on presence, not on validity: an element whose stored
 * condition is structurally invalid fails open at runtime (it stays visible),
 * but the user did configure a rule and the management UI must show that, so
 * the invalid data can be found and corrected. Visibility itself is decided by
 * isButtonVisibleInContext / isCategoryVisibleInContext, never by this helper.
 */
export function hasConditions(element: {
    conditions?: ButtonCondition | null;
}): boolean {
    return element.conditions !== undefined && element.conditions !== null;
}

/**
 * The rendering projection (which categories/buttons a view mode shows, and
 * how a grid palette's context layers resolve) lives in
 * `src/context/panelProjection.ts`. It is kept out of this module so the
 * condition primitives stay free of any palette/layer dependency.
 */
