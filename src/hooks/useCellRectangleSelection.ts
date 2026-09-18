import React from 'react';
import type { GridCellKey, GridCellStyles } from '@/types/settings';
import { RESIZE_DRAG_THRESHOLD_PX, type GridDimensions } from '@/utils/categoryGrid';
import { gestureOfEvent } from '@/utils/cellSelectionGesture';
import { gridCellColorOf } from '@/utils/gridCellSelection';
import {
    cellAtPoint,
    cellsAddedByRectangle,
    rectangleCellKeys,
    rectangleSelectionCells,
    sameCell,
    type GridAxisGeometry,
    type GridCellCoordinate,
    type RectangleGesture,
} from '@/utils/gridRectangleSelection';

const NO_CELLS: ReadonlySet<GridCellKey> = new Set<GridCellKey>();

/** Everything a running gesture needs; `null` between gestures. */
interface RectangleDrag {
    pointerId: number;
    gesture: RectangleGesture;
    /** Where the press landed, to tell a click from a drag. */
    origin: { x: number; y: number };
    /** The cell the press started on — one corner of the rectangle. */
    anchor: GridCellCoordinate;
    /** The other corner, as last resolved. */
    current: GridCellCoordinate;
    /** The selection as it was at pointer-down. Every step derives from it. */
    baseline: ReadonlySet<GridCellKey>;
    /** Grid box and tracks, measured once (the grid cannot resize mid-gesture). */
    columns: GridAxisGeometry;
    rows: GridAxisGeometry;
    dimensions: GridDimensions;
    /** Latched: past the threshold the press stays a drag, whatever it does next. */
    dragging: boolean;
    /** A rectangle has been published at least once for this gesture. */
    published: boolean;
    /** Cells this ADD gesture has brought in, i.e. what a paint would colour. */
    added: readonly GridCellKey[];
}

export interface CellRectangleSelection {
    /**
     * Bind to the grid's `onPointerDownCapture`.
     *
     * Returns true when the press was taken over as a selection gesture, which
     * is also when it was stopped from reaching any drag activator below.
     */
    onPointerDownCapture: (event: React.PointerEvent<HTMLElement>) => boolean;
    /**
     * Cells the running gesture would paint on release — rendered in the armed
     * colour right away, so the user sees the result before committing to it.
     * Empty whenever nothing is pending.
     */
    paintPreview: ReadonlySet<GridCellKey>;
}

export interface CellRectangleSelectionOptions {
    /** The rendered slot grid, measured to translate pixels into cells. */
    gridRef: React.RefObject<HTMLElement | null>;
    /** Dimensions of exactly the grid on screen. */
    dimensions: GridDimensions;
    /** False in locked mode, during a resize preview, in a non-selectable copy. */
    enabled: boolean;
    /**
     * Whether THIS grid may edit the selection with a modifier.
     *
     * False when another grid holds it: Shift and Ctrl never reach across
     * grids, exactly as they do not for a single click. The press is still
     * swallowed (a modifier always means "selection", never "drag"), it simply
     * changes nothing.
     */
    owns: boolean;
    /** The selection of this grid right now — the baseline of the next press. */
    selectedCells: ReadonlySet<GridCellKey>;
    /** Publish the cells the gesture currently selects (replaces this grid's set). */
    onPreview: (cells: GridCellKey[]) => void;
    /** The press became a drag, so the release must not also count as a click. */
    onActivate: () => void;
    /** Announce that Escape now means "cancel the rectangle", not "clear all". */
    onActiveChange: (active: boolean) => void;
    /**
     * An ephemeral paint colour is armed (`{ color: null }` = "clear"), so the
     * cells an ADD gesture brings in take it. Null when nothing is armed.
     */
    paint: { color: string | null } | null;
    /**
     * Write the armed colour onto the cells the gesture added. One call, one
     * commit. Resolves to whether anything was actually stored.
     */
    onPaint: (cells: GridCellKey[]) => Promise<boolean>;
    /** Stored cell metadata of this grid — read to know when a write landed. */
    cellStyles?: GridCellStyles;
}

/**
 * useCellRectangleSelection
 *
 * The pointer layer of the modifier rectangle: Shift-drag adds a rectangular
 * block of cells to the selection, Ctrl/Cmd-drag removes one. The rules
 * themselves are pure (`src/utils/gridRectangleSelection.ts`); this hook only
 * owns the gesture.
 *
 * Deliberately plain document listeners, like `useGridResizeDrag` and for the
 * same reasons: the gesture owns its pointer from down to up, and needs none of
 * what dnd-kit exists for. Two departures from that hook, both load-bearing:
 *
 * - **no pointer capture.** Capturing retargets the compatibility mouse events
 *   too, so a press that never travelled would deliver its `click` to the grid
 *   container instead of to the cell it landed on — and that click is exactly
 *   the single-cell fallback (`Shift click = add one`) that must keep working
 *   unchanged. The document listeners carry the drag on their own;
 * - **no `preventDefault` on pointer-down.** It would suppress the
 *   compatibility mouse events entirely, and with them that same click. Text
 *   selection during the drag is kept away with CSS instead.
 *
 * The press is claimed in the CAPTURE phase of the grid, which is what stops it
 * from reaching dnd-kit's activator on the tool below or the category-drag
 * handle above. Nothing is disabled globally and nothing latches, so no key-up
 * can leave dragging switched off.
 */
export function useCellRectangleSelection(
    options: CellRectangleSelectionOptions
): CellRectangleSelection {
    const { gridRef, enabled } = options;

    const [paintPreview, setPaintPreview] = React.useState<ReadonlySet<GridCellKey>>(NO_CELLS);
    const dragRef = React.useRef<RectangleDrag | null>(null);
    /** A committed paint the stored styles have not caught up with yet. */
    const pendingPaintRef = React.useRef<{
        cells: readonly GridCellKey[];
        color: string | null;
    } | null>(null);

    // Latest values and callbacks without re-binding the document listeners.
    const latest = React.useRef(options);
    latest.current = options;

    const clearPaintPreview = React.useCallback(() => {
        pendingPaintRef.current = null;
        setPaintPreview(NO_CELLS);
    }, []);

    /**
     * The preview outlives the pointer, by exactly as long as the write takes.
     *
     * Saving is asynchronous and the panel re-renders from a
     * `buttons-panel-refresh` event, so dropping the preview when the promise
     * resolves showed the PRE-paint colours for the frames until the settings
     * came back — the same defect `useGridResizeDrag` holds its geometry for.
     * The preview is therefore released only once the stored styles really
     * carry the painted colour.
     */
    React.useEffect(() => {
        const pending = pendingPaintRef.current;
        if (!pending) {
            return;
        }
        const landed = pending.cells.every(
            (cell) => gridCellColorOf(options.cellStyles, cell) === pending.color
        );
        if (landed) {
            clearPaintPreview();
        }
    }, [options.cellStyles, clearPaintPreview]);

    /**
     * Ends the gesture.
     *
     * `restore` puts the selection back on the baseline — what Escape and a
     * cancelled pointer mean. A gesture that never became a drag published
     * nothing, so there is nothing to put back and no active state to announce.
     */
    const endDrag = React.useCallback((restore: boolean) => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (!drag) {
            return null;
        }
        if (drag.dragging) {
            if (restore) {
                latest.current.onPreview([...drag.baseline]);
                clearPaintPreview();
            }
            latest.current.onActiveChange(false);
        }
        return drag;
    }, [clearPaintPreview]);

    // A gesture must never outlive the grid it measures, nor a mode change.
    React.useEffect(() => {
        if (!enabled) {
            endDrag(true);
            // A preview waiting for a write it can no longer observe would
            // otherwise stand for good.
            clearPaintPreview();
        }
    }, [enabled, endDrag, clearPaintPreview]);

    React.useEffect(() => () => void endDrag(false), [endDrag]);

    const handlePointerMove = React.useCallback((event: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || event.pointerId !== drag.pointerId) {
            return;
        }
        if (!drag.dragging) {
            const dx = event.clientX - drag.origin.x;
            const dy = event.clientY - drag.origin.y;
            // The same euclidean threshold the drag sensor and the click check
            // use, so "this was a click" and "this was a drag" stay exact
            // complements and no press can fall between them.
            if (Math.sqrt(dx * dx + dy * dy) <= RESIZE_DRAG_THRESHOLD_PX) {
                return;
            }
            drag.dragging = true;
            // The release must not also be read as a single-cell click, not
            // even if the pointer wandered back to where it started.
            latest.current.onActivate();
            latest.current.onActiveChange(true);
        }

        const cell = cellAtPoint(
            { x: event.clientX, y: event.clientY },
            drag.columns,
            drag.rows
        );
        // The first publish happens even at the anchor cell: the press has just
        // become a drag and the user has to see the gesture is live.
        if (drag.published && sameCell(cell, drag.current)) {
            return;
        }
        drag.current = cell;
        drag.published = true;

        const rectangle = rectangleCellKeys(drag.anchor, cell, drag.dimensions);
        latest.current.onPreview(
            rectangleSelectionCells(drag.baseline, rectangle, drag.gesture)
        );

        // Only an ADD gesture paints, and only what it actually brought in.
        const paint = latest.current.paint;
        drag.added =
            drag.gesture === 'add' && paint !== null
                ? cellsAddedByRectangle(drag.baseline, rectangle)
                : [];
        setPaintPreview(drag.added.length > 0 ? new Set(drag.added) : NO_CELLS);
    }, []);

    const handlePointerUp = React.useCallback(
        (event: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag || event.pointerId !== drag.pointerId) {
                return;
            }
            const finished = endDrag(false);
            if (!finished || !finished.dragging) {
                // A press that never travelled is a click, and the grid's own
                // click handler applies the existing single-cell semantics.
                return;
            }
            const cells = finished.added;
            const color = latest.current.paint?.color ?? null;
            if (cells.length === 0) {
                clearPaintPreview();
                return;
            }
            // ONE persistence operation for the whole rectangle, at the end of
            // the gesture — never per pointer-move.
            pendingPaintRef.current = { cells, color };
            void Promise.resolve(latest.current.onPaint([...cells])).then(
                (written) => {
                    if (!written) {
                        // Refused (a read-only configuration) or nothing to do:
                        // the stored styles will never catch up, so the preview
                        // must go now rather than linger as a promise the data
                        // does not keep.
                        clearPaintPreview();
                    }
                },
                () => clearPaintPreview()
            );
        },
        [endDrag, clearPaintPreview]
    );

    const handlePointerCancel = React.useCallback(
        (event: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag || event.pointerId !== drag.pointerId) {
                return;
            }
            // A lost pointer is not a decision: nothing is written and the
            // selection goes back to what it was before the press.
            endDrag(true);
        },
        [endDrag]
    );

    const handleKeyDown = React.useCallback(
        (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || !dragRef.current) {
                return;
            }
            // Escape cancels the RECTANGLE, not the selection: back to the
            // baseline, no colour written. The panel's own Escape handler
            // stands down while a gesture runs (see CellSelectionEscape).
            endDrag(true);
        },
        [endDrag]
    );

    React.useEffect(() => {
        const doc = gridRef.current?.ownerDocument ?? document;
        doc.addEventListener('pointermove', handlePointerMove);
        doc.addEventListener('pointerup', handlePointerUp);
        doc.addEventListener('pointercancel', handlePointerCancel);
        doc.addEventListener('keydown', handleKeyDown);
        return () => {
            doc.removeEventListener('pointermove', handlePointerMove);
            doc.removeEventListener('pointerup', handlePointerUp);
            doc.removeEventListener('pointercancel', handlePointerCancel);
            doc.removeEventListener('keydown', handleKeyDown);
        };
    }, [gridRef, handlePointerMove, handlePointerUp, handlePointerCancel, handleKeyDown]);

    const onPointerDownCapture = React.useCallback(
        (event: React.PointerEvent<HTMLElement>): boolean => {
            const { enabled: on, owns, dimensions, selectedCells } = latest.current;
            if (!on || event.button !== 0 || dragRef.current) {
                return false;
            }
            const gesture = gestureOfEvent(event);
            // `replace` is the plain press — the existing click path owns it,
            // and so do the tool drag and the category drag. `null` is macOS'
            // Ctrl secondary click, which must stay a context menu.
            if (gesture !== 'add' && gesture !== 'remove') {
                return false;
            }

            // From here the press belongs to the selection, whatever it does
            // next: no tool move, no swap, no category reorder, on a filled and
            // on an empty cell alike.
            event.stopPropagation();

            if (!owns) {
                // Another grid holds the selection; a modifier never reaches
                // across. Swallowed, but without effect.
                return true;
            }

            const grid = gridRef.current;
            if (!grid) {
                return true;
            }
            const rect = grid.getBoundingClientRect();
            const style = grid.ownerDocument.defaultView?.getComputedStyle(grid);
            const columnGap = Number.parseFloat(style?.columnGap ?? '0') || 0;
            const rowGap = Number.parseFloat(style?.rowGap ?? '0') || 0;
            const columns: GridAxisGeometry = {
                start: rect.left,
                cellSize:
                    (rect.width - columnGap * (dimensions.columns - 1)) /
                    dimensions.columns,
                gap: columnGap,
                count: dimensions.columns,
            };
            const rows: GridAxisGeometry = {
                start: rect.top,
                cellSize: (rect.height - rowGap * (dimensions.rows - 1)) / dimensions.rows,
                gap: rowGap,
                count: dimensions.rows,
            };
            if (!(columns.cellSize > 0) || !(rows.cellSize > 0)) {
                return true;
            }

            const anchor = cellAtPoint(
                { x: event.clientX, y: event.clientY },
                columns,
                rows
            );
            // A new gesture supersedes whatever the last one was still waiting
            // for; the baseline it is about to take already reflects it.
            pendingPaintRef.current = null;
            dragRef.current = {
                pointerId: event.pointerId,
                gesture,
                origin: { x: event.clientX, y: event.clientY },
                anchor,
                current: anchor,
                baseline: new Set(selectedCells),
                columns,
                rows,
                dimensions,
                dragging: false,
                published: false,
                added: [],
            };
            return true;
        },
        [gridRef]
    );

    return { onPointerDownCapture, paintPreview };
}
