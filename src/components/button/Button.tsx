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
} from '@/contexts/OCAPVisibilityContext';
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
     * Palette grid: the layer a tool lives in decides its marker (base/pinned
     * vs. context profile), not a per-button condition. Flow categories leave
     * this undefined and keep the condition-based marker.
     */
    contextStatus?: ContextStatus;
    /**
     * Palette grid: a base/pinned tool shown while a context profile is being
     * edited. It stays visible for orientation but cannot be edited or moved
     * from here — the base layer owns it.
     */
    layerLocked?: boolean;
}

/**
 * SimpleButton
 * 最小版本的按钮展示组件，用于验证 React 渲染和样式拆分是否正常工作。
 * 后续会在此基础上逐步扩展为完整的 Button 组件。
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
    layerLocked = false,
}) => {
    const iconRef = React.useRef<HTMLSpanElement>(null);
    const buttonRef = React.useRef<HTMLButtonElement>(null);

    // 使用 useEffect 在 DOM 挂载后设置 SVG 图标
    React.useEffect(() => {
        if (iconRef.current && button.icon) {
            // 检查是否为 SVG 代码
            if (button.icon.trim().startsWith('<svg')) {
                safeSetSVG(iconRef.current, button.icon);
            } else {
                // 普通文本图标
                iconRef.current.textContent = button.icon;
            }
        }
    }, [button.icon]);

    // 使用 hook 获取右键菜单处理函数
    const handleContextMenu = useButtonMenu(button, category);

    // OCAP: in sort/edit mode a button hidden by its conditions stays
    // rendered and manageable but gets a visual marker class.
    const contextHiddenIds = useContextHiddenButtonIds();
    const isContextHidden = contextHiddenIds.has(button.id);

    // OCAP: persistent vs. contextual marker. Management modes state both
    // explicitly so the configuration is transparent; locked mode is the
    // consumption surface and only hints at contextual buttons, so a palette
    // of static tools stays visually quiet.
    // In a grid palette the marker follows the LAYER the tool lives in
    // (contextStatus prop); in a flow category it follows the button's own
    // conditions, exactly as before.
    const interactionMode = useInteractionMode();
    const isManagementMode = interactionMode !== 'locked';
    const status: ContextStatus =
        contextStatus ?? (hasConditions(button) ? 'contextual' : 'persistent');
    const isContextual = status === 'contextual';
    const showStatusBadge = isManagementMode || isContextual;

    // 悬浮显示完整按钮名称（Obsidian 原生 tooltip 样式）
    React.useEffect(() => {
        const el = buttonRef.current;
        if (el && button.name && plugin.settings.panelConfig.showButtonTooltip) {
            setTooltip(el, button.name);
        }
        return () => {
            if (el) {
                // 关闭开关或卸载时移除已绑定的 tooltip
                setTooltip(el, '');
            }
        };
    }, [button.name, plugin.settings.panelConfig.showButtonTooltip]);

    // 绑定右键菜单
    // A base tool shown inside a context-profile layer is deliberately inert:
    // it belongs to the base layer and is only managed there.
    React.useEffect(() => {
        if (!enableEditMode || layerLocked || !buttonRef.current) return;

        buttonRef.current.addEventListener('contextmenu', handleContextMenu);
        return () => {
            if (buttonRef.current) {
                buttonRef.current.removeEventListener('contextmenu', handleContextMenu);
            }
        };
    }, [enableEditMode, layerLocked, handleContextMenu]);

    // 使用 useMemo 缓存类名计算，避免每次渲染都重新计算
    const classNames = React.useMemo(() => {
        const layoutClass = displayStyle === 'icon_top' ? 'icon-top' : 'icon-left';
        const names = ['buttons-panel-simple-button', layoutClass];
        if (enableAnimation) {
            names.push('with-animation');
        }
        if (isContextHidden) {
            names.push('ocap-context-hidden');
        }
        if (layerLocked) {
            names.push('ocap-layer-locked');
        }
        if (className) {
            names.push(className);
        }
        return names.join(' ');
    }, [displayStyle, enableAnimation, isContextHidden, layerLocked, className]);

    return (
        <button
            ref={buttonRef}
            type="button"
            className={classNames}
            data-button-id={button.id}
            onClick={layerLocked ? undefined : onClick}
            disabled={layerLocked || undefined}
            aria-disabled={layerLocked || undefined}
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
                    locked={layerLocked}
                />
            )}
        </button>
    );
};

