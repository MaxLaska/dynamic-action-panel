/**
 * ConditionsInput - advanced (developer-facing) editor for OCAP button
 * visibility conditions.
 *
 * Deliberately minimal for the Phase 2 foundation: the declarative condition
 * tree is edited as JSON in a textarea with structural validation
 * (isValidCondition). A visual condition builder is a documented later step;
 * this input exists so conditions are configurable and testable in the real
 * plugin UI without building that UI prematurely.
 */
import { Setting, TextAreaComponent } from 'obsidian';
import type { ButtonCondition } from '@/types/conditions';
import { isValidCondition } from '@/context/conditions';
import { t } from '@/utils/i18n';

/** Result of reading the input: either a valid (possibly absent) condition or an error. */
export type ConditionsInputResult =
    | { ok: true; conditions: ButtonCondition | undefined }
    | { ok: false; error: string };

export class ConditionsInput {
    private setting: Setting;
    private textArea!: TextAreaComponent;

    constructor(container: HTMLElement, initialValue: ButtonCondition | undefined) {
        this.setting = new Setting(container)
            .setName(t('conditions_advanced'))
            .setDesc(t('conditions_advanced_desc'));
        this.setting.settingEl.addClass('ocap-conditions-input');

        this.setting.addTextArea((textArea) => {
            this.textArea = textArea;
            textArea.setPlaceholder('{"rule":"viewType","value":"markdown"}');
            textArea.inputEl.rows = 4;
            textArea.inputEl.addClass('ocap-conditions-textarea');
            if (initialValue !== undefined) {
                textArea.setValue(JSON.stringify(initialValue, null, 2));
            }
            textArea.onChange(() => {
                this.clearError();
            });
        });
    }

    /**
     * Parse and validate the current text.
     * Empty text means "no conditions" (always visible).
     */
    getResult(): ConditionsInputResult {
        const text = this.textArea.getValue().trim();
        if (text.length === 0) {
            this.clearError();
            return { ok: true, conditions: undefined };
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            const error = t('conditions_invalid_json');
            this.setError(error);
            return { ok: false, error };
        }

        if (!isValidCondition(parsed)) {
            const error = t('conditions_invalid_structure');
            this.setError(error);
            return { ok: false, error };
        }

        this.clearError();
        return { ok: true, conditions: parsed };
    }

    private setError(message: string): void {
        this.textArea.inputEl.classList.add('input-error');
        this.textArea.inputEl.setAttribute('title', message);
    }

    private clearError(): void {
        this.textArea.inputEl.classList.remove('input-error');
        this.textArea.inputEl.removeAttribute('title');
    }
}
