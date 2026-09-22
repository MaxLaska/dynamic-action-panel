// sidebarSide.ts
// The decisions behind "which side is the sidebar on", with no DOM in sight.
//
// Everything here is a pure function so that the parts that can be wrong in a
// subtle way — the stylesheet's selector list, the right-hand resize maths, the
// reading of stored settings — are testable without a browser. The DOM effects
// live in sidebarPatch.ts and are deliberately dull.

import { OWN, SELECTORS } from './readerContract';
import { nexusVariable } from './nexusBridge';

/**
 * The Nexus custom properties this stylesheet spends, resolved from the token
 * table rather than spelled out.
 *
 * Spelling `--nexus-reader-panel-surface` into this file would create the exact
 * thing the theme exists to prevent: a second place where a token name lives,
 * free to drift from the first. Resolving it means a rename in
 * `theme/nexus/src/tokens.ts` either reaches here or fails the build.
 */
const NEXUS = {
    readerPanelSurface: nexusVariable('readerPanelSurface'),
    documentSurface: nexusVariable('documentSurface'),
} as const;

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

/**
 * The stylesheet that gives the reader's surfaces their place in the hierarchy.
 *
 * Unlike `sidebarStylesheet`, this one applies on BOTH sides — the hierarchy is
 * about which LEVEL a surface belongs to, and that does not change when the
 * sidebar is moved from one edge to the other.
 *
 * The problem, measured before this was written: the reader's sidebar and
 * Obsidian's side docks were painted the same colour (#282828 in the default
 * dark theme, on both sides of the boundary, from two unrelated variables that
 * happened to agree). Docked on the right, the reader's sidebar and the right
 * dock formed one continuous slab with no visible seam, and nothing said where
 * the document ended and the workspace began.
 *
 * WHERE THE VALUES COME FROM NOW. They come from the Nexus theme, mirrored into
 * this document by nexusBridge.ts. Nothing here decides a colour any more; this
 * file decides which SURFACE gets which token, which is the part that has to
 * live next to the reader's selectors.
 *
 * Each value is a `var(<nexus token>, <the reader's own>)`, and that fallback is
 * the entire fail-soft story:
 *
 * - Nexus active: the bridge has written the token onto the reader's root and
 *   the first branch is taken, overrides included.
 * - Nexus not active, or not installed: the token is undefined, the fallback is
 *   taken, and the reader keeps exactly the appearance this plugin gave it
 *   before the theme existed — the mix of the reader's own tokens, below.
 *
 * There is no JavaScript branch for that. CSS's own fallback is the mechanism,
 * which means the failing case cannot rot: it is exercised by every reader
 * opened without the theme.
 *
 * Two details carry the rest of the robustness:
 *
 * - The fallback is mixed from the reader's OWN tokens, so a reader that
 *   reskins itself takes this with it instead of being overridden by a fixed
 *   grey.
 * - `--material-sidepane` is re-pointed ON the container rather than globally.
 *   Everything inside the sidebar that paints the side-pane colour — headers,
 *   rows, its own toolbar — inherits the new value without this file having to
 *   enumerate a single one of them, and everything OUTSIDE the sidebar keeps
 *   the original. The intermediate variable is what makes that possible: the
 *   mix is computed on `body`, where `--material-sidepane` is still the
 *   reader's, so re-pointing it on the container is not a cycle.
 */
export function surfaceStylesheet(): string {
    return [
        `/* Injected by zotflow-reader-extensions. Values come from the Nexus`,
        `   theme when it is active, and from the reader's own tokens when it is`,
        `   not. The sidebar sits one step below the workspace and one step above`,
        `   the page, on both sides. */`,
        `body {`,
        `  --zfrx-toggle-surface: var(`,
        `    ${NEXUS.readerPanelSurface},`,
        `    color-mix(in srgb, var(--material-background) 40%, var(--material-sidepane) 60%)`,
        `  );`,
        `}`,
        `${SELECTORS.sidebarContainer} {`,
        `  --material-sidepane: var(--zfrx-toggle-surface);`,
        `  background-color: var(--zfrx-toggle-surface);`,
        `}`,
        `/* The plane behind the pages. BOTH split views, for the reason given in`,
        `   sidebarStylesheet: only the id-based one carries the document. */`,
        `${SELECTORS.splitViewClass},`,
        `${SELECTORS.splitViewId} {`,
        `  background-color: var(${NEXUS.documentSurface}, var(--material-background));`,
        `}`,
    ].join('\n');
}
