import { useCallback, useMemo } from 'react';
import { Notice, getIcon } from 'obsidian';
import { usePluginContext } from '@/contexts/PluginContext';
import { useRefresh } from './useRefresh';
import { useCategoryVariants } from '@/contexts/CategoryVariantContext';
import { findStoredCategory, replaceStoredCategory } from '@/utils/categoryStore';
import { addButtonToGrid, isDynamicCategory } from '@/utils/categoryVariants';
import { createDefaultButtonConfig } from '@/utils/buttonFactory';
import { buildVaultFileButtonDraft } from '@/utils/vaultFileButton';
import {
    canAcceptVaultFileDrag,
    resolveDroppedVaultFiles,
} from '@/utils/obsidianFileDrag';
import { t } from '@/utils/i18n';
import type { ButtonConfig, CategoryConfig } from '@/types';

/**
 * useSlotFileDrop
 *
 * Dropping a vault file from Obsidian's file explorer onto an empty grid slot
 * creates the tool the gesture obviously means, in exactly that slot — the
 * first step of editing ON the grid instead of in a form.
 *
 * Everything the decision needs is already in the gesture: the file says what
 * the tool does, the slot says where it goes, and the variant selector says
 * which grid is being edited. Nothing is guessed from the runtime context.
 *
 * The pieces live apart on purpose: reading the drag is Obsidian-specific
 * (src/utils/obsidianFileDrag.ts), the file -> tool mapping is pure and tested
 * (src/utils/vaultFileButton.ts), and this hook only persists the result.
 */
export function useSlotFileDrop() {
    const { plugin, app } = usePluginContext();
    const { refresh } = useRefresh();
    const { selection } = useCategoryVariants();

    /** Readable during `dragover`, so the slot can light up before the drop. */
    const canAcceptFileDrag = useCallback(
        (dataTransfer: DataTransfer | null) => canAcceptVaultFileDrag(app, dataTransfer),
        [app]
    );

    const dropFileOnSlot = useCallback(
        (category: CategoryConfig, slot: number, dataTransfer: DataTransfer | null) => {
            // Only the first file: one slot is one tool, and silently filling
            // unrelated slots is not what dropping onto THIS cell asked for.
            const file = resolveDroppedVaultFiles(app, dataTransfer)[0];
            if (!file) {
                return;
            }

            const stored = findStoredCategory(plugin, category.id) ?? category;
            // Same target resolution as the `+`: the variant on screen.
            const variantId = isDynamicCategory(stored)
                ? (selection[stored.id]?.current ?? null)
                : null;

            const draft = buildVaultFileButtonDraft(file, {
                scriptFolderPath: plugin.settings.pathConfig?.scriptFolderPath,
            });

            const button: ButtonConfig = {
                ...createDefaultButtonConfig(),
                name: draft.name,
                // OCAP stores icons as SVG markup (the icon picker resolves
                // Obsidian icon ids the same way); an unknown id simply leaves
                // the tool without an icon instead of writing a broken one.
                icon: getIcon(draft.iconId)?.outerHTML ?? '',
                actions: [draft.action],
            };

            const next = addButtonToGrid(stored, variantId, button, slot);
            if (!next) {
                new Notice(t('variant_grid_full'));
                return;
            }
            replaceStoredCategory(plugin, next);
            void plugin.saveSettings().then(() => {
                refresh();
            });

            new Notice(
                draft.scriptFolderMismatch
                    ? t('script_outside_script_folder')
                    : t('button_create_success')
            );
        },
        [app, plugin, refresh, selection]
    );

    return useMemo(
        () => ({ canAcceptFileDrag, dropFileOnSlot }),
        [canAcceptFileDrag, dropFileOnSlot]
    );
}
