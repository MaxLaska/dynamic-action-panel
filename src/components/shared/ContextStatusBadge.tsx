import React from 'react';
import { setIcon } from 'obsidian';
import { t } from '@/utils/i18n';

/**
 * Whether an element is always available or governed by a context rule.
 * `persistent` = no condition configured; `contextual` = a condition exists.
 */
export type ContextStatus = 'persistent' | 'contextual';

/**
 * Lucide icons carried by Obsidian's bundled set.
 * - `pin` reads as "fixed in place, always here";
 * - `filter` reads as "a rule decides whether this shows".
 * The two are distinguishable by silhouette alone, so the marker never relies
 * on color — it also carries a tooltip and an accessible label.
 */
const STATUS_ICON: Record<ContextStatus, string> = {
    persistent: 'pin',
    contextual: 'filter',
};

interface ContextStatusBadgeProps {
    status: ContextStatus;
    /**
     * The element is contextual and its rule does not match right now, i.e. it
     * would not appear in locked mode. Only meaningful in management modes.
     */
    notMatching?: boolean;
    /** Locked mode uses a quieter variant (see PaletteGrid.css). */
    subtle?: boolean;
    className?: string;
}

/**
 * Small marker telling the user whether an element is always present or only
 * appears when its context rule matches. Rendered next to category titles and
 * on buttons; see docs/ocap/DECISIONS.md for where each mode shows what.
 */
export const ContextStatusBadge: React.FC<ContextStatusBadgeProps> = ({
    status,
    notMatching = false,
    subtle = false,
    className,
}) => {
    const iconName = STATUS_ICON[status];
    const iconRef = React.useCallback(
        (el: HTMLSpanElement | null) => {
            if (el) {
                setIcon(el, iconName);
            }
        },
        [iconName]
    );

    const label =
        status === 'persistent'
            ? t('context_status_persistent')
            : notMatching
              ? t('context_status_contextual_inactive')
              : t('context_status_contextual_active');

    const classNames = [
        'ocap-context-badge',
        `ocap-context-badge--${status}`,
        notMatching && 'ocap-context-badge--inactive',
        subtle && 'ocap-context-badge--subtle',
        className,
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <span
            ref={iconRef}
            className={classNames}
            role="img"
            aria-label={label}
            title={label}
        />
    );
};
