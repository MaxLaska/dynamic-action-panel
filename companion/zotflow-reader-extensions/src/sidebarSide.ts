// sidebarSide.ts
// The decisions behind "which side is the sidebar on", with no DOM in sight.
//
// Everything here is a pure function so that the parts that can be wrong in a
// subtle way — the stylesheet's selector list, the right-hand resize maths, the
// reading of stored settings — are testable without a browser. The DOM effects
// live in sidebarPatch.ts and are deliberately dull.

import { OWN, SELECTORS } from './readerContract';

/** Which edge the reader's sidebar lives on. */
export type SidebarSide = 'left' | 'right';

/** The reader's own behaviour, unchanged, is the default. */
export const DEFAULT_SIDE: SidebarSide = 'left';

/** This plugin's persisted settings. */
export interface ReaderExtensionSettings {
    sidebarSide: SidebarSide;
}

export const DEFAULT_SETTINGS: ReaderExtensionSettings = {
    sidebarSide: DEFAULT_SIDE,
};

/**
 * Reads settings that came off disk.
 *
 * `loadData` returns whatever is in the file, including null on first run and
 * anything a hand-edit left behind, so every field is checked rather than cast.
 * An unreadable value falls back to the reader's own behaviour, which is the
 * only fallback that cannot surprise anyone.
 */
export function normalizeSettings(raw: unknown): ReaderExtensionSettings {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
    const side = (raw as { sidebarSide?: unknown }).sidebarSide;
    return { sidebarSide: side === 'right' ? 'right' : DEFAULT_SIDE };
}

/** The sidebar width bounds the right-hand drag respects. */
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_FRACTION = 0.5;

/**
 * The reader's own breakpoint, below which it overlays the sidebar instead of
 * docking it — and its own overlay width.
 *
 * Both are copied from the reader's stylesheet rather than chosen here. They
 * are not this plugin's policy; they are the behaviour being mirrored, and if
 * the reader ever changes them these two constants are where that shows up.
 */
export const OVERLAY_BREAKPOINT_PX = 768;
export const OVERLAY_WIDTH = 'min(85vw, 320px)';

/**
 * The sidebar width a pointer position implies, for a sidebar on the RIGHT.
 *
 * The reader computes its own width as the pointer's distance from the LEFT
 * viewport edge, which is correct for a left-docked sidebar and wrong by
 * construction for a right-docked one — measured: dropping the handle at x=300
 * in a 980px viewport produced a 300px sidebar instead of 680px. This is the
 * mirrored maths, clamped the same way the reader clamps.
 *
 * Exported and pure because it is the one piece of arithmetic in the plugin
 * that is easy to get backwards and impossible to eyeball in a screenshot.
 */
export function rightSidebarWidth(viewportWidth: number, clientX: number): number {
    const max = Math.round(viewportWidth * SIDEBAR_MAX_FRACTION);
    // A viewport too small to hold the minimum still has to yield something
    // inside its own bounds, so the maximum wins the clamp.
    const lower = Math.min(SIDEBAR_MIN_WIDTH, max);
    return Math.round(Math.min(max, Math.max(lower, viewportWidth - clientX)));
}

/**
 * The stylesheet injected into a reader document.
 *
 * It only ever describes the RIGHT state; the left state is the reader's own
 * CSS, untouched, which is what keeps "left" a genuine no-op rather than a
 * second implementation of the default.
 *
 * The mirroring of the icon is not a new asset: the reader already mirrors this
 * exact button for right-to-left locales, and this reuses that technique on the
 * button that is already there.
 */
export function sidebarStylesheet(): string {
    const right = `body.${OWN.rightClass}`;
    return [
        `/* Injected by zotflow-reader-extensions. Describes the right-hand`,
        `   sidebar only; the left-hand layout is the reader's own. */`,
        `${right} ${SELECTORS.sidebarContainer} {`,
        `  left: auto;`,
        `  right: calc(var(--sidebar-width) * -1);`,
        `  border-right: none;`,
        `  border-left: var(--material-panedivider);`,
        `}`,
        `${right}.sidebar-open ${SELECTORS.sidebarContainer} { right: 0; left: auto; }`,
        `/* BOTH split views. The reader ships a class-based and an id-based one,`,
        `   and only the id-based one carries the document iframe. */`,
        `${right}.sidebar-open ${SELECTORS.splitViewClass},`,
        `${right}.sidebar-open ${SELECTORS.splitViewId} {`,
        `  inset-inline-start: 0;`,
        `  inset-inline-end: var(--sidebar-width);`,
        `}`,
        `${right} ${SELECTORS.sidebarResizer} {`,
        `  inset-inline-start: auto;`,
        `  inset-inline-end: var(--sidebar-width);`,
        `}`,
        `${right} ${SELECTORS.sidebarToggleAny} { transform: scaleX(-1); }`,
        `${right} ${SELECTORS.toolbarStart} > ${SELECTORS.divider}.${OWN.orphanDivider} {`,
        `  display: none;`,
        `}`,
        `/* Below its own breakpoint the reader stops docking the sidebar and`,
        `   overlays it instead: it widens the panel to min(85vw, 320px), shows a`,
        `   backdrop, and deliberately does NOT move the document. Mirroring that`,
        `   is the whole job here — without it the document would be narrowed AND`,
        `   still covered. The query and the width are the reader's own. */`,
        `@media (max-width: ${OVERLAY_BREAKPOINT_PX}px) {`,
        `  ${right}.sidebar-open ${SELECTORS.splitViewClass},`,
        `  ${right}.sidebar-open ${SELECTORS.splitViewId} {`,
        `    inset-inline-start: 0;`,
        `    inset-inline-end: 0;`,
        `  }`,
        `  ${right} ${SELECTORS.sidebarContainer} {`,
        `    right: calc(-1 * ${OVERLAY_WIDTH});`,
        `    box-shadow: rgba(0, 0, 0, 0.35) -2px 0 14px;`,
        `  }`,
        `  ${right}.sidebar-open ${SELECTORS.sidebarContainer} { right: 0; }`,
        `}`,
    ].join('\n');
}
