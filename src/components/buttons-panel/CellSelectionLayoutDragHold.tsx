import React from 'react';
import { useCategoryDragOptional } from '@/contexts/ButtonDragContext';

interface CellSelectionLayoutDragHoldProps {
    /** Called with true when a category drag starts, false when it ends. */
    onActiveChange: (active: boolean) => void;
}

/**
 * Tells the selection owner when a category is being dragged.
 *
 * It exists for the same reason as CellSelectionEscape: `PanelContent` owns the
 * selection but sits ABOVE the drag provider, so it cannot read the drag state
 * itself. A category drag is a layout gesture during which the dragged
 * category's grid is replaced by its preview — absent, but not gone — and the
 * selection must survive that (see `handleLayoutDragChange` in PanelContent).
 */
export const CellSelectionLayoutDragHold: React.FC<CellSelectionLayoutDragHoldProps> = ({
    onActiveChange,
}) => {
    const categoryDrag = useCategoryDragOptional();
    const active = categoryDrag?.isDragging ?? false;

    React.useEffect(() => {
        onActiveChange(active);
    }, [active, onActiveChange]);

    return null;
};
