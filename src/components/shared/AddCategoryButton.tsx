import React from 'react';
import { Menu, MenuItem } from 'obsidian';
import { IconButton } from './IconButton';
import { usePluginContext } from '@/contexts/PluginContext';
import { addTemplateLibraryMenuItems } from '@/utils/categoryMenuUtils';
import { t } from '@/utils/i18n';

interface AddCategoryButtonProps {
    onClick: () => void;
    className?: string;
    ariaLabel?: string;
}

/**
 * AddCategoryButton
 *
 * Shared add-category button control.
 *
 * A left click creates a category, as it always did. A right click offers the
 * other way a category can come into being — importing a portable template —
 * which is why the entries sit exactly here and not in a new toolbar icon: an
 * empty panel has no category menu to reach them from. That is also why the
 * whole template group is repeated here rather than just the import: on an
 * empty panel this menu is the ONLY way to reach the library folder, which is
 * exactly the state someone restoring from a backup is in.
 */
export const AddCategoryButton: React.FC<AddCategoryButtonProps> = ({
    onClick,
    className = 'add-category-btn',
    ariaLabel,
}) => {
    const { plugin, app } = usePluginContext();

    const handleContextMenu = React.useCallback(
        (event: React.MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const menu = new Menu();
            menu.addItem((item: MenuItem) => {
                item.setTitle(t('add_category') || 'Add category')
                    .setIcon('plus')
                    .onClick(onClick);
            });
            addTemplateLibraryMenuItems(menu, app, plugin);
            menu.showAtMouseEvent(event.nativeEvent);
        },
        [app, plugin, onClick]
    );

    return (
        <div className="buttons-panel-category add-category" onContextMenu={handleContextMenu}>
            <IconButton
                icon="plus"
                onClick={onClick}
                className={className}
                ariaLabel={ariaLabel || t('add_category') || 'Add category'}
            />
        </div>
    );
};
