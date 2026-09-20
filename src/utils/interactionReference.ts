// interactionReference.ts
// The panel's controls, in one place.
//
// This is what the help modal renders, and the only place the mouse grammar is
// written down for the user. Settings could show the same thing later; nothing
// here is modal-specific, which is the point — a second copy would drift the
// moment a gesture changes.
//
// What belongs here: the gestures the panel answers to TODAY. What does not:
// how it used to work (the left-drag-to-move and right-button-selection models
// are both gone — see docs/ocap/cell-selection-colors.md §3a), what a context
// menu happens to contain right now, or anything not yet built.

import { Platform } from 'obsidian';
import { t } from '@/utils/i18n';

/** The subtractive modifier, named the way the platform names it. */
export function modifierLabel(): string {
    return Platform.isMacOS === true ? 'Cmd' : 'Ctrl';
}

export interface InteractionRow {
    /** The gesture, already spelled for this platform ("Shift + Click"). */
    gesture: string;
    /** What it does — an i18n key, resolved by the renderer. */
    descriptionKey: string;
}

export interface InteractionSection {
    /** Heading — an i18n key. */
    titleKey: string;
    rows: readonly InteractionRow[];
}

/**
 * The controls, grouped the way someone looks for them: what a tool does, how
 * cells are chosen, what colour does, then the container level.
 */
export function interactionReference(): readonly InteractionSection[] {
    const mod = modifierLabel();
    return [
        {
            titleKey: 'help_section_tools',
            rows: [
                { gesture: 'Click', descriptionKey: 'help_tool_click' },
                { gesture: 'Right-click', descriptionKey: 'help_tool_right_click' },
                { gesture: 'Right-drag', descriptionKey: 'help_tool_right_drag' },
                { gesture: 'Drag', descriptionKey: 'help_tool_left_drag' },
            ],
        },
        {
            titleKey: 'help_section_selection',
            rows: [
                { gesture: 'Shift + Click', descriptionKey: 'help_selection_add_cell' },
                { gesture: 'Shift + Drag', descriptionKey: 'help_selection_add_rect' },
                { gesture: `${mod} + Click`, descriptionKey: 'help_selection_remove_cell' },
                { gesture: `${mod} + Drag`, descriptionKey: 'help_selection_remove_rect' },
                { gesture: 'Esc', descriptionKey: 'help_selection_escape' },
                { gesture: 'Click background', descriptionKey: 'help_selection_background' },
            ],
        },
        {
            titleKey: 'help_section_colors',
            rows: [
                { gesture: 'Click swatch', descriptionKey: 'help_color_click' },
                { gesture: 'Shift + Click swatch', descriptionKey: 'help_color_add' },
                { gesture: `${mod} + Click swatch`, descriptionKey: 'help_color_remove' },
                { gesture: 'Shift + Click cell', descriptionKey: 'help_color_armed' },
            ],
        },
        {
            titleKey: 'help_section_categories',
            rows: [
                { gesture: 'Drag grip', descriptionKey: 'help_category_grip' },
                { gesture: 'Click title', descriptionKey: 'help_category_collapse' },
                { gesture: 'Right-click title', descriptionKey: 'help_category_menu' },
            ],
        },
        {
            titleKey: 'help_section_files',
            rows: [{ gesture: 'Drop', descriptionKey: 'help_file_drop' }],
        },
    ];
}

/** The reference with every description resolved — what a renderer wants. */
export function interactionReferenceText(): {
    title: string;
    rows: { gesture: string; description: string }[];
}[] {
    return interactionReference().map((section) => ({
        title: t(section.titleKey),
        rows: section.rows.map((row) => ({
            gesture: row.gesture,
            description: t(row.descriptionKey),
        })),
    }));
}
