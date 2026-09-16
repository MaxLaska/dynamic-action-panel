import { useCallback } from 'react';
import { Notice } from 'obsidian';
import { usePluginContext } from '@/contexts/PluginContext';
import { useRefresh } from './useRefresh';
import {
    ContextProfileDeleteModal,
    ContextProfileModal,
} from '@/components/modal/ContextProfileModal';
import {
    addContextProfile,
    duplicateContextProfile,
    findContextProfile,
    moveContextProfile,
    removeContextProfile,
    updateContextProfile,
    type PaletteLayerId,
} from '@/utils/paletteLayers';
import { BASE_LAYER_ID } from '@/utils/paletteLayers';
import type { CategoryConfig } from '@/types';
import { t, tWithParams } from '@/utils/i18n';

/** Ids are timestamps + entropy, like every other id in this codebase. */
function newId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Create / edit / duplicate / reorder / delete the context profiles of a grid
 * palette.
 *
 * Every operation resolves the STORED category by id before mutating: the
 * category object a renderer holds may be a projection copy (locked mode,
 * search), and writing into that would silently do nothing.
 */
export function useContextProfileOperations() {
    const { plugin, app } = usePluginContext();
    const { refresh } = useRefresh();

    const replaceCategory = useCallback(
        (categoryId: string, update: (category: CategoryConfig) => CategoryConfig) => {
            const categories = plugin.settings.categories;
            const index = categories.findIndex((category) => category.id === categoryId);
            if (index === -1) {
                new Notice(t('category_not_found'));
                return null;
            }
            const next = update(categories[index]!);
            categories[index] = next;
            void plugin.saveSettings();
            refresh();
            return next;
        },
        [plugin, refresh]
    );

    const createProfile = useCallback(
        (categoryId: string, onCreated?: (profileId: string) => void) => {
            new ContextProfileModal(app, {
                title: t('palette_context_create_title'),
                onSubmit: (name, conditions) => {
                    const profileId = newId('ctx');
                    replaceCategory(categoryId, (category) =>
                        addContextProfile(category, { id: profileId, name, conditions })
                    );
                    onCreated?.(profileId);
                },
            }).open();
        },
        [app, replaceCategory]
    );

    const editProfile = useCallback(
        (categoryId: string, profileId: string) => {
            const category = plugin.settings.categories.find((c) => c.id === categoryId);
            const profile = category ? findContextProfile(category, profileId) : null;
            if (!profile) {
                new Notice(t('category_not_found'));
                return;
            }
            new ContextProfileModal(app, {
                title: t('palette_context_edit_title'),
                name: profile.name,
                conditions: profile.conditions,
                onSubmit: (name, conditions) => {
                    replaceCategory(categoryId, (stored) =>
                        updateContextProfile(stored, profileId, { name, conditions })
                    );
                },
            }).open();
        },
        [app, plugin, replaceCategory]
    );

    const duplicateProfile = useCallback(
        (categoryId: string, profileId: string, onDuplicated?: (id: string) => void) => {
            const category = plugin.settings.categories.find((c) => c.id === categoryId);
            const profile = category ? findContextProfile(category, profileId) : null;
            if (!profile) {
                return;
            }
            const copyId = newId('ctx');
            replaceCategory(categoryId, (stored) =>
                duplicateContextProfile(
                    stored,
                    profileId,
                    {
                        profileId: copyId,
                        buttonId: (index) => newId(`btn${index}`),
                    },
                    tWithParams('palette_context_copy_suffix', { name: profile.name })
                )
            );
            onDuplicated?.(copyId);
        },
        [plugin, replaceCategory]
    );

    const moveProfile = useCallback(
        (categoryId: string, profileId: string, direction: -1 | 1) => {
            replaceCategory(categoryId, (stored) =>
                moveContextProfile(stored, profileId, direction)
            );
        },
        [replaceCategory]
    );

    const deleteProfile = useCallback(
        (categoryId: string, profileId: string, onDeleted?: () => void) => {
            const category = plugin.settings.categories.find((c) => c.id === categoryId);
            const profile = category ? findContextProfile(category, profileId) : null;
            if (!profile) {
                return;
            }
            new ContextProfileDeleteModal(app, {
                profileName: profile.name,
                buttonNames: profile.buttons.map((button) => button.name),
                onConfirm: () => {
                    replaceCategory(categoryId, (stored) =>
                        removeContextProfile(stored, profileId)
                    );
                    new Notice(t('palette_context_deleted'));
                    onDeleted?.();
                },
            }).open();
        },
        [app, plugin, replaceCategory]
    );

    return {
        baseLayerId: BASE_LAYER_ID as PaletteLayerId,
        createProfile,
        editProfile,
        duplicateProfile,
        moveProfile,
        deleteProfile,
    };
}
