import React from 'react';
import type { CategoryConfig } from '@/types';
import { useConfigContext } from '@/contexts/ConfigContext';
import { ButtonDragProvider } from '@/contexts/ButtonDragContext';
import { useOCAPContext } from '@/hooks/useOCAPContext';
import {
    collectContextHiddenButtonIds,
    filterCategoriesByContext,
} from '@/context/conditions';
import {
    EMPTY_HIDDEN_IDS,
    OCAPVisibilityProvider,
} from '@/contexts/OCAPVisibilityContext';
import { TabsModeContent } from '@/components/buttons-panel/TabsModeContent';
import { ListModeContent } from '@/components/buttons-panel/ListModeContent';
import { FolderModeContent } from '@/components/buttons-panel/FolderModeContent';

/** 列表视图时在 Obsidian view-content 上标记，供滚动条样式等使用（避免 CSS :has） */
const VIEW_CONTENT_LIST_CLASS = 'buttons-panel-view-list';

interface PanelContentProps {
    categories: CategoryConfig[];
    /** 顶部导航栏搜索关键字（用于本地过滤按钮） */
    searchQuery?: string;
}

/**
 * PanelContent
 * 统一的内容区域入口：
 * - 根据 panelConfig.panelViewType 在内部切换 TabsModeContent / ListModeContent；
 * - 两个子视图都按分类展示按钮；
 * - 如果传入 searchQuery，则在本组件内做一次本地过滤。
 */
export const PanelContent: React.FC<PanelContentProps> = ({
    categories,
    searchQuery,
}) => {
    const { panelConfig } = useConfigContext();
    const viewType = panelConfig.panelViewType ?? 'list';
    const displayStyle = panelConfig.displayStyle ?? 'icon_top';
    const enableAnimation = panelConfig.enableAnimation ?? false;
    const interactionMode = panelConfig.interactionMode ?? 'sort';
    const enableEditMode = interactionMode === 'edit';
    const tabsWrap = panelConfig.tabsWrap ?? false;
    const listAutoCollapse = panelConfig.listAutoCollapse ?? false;

    const normalizedQuery = searchQuery?.trim().toLowerCase() ?? '';

    const ocapContext = useOCAPContext();
    // Conditions hide buttons only in locked (normal usage) mode; in sort and
    // edit mode all buttons stay rendered and manageable, context-hidden ones
    // are visually marked instead (see OCAPVisibilityProvider below).
    const conditionsApply = interactionMode === 'locked';

    const searchFilteredCategories = React.useMemo(() => {
        const sorted = [...categories].sort((a, b) => a.order - b.order);
        if (normalizedQuery.length === 0) {
            return sorted;
        }

        return sorted
            .map((category) => {
                const nameMatched = category.name.toLowerCase().includes(normalizedQuery);

                const filteredButtons = category.buttons.filter((button) => {
                    const buttonName = button.name ?? '';
                    return buttonName.toLowerCase().includes(normalizedQuery);
                });

                if (!nameMatched && filteredButtons.length === 0) {
                    return null;
                }

                return {
                    ...category,
                    buttons: nameMatched ? category.buttons : filteredButtons,
                };
            })
            .filter((c): c is CategoryConfig => c !== null);
    }, [categories, normalizedQuery]);

    // Context-based visibility filter (locked mode only). Category identity is
    // preserved when nothing is filtered so memoized subtrees stay stable.
    const filteredCategories = React.useMemo(
        () =>
            conditionsApply
                ? filterCategoriesByContext(searchFilteredCategories, ocapContext)
                : searchFilteredCategories,
        [conditionsApply, searchFilteredCategories, ocapContext]
    );

    // In sort/edit mode context-hidden buttons stay visible but are marked.
    const contextHiddenButtonIds = React.useMemo(
        () =>
            conditionsApply
                ? EMPTY_HIDDEN_IDS
                : collectContextHiddenButtonIds(searchFilteredCategories, ocapContext),
        [conditionsApply, searchFilteredCategories, ocapContext]
    );

    const dragReorderEnabled = normalizedQuery.length === 0 && interactionMode === 'sort';

    const panelContentRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const viewContent = panelContentRef.current?.closest('.view-content.buttons-panel');
        if (!viewContent) {
            return;
        }
        viewContent.classList.toggle(VIEW_CONTENT_LIST_CLASS, viewType === 'list');
        return () => {
            viewContent.classList.remove(VIEW_CONTENT_LIST_CLASS);
        };
    }, [viewType]);

    // 文件夹视图强制 icon_top，但设置不变
    const effectiveDisplayStyle = viewType === 'folder' ? 'icon_top' : displayStyle;

    const panelContent =
        viewType === 'tabs' ? (
            <TabsModeContent
                categories={filteredCategories}
                displayStyle={displayStyle}
                enableAnimation={enableAnimation}
                enableEditMode={enableEditMode}
                tabsWrap={tabsWrap}
                isSearchActive={normalizedQuery.length > 0}
            />
        ) : viewType === 'folder' ? (
            <FolderModeContent
                categories={filteredCategories}
                displayStyle={effectiveDisplayStyle}
                enableAnimation={enableAnimation}
                enableEditMode={enableEditMode}
                isSearchActive={normalizedQuery.length > 0}
            />
        ) : (
            <ListModeContent
                categories={filteredCategories}
                displayStyle={displayStyle}
                enableAnimation={enableAnimation}
                enableEditMode={enableEditMode}
                autoCollapseOnMount={listAutoCollapse}
                isSearchActive={normalizedQuery.length > 0}
            />
        );

    return (
        <div ref={panelContentRef} className="buttons-panel-panel-content">
            <OCAPVisibilityProvider hiddenButtonIds={contextHiddenButtonIds}>
            <ButtonDragProvider
                categories={filteredCategories}
                enabled={dragReorderEnabled}
                displayStyle={effectiveDisplayStyle}
                enableAnimation={enableAnimation}
                categoryDragOverlayVariant={
                    viewType === 'tabs' ? 'tabs' : viewType === 'folder' ? 'folder' : 'list'
                }
                categoryDragLayout={
                    viewType === 'tabs'
                        ? tabsWrap
                            ? 'grid'
                            : 'horizontal'
                        : viewType === 'folder'
                          ? 'grid'
                          : 'vertical'
                }
                folderShowBtnCount={panelConfig.folderShowBtnCount ?? true}
            >
                {panelContent}
            </ButtonDragProvider>
            </OCAPVisibilityProvider>
        </div>
    );
};
