// deleteTargets.ts
// Naming the things a delete is about, so the confirmation can list them.
//
// A selection is a set of cells; what gets deleted is the TOOLS those cells
// hold. Turning one into the other is the whole job here, plus giving every
// target a name a person recognises — the label they see on the button, not the
// id the settings file uses. A dialog that asks "delete these 6 items?" over a
// list of `mu5yjb9g-4-tqtqu1i` is a dialog nobody can answer.
//
// Pure: a registry in, a list out. No React, no settings, no Obsidian.

import type { ButtonAction } from '@/types/action';
import type { ToolDefinition, ToolRegistry } from '@/types/settings';

/** One thing a delete will remove, and what to call it. */
export interface DeleteTarget {
    toolId: string;
    /** What the confirmation shows. Never empty, never a bare id if avoidable. */
    label: string;
}

/** File name without folders or extension. */
function basenameOf(filePath: string): string {
    const name = filePath.slice(filePath.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
}

/** One readable line: whitespace collapses, and a long one is cut. */
function condense(value: string, max = 60): string {
    const text = value.replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    const lastSpace = cut.lastIndexOf(' ');
    const stem = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
    return `${stem.trimEnd()}…`;
}

/**
 * What the tool's first action points at, when the tool has no name of its own.
 *
 * Deliberately the action's own target rather than an invented description: a
 * file tool is named by its file, a section tool by its section, a script by
 * its script. Nothing here guesses a type from shape — each action type already
 * says what it is.
 */
function labelFromAction(action: ButtonAction | undefined): string | null {
    if (!action) return null;
    switch (action.type) {
        case 'file': {
            const section = action.parameters.section?.title;
            if (section && section.trim()) return section.trim();
            return basenameOf(action.parameters.filePath) || null;
        }
        case 'url':
            return action.parameters.url || null;
        case 'script':
            return action.parameters.scriptName || null;
        case 'command':
            return action.parameters.commandId || null;
        case 'create_file':
            return action.parameters.fileName || null;
        default:
            return null;
    }
}

/**
 * The name to show for a tool, best first.
 *
 * The visible label wins, because that is what the user has been looking at.
 * Then the hover text, which a dropped annotation or section fills in with its
 * source. Then whatever the first action points at. The id is the last resort
 * and appears only for a tool that has nothing else at all — which is possible
 * (an actionless, unnamed tool) and should still be listed rather than hidden.
 */
export function toolDisplayLabel(
    definition: ToolDefinition | undefined,
    toolId: string
): string {
    const name = definition?.name?.trim();
    if (name) return condense(name);
    const tooltip = definition?.tooltip?.trim();
    // A tooltip may be several lines (source, then outline path); the first
    // line is the one that names the thing.
    if (tooltip) {
        const firstLine = tooltip.split('\n')[0]?.trim();
        if (firstLine) return condense(firstLine);
    }
    const fromAction = labelFromAction(definition?.actions?.[0]);
    if (fromAction) return condense(fromAction);
    return toolId;
}

/**
 * The tools a delete will remove, named, in the order they were given.
 *
 * Ids that name nothing are dropped rather than listed: a selection can outlive
 * the tool it pointed at (a grid remounts, a variant flips, another delete
 * lands first), and offering to delete something that is already gone would
 * make the count wrong. Duplicates collapse for the same reason — one tool
 * placed in two selected cells is one thing being deleted, not two.
 */
export function deleteTargetsOf(
    tools: ToolRegistry,
    toolIds: readonly string[]
): DeleteTarget[] {
    const targets: DeleteTarget[] = [];
    const seen = new Set<string>();
    for (const toolId of toolIds) {
        if (seen.has(toolId)) continue;
        const definition = tools[toolId];
        if (!definition) continue;
        seen.add(toolId);
        targets.push({ toolId, label: toolDisplayLabel(definition, toolId) });
    }
    return targets;
}
