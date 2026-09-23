// @vitest-environment happy-dom
//
// Tests for the Theme Studio as a workspace view, against a real DOM.
//
// Why a DOM here and nowhere else in the suite: the collapse bug that came back
// from real use was invisible to every test that read source text. The code
// said "set the class"; Obsidian's settings renderer never applied it. A test
// that renders the panel into a document and clicks the header is the only kind
// that could have caught it, so that is the kind this file is.
//
// Everything Obsidian-specific the panel needs arrives through a host object,
// which is faked here the way the plugin behaves: `update` rebuilds the view,
// `updateLive` applies without rebuilding, `updateUi` touches only UI state.
// The native colour dialog and the screen sampler are the operating system's;
// the sampler is faked at the `window.EyeDropper` seam and nothing below it.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NEXUS_GROUPS, NEXUS_TOKENS, nexusToken } from '../theme/nexus/src/tokens';
import { openStudio, type StudioOpener } from '../companion/nexus-theme-studio/src/open';
import {
    FIRST_PROFILE_ID,
    STANDARD_PROFILE_ID,
    activeProfile,
    defaultSettings,
    isGroupCollapsed,
    normalizeSettings,
    setActiveProfile,
    setGroupCollapsed,
    setOverride,
    type NexusStudioSettings,
} from '../companion/nexus-theme-studio/src/profiles';
import {
    ADVANCED_GROUP,
    CONTRAST_GROUP,
    StudioPanel,
    type StudioMenuAction,
    type StudioPanelHost,
} from '../companion/nexus-theme-studio/src/studioPanel';
import {
    COMPLEX_VALUE_LABEL,
    LOCATOR_DELAY_MS,
    RESET_TOOLTIP,
} from '../companion/nexus-theme-studio/src/tokenRow';
import {
    NEXUS_STUDIO_ICON,
    NEXUS_STUDIO_TITLE,
    NEXUS_STUDIO_VIEW_TYPE,
    NexusStudioView,
    type StudioServices,
} from '../companion/nexus-theme-studio/src/view';
import type { WorkspaceLeaf } from 'obsidian';

const WORKSPACE = nexusToken('workspaceSurface')!;
const DOCUMENT = nexusToken('documentSurface')!;
const SPLITTER_HOVER = nexusToken('splitterHover')!;
const SPLITTER_IDLE = nexusToken('splitterIdle')!;

/** A host that behaves like the plugin, recording what the panel asked of it. */
function makeHost(initial: NexusStudioSettings = defaultSettings()) {
    let settings = initial;
    const log = {
        update: 0,
        updateLive: 0,
        updateUi: 0,
        previews: [] as string[][],
        menus: [] as StudioMenuAction[][],
        notices: [] as string[],
    };
    let panel: StudioPanel | null = null;
    const host: StudioPanelHost = {
        settings: () => settings,
        themeIsActive: () => true,
        update: (next) => {
            settings = next;
            log.update += 1;
            // The plugin rebuilds every studio view after a discrete change.
            panel?.render();
            return Promise.resolve();
        },
        updateLive: (next) => {
            settings = next;
            log.updateLive += 1;
        },
        updateUi: (next) => {
            settings = next;
            log.updateUi += 1;
            panel?.syncCollapse();
            return Promise.resolve();
        },
        setPreview: (variables) => {
            log.previews.push([...variables]);
        },
        promptName: () => Promise.resolve('Named'),
        openTransfer: () => undefined,
        showMenu: (_evt, actions) => {
            log.menus.push(actions);
        },
        notify: (message) => {
            log.notices.push(message);
        },
    };
    return {
        host,
        log,
        get settings() {
            return settings;
        },
        attach(next: StudioPanel) {
            panel = next;
        },
    };
}

/** Renders a panel into the live document and hands back its parts. */
function mount(initial?: NexusStudioSettings) {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const fake = makeHost(initial);
    const panel = new StudioPanel(root, fake.host);
    fake.attach(panel);
    panel.render();
    const q = <T extends Element>(selector: string) => root.querySelector<T>(selector);
    const group = (key: string) => q<HTMLElement>(`.nexus-studio-group[data-group="${key}"]`)!;
    const header = (key: string) =>
        group(key).querySelector<HTMLButtonElement>('.nexus-studio-group-header')!;
    const body = (key: string) => group(key).querySelector<HTMLElement>('.nexus-studio-group-body')!;
    const row = (key: string) => q<HTMLElement>(`.nexus-studio-row[data-token="${key}"]`)!;
    const inRow = <T extends Element>(key: string, selector: string) =>
        row(key).querySelector<T>(selector)!;
    // Not `...fake`: spreading evaluates the `settings` getter once, and every
    // assertion afterwards would read the settings as they were at mount.
    return {
        root,
        panel,
        host: fake.host,
        log: fake.log,
        get settings() {
            return fake.settings;
        },
        q,
        group,
        header,
        body,
        row,
        inRow,
    };
}

/** Fires an event of any name, the way a real control would. */
function fire(target: Element, type: string): void {
    target.dispatchEvent(new Event(type, { bubbles: true }));
}

/** Types a value into an input and fires `input`, as the browser does per keystroke. */
function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    fire(input, 'input');
}

beforeEach(() => {
    document.body.replaceChildren();
});

afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { EyeDropper?: unknown }).EyeDropper;
});

describe('the studio is a workspace view', () => {
    function makeView() {
        const previews: string[][] = [];
        const services: StudioServices = {
            settings: defaultSettings(),
            themeIsActive: () => true,
            update: () => Promise.resolve(),
            updateLive: () => undefined,
            updateUi: () => Promise.resolve(),
            setPreview: (variables) => {
                previews.push([...variables]);
            },
        };
        const leaf = { app: {} } as unknown as WorkspaceLeaf;
        const view = new NexusStudioView(leaf, services);
        const lifecycle = view as unknown as { onOpen(): Promise<void>; onClose(): Promise<void> };
        return { view, previews, lifecycle };
    }

    it('has its own view type, title and icon', () => {
        const { view } = makeView();
        expect(view.getViewType()).toBe(NEXUS_STUDIO_VIEW_TYPE);
        expect(NEXUS_STUDIO_VIEW_TYPE).toBe('nexus-theme-studio');
        expect(view.getDisplayText()).toBe(NEXUS_STUDIO_TITLE);
        expect(NEXUS_STUDIO_TITLE).toBe('Nexus Theme Studio');
        expect(view.getIcon()).toBe(NEXUS_STUDIO_ICON);
    });

    it('renders the whole studio into its content element on open', async () => {
        const { view, lifecycle } = makeView();
        await lifecycle.onOpen();
        const groups = Array.from(view.contentEl.querySelectorAll<HTMLElement>('.nexus-studio-group'));
        // Every registry group, then contrast, then the scratch section.
        expect(groups.map((group) => group.dataset.group)).toEqual([
            ...NEXUS_GROUPS,
            CONTRAST_GROUP,
            ADVANCED_GROUP,
        ]);
        expect(view.contentEl.querySelectorAll('.nexus-studio-row').length).toBe(NEXUS_TOKENS.length);
    });

    // Obsidian can open a view again on the same instance. Two panels on one
    // element would be two sets of listeners answering every click.
    it('never builds a second panel on the same element', async () => {
        const { view, lifecycle } = makeView();
        await lifecycle.onOpen();
        await lifecycle.onOpen();
        expect(view.contentEl.querySelectorAll('.nexus-studio-profile').length).toBe(1);
        expect(view.contentEl.querySelectorAll('.nexus-studio-row').length).toBe(NEXUS_TOKENS.length);
    });

    it('clears the locator and empties itself on close', async () => {
        const { view, previews, lifecycle } = makeView();
        await lifecycle.onOpen();
        previews.length = 0;
        await lifecycle.onClose();
        expect(previews).toContainEqual([]);
        expect(view.contentEl.childElementCount).toBe(0);
    });

    // A row waiting out its 200ms when the view closes must not paint anything
    // afterwards: there would be no row left to end it.
    it('cancels a pending locator when the view closes', async () => {
        vi.useFakeTimers();
        const { view, previews, lifecycle } = makeView();
        await lifecycle.onOpen();
        fire(view.contentEl.querySelector('.nexus-studio-row')!, 'pointerenter');
        await lifecycle.onClose();
        previews.length = 0;
        vi.advanceTimersByTime(LOCATOR_DELAY_MS * 5);
        expect(previews.filter((entry) => entry.length > 0)).toEqual([]);
    });
});

describe('opening the studio', () => {
    // A workspace that keeps the contract measured in Obsidian 1.13.7's own
    // `ensureSideLeaf`: reuse the first leaf of the type wherever it is, and
    // only create one in the requested dock when there is none.
    function fakeWorkspace() {
        const leaves: Array<{ type: string; side: string }> = [];
        const calls: unknown[][] = [];
        const workspace: StudioOpener = {
            ensureSideLeaf: (type: string, side: 'left' | 'right', options?: unknown) => {
                calls.push([type, side, options]);
                let leaf = leaves.find((entry) => entry.type === type);
                if (!leaf) {
                    leaf = { type, side };
                    leaves.push(leaf);
                }
                return Promise.resolve(leaf as unknown as WorkspaceLeaf);
            },
        };
        return { workspace, leaves, calls };
    }

    it('asks for the studio view type, in the right dock, revealed and focused', async () => {
        const { workspace, calls } = fakeWorkspace();
        await openStudio(workspace);
        expect(calls[0]).toEqual([NEXUS_STUDIO_VIEW_TYPE, 'right', { active: true, reveal: true }]);
    });

    it('reveals the existing studio instead of making a second one', async () => {
        const { workspace, leaves } = fakeWorkspace();
        const first = await openStudio(workspace);
        const second = await openStudio(workspace);
        expect(leaves).toHaveLength(1);
        expect(second).toBe(first);
    });

    const main = readFileSync('companion/nexus-theme-studio/src/main.ts', 'utf8');
    const code = main.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

    it('registers the view and the command, after the settings are loaded', () => {
        expect(code).toContain('this.registerView(NEXUS_STUDIO_VIEW_TYPE');
        expect(code.indexOf('this.loadData()')).toBeLessThan(code.indexOf('this.registerView('));
        expect(code).toContain("name: 'Open Nexus Theme Studio'");
        // Unchanged, so a hotkey bound to the old command still works.
        expect(code).toContain("id: 'open-theme-studio'");
        expect(code).toContain('openStudio(this.app.workspace)');
    });

    // The editor is design work, and design work happens beside the surfaces
    // being designed, not in a dialog over them.
    it('has no settings tab and no ribbon button', () => {
        expect(code).not.toContain('addSettingTab');
        expect(code).not.toContain('addRibbonIcon');
    });

    // Detaching in onunload would reset the view to its default dock every time
    // the plugin is reloaded, forgetting where the user put it.
    it('leaves studio views in the layout when the plugin unloads', () => {
        const unload = code.slice(code.indexOf('onunload(): void'));
        expect(unload.slice(0, unload.indexOf('\n    }'))).not.toContain('detachLeavesOfType');
    });

    // A plugin that holds its views keeps closed ones alive.
    it('finds its views through the workspace rather than keeping them', () => {
        expect(code).toContain('getLeavesOfType(NEXUS_STUDIO_VIEW_TYPE)');
        expect(code).not.toMatch(/private\s+views\b|views\s*=\s*new\s+Set/);
    });
});

describe('groups fold, and nothing is lost when they do', () => {
    it('renders every registry group and the scratch section, each with a header and a body', () => {
        const ui = mount();
        for (const key of [...NEXUS_GROUPS, ADVANCED_GROUP]) {
            expect(ui.header(key).tagName).toBe('BUTTON');
            expect(ui.header(key).getAttribute('type')).toBe('button');
            expect(ui.body(key).hidden).toBe(false);
            expect(ui.header(key).getAttribute('aria-expanded')).toBe('true');
            expect(ui.header(key).getAttribute('aria-controls')).toBe(ui.body(key).id);
        }
    });

    // The bug that came back from real use: the chevron did nothing at all.
    it('actually hides the controls when the header is clicked', () => {
        const ui = mount();
        ui.header('workspace').click();
        expect(ui.body('workspace').hidden).toBe(true);
        expect(ui.header('workspace').getAttribute('aria-expanded')).toBe('false');
        // The rows are inside the hidden body — they are what disappeared.
        expect(ui.row(WORKSPACE.key).closest('.nexus-studio-group-body')).toBe(ui.body('workspace'));
        // The header is not: it stays, and it is the way back.
        expect(ui.header('workspace').closest('[hidden]')).toBeNull();
        // Other groups are untouched.
        expect(ui.body('document').hidden).toBe(false);
    });

    it('opens again with every value exactly as it was', () => {
        const start = setOverride(defaultSettings(), FIRST_PROFILE_ID, WORKSPACE.key, '#123456');
        const ui = mount(start);
        const before = JSON.stringify(ui.settings.profiles);
        const chipBefore = ui.inRow<HTMLElement>(WORKSPACE.key, '.nexus-studio-value').textContent;

        ui.header('workspace').click();
        ui.header('workspace').click();

        expect(ui.body('workspace').hidden).toBe(false);
        expect(JSON.stringify(ui.settings.profiles)).toBe(before);
        expect(ui.inRow<HTMLElement>(WORKSPACE.key, '.nexus-studio-value').textContent).toBe(chipBefore);
        expect(ui.log.update + ui.log.updateLive).toBe(0);
    });

    it.each([
        ['Enter', 'Enter'],
        ['Space', ' '],
    ])('folds with %s, exactly once', (_label, key) => {
        const ui = mount();
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        ui.header('interaction').dispatchEvent(event);
        expect(ui.body('interaction').hidden).toBe(true);
        expect(ui.header('interaction').getAttribute('aria-expanded')).toBe('false');
        // Default prevented, so a real browser does not ALSO synthesise a
        // click from the same key and fold it straight back open.
        expect(event.defaultPrevented).toBe(true);
    });

    it('ignores every other key', () => {
        const ui = mount();
        ui.header('text').dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
        ui.header('text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        expect(ui.body('text').hidden).toBe(false);
    });

    // Folding is the studio's own UI state — not a colour, not a profile.
    it('stores the fold as UI state, without touching the theme', () => {
        const ui = mount();
        ui.header('workspace').click();
        expect(ui.log.updateUi).toBe(1);
        expect(ui.log.update).toBe(0);
        expect(ui.log.updateLive).toBe(0);
        expect(isGroupCollapsed(ui.settings, 'workspace')).toBe(true);
    });

    // What a restart looks like from the panel's side: settings come back from
    // disk with the fold recorded, and the first render honours it.
    it('comes back folded after a restart', () => {
        const stored = JSON.parse(
            JSON.stringify(setGroupCollapsed(defaultSettings(), 'interaction', true))
        ) as unknown;
        const ui = mount(normalizeSettings(stored));
        expect(ui.body('interaction').hidden).toBe(true);
        expect(ui.header('interaction').getAttribute('aria-expanded')).toBe('false');
        expect(ui.body('workspace').hidden).toBe(false);
    });

    it('stays folded through a profile switch', () => {
        const ui = mount();
        ui.header('workspace').click();
        ui.q<HTMLSelectElement>('.nexus-studio-profile-select')!.value = STANDARD_PROFILE_ID;
        fire(ui.q('.nexus-studio-profile-select')!, 'change');
        expect(activeProfile(ui.settings).id).toBe(STANDARD_PROFILE_ID);
        expect(ui.body('workspace').hidden).toBe(true);
    });

    // A rebuild must not stack a second click handler on the header.
    it('toggles once per click after any number of rebuilds', () => {
        const ui = mount();
        ui.panel.render();
        ui.panel.render();
        ui.header('document').click();
        expect(ui.body('document').hidden).toBe(true);
        expect(ui.log.updateUi).toBe(1);
    });

    it('says how many tokens a group changes, so a folded group is not a secret', () => {
        const start = setOverride(defaultSettings(), FIRST_PROFILE_ID, WORKSPACE.key, '#123456');
        const ui = mount(start);
        const meta = ui.header('workspace').querySelector('.nexus-studio-group-meta')!;
        expect(meta.textContent).toBe('1 changed');
        expect(ui.header('text').querySelector('.nexus-studio-group-meta')!.textContent).toBe('');
    });
});

describe('the per-token reset', () => {
    it('is labelled "Reset to default", never with a value', () => {
        const ui = mount();
        expect(RESET_TOOLTIP).toBe('Reset to default');
        for (const token of NEXUS_TOKENS) {
            const reset = ui.inRow<HTMLButtonElement>(token.key, '.nexus-studio-reset');
            expect(reset.getAttribute('aria-label')).toBe('Reset to default');
            expect(reset.getAttribute('aria-label')).not.toMatch(/#|rgb|hsl|\d/);
        }
        const source = readFileSync('companion/nexus-theme-studio/src/tokenRow.ts', 'utf8');
        expect(source).toContain('setTooltip(reset, RESET_TOOLTIP)');
    });

    // The original bug, reproduced against a real DOM: the arrow was rendered
    // disabled and stayed disabled after the token gained an override.
    it('becomes available the moment the token is changed, without a rebuild', () => {
        const ui = mount();
        const reset = ui.inRow<HTMLButtonElement>(WORKSPACE.key, '.nexus-studio-reset');
        expect(reset.disabled).toBe(true);
        const picker = ui.inRow<HTMLInputElement>(WORKSPACE.key, '.nexus-studio-picker');
        type(picker, '#445566');
        expect(ui.log.update).toBe(0);
        expect(reset.disabled).toBe(false);
    });

    it('resets that token only, and the row shows the default again', () => {
        let start = setOverride(defaultSettings(), FIRST_PROFILE_ID, WORKSPACE.key, '#111111');
        start = setOverride(start, FIRST_PROFILE_ID, DOCUMENT.key, '#222222');
        const ui = mount(start);

        ui.inRow<HTMLButtonElement>(WORKSPACE.key, '.nexus-studio-reset').click();

        const overrides = activeProfile(ui.settings).overrides;
        expect(overrides[WORKSPACE.key]).toBeUndefined();
        expect(overrides[DOCUMENT.key]).toBe('#222222');
        expect(ui.inRow<HTMLElement>(WORKSPACE.key, '.nexus-studio-value').textContent).toBe(
            WORKSPACE.defaultValue
        );
        expect(ui.inRow<HTMLInputElement>(WORKSPACE.key, '.nexus-studio-picker').value).toBe(
            WORKSPACE.defaultValue
        );
        expect(ui.inRow<HTMLButtonElement>(WORKSPACE.key, '.nexus-studio-reset').disabled).toBe(true);
    });

    // The disabled state is the affordance; the handler is the behaviour.
    it('does nothing for a token without an override, even if clicked', () => {
        const ui = mount();
        const reset = ui.inRow<HTMLButtonElement>(WORKSPACE.key, '.nexus-studio-reset');
        reset.disabled = false;
        reset.click();
        expect(ui.log.updateLive).toBe(0);
    });

    it('is not available on the locked baseline, and neither is any editor', () => {
        const ui = mount(setActiveProfile(defaultSettings(), STANDARD_PROFILE_ID));
        // The main editor of each kind of control, so a new kind cannot slip
        // past the lock without this list being extended.
        const editorOf: Record<string, string> = {
            color: '.nexus-studio-picker',
            length: '.nexus-studio-range',
            number: '.nexus-studio-range',
            'font-family': '.nexus-studio-font-input',
        };
        for (const token of NEXUS_TOKENS) {
            expect(ui.inRow<HTMLButtonElement>(token.key, '.nexus-studio-reset').disabled).toBe(true);
            const editor = editorOf[token.controlType];
            expect(editor).toBeDefined();
            expect(ui.inRow<HTMLInputElement>(token.key, editor!).disabled).toBe(true);
        }
    });
});

describe('colour is edited visually, and live', () => {
    it('writes on input, not on change — while the picker is still open', () => {
        const ui = mount();
        type(ui.inRow<HTMLInputElement>(WORKSPACE.key, '.nexus-studio-picker'), '#abcdef');
        expect(ui.log.updateLive).toBe(1);
        expect(activeProfile(ui.settings).overrides[WORKSPACE.key]).toBe('#abcdef');
        expect(ui.inRow<HTMLElement>(WORKSPACE.key, '.nexus-studio-value').textContent).toBe('#abcdef');
    });

    // The swatch paints the stored string itself — so it shows translucency
    // and `color-mix()` truthfully, which a native colour input cannot.
    it('paints the swatch with the stored value', () => {
        const ui = mount();
        const swatch = ui.inRow<HTMLElement>(SPLITTER_HOVER.key, '.nexus-studio-swatch');
        expect(swatch.style.getPropertyValue('--nexus-studio-swatch')).toBe(SPLITTER_HOVER.defaultValue);
    });

    it('offers opacity exactly where the registry says', () => {
        const ui = mount();
        for (const token of NEXUS_TOKENS) {
            const slider = ui.row(token.key).querySelector('.nexus-studio-alpha');
            expect(slider !== null).toBe(token.supportsAlpha === true);
        }
    });

    it('shows a translucent default as colour plus percent, not as rgba text', () => {
        const ui = mount();
        const slider = ui.inRow<HTMLInputElement>(SPLITTER_HOVER.key, '.nexus-studio-alpha');
        expect(slider.value).toBe('28');
        expect(ui.inRow<HTMLElement>(SPLITTER_HOVER.key, '.nexus-studio-alpha-readout').textContent).toBe('28%');
        expect(ui.inRow<HTMLElement>(SPLITTER_HOVER.key, '.nexus-studio-value').textContent).toBe('#ffffff');
    });

    it('moves opacity live and keeps the colour', () => {
        const ui = mount();
        type(ui.inRow<HTMLInputElement>(SPLITTER_HOVER.key, '.nexus-studio-alpha'), '60');
        expect(activeProfile(ui.settings).overrides[SPLITTER_HOVER.key]).toBe('rgba(255, 255, 255, 0.6)');
        expect(ui.inRow<HTMLElement>(SPLITTER_HOVER.key, '.nexus-studio-alpha-readout').textContent).toBe('60%');
    });

    it('moves colour live and keeps the opacity', () => {
        const ui = mount();
        type(ui.inRow<HTMLInputElement>(SPLITTER_HOVER.key, '.nexus-studio-picker'), '#ff0000');
        expect(activeProfile(ui.settings).overrides[SPLITTER_HOVER.key]).toBe('rgba(255, 0, 0, 0.28)');
    });

    it('treats opacity 0 and 100 as values, not as edge cases', () => {
        const ui = mount();
        const slider = ui.inRow<HTMLInputElement>(SPLITTER_HOVER.key, '.nexus-studio-alpha');
        type(slider, '0');
        expect(activeProfile(ui.settings).overrides[SPLITTER_HOVER.key]).toBe('rgba(255, 255, 255, 0)');
        type(slider, '100');
        expect(activeProfile(ui.settings).overrides[SPLITTER_HOVER.key]).toBe('#ffffff');
    });
});

describe('the raw CSS value is there, but not in the way', () => {
    it('is closed on every row by default', () => {
        const ui = mount();
        for (const token of NEXUS_TOKENS) {
            if (token.controlType === 'font-family') {
                // A family list IS its raw CSS, so it has no second, hidden
                // copy of itself: the field is the control, and it is shown.
                expect(ui.row(token.key).querySelector('.nexus-studio-row-css')).toBeNull();
                expect(ui.inRow<HTMLInputElement>(token.key, '.nexus-studio-font-input').value).toBe(
                    token.defaultValue
                );
                continue;
            }
            expect(ui.inRow<HTMLElement>(token.key, '.nexus-studio-row-css').hidden).toBe(true);
            expect(ui.inRow<HTMLElement>(token.key, '.nexus-studio-value').getAttribute('aria-expanded')).toBe(
                'false'
            );
        }
    });

    it('opens from the value readout, showing the exact stored value', () => {
        const ui = mount();
        const chip = ui.inRow<HTMLButtonElement>(SPLITTER_HOVER.key, '.nexus-studio-value');
        chip.click();
        expect(ui.inRow<HTMLElement>(SPLITTER_HOVER.key, '.nexus-studio-row-css').hidden).toBe(false);
        expect(chip.getAttribute('aria-expanded')).toBe('true');
        expect(ui.inRow<HTMLInputElement>(SPLITTER_HOVER.key, '.nexus-studio-css-input').value).toBe(
            SPLITTER_HOVER.defaultValue
        );
    });

    // A value the picker cannot represent is written as typed, stays exactly
    // as typed, and the row says an advanced value is active.
    it('keeps a complex value intact and says it is one', () => {
        const ui = mount();
        ui.inRow<HTMLButtonElement>(WORKSPACE.key, '.nexus-studio-value').click();
        const complex = 'color-mix(in oklch, #333333 90%, #88aaff 10%)';
        type(ui.inRow<HTMLInputElement>(WORKSPACE.key, '.nexus-studio-css-input'), complex);

        expect(activeProfile(ui.settings).overrides[WORKSPACE.key]).toBe(complex);
        const chip = ui.inRow<HTMLElement>(WORKSPACE.key, '.nexus-studio-value');
        expect(chip.textContent).toBe(COMPLEX_VALUE_LABEL);
        expect(chip.classList.contains('is-complex')).toBe(true);
        expect(chip.getAttribute('title')).toBe(complex);
        expect(ui.inRow<HTMLInputElement>(WORKSPACE.key, '.nexus-studio-picker').disabled).toBe(true);
        expect(ui.inRow<HTMLElement>(WORKSPACE.key, '.nexus-studio-swatch').style.getPropertyValue(
            '--nexus-studio-swatch'
        )).toBe(complex);

        // A full rebuild does not "simplify" it.
        ui.panel.render();
        expect(activeProfile(ui.settings).overrides[WORKSPACE.key]).toBe(complex);
        expect(ui.inRow<HTMLElement>(WORKSPACE.key, '.nexus-studio-value').textContent).toBe(
            COMPLEX_VALUE_LABEL
        );
    });

    it('writes a valid exact value and brings the visual controls with it', () => {
        const ui = mount();
        ui.inRow<HTMLButtonElement>(SPLITTER_HOVER.key, '.nexus-studio-value').click();
        type(ui.inRow<HTMLInputElement>(SPLITTER_HOVER.key, '.nexus-studio-css-input'), 'rgba(0, 128, 255, 0.5)');
        expect(ui.inRow<HTMLInputElement>(SPLITTER_HOVER.key, '.nexus-studio-picker').value).toBe('#0080ff');
        expect(ui.inRow<HTMLInputElement>(SPLITTER_HOVER.key, '.nexus-studio-alpha').value).toBe('50');
        expect(ui.inRow<HTMLElement>(SPLITTER_HOVER.key, '.nexus-studio-value').textContent).toBe('#0080ff');
    });

    it('refuses an invalid value without writing it or reverting the field', () => {
        const ui = mount();
        ui.inRow<HTMLButtonElement>(WORKSPACE.key, '.nexus-studio-value').click();
        const input = ui.inRow<HTMLInputElement>(WORKSPACE.key, '.nexus-studio-css-input');
        type(input, '#fff; color: red');
        expect(ui.log.updateLive).toBe(0);
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(input.value).toBe('#fff; color: red');
    });

    it('changes nothing when it is closed again', () => {
        const ui = mount();
        const chip = ui.inRow<HTMLButtonElement>(WORKSPACE.key, '.nexus-studio-value');
        chip.click();
        chip.click();
        expect(ui.inRow<HTMLElement>(WORKSPACE.key, '.nexus-studio-row-css').hidden).toBe(true);
        expect(ui.log.updateLive + ui.log.update).toBe(0);
    });
});

describe('the locator', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    const nonEmpty = (previews: string[][]) => previews.filter((entry) => entry.length > 0);

    it('paints the token after resting on its row, and stops when the pointer leaves', () => {
        const ui = mount();
        ui.log.previews.length = 0;
        fire(ui.row(WORKSPACE.key), 'pointerenter');
        expect(nonEmpty(ui.log.previews)).toEqual([]);
        vi.advanceTimersByTime(LOCATOR_DELAY_MS);
        expect(ui.log.previews.at(-1)).toEqual([WORKSPACE.cssVariable]);
        fire(ui.row(WORKSPACE.key), 'pointerleave');
        expect(ui.log.previews.at(-1)).toEqual([]);
    });

    // Sweeping the pointer down the panel must not flash every surface.
    it('paints nothing for a pointer that only passes through', () => {
        const ui = mount();
        ui.log.previews.length = 0;
        fire(ui.row(WORKSPACE.key), 'pointerenter');
        vi.advanceTimersByTime(LOCATOR_DELAY_MS - 50);
        fire(ui.row(WORKSPACE.key), 'pointerleave');
        vi.advanceTimersByTime(LOCATOR_DELAY_MS * 2);
        expect(nonEmpty(ui.log.previews)).toEqual([]);
    });

    it('lights the idle line with a transient splitter state', () => {
        const ui = mount();
        fire(ui.row(SPLITTER_HOVER.key), 'pointerenter');
        vi.advanceTimersByTime(LOCATOR_DELAY_MS);
        expect(ui.log.previews.at(-1)).toEqual([SPLITTER_HOVER.cssVariable, SPLITTER_IDLE.cssVariable]);
    });

    // A preview is a look, not an edit.
    it('writes nothing and stores nothing', () => {
        const ui = mount();
        const before = JSON.stringify(ui.settings);
        fire(ui.row(WORKSPACE.key), 'pointerenter');
        vi.advanceTimersByTime(LOCATOR_DELAY_MS);
        fire(ui.row(WORKSPACE.key), 'pointerleave');
        expect(ui.log.update + ui.log.updateLive + ui.log.updateUi).toBe(0);
        expect(JSON.stringify(ui.settings)).toBe(before);
    });

    // A rebuild removes the hovered row without a pointerleave.
    it('is cleared by a rebuild, and a pending one is cancelled', () => {
        const ui = mount();
        fire(ui.row(WORKSPACE.key), 'pointerenter');
        ui.panel.render();
        expect(ui.log.previews.at(-1)).toEqual([]);
        ui.log.previews.length = 0;
        vi.advanceTimersByTime(LOCATOR_DELAY_MS * 3);
        expect(nonEmpty(ui.log.previews)).toEqual([]);
    });

    it('is cleared by a profile switch', () => {
        const ui = mount();
        fire(ui.row(WORKSPACE.key), 'pointerenter');
        vi.advanceTimersByTime(LOCATOR_DELAY_MS);
        const select = ui.q<HTMLSelectElement>('.nexus-studio-profile-select')!;
        select.value = STANDARD_PROFILE_ID;
        fire(select, 'change');
        expect(ui.log.previews.at(-1)).toEqual([]);
    });

    it('is cleared when the panel is disposed, and nothing fires afterwards', () => {
        const ui = mount();
        fire(ui.row(WORKSPACE.key), 'pointerenter');
        ui.panel.dispose();
        expect(ui.log.previews.at(-1)).toEqual([]);
        ui.log.previews.length = 0;
        vi.advanceTimersByTime(LOCATOR_DELAY_MS * 3);
        expect(nonEmpty(ui.log.previews)).toEqual([]);
        expect(ui.root.childElementCount).toBe(0);
    });
});

describe('the pipette', () => {
    function withEyeDropper(open: () => Promise<unknown>): { opened: () => number } {
        let count = 0;
        (window as unknown as { EyeDropper: unknown }).EyeDropper = class {
            open(): Promise<unknown> {
                count += 1;
                return open();
            }
        };
        return { opened: () => count };
    }

    it('is not offered where the screen sampler does not exist', () => {
        const ui = mount();
        expect(ui.row(WORKSPACE.key).querySelector('.nexus-studio-pipette')).toBeNull();
    });

    it('writes the sampled colour into the token', async () => {
        withEyeDropper(() => Promise.resolve({ sRGBHex: '#3A4B5C' }));
        const ui = mount();
        ui.inRow<HTMLButtonElement>(WORKSPACE.key, '.nexus-studio-pipette').click();
        await vi.waitFor(() =>
            expect(activeProfile(ui.settings).overrides[WORKSPACE.key]).toBe('#3a4b5c')
        );
    });

    // The locator's magenta must not be what gets sampled.
    it('clears the locator before the sampler opens', () => {
        let previewsWhenOpened: string[][] = [];
        const ui = mount();
        withEyeDropper(() => {
            previewsWhenOpened = [...ui.log.previews];
            return new Promise(() => undefined);
        });
        // Rendered again so the row sees the sampler that now exists.
        ui.panel.render();
        ui.inRow<HTMLButtonElement>(WORKSPACE.key, '.nexus-studio-pipette').click();
        expect(previewsWhenOpened.at(-1)).toEqual([]);
    });

    it('changes nothing when the pick is cancelled', async () => {
        const dropper = withEyeDropper(() => Promise.reject(new DOMException('cancelled', 'AbortError')));
        const ui = mount();
        ui.inRow<HTMLButtonElement>(WORKSPACE.key, '.nexus-studio-pipette').click();
        await vi.waitFor(() => expect(dropper.opened()).toBe(1));
        await Promise.resolve();
        expect(ui.log.updateLive).toBe(0);
        expect(activeProfile(ui.settings).overrides[WORKSPACE.key]).toBeUndefined();
    });
});

describe('the "theme not selected" note', () => {
    // Found in live use: the studio was open, Nexus was then selected under
    // Appearance, and the note stayed up because nothing re-checked it.
    it('follows the selected theme without rebuilding the panel', () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        let active: boolean | null = false;
        const fake = makeHost();
        const host: StudioPanelHost = { ...fake.host, themeIsActive: () => active };
        const panel = new StudioPanel(root, host);
        panel.render();
        expect(root.querySelector('.nexus-studio-warning')).not.toBeNull();

        const rowBefore = root.querySelector('.nexus-studio-row');
        active = true;
        panel.syncThemeState();
        expect(root.querySelector('.nexus-studio-warning')).toBeNull();
        // The same row element: nothing was rebuilt, so an open CSS field and
        // the focus would both have survived.
        expect(root.querySelector('.nexus-studio-row')).toBe(rowBefore);

        active = false;
        panel.syncThemeState();
        expect(root.querySelectorAll('.nexus-studio-warning')).toHaveLength(1);
    });

    // "I could not find out" is not "your theme is not active".
    it('says nothing when Obsidian will not say which theme is selected', () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        const panel = new StudioPanel(root, { ...makeHost().host, themeIsActive: () => null });
        panel.render();
        expect(root.querySelector('.nexus-studio-warning')).toBeNull();
    });

    it('is re-checked whenever Obsidian loads a theme', () => {
        const main = readFileSync('companion/nexus-theme-studio/src/main.ts', 'utf8');
        const hook = main.slice(main.indexOf("on('css-change'"));
        expect(hook.slice(0, hook.indexOf(')\n'))).toContain('syncThemeState');
    });
});

describe('the profile bar', () => {
    it('lists every profile and selects the active one', () => {
        const ui = mount();
        const select = ui.q<HTMLSelectElement>('.nexus-studio-profile-select')!;
        expect(Array.from(select.options).map((option) => option.value)).toEqual(
            ui.settings.profiles.map((profile) => profile.id)
        );
        expect(select.value).toBe(FIRST_PROFILE_ID);
    });

    it('offers every profile action, with rename and delete off for the baseline', () => {
        const ui = mount(setActiveProfile(defaultSettings(), STANDARD_PROFILE_ID));
        ui.q<HTMLButtonElement>('.nexus-studio-profile-more')!.click();
        const actions = ui.log.menus.at(-1)!;
        expect(actions.map((action) => action.id)).toEqual([
            'new',
            'duplicate',
            'rename',
            'delete',
            'export',
            'import',
        ]);
        const byId = new Map(actions.map((action) => [action.id, action]));
        expect(byId.get('rename')!.disabled).toBe(true);
        expect(byId.get('delete')!.disabled).toBe(true);
        expect(byId.get('new')!.disabled).toBe(false);
        expect(byId.get('duplicate')!.disabled).toBe(false);
    });

    it('resets the whole profile from the bar', () => {
        let start = setOverride(defaultSettings(), FIRST_PROFILE_ID, WORKSPACE.key, '#111111');
        start = setOverride(start, FIRST_PROFILE_ID, DOCUMENT.key, '#222222');
        const ui = mount(start);
        ui.q<HTMLButtonElement>('.nexus-studio-profile-reset')!.click();
        expect(activeProfile(ui.settings).overrides).toEqual({});
        expect(ui.log.update).toBe(1);
    });

    it('creates a profile through the name prompt', async () => {
        const ui = mount();
        ui.q<HTMLButtonElement>('.nexus-studio-profile-more')!.click();
        ui.log.menus.at(-1)!.find((action) => action.id === 'new')!.run();
        await vi.waitFor(() => expect(activeProfile(ui.settings).name).toBe('Named'));
    });
});

describe('an existing data.json from the settings-tab version', () => {
    // Exactly the shape the first release wrote: no `collapsedGroups`.
    const v01 = {
        version: 1,
        activeProfileId: 'profile-1',
        profiles: [
            { id: 'standard', name: 'Standard', overrides: {}, scratchCss: '', scratchEnabled: false },
            {
                id: 'custom',
                name: 'Custom',
                overrides: { workspaceSurface: '#3a3d44' },
                scratchCss: '',
                scratchEnabled: false,
            },
            {
                id: 'profile-1',
                name: 'Warm',
                overrides: {
                    documentSurface: '#1f1d1b',
                    splitterHover: 'rgba(255, 240, 220, 0.3)',
                },
                scratchCss: '.x { color: red }',
                scratchEnabled: true,
            },
        ],
    };

    it('reads without losing a profile, an override or the active choice', () => {
        const settings = normalizeSettings(JSON.parse(JSON.stringify(v01)));
        expect(settings.activeProfileId).toBe('profile-1');
        expect(settings.profiles.map((profile) => profile.name)).toEqual(['Standard', 'Custom', 'Warm']);
        expect(settings.profiles[1]!.overrides).toEqual({ workspaceSurface: '#3a3d44' });
        expect(settings.profiles[2]!.overrides).toEqual(v01.profiles[2]!.overrides);
        expect(settings.profiles[2]!.scratchCss).toBe('.x { color: red }');
        expect(settings.profiles[2]!.scratchEnabled).toBe(true);
        expect(settings.collapsedGroups).toEqual([]);
    });

    // The settings-tab chevron stored every click and folded nothing on screen.
    // The smoke vault's own data.json carried exactly this: three groups
    // "collapsed" that the user had never once seen collapse.
    it('does not carry over a fold the old version stored but never showed', () => {
        const smoke = {
            version: 1,
            activeProfileId: 'custom',
            collapsedGroups: ['interaction', 'text', 'workspace'],
            profiles: [
                { id: 'standard', name: 'Standard', overrides: {}, scratchCss: '', scratchEnabled: false },
                {
                    id: 'custom',
                    name: 'Custom',
                    overrides: {
                        workspaceSurface: '#2f3136',
                        documentSurface: '#1b1c1e',
                        splitterIdle: 'rgba(255, 255, 255, 0.15)',
                        textMuted: '#a0a4ab',
                    },
                    scratchCss: '',
                    scratchEnabled: false,
                },
            ],
        };
        const settings = normalizeSettings(JSON.parse(JSON.stringify(smoke)));
        expect(settings.collapsedGroups).toEqual([]);
        // Everything else exactly as stored.
        expect(settings.activeProfileId).toBe('custom');
        expect(settings.profiles[1]!.overrides).toEqual(smoke.profiles[1]!.overrides);

        const ui = mount(settings);
        for (const key of [...NEXUS_GROUPS, ADVANCED_GROUP]) expect(ui.body(key).hidden).toBe(false);
    });

    it('treats a file with no version at all as the old one', () => {
        const settings = normalizeSettings({ collapsedGroups: ['workspace'], profiles: [] });
        expect(settings.collapsedGroups).toEqual([]);
    });

    it('keeps a fold stored by the view itself', () => {
        const stored = JSON.parse(
            JSON.stringify(setGroupCollapsed(defaultSettings(), 'workspace', true))
        ) as { version: number };
        expect(stored.version).toBe(2);
        expect(normalizeSettings(stored).collapsedGroups).toEqual(['workspace']);
    });

    it('renders in the new view with those values on screen', () => {
        const ui = mount(normalizeSettings(JSON.parse(JSON.stringify(v01))));
        expect(ui.inRow<HTMLElement>(DOCUMENT.key, '.nexus-studio-value').textContent).toBe('#1f1d1b');
        expect(ui.inRow<HTMLInputElement>(SPLITTER_HOVER.key, '.nexus-studio-alpha').value).toBe('30');
        for (const key of [...NEXUS_GROUPS, ADVANCED_GROUP]) expect(ui.body(key).hidden).toBe(false);
    });
});
