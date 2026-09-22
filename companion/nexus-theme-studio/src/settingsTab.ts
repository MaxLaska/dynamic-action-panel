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
    type SettingDefinitionItem,
} from 'obsidian';

import { NEXUS_THEME_NAME, type ThemeTokenDefinition } from '../../../theme/nexus/src/tokens';
import { buildControlPlan } from './controlPlan';
import { effectiveValue, isOverridden, isValidTokenValue } from './overrides';
import type NexusThemeStudioPlugin from './main';
import {
    activeProfile,
    createProfile,
    deleteProfile,
    duplicateProfile,
    isLocked,
    renameProfile,
    resetProfile,
    setActiveProfile,
    setOverride,
    setScratch,
    type NexusProfile,
    type NexusStudioSettings,
} from './profiles';
import { exportProfile, parseProfileDocument, profileFileName } from './transfer';

/** A hex colour the native picker can actually display, or null. */
function pickerHex(value: string): string | null {
    const trimmed = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
    // Three-digit hex expanded rather than refused: it is a colour the picker
    // can show, just not in the form it wants.
    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(trimmed);
    if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
    return null;
}

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
    constructor(
        app: App,
        private readonly plugin: NexusThemeStudioPlugin
    ) {
        super(app, plugin);
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

    /** One group per token group, entirely from the control plan. */
    private tokenGroups(): SettingDefinitionItem[] {
        return buildControlPlan().map((group) => ({
            type: 'group' as const,
            heading: group.label,
            items: group.tokens.map((token) => ({
                name: token.label,
                desc: token.description,
                aliases: [token.cssVariable, token.key],
                render: (setting: Setting) => this.renderToken(setting, token),
            })),
        }));
    }

    /**
     * One token: a picker, the literal value, and a way back to the default.
     *
     * The text field is not a convenience beside the picker — it is the
     * authoritative control. The stored value has to stay CSS, and three of the
     * eleven v0.1 tokens are already `rgba()`, which a native colour input
     * cannot represent at all. The picker is the shortcut for the case where a
     * flat hex is what you want.
     */
    private renderToken(setting: Setting, token: ThemeTokenDefinition): void {
        const profile = this.current();
        const locked = isLocked(profile);
        const value = effectiveValue(profile.overrides, token.key);
        const overridden = isOverridden(profile.overrides, token.key);

        setting.setClass('nexus-studio-token');

        const hex = pickerHex(value);
        if (hex) {
            setting.addColorPicker((picker) =>
                picker.setValue(hex).onChange((next) => {
                    if (locked) return;
                    void this.write(token, next);
                })
            );
        }

        setting.addText((text) => {
            text.setValue(value)
                .setPlaceholder(token.defaultValue)
                .onChange((next) => {
                    if (locked) return;
                    if (next.trim().length === 0) {
                        void this.write(token, null);
                        return;
                    }
                    if (!isValidTokenValue(next)) return;
                    void this.write(token, next);
                });
            text.inputEl.addClass('nexus-studio-value');
            text.inputEl.disabled = locked;
        });

        setting.addExtraButton((button) =>
            button
                .setIcon('rotate-ccw')
                .setTooltip(`Back to the theme's ${token.defaultValue}`)
                .setDisabled(locked || !overridden)
                .onClick(() => {
                    void this.commit(
                        setOverride(this.plugin.settings, profile.id, token.key, null)
                    );
                })
        );
    }

    /**
     * Writes one token without re-rendering the tab.
     *
     * Deliberately NOT `commit`: re-rendering on every change would take the
     * focus out of the field being typed in and tear the colour picker out from
     * under the pointer mid-drag. The controls are already showing the new
     * value — they are the ones that produced it.
     */
    private async write(token: ThemeTokenDefinition, value: string | null): Promise<void> {
        const settings = this.plugin.settings;
        await this.plugin.update(setOverride(settings, this.current().id, token.key, value));
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
