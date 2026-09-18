import React from 'react';
import type { ButtonConfig, CategoryConfig } from '@/types';
import type { ButtonsPanelPlugin } from '@/types/plugin';
import type { App } from 'obsidian';
import { setTooltip } from 'obsidian';
import { safeSetSVG } from '@/utils/dom';
import { useButtonMenu } from '@/hooks';
import {
    useContextHiddenButtonIds,
    useInteractionMode,
} from '@/contexts/PanelVisibilityContext';
import { hasConditions } from '@/context/conditions';
import {
    ContextStatusBadge,
    type ContextStatus,
} from '@/components/shared/ContextStatusBadge';

interface SimpleButtonProps {
    button: ButtonConfig;
    category: CategoryConfig;
    displayStyle?: 'icon_left' | 'icon_top';
    enableAnimation?: boolean;
    enableEditMode?: boolean;
    plugin: ButtonsPanelPlugin;
    app: App;
    onClick?: () => void;
    className?: string;
    /**
     * Marker override. Grid categories pass 'none': a grid ignores per-button
     * conditions (contextuality lives at the variant level, shown by the
     * variant selector and the category marker), so per-button badges would
     * only mislead. Flow categories leave this undefined and keep the
     * condition-based marker.
     */
    contextStatus?: ContextStatus | 'none';
}

/**
 * SimpleButton
 * Presentational component for a single panel button.
 * It renders the icon, the label and the edit-mode affordances.
 */
export const SimpleButton: React.FC<SimpleButtonProps> = ({
    button,
    category,
    displayStyle = 'icon_top',
    enableAnimation,
    enableEditMode = false,
    plugin,
    app,
    onClick,
    className,
    contextStatus,
}) => {
    const iconRef = React.useRef<HTMLSpanElement>(null);
    const buttonRef = React.useRef<HTMLButtonElement>(null);

    // Set the SVG icon once the DOM node is mounted.
    React.useEffect(() => {
        if (iconRef.current && button.icon) {
            // SVG markup.
            if (button.icon.trim().startsWith('<svg')) {
                safeSetSVG(iconRef.current, button.icon);
            } else {
                // Plain text icon.
                iconRef.current.textContent = button.icon;
            }
        }
    }, [button.icon]);

    // Context menu handler.
    const handleContextMenu = useButtonMenu(button, category);

    // In sort/edit mode a button hidden by its conditions stays
    // rendered and manageable but gets a visual marker class.
    const contextHiddenIds = useContextHiddenButtonIds();
    const isContextHidden = contextHiddenIds.has(button.id);

    // Persistent vs. contextual marker. Management modes state both
    // explicitly so the configuration is transparent; locked mode is the
    // consumption surface and only hints at contextual buttons, so a panel
    // of static tools stays visually quiet.
    // Grid categories pass 'none' (no per-button marker at all — the grid
    // ignores per-button conditions); flow categories follow the button's own
    // conditions, exactly as before.
    const interactionMode = useInteractionMode();
    const isManagementMode = interactionMode !== 'locked';
    const status: ContextStatus | 'none' =
        contextStatus ?? (hasConditions(button) ? 'contextual' : 'persistent');
    const isContextual = status === 'contextual';
    const showStatusBadge = status !== 'none' && (isManagementMode || isContextual);

    // Hover text: what the tool cannot fit on its face. A tool may carry its own
    // (a dropped annotation records its source and page there); otherwise it is
    // the full name, which is what a cell truncates.
    const hoverText = button.tooltip?.trim() || button.name;
    React.useEffect(() => {
        const el = buttonRef.current;
        if (el && hoverText && plugin.settings.panelConfig.showButtonTooltip) {
            setTooltip(el, hoverText);
        }
        return () => {
            if (el) {
                // Remove the bound tooltip when the setting is turned off or the button unmounts.
                setTooltip(el, '');
            }
        };
    }, [hoverText, plugin.settings.panelConfig.showButtonTooltip]);

    // Bind the context menu.
    React.useEffect(() => {
        if (!enableEditMode || !buttonRef.current) return;

        buttonRef.current.addEventListener('contextmenu', handleContextMenu);
        return () => {
            if (buttonRef.current) {
                buttonRef.current.removeEventListener('contextmenu', handleContextMenu);
            }
        };
    }, [enableEditMode, handleContextMenu]);

    // Memoize the class names so they are not recomputed on every render.
    const classNames = React.useMemo(() => {
        const layoutClass = displayStyle === 'icon_top' ? 'icon-top' : 'icon-left';
        const names = ['buttons-panel-simple-button', layoutClass];
        if (enableAnimation) {
            names.push('with-animation');
        }
        if (isContextHidden) {
            names.push('ocap-context-hidden');
        }
        if (className) {
            names.push(className);
        }
        return names.join(' ');
    }, [displayStyle, enableAnimation, isContextHidden, className]);

    return (
        <button
            ref={buttonRef}
            type="button"
            className={classNames}
            data-button-id={button.id}
            onClick={onClick}
        >
            {button.icon && (
                <span
                    ref={iconRef}
                    className="button-icon"
                />
            )}
            <span className="button-text">{button.name}</span>
            {showStatusBadge && (
                <ContextStatusBadge
                    status={status}
                    notMatching={isContextHidden}
                    subtle={!isManagementMode}
                />
            )}
        </button>
    );
};

