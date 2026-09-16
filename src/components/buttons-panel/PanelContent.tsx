import React from 'react';
import type { CategoryConfig } from '@/types';
import { useConfigContext } from '@/contexts/ConfigContext';
import { ButtonDragProvider } from '@/contexts/ButtonDragContext';
import { useOCAPContext } from '@/hooks/useOCAPContext';
import { projectCategoriesForContext } from '@/context/panelProjection';
import { OCAPVisibilityProvider } from '@/contexts/OCAPVisibilityContext';
import { PaletteLayerProvider, selectedLayerOf } from '@/contexts/PaletteLayerContext';
import { filterPaletteButtons, isPaletteCategory } from '@/utils/paletteLayers';
import type { PaletteLayerId, PaletteLayerSelection } from '@/utils/paletteLayers';
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

    const searchFilteredCategories = React.useMemo(() => {
        const sorted = [...categories].sort((a, b) => a.order - b.order);
        if (normalizedQuery.length === 0) {
            return sorted;
        }

        const matches = (button: { name?: string }) =>
            (button.name ?? '').toLowerCase().includes(normalizedQuery);

        return sorted
            .map((category) => {
                const nameMatched = category.name.toLowerCase().includes(normalizedQuery);
                if (nameMatched) {
                    return category;
                }

                // A palette's tools can live in any of its layers, so the
                // search filters every layer instead of `buttons` alone.
                if (isPaletteCategory(category)) {
                    const filtered = filterPaletteButtons(category, matches);
                    const hasMatch =
                        filtered.buttons.length > 0 ||
                        (filtered.contextProfiles ?? []).some(
                            (profile) => profile.buttons.length > 0
                        );
                    return hasMatch ? filtered : null;
                }

                const filteredButtons = category.buttons.filter(matches);
                if (filteredButtons.length === 0) {
                    return null;
                }
                return { ...category, buttons: filteredButtons };
            })
            .filter((c): c is CategoryConfig => c !== null);
    }, [categories, normalizedQuery]);

    /**
     * Management modes: which layer of each palette the user is editing.
     * Locked mode ignores this entirely — there the context decides.
     */
    const [layerSelection, setLayerSelection] = React.useState<
        Record<string, PaletteLayerId>
    >({});

    const selectLayer = React.useCallback((categoryId: string, layerId: PaletteLayerId) => {
        setLayerSelection((prev) =>
            prev[categoryId] === layerId ? prev : { ...prev, [categoryId]: layerId }
        );
    }, []);

    // A selection pointing at a deleted profile must never survive: normalize
    // it against the categories that actually exist.
    const normalizedSelection = React.useMemo<PaletteLayerSelection>(() => {
        const next: Record<string, PaletteLayerId> = {};
        for (const category of searchFilteredCategories) {
            if (!isPaletteCategory(category)) continue;
            next[category.id] = selectedLayerOf(category, layerSelection);
        }
        return next;
    }, [searchFilteredCategories, layerSelection]);

    // Central context projection: in locked mode categories/buttons hidden by
    // their conditions are filtered out (a category also disappears when no
    // visible button remains); in sort/edit mode everything stays rendered
    // and manageable, context-hidden elements are marked instead (see
    // OCAPVisibilityProvider below). Identities are preserved when nothing is
    // filtered so memoized subtrees stay stable.
    const projection = React.useMemo(
        () =>
            projectCategoriesForContext(
                searchFilteredCategories,
                ocapContext,
                interactionMode,
                { selectedLayers: normalizedSelection }
            ),
        [searchFilteredCategories, ocapContext, interactionMode, normalizedSelection]
    );
    const filteredCategories = projection.categories;

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
            <OCAPVisibilityProvider
                hiddenButtonIds={projection.hiddenButtonIds}
                hiddenCategoryIds={projection.hiddenCategoryIds}
                interactionMode={interactionMode}
            >
            <PaletteLayerProvider
                palettes={projection.palettes}
                selection={normalizedSelection}
                selectLayer={selectLayer}
                manageable={interactionMode !== 'locked'}
            >
            <ButtonDragProvider
                categories={filteredCategories}
                palettes={projection.palettes}
                layerSelection={normalizedSelection}
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
            </PaletteLayerProvider>
            </OCAPVisibilityProvider>
        </div>
    );
};
