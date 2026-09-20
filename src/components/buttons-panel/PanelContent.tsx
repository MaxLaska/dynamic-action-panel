import React from 'react';
import type { CategoryConfig } from '@/types';
import { useConfigContext } from '@/contexts/ConfigContext';
import { ButtonDragProvider } from '@/contexts/ButtonDragContext';
import { useWorkspaceContext } from '@/hooks/useWorkspaceContext';
import {
    projectCategoriesForContext,
    type VariantSelectionMap,
} from '@/context/panelProjection';
import { PanelVisibilityProvider } from '@/contexts/PanelVisibilityContext';
import {
    CategoryVariantProvider,
    selectedVariantOf,
    type VariantSelectionEntry,
    type VariantSelectionState,
} from '@/contexts/CategoryVariantContext';
import { filterCategoryButtonsDeep, isDynamicCategory } from '@/utils/categoryVariants';
import { isGridCategory } from '@/utils/categoryGrid';
import {
    GridCellSelectionProvider,
    type CellPaintColor,
} from '@/contexts/GridCellSelectionContext';
import { CellSelectionEscape } from '@/components/buttons-panel/CellSelectionEscape';
import { CellSelectionBackdrop } from '@/components/buttons-panel/CellSelectionBackdrop';
import { CellSelectionLayoutDragHold } from '@/components/buttons-panel/CellSelectionLayoutDragHold';
import { CellSelectionModifierCursor } from '@/components/buttons-panel/CellSelectionModifierCursor';
import {
    allowsLayoutEditing,
    SINGLE_INTERACTION_MODE,
} from '@/utils/interactionMode';
import {
    NO_CELL_SELECTION,
    applyCellGesture,
    applyCellSetGesture,
    clearSelectionOf,
    createGridInstanceCounter,
    gridContextKey,
    type CellSelectionGesture,
    type GridInstanceCounter,
    type GridCellSelectionState,
    type GridSelectionContextKey,
} from '@/utils/gridCellSelection';
import type { GridCellKey } from '@/types/settings';
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
    // ONE mode for everyone (SINGLE_INTERACTION_MODE): the stored
    // panelConfig.interactionMode is left untouched but no longer read, so the
    // switch can come back by restoring this one line.
    const interactionMode = SINGLE_INTERACTION_MODE;
    // What the modes differed in — whether the LAYOUT may change — is now
    // simply always allowed.
    const enableEditMode = allowsLayoutEditing(interactionMode);
    const tabsWrap = panelConfig.tabsWrap ?? false;
    const listAutoCollapse = panelConfig.listAutoCollapse ?? false;

    const normalizedQuery = searchQuery?.trim().toLowerCase() ?? '';

    const workspaceContext = useWorkspaceContext();

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
            const entry = selectedVariantOf(category, variantSelection, workspaceContext);
            if (entry) {
                next[category.id] = entry;
            }
        }
        return next;
    }, [searchFilteredCategories, variantSelection, workspaceContext]);
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
    // PanelVisibilityProvider below). Identities are preserved when nothing is
    // filtered so memoized subtrees stay stable.
    const projection = React.useMemo(
        () =>
            projectCategoriesForContext(
                searchFilteredCategories,
                workspaceContext,
                interactionMode,
                { selectedVariants: selectedVariantIds }
            ),
        [searchFilteredCategories, workspaceContext, interactionMode, selectedVariantIds]
    );
    const filteredCategories = projection.categories;

    // One management mode: edit carries drag AND editing. Dragging is still
    // suppressed while a search filters the list, because the visible order is
    // then not the stored one and a drop would write back a filtered order.
    const dragReorderEnabled = normalizedQuery.length === 0 && enableEditMode;

    const panelContentRef = React.useRef<HTMLDivElement>(null);

    // --- Cell selection ----------------------------------------------------
    // Ephemeral, never persisted, at most one grid at a time. It lives here for
    // the same reason the variant selection does: PanelContent survives every
    // commit (renderPanel re-renders the same component type), so a selection
    // outlives applying a color — which is the point, the user usually tries a
    // second one right after.
    const [cellSelection, setCellSelection] =
        React.useState<GridCellSelectionState>(NO_CELL_SELECTION);

    const selectCell = React.useCallback(
        (
            context: GridSelectionContextKey,
            cell: GridCellKey,
            gesture: CellSelectionGesture
        ) => {
            setCellSelection((prev) => applyCellGesture(prev, context, cell, gesture));
        },
        []
    );

    const selectCells = React.useCallback(
        (
            context: GridSelectionContextKey,
            cells: readonly GridCellKey[],
            gesture: CellSelectionGesture
        ) => {
            setCellSelection((prev) => applyCellSetGesture(prev, context, cells, gesture));
        },
        []
    );

    const clearCellSelection = React.useCallback(() => {
        setCellSelection((prev) => (prev.context === null ? prev : NO_CELL_SELECTION));
        // "Never mind" means the chosen colour too. Said here rather than left
        // to the context watcher below, because a colour can be armed with
        // nothing selected — and then there is no context change to notice.
        setCellPaint(null);
    }, []);

    const restoreCellSelection = React.useCallback((state: GridCellSelectionState) => {
        setCellSelection(state);
    }, []);

    /**
     * The colour the current selection SESSION paints with.
     *
     * Applying a colour arms it, so extending the selection afterwards carries
     * it onto the cells the extension brings in — having just painted a block
     * red, the user adding two more cells means those red too, and should not
     * have to click red again. It is not a mode and not a tool: there is no
     * permanently armed brush, only a property of the selection that is alive
     * right now.
     *
     * Ephemeral in the strictest sense: React state, never written to
     * `data.json`, to the settings or to a template.
     */
    const [cellPaint, setCellPaint] = React.useState<CellPaintColor | null>(null);

    /**
     * A modifier rectangle gesture is running somewhere in the panel.
     *
     * Escape then belongs to that gesture (cancel the rectangle, restore the
     * baseline), so the panel-wide Escape handler stands down — otherwise both
     * would fire on the same key and the cancel would end in an empty
     * selection instead of the one the user started from.
     */
    const [cellGestureActive, setCellGestureActive] = React.useState(false);

    /**
     * The paint colour dies with the selection session that armed it.
     *
     * One rule covers every case §14 of the spec lists — selection cleared,
     * Escape, edit mode left, category changed, variant changed, grid context
     * changed — because all of them end with the selection naming a different
     * grid or no grid at all. Keyed on the CONTEXT rather than on the state
     * object: `applyCellGesture` hands back a fresh context object whenever the
     * cells change, so watching identity would disarm the colour on the very
     * gesture that is supposed to carry it.
     *
     * The ONE transition that keeps it (2026-09-20): from NO selection to
     * some. A colour may now be armed with nothing selected — that is exactly
     * what a plain swatch click does — and the very next gesture, the
     * Shift-click that starts the selection, is the one that has to carry it.
     * Disarming there would make "choose a colour, then paint with it"
     * impossible. Every other change of context still disarms, an explicit
     * clear (Escape, background click) included.
     */
    const selectionContextKey =
        cellSelection.context === null ? null : gridContextKey(cellSelection.context);
    const previousContextKeyRef = React.useRef<string | null>(selectionContextKey);
    React.useEffect(() => {
        const previous = previousContextKeyRef.current;
        previousContextKeyRef.current = selectionContextKey;
        if (previous === selectionContextKey || previous === null) {
            return;
        }
        setCellPaint(null);
    }, [selectionContextKey]);

    /**
     * How many VISIBLE, interactive renderings each grid currently has.
     *
     * A selection may only outlive its grid's last such rendering — but an
     * unmount alone does not mean the grid is gone. In list view the category
     * block changes element type while a tool is dragged
     * (`categorySortEnabled = … && !buttonDrag.isDragging`, ListModeContent),
     * so React tears the whole grid down and rebuilds it mid-gesture. Counting
     * the renderings and deciding one turn LATER tells a remount (count back
     * above zero) from a real disappearance (count stays zero) without either
     * side having to know about the other.
     */
    const gridInstancesRef = React.useRef<GridInstanceCounter>(createGridInstanceCounter());

    /**
     * A category is being dragged — a LAYOUT gesture, during which grids are
     * legitimately absent without being gone.
     *
     * Reordering a category does not change which grid a selection belongs to,
     * yet it made the selection vanish: the dragged category's grid is swapped
     * for its drag preview for the length of the drag, so its last rendering
     * deregisters and the deferred check below found nobody home. While this
     * is set the check stands down, and the drop re-asks the question once the
     * real grid is back (see `handleLayoutDragChange`).
     */
    const layoutDragActiveRef = React.useRef(false);

    const registerSelectableGrid = React.useCallback(
        (context: GridSelectionContextKey) => {
            const release = gridInstancesRef.current.register(context);
            return () => {
                release();
                // Asked one turn later, never in the same one: a rebuilt grid
                // registers again inside the same React commit, so by now the
                // count tells a remount from a real goodbye.
                window.setTimeout(() => {
                    if (layoutDragActiveRef.current) {
                        return;
                    }
                    if (gridInstancesRef.current.liveCount(context) > 0) {
                        return;
                    }
                    setCellSelection((prev) => clearSelectionOf(prev, context));
                }, 0);
            };
        },
        []
    );

    /**
     * Start and end of a category drag, reported from inside the drag provider
     * (see CellSelectionLayoutDragHold). On the drop, the question the
     * deregistrations were not allowed to ask is asked once — one turn later,
     * so the reordered grid has remounted first. If the grid really is gone by
     * then, the selection goes with it, exactly as it would have without the
     * drag.
     */
    const handleLayoutDragChange = React.useCallback((active: boolean) => {
        layoutDragActiveRef.current = active;
        if (active) {
            return;
        }
        window.setTimeout(() => {
            setCellSelection((prev) =>
                prev.context !== null &&
                gridInstancesRef.current.liveCount(prev.context) === 0
                    ? NO_CELL_SELECTION
                    : prev
            );
        }, 0);
    }, []);

    /**
     * The selection may only exist while the grid it names is the one actually
     * on screen. Checked here, against the very state the panel renders from,
     * instead of by scattered exit() calls in every collapse handler and
     * variant action:
     *
     * - not while a search filters the panel (the grid then shows a filtered
     *   occupancy, not the stored one);
     * - the category still exists, is still a grid, and is still visible;
     * - the variant on screen is still exactly the one the selection names —
     *   this is what catches a context switch in Obsidian swapping the grid of
     *   a dynamic category under the pointer.
     *
     * The MODE is deliberately not on this list. Selection is operative and
     * works in both modes; locking only protects the layout, so a toggle is
     * not a change of grid and must not cost the user their selection. The
     * variant is compared against the grid view the projection actually
     * renders, which is right in both modes — the edited variant in edit mode,
     * the context-resolved one in locked mode.
     */
    React.useEffect(() => {
        const context = cellSelection.context;
        if (context === null) {
            return;
        }
        if (normalizedQuery.length > 0) {
            setCellSelection(NO_CELL_SELECTION);
            return;
        }
        const category = filteredCategories.find((entry) => entry.id === context.categoryId);
        if (!category || !isGridCategory(category)) {
            setCellSelection(NO_CELL_SELECTION);
            return;
        }
        const shownVariantId = projection.gridViews.get(category.id)?.variantId ?? null;
        if (shownVariantId !== context.variantId) {
            setCellSelection(NO_CELL_SELECTION);
        }
    }, [cellSelection.context, normalizedQuery, filteredCategories, projection.gridViews]);

    // Escape clears the selection. The handler lives in CellSelectionEscape,
    // mounted inside the drag provider below, because the rule has to yield to
    // an active drag — and because it must never stop the event (see the
    // component's own doc comment).

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
            <PanelVisibilityProvider
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
            <GridCellSelectionProvider
                state={cellSelection}
                selectCell={selectCell}
                selectCells={selectCells}
                clearCellSelection={clearCellSelection}
                restoreCellSelection={restoreCellSelection}
                registerSelectableGrid={registerSelectableGrid}
                // Selection is operative in BOTH modes; only a search suspends
                // it, because a filtered grid does not show the stored occupancy.
                available={normalizedQuery.length === 0}
                paint={cellPaint}
                armPaint={setCellPaint}
                cellGestureActive={cellGestureActive}
                setCellGestureActive={setCellGestureActive}
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
                <CellSelectionEscape panelRef={panelContentRef} />
                <CellSelectionBackdrop panelRef={panelContentRef} />
                <CellSelectionLayoutDragHold onActiveChange={handleLayoutDragChange} />
                <CellSelectionModifierCursor panelRef={panelContentRef} />
                {panelContent}
            </ButtonDragProvider>
            </GridCellSelectionProvider>
            </CategoryVariantProvider>
            </PanelVisibilityProvider>
        </div>
    );
};
