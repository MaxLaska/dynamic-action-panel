// controlPlan.ts
// What the editor shows, derived from the token table rather than written out.
//
// This is the small abstraction the whole "promote a discovery into a control"
// workflow rests on. Adding a knob to the Theme Studio must not mean touching
// UI code: it is a row in `theme/nexus/src/tokens.ts`, a rule in `theme.css`,
// and nothing else. The settings tab walks this plan and renders it.
//
// It is deliberately NOT a schema engine. There is one control type, the plan
// has two levels, and the whole file is a grouping. The moment it wants to
// describe layout, conditions or nesting, that is a new decision rather than a
// bigger version of this one.

import {
    NEXUS_GROUPS,
    NEXUS_GROUP_LABELS,
    NEXUS_TOKENS,
    type NexusTokenGroup,
    type ThemeTokenDefinition,
} from '../../../theme/nexus/src/tokens';

export interface ControlGroup {
    group: NexusTokenGroup;
    label: string;
    tokens: ThemeTokenDefinition[];
}

/**
 * Every token, grouped, in the order the groups are declared in.
 *
 * A group with no tokens is dropped rather than rendered empty, so removing the
 * last token of a section removes the section with it.
 */
export function buildControlPlan(
    tokens: readonly ThemeTokenDefinition[] = NEXUS_TOKENS
): ControlGroup[] {
    const plan: ControlGroup[] = [];
    for (const group of NEXUS_GROUPS) {
        const members = tokens.filter((token) => token.group === group);
        if (members.length === 0) continue;
        plan.push({ group, label: NEXUS_GROUP_LABELS[group], tokens: members });
    }
    return plan;
}

/** Every token the plan renders, flattened — used to prove the plan is complete. */
export function plannedTokens(plan: ControlGroup[]): ThemeTokenDefinition[] {
    return plan.flatMap((entry) => entry.tokens);
}
