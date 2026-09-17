import React from 'react';
import type { CategoryConfig } from '@/types';
import { useConfigContext } from '@/contexts/ConfigContext';
import { ButtonDragProvider } from '@/contexts/ButtonDragContext';
import { useOCAPContext } from '@/hooks/useOCAPContext';
import {
    projectCategoriesForContext,
    type VariantSelectionMap,
} from '@/context/panelProjection';
import { OCAPVisibilityProvider } from '@/contexts/OCAPVisibilityContext';
import {
    CategoryVariantProvider,
    selectedVariantOf,
    type VariantSelectionEntry,
    type VariantSelectionState,
} from '@/contexts/CategoryVariantContext';
import { filterCategoryButtonsDeep, isDynamicCategory } from '@/utils/categoryVariants';
import { isGridCategory } from '@/utils/categoryGrid';
import { TabsModeContent } from '@/components/buttons-panel/TabsModeContent';
import { ListModeContent } from '@/components/buttons-panel/ListModeContent';
import { FolderModeContent } from '@/components/buttons-panel/FolderModeContent';

/** Marks the Obsidian view-content in list view, which the scrollbar styling relies on instead of CSS :has */
const VIEW_CONTENT_LIST_CLASS = 'buttons-panel-view-list';

interface PanelContentProps {
    categories: CategoryConfig[];
    /** Search query from the top navigation bar, used to filter buttons locally */
    searchQuery?: string;
}

/**
 * PanelContent
 * Single entry point for the panel content area:
 * - switches between TabsModeContent, ListModeContent and FolderModeContent based on panelConfig.panelViewType;
 * - every sub-view groups the buttons by category;
 * - when searchQuery is given, the filtering happens here.
 */
export const PanelContent: React.FC<PanelContentProps> = ({
    categories,
    searchQuery,
}) => {
    const { panelConfig } = useConfigContext();
    const viewType = panelConfig.panelViewType ?? 'list';
    const displayStyle = panelConfig.displayStyle ?? 'icon_top';
    const enableAnimation = panelConfig.enableAnimation ?? false;
    const interactionMode = panelConfig.interactionMode ?? 'edit';
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

                // A grid category's tools can live in any of its variants, so
                // the search filters every variant instead of `buttons` alone.
                if (isGridCategory(category)) {
                    const filtered = filterCategoryButtonsDeep(category, matches);
                    const hasMatch =
                        filtered.buttons.length > 0 ||
                        (filtered.variants ?? []).some(
                            (variant) => variant.buttons.length > 0
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
     * Management modes: which variant of each dynamic category the user is
     * editing, plus the previously edited one (for the quick A/B flip).
     * Locked mode ignores this entirely — there the context decides. Pure UI
     * state, never persisted.
     */
    const [variantSelection, setVariantSelection] = React.useState<
        Record<string, VariantSelectionEntry>
    >({});

    // "Previous" for the A/B flip is what was actually ON SCREEN before the
    // pick — which may have been an implicit (runtime-derived) selection, so
    // it comes from the normalized state, not from the raw picks.
    const normalizedSelectionRef = React.useRef<VariantSelectionState>({});

    const selectVariant = React.useCallback((categoryId: string, variantId: string) => {
        const onScreen = normalizedSelectionRef.current[categoryId] ?? null;
        setVariantSelection((prev) => {
            const entry = prev[categoryId];
            if (onScreen?.current === variantId) {
                // Re-selecting what is already shown: make it explicit but
                // keep the existing flip target.
                if (entry?.current === variantId) {
                    return prev;
                }
                return {
                    ...prev,
                    [categoryId]: { current: variantId, previous: onScreen.previous },
                };
            }
            return {
                ...prev,
                [categoryId]: {
                    current: variantId,
                    previous: onScreen?.current ?? entry?.current ?? null,
                },
            };
        });
    }, []);

    // A selection pointing at a deleted variant must never survive: normalize
    // it against the categories that actually exist. Without an explicit pick
    // the variant active in the CURRENT context is preselected, so switching
    // into a management mode never silently changes what the grid shows.
    const normalizedSelection = React.useMemo<VariantSelectionState>(() => {
        const next: Record<string, VariantSelectionEntry> = {};
        for (const category of searchFilteredCategories) {
            if (!isDynamicCategory(category)) continue;
            const entry = selectedVariantOf(category, variantSelection, ocapContext);
            if (entry) {
                next[category.id] = entry;
            }
        }
        return next;
    }, [searchFilteredCategories, variantSelection, ocapContext]);
    normalizedSelectionRef.current = normalizedSelection;

    /** Flat map (categoryId -> variantId) for the projection and DnD. */
    const selectedVariantIds = React.useMemo<VariantSelectionMap>(() => {
        const next: Record<string, string> = {};
        for (const [categoryId, entry] of Object.entries(normalizedSelection)) {
            next[categoryId] = entry.current;
        }
        return next;
    }, [normalizedSelection]);

    // Central context projection: in locked mode categories/buttons hidden by
    // their conditions are filtered out (a category also disappears when no
    // visible button remains); in edit mode everything stays rendered
    // and manageable, context-hidden elements are marked instead (see
    // OCAPVisibilityProvider below). Identities are preserved when nothing is
    // filtered so memoized subtrees stay stable.
    const projection = React.useMemo(
        () =>
            projectCategoriesForContext(
                searchFilteredCategories,
                ocapContext,
                interactionMode,
                { selectedVariants: selectedVariantIds }
            ),
        [searchFilteredCategories, ocapContext, interactionMode, selectedVariantIds]
    );
    const filteredCategories = projection.categories;

    // One management mode: edit carries drag AND editing. Dragging is still
    // suppressed while a search filters the list, because the visible order is
    // then not the stored one and a drop would write back a filtered order.
    const dragReorderEnabled = normalizedQuery.length === 0 && enableEditMode;

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

    // Folder view always renders icon_top without changing the stored setting.
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
            <CategoryVariantProvider
                gridViews={projection.gridViews}
                selection={normalizedSelection}
                selectVariant={selectVariant}
                manageable={interactionMode !== 'locked'}
            >
            <ButtonDragProvider
                categories={filteredCategories}
                gridViews={projection.gridViews}
                variantSelection={selectedVariantIds}
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
            </CategoryVariantProvider>
            </OCAPVisibilityProvider>
        </div>
    );
};
