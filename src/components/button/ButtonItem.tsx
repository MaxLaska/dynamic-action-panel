import React from 'react';
import type { ButtonConfig, CategoryConfig } from '@/types';
import type { ButtonsPanelPlugin } from '@/types/plugin';
import type { App } from 'obsidian';
import { SimpleButton } from './Button';
import { useButtonClickHandler } from '@/hooks/useButtonClickHandler';
import { shallowEqualExcept } from '@/utils/shallowEqual';

interface ButtonItemProps {
    button: ButtonConfig;
    category: CategoryConfig;
    index: number;
    displayStyle: 'icon_left' | 'icon_top';
    enableAnimation: boolean;
    enableEditMode: boolean;
    plugin: ButtonsPanelPlugin;
    app: App;
}

/**
 * Memo comparison for ButtonItem.
 *
 * All props except `index` (unused in the render output) are compared by
 * identity. `button` and `category` must NOT be value-compared: the previous
 * comparator checked id/name/icon only, so a button whose actions or
 * execution config changed could keep rendering (and executing) stale data.
 * Value comparison cannot work here at all, because prev and next props may
 * reference the same object — which is why edits have to replace the
 * ButtonConfig object (see ButtonEditModal) instead of mutating it in place.
 */
export const areButtonItemPropsEqual = (
    prevProps: ButtonItemProps,
    nextProps: ButtonItemProps
): boolean => shallowEqualExcept(prevProps, nextProps, ['index']);

export const ButtonItem: React.FC<ButtonItemProps> = React.memo(
    ({
        button,
        category,
        displayStyle,
        enableAnimation,
        enableEditMode,
        plugin,
        app,
    }) => {
        const handleButtonClick = useButtonClickHandler(button);

        return (
            <SimpleButton
                button={button}
                category={category}
                displayStyle={displayStyle}
                enableAnimation={enableAnimation}
                enableEditMode={enableEditMode}
                plugin={plugin}
                app={app}
                onClick={handleButtonClick}
            />
        );
    },
    areButtonItemPropsEqual
);

ButtonItem.displayName = 'ButtonItem';
