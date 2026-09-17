import React from 'react';
import { setIcon, Menu } from 'obsidian';
import { t } from '@/utils/i18n';
import type { InteractionMode } from '@/types';
import type { PanelViewType } from '@/utils/panelViewType';

interface NavIconButtonProps {
    icon: string;
    label: string;
    className?: string;
    isActive?: boolean;
    /** Current state of a toggle button, exposed as `data-state`. */
    state?: string;
    onClick: () => void;
}

/**
 * A single icon button in the panel navigation bar, without a dropdown menu.
 * - Purely presentational: icon, active styling and a click handler
 * - Never touches the plugin or the config objects directly
 */
function NavIconButton({
    icon,
    label,
    className = '',
    isActive,
    state,
    onClick,
}: NavIconButtonProps) {
    const buttonRef = React.useRef<HTMLDivElement | null>(null);

    React.useEffect(() => {
        if (buttonRef.current) {
            setIcon(buttonRef.current, icon);
        }
    }, [icon]);

    const classes = [
        'clickable-icon',
        'nav-action-button',
        className,
        isActive ? 'is-active' : '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div
            ref={buttonRef}
            className={classes}
            aria-label={label}
            data-state={state}
            onClick={onClick}
        />
    );
}

// ---------------------------------------------------------------------------
// Dropdown menu button
// ---------------------------------------------------------------------------

interface MenuOption {
    icon: string;
    title: string;
    checked: boolean;
    onClick: () => void;
}

interface DropdownButtonProps {
    icon: string;
    label: string;
    className?: string;
    options: MenuOption[];
}

/**
 * Icon button with a dropdown menu.
 * Clicking it opens a native Obsidian Menu below the button:
 * - every option shows its icon on the left and a checkmark on the right when it is selected;
 * - after a selection the button icon switches to the icon of the chosen option.
 */
function DropdownButton({
    icon,
    label,
    className = '',
    options,
}: DropdownButtonProps) {
    const buttonRef = React.useRef<HTMLDivElement | null>(null);

    React.useEffect(() => {
        if (buttonRef.current) {
            setIcon(buttonRef.current, icon);
        }
    }, [icon]);

    const handleClick = (e: React.MouseEvent) => {
        const menu = new Menu();
        for (const opt of options) {
            menu.addItem((item) => {
                item
                    .setTitle(opt.title)
                    .setIcon(opt.icon)
                    .setChecked(opt.checked ? true : false)
                    .onClick(opt.onClick);
            });
        }
        menu.showAtMouseEvent(e.nativeEvent);
    };

    return (
        <div
            ref={buttonRef}
            className={`clickable-icon nav-action-button ${className}`.trim()}
            aria-label={label}
            onClick={handleClick}
        />
    );
}

// ---------------------------------------------------------------------------
// NavigationBar component
// ---------------------------------------------------------------------------

export interface NavigationBarProps {
    /** Current view mode: list, tabs or folder */
    panelViewType: PanelViewType;
    /** Button layout: icon_left or icon_top */
    displayStyle: 'icon_left' | 'icon_top';
    /** Current interaction mode: 'locked' or 'edit'. */
    interactionMode: InteractionMode;
    /** Whether the navigation bar is shown (decided by the caller) */
    showTopNavBar?: boolean;
    /** Called with the selected view type */
    onChangeView: (viewType: PanelViewType) => void;
    /** Called with the selected display style */
    onChangeStyle: (style: 'icon_left' | 'icon_top') => void;
    /** Called when the interaction mode changes */
    onChangeInteractionMode: (mode: InteractionMode) => void;
    /** Called to open the settings */
    onOpenSettings: () => void;
    /** Called when the search query changes (in-memory filtering only, nothing is persisted) */
    onSearchChange?: (query: string) => void;
}

/**
 * Top navigation bar of the buttons panel (a pure UI component).
 *
 * - Never reads plugin or panelConfig directly
 * - Receives the current state and the callbacks through props
 * - The caller decides whether it renders at all (showTopNavBar)
 * - The view and style buttons open their options in a native Obsidian Menu
 */
export const NavigationBar: React.FC<NavigationBarProps> = ({
    panelViewType,
    displayStyle,
    interactionMode,
    showTopNavBar = true,
    onChangeView,
    onChangeStyle,
    onChangeInteractionMode,
    onOpenSettings,
    onSearchChange,
}) => {
    const [isSearchOpen, setIsSearchOpen] = React.useState(false);
    const [searchText, setSearchText] = React.useState('');
    const searchInputRef = React.useRef<HTMLInputElement | null>(null);

    // Rules of Hooks: all hooks must run before any early return; otherwise
    // toggling showTopNavBar changes the hook count and crashes the component.
    if (!showTopNavBar) {
        return null;
    }

    const handleSearchButtonClick = () => {
        setIsSearchOpen((prev) => {
            const next = !prev;

            if (!next) {
                // Clear the query when the search closes.
                setSearchText('');
                onSearchChange?.('');
            } else {
                // Focus the input when the search opens.
                window.setTimeout(() => {
                    searchInputRef.current?.focus();
                }, 0);
            }

            return next;
        });
    };

    const handleSearchInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        setSearchText(value);
        onSearchChange?.(value);
    };

    const handleClearSearch = () => {
        setSearchText('');
        onSearchChange?.('');
        searchInputRef.current?.focus();
    };

    // ---- Button icons, derived from the current mode ----
    const viewIconMap: Record<PanelViewType, string> = {
        list: 'list',
        tabs: 'tabs',
        folder: 'folder',
    };
    const viewLabelMap: Record<PanelViewType, string> = {
        list: t('list_view'),
        tabs: t('tabs_view'),
        folder: t('folder_view'),
    };
    const viewIcon = viewIconMap[panelViewType] ?? 'list';
    const styleIcon = displayStyle === 'icon_top' ? 'layout-panel-top' : 'layout-panel-left';

    // Lock toggle. The icon shows the CURRENT STATE, never the action a click
    // would perform: a closed lock means "the panel is locked right now".
    // Clicking flips to the other state; the tooltip names the state first and
    // the click action second.
    const isLocked = interactionMode === 'locked';
    const interactionIcon = isLocked ? 'lock' : 'lock-open';
    const interactionTooltip = isLocked
        ? t('interaction_locked_tooltip')
        : t('interaction_edit_tooltip');

    // ---- View mode dropdown options ----
    const viewTypes: PanelViewType[] = ['list', 'tabs', 'folder'];
    const viewOptions: MenuOption[] = viewTypes.map((vt) => ({
        icon: viewIconMap[vt],
        title: viewLabelMap[vt],
        checked: panelViewType === vt,
        onClick: () => onChangeView(vt),
    }));

    // ---- Display style dropdown options ----
    // Folder view offers only the icon_top style.
    const isFolder = panelViewType === 'folder';
    const styleOptions: MenuOption[] = isFolder
        ? [
              {
                  icon: 'layout-panel-top',
                  title: t('icon_top'),
                  checked: true,
                  onClick: () => {}, // Folder view is locked to icon_top, so switching is a no-op.
              },
          ]
        : [
              {
                  icon: 'layout-panel-left',
                  title: t('icon_left'),
                  checked: displayStyle === 'icon_left',
                  onClick: () => onChangeStyle('icon_left'),
              },
              {
                  icon: 'layout-panel-top',
                  title: t('icon_top'),
                  checked: displayStyle === 'icon_top',
                  onClick: () => onChangeStyle('icon_top'),
              },
          ];

    // ---- Tooltips of the current options ----
    const viewLabel = viewLabelMap[panelViewType] ?? t('list_view');
    const styleLabel = isFolder ? t('icon_top') : displayStyle === 'icon_left' ? t('icon_left') : t('icon_top');

    // ---- Placeholder of the search input ----
    const searchPlaceholder = t('search_placeholder') || 'Type to search…';

    return (
        <>
            <div className="nav-buttons-container">
                <NavIconButton
                    icon="search"
                    label={t('search') || 'Search'}
                    className="search-btn"
                    isActive={isSearchOpen}
                    onClick={handleSearchButtonClick}
                />
                <DropdownButton
                    icon={viewIcon}
                    label={viewLabel}
                    className="view-btn"
                    options={viewOptions}
                />
                <DropdownButton
                    icon={styleIcon}
                    label={styleLabel}
                    className="style-btn"
                    options={styleOptions}
                />
                <NavIconButton
                    icon={interactionIcon}
                    label={interactionTooltip}
                    state={isLocked ? 'locked' : 'edit'}
                    className="edit-mode-btn"
                    isActive={!isLocked}
                    onClick={() => onChangeInteractionMode(isLocked ? 'edit' : 'locked')}
                />
                <NavIconButton
                    icon="settings"
                    label={t('buttons_panel_options')}
                    className="settings-btn"
                    onClick={onOpenSettings}
                />
            </div>
            {isSearchOpen && (
                <div className="search-input-container">
                    <input
                        ref={searchInputRef}
                        type="search"
                        spellCheck={false}
                        enterKeyHint="search"
                        placeholder={searchPlaceholder}
                        value={searchText}
                        onChange={handleSearchInputChange}
                    />
                    {searchText && (
                        <div
                            className="search-input-clear-button"
                            aria-label={t('clear_search') || 'Clear search'}
                            onClick={handleClearSearch}
                        />
                    )}
                </div>
            )}
        </>
    );
};

