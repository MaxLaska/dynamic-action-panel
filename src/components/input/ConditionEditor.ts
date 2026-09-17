/**
 * ConditionEditor - reusable visual editor for visibility conditions.
 *
 * Primary UX is a visual builder operating directly on the declarative
 * condition model (src/types/conditions.ts) via the pure tree helpers in
 * src/context/conditionTree.ts — no parallel editing model, no eval.
 *
 * An "Advanced: JSON" section shows the serialized tree, stays in sync with
 * the builder and can load hand-written JSON back into it via Apply. Invalid
 * JSON is never saved silently: getResult() re-validates unapplied JSON and
 * blocks the save with an error instead.
 *
 * Used by the button create/edit modals and the category create/edit modals;
 * later consumers (e.g. enabledWhen) can reuse it unchanged.
 */
import { Setting, setIcon } from 'obsidian';
import type { ButtonCondition, ConditionRule } from '@/types/conditions';
import { isValidCondition, MAX_CONDITION_DEPTH } from '@/context/conditions';
import {
    addChildAtPath,
    conditionDepth,
    convertRuleKind,
    createDefaultRule,
    getConditionKind,
    getGroupChildren,
    getNodeAtPath,
    isConditionGroup,
    removeNodeAtPath,
    replaceNodeAtPath,
    setGroupKindAtPath,
    type ConditionGroupKind,
    type ConditionPath,
    type ConditionRuleKind,
} from '@/context/conditionTree';
import { t } from '@/utils/i18n';

/** Result of reading the editor: either a valid (possibly absent) condition or an error. */
export type ConditionEditorResult =
    | { ok: true; conditions: ButtonCondition | undefined }
    | { ok: false; error: string };

export interface ConditionEditorOptions {
    /** Heading of the section (defaults to the shared conditions label). */
    name?: string;
    /** Description under the heading. */
    description?: string;
}

const GROUP_KINDS: ConditionGroupKind[] = ['all', 'any', 'not'];
// Ordered by how directly a user can answer "what do I want to match?" —
// the name of the note first, the technical Obsidian view type last.
const RULE_KINDS: ConditionRuleKind[] = [
    'fileName',
    'folder',
    'path',
    'extension',
    'property',
    'tag',
    'viewType',
];

/** The rule a fresh condition starts with; the most self-explanatory one. */
const DEFAULT_RULE_KIND: ConditionRuleKind = 'fileName';

const GROUP_KIND_LABEL_KEYS: Record<ConditionGroupKind, string> = {
    all: 'conditions_group_all',
    any: 'conditions_group_any',
    not: 'conditions_group_not',
};

const RULE_KIND_LABEL_KEYS: Record<ConditionRuleKind, string> = {
    viewType: 'conditions_rule_view_type',
    fileName: 'conditions_rule_file_name',
    path: 'conditions_rule_path',
    folder: 'conditions_rule_folder',
    extension: 'conditions_rule_extension',
    property: 'conditions_rule_property',
    tag: 'conditions_rule_tag',
};

const OP_LABEL_KEYS: Record<string, string> = {
    equals: 'conditions_op_equals',
    startsWith: 'conditions_op_starts_with',
    contains: 'conditions_op_contains',
    endsWith: 'conditions_op_ends_with',
    exists: 'conditions_op_exists',
};

/** Common Obsidian view types offered as suggestions (free text stays allowed). */
const VIEW_TYPE_SUGGESTIONS = [
    'markdown',
    'pdf',
    'canvas',
    'image',
    'audio',
    'video',
    'graph',
    'empty',
];

let viewTypeDatalistCounter = 0;

export class ConditionEditor {
    /** Current condition tree; undefined = no conditions (always visible). */
    private root: ButtonCondition | undefined;
    /** True when the JSON textarea contains edits not applied to the builder. */
    private jsonDirty = false;

    private builderEl!: HTMLElement;
    private jsonTextArea!: HTMLTextAreaElement;
    private datalistId: string;

    constructor(
        container: HTMLElement,
        initialValue: ButtonCondition | undefined,
        options?: ConditionEditorOptions
    ) {
        this.datalistId = `ocap-view-type-suggestions-${viewTypeDatalistCounter++}`;

        const heading = new Setting(container)
            .setName(options?.name ?? t('conditions_label'))
            .setDesc(options?.description ?? t('conditions_desc'));
        heading.settingEl.addClass('ocap-condition-editor-heading');

        const editorEl = container.createDiv('ocap-condition-editor');
        this.builderEl = editorEl.createDiv('ocap-condition-builder');
        this.createViewTypeDatalist(editorEl);

        // Load the initial value. Structurally invalid stored data (fail-open
        // at runtime) is surfaced here: the builder starts empty and the raw
        // JSON is prefilled in the advanced section for correction.
        let invalidInitialJson: string | null = null;
        if (initialValue !== undefined && initialValue !== null) {
            if (isValidCondition(initialValue)) {
                // Canonicalize a bare-rule root to a group so the builder UI is
                // uniform (semantically identical: all [x] === x).
                this.root = isConditionGroup(initialValue)
                    ? initialValue
                    : { all: [initialValue] };
            } else {
                invalidInitialJson = safeStringify(initialValue);
            }
        }

        this.createAdvancedSection(editorEl, invalidInitialJson);
        this.renderBuilder();
    }

    /**
     * Parse and validate the current editor state.
     * Unapplied JSON edits take precedence and are validated here so invalid
     * JSON blocks the save instead of being dropped silently.
     */
    getResult(): ConditionEditorResult {
        if (this.jsonDirty) {
            const text = this.jsonTextArea.value.trim();
            if (text.length === 0) {
                return { ok: true, conditions: undefined };
            }
            let parsed: unknown;
            try {
                parsed = JSON.parse(text);
            } catch {
                this.setJsonError(t('conditions_invalid_json'));
                return { ok: false, error: t('conditions_invalid_json') };
            }
            if (!isValidCondition(parsed)) {
                this.setJsonError(t('conditions_invalid_structure'));
                return { ok: false, error: t('conditions_invalid_structure') };
            }
            return { ok: true, conditions: parsed };
        }
        // The builder can hold transiently incomplete rules (e.g. a property
        // rule whose key has not been typed yet). Never save those silently.
        if (this.root !== undefined && !isValidCondition(this.root)) {
            return { ok: false, error: t('conditions_incomplete') };
        }
        return { ok: true, conditions: this.root };
    }

    // ---------------------------------------------------------------- state

    /** Replace the tree, sync the JSON view and optionally re-render. */
    private updateRoot(next: ButtonCondition | undefined, rerender: boolean): void {
        this.root = next;
        this.syncJsonFromBuilder();
        if (rerender) {
            this.renderBuilder();
        }
    }

    private syncJsonFromBuilder(): void {
        if (this.jsonDirty) {
            return;
        }
        this.jsonTextArea.value =
            this.root === undefined ? '' : JSON.stringify(this.root, null, 2);
        this.clearJsonError();
    }

    // ------------------------------------------------------------- builder

    private renderBuilder(): void {
        this.builderEl.empty();
        if (this.root === undefined) {
            this.renderEmptyState();
            return;
        }
        this.renderNode(this.builderEl, this.root, []);
    }

    private renderEmptyState(): void {
        const emptyEl = this.builderEl.createDiv('ocap-condition-empty');
        emptyEl.createSpan({
            cls: 'ocap-condition-empty-hint',
            text: t('conditions_empty_hint'),
        });
        const addButton = emptyEl.createEl('button', {
            cls: 'ocap-condition-add',
            text: t('conditions_add_condition'),
        });
        addButton.type = 'button';
        addButton.addEventListener('click', () => {
            this.updateRoot({ all: [createDefaultRule(DEFAULT_RULE_KIND)] }, true);
        });
    }

    private renderNode(parent: HTMLElement, node: ButtonCondition, path: ConditionPath): void {
        if (isConditionGroup(node)) {
            this.renderGroup(parent, node, path);
        } else {
            this.renderRule(parent, node, path);
        }
    }

    private renderGroup(
        parent: HTMLElement,
        node: ButtonCondition,
        path: ConditionPath
    ): void {
        if (!isConditionGroup(node)) {
            return;
        }
        const kind = getConditionKind(node) as ConditionGroupKind;
        const groupEl = parent.createDiv('ocap-condition-group');
        const headerEl = groupEl.createDiv('ocap-condition-group-header');

        // Group kind selector (ALL / ANY / NOT).
        const kindSelect = headerEl.createEl('select', {
            cls: 'dropdown ocap-condition-group-kind',
        });
        for (const groupKind of GROUP_KINDS) {
            const option = kindSelect.createEl('option', {
                text: t(GROUP_KIND_LABEL_KEYS[groupKind]),
            });
            option.value = groupKind;
        }
        kindSelect.value = kind;
        kindSelect.addEventListener('change', () => {
            const nextKind = kindSelect.value as ConditionGroupKind;
            this.updateRoot(setGroupKindAtPath(this.root!, path, nextKind), true);
        });

        const actionsEl = headerEl.createDiv('ocap-condition-group-actions');
        // A `not` group always holds exactly one child; children are added to
        // all/any groups only.
        if (kind !== 'not') {
            this.createIconButton(actionsEl, 'plus', t('conditions_add_rule'), () => {
                this.updateRoot(
                    addChildAtPath(this.root!, path, createDefaultRule(DEFAULT_RULE_KIND)),
                    true
                );
            }).addClass('ocap-condition-add-rule');

            const depthAllowsGroup = path.length + 2 < MAX_CONDITION_DEPTH;
            const addGroupButton = this.createIconButton(
                actionsEl,
                'folder-plus',
                depthAllowsGroup
                    ? t('conditions_add_group')
                    : t('conditions_max_depth'),
                () => {
                    this.updateRoot(
                        addChildAtPath(this.root!, path, {
                            all: [createDefaultRule(DEFAULT_RULE_KIND)],
                        }),
                        true
                    );
                }
            );
            addGroupButton.addClass('ocap-condition-add-group');
            if (!depthAllowsGroup) {
                addGroupButton.disabled = true;
            }
        }
        this.createIconButton(actionsEl, 'trash-2', t('conditions_remove'), () => {
            this.updateRoot(removeNodeAtPath(this.root!, path), true);
        });

        const childrenEl = groupEl.createDiv('ocap-condition-group-children');
        const children = getGroupChildren(node);
        children.forEach((child, index) => {
            this.renderNode(childrenEl, child, [...path, index]);
        });
        if (children.length === 0) {
            childrenEl.createDiv({
                cls: 'ocap-condition-empty-group-hint',
                text: t('conditions_empty_group_hint'),
            });
        }
    }

    private renderRule(
        parent: HTMLElement,
        rule: ConditionRule,
        path: ConditionPath
    ): void {
        const ruleEl = parent.createDiv('ocap-condition-rule');

        const kindSelect = ruleEl.createEl('select', {
            cls: 'dropdown ocap-condition-rule-kind',
        });
        for (const ruleKind of RULE_KINDS) {
            const option = kindSelect.createEl('option', {
                text: t(RULE_KIND_LABEL_KEYS[ruleKind]),
            });
            option.value = ruleKind;
        }
        kindSelect.value = rule.rule;
        kindSelect.addEventListener('change', () => {
            const nextKind = kindSelect.value as ConditionRuleKind;
            this.updateRoot(
                replaceNodeAtPath(
                    this.root!,
                    path,
                    convertRuleKind(this.currentRuleAt(path, rule), nextKind)
                ),
                true
            );
        });

        this.renderRuleControls(ruleEl, rule, path);

        this.createIconButton(ruleEl, 'trash-2', t('conditions_remove'), () => {
            this.updateRoot(removeNodeAtPath(this.root!, path), true);
        });
    }

    /**
     * Current rule node at a path. Text inputs update the tree without a
     * re-render, so sibling controls of the same row must never spread the
     * rule object captured at render time — they read the live node instead.
     */
    private currentRuleAt(path: ConditionPath, fallback: ConditionRule): ConditionRule {
        const node = this.root === undefined ? undefined : getNodeAtPath(this.root, path);
        return node !== undefined && !isConditionGroup(node) ? node : fallback;
    }

    /** Per-rule-kind operator/value controls. */
    private renderRuleControls(
        ruleEl: HTMLElement,
        rule: ConditionRule,
        path: ConditionPath
    ): void {
        const patchRule = (patch: Record<string, unknown>, rerender: boolean) => {
            const current = this.currentRuleAt(path, rule);
            this.updateRoot(
                replaceNodeAtPath(this.root!, path, {
                    ...current,
                    ...patch,
                }),
                rerender
            );
        };

        switch (rule.rule) {
            case 'viewType': {
                const input = this.createValueInput(ruleEl, rule.value, 'markdown', (value) => {
                    patchRule({ value }, false);
                });
                input.setAttribute('list', this.datalistId);
                // "View type" was read as "node type" in a manual test — the
                // examples have to be on screen, not only in the datalist.
                this.createRuleHint(ruleEl, t('conditions_view_type_hint'));
                break;
            }
            case 'fileName': {
                this.createOpSelect(
                    ruleEl,
                    ['equals', 'startsWith', 'contains', 'endsWith'],
                    rule.op,
                    (op) => {
                        patchRule({ op }, false);
                    }
                );
                this.createValueInput(
                    ruleEl,
                    rule.value,
                    t('conditions_file_name_placeholder'),
                    (value) => {
                        patchRule({ value }, false);
                    }
                );
                this.createRuleHint(ruleEl, t('conditions_file_name_hint'));
                break;
            }
            case 'path': {
                this.createOpSelect(ruleEl, ['equals', 'startsWith', 'contains'], rule.op, (op) => {
                    patchRule({ op }, false);
                });
                this.createValueInput(
                    ruleEl,
                    rule.value,
                    t('conditions_path_placeholder'),
                    (value) => {
                        patchRule({ value }, false);
                    }
                );
                break;
            }
            case 'folder': {
                this.createOpSelect(ruleEl, ['equals', 'startsWith'], rule.op, (op) => {
                    patchRule({ op }, false);
                });
                this.createValueInput(
                    ruleEl,
                    rule.value,
                    t('conditions_folder_placeholder'),
                    (value) => {
                        patchRule({ value }, false);
                    }
                );
                break;
            }
            case 'extension': {
                this.createValueInput(ruleEl, rule.value, 'md', (value) => {
                    patchRule({ value }, false);
                });
                break;
            }
            case 'property': {
                this.createValueInput(
                    ruleEl,
                    rule.key,
                    t('conditions_property_key_placeholder'),
                    (key) => {
                        patchRule({ key }, false);
                    }
                ).addClass('ocap-condition-property-key');
                // exists <-> equals toggles the value input, so re-render.
                this.createOpSelect(ruleEl, ['exists', 'equals'], rule.op, (op) => {
                    const current = this.currentRuleAt(path, rule);
                    const currentKey = current.rule === 'property' ? current.key : rule.key;
                    const currentValue =
                        current.rule === 'property' && typeof current.value === 'string'
                            ? current.value
                            : '';
                    const next: ConditionRule =
                        op === 'exists'
                            ? { rule: 'property', key: currentKey, op: 'exists' }
                            : {
                                  rule: 'property',
                                  key: currentKey,
                                  op: 'equals',
                                  value: currentValue,
                              };
                    this.updateRoot(replaceNodeAtPath(this.root!, path, next), true);
                });
                if (rule.op === 'equals') {
                    this.createValueInput(
                        ruleEl,
                        rule.value === undefined ? '' : String(rule.value),
                        t('conditions_value_placeholder'),
                        (value) => {
                            patchRule({ value }, false);
                        }
                    );
                }
                break;
            }
            case 'tag': {
                this.createValueInput(
                    ruleEl,
                    rule.value,
                    t('conditions_tag_placeholder'),
                    (value) => {
                        patchRule({ value }, false);
                    }
                );
                break;
            }
        }
    }

    // ------------------------------------------------------------ controls

    private createOpSelect<Op extends string>(
        parent: HTMLElement,
        ops: readonly Op[],
        current: Op,
        onChange: (op: Op) => void
    ): HTMLSelectElement {
        const select = parent.createEl('select', {
            cls: 'dropdown ocap-condition-op',
        });
        for (const op of ops) {
            const option = select.createEl('option', {
                text: t(OP_LABEL_KEYS[op] ?? op),
            });
            option.value = op;
        }
        select.value = current;
        select.addEventListener('change', () => {
            onChange(select.value as Op);
        });
        return select;
    }

    private createValueInput(
        parent: HTMLElement,
        value: string,
        placeholder: string,
        onChange: (value: string) => void
    ): HTMLInputElement {
        const input = parent.createEl('input', {
            cls: 'ocap-condition-value',
            type: 'text',
        });
        input.placeholder = placeholder;
        input.value = value;
        input.addEventListener('input', () => {
            onChange(input.value);
        });
        return input;
    }

    /**
     * One-line explanation under a rule row. Rules whose field name is not
     * self-explanatory carry one; it wraps onto its own line so it never
     * squeezes the controls in a narrow modal.
     */
    private createRuleHint(parent: HTMLElement, text: string): HTMLElement {
        return parent.createDiv({ cls: 'ocap-condition-rule-hint', text });
    }

    private createIconButton(
        parent: HTMLElement,
        icon: string,
        label: string,
        onClick: () => void
    ): HTMLButtonElement {
        const button = parent.createEl('button', {
            cls: 'clickable-icon ocap-condition-icon-button',
        });
        button.type = 'button';
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
        setIcon(button, icon);
        button.addEventListener('click', onClick);
        return button;
    }

    private createViewTypeDatalist(parent: HTMLElement): void {
        const datalist = parent.createEl('datalist');
        datalist.id = this.datalistId;
        for (const suggestion of VIEW_TYPE_SUGGESTIONS) {
            datalist.createEl('option').value = suggestion;
        }
    }

    // ------------------------------------------------------------ advanced

    private createAdvancedSection(
        parent: HTMLElement,
        invalidInitialJson: string | null
    ): void {
        const details = parent.createEl('details', {
            cls: 'ocap-condition-advanced',
        });
        details.createEl('summary', { text: t('conditions_advanced_json') });

        this.jsonTextArea = details.createEl('textarea', {
            cls: 'ocap-conditions-textarea',
        });
        this.jsonTextArea.rows = 5;
        this.jsonTextArea.placeholder = '{"rule":"viewType","value":"markdown"}';
        this.jsonTextArea.addEventListener('input', () => {
            this.jsonDirty = true;
            this.clearJsonError();
        });

        const actions = details.createDiv('ocap-condition-advanced-actions');
        const applyButton = actions.createEl('button', {
            text: t('conditions_apply_json'),
        });
        applyButton.type = 'button';
        applyButton.addEventListener('click', () => {
            this.applyJson();
        });

        if (invalidInitialJson !== null) {
            // Surface structurally invalid stored data (fail-open at runtime)
            // for correction instead of dropping it silently.
            details.open = true;
            this.jsonTextArea.value = invalidInitialJson;
            this.jsonDirty = true;
            this.setJsonError(t('conditions_invalid_structure'));
        } else {
            this.syncJsonFromBuilder();
        }
    }

    /** Validate the JSON textarea and load it into the builder. */
    private applyJson(): void {
        const text = this.jsonTextArea.value.trim();
        if (text.length === 0) {
            this.jsonDirty = false;
            this.updateRoot(undefined, true);
            return;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            this.setJsonError(t('conditions_invalid_json'));
            return;
        }
        if (!isValidCondition(parsed)) {
            this.setJsonError(t('conditions_invalid_structure'));
            return;
        }
        this.jsonDirty = false;
        const canonical: ButtonCondition = isConditionGroup(parsed)
            ? parsed
            : { all: [parsed] };
        // Guard against hand-written trees deeper than the builder can nest.
        if (conditionDepth(canonical) >= MAX_CONDITION_DEPTH) {
            this.setJsonError(t('conditions_invalid_structure'));
            this.jsonDirty = true;
            return;
        }
        this.updateRoot(canonical, true);
    }

    private setJsonError(message: string): void {
        this.jsonTextArea.classList.add('input-error');
        this.jsonTextArea.setAttribute('title', message);
    }

    private clearJsonError(): void {
        this.jsonTextArea.classList.remove('input-error');
        this.jsonTextArea.removeAttribute('title');
    }
}

/** JSON.stringify that never throws (cyclic/broken settings data). */
function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2) ?? '';
    } catch {
        return '';
    }
}
