import { useCallback, useMemo } from 'react';
import { Notice, getIcon } from 'obsidian';
import { usePluginContext } from '@/contexts/PluginContext';
import { useCategoryVariants } from '@/contexts/CategoryVariantContext';
import { commitToolState, findStoredCategory, toolStateOf } from '@/utils/categoryStore';
import { isDynamicCategory } from '@/utils/categoryVariants';
import { createToolInCategory } from '@/domain/categoryOps';
import { createDefaultButtonConfig } from '@/utils/buttonFactory';
import {
    canAcceptVaultFileDrag,
    isUnidentifiedAnnotationDrag,
    resolveSlotDropDraft,
} from '@/utils/obsidianFileDrag';
import { t } from '@/utils/i18n';
import type { ButtonConfig, CategoryConfig } from '@/types';

/**
 * useSlotFileDrop
 *
 * Dropping something from Obsidian onto an empty grid slot creates the tool the
 * gesture obviously means, in exactly that slot — the first step of editing ON
 * the grid instead of in a form. A vault file becomes an Open file (or Run
 * script) tool; an annotation dragged out of a reader becomes an Open file tool
 * pointed at the exact place inside the document.
 *
 * Everything the decision needs is already in the gesture: the payload says what
 * the tool does, the slot says where it goes, and the variant selector says
 * which grid is being edited. Nothing is guessed from the runtime context.
 *
 * The pieces live apart on purpose: reading the drag and deciding what it means
 * is Obsidian-specific but React-free (src/utils/obsidianFileDrag.ts), the
 * mappings are pure and tested (vaultFileButton.ts, annotationButton.ts), and
 * this hook only persists the result.
 */
export function useSlotFileDrop() {
    const { plugin, app } = usePluginContext();
    const { selection } = useCategoryVariants();

    /** Readable during `dragover`, so the slot can light up before the drop. */
    const canAcceptFileDrag = useCallback(
        (dataTransfer: DataTransfer | null) => canAcceptVaultFileDrag(app, dataTransfer),
        [app]
    );

    const dropFileOnSlot = useCallback(
        (category: CategoryConfig, slot: number, dataTransfer: DataTransfer | null) => {
            // What the gesture means, decided once: an annotation, a vault file,
            // or nothing. The draft is the same shape either way, so everything
            // below — naming, icon, placement, persistence — stays one path.
            const draft = resolveSlotDropDraft(app, dataTransfer, {
                scriptFolderPath: plugin.settings.pathConfig?.scriptFolderPath,
            });
            if (!draft) {
                // Most drops that mean nothing here should stay silent. But a
                // ZotFlow reader drag that could not be pinned to one annotation
                // did mean something, so saying nothing would look like a bug.
                if (isUnidentifiedAnnotationDrag(dataTransfer)) {
                    new Notice(t('annotation_not_identified'));
                }
                return;
            }

            const stored = findStoredCategory(plugin, category.id);
            if (!stored) {
                return;
            }
            // Same target resolution as the `+`: the variant on screen.
            const variantId = isDynamicCategory(stored)
                ? (selection[stored.id]?.current ?? null)
                : null;

            const button: ButtonConfig = {
                ...createDefaultButtonConfig(),
                name: draft.name,
                ...(draft.tooltip !== undefined ? { tooltip: draft.tooltip } : {}),
                // The plugin stores icons as SVG markup (the icon picker resolves
                // Obsidian icon ids the same way); an unknown id simply leaves
                // the tool without an icon instead of writing a broken one.
                icon: getIcon(draft.iconId)?.outerHTML ?? '',
                actions: [draft.action],
            };

            // One step: register the tool definition AND place it in exactly
            // this slot of exactly the edited variant (ad-hoc: no library
            // flag — removing the placement later removes the tool again).
            const next = createToolInCategory(
                toolStateOf(plugin),
                stored.id,
                variantId,
                button,
                slot
            );
            if (!next) {
                new Notice(t('variant_grid_full'));
                return;
            }
            void (async () => {
                // Only announce the new tool if it was actually committed. A
                // configuration from a newer build refuses the write, and the
                // funnel has already explained that.
                if (await commitToolState(plugin, next)) {
                    new Notice(t(draft.noticeKey));
                }
            })();
        },
        [app, plugin, selection]
    );

    return useMemo(
        () => ({ canAcceptFileDrag, dropFileOnSlot }),
        [canAcceptFileDrag, dropFileOnSlot]
    );
}
