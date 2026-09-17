import React from 'react';

interface ButtonDragEmptySlotProps {
    displayStyle: 'icon_left' | 'icon_top';
}

/** Button-shaped placeholder for an empty category during a drag (same size as an icon-left / icon-top button) */
export const ButtonDragEmptySlot: React.FC<ButtonDragEmptySlotProps> = ({ displayStyle }) => {
    const layoutClass = displayStyle === 'icon_top' ? 'icon-top' : 'icon-left';
    return (
        <div
            className={`button-drag-empty-slot ${layoutClass}`}
            aria-hidden
        />
    );
};
