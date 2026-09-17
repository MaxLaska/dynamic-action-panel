import { AutoScrollActivator, type AutoScrollOptions } from '@dnd-kit/core';

/** Auto-scroll when a drag approaches the panel edge (vertical in list mode, horizontal in the tab bar). */
export const PANEL_AUTO_SCROLL_OPTIONS: AutoScrollOptions = {
    threshold: { x: 0.12, y: 0.12 },
    acceleration: 10,
    interval: 5,
    activator: AutoScrollActivator.Pointer,
    layoutShiftCompensation: { x: true, y: true },
};
