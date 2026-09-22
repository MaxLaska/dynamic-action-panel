// settingsTab.ts
// The editor's surface: one settings tab, built from the token table.
//
// There is no ribbon button and no dockable view in v0.1, on purpose. A theme
// is edited in bursts and then left alone for weeks; a permanent button in the
// ribbon would cost a slot in the one piece of chrome the user sees all day, to
// save a click made rarely. Settings plus a command is the honest size of this
// feature right now, and the day it stops being is a decision, not a refactor.
//
// Nothing in this file names a token. It walks the control plan, and the plan
// comes from `theme/nexus/src/tokens.ts`. That is what makes "promote a
// discovery into a control" a two-line change rather than a UI edit.
//
// THE SHAPE OF THE TAB is declarative — `getSettingDefinitions()`, groups and
// items — so the settings are indexed by Obsidian's own settings search and so
// that `update()` is the one way to refresh. THE CONTENT of most rows is
// imperative, through the `render` escape hatch, because a token row is two
// controls and a reset button whose enabled state depends on the active
// profile, and describing that as data would be a second model of state the
// token table already holds.

import {
    App,
    Modal,
    Notice,
    PluginSettingTab,
    Setting,
    TextAreaComponent,
    type ExtraButtonComponent,
    type SettingDefinitionItem,
} from 'obsidian';

import {
    NEXUS_THEME_NAME,
    nexusToken,
    type NexusTokenGroup,
    type ThemeTokenDefinition,
} from '../../../theme/nexus/src/tokens';
import { buildControlPlan } from './controlPlan';
import { effectiveValue, isOverridden } from './overrides';
import { renderTokenRow, type TokenRowHandle } from './tokenRow';
import type NexusThemeStudioPlugin from './main';
import {
    activeProfile,
    createProfile,
    deleteProfile,
    duplicateProfile,
    isGroupCollapsed,
    isLocked,
    renameProfile,
    resetProfile,
    setActiveProfile,
    setGroupCollapsed,
    setOverride,
    setScratch,
    type NexusProfile,
    type NexusStudioSettings,
} from './profiles';
import { exportProfile, parseProfileDocument, profileFileName } from './transfer';

/** A one-field prompt, for the places a profile needs a name. */
class NameModal extends Modal {
    private value: string;

    constructor(
        app: App,
        private readonly title: string,
        initial: string,
        private readonly onSubmit: (name: string) => void
    ) {
        super(app);
        this.value = initial;
    }

    onOpen(): void {
        this.setTitle(this.title);
        const { contentEl } = this;
        new Setting(contentEl).setName('Name').addText((text) =>
            text
                .setValue(this.value)
                .onChange((next) => {
                    this.value = next;
                })
                .inputEl.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') this.submit();
                })
        );
        new Setting(contentEl)
            .addButton((button) =>
                button
                    .setButtonText('Save')
                    .setCta()
                    .onClick(() => this.submit())
            )
            .addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()));
    }

    private submit(): void {
        const name = this.value.trim();
        if (!name) {
            new Notice('A profile needs a name.');
            return;
        }
        this.close();
        this.onSubmit(name);
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/**
 * Import and export, as text rather than as a file dialog.
 *
 * A textarea instead of a file picker for one reason: a file dialog would mean
 * this plugin writes somewhere, and the one thing it must never do is put its
 * state anywhere except its own `data.json`. Text goes to the clipboard, and
 * from there wherever the user wants it — including a file called
 * `nexus-theme-profile.json`, which is what the export names it.
 */
class TransferModal extends Modal {
    private text: string;

    constructor(
        app: App,
        private readonly mode: 'export' | 'import',
        private readonly profile: NexusProfile,
        private readonly onImport: (text: string) => void
    ) {
        super(app);
        this.text = mode === 'export' ? exportProfile(profile) : '';
    }

    onOpen(): void {
        const { contentEl } = this;
        this.setTitle(
            this.mode === 'export' ? `Export "${this.profile.name}"` : 'Import a profile'
        );
        contentEl.createEl('p', {
            cls: 'nexus-studio-hint',
            text:
                this.mode === 'export'
                    ? `Save this as ${profileFileName(this.profile)}.`
                    : 'Paste a profile below. It is imported as a new profile; nothing existing is replaced.',
        });
        const area = new TextAreaComponent(contentEl).setValue(this.text).onChange((next) => {
            this.text = next;
        });
        area.inputEl.addClass('nexus-studio-transfer');

        new Setting(contentEl).addButton((button) => {
            if (this.mode === 'export') {
                button
                    .setButtonText('Copy')
                    .setCta()
                    .onClick(() => {
                        void navigator.clipboard.writeText(this.text).then(
                            () => new Notice('Profile copied.'),
                            () => new Notice('Could not reach the clipboard.')
                        );
                    });
                return;
            }
            button
                .setButtonText('Import')
                .setCta()
                .onClick(() => {
                    this.close();
                    this.onImport(this.text);
                });
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

export class NexusThemeStudioSettingTab extends PluginSettingTab {
    /**
     * The token rows currently on screen.
     *
     * Held so that one write can bring every row's controls back in step
     * without re-rendering the tab. Rows remove themselves through the cleanup
     * function their `render` returns, so a re-render does not leave handles to
     * detached elements behind.
     */
    private readonly rows = new Set<TokenRowHandle>();

    constructor(
        app: App,
        private readonly plugin: NexusThemeStudioPlugin
    ) {
        super(app, plugin);
    }

    /**
     * Closing the tab takes the locator preview down with it.
     *
     * The preview is cleared on `pointerleave` in the ordinary case, but a tab
     * can be closed, or Obsidian's settings dismissed with Escape, while the
     * pointer is still on a row — and a workspace left magenta by a hover is
     * exactly the "hanging state" this feature must not have.
     */
    hide(): void {
        this.plugin.setPreview([]);
        super.hide();
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            this.themeStateDefinition(),
            this.profileGroup(),
            ...this.tokenGroups(),
            this.advancedGroup(),
        ];
    }

    /** The profile every control on this tab is currently editing. */
    private current(): NexusProfile {
        return activeProfile(this.plugin.settings);
    }

    /**
     * Persists, repaints the running app, and re-renders the tab.
     *
     * `update()` rather than `display()`: which rows exist and which are
     * disabled both depend on the active profile, and only `update()`
     * re-evaluates the definitions.
     */
    private async commit(next: NexusStudioSettings): Promise<void> {
        await this.plugin.update(next);
        this.update();
    }

    /**
     * Says so when the tokens edited here are not the ones on screen.
     *
     * Only for a definite "no". `themeIsActive` returns null when Obsidian will
     * not say which theme is selected, and a hint that might be wrong is worse
     * than no hint on a screen full of colour pickers.
     */
    private themeStateDefinition(): SettingDefinitionItem {
        return {
            name: `The ${NEXUS_THEME_NAME} theme is not selected`,
            desc: `These controls change ${NEXUS_THEME_NAME} tokens. Choose ${NEXUS_THEME_NAME} under Appearance to see them take effect.`,
            visible: () => this.plugin.themeIsActive() === false,
            searchable: false,
        };
    }

    private profileGroup(): SettingDefinitionItem {
        return {
            type: 'group',
            heading: 'Profile',
            items: [
                {
                    name: 'Active profile',
                    desc: 'A named set of overrides on top of the theme defaults.',
                    render: (setting) => {
                        const settings = this.plugin.settings;
                        setting.addDropdown((dropdown) => {
                            for (const profile of settings.profiles) {
                                dropdown.addOption(profile.id, profile.name);
                            }
                            dropdown.setValue(this.current().id).onChange((id) => {
                                void this.commit(setActiveProfile(settings, id));
                            });
                        });
                    },
                },
                {
                    name: 'Manage profiles',
                    desc: 'New and duplicate always work. Rename and delete do not apply to the baseline.',
                    render: (setting) => this.renderManageButtons(setting),
                },
                {
                    name: 'Reset and transfer',
                    desc: "Reset clears this profile's own overrides. It never touches the theme's files or another plugin.",
                    render: (setting) => this.renderResetButtons(setting),
                },
                {
                    name: 'This profile is the baseline',
                    desc: `It is the theme's own values and cannot be edited, which is what makes switching back to it a reliable way home. Duplicate it to start changing values.`,
                    visible: () => isLocked(this.current()),
                    searchable: false,
                },
            ],
        };
    }

    private renderManageButtons(setting: Setting): void {
        const current = this.current();
        setting
            .addButton((button) =>
                button.setButtonText('New').onClick(() => {
                    new NameModal(this.app, 'New profile', 'Profile', (name) => {
                        void this.commit(createProfile(this.plugin.settings, name));
                    }).open();
                })
            )
            .addButton((button) =>
                button.setButtonText('Duplicate').onClick(() => {
                    new NameModal(
                        this.app,
                        'Duplicate profile',
                        `${current.name} copy`,
                        (name) => {
                            void this.commit(
                                duplicateProfile(this.plugin.settings, current.id, name)
                            );
                        }
                    ).open();
                })
            )
            .addButton((button) =>
                button
                    .setButtonText('Rename')
                    .setDisabled(isLocked(current))
                    .onClick(() => {
                        new NameModal(this.app, 'Rename profile', current.name, (name) => {
                            void this.commit(
                                renameProfile(this.plugin.settings, current.id, name)
                            );
                        }).open();
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText('Delete')
                    .setDestructive()
                    .setDisabled(isLocked(current))
                    .onClick(() => {
                        void this.commit(deleteProfile(this.plugin.settings, current.id));
                    })
            );
    }

    private renderResetButtons(setting: Setting): void {
        const current = this.current();
        setting
            .addButton((button) =>
                button
                    .setButtonText(`Reset to ${NEXUS_THEME_NAME} defaults`)
                    .setDisabled(isLocked(current))
                    .onClick(() => {
                        void this.commit(resetProfile(this.plugin.settings, current.id));
                    })
            )
            .addButton((button) =>
                button.setButtonText('Export').onClick(() => {
                    new TransferModal(this.app, 'export', current, () => undefined).open();
                })
            )
            .addButton((button) =>
                button.setButtonText('Import').onClick(() => {
                    new TransferModal(this.app, 'import', current, (text) =>
                        this.import(text)
                    ).open();
                })
            );
    }

    /** Reads an exported profile back in, as a new profile, or explains why not. */
    private import(text: string): void {
        const result = parseProfileDocument(text);
        if (!result.ok) {
            new Notice(`Import refused: ${result.reason}`);
            return;
        }
        const withProfile = createProfile(this.plugin.settings, result.document.name);
        const created = activeProfile(withProfile);
        let next = withProfile;
        for (const [key, value] of Object.entries(result.document.overrides)) {
            next = setOverride(next, created.id, key, value);
        }
        if (result.document.scratchCss) {
            next = setScratch(next, created.id, { css: result.document.scratchCss });
        }
        void this.commit(next);
        new Notice(`Imported "${created.name}".`);
    }

    /**
     * One group per token group, entirely from the control plan.
     *
     * Collapsing is a CLASS on the group, not a `visible` flag on each item.
     * The difference matters twice: a folded group keeps its heading (which is
     * where the toggle lives, so a `visible`-based fold could hide its own way
     * back), and its settings stay in Obsidian's settings search, which is
     * where someone who has folded a section will go looking for it.
     */
    private tokenGroups(): SettingDefinitionItem[] {
        return buildControlPlan().map((group) => {
            const collapsed = isGroupCollapsed(this.plugin.settings, group.group);
            return {
                type: 'group' as const,
                heading: group.label,
                // ONE class name, never two separated by a space: a group's
                // `cls` reaches `classList.add` unsplit, which throws on a
                // space. Measured in Obsidian 1.13.7's SettingGroup.addClass.
                cls: collapsed ? 'nexus-studio-group-collapsed' : 'nexus-studio-group',
                extraButtons: [
                    (button: ExtraButtonComponent) =>
                        this.renderCollapseToggle(button, group.group, group.label, collapsed),
                ],
                items: group.tokens.map((token) => ({
                    name: token.label,
                    desc: token.description,
                    aliases: [token.cssVariable, token.key],
                    render: (setting: Setting) => this.renderToken(setting, token),
                })),
            };
        });
    }

    /**
     * The chevron that folds a group.
     *
     * Obsidian already gives a group's extra button `tabIndex=0`, so it is
     * reachable by keyboard; what it does not give is a key handler or a state
     * to announce, which is what the rest of this adds. No animation: the list
     * is short, and a height transition on a settings page is motion nobody
     * asked for.
     */
    private renderCollapseToggle(
        button: ExtraButtonComponent,
        group: NexusTokenGroup,
        label: string,
        collapsed: boolean
    ): void {
        const toggle = (): void => {
            void this.commit(
                setGroupCollapsed(this.plugin.settings, group, !collapsed)
            );
        };
        button
            .setIcon(collapsed ? 'chevron-right' : 'chevron-down')
            .setTooltip(collapsed ? `Show ${label}` : `Hide ${label}`)
            .onClick(toggle);
        const el = button.extraSettingsEl;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        el.setAttribute('aria-label', collapsed ? `Show ${label}` : `Hide ${label}`);
        el.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            toggle();
        });
    }

    /**
     * One token: a swatch, a pipette, an opacity where it means something, the
     * literal value, and a way back to the default.
     *
     * The row is built by `tokenRow.ts` and keeps a handle so it can redraw
     * itself after a write without the tab re-rendering. That is what makes the
     * per-token reset arrow correct: it has to become enabled the moment the
     * token gains an override, and a write deliberately does not re-render.
     */
    private renderToken(setting: Setting, token: ThemeTokenDefinition): () => void {
        const handle = renderTokenRow(setting, token, {
            currentValue: (item) => effectiveValue(this.current().overrides, item.key),
            isOverridden: (item) => isOverridden(this.current().overrides, item.key),
            isLocked: () => isLocked(this.current()),
            write: (item, value) => this.write(item, value),
            preview: (item) => this.preview(item),
        });
        this.rows.add(handle);
        return () => {
            this.rows.delete(handle);
            handle.dispose();
        };
    }

    /**
     * Writes one token without re-rendering the tab.
     *
     * Deliberately NOT `commit`: re-rendering on every change would take the
     * focus out of the field being typed in and tear the colour picker out from
     * under the pointer mid-drag. Every OTHER row is re-synced instead, because
     * one write changes what "overridden" means for exactly one row but the
     * cost of refreshing eleven is nothing.
     */
    private async write(token: ThemeTokenDefinition, value: string | null): Promise<void> {
        const settings = this.plugin.settings;
        // `updateLive`, not `update`: a colour picker emits a change per frame
        // while it is dragged, and each one must reach the screen immediately
        // while only the last one needs to reach the disk.
        this.plugin.updateLive(setOverride(settings, this.current().id, token.key, value));
        for (const row of this.rows) row.syncControls();
        return Promise.resolve();
    }

    /**
     * Starts or stops the locator preview.
     *
     * `null` means stop. The tokens sent to the plugin are this one plus
     * whatever the table says to light up with it — the splitter states name
     * the idle line, because hovering "Splitter (hover)" can otherwise show
     * nothing at all: no edge is being hovered at that moment.
     *
     * Nothing here writes. `setPreview` is a different method from `update` on
     * purpose, and only the latter saves.
     */
    private preview(token: ThemeTokenDefinition | null): void {
        if (!token) {
            this.plugin.setPreview([]);
            return;
        }
        const keys = [token.key, ...(token.locateAlso ?? [])];
        const variables = keys.flatMap((key) => {
            const found = nexusToken(key);
            return found ? [found.cssVariable] : [];
        });
        this.plugin.setPreview(variables);
    }

    /**
     * Developer scratch CSS.
     *
     * A DEVELOPMENT TOOL, not the architecture. It exists so that something
     * found in DevTools survives a reload while it is being judged — the step
     * between "that looks better" and "that is a token now". It is stored
     * separately from tokens, it is off unless switched on, and clearing it
     * removes the stylesheet entirely rather than leaving an empty one behind.
     *
     * There is no syntax highlighting and no selector help, on purpose. The
     * tool that is good at that is already open in the next window.
     */
    private advancedGroup(): SettingDefinitionItem {
        return {
            type: 'group',
            heading: 'Advanced',
            items: [
                {
                    name: 'Developer scratch CSS',
                    desc: 'Applied to the Obsidian window while it is on. For trying something out; promote anything worth keeping into a token and a theme rule.',
                    render: (setting) => {
                        const current = this.current();
                        setting.addToggle((toggle) =>
                            toggle
                                .setValue(current.scratchEnabled)
                                .setDisabled(isLocked(current))
                                .onChange((enabled) => {
                                    void this.commit(
                                        setScratch(this.plugin.settings, current.id, { enabled })
                                    );
                                })
                        );
                    },
                },
                {
                    name: 'Scratch CSS',
                    desc: 'Applied when you press Apply.',
                    searchable: false,
                    render: (setting) => this.renderScratchEditor(setting),
                },
            ],
        };
    }

    private renderScratchEditor(setting: Setting): void {
        const current = this.current();
        const locked = isLocked(current);
        setting.setClass('nexus-studio-scratch');

        let draft = current.scratchCss;
        setting.addTextArea((area) => {
            area.setPlaceholder('.workspace-tab-header { ... }')
                .setValue(current.scratchCss)
                .onChange((next) => {
                    draft = next;
                });
            area.inputEl.disabled = locked;
        });

        setting.addButton((button) =>
            button
                .setButtonText('Apply')
                .setCta()
                .setDisabled(locked)
                .onClick(() => {
                    void this.commit(
                        setScratch(this.plugin.settings, current.id, { css: draft })
                    );
                })
        );

        setting.addButton((button) =>
            button
                .setButtonText('Clear')
                .setDestructive()
                .setDisabled(locked)
                .onClick(() => {
                    void this.commit(
                        setScratch(this.plugin.settings, current.id, {
                            css: '',
                            enabled: false,
                        })
                    );
                })
        );
    }
}
