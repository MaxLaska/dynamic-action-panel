import React from 'react';
import {
    applyResizeSteps,
    clampResizeSteps,
    isResizeDragGesture,
    resizeStepSize,
    sameGridDimensions,
    snapResizeSteps,
    type GridDimensions,
    type GridResizeEdge,
} from '@/utils/categoryGrid';

/** What a resize drag currently previews, or null when none is running. */
export interface GridResizePreview {
    edge: GridResizeEdge;
    dimensions: GridDimensions;
}

export interface GridResizeDrag {
    /** Live preview while the pointer is down; null otherwise. */
    preview: GridResizePreview | null;
    /** Bind to a handle: starts the press that may become a drag. */
    onHandlePointerDown: (edge: GridResizeEdge, event: React.PointerEvent) => void;
}

interface DragState {
    pointerId: number;
    edge: GridResizeEdge;
    /** Size when the press started — every step is measured from here. */
    start: GridDimensions;
    /** Pixels per row/column, captured once (see resizeStepSize). */
    step: number;
    /** Pointer coordinate along the dragged axis at pointer-down. */
    origin: number;
    /** Snapped steps, already clamped to the reachable range. */
    steps: number;
    /** The press has travelled far enough to be a drag, not a click. */
    dragging: boolean;
    /** A preview has been published at least once for this drag. */
    previewed: boolean;
    element: Element;
}

/**
 * useGridResizeDrag
 *
 * The Notion-style pointer layer on top of the existing resize core: press a
 * handle at the grid's edge and drag to snap whole columns/rows, or just click
 * it to add one.
 *
 * Deliberately plain pointer events with pointer capture, NOT a second dnd-kit
 * context: this gesture owns its pointer from down to up, needs no collision
 * detection, no droppables and no overlay — everything dnd-kit exists for.
 * Capturing also guarantees the drag survives the pointer leaving the handle
 * (which it does immediately) and that OCAP's button drag never sees the
 * press.
 *
 * Nothing here writes settings. The drag produces a PREVIEW; `onCommit` runs
 * exactly once, on pointer-up, and goes through the same `planGridResize` the
 * stepper buttons use — including its confirmation for occupied stripes. A
 * cancelled drag (Escape, `pointercancel`) commits nothing at all.
 */
export function useGridResizeDrag(options: {
    /** Current stored size of the grid on screen. */
    dimensions: GridDimensions;
    /** The rendered slot grid, measured to translate pixels into cells. */
    gridRef: React.RefObject<HTMLElement | null>;
    /** A real drag ended on a new size. */
    onCommit: (next: GridDimensions) => void;
    /** The press never became a drag: the handle's click action. */
    onClick: (edge: GridResizeEdge) => void;
    /** False in locked mode / while a button drag runs: no handle at all. */
    enabled: boolean;
}): GridResizeDrag {
    const { dimensions, gridRef, onCommit, onClick, enabled } = options;

    const [preview, setPreview] = React.useState<GridResizePreview | null>(null);
    const dragRef = React.useRef<DragState | null>(null);

    // Latest callbacks/values without re-binding the window listeners.
    const latest = React.useRef({ dimensions, onCommit, onClick });
    latest.current = { dimensions, onCommit, onClick };

    const endDrag = React.useCallback(() => {
        const drag = dragRef.current;
        dragRef.current = null;
        setPreview(null);
        if (drag) {
            try {
                (drag.element as Element & {
                    releasePointerCapture?: (id: number) => void;
                }).releasePointerCapture?.(drag.pointerId);
            } catch {
                // The element may already be gone; nothing to release then.
            }
        }
        return drag;
    }, []);

    // A drag must never outlive its component, a cancelled pointer or an
    // Escape — a stuck preview would show a size the data does not have.
    React.useEffect(() => {
        if (!enabled) {
            endDrag();
        }
    }, [enabled, endDrag]);

    React.useEffect(() => () => void endDrag(), [endDrag]);

    const handlePointerMove = React.useCallback((event: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || event.pointerId !== drag.pointerId) return;

        const delta =
            (drag.edge === 'column' ? event.clientX : event.clientY) - drag.origin;

        drag.dragging = isResizeDragGesture(delta, drag.dragging);
        if (!drag.dragging) {
            return;
        }

        const snapped = clampResizeSteps(
            drag.start,
            drag.edge,
            snapResizeSteps(delta, drag.step, drag.steps)
        );
        // The FIRST publish happens as soon as the press becomes a drag, even
        // at zero steps: the readout and the lit handle tell the user the
        // gesture is live, which is exactly when they have not moved a full
        // cell yet. Afterwards only a real step change republishes.
        if (snapped === drag.steps && drag.previewed) {
            return;
        }
        drag.steps = snapped;
        drag.previewed = true;
        setPreview({
            edge: drag.edge,
            dimensions: applyResizeSteps(drag.start, drag.edge, snapped),
        });
    }, []);

    const handlePointerUp = React.useCallback(
        (event: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag || event.pointerId !== drag.pointerId) return;
            const finished = endDrag();
            if (!finished) return;

            if (!finished.dragging) {
                // A press that never travelled is a click, and a click on the
                // handle still means "one more". After a real drag it must NOT
                // also fire, or a shrink would end one column too wide.
                latest.current.onClick(finished.edge);
                return;
            }
            const next = applyResizeSteps(finished.start, finished.edge, finished.steps);
            if (!sameGridDimensions(next, finished.start)) {
                latest.current.onCommit(next);
            }
        },
        [endDrag]
    );

    const handlePointerCancel = React.useCallback(
        (event: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag || event.pointerId !== drag.pointerId) return;
            endDrag();
        },
        [endDrag]
    );

    const handleKeyDown = React.useCallback(
        (event: KeyboardEvent) => {
            if (event.key === 'Escape' && dragRef.current) {
                event.preventDefault();
                endDrag();
            }
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

    const onHandlePointerDown = React.useCallback(
        (edge: GridResizeEdge, event: React.PointerEvent) => {
            if (!enabled || event.button !== 0 || dragRef.current) {
                return;
            }
            const grid = gridRef.current;
            if (!grid) return;

            // Pixels per cell, from the grid as it is RIGHT NOW. Recomputing
            // this from the live preview would move the thresholds under the
            // pointer and make the mapping non-monotonic.
            const rect = grid.getBoundingClientRect();
            const style = grid.ownerDocument.defaultView?.getComputedStyle(grid);
            const start = latest.current.dimensions;
            const step =
                edge === 'column'
                    ? resizeStepSize(
                          rect.width,
                          start.columns,
                          parseFloat(style?.columnGap ?? '0') || 0
                      )
                    : resizeStepSize(
                          rect.height,
                          start.rows,
                          parseFloat(style?.rowGap ?? '0') || 0
                      );
            if (step <= 0) return;

            // The press belongs to this handle alone: without stopping it the
            // list view would start dragging the whole category instead.
            event.preventDefault();
            event.stopPropagation();

            const element = event.currentTarget;
            try {
                element.setPointerCapture(event.pointerId);
            } catch {
                // Capture is a nicety; the document listeners carry the drag.
            }

            dragRef.current = {
                pointerId: event.pointerId,
                edge,
                start,
                step,
                origin: edge === 'column' ? event.clientX : event.clientY,
                steps: 0,
                dragging: false,
                previewed: false,
                element,
            };
        },
        [enabled, gridRef]
    );

    return { preview, onHandlePointerDown };
}
