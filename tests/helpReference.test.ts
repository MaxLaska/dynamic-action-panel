// tests/helpReference.test.ts
//
// The controls reference (1–17).
//
// Two things are worth pinning here, and neither is the wording:
//
// 1. the reference is COMPLETE and translated — every key it names exists in
//    all three shipped locales, so no user ever sees a raw `help_tool_click`;
// 2. the reference is CURRENT — it must not describe any of the models this
//    panel has already discarded: the left drag that moved a tool, the
//    right-button selection, the locked/edit toggle, or a plain palette click
//    that selected every cell of a colour.
//
// Point 2 is the reason this file exists. A help text that documents a gesture
// the panel no longer has is worse than no help text: it is confidently wrong.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Platform } from 'obsidian';
import {
    interactionReference,
    interactionReferenceText,
    modifierLabel,
} from '@/utils/interactionReference';

const read = (path: string) => readFileSync(path, 'utf8');
const locale = (lang: string) =>
    JSON.parse(read(`src/locales/${lang}.json`)) as Record<string, string>;

const en = locale('en');
const ru = locale('ru');
const zh = locale('zh');

const allRows = () => interactionReference().flatMap((section) => section.rows);

afterEach(() => {
    Platform.isMacOS = false;
});

describe('the controls reference', () => {
    it('1. groups the controls into named, non-empty sections', () => {
        const sections = interactionReference();
        expect(sections.length).toBeGreaterThan(0);
        for (const section of sections) {
            expect(section.titleKey).toMatch(/^help_section_/);
            expect(section.rows.length).toBeGreaterThan(0);
        }
    });

    it('2. gives every row a gesture and a description key', () => {
        for (const row of allRows()) {
            expect(row.gesture.trim().length).toBeGreaterThan(0);
            expect(row.descriptionKey).toMatch(/^help_/);
        }
    });

    it('3. says each thing once — no duplicate description keys', () => {
        const keys = allRows().map((row) => row.descriptionKey);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('4. uses each section title once', () => {
        const keys = interactionReference().map((section) => section.titleKey);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('5. names only keys English has', () => {
        for (const section of interactionReference()) {
            expect(en[section.titleKey], section.titleKey).toBeTruthy();
            for (const row of section.rows) {
                expect(en[row.descriptionKey], row.descriptionKey).toBeTruthy();
            }
        }
    });

    it('6. is translated into Russian', () => {
        for (const row of allRows()) {
            expect(ru[row.descriptionKey], row.descriptionKey).toBeTruthy();
        }
        for (const section of interactionReference()) {
            expect(ru[section.titleKey], section.titleKey).toBeTruthy();
        }
    });

    it('7. is translated into Chinese', () => {
        for (const row of allRows()) {
            expect(zh[row.descriptionKey], row.descriptionKey).toBeTruthy();
        }
        for (const section of interactionReference()) {
            expect(zh[section.titleKey], section.titleKey).toBeTruthy();
        }
    });

    it('8. carries the button label in every locale', () => {
        for (const dictionary of [en, ru, zh]) {
            expect(dictionary['help_button_label']).toBeTruthy();
            expect(dictionary['help_modal_title']).toBeTruthy();
        }
    });
});

describe('the platform modifier', () => {
    it('9. is Ctrl on Windows and Linux', () => {
        Platform.isMacOS = false;
        expect(modifierLabel()).toBe('Ctrl');
    });

    it('10. is Cmd on macOS', () => {
        Platform.isMacOS = true;
        expect(modifierLabel()).toBe('Cmd');
    });

    it('11. is the one the reference actually prints', () => {
        Platform.isMacOS = true;
        const mac = allRows().map((row) => row.gesture);
        expect(mac.some((gesture) => gesture.includes('Cmd'))).toBe(true);
        expect(mac.some((gesture) => gesture.includes('Ctrl'))).toBe(false);

        Platform.isMacOS = false;
        const windows = allRows().map((row) => row.gesture);
        expect(windows.some((gesture) => gesture.includes('Ctrl'))).toBe(true);
        expect(windows.some((gesture) => gesture.includes('Cmd'))).toBe(false);
    });

    it('12. resolves every description — no key leaks into the UI', () => {
        for (const section of interactionReferenceText()) {
            expect(section.title).not.toMatch(/^help_/);
            for (const row of section.rows) {
                expect(row.description).not.toMatch(/^help_/);
                expect(row.description.length).toBeGreaterThan(0);
            }
        }
    });
});

describe('what the reference says', () => {
    const text = () =>
        interactionReferenceText()
            .flatMap((section) => section.rows.map((row) => `${row.gesture} ${row.description}`))
            .join('\n');

    it('13. documents the left click as running the tool', () => {
        expect(en['help_tool_click']).toMatch(/run/i);
    });

    it('14. documents the right click as a context menu and nothing more', () => {
        const rightClick = en['help_tool_right_click'];
        expect(rightClick).toMatch(/context menu/i);
        expect(rightClick).not.toMatch(/edit|copy|delete/i);
    });

    it('15. never describes a left drag as moving a tool', () => {
        // The corrected grammar: the left drag is RESERVED, the right drag
        // moves. A help text that says otherwise is the discarded prototype.
        const leftDrag = en['help_tool_left_drag'];
        expect(leftDrag).toMatch(/reserved/i);
        expect(en['help_tool_right_drag']).toMatch(/move/i);
    });

    it('16. mentions no mode, and no right-button selection', () => {
        const body = text();
        expect(body).not.toMatch(/locked|edit mode/i);
        // Selection is Shift/Ctrl on the LEFT button; nothing selects on the right.
        expect(body).not.toMatch(/(shift|ctrl|cmd)\s*\+\s*right/i);
    });

    it('17. describes a plain swatch click as painting, not as selecting a group', () => {
        expect(en['help_color_click']).toMatch(/apply|paint/i);
        // The discarded rule was "a plain click selects every cell of that
        // colour". It applies to the selection; it does not build one.
        expect(en['help_color_click']).not.toMatch(/select all|selects/i);
        // Selecting by colour is the modified gesture, and says so.
        expect(en['help_color_add']).toMatch(/add all cells/i);
    });
});

describe('the help button and its modal', () => {
    const navigationBar = read('src/components/shared/NavigationBar.tsx');
    const renderer = read('src/views/renderers/NavigationBarRenderer.tsx');
    const modal = read('src/components/modal/HelpModal.ts');

    it('18. sits in the existing toolbar, beside the settings button', () => {
        expect(navigationBar).toContain('className="help-btn"');
        expect(navigationBar).toContain('onClick={onOpenHelp}');
        // The settings button is still there: the help button is an addition.
        expect(navigationBar).toContain('className="settings-btn"');
        expect(navigationBar).toContain("label={t('help_button_label')}");
    });

    it('19. opens the modal from the renderer', () => {
        expect(renderer).toContain('HelpModal');
        expect(renderer).toContain('onOpenHelp');
    });

    it('20. renders the shared reference instead of its own list', () => {
        expect(modal).toContain('interactionReferenceText');
        // No second copy of the grammar hiding in the modal.
        expect(modal).not.toMatch(/Shift \+ Click/);
    });
});
