// conditions.ts
// Declarative, serializable condition model for context-aware button visibility.
//
// Design constraints (see docs/ocap/DECISIONS.md):
// - purely declarative data, JSON-serializable, no function strings, no eval;
// - a condition tree is a single root node: either a group (all/any/not) or an
//   atomic rule (discriminated by the `rule` property);
// - the model is evaluated by the pure interpreter in src/context/conditions.ts.

/** String matching operators for path rules. */
export type PathConditionOp = 'equals' | 'startsWith' | 'contains';

/** Matching operators for folder rules (segment-aware, see evaluator). */
export type FolderConditionOp = 'equals' | 'startsWith';

/** Operators for property rules. */
export type PropertyConditionOp = 'exists' | 'equals';

/** Scalar values allowed as comparison targets in property rules. */
export type ConditionScalar = string | number | boolean;

/** Atomic rule: the active view type equals the given value (e.g. 'markdown'). */
export interface ViewTypeConditionRule {
    rule: 'viewType';
    value: string;
}

/** Atomic rule: the active file path matches the given value with the given op. */
export interface PathConditionRule {
    rule: 'path';
    op: PathConditionOp;
    value: string;
}

/**
 * Atomic rule: the active file's parent folder matches the given value.
 * 'startsWith' is segment-aware: value 'a' matches folders 'a' and 'a/b',
 * but not 'ab'.
 */
export interface FolderConditionRule {
    rule: 'folder';
    op: FolderConditionOp;
    value: string;
}

/** Atomic rule: the active file extension equals the given value (e.g. 'md'). */
export interface ExtensionConditionRule {
    rule: 'extension';
    value: string;
}

/**
 * Atomic rule on a frontmatter property of the active file.
 * op 'exists': the property key is present (its value may be empty/null).
 * op 'equals': the property value (or, for list properties, any list entry)
 * equals `value` after scalar normalization.
 */
export interface PropertyConditionRule {
    rule: 'property';
    key: string;
    op: PropertyConditionOp;
    value?: ConditionScalar;
}

/**
 * Atomic rule: the active file has the given tag (frontmatter or inline).
 * Matches nested tags: value 'project' also matches 'project/x'.
 * Leading '#' in the value is ignored.
 */
export interface TagConditionRule {
    rule: 'tag';
    value: string;
}

/** Union of all atomic rules, discriminated by `rule`. */
export type ConditionRule =
    | ViewTypeConditionRule
    | PathConditionRule
    | FolderConditionRule
    | ExtensionConditionRule
    | PropertyConditionRule
    | TagConditionRule;

/** Group node: every child condition must hold. An empty list holds. */
export interface AllConditionGroup {
    all: ButtonCondition[];
}

/** Group node: at least one child condition must hold. An empty list does not hold. */
export interface AnyConditionGroup {
    any: ButtonCondition[];
}

/** Group node: the child condition must not hold. */
export interface NotConditionGroup {
    not: ButtonCondition;
}

/** Union of all group nodes. */
export type ConditionGroup = AllConditionGroup | AnyConditionGroup | NotConditionGroup;

/**
 * A button visibility condition tree.
 * A button without a condition (undefined) is always visible.
 */
export type ButtonCondition = ConditionGroup | ConditionRule;
