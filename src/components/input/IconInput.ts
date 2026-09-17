/**
 * IconInput - icon input component
 * Stylesheet: IconInput.css
 */
import type { App } from 'obsidian';
import { Setting, TextComponent, getIcon } from 'obsidian';
import { t } from '@/utils/i18n';
import { safeSetSVG } from '@/utils/dom';
import type { ButtonsPanelPlugin } from '@/types/plugin';
import { IconInputSuggest } from '@/components/suggest/IconInputSuggest';

/**
 * Icon input for the settings forms, supporting SVG upload, icon search, preview and removal.
 */
export interface IconInputOptions {
    /** Setting name */
    name?: string;
    /** Setting description */
    description?: string;
    /** Input placeholder */
    placeholder?: string;
    /** Tooltip of the upload button */
    uploadTooltip?: string;
    /** Tooltip of the search button */
    searchTooltip?: string;
    /** Called when the icon changes */
    onIconChange?: (icon: string) => void;
}

/**
 * Wraps the icon input together with SVG upload, search, preview and removal.
 */
export class IconInput {
    private input!: TextComponent;
    private setting!: Setting;
    private svgPreview: HTMLSpanElement | null = null;
    private value: string = '';
    private suggest: IconInputSuggest | null = null;

    /**
     * Creates the component.
     * @param container Container element
     * @param options Component options
     * @param context Render context (app and plugin)
     * @param onValueChange Called when the value changes
     */
    constructor(
        container: HTMLElement,
        options: IconInputOptions,
		context: { app: App; plugin: ButtonsPanelPlugin },
        onValueChange?: (value: string) => void
    ) {
        this.setting = new Setting(container)
            .setName(options.name ?? t('button_icon'))
            .setDesc(options.description ?? t('button_icon_desc'));

        // Upload button.
        this.setting.addButton((btn) => {
            btn.setButtonText('')
                .setClass('icon-upload-btn')
                .setTooltip(options.uploadTooltip ?? t('upload_svg_icon_tooltip'))
                .setIcon('plus')
                .onClick(() => {
                    const fileInput = container.createEl('input');
                    fileInput.remove();
                    fileInput.type = 'file';
                    fileInput.accept = '.svg';
                    fileInput.onchange = async () => {
                        const file = fileInput.files?.[0];
                        if (file) {
                            let svgText = await file.text();
                            const match = svgText.match(/<svg[\s\S]*?<\/svg>/i);
                            if (match) svgText = match[0];
                            this.setValue(svgText);
                            onValueChange?.(svgText);
                            options.onIconChange?.(svgText);
                        }
                    };
                    fileInput.click();
                });
            btn.buttonEl.classList.add('icon-upload-btn');
        });

        // Text input.
        this.setting.addText((text) => {
            this.input = text;
            text.setPlaceholder(options.placeholder ?? t('button_icon_placeholder')).onChange(
                (value) => {
                    this.setValue(value);
                    onValueChange?.(value);
                    options.onIconChange?.(value);
                }
            );
        });

        const iconInputEl = this.setting.controlEl.querySelector('input')!;
        iconInputEl.addEventListener('input', () => this.refreshIconUI());

        // Attach the icon-id dropdown to the icon input.
        this.suggest = new IconInputSuggest(context.app, iconInputEl);
        this.suggest.onSelect((iconId, _evt) => {
            // Convert the selected icon id into SVG markup, matching the former IconSearchModal behaviour.
            const svg = getIcon?.(iconId)?.outerHTML ?? iconId;
            this.setValue(svg);
            onValueChange?.(svg);
            options.onIconChange?.(svg);
            this.suggest?.close();
        });
    }

    /**
     * Refreshes the icon UI: the preview and the visibility of the upload button.
     */
    private refreshIconUI() {
        const val = this.value;
        const HIDDEN_CLASS = 'is-hidden';
        const iconInputEl = this.setting.controlEl.querySelector('input')!;

        if (val && val.trim() !== '') {
            // Hide the upload and search buttons.
            const uploadBtn = this.setting.controlEl.querySelector(
                '.icon-upload-btn'
            ) as HTMLButtonElement;
            if (uploadBtn) uploadBtn.classList.add(HIDDEN_CLASS);

            // SVG preview.
            if (!this.svgPreview) {
                this.svgPreview = this.setting.controlEl.createSpan();
                this.svgPreview.className = 'icon-svg-preview';
            }
            safeSetSVG(this.svgPreview, val);
            this.svgPreview.classList.remove(HIDDEN_CLASS);
            this.setting.controlEl.insertBefore(this.svgPreview, iconInputEl);
        } else {
            // Show the upload and search buttons again.
            const uploadBtn = this.setting.controlEl.querySelector(
                '.icon-upload-btn'
            ) as HTMLButtonElement;
            if (uploadBtn) uploadBtn.classList.remove(HIDDEN_CLASS);
            if (this.svgPreview) this.svgPreview.classList.add(HIDDEN_CLASS);
        }
    }

    /** Sets the input value and refreshes the UI */
    setValue(value: string) {
        this.value = value;
        this.input.setValue(value);
        this.refreshIconUI();
    }

    /** Returns the input value */
    getValue(): string {
        return this.value;
    }

    /** Returns the underlying input element */
    getInputElement(): HTMLInputElement {
        return this.input.inputEl;
    }

    /** Marks the input as invalid */
    setError(message: string): void {
        this.input.inputEl.classList.add('input-error');
        this.input.inputEl.setAttribute('title', message);
    }

    /** Clears the error state */
    clearError(): void {
        this.input.inputEl.classList.remove('input-error');
        this.input.inputEl.removeAttribute('title');
    }
}
