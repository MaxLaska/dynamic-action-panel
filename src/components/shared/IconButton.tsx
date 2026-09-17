import React, { useEffect, useRef } from 'react';
import { setIcon } from 'obsidian';

interface IconButtonProps {
    icon: string;
    onClick: () => void;
    className?: string;
    ariaLabel?: string;
    type?: 'button' | 'submit' | 'reset';
}

/**
 * IconButton
 * 
 * Button with an icon, wrapping the setIcon handling.
 * 
 * @param icon Icon name or SVG markup
 * @param onClick Click handler
 * @param className Additional CSS class names
 * @param ariaLabel Accessible label
 * @param type Button type
 */
export const IconButton: React.FC<IconButtonProps> = ({
    icon,
    onClick,
    className = '',
    ariaLabel,
    type = 'button',
}) => {
    const iconRef = useRef<HTMLSpanElement | null>(null);

    useEffect(() => {
        if (iconRef.current) {
            setIcon(iconRef.current, icon);
        }
    }, [icon]);

    return (
        <button
            type={type}
            className={className}
            onClick={onClick}
            aria-label={ariaLabel}
        >
            <span ref={iconRef} />
        </button>
    );
};

