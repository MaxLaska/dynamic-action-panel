import React from 'react';
import { Menu, MenuItem, setIcon } from 'obsidian';
import type { CategoryConfig, CategoryVariant } from '@/types';
import {
    describeConditionForName,
    findVariant,
    getCategoryVariants,
    triggeredVariants,
    type VariantResolution,
} from '@/utils/categoryVariants';
import { isValidCondition } from '@/context/conditions';
import { useVariantOperations } from '@/hooks/useVariantOperations';
import { t, tWithParams } from '@/utils/i18n';

interface VariantSelectorProps {
    category: CategoryConfig;
    /** Variant currently being edited (normalized, never a deleted one). */
    selectedVariantId: string | null;
    /** Previously edited variant of this category, for the A/B flip. */
    previousVariantId: string | null;
    /** Runtime resolution for the current Obsidian context. */
    runtime: VariantResolution;
    onSelect: (variantId: string) => void;
}

/** Short human-readable trigger summary of a variant. */
function triggerSummary(variant: CategoryVariant): string {
    if (variant.fallback === true) {
        return t('variant_trigger_fallback');
    }
    const trigger = variant.trigger;
    if (trigger === undefined || trigger === null) {
        return t('variant_trigger_missing');
    }
    if (!isValidCondition(trigger)) {
        return t('variant_trigger_invalid');
    }
    if ('all' in trigger && trigger.all.length === 0) {
        return t('variant_trigger_always');
    }
    return describeConditionForName(trigger) ?? t('variant_trigger_complex');
}

/**
 * Variant selector of a dynamic grid category, shown above the grid in the
 * management modes:
 *
 *   Editing: [ Source v ]  [swap]  [duplicate] [new] [menu]
 *   Trigger: type = Source   ·   Active now: Topic
 *
 * The selected variant IS what the grid below shows, what a drag operates on
 * and where a newly created tool lands. The dropdown scales to many variants;
 * the swap control flips between the last two edited variants of this
 * category (pure UI state). The second line separates the two concepts that
 * must never be confused: the variant being EDITED and the variant the
 * current Obsidian context would resolve to at RUNTIME.
 */
export const VariantSelector: React.FC<VariantSelectorProps> = ({
    category,
    selectedVariantId,
    previousVariantId,
    runtime,
    onSelect,
}) => {
    const variants = getCategoryVariants(category);
    const { createVariant, editVariant, duplicateVariant, moveVariant, deleteVariant } =
        useVariantOperations();

    const selected =
        selectedVariantId !== null ? findVariant(category, selectedVariantId) : null;
    const previous =
        previousVariantId !== null ? findVariant(category, previousVariantId) : null;

    const openVariantMenu = (event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (!selected) return;
        const ordered = triggeredVariants(category);
        const index = ordered.findIndex((variant) => variant.id === selected.id);
        const isFallback = selected.fallback === true;
        const menu = new Menu();
        menu.addItem((item: MenuItem) =>
            item
                .setTitle(t('variant_menu_edit'))
                .setIcon('pencil')
                .onClick(() => editVariant(category.id, selected.id))
        );
        menu.addItem((item: MenuItem) =>
            item
                .setTitle(t('variant_menu_duplicate'))
                .setIcon('copy')
                .onClick(() =>
                    duplicateVariant(category.id, selected.id, (copyId) => onSelect(copyId))
                )
        );
        menu.addItem((item: MenuItem) =>
            item
                .setTitle(t('variant_menu_move_up'))
                .setIcon('arrow-up')
                .setDisabled(isFallback || index <= 0)
                .onClick(() => moveVariant(category.id, selected.id, -1))
        );
        menu.addItem((item: MenuItem) =>
            item
                .setTitle(t('variant_menu_move_down'))
                .setIcon('arrow-down')
                .setDisabled(isFallback || index === -1 || index >= ordered.length - 1)
                .onClick(() => moveVariant(category.id, selected.id, 1))
        );
        menu.addItem((item: MenuItem) =>
            item
                .setTitle(t('variant_menu_delete'))
                .setIcon('trash')
                .onClick(() =>
                    deleteVariant(category.id, selected.id, () => {
                        const remaining = getCategoryVariants(category).filter(
                            (variant) => variant.id !== selected.id
                        );
                        if (remaining[0]) onSelect(remaining[0].id);
                    })
                )
        );
        menu.showAtMouseEvent(event.nativeEvent);
    };

    const runtimeLabel =
        runtime.variant === null
            ? t('variant_active_none')
            : runtime.reason === 'fallback'
              ? tWithParams('variant_active_fallback', { name: runtime.variant.name })
              : runtime.variant.name;

    const selectedBroken =
        selected !== null &&
        selected.fallback !== true &&
        (selected.trigger === undefined ||
            selected.trigger === null ||
            !isValidCondition(selected.trigger));

    return (
        <div className="ocap-variant-bar">
            <div className="ocap-variant-editing-row">
                <span className="ocap-variant-editing-label">{t('variant_editing')}</span>
                {variants.length === 0 ? (
                    <span className="ocap-variant-empty">{t('variant_none_yet')}</span>
                ) : (
                    <select
                        className="dropdown ocap-variant-select"
                        aria-label={t('variant_editing')}
                        value={selected?.id ?? ''}
                        onChange={(event) => onSelect(event.target.value)}
                    >
                        {variants.map((variant) => (
                            <option key={variant.id} value={variant.id}>
                                {variant.fallback === true
                                    ? tWithParams('variant_option_fallback', {
                                          name: variant.name,
                                      })
                                    : variant.name}
                            </option>
                        ))}
                    </select>
                )}
                {previous && (
                    <button
                        type="button"
                        className="ocap-variant-action ocap-variant-swap"
                        title={tWithParams('variant_swap_tooltip', { name: previous.name })}
                        aria-label={tWithParams('variant_swap_tooltip', {
                            name: previous.name,
                        })}
                        onClick={() => onSelect(previous.id)}
                    >
                        <span
                            className="ocap-variant-action-icon"
                            ref={(el) => el && setIcon(el, 'arrow-left-right')}
                        />
                        <span className="ocap-variant-swap-label">{previous.name}</span>
                    </button>
                )}
                <span className="ocap-variant-spacer" />
                {selected && (
                    <button
                        type="button"
                        className="ocap-variant-action"
                        title={t('variant_duplicate_tooltip')}
                        aria-label={t('variant_duplicate_tooltip')}
                        onClick={() =>
                            duplicateVariant(category.id, selected.id, (copyId) =>
                                onSelect(copyId)
                            )
                        }
                    >
                        <span
                            className="ocap-variant-action-icon"
                            ref={(el) => el && setIcon(el, 'copy')}
                        />
                    </button>
                )}
                <button
                    type="button"
                    className="ocap-variant-action"
                    title={t('variant_new_tooltip')}
                    aria-label={t('variant_new_tooltip')}
                    onClick={() =>
                        createVariant(category.id, (variantId) => onSelect(variantId))
                    }
                >
                    <span
                        className="ocap-variant-action-icon"
                        ref={(el) => el && setIcon(el, 'plus')}
                    />
                </button>
                {selected && (
                    <button
                        type="button"
                        className="ocap-variant-action"
                        title={t('variant_menu_tooltip')}
                        aria-label={t('variant_menu_tooltip')}
                        onClick={openVariantMenu}
                        onContextMenu={openVariantMenu}
                    >
                        <span
                            className="ocap-variant-action-icon"
                            ref={(el) => el && setIcon(el, 'more-vertical')}
                        />
                    </button>
                )}
            </div>
            <div className="ocap-variant-status-row">
                {selected && (
                    <span
                        className={
                            selectedBroken
                                ? 'ocap-variant-trigger ocap-variant-trigger--broken'
                                : 'ocap-variant-trigger'
                        }
                        title={t('variant_trigger_row_tooltip')}
                    >
                        {t('variant_trigger_prefix')} {triggerSummary(selected)}
                    </span>
                )}
                <span
                    className="ocap-variant-active"
                    title={t('variant_active_row_tooltip')}
                >
                    {t('variant_active_prefix')}{' '}
                    <span
                        className={
                            runtime.variant
                                ? 'ocap-variant-active-name'
                                : 'ocap-variant-active-name ocap-variant-active-name--none'
                        }
                    >
                        {runtimeLabel}
                    </span>
                </span>
            </div>
        </div>
    );
};
