/** While a drag is running: lock touch behaviour so pan-y/pan-x does not fight dnd-kit's vertical dragging. */
export const PANEL_TOUCH_DRAG_LOCK_CLASS = 'buttons-panel-is-dragging';

export function setPanelTouchDragLock(locked: boolean): void {
    const targets = activeDocument.querySelectorAll(
        '.buttons-panel, .view-content.buttons-panel'
    );
    targets.forEach((el) => {
        el.classList.toggle(PANEL_TOUCH_DRAG_LOCK_CLASS, locked);
    });
}
