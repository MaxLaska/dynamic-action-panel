import React from 'react';
import { Menu, MenuItem } from 'obsidian';
import { IconButton } from './IconButton';
import { usePluginContext } from '@/contexts/PluginContext';
import { pickAndImportTemplate } from '@/export/templateIo';
import { t } from '@/utils/i18n';

interface AddCategoryButtonProps {
    onClick: () => void;
    className?: string;
    ariaLabel?: string;
}

/**
 * AddCategoryButton
 *
 * 统一的"添加分类"按钮组件。
 *
 * A left click creates a category, as it always did. A right click offers the
 * other way a category can come into being — importing a portable template —
 * which is why the entry sits exactly here and not in a new toolbar icon: an
 * empty panel has no category menu to reach it from.
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
                item.setTitle(t('add_category') || '添加分类')
                    .setIcon('plus')
                    .onClick(onClick);
            });
            menu.addItem((item: MenuItem) => {
                item.setTitle(t('category_import_template'))
                    .setIcon('upload')
                    .onClick(() => pickAndImportTemplate(app, plugin));
            });
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
                ariaLabel={ariaLabel || t('add_category') || '添加分类'}
            />
        </div>
    );
};
