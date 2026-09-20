import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
    SortableContext,
    rectSortingStrategy,
    type SortingStrategy,
} from '@dnd-kit/sortable';
import type { CategoryConfig, ButtonConfig } from '@/types';
import type { ButtonsPanelPlugin } from '@/types/plugin';
import type { App } from 'obsidian';
import { SortableButtonItem } from '@/components/button/SortableButtonItem';
import { ButtonItem } from '@/components/button/ButtonItem';
import { containerDroppableId } from '@/utils/buttonDragItems';
import { useButtonDragOptional } from '@/contexts/ButtonDragContext';
import { ButtonDragEmptySlot } from '@/components/buttons-panel/ButtonDragEmptySlot';
import { GridSlotCell } from '@/components/buttons-panel/GridSlotCell';
import { GridRectanglePreview } from '@/components/buttons-panel/GridRectanglePreview';
import { GridSelectionOutline } from '@/components/buttons-panel/GridSelectionOutline';
import {
    GridResizeEdgeZone,
    GridResizeReadout,
} from '@/components/buttons-panel/GridResizeControls';
import { VariantSelector } from '@/components/buttons-panel/VariantSelector';
import { CellColorPalette } from '@/components/buttons-panel/CellColorPalette';
import {
    RESIZE_DRAG_THRESHOLD_PX,
    gridCellKeyOfSlot,
    isGridCategory,
} from '@/utils/categoryGrid';
import {
    useGridCellSelection,
    useSelectedCellsOf,
} from '@/contexts/GridCellSelectionContext';
import {
    gridCellColorOf,
    gridClickMeaning,
    isClickNotDrag,
    pruneToDimensions,
    sameSelectionContext,
    type CellSelectionGesture,
    type GridSelectionContextKey,
} from '@/utils/gridCellSelection';
import { gestureOfEvent } from '@/utils/cellSelectionGesture';
import { resolveGridCellColorCss } from '@/utils/gridCellColor';
import { useCellColorActions } from '@/hooks/useCellColorActions';
import { useCellRectangleSelection } from '@/hooks/useCellRectangleSelection';
import type { GridCellKey } from '@/types/settings';
import {
    useCategoryVariants,
    useGridViewResolution,
} from '@/contexts/CategoryVariantContext';
import {
    isDynamicCategory,
    previewResizedSlots,
    resolveDynamicCategoryVariant,
    type GridResizeDirection,
    type GridResizeEdge,
} from '@/utils/categoryVariants';
import { useWorkspaceContext } from '@/hooks/useWorkspaceContext';
import { useButtonCreation } from '@/hooks/useButtonCreation';
import { useSlotFileDrop } from '@/hooks/useSlotFileDrop';
import { gridResizeAvailability, useGridResize } from '@/hooks/useGridResize';
import { useGridResizeDrag } from '@/hooks/useGridResizeDrag';
import type { ContextStatus } from '@/components/shared/ContextStatusBadge';

/**
 * Sorting strategy for the grid: never translate anything.
 * A grid is positional — a button stays on its slot until the drop actually
 * reassigns it, so the list-style "make room" animation would be a lie.
 */
const NO_SORT_TRANSFORM: SortingStrategy = () => null;

interface CategoryButtonGridProps {
    category: CategoryConfig;
    orderedButtons: ButtonConfig[];
    contentClass: string;
    displayStyle: 'icon_left' | 'icon_top';
    enableAnimation: boolean;
    enableEditMode: boolean;
    plugin: ButtonsPanelPlugin;
    app: App;
    sortableEnabled: boolean;
    /**
     * Whether THIS instance is the visible, interactive rendering of its grid.
     *
     * The same category is rendered more than once at times — a drag preview
     * twice over, a hidden stale folder overlay — and hidden-but-mounted in
     * others (a collapsed list category, an inactive tab, both `display:none`).
     * Only the one instance a user can actually point at may own a cell
     * selection or show a palette. Defaults to true so the flag is opt-OUT for
     * the call sites that know they are not it.
     */
    selectable?: boolean;
    children?: React.ReactNode;
}

export const CategoryButtonGrid: React.FC<CategoryButtonGridProps> = ({
    category,
    orderedButtons,
    contentClass,
    displayStyle,
    enableAnimation,
    enableEditMode,
    plugin,
    app,
    sortableEnabled,
    selectable = true,
    children,
}) => {
    const buttonDrag = useButtonDragOptional();
    const isGrid = isGridCategory(category);
    const isDynamic = isDynamicCategory(category);
    const showDragEmptySlot =
        (buttonDrag?.isDragging ?? false) && orderedButtons.length === 0 && !isGrid;

    const { setNodeRef } = useDroppable({
        id: containerDroppableId(category.id),
        disabled: !sortableEnabled,
    });

    const gridRef = React.useRef<HTMLDivElement>(null);
    const isDragging = buttonDrag?.isDragging ?? false;

    // Must be called unconditionally before any early return, so the hook count stays stable when sortableEnabled flips.
    const setRefs = React.useCallback(
        (node: HTMLDivElement | null) => {
            setNodeRef(node);
            (gridRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        },
        [setNodeRef]
    );

    // --- Dynamic category variants ----------------------------------------
    // The resolution decides which grid the category shows: the selected
    // variant in the management modes, the first matching trigger (or the
    // fallback) in locked mode. A static grid category always shows its one
    // grid.
    const { manageable, selection, selectVariant } = useCategoryVariants();
    const resolution = useGridViewResolution(category);
    const workspaceContext = useWorkspaceContext();

    // Creating a tool is a property of the CELL, not of the category: the slot
    // the user points at already says where the tool goes, so neither entry
    // point has to ask for a position afterwards. Both resolve their target
    // variant from the same (normalized) selection the grid renders from.
    const { createButton } = useButtonCreation();
    const { canAcceptFileDrag, dropFileOnSlot } = useSlotFileDrop();
    const { resizeGrid, resizeGridTo } = useGridResize();
    const selectionEntry = isDynamic ? (selection[category.id] ?? null) : null;
    const runtimeResolution = React.useMemo(
        () =>
            isDynamic
                ? resolveDynamicCategoryVariant(category, workspaceContext)
                : { variant: null, reason: 'none' as const },
        [isDynamic, category, workspaceContext]
    );

    /**
     * Stored dimensions of exactly the grid on screen — the selected variant's
     * own in a dynamic category, the category's own in a static one. During a
     * button drag the live slot array is authoritative for the cell COUNT (it
     * was built from this same view), so the two can never disagree mid-drag.
     */
    const storedDimensions = resolution.dimensions;

    // Dragging a resize handle previews a different size without writing
    // anything: the commit happens once, on pointer-up (see useGridResizeDrag).
    const resizeDrag = useGridResizeDrag({
        dimensions: storedDimensions,
        gridRef,
        enabled: isGrid && enableEditMode && !isDragging,
        onCommit: (next, onSettled) => resizeGridTo(category, next, { onSettled }),
        onClick: (edge) => resizeGrid(category, edge, 1),
    });

    /** What the grid renders right now: the preview while resizing, else stored. */
    const dimensions = resizeDrag.preview?.dimensions ?? storedDimensions;

    // --- Cell selection & colors -------------------------------------------
    //
    // The grid — not the cell — owns the selection gesture. Every cell already
    // carries `data-slot`, so one pair of handlers on the container reads the
    // clicked cell out of the DOM and covers filled cells (the click bubbles up
    // from the tool button), empty cells and the corner `+` alike. No per-cell
    // pointer handler, and nothing to keep in sync across three code paths.
    const {
        state: cellSelectionState,
        selectCell,
        selectCells,
        restoreCellSelection,
        registerSelectableGrid,
        paint,
        armPaint,
        setCellGestureActive,
        available: selectionAvailable,
    } = useGridCellSelection();
    const { applyCellColor } = useCellColorActions();

    /**
     * The grid this instance addresses, or null when it addresses none.
     *
     * The strict reading of I-KEY: a static grid is `variantId === null`, a
     * dynamic one is a variant that exists. A dynamic category with no variants
     * resolves to `variantId === null` and therefore has no selectable grid at
     * all — which is right, because every write to it would be refused anyway.
     */
    const selectionContext = React.useMemo<GridSelectionContextKey | null>(() => {
        if (!isGrid || isDynamic !== (resolution.variantId !== null)) {
            return null;
        }
        return { categoryId: category.id, variantId: resolution.variantId };
    }, [isGrid, isDynamic, resolution.variantId, category.id]);

    // Selection is OPERATIVE: it works whether the layout is locked or not, so
    // neither the mode nor the drag gate appears here. (Gating on
    // `sortableEnabled` used to take every grid offline for the length of a
    // category drag — the drag provider disables button sorting while a
    // category moves — and the selection went with it.) What remains is: this
    // is the rendering a user can point at, it addresses a real grid, and no
    // search is filtering the panel.
    //
    // A resize preview renumbers cells for the length of the gesture, so no
    // selection click is accepted while one is on screen.
    const selectionEnabled =
        selectable && selectionAvailable && selectionContext !== null;
    const selectionActive = selectionEnabled && !resizeDrag.preview;

    const rawSelectedCells = useSelectedCellsOf(category.id, resolution.variantId);
    /**
     * Only ever the cells the grid actually HAS. Derived on read rather than
     * maintained: the grid can shrink from outside this panel (a second leaf, a
     * sync, an import), and a pruning that must be remembered can be forgotten.
     */
    const selectedCells = React.useMemo(
        () =>
            selectionEnabled
                ? pruneToDimensions(rawSelectedCells, dimensions)
                : (new Set<GridCellKey>() as ReadonlySet<GridCellKey>),
        [selectionEnabled, rawSelectedCells, dimensions]
    );

    const cellStyles = resolution.cellStyles;

    /**
     * Whether THIS grid is the one currently holding the selection.
     *
     * Shift and Ctrl only ever edit a selection inside the grid that already
     * has one (an empty selection belongs to no grid, so anyone may start).
     * The armed paint colour follows the same ownership: it is reset the moment
     * the selection moves to another grid, so it can only ever belong here.
     */
    const ownsSelection =
        selectionContext !== null &&
        (cellSelectionState.context === null ||
            sameSelectionContext(cellSelectionState.context, selectionContext));

    /**
     * Where the pointer went down, to tell a click from a drag.
     *
     * Captured, because the corner `+` stops pointer-down propagation, and a
     * press that starts there must still be measurable. The rule is the
     * project's existing one: 4 px of travel makes it a drag, and a drag never
     * also selects — which is exactly the guarantee "a successful drag must not
     * produce a selection click" needs, without asking the drag layer anything.
     */
    const pressOriginRef = React.useRef<{ x: number; y: number } | null>(null);

    const handleApplyColorToCells = React.useCallback(
        (cells: GridCellKey[], color: string | null) => {
            if (selectionContext === null || cells.length === 0) {
                return Promise.resolve(false);
            }
            return applyCellColor(selectionContext, cells, color);
        },
        [applyCellColor, selectionContext]
    );

    /**
     * Shift-drag adds a rectangle of cells, Ctrl/Cmd-drag removes one.
     *
     * The same semantics as the single click, applied to an area — which is why
     * it hangs off the very same press: the gesture only becomes a rectangle
     * once the pointer has travelled past the drag threshold, and below that
     * the ordinary click path still produces the existing one-cell add/remove.
     */
    const rectangle = useCellRectangleSelection({
        gridRef,
        dimensions,
        enabled: selectionActive,
        owns: ownsSelection,
        selectedCells,
        onPreview: (cells) => {
            if (selectionContext === null) {
                return;
            }
            selectCells(selectionContext, cells, 'replace');
        },
        onActivate: () => {
            pressOriginRef.current = null;
        },
        onActiveChange: setCellGestureActive,
        paint,
        onPaint: (cells) => handleApplyColorToCells(cells, paint?.color ?? null),
        cellStyles,
        // A cancelled gesture puts back the WHOLE selection as it was at the
        // press — which, for a Shift rectangle that moved the context in from
        // another grid, is that other grid's selection, not an empty one here.
        onRestore: () => {
            const before = gestureStartSelectionRef.current;
            if (before !== null) {
                restoreCellSelection(before);
            }
        },
    });

    /** The panel's selection as it was when the current press started. */
    const gestureStartSelectionRef = React.useRef<typeof cellSelectionState | null>(null);

    const handleGridPointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
        gestureStartSelectionRef.current = cellSelectionState;
        // A modifier press is a selection gesture and nothing else: claimed
        // here, in the capture phase, so it can never reach the tool's drag
        // activator below or the category-drag handle above. The press origin
        // is recorded either way — a claimed press that never travels is still
        // a click, and still means "add/remove this one cell".
        if (
            rectangle.onPointerDownCapture(event) &&
            isDynamic &&
            selectionContext?.variantId != null
        ) {
            // Same reason the click path pins the variant: without an explicit
            // pick the shown variant follows the Obsidian context, so switching
            // notes mid-gesture would swap the grid under the pointer and drop
            // the selection for a reason the user cannot see.
            selectVariant(category.id, selectionContext.variantId);
        }
        pressOriginRef.current =
            event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    };

    /**
     * A drag that actually started forfeits its click, whatever the pointer did
     * afterwards.
     *
     * The travel check alone is not enough: a drag that wanders off and comes
     * back drops on its own cell with a total travel near zero, and the browser
     * then fires an ordinary click on the tool. Dropping the origin the moment
     * dnd-kit activates makes every such click unresolvable, which is exactly
     * the guarantee "a successful drag never also selects" needs — and it needs
     * nothing from the drag layer but the flag it already publishes.
     */
    React.useEffect(() => {
        if (isDragging) {
            pressOriginRef.current = null;
        }
    }, [isDragging]);

    /**
     * A press on bare CELL surface must not reach the category-drag listeners
     * of the list view. This is exactly what the full-size `+` used to do for
     * empty cells; now that the `+` is a corner target, the surface it vacated
     * needs the same treatment.
     *
     * Scoped to presses that land on an actual cell, and on a tool not at all:
     * - a press on a tool keeps bubbling, so the button drag and the existing
     *   category-drag paths are untouched;
     * - a press in the 4px GUTTER between cells (or on the grid background)
     *   also keeps bubbling, so the gutters stay a category-drag handle exactly
     *   as they are today. They are not a selection target either (a click
     *   there changes nothing), so there is nothing here to protect.
     */
    const handleGridPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!selectionActive) {
            return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest('[data-slot]') == null) {
            return;
        }
        if (target.closest('.sortable-button-item, button') != null) {
            return;
        }
        event.stopPropagation();
    };

    /**
     * What a click on this grid MEANS — decided in the capture phase, before
     * the tool underneath gets to see it.
     *
     *     plain click                → the tool runs (both modes); no selection
     *     Shift click                → add this cell;    the tool does NOT run
     *     Ctrl/Cmd click             → remove this cell; the tool does NOT run
     *     the click ending a drag    → nothing at all
     *
     * A plain click no longer touches the selection. Using a tool and choosing
     * cells are different acts, and the modifier is what says which one is
     * meant — in locked and edit mode alike. The capture phase is what makes
     * that enforceable: a click this handler claims is stopped before the
     * tool's own handler (and the `+`, and the panel's backdrop listener)
     * can run, and a plain click it leaves alone reaches the tool untouched.
     */
    const handleGridClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!selectionActive || selectionContext === null) {
            return;
        }
        const origin = pressOriginRef.current;
        pressOriginRef.current = null;

        const gesture = gestureOfEvent(event);
        const meaning = gridClickMeaning(
            gesture,
            // An activated drag has already dropped the origin (see the effect
            // above), so its closing click cannot pass as one.
            isClickNotDrag(
                event.detail,
                origin,
                { x: event.clientX, y: event.clientY },
                RESIZE_DRAG_THRESHOLD_PX
            )
        );
        if (meaning === 'run-tool') {
            // Left alone, so it reaches the tool, which runs in either mode.
            return;
        }
        // Everything else is kept from the tool: a selection gesture, the
        // click ending a drag (moving a tool must never also run it), the
        // click ending a rectangle, and macOS' Ctrl secondary click.
        event.stopPropagation();
        if (meaning === 'ignore' || gesture === null) {
            return;
        }
        const target = event.target as HTMLElement | null;
        const cellEl = target?.closest('[data-slot]');
        if (!cellEl) {
            // The 4 px gutter between two cells, or the grid background: too
            // small to be intentional, so it changes nothing at all.
            return;
        }
        const slot = Number(cellEl.getAttribute('data-slot'));
        if (!Number.isInteger(slot) || slot < 0) {
            return;
        }
        // Pin the variant the moment a selection starts in a dynamic category.
        // Without an explicit pick the shown variant is derived from the
        // Obsidian context, so switching notes would swap the grid under the
        // pointer — and the selection, which names a variant, would be dropped
        // for a reason the user cannot see. Re-selecting what is already shown
        // only makes it explicit and keeps the A/B flip target.
        if (isDynamic && selectionContext.variantId !== null) {
            selectVariant(category.id, selectionContext.variantId);
        }
        const cellKey = gridCellKeyOfSlot(slot, dimensions.columns);
        selectCell(selectionContext, cellKey, gesture);
        // An armed paint colour follows an ADD gesture onto the cell it brings
        // in — the one-cell case of the rectangle rule, and for the same
        // reason: having just painted the selection red, the user extending it
        // means the new cell red too. Only a cell that was NOT already
        // selected is painted, and `remove` never paints at all.
        if (
            gesture === 'add' &&
            paint !== null &&
            ownsSelection &&
            !selectedCells.has(cellKey)
        ) {
            void handleApplyColorToCells([cellKey], paint.color);
        }
    };

    const handleApplyColor = (color: string | null) => {
        if (selectionContext === null) {
            return;
        }
        // Choosing a colour ARMS it: the next additive gesture carries it onto
        // whatever it brings in, until the selection is cleared or moves to
        // another grid. "No colour" is just as deliberate a choice, so it arms
        // too.
        //
        // Arming does not need a selection (2026-09-20) — choosing the colour
        // FIRST and then painting with Shift is the whole point. With cells
        // selected the click also paints them, which is the one write the
        // palette can make.
        armPaint({ color });
        if (selectedCells.size === 0) {
            return;
        }
        void applyCellColor(selectionContext, [...selectedCells], color);
    };

    const handleSelectByColor = (cells: GridCellKey[], gesture: CellSelectionGesture) => {
        if (selectionContext === null) {
            return;
        }
        selectCells(selectionContext, cells, gesture);
    };

    /**
     * A selection may not outlive the last rendering that could be pointed at.
     *
     * Registering is the whole rule. An instance that is not selectable never
     * registers, so a drag preview — which renders the same category, twice,
     * with the identical context key — can neither own nor end a selection.
     * Hidden-but-mounted cases (a collapsed list category, an inactive tab)
     * deregister because `selectable` flips, without unmounting. And a grid
     * that is merely REBUILT deregisters and registers again in the same
     * commit, which the counter on the other side sees as "still here".
     */
    React.useEffect(() => {
        if (!selectionEnabled || selectionContext === null) {
            return;
        }
        return registerSelectableGrid(selectionContext);
    }, [selectionEnabled, selectionContext, registerSelectableGrid]);

    /**
     * A shrink removes cells from the selection for good.
     *
     * Pruning on READ is the safety net — it cannot be forgotten, and it is what
     * a resize PREVIEW needs, since that may still be cancelled. But read-time
     * pruning alone only hides those cells: growing the grid again brought them
     * straight back into the selection, which reads as the grid handing back a
     * selection the user watched it take away. So once the smaller size is
     * actually STORED, the removal is committed too.
     */
    React.useEffect(() => {
        if (!selectionActive || selectionContext === null || rawSelectedCells.size === 0) {
            return;
        }
        const kept = pruneToDimensions(rawSelectedCells, storedDimensions);
        if (kept.size === rawSelectedCells.size) {
            return;
        }
        selectCells(selectionContext, [...kept], 'replace');
    }, [selectionActive, selectionContext, rawSelectedCells, storedDimensions, selectCells]);

    /**
     * Grid layout: slot occupancy of every cell. Three sources, in priority:
     * the resize preview (pointer down on a handle), the live button-drag
     * state, and otherwise the resolved grid. An empty slot simply stays empty
     * — which is the whole point of the grid: positions never shift.
     *
     * The preview runs through the SAME coordinate-aware core as the commit
     * (`previewResizedSlots`), so what the user sees mid-drag is exactly what
     * pointer-up produces.
     */
    const previewDimensions = resizeDrag.preview?.dimensions ?? null;
    const gridSlots = React.useMemo(() => {
        if (!isGrid) return null;
        if (previewDimensions) {
            return previewResizedSlots(resolution, previewDimensions);
        }
        if (sortableEnabled && buttonDrag) {
            return buttonDrag.getGridSlotButtons(category);
        }
        return resolution.slots;
    }, [isGrid, previewDimensions, sortableEnabled, buttonDrag, category, resolution]);

    /**
     * Buttons that could not be placed (corrupt data); never dropped.
     * A resize preview re-places them into the cells it proposes, so listing
     * them below as well would render the same button — and the same sortable
     * id — twice for the length of the drag.
     */
    const gridOverflow = isGrid && !previewDimensions ? resolution.overflow : [];

    const dropTargetSlot =
        buttonDrag?.dropTargetSlot?.categoryId === category.id
            ? buttonDrag.dropTargetSlot.slot
            : null;

    const renderButton = (
        button: ButtonConfig,
        index: number,
        contextStatus?: ContextStatus | 'none'
    ) =>
        sortableEnabled ? (
            <SortableButtonItem
                key={button.id}
                button={button}
                category={category}
                index={index}
                displayStyle={displayStyle}
                enableAnimation={enableAnimation && !isDragging}
                enableEditMode={enableEditMode}
                plugin={plugin}
                app={app}
                positional={isGrid}
                contextStatus={contextStatus}
            />
        ) : (
            <ButtonItem
                key={button.id}
                button={button}
                category={category}
                index={index}
                displayStyle={displayStyle}
                enableAnimation={enableAnimation}
                enableEditMode={enableEditMode}
                plugin={plugin}
                app={app}
                contextStatus={contextStatus}
            />
        );

    if (isGrid && gridSlots) {
        // Empty cells stay in the DOM in every mode so positions never shift,
        // and the raster is drawn in every mode too (locked and edit must not
        // look like two different panels). `--managed` is left for the chrome
        // that genuinely belongs to editing: the empty-cell hover and the grab
        // cursor. There is one management mode (edit), so one class.
        const managed = sortableEnabled || enableEditMode;

        const gridClassName = [
            contentClass,
            'ocap-palette-grid',
            managed && 'ocap-palette-grid--managed',
        ]
            .filter(Boolean)
            .join(' ');

        // Creation affordances belong to empty cells in edit mode only, and
        // they vanish while a drag is in flight — a button drag, because the
        // live preview is then what the cell has to show, and a resize drag,
        // because those cells are a proposal that pointer-up may still undo.
        // A FULL grid therefore offers no `+` at all — the way in is then to
        // add a column or a row.
        const creationEnabled = enableEditMode && !isDragging && !resizeDrag.preview;

        // Dropping a file is NOT an edit affordance, and it is the one thing
        // here that is not gated on the mode. Locked is the working mode, and
        // filing a PDF onto a slot is work; what stays edit-only is everything
        // that rearranges what is already on the grid. This is a drop from
        // OUTSIDE — a native HTML5 drag out of Obsidian — so it cannot reach
        // the plugin's own pointer-based move/swap, which remains edit-only.
        const fileDropEnabled = !isDragging && !resizeDrag.preview;

        // Every cell is the same keyed component whether filled or empty, so
        // the droppable cell nodes survive variant switches (see
        // GridSlotCell). The target cell keeps its ring even when the live
        // preview already fills it — "this is where it lands" stays explicit.
        const cells = gridSlots.map((button, slot) => {
            // The cell key is the storage key: colors and selection both live
            // on the coordinate, which is why they survive a tool being dragged
            // away and a grid being resized.
            const cellKey = gridCellKeyOfSlot(slot, dimensions.columns);
            // A running ADD rectangle shows what the release will write, in the
            // armed colour, before anything is persisted. Nothing is saved
            // during the gesture; this is purely what the cell RENDERS.
            const storedColor = rectangle.paintPreview.has(cellKey)
                ? (paint?.color ?? null)
                : gridCellColorOf(cellStyles, cellKey);
            const color = resolveGridCellColorCss(storedColor);
            return (
                <GridSlotCell
                    key={`slot-${slot}`}
                    categoryId={category.id}
                    slot={slot}
                    columns={dimensions.columns}
                    droppableEnabled={sortableEnabled}
                    isDropTarget={dropTargetSlot === slot}
                    managed={managed}
                    color={color ?? undefined}
                    selected={selectedCells.has(cellKey)}
                    deselecting={rectangle.preview?.removing.has(cellKey) ?? false}
                    onCreate={
                        creationEnabled
                            ? () => createButton(category, undefined, slot)
                            : undefined
                    }
                    fileDrop={
                        fileDropEnabled
                            ? {
                                  canAccept: canAcceptFileDrag,
                                  onDrop: (dataTransfer) =>
                                      dropFileOnSlot(category, slot, dataTransfer, {
                                          // The grid on screen, which in locked
                                          // mode is the context-resolved
                                          // variant and not an edited one.
                                          variantId: resolution.variantId,
                                          // Aimed at a tool the user could see:
                                          // a deliberate replace, which needs
                                          // no announcement.
                                          replacing: button !== null,
                                      }),
                              }
                            : undefined
                    }
                >
                    {button ? renderButton(button, slot, 'none') : null}
                </GridSlotCell>
            );
        });

        const overflowSection = gridOverflow.length > 0 && (
            <div className="ocap-palette-grid-overflow">
                {gridOverflow.map((button, index) => renderButton(button, index, 'none'))}
            </div>
        );

        const gridEl = (
            <div
                ref={setRefs}
                className={gridClassName}
                style={{ '--ocap-grid-columns': dimensions.columns } as React.CSSProperties}
                onPointerDownCapture={
                    selectionActive ? handleGridPointerDownCapture : undefined
                }
                onPointerDown={selectionActive ? handleGridPointerDown : undefined}
                // CAPTURE, so the grid decides what a click means before the
                // tool below runs (see handleGridClickCapture).
                onClickCapture={selectionActive ? handleGridClickCapture : undefined}
            >
                {cells}
                {/* The PERSISTENT layer: the contour of what is selected right
                    now, in its real shape. It outlives the gesture that
                    produced it, which is the whole point — a selection built by
                    subtracting a block from a larger one is unreadable from the
                    wash alone. */}
                <GridSelectionOutline cells={selectedCells} dimensions={dimensions} />
                {/* The running gesture, drawn as ONE dashed box over the whole
                    block (see GridRectanglePreview). Last child and above the
                    contour, so "what am I doing" is never mistaken for "what is
                    selected"; out of flow, so neither can displace a cell. */}
                {rectangle.preview && (
                    <GridRectanglePreview
                        bounds={rectangle.preview.bounds}
                        gesture={rectangle.preview.gesture}
                    />
                )}
            </div>
        );

        // Edit mode frames the grid with its two graspable EDGES: the whole
        // right border resizes columns, the whole bottom border resizes rows.
        // Both are siblings of the slot grid, never cells of it.
        //
        // Locked mode gets the same frame with the same 16px gutters, only
        // EMPTY. The handles are an editing affordance and stay edit-only, but
        // the SPACE they occupy must not be: with the gutters gone, every cell
        // of a 4-column grid grew by 4px the moment the panel was locked, so
        // the whole raster jumped on a mode switch. A mode change may change
        // what a press means; it may not relayout the panel.
        //
        // The frame stays MOUNTED while a button drag is in flight and only
        // refuses to act: unmounting it would hand its gutter back to the grid
        // and widen every cell mid-drag — exactly the moving-slot-rect problem
        // the definite row track solves vertically.
        const availability = gridResizeAvailability(dimensions);
        const onResize = isDragging
            ? undefined
            : (edge: GridResizeEdge, direction: GridResizeDirection) =>
                  resizeGrid(category, edge, direction);
        // The lit handle and the readout belong to the GESTURE. A preview that
        // is only being held until the settings catch up is no longer a
        // gesture — its job is purely to keep the geometry from flashing back.
        const gesture = resizeDrag.preview?.committed === false ? resizeDrag.preview : null;
        const resizingEdge = gesture?.edge ?? null;

        const body = (
            <div className="ocap-grid-frame">
                <div className="ocap-grid-frame-main">
                    {gridEl}
                    {enableEditMode ? (
                        <GridResizeEdgeZone
                            edge="column"
                            dimensions={dimensions}
                            availability={availability}
                            onResize={onResize}
                            onHandlePointerDown={resizeDrag.onHandlePointerDown}
                            dragging={resizingEdge === 'column'}
                        />
                    ) : (
                        <div
                            className="ocap-grid-gutter ocap-grid-gutter--column"
                            aria-hidden
                        />
                    )}
                </div>
                {enableEditMode ? (
                    <GridResizeEdgeZone
                        edge="row"
                        dimensions={dimensions}
                        availability={availability}
                        onResize={onResize}
                        onHandlePointerDown={resizeDrag.onHandlePointerDown}
                        dragging={resizingEdge === 'row'}
                    />
                ) : (
                    <div className="ocap-grid-gutter ocap-grid-gutter--row" aria-hidden />
                )}
                {enableEditMode && gesture && (
                    <GridResizeReadout
                        dimensions={gesture.dimensions}
                        edge={gesture.edge}
                    />
                )}
            </div>
        );

        const sortableIds = gridSlots
            .map((button) => button?.id ?? null)
            .filter((id): id is string => id !== null);

        return (
            <>
                {manageable && isDynamic && (
                    <VariantSelector
                        category={category}
                        selectedVariantId={selectionEntry?.current ?? null}
                        previousVariantId={selectionEntry?.previous ?? null}
                        runtime={runtimeResolution}
                        onSelect={(variantId) => selectVariant(category.id, variantId)}
                    />
                )}
                {sortableEnabled ? (
                    <SortableContext
                        items={sortableIds}
                        // A grid is positional: no sliding preview, the
                        // highlighted target slot shows where the drop lands.
                        strategy={NO_SORT_TRANSFORM}
                    >
                        {body}
                    </SortableContext>
                ) : (
                    body
                )}
                {/* Gated on selectionActive, not merely selectionEnabled: a
                    resize preview renders a grid the stored data does not have
                    yet, and it outlives the pointer by design (it is held until
                    the saved dimensions catch up). A palette live in that window
                    would search one grid while the user looks at another. */}
                {selectionActive && selectionContext !== null && (
                    <CellColorPalette
                        cellStyles={cellStyles}
                        dimensions={dimensions}
                        selectedCells={selectedCells}
                        onApply={handleApplyColor}
                        paint={paint}
                        onSelectByColor={handleSelectByColor}
                    />
                )}
                {overflowSection}
                {/* No global "Add button" entry under a grid: the position is
                    part of the gesture now, and a button created without one
                    would have to guess a slot. `children` (the callers' add
                    entry) is therefore deliberately not rendered here — flow
                    categories below still use it. */}
            </>
        );
    }

    const buttonIds = orderedButtons.map((b) => b.id);
    const renderButtons = () => orderedButtons.map((button, index) => renderButton(button, index));

    if (!sortableEnabled) {
        return (
            <div ref={setNodeRef} className={contentClass}>
                {orderedButtons.length === 0 ? (
                    showDragEmptySlot ? (
                        <ButtonDragEmptySlot displayStyle={displayStyle} />
                    ) : (
                        children
                    )
                ) : (
                    <>
                        {renderButtons()}
                        {children}
                    </>
                )}
            </div>
        );
    }

    return (
        <div ref={setRefs} className={contentClass}>
            <SortableContext items={buttonIds} strategy={rectSortingStrategy}>
                {orderedButtons.length === 0 ? (
                    showDragEmptySlot ? (
                        <ButtonDragEmptySlot displayStyle={displayStyle} />
                    ) : null
                ) : (
                    renderButtons()
                )}
            </SortableContext>
            {!isDragging && children}
        </div>
    );
};
