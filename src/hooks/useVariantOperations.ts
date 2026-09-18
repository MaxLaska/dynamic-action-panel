import { useCallback } from 'react';
import { Notice } from 'obsidian';
import { usePluginContext } from '@/contexts/PluginContext';
import { VariantDeleteModal, VariantModal } from '@/components/modal/VariantModal';
import {
    findFallbackVariant,
    findVariant,
    getCategoryVariants,
    moveVariant,
    updateVariant,
} from '@/utils/categoryVariants';
import {
    addVariantToCategory,
    duplicateVariantInState,
    removeVariantFromState,
} from '@/domain/categoryOps';
import {
    commitStoredCategory,
    commitToolState,
    findStoredCategory,
    toolStateOf,
} from '@/utils/categoryStore';
import { freshId } from '@/utils/id';
import type { StoredCategory } from '@/types/settings';
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
        async (
            categoryId: string,
            update: (category: StoredCategory) => StoredCategory
        ): Promise<StoredCategory | null> => {
            const stored = findStoredCategory(plugin, categoryId);
            if (!stored) {
                new Notice(t('category_not_found'));
                return null;
            }
            const next = update(stored);
            // Returning `next` unconditionally told every caller the change had
            // landed — `createVariant` then selected a variant that does not
            // exist. The commit is awaited here so the answer is the truth.
            return commitStoredCategory(plugin, next).then((committed) =>
                committed ? next : null
            );
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
                    void replaceCategory(categoryId, (stored) =>
                        addVariantToCategory(stored, { id: variantId, name, trigger, fallback })
                    ).then((created) => {
                        // Selecting a variant that was never created would
                        // leave the editor pointing at nothing.
                        if (created) onCreated?.(variantId);
                    });
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
                    void replaceCategory(categoryId, (stored) =>
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
                    // A duplicate copies the TOOLS as well (new definitions,
                    // new ids — decided in F2): the copy is fully independent.
                    void commitToolState(
                        plugin,
                        duplicateVariantInState(
                            toolStateOf(plugin),
                            categoryId,
                            sourceVariantId,
                            { id: copyId, name, trigger, fallback },
                            (index) => freshId(`btn${index}`)
                        )
                    ).then((committed) => {
                        // Same reason as createVariant: do not select a copy
                        // that does not exist.
                        if (committed) onDuplicated?.(copyId);
                    });
                },
            }).open();
        },
        [app, plugin, storedCategory]
    );

    const moveVariantOp = useCallback(
        (categoryId: string, variantId: string, direction: -1 | 1) => {
            void replaceCategory(categoryId, (stored) =>
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
                buttonNames: (variant.placements ?? []).map(
                    (placement) =>
                        plugin.settings.tools[placement.toolId]?.name ?? placement.toolId
                ),
                onConfirm: () => {
                    // Deleting the variant also garbage-collects its tools
                    // (unless referenced elsewhere or kept via `library`).
                    void (async () => {
                        const done = await commitToolState(
                            plugin,
                            removeVariantFromState(toolStateOf(plugin), categoryId, variantId)
                        );
                        // Saying "variant deleted" after a refused write would
                        // contradict the notice the funnel just raised.
                        if (!done) return;
                        new Notice(t('variant_deleted'));
                        onDeleted?.();
                    })();
                },
            }).open();
        },
        [app, plugin, storedCategory]
    );

    return {
        createVariant,
        editVariant,
        duplicateVariant: duplicateVariantOp,
        moveVariant: moveVariantOp,
        deleteVariant,
    };
}
