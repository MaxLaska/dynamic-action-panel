// theme/nexus/src/tokens.ts
// The Nexus design tokens, declared once.
//
// This file is the SINGLE SOURCE OF TRUTH for what a Nexus token is called, what
// it means and what it is worth by default. Three separate things read it, and
// none of them may carry a second copy of a name or a value:
//
//   - `theme/nexus/theme.css`     the theme itself, which declares the tokens
//                                 and spends them on real rules. It is
//                                 hand-written CSS — a theme should be readable
//                                 as a theme — and a test holds it to the table
//                                 below, value for value.
//   - `companion/nexus-theme-studio`
//                                 the editor, which builds its controls from
//                                 this table and writes overrides.
//   - `companion/zotflow-reader-extensions`
//                                 the bridge, which mirrors a subset of these
//                                 tokens into the reader's iframe.
//
// It is deliberately plain data with no imports: every consumer bundles it, and
// a token table that could execute something would be a strange thing to put in
// two plugins and a theme at once.
//
// WHAT IS NOT HERE, on purpose: the panel's semantic colours — cell colours,
// the selection colour, the `ocap:<name>` values. Those mean something ("this
// tool is a red one"), while these mean "this is a surface". Folding them
// together would turn every palette change into a semantics change. See
// docs/ocap/cell-selection-colors.md.

/** The theme's name, which is also the folder Obsidian loads it from. */
export const NEXUS_THEME_NAME = 'Nexus';

/**
 * The event the Theme Studio fires on the host window after it has applied a
 * change, so anything mirroring these tokens elsewhere can follow immediately.
 *
 * Declared here rather than in either plugin because it is the seam BETWEEN
 * them: a sender and a receiver that each keep their own copy of an event name
 * is the classic way for a rename to go quiet instead of failing.
 */
export const NEXUS_TOKENS_CHANGED_EVENT = 'nexus-theme-tokens-changed';

/** The sections the editor groups its controls into, in display order. */
export const NEXUS_GROUPS = ['workspace', 'document', 'interaction', 'text', 'typography'] as const;

export type NexusTokenGroup = (typeof NEXUS_GROUPS)[number];

export const NEXUS_GROUP_LABELS: Record<NexusTokenGroup, string> = {
    workspace: 'Workspace',
    document: 'Document and reader',
    interaction: 'Interaction',
    text: 'Text',
    typography: 'Typography',
};

/**
 * What kind of control a token gets. Exactly the kinds the table uses — this is
 * not a forms vocabulary, and a new kind is a new decision.
 *
 *   color        a picker, an opacity where `supportsAlpha`, and the raw CSS.
 *                Colours are not all six hex digits: `rgba()`, `hsl()` and
 *                `color-mix()` are values this project already relies on.
 *   length       a CSS length, with a slider over `range` for the common case
 *                and the raw CSS for everything else (`calc()`, `clamp()`).
 *   number       a unitless number, same shape.
 *   font-family  a CSS font-family list, typed or taken from `suggestions`.
 */
export type NexusControlType = 'color' | 'length' | 'number' | 'font-family';

/** The slider a `length` or `number` token offers; the raw value may leave it. */
export interface NexusTokenRange {
    min: number;
    max: number;
    step: number;
    /** The unit a slider value is written in. Absent for a unitless number. */
    unit?: 'px';
}

/** One suggestion for a `font-family` token: a name for people, a value for CSS. */
export interface NexusFontSuggestion {
    label: string;
    value: string;
}

export interface ThemeTokenDefinition {
    /** Stable identity in stored profiles. Never derived from the label. */
    key: string;
    /** The CSS custom property the theme declares and the editor overrides. */
    cssVariable: string;
    /** What the editor calls it. */
    label: string;
    group: NexusTokenGroup;
    controlType: NexusControlType;
    /** The theme's own value. `theme.css` must declare exactly this. */
    defaultValue: string;
    /** One line under the control, saying what the token actually paints. */
    description: string;
    /**
     * Whether the editor offers an opacity control beside the colour.
     *
     * Set for the tokens whose DEFAULT is already translucent — the splitter
     * states, which are white at three different alphas. Without it those three
     * were text fields and everything else was a colour picker, which is not a
     * distinction the user should have to notice.
     *
     * Absent means "an opaque colour is the normal case here". It is not a
     * prohibition: the text field still accepts any CSS value, and a stored
     * `rgba()` is parsed and shown correctly wherever it appears.
     */
    supportsAlpha?: boolean;
    /**
     * Other token keys to light up together with this one during the locator
     * preview.
     *
     * Only needed for tokens that paint a TRANSIENT state. Hovering "Splitter
     * (hover)" cannot show you anything, because nothing on screen is being
     * hovered at that moment; lighting the idle line as well answers the
     * question actually being asked, which is "where are the splitters".
     */
    locateAlso?: string[];
    /** The slider range, for `length` and `number` tokens. */
    range?: NexusTokenRange;
    /** Suggested values, for `font-family` tokens. Free CSS stays allowed. */
    suggestions?: readonly NexusFontSuggestion[];
}

/**
 * The v0.1 token table.
 *
 * Every default below is the value the surface ALREADY HAD in the state the
 * user judged as good, re-expressed as a Nexus token — not a fresh palette.
 * Measured against Obsidian 1.13.7's default dark theme, which is what the
 * baseline was built on:
 *
 *   --color-base-00  #1C1C1C   --background-primary, and the reader's
 *                              --material-background behind its pages
 *   --color-base-10  #232323   what the reader's sidebar was mixed to
 *   --color-base-20  #282828   --background-secondary: the dock tab strips
 *   --color-base-30  #333333   the dock body, after the experiment lightened it
 *   --color-base-70  #b3b3b3   --text-muted
 *   --color-base-100 #dadada   --text-normal
 *
 * They are literals rather than `var(--color-base-30)` for one reason: Nexus is
 * now the theme. There is no theme underneath it to defer to, and a token that
 * quietly forwards to somebody else's variable is not a token you can put a
 * colour picker on.
 */
export const NEXUS_TOKENS: readonly ThemeTokenDefinition[] = [
    {
        key: 'workspaceSurface',
        cssVariable: '--nexus-workspace-surface',
        label: 'Workspace surface',
        group: 'workspace',
        controlType: 'color',
        defaultValue: '#333333',
        description:
            'The left and right side docks and the left ribbon: the plane the workspace lives on.',
    },
    {
        key: 'workspaceSurfaceElevated',
        cssVariable: '--nexus-workspace-surface-elevated',
        label: 'Workspace surface (secondary)',
        group: 'workspace',
        controlType: 'color',
        defaultValue: '#282828',
        description:
            'Tab strips and the vault profile inside a dock. Match it to the workspace surface to make each dock one slab.',
    },
    {
        key: 'workspaceBorder',
        cssVariable: '--nexus-workspace-border',
        label: 'Workspace border',
        group: 'workspace',
        controlType: 'color',
        defaultValue: '#333333',
        description:
            'Dividers and tab outlines: everywhere Obsidian draws a one-pixel workspace line.',
    },
    {
        key: 'documentSurface',
        cssVariable: '--nexus-document-surface',
        label: 'Document surface',
        group: 'document',
        controlType: 'color',
        defaultValue: '#1c1c1c',
        description: 'The page plane: editors, previews, and the reader behind its pages.',
    },
    {
        key: 'documentChrome',
        cssVariable: '--nexus-document-chrome',
        label: 'Document chrome',
        group: 'document',
        controlType: 'color',
        defaultValue: '#333333',
        description: 'The tab strip above the document area.',
    },
    {
        key: 'readerPanelSurface',
        cssVariable: '--nexus-reader-panel-surface',
        label: 'Reader panel surface',
        group: 'document',
        controlType: 'color',
        defaultValue: '#232323',
        description:
            "The reader's own sidebar (TOGGLE PANEL): one step below the workspace, one step above the page.",
    },
    {
        key: 'splitterIdle',
        cssVariable: '--nexus-splitter-idle',
        label: 'Splitter (idle)',
        group: 'interaction',
        controlType: 'color',
        defaultValue: 'rgba(255, 255, 255, 0.1)',
        description: 'The hairline on every resizable workspace edge when nothing is happening.',
        supportsAlpha: true,
    },
    {
        key: 'splitterHover',
        cssVariable: '--nexus-splitter-hover',
        label: 'Splitter (hover)',
        group: 'interaction',
        controlType: 'color',
        defaultValue: 'rgba(255, 255, 255, 0.28)',
        description: 'The same edge under the pointer.',
        supportsAlpha: true,
        locateAlso: ['splitterIdle'],
    },
    {
        key: 'splitterActive',
        cssVariable: '--nexus-splitter-active',
        label: 'Splitter (dragging)',
        group: 'interaction',
        controlType: 'color',
        defaultValue: 'rgba(255, 255, 255, 0.45)',
        description: 'The same edge while it is being dragged.',
        supportsAlpha: true,
        locateAlso: ['splitterIdle'],
    },
    {
        key: 'textPrimary',
        cssVariable: '--nexus-text-primary',
        label: 'Text',
        group: 'text',
        controlType: 'color',
        defaultValue: '#dadada',
        description: 'Ordinary text, everywhere Obsidian writes it.',
    },
    {
        key: 'textMuted',
        cssVariable: '--nexus-text-muted',
        label: 'Text (muted)',
        group: 'text',
        controlType: 'color',
        defaultValue: '#b3b3b3',
        description: 'Secondary text: section headers, counts, placeholders.',
    },

    // --- typography ------------------------------------------------------------
    //
    // Mapped onto the hooks Obsidian 1.13.7 itself provides for themes, read in
    // its app.css rather than guessed:
    //
    //   --font-interface = override, THEME, legacy default, --font-default
    //       Appearance → Interface font writes the override, and it wins. A
    //       theme sets --font-interface-theme. So does Nexus, and a font chosen
    //       under Appearance still beats it — as Obsidian intends.
    //   --font-ui-smaller/small/medium/large = 12/13/15/20px on desktop
    //       There is no single UI size variable; the four steps are fixed. The
    //       token is the SMALL step (tabs, file explorer, settings — where most
    //       interface text lives), and the other three keep their proportion to
    //       it, so the default reproduces 12/13/15/20 exactly.
    //   --line-height-tight = 1.3
    //       The line height `body` sets for the interface. Notes use
    //       --line-height-normal, which this does not touch.
    //
    // No UI font WEIGHT, on purpose. Obsidian has none: --font-weight is the
    // weight of NOTE text (bold, links and callout titles are calc()ed from
    // it), and `body` sets no weight at all. A rule forcing one would reach into
    // notes and lose to every component that sets its own.
    {
        key: 'uiFontFamily',
        cssVariable: '--nexus-ui-font-family',
        label: 'UI font',
        group: 'typography',
        controlType: 'font-family',
        // Obsidian's own default stack, referenced rather than copied: copying
        // it would freeze today's list into every profile. A font chosen under
        // Appearance → Interface font still takes precedence.
        defaultValue: 'var(--font-default)',
        description:
            'The interface typeface. A font chosen under Appearance → Interface font takes precedence.',
        suggestions: [
            { label: 'Obsidian default', value: 'var(--font-default)' },
            { label: 'System UI', value: 'system-ui, sans-serif' },
            { label: 'Inter (ships with Obsidian)', value: '"Inter Variable", "Inter", sans-serif' },
            { label: 'Segoe UI', value: '"Segoe UI", system-ui, sans-serif' },
            { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
            { label: 'Monospace', value: 'var(--font-monospace)' },
        ],
    },
    {
        key: 'uiFontSize',
        cssVariable: '--nexus-ui-font-size',
        label: 'UI text size',
        group: 'typography',
        controlType: 'length',
        defaultValue: '13px',
        description:
            'Tabs, file explorer, settings and menus. Larger and smaller UI text keep their proportion to it.',
        range: { min: 10, max: 20, step: 0.5, unit: 'px' },
    },
    {
        key: 'uiLineHeight',
        cssVariable: '--nexus-ui-line-height',
        label: 'UI line height',
        group: 'typography',
        controlType: 'number',
        defaultValue: '1.3',
        description: 'Spacing between lines of interface text. Note text is not affected.',
        range: { min: 1, max: 2, step: 0.05 },
    },
];

/**
 * Text and surface pairs whose contrast the studio reports.
 *
 * Only pairs that are REAL on screen — a text token actually drawn on that
 * surface — because a contrast figure for a pair that never meets is a number
 * that reassures about nothing:
 *
 *   text on the docks          file explorer, panels, dock views
 *   text on the page           editors and previews
 *   muted text on the docks    file explorer items (--nav-item-color)
 *   muted text on the page     secondary text in notes and views
 *   muted text on the tab strip  tab titles in a focused group
 *                              (--tab-text-color-focused), on document chrome
 *
 * Text on the reader's panel is deliberately NOT here. The reader draws its
 * sidebar text in its own colour, inside its iframe; `--nexus-text-primary`
 * never reaches it. That pair exists only on paper.
 */
export interface NexusContrastPair {
    text: string;
    surface: string;
    label: string;
}

export const NEXUS_CONTRAST_PAIRS: readonly NexusContrastPair[] = [
    { text: 'textPrimary', surface: 'workspaceSurface', label: 'Text on the docks' },
    { text: 'textPrimary', surface: 'documentSurface', label: 'Text on the page' },
    { text: 'textMuted', surface: 'workspaceSurface', label: 'Muted text on the docks' },
    { text: 'textMuted', surface: 'documentSurface', label: 'Muted text on the page' },
    { text: 'textMuted', surface: 'documentChrome', label: 'Tab titles on the tab strip' },
];

/** Every Nexus custom property, in table order. */
export const NEXUS_VARIABLES: readonly string[] = NEXUS_TOKENS.map((token) => token.cssVariable);

/** The table indexed by key, for the editor and for stored overrides. */
export const NEXUS_TOKEN_BY_KEY: ReadonlyMap<string, ThemeTokenDefinition> = new Map(
    NEXUS_TOKENS.map((token) => [token.key, token])
);

/** Looks a token up by key, or null when a stored profile names one we dropped. */
export function nexusToken(key: string): ThemeTokenDefinition | null {
    return NEXUS_TOKEN_BY_KEY.get(key) ?? null;
}

/** The tokens of one group, in table order. */
export function nexusTokensOfGroup(group: NexusTokenGroup): ThemeTokenDefinition[] {
    return NEXUS_TOKENS.filter((token) => token.group === group);
}
