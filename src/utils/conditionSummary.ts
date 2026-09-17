// conditionSummary.ts
// Pure, human-readable one-line summaries of the declarative condition model
// (src/types/conditions.ts).
//
// Purpose: everywhere a trigger or a visibility rule is only being READ — the
// variant bar above a grid, the variant overview in the category modal — the
// user must be able to tell what it does without opening an editor. This is
// deliberately a SUMMARY, not a second condition language: a deeply nested
// tree is compressed (children beyond the first few collapse into "+n more")
// rather than rendered in full. Editing always happens in the ConditionEditor.
//
// No Obsidian or DOM dependency; the only outside call is the i18n lookup, so
// the summaries follow the user's language.

import type { ButtonCondition, ConditionRule } from '@/types/conditions';
import { isValidCondition } from '@/context/conditions';
import { t, tWithParams } from '@/utils/i18n';

/** Children of a group listed individually before collapsing into "+n more". */
const MAX_LISTED_CHILDREN = 3;

/** Hard cap so one pathological rule can never blow up a table row. */
const MAX_SUMMARY_LENGTH = 120;

const OP_LABEL_KEYS: Record<string, string> = {
    equals: 'conditions_op_equals',
    startsWith: 'conditions_op_starts_with',
    contains: 'conditions_op_contains',
    endsWith: 'conditions_op_ends_with',
    exists: 'conditions_op_exists',
};

function opLabel(op: string): string {
    const key = OP_LABEL_KEYS[op];
    return key === undefined ? op : t(key);
}

/** A value the user left empty reads as a placeholder, never as nothing. */
function valueLabel(value: string): string {
    const trimmed = value.trim();
    return trimmed.length === 0 ? t('summary_empty_value') : trimmed;
}

function summarizeRule(rule: ConditionRule): string {
    switch (rule.rule) {
        case 'viewType':
            return `${t('conditions_rule_view_type')} ${valueLabel(rule.value)}`;
        case 'fileName':
            return `${t('conditions_rule_file_name')} ${opLabel(rule.op)} ${valueLabel(rule.value)}`;
        case 'path':
            return `${t('conditions_rule_path')} ${opLabel(rule.op)} ${valueLabel(rule.value)}`;
        case 'folder':
            return `${t('conditions_rule_folder')} ${opLabel(rule.op)} ${valueLabel(rule.value)}`;
        case 'extension':
            return `${t('conditions_rule_extension')} .${rule.value.trim().replace(/^\./, '')}`;
        case 'property':
            return rule.op === 'exists'
                ? `${t('conditions_rule_property')} ${valueLabel(rule.key)} ${t('conditions_op_exists')}`
                : `${t('conditions_rule_property')} ${valueLabel(rule.key)} = ${valueLabel(String(rule.value ?? ''))}`;
        case 'tag':
            return `${t('conditions_rule_tag')} #${rule.value.trim().replace(/^#/, '')}`;
    }
    return t('summary_unknown_rule');
}

function summarizeChildren(
    children: readonly ButtonCondition[],
    separator: string
): string {
    const listed = children
        .slice(0, MAX_LISTED_CHILDREN)
        .map((child) => summarizeNode(child));
    const rest = children.length - listed.length;
    if (rest > 0) {
        listed.push(tWithParams('summary_more', { count: rest }));
    }
    return listed.join(separator);
}

function summarizeNode(node: ButtonCondition): string {
    if ('all' in node) {
        if (node.all.length === 0) return t('variant_trigger_always');
        // A single-child group carries no extra meaning — show the rule itself.
        if (node.all.length === 1) return summarizeNode(node.all[0]!);
        return `${t('summary_all_prefix')} ${summarizeChildren(node.all, ' + ')}`;
    }
    if ('any' in node) {
        if (node.any.length === 0) return t('summary_never');
        if (node.any.length === 1) return summarizeNode(node.any[0]!);
        return `${t('summary_any_prefix')} ${summarizeChildren(node.any, ' / ')}`;
    }
    if ('not' in node) {
        return `${t('summary_not_prefix')} ${summarizeNode(node.not)}`;
    }
    return summarizeRule(node);
}

/**
 * One-line summary of a structurally valid condition tree.
 * Invalid data is the caller's business (see summarizeVariantTrigger); this
 * function assumes the shape it is given and never throws.
 */
export function summarizeCondition(condition: ButtonCondition): string {
    const text = summarizeNode(condition);
    return text.length > MAX_SUMMARY_LENGTH
        ? `${text.slice(0, MAX_SUMMARY_LENGTH - 1).trimEnd()}…`
        : text;
}

/** The trigger states a variant can be in, as the UI has to phrase them. */
export type VariantTriggerState =
    /** The category's fallback: no trigger, shown when nothing else matches. */
    | 'fallback'
    /** A normal variant with no trigger at all — never matches. */
    | 'missing'
    /** Stored trigger data that does not match the schema — never matches. */
    | 'invalid'
    /** The explicit always-true trigger `{ all: [] }`. */
    | 'always'
    /** A real trigger; `summary` describes it. */
    | 'rule';

export interface VariantTriggerSummary {
    state: VariantTriggerState;
    /** Ready-to-render text for every state, including the degenerate ones. */
    summary: string;
    /** True for the states that can never select the variant at runtime. */
    broken: boolean;
}

/**
 * Trigger of a variant as a single readable line, including the cases that are
 * not a rule at all. Shared by the variant bar and the category modal so both
 * phrase "this variant never matches" identically.
 */
export function summarizeVariantTrigger(variant: {
    trigger?: ButtonCondition;
    fallback?: boolean;
}): VariantTriggerSummary {
    if (variant.fallback === true) {
        return { state: 'fallback', summary: t('variant_trigger_fallback'), broken: false };
    }
    const trigger = variant.trigger;
    if (trigger === undefined || trigger === null) {
        return { state: 'missing', summary: t('variant_trigger_missing'), broken: true };
    }
    if (!isValidCondition(trigger)) {
        return { state: 'invalid', summary: t('variant_trigger_invalid'), broken: true };
    }
    if ('all' in trigger && trigger.all.length === 0) {
        return { state: 'always', summary: t('variant_trigger_always'), broken: false };
    }
    return { state: 'rule', summary: summarizeCondition(trigger), broken: false };
}
