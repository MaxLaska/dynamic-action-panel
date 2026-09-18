import { App, PluginSettingTab, Setting, TextComponent, Notice, normalizePath } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import { ButtonsPanelPlugin } from '@/types';
import { FolderInputSuggest } from '@/components/suggest/FolderInputSuggest';
import { openTemplateLibraryFolder } from '@/export/templateIo';
import { TEMPLATE_LIBRARY_FOLDER } from '@/export/templateLibrary';
import { t, tWithParams } from '@/utils/i18n';
import { canMutateSettings, futureSettingsBlock } from '@/utils/settingsWriteGuard';

export class ButtonsPanelSettingTab extends PluginSettingTab {
    plugin: ButtonsPanelPlugin;
    icon: string = "mouse";

    constructor(app: App, plugin: ButtonsPanelPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        const block = futureSettingsBlock(this.plugin);
        return [
            // Only present when it applies: a disabled form with no explanation
            // is worse than no form at all.
            ...(block
                ? [
                      {
                          name: t('settings_future_heading'),
                          desc:
                              block.storedVersion === null
                                  ? t('settings_unreadable_readonly')
                                  : tWithParams('settings_future_readonly', {
                                        stored: block.storedVersion,
                                        supported: block.supportedVersion,
                                    }),
                          render: () => {},
                      },
                  ]
                : []),
            {
                name: t('show_top_nav_bar'),
                desc: t('show_top_nav_bar_desc'),
                render: (setting) => this.renderPanelToggle(setting, 'showTopNavBar'),
            },
            {
                name: t('enable_button_animation'),
                desc: t('enable_button_animation_desc'),
                render: (setting) => this.renderPanelToggle(setting, 'enableAnimation'),
            },
            {
                name: t('show_button_tooltip'),
                desc: t('show_button_tooltip_desc'),
                render: (setting) => this.renderPanelToggle(setting, 'showButtonTooltip'),
            },
            {
                type: 'group',
                heading: t('list_options'),
                items: [
                    {
                        name: t('auto_collapse_list_view'),
                        desc: t('auto_collapse_list_view_desc'),
                        render: (setting) => this.renderPanelToggle(setting, 'listAutoCollapse'),
                    },
                ],
            },
            {
                type: 'group',
                heading: t('tabs_options'),
                items: [
                    {
                        name: t('tabs_wrap'),
                        desc: t('tabs_wrap_desc'),
                        render: (setting) => this.renderPanelToggle(setting, 'tabsWrap'),
                    },
                ],
            },
            {
                type: 'group',
                heading: t('folder_options'),
                items: [
                    {
                        name: t('folder_name_editable'),
                        desc: t('folder_name_editable_desc'),
                        render: (setting) => this.renderPanelToggle(setting, 'folderDetailNameEditable'),
                    },
                    {
                        name: t('folder_show_btn_count'),
                        desc: t('folder_show_btn_count_desc'),
                        render: (setting) => this.renderPanelToggle(setting, 'folderShowBtnCount'),
                    },
                    {
                        name: t('folder_close_on_blank'),
                        desc: t('folder_close_on_blank_desc'),
                        render: (setting) => this.renderPanelToggle(setting, 'folderCloseOnBlankClick'),
                    },
                ],
            },
            {
                type: 'group',
                heading: t('path_options'),
                items: [
                    {
                        name: t('template_folder'),
                        desc: t('template_folder_desc'),
                        render: (setting) => this.renderPathInput(setting, 'templateFolderPath', t('template_folder_placeholder')),
                    },
                    {
                        name: t('script_folder'),
                        desc: t('script_folder_desc'),
                        render: (setting) => this.renderPathInput(setting, 'scriptFolderPath', t('script_folder_placeholder')),
                    },
                    {
                        name: t('create_paths'),
                        desc: t('create_paths_desc'),
                        render: (setting) => this.renderCreatePathsButton(setting),
                    },
                    {
                        // The panel-template library, which is a FIXED folder
                        // and therefore has no path input above it — the row
                        // exists to name the folder and to get the user to it.
                        name: t('template_library_title'),
                        desc: `${t('template_open_folder_desc')} (${TEMPLATE_LIBRARY_FOLDER})`,
                        render: (setting) => this.renderOpenTemplateFolderButton(setting),
                    },
                ],
            },
        ];
    }

    /**
     * Whether the settings may be changed at all.
     *
     * A configuration written by a newer build is read-only, and a settings tab
     * is the one place where a visibly disabled control is clearer than a
     * refusal after the fact: it is a form, so a switch that flips back on the
     * next open is exactly the kind of thing someone discovers ten minutes too
     * late. `silent` because merely rendering the tab is not an attempt to
     * change anything.
     */
    private get readOnly(): boolean {
        return !canMutateSettings(this.plugin, { silent: true });
    }

    private renderPanelToggle(setting: Setting, key: string): void {
        const config = this.plugin.settings.panelConfig as unknown as Record<string, unknown>;
        setting.addToggle((toggle) => {
            toggle
                .setValue((config[key] as boolean) ?? false)
                .setDisabled(this.readOnly)
                .onChange(async (value) => {
                    config[key] = value;
                    await this.plugin.saveSettings();
                });
        });
    }

    private renderPathInput(
        setting: Setting,
        key: 'templateFolderPath' | 'scriptFolderPath',
        placeholder: string,
    ): void {
        let input: TextComponent;

        setting.addText((text) => {
            input = text
                .setPlaceholder(placeholder)
                .setValue(this.plugin.settings.pathConfig[key] ?? '')
                .setDisabled(this.readOnly);

            const suggest = new FolderInputSuggest(this.app, input.inputEl);
            suggest.onSelect((folderPath) => {
                input.setValue(folderPath);
                this.plugin.settings.pathConfig[key] = folderPath;
                void this.plugin.saveSettings();
                suggest.close();
            });

            text.onChange(async (value) => {
                this.plugin.settings.pathConfig[key] = value;
                await this.plugin.saveSettings();
            });
        });
    }

    private renderCreatePathsButton(setting: Setting): void {
        setting.addButton((button) => {
            button
                .setButtonText(t('create_paths'))
                .setClass('mod-warning')
                .onClick(() => {
                    void this.createPaths();
                });
        });
    }

    /**
     * Opens the panel-template library folder. Not `mod-warning`: unlike
     * "Create paths" next to it, this only reveals a folder.
     */
    private renderOpenTemplateFolderButton(setting: Setting): void {
        setting.addButton((button) => {
            button.setButtonText(t('template_open_folder')).onClick(() => {
                void openTemplateLibraryFolder(this.app);
            });
        });
    }

    private async createPaths(): Promise<void> {
        const paths = [
            this.plugin.settings.pathConfig.templateFolderPath,
            this.plugin.settings.pathConfig.scriptFolderPath,
        ];
        const created: string[] = [];

        for (const p of paths) {
            const normalized = normalizePath(p || '');
            if (normalized && !this.app.vault.getFolderByPath(normalized)) {
                try {
                    await this.app.vault.createFolder(normalized);
                    created.push(normalized);
                } catch {
                    new Notice(t('create_folder_failed') + `: ${normalized}`);
                    return;
                }
            }
        }

        if (created.length > 0) {
            new Notice(t('folders_created_success') + `: ${created.join(', ')}`);
        } else {
            new Notice(t('all_paths_exist'));
        }
    }
}
