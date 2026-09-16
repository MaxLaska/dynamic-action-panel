import React from 'react';
import { Menu, MenuItem, setIcon } from 'obsidian';
import type { CategoryConfig } from '@/types';
import {
    BASE_LAYER_ID,
    getContextProfiles,
    isBaseLayer,
    type PaletteLayerId,
} from '@/utils/paletteLayers';
import { isValidCondition } from '@/context/conditions';
import { useContextProfileOperations } from '@/hooks/useContextProfileOperations';
import { t, tWithParams } from '@/utils/i18n';

interface PaletteLayerSelectorProps {
    category: CategoryConfig;
    selectedLayerId: PaletteLayerId;
    /** Profile that would be active in the current context, for the marker. */
    matchingProfileId: string | null;
    onSelect: (layerId: PaletteLayerId) => void;
}

/**
 * Layer selector of a grid palette, shown in the management modes:
 *
 *   [ Base / Pinned ] [ Type A ] [ Type B ] [ + Context ]
 *
 * The selected chip decides what the grid below shows, what a drag operates on
 * and where a newly created tool lands — there is no separate "pinned" or
 * "contextual" checkbox anywhere, the layer IS the answer.
 *
 * Chip order is priority order: the first profile whose condition matches wins
 * at runtime, and the context menu reorders them.
 */
export const PaletteLayerSelector: React.FC<PaletteLayerSelectorProps> = ({
    category,
    selectedLayerId,
    matchingProfileId,
    onSelect,
}) => {
    const profiles = getContextProfiles(category);
    const { createProfile, editProfile, duplicateProfile, moveProfile, deleteProfile } =
        useContextProfileOperations();

    const openProfileMenu = (event: React.MouseEvent, profileId: string, index: number) => {
        event.preventDefault();
        event.stopPropagation();
        const menu = new Menu();
        menu.addItem((item: MenuItem) =>
            item
                .setTitle(t('palette_context_menu_edit'))
                .setIcon('pencil')
                .onClick(() => editProfile(category.id, profileId))
        );
        menu.addItem((item: MenuItem) =>
            item
                .setTitle(t('palette_context_menu_duplicate'))
                .setIcon('copy')
                .onClick(() =>
                    duplicateProfile(category.id, profileId, (copyId) => onSelect(copyId))
                )
        );
        menu.addItem((item: MenuItem) =>
            item
                .setTitle(t('palette_context_menu_move_up'))
                .setIcon('arrow-up')
                .setDisabled(index === 0)
                .onClick(() => moveProfile(category.id, profileId, -1))
        );
        menu.addItem((item: MenuItem) =>
            item
                .setTitle(t('palette_context_menu_move_down'))
                .setIcon('arrow-down')
                .setDisabled(index === profiles.length - 1)
                .onClick(() => moveProfile(category.id, profileId, 1))
        );
        menu.addItem((item: MenuItem) =>
            item
                .setTitle(t('palette_context_menu_delete'))
                .setIcon('trash')
                .onClick(() =>
                    deleteProfile(category.id, profileId, () => onSelect(BASE_LAYER_ID))
                )
        );
        menu.showAtMouseEvent(event.nativeEvent);
    };

    const baseSelected = isBaseLayer(selectedLayerId);

    const chipClass = (selected: boolean, extra?: string) =>
        [
            'ocap-layer-chip',
            selected && 'ocap-layer-chip--selected',
            extra,
        ]
            .filter(Boolean)
            .join(' ');

    return (
        <div className="ocap-layer-selector" role="tablist" aria-label={t('palette_layers_label')}>
            <button
                type="button"
                role="tab"
                aria-selected={baseSelected}
                className={chipClass(baseSelected, 'ocap-layer-chip--base')}
                title={t('palette_layer_base_tooltip')}
                onClick={() => onSelect(BASE_LAYER_ID)}
            >
                <span className="ocap-layer-chip-icon" ref={(el) => el && setIcon(el, 'pin')} />
                <span className="ocap-layer-chip-label">{t('palette_layer_base')}</span>
            </button>

            {profiles.map((profile, index) => {
                const selected = profile.id === selectedLayerId;
                const matching = profile.id === matchingProfileId;
                const broken =
                    profile.conditions !== undefined &&
                    profile.conditions !== null &&
                    !isValidCondition(profile.conditions);
                const tooltip =
                    tWithParams('palette_layer_context_tooltip', {
                        name: profile.name,
                        index: index + 1,
                    }) +
                    (broken
                        ? ` ${t('palette_profiles_invalid_condition')}`
                        : matching
                          ? ` ${t('palette_layer_context_tooltip_matching')}`
                          : '');
                return (
                    <button
                        key={profile.id}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        className={chipClass(
                            selected,
                            [
                                'ocap-layer-chip--context',
                                matching && 'ocap-layer-chip--matching',
                                broken && 'ocap-layer-chip--broken',
                            ]
                                .filter(Boolean)
                                .join(' ')
                        )}
                        title={tooltip}
                        onClick={() => onSelect(profile.id)}
                        onContextMenu={(event) => openProfileMenu(event, profile.id, index)}
                    >
                        <span
                            className="ocap-layer-chip-icon"
                            ref={(el) => el && setIcon(el, broken ? 'alert-triangle' : 'filter')}
                        />
                        <span className="ocap-layer-chip-label">{profile.name}</span>
                        {selected && (
                            <span
                                className="ocap-layer-chip-menu"
                                role="button"
                                aria-label={t('palette_manage_context')}
                                title={t('palette_manage_context')}
                                ref={(el) => el && setIcon(el, 'more-vertical')}
                                onClick={(event) =>
                                    openProfileMenu(event, profile.id, index)
                                }
                            />
                        )}
                    </button>
                );
            })}

            <button
                type="button"
                className="ocap-layer-chip ocap-layer-chip--add"
                title={t('palette_add_context_tooltip')}
                aria-label={t('palette_add_context_tooltip')}
                onClick={() => createProfile(category.id, (profileId) => onSelect(profileId))}
            >
                <span className="ocap-layer-chip-icon" ref={(el) => el && setIcon(el, 'plus')} />
                <span className="ocap-layer-chip-label">{t('palette_add_context')}</span>
            </button>
        </div>
    );
};
