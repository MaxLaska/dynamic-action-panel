import React from 'react';
import { IconButton } from './IconButton';
import { t } from '@/utils/i18n';

interface AddButtonProps {
    onClick: () => void;
    className?: string;
    ariaLabel?: string;
}

/**
 * AddButton
 * 
 * Shared add-button control used to add a new button to a category.
 */
export const AddButton: React.FC<AddButtonProps> = ({
    onClick,
    className = 'add-button-btn',
    ariaLabel,
}) => {
    return (
        <div className="add-button">
            <IconButton
                icon="plus"
                onClick={onClick}
                className={className}
                ariaLabel={ariaLabel || t('add_button') || 'Add button'}
            />
        </div>
    );
};

