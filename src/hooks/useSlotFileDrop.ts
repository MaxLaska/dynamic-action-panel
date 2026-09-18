import { useCallback, useMemo } from 'react';
import { Notice, getIcon } from 'obsidian';
import { usePluginContext } from '@/contexts/PluginContext';
import { useCategoryVariants } from '@/contexts/CategoryVariantContext';
import { commitToolState, findStoredCategory, toolStateOf } from '@/utils/categoryStore';
import { isDynamicCategory } from '@/utils/categoryVariants';
import { createToolInCategory } from '@/domain/categoryOps';
import { createDefaultButtonConfig } from '@/utils/buttonFactory';
import { buildVaultFileButtonDraft } from '@/utils/vaultFileButton';
import { buildAnnotationButtonDraft } from '@/utils/annotationButton';
import {
    canAcceptVaultFileDrag,
    resolveDroppedAnnotation,
    resolveDroppedVaultFiles,
} from '@/utils/obsidianFileDrag';
import { t } from '@/utils/i18n';
import type { ButtonAction } from '@/types/action';
import type { ButtonConfig, CategoryConfig } from '@/types';

/** A tool the drop should create, plus what to tell the user about it. */
interface SlotDropDraft {
    name: string;
    /** Obsidian icon id, resolved to stored SVG markup below. */
    iconId: string;
    action: ButtonAction;
    noticeKey: string;
}

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
    const { selection } = useCategoryVariants();

    /** Readable during `dragover`, so the slot can light up before the drop. */
    const canAcceptFileDrag = useCallback(
        (dataTransfer: DataTransfer | null) => canAcceptVaultFileDrag(app, dataTransfer),
        [app]
    );

    /**
     * What this drop means, as one tool draft plus the message to show for it.
     *
     * An annotation is asked about FIRST: it is identified either by ZotFlow's
     * own MIME type or by a source-note embed whose note points back at the
     * annotated file — neither of which a file drag can produce. Anything it
     * does not claim keeps exactly its previous meaning.
     */
    const resolveDrop = useCallback(
        (dataTransfer: DataTransfer | null): SlotDropDraft | null => {
            const annotation = resolveDroppedAnnotation(app, dataTransfer);
            if (annotation) {
                const draft = buildAnnotationButtonDraft(annotation);
                return { ...draft, noticeKey: 'slot_annotation_created' };
            }

            // Only the first file: one slot is one tool, and silently filling
            // unrelated slots is not what dropping onto THIS cell asked for.
            const file = resolveDroppedVaultFiles(app, dataTransfer)[0];
            if (!file) {
                return null;
            }
            const draft = buildVaultFileButtonDraft(file, {
                scriptFolderPath: plugin.settings.pathConfig?.scriptFolderPath,
            });
            return {
                name: draft.name,
                iconId: draft.iconId,
                action: draft.action,
                noticeKey: draft.scriptFolderMismatch
                    ? 'script_outside_script_folder'
                    : 'button_create_success',
            };
        },
        [app, plugin]
    );

    const dropFileOnSlot = useCallback(
        (category: CategoryConfig, slot: number, dataTransfer: DataTransfer | null) => {
            // An annotation dragged out of a reader is asked about first: it is
            // identified by its own MIME type or by a source-note embed, neither
            // of which a file drag produces. Everything it does not claim keeps
            // its existing meaning.
            // What the gesture means, decided once: an annotation, a vault file,
            // or nothing. `draft` is the same shape either way, so everything
            // below — naming, icon, placement, persistence — stays one path.
            const draft = resolveDrop(dataTransfer);
            if (!draft) {
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
            void commitToolState(plugin, next);

            new Notice(t(draft.noticeKey));
        },
        [app, plugin, resolveDrop, selection]
    );

    return useMemo(
        () => ({ canAcceptFileDrag, dropFileOnSlot }),
        [canAcceptFileDrag, dropFileOnSlot]
    );
}
