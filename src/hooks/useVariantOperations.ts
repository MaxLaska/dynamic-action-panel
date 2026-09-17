import { useCallback } from 'react';
import { Notice } from 'obsidian';
import { usePluginContext } from '@/contexts/PluginContext';
import { VariantDeleteModal, VariantModal } from '@/components/modal/VariantModal';
import {
    addVariant,
    duplicateVariant,
    findFallbackVariant,
    findVariant,
    getCategoryVariants,
    moveVariant,
    removeVariant,
    updateVariant,
} from '@/utils/categoryVariants';
import { commitStoredCategory, findStoredCategory } from '@/utils/categoryStore';
import { freshId } from '@/utils/id';
import type { CategoryConfig } from '@/types';
import { t, tWithParams } from '@/utils/i18n';

/**
 * Create / edit / duplicate / reorder / delete the variants of a dynamic grid
 * category, and turn a static grid category into a dynamic one.
 *
 * Every operation resolves the STORED category by id before mutating: the
 * category object a renderer holds may be a projection copy (locked mode,
 * search), and writing into that would silently do nothing.
 */
export function useVariantOperations() {
    const { plugin, app } = usePluginContext();

    const replaceCategory = useCallback(
        (categoryId: string, update: (category: CategoryConfig) => CategoryConfig) => {
            const stored = findStoredCategory(plugin, categoryId);
            if (!stored) {
                new Notice(t('category_not_found'));
                return null;
            }
            const next = update(stored);
            void commitStoredCategory(plugin, next);
            return next;
        },
        [plugin]
    );

    const storedCategory = useCallback(
        (categoryId: string) => findStoredCategory(plugin, categoryId),
        [plugin]
    );

    /** New empty variant. The duplicate flow is the "start from" path. */
    const createVariant = useCallback(
        (categoryId: string, onCreated?: (variantId: string) => void) => {
            const category = storedCategory(categoryId);
            if (!category) return;
            new VariantModal(app, {
                title: t('variant_create_title'),
                fallbackTaken: findFallbackVariant(category) !== null,
                onSubmit: ({ name, trigger, fallback }) => {
                    const variantId = freshId('var');
                    replaceCategory(categoryId, (stored) =>
                        addVariant(stored, { id: variantId, name, trigger, fallback })
                    );
                    onCreated?.(variantId);
                },
            }).open();
        },
        [app, replaceCategory, storedCategory]
    );

    /** Rename + edit trigger / fallback flag. */
    const editVariant = useCallback(
        (categoryId: string, variantId: string) => {
            const category = storedCategory(categoryId);
            const variant = category ? findVariant(category, variantId) : null;
            if (!category || !variant) {
                new Notice(t('category_not_found'));
                return;
            }
            const fallback = findFallbackVariant(category);
            new VariantModal(app, {
                title: t('variant_edit_title'),
                name: variant.name,
                trigger: variant.trigger,
                fallback: variant.fallback === true,
                fallbackTaken: fallback !== null && fallback.id !== variantId,
                onSubmit: ({ name, trigger, fallback: isFallback }) => {
                    replaceCategory(categoryId, (stored) =>
                        updateVariant(stored, variantId, {
                            name,
                            trigger,
                            fallback: isFallback,
                        })
                    );
                },
            }).open();
        },
        [app, replaceCategory, storedCategory]
    );

    /**
     * The core workflow: copy a complete variant (grid, actions, appearance),
     * give it a new name and trigger, select it, edit the few differing slots.
     */
    const duplicateVariantOp = useCallback(
        (
            categoryId: string,
            sourceVariantId: string,
            onDuplicated?: (variantId: string) => void
        ) => {
            const category = storedCategory(categoryId);
            const source = category ? findVariant(category, sourceVariantId) : null;
            if (!category || !source) {
                return;
            }
            new VariantModal(app, {
                title: t('variant_duplicate_title'),
                name: tWithParams('variant_copy_suffix', { name: source.name }),
                trigger: source.trigger,
                fallbackTaken: findFallbackVariant(category) !== null,
                onSubmit: ({ name, trigger, fallback }) => {
                    const copyId = freshId('var');
                    replaceCategory(categoryId, (stored) =>
                        duplicateVariant(
                            stored,
                            sourceVariantId,
                            { id: copyId, name, trigger, fallback },
                            (index) => freshId(`btn${index}`)
                        )
                    );
                    onDuplicated?.(copyId);
                },
            }).open();
        },
        [app, replaceCategory, storedCategory]
    );

    const moveVariantOp = useCallback(
        (categoryId: string, variantId: string, direction: -1 | 1) => {
            replaceCategory(categoryId, (stored) =>
                moveVariant(stored, variantId, direction)
            );
        },
        [replaceCategory]
    );

    const deleteVariant = useCallback(
        (categoryId: string, variantId: string, onDeleted?: () => void) => {
            const category = storedCategory(categoryId);
            const variant = category ? findVariant(category, variantId) : null;
            if (!category || !variant) {
                return;
            }
            if (getCategoryVariants(category).length <= 1) {
                // A dynamic category with zero variants would be an empty shell;
                // deleting the whole category (or its tools) is the explicit way.
                new Notice(t('variant_delete_last'));
                return;
            }
            new VariantDeleteModal(app, {
                variantName: variant.name,
                buttonNames: variant.buttons.map((button) => button.name),
                onConfirm: () => {
                    replaceCategory(categoryId, (stored) =>
                        removeVariant(stored, variantId)
                    );
                    new Notice(t('variant_deleted'));
                    onDeleted?.();
                },
            }).open();
        },
        [app, replaceCategory, storedCategory]
    );

    return {
        createVariant,
        editVariant,
        duplicateVariant: duplicateVariantOp,
        moveVariant: moveVariantOp,
        deleteVariant,
    };
}
