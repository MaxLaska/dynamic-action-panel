// categoryIcon.ts
// Which glyph stands for a category's kind, in every view (list, tabs, folder).
//
// The icon is the only place a dynamic category announces itself, so it has to
// carry meaning rather than decoration: `git-branch` reads as "this branches
// depending on something" — which is exactly what variant triggers do — where
// the previous `layers` glyph read as "several things stacked" and was taken
// for a layout option. Pair it with `category_dynamic_tooltip` wherever it is
// rendered.

import type { CategoryConfig } from '@/types/settings';
import { isGridCategory } from '@/utils/categoryGrid';
import { isDynamicCategory } from '@/utils/categoryVariants';

/** Content changes with context (variant triggers decide which grid shows). */
export const DYNAMIC_CATEGORY_ICON = 'git-branch';

/** One fixed 4x4 grid, no context behavior. */
export const STATIC_GRID_CATEGORY_ICON = 'layout-grid';

/** Classic flow category: buttons follow each other and close gaps. */
export const FLOW_CATEGORY_ICON = 'list';

export function categoryLayoutIcon(category: CategoryConfig): string {
    if (isDynamicCategory(category)) return DYNAMIC_CATEGORY_ICON;
    return isGridCategory(category) ? STATIC_GRID_CATEGORY_ICON : FLOW_CATEGORY_ICON;
}
