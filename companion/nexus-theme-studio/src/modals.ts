// modals.ts
// The two dialogs the studio still needs: a name, and a profile as text.
//
// Everything else the studio does happens in its workspace view, beside the
// surfaces it is changing. These two are modal on purpose: naming a profile and
// pasting one in are short, deliberate steps with a clear end, and neither needs
// the workspace visible while it happens.

import { App, Modal, Notice, Setting, TextAreaComponent } from 'obsidian';

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
