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

/** Which grid the drop landed on, as only the renderer can know. */
export interface SlotDropTarget {
    /**
     * The variant on screen, for a dynamic category.
     *
     * Passed explicitly because the right answer differs by mode: in a
     * management mode it is the variant being edited, in locked mode the one
     * the workspace context resolved to. Omitted for a static grid.
     */
    variantId?: string | null;
    /**
     * The drop landed on a cell that already held a tool, i.e. it REPLACES.
     *
     * A replace is silent: aiming a file at a tool the user can see is already
     * the deliberate act, and the tool changing under the pointer is all the
     * feedback it needs. Only a drop onto an empty cell is announced.
     */
    replacing?: boolean;
}

/**
 * useSlotFileDrop
 *
 * Dropping something from Obsidian onto a grid slot creates the tool the
 * gesture obviously means, in exactly that slot — the first step of editing ON
 * the grid instead of in a form. A vault file becomes an Open file (or Run
 * script) tool; an annotation dragged out of a reader becomes an Open file tool
 * pointed at the exact place inside the document.
 *
 * It works in LOCKED mode too, and that is deliberate: locked only protects the
 * LAYOUT, and filing a PDF onto a slot is work, not layout. What stays
 * edit-only is everything that rearranges what is already there — move, swap,
 * reorder, resize, the `+`. A drop brings something IN.
 *
 * A drop on an OCCUPIED slot replaces it, silently: no confirmation and no
 * notice. Aiming a file at a particular tool is already the deliberate act; a
 * dialog on top of it would only be a second one, and the tool changing under
 * the pointer is all the feedback a replace needs.
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
        (
            category: CategoryConfig,
            slot: number,
            dataTransfer: DataTransfer | null,
            target: SlotDropTarget = {}
        ) => {
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
            // The variant the DROP landed on. The grid knows it exactly — in a
            // management mode it is the one being edited, in locked mode the
            // one the context resolved to — so it says so rather than letting
            // this hook guess. Guessing was wrong in locked mode: there is no
            // editing selection there, and falling back to "the first variant"
            // would file the tool into a grid nobody was looking at.
            const variantId = isDynamicCategory(stored)
                ? (target.variantId ?? selection[stored.id]?.current ?? null)
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
                slot,
                // A file dropped on a cell means THIS cell, occupied or not.
                // The drop is the deliberate act, so it replaces without
                // asking; the displaced tool is collected by the ordinary rule.
                { replaceOccupied: true }
            );
            if (!next) {
                new Notice(t('variant_grid_full'));
                return;
            }
            void (async () => {
                // Only announce the new tool if it was actually committed. A
                // configuration from a newer build refuses the write, and the
                // funnel has already explained that.
                if ((await commitToolState(plugin, next)) && target.replacing !== true) {
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
