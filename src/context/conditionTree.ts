// conditionTree.ts
// Pure, immutable manipulation helpers for the declarative condition model
// (src/types/conditions.ts). They back the visual condition editor
// (src/components/input/ConditionEditor.ts) and keep all tree logic
// independent from the DOM so it stays unit-testable.
//
// Node addressing: a ConditionPath is a list of child indices from the root.
// For `all`/`any` groups the index points into the children array; a `not`
// group has exactly one child addressed by index 0.

import type {
    ButtonCondition,
    ConditionRule,
    ConditionGroup,
} from '@/types/conditions';

/** Kind of a condition node: a group discriminator or 'rule'. */
export type ConditionNodeKind = 'all' | 'any' | 'not' | 'rule';

/** Group discriminators. */
export type ConditionGroupKind = 'all' | 'any' | 'not';

/** Rule discriminators supported by the editor. */
export type ConditionRuleKind = ConditionRule['rule'];

/** Path from the root to a node (child indices; `not` child is index 0). */
export type ConditionPath = readonly number[];

export function isConditionGroup(node: ButtonCondition): node is ConditionGroup {
    return 'all' in node || 'any' in node || 'not' in node;
}

export function getConditionKind(node: ButtonCondition): ConditionNodeKind {
    if ('all' in node) return 'all';
    if ('any' in node) return 'any';
    if ('not' in node) return 'not';
    return 'rule';
}

/** Children of a group node (`not` is presented as a single-child list). */
export function getGroupChildren(node: ConditionGroup): readonly ButtonCondition[] {
    if ('all' in node) return node.all;
    if ('any' in node) return node.any;
    return [node.not];
}

function buildGroup(kind: ConditionGroupKind, children: ButtonCondition[]): ConditionGroup {
    if (kind === 'all') return { all: children };
    if (kind === 'any') return { any: children };
    // A `not` group holds exactly one child; callers guarantee children.length === 1.
    return { not: children[0]! };
}

/** Default rule created by the editor for a given rule kind. */
export function createDefaultRule(kind: ConditionRuleKind): ConditionRule {
    switch (kind) {
        case 'viewType':
            return { rule: 'viewType', value: 'markdown' };
        case 'path':
            return { rule: 'path', op: 'startsWith', value: '' };
        case 'folder':
            return { rule: 'folder', op: 'startsWith', value: '' };
        case 'extension':
            return { rule: 'extension', value: 'md' };
        case 'property':
            return { rule: 'property', key: '', op: 'exists' };
        case 'tag':
            return { rule: 'tag', value: '' };
    }
}

/**
 * Convert a rule to another rule kind, keeping the plain `value` string when
 * both kinds carry one (so switching the type does not wipe typed input).
 */
export function convertRuleKind(rule: ConditionRule, kind: ConditionRuleKind): ConditionRule {
    if (rule.rule === kind) {
        return rule;
    }
    const next = createDefaultRule(kind);
    const carriedValue =
        'value' in rule && typeof rule.value === 'string' ? rule.value : undefined;
    if (carriedValue !== undefined && carriedValue.length > 0 && next.rule !== 'property') {
        return { ...next, value: carriedValue };
    }
    return next;
}

/** Node at the given path, or undefined when the path does not resolve. */
export function getNodeAtPath(
    root: ButtonCondition,
    path: ConditionPath
): ButtonCondition | undefined {
    let node: ButtonCondition | undefined = root;
    for (const index of path) {
        if (node === undefined || !isConditionGroup(node)) {
            return undefined;
        }
        node = getGroupChildren(node)[index];
    }
    return node;
}

/** Immutably replace the node at the given path; returns a new root. */
export function replaceNodeAtPath(
    root: ButtonCondition,
    path: ConditionPath,
    replacement: ButtonCondition
): ButtonCondition {
    if (path.length === 0) {
        return replacement;
    }
    if (!isConditionGroup(root)) {
        throw new Error('conditionTree: path descends into a rule node');
    }
    const index = path[0]!;
    const kind = getConditionKind(root) as ConditionGroupKind;
    const children = [...getGroupChildren(root)];
    const child = children[index];
    if (child === undefined) {
        throw new Error('conditionTree: path index out of range');
    }
    children[index] = replaceNodeAtPath(child, path.slice(1), replacement);
    return buildGroup(kind, children);
}

/**
 * Immutably append a child to the `all`/`any` group at the given path.
 * `not` groups always hold exactly one child; appending to them is invalid.
 */
export function addChildAtPath(
    root: ButtonCondition,
    groupPath: ConditionPath,
    child: ButtonCondition
): ButtonCondition {
    const target = getNodeAtPath(root, groupPath);
    if (target === undefined || !isConditionGroup(target) || 'not' in target) {
        throw new Error('conditionTree: addChildAtPath target is not an all/any group');
    }
    const kind = getConditionKind(target) as ConditionGroupKind;
    const nextGroup = buildGroup(kind, [...getGroupChildren(target), child]);
    return replaceNodeAtPath(root, groupPath, nextGroup);
}

/**
 * Immutably remove the node at the given path.
 * Removing the root (or the single child of a `not`, which would leave the
 * `not` without its mandatory child — the `not` is removed with it) can
 * dissolve the whole tree, in which case undefined is returned.
 */
export function removeNodeAtPath(
    root: ButtonCondition,
    path: ConditionPath
): ButtonCondition | undefined {
    if (path.length === 0) {
        return undefined;
    }
    const parentPath = path.slice(0, -1);
    const index = path[path.length - 1]!;
    const parent = getNodeAtPath(root, parentPath);
    if (parent === undefined || !isConditionGroup(parent)) {
        throw new Error('conditionTree: removeNodeAtPath parent is not a group');
    }
    if ('not' in parent) {
        // A `not` cannot exist without its child: removing the child removes it too.
        return removeNodeAtPath(root, parentPath);
    }
    const kind = getConditionKind(parent) as ConditionGroupKind;
    const children = getGroupChildren(parent).filter((_, i) => i !== index);
    return replaceNodeAtPath(root, parentPath, buildGroup(kind, [...children]));
}

/**
 * Immutably change the group kind at the given path.
 * - all <-> any: children are kept as-is.
 * - all/any -> not: one child is kept directly; several children are wrapped
 *   in a group of the previous kind (`not {all: [...]}` / `not {any: [...]}`)
 *   so nothing is lost; an empty group gets a default rule child.
 * - not -> all/any: a child group of the target kind is unwrapped (making the
 *   conversion round-trip stable); any other child becomes the only element.
 */
export function setGroupKindAtPath(
    root: ButtonCondition,
    path: ConditionPath,
    kind: ConditionGroupKind
): ButtonCondition {
    const node = getNodeAtPath(root, path);
    if (node === undefined || !isConditionGroup(node)) {
        throw new Error('conditionTree: setGroupKindAtPath target is not a group');
    }
    const currentKind = getConditionKind(node) as ConditionGroupKind;
    if (currentKind === kind) {
        return root;
    }

    let next: ConditionGroup;
    if (kind === 'not') {
        const children = getGroupChildren(node);
        if (children.length === 1) {
            next = { not: children[0]! };
        } else if (children.length === 0) {
            next = { not: createDefaultRule('viewType') };
        } else {
            next = { not: buildGroup(currentKind, [...children]) };
        }
    } else if (currentKind === 'not') {
        const child = (node as { not: ButtonCondition }).not;
        if (isConditionGroup(child) && getConditionKind(child) === kind) {
            next = buildGroup(kind, [...getGroupChildren(child)]);
        } else {
            next = buildGroup(kind, [child]);
        }
    } else {
        next = buildGroup(kind, [...getGroupChildren(node)]);
    }
    return replaceNodeAtPath(root, path, next);
}

/** Maximum nesting depth of a condition tree (root = depth 0). */
export function conditionDepth(node: ButtonCondition): number {
    if (!isConditionGroup(node)) {
        return 0;
    }
    let max = 0;
    for (const child of getGroupChildren(node)) {
        const d = conditionDepth(child);
        if (d > max) max = d;
    }
    return max + 1;
}
