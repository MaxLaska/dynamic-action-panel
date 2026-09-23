// modals.ts
// The dialogs the studio still needs: a name, a profile as text, a palette as
// text, and a yes/no before something is thrown away.
//
// Everything else the studio does happens in its workspace view, beside the
// surfaces it is changing. These two are modal on purpose: naming a profile and
// pasting one in are short, deliberate steps with a clear end, and neither needs
// the workspace visible while it happens.

import { App, Modal, Notice, Setting, TextAreaComponent } from 'obsidian';

import { DEFAULT_PALETTE_NAME, paletteFileName, serializePalette } from './colorLibrary';
import type { NexusProfile } from './profiles';
import { exportProfile, profileFileName } from './transfer';

/**
 * Asks for a profile name. Resolves with the trimmed name, or null when the
 * dialog was dismissed — every way of closing it resolves exactly once.
 */
export function promptForName(app: App, title: string, initial: string): Promise<string | null> {
    return new Promise((resolve) => {
        new NameModal(app, title, initial, resolve).open();
    });
}

class NameModal extends Modal {
    private value: string;
    private settled = false;

    constructor(
        app: App,
        private readonly title: string,
        initial: string,
        private readonly resolve: (name: string | null) => void
    ) {
        super(app);
        this.value = initial;
    }

    onOpen(): void {
        // The studio's own palette, not the theme's: see styles.css.
        this.modalEl.addClass('nexus-studio-isolated');
        this.setTitle(this.title);
        const { contentEl } = this;
        new Setting(contentEl).setName('Name').addText((text) => {
            text.setValue(this.value).onChange((next) => {
                this.value = next;
            });
            text.inputEl.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') this.submit();
            });
            // Selected, so typing replaces the suggestion instead of appending.
            window.setTimeout(() => text.inputEl.select(), 0);
        });
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
        this.settle(name);
        this.close();
    }

    private settle(value: string | null): void {
        if (this.settled) return;
        this.settled = true;
        this.resolve(value);
    }

    onClose(): void {
        // Escape, the close button and a click outside all land here; a name
        // that was not submitted is a cancel.
        this.settle(null);
        this.contentEl.empty();
    }
}

/**
 * Import and export, as text rather than as a file dialog.
 *
 * A file dialog would mean this plugin writes somewhere, and the one thing it
 * must never do is put its state anywhere except its own `data.json`. Text goes
 * to the clipboard, and from there wherever the user wants it.
 */
export class TransferModal extends Modal {
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
        this.modalEl.addClass('nexus-studio-isolated');
        const { contentEl } = this;
        this.setTitle(this.mode === 'export' ? `Export "${this.profile.name}"` : 'Import a profile');
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

/**
 * The saved colours as a palette file's text: a name, the JSON, Copy.
 *
 * Text rather than a save dialog, for the same reason as the profile export:
 * the studio writes nothing but its own `data.json`. The suggested file name
 * says what to call it wherever the user puts it.
 */
export class PaletteExportModal extends Modal {
    private name = DEFAULT_PALETTE_NAME;

    constructor(
        app: App,
        private readonly colors: readonly string[]
    ) {
        super(app);
    }

    onOpen(): void {
        this.modalEl.addClass('nexus-studio-isolated');
        this.setTitle('Export palette');
        const { contentEl } = this;
        const hint = contentEl.createEl('p', { cls: 'nexus-studio-hint' });
        let area: TextAreaComponent | null = null;
        const refresh = (): void => {
            hint.setText(
                `${this.colors.length} saved colours. Save this as ${paletteFileName(this.name)}. Recent colours are not part of a palette.`
            );
            area?.setValue(serializePalette(this.name, this.colors));
        };
        new Setting(contentEl).setName('Palette name').addText((text) =>
            text.setValue(this.name).onChange((next) => {
                this.name = next;
                refresh();
            })
        );
        area = new TextAreaComponent(contentEl);
        area.inputEl.addClass('nexus-studio-transfer');
        area.inputEl.readOnly = true;
        refresh();
        new Setting(contentEl).addButton((button) =>
            button
                .setButtonText('Copy')
                .setCta()
                .onClick(() => {
                    void navigator.clipboard.writeText(serializePalette(this.name, this.colors)).then(
                        () => new Notice('Palette copied.'),
                        () => new Notice('Could not reach the clipboard.')
                    );
                })
        );
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/**
 * A palette file into the saved colours: pasted, or read from a file the user
 * picks. Reading only — the file input opens the system's open dialog and
 * hands over the text; nothing is written anywhere. The import MERGES.
 */
export class PaletteImportModal extends Modal {
    private text = '';

    constructor(
        app: App,
        private readonly onImport: (text: string) => void
    ) {
        super(app);
    }

    onOpen(): void {
        this.modalEl.addClass('nexus-studio-isolated');
        this.setTitle('Import palette');
        const { contentEl } = this;
        contentEl.createEl('p', {
            cls: 'nexus-studio-hint',
            text: 'Paste a palette, or choose a .nexus-color-palette.json file. Its colours are added to your saved colours; nothing is removed, and no theme value changes.',
        });
        const area = new TextAreaComponent(contentEl).onChange((next) => {
            this.text = next;
        });
        area.inputEl.addClass('nexus-studio-transfer');
        const file = contentEl.createEl('input', {
            cls: 'nexus-studio-palette-file',
            attr: { type: 'file', accept: '.json,application/json' },
        });
        file.addEventListener('change', () => {
            const chosen = file.files?.[0];
            if (!chosen) return;
            void chosen.text().then(
                (content) => {
                    this.text = content;
                    area.setValue(content);
                },
                () => new Notice('That file could not be read.')
            );
        });
        new Setting(contentEl)
            .addButton((button) => button.setButtonText('Choose file…').onClick(() => file.click()))
            .addButton((button) =>
                button
                    .setButtonText('Import')
                    .setCta()
                    .onClick(() => {
                        this.close();
                        this.onImport(this.text);
                    })
            );
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/** Asks before something is thrown away. Resolves true only for the action button. */
export function confirmAction(app: App, title: string, message: string, action: string): Promise<boolean> {
    return new Promise((resolve) => {
        new ConfirmModal(app, title, message, action, resolve).open();
    });
}

class ConfirmModal extends Modal {
    private settled = false;

    constructor(
        app: App,
        private readonly title: string,
        private readonly message: string,
        private readonly action: string,
        private readonly resolve: (yes: boolean) => void
    ) {
        super(app);
    }

    onOpen(): void {
        this.modalEl.addClass('nexus-studio-isolated');
        this.setTitle(this.title);
        this.contentEl.createEl('p', { text: this.message });
        new Setting(this.contentEl)
            .addButton((button) =>
                button
                    .setButtonText(this.action)
                    .setDestructive()
                    .onClick(() => {
                        this.settle(true);
                        this.close();
                    })
            )
            .addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()));
    }

    private settle(yes: boolean): void {
        if (this.settled) return;
        this.settled = true;
        this.resolve(yes);
    }

    onClose(): void {
        // Escape, the close button and a click outside are all "no".
        this.settle(false);
        this.contentEl.empty();
    }
}
