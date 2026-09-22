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
export const NEXUS_GROUPS = ['workspace', 'document', 'interaction', 'text'] as const;

export type NexusTokenGroup = (typeof NEXUS_GROUPS)[number];

export const NEXUS_GROUP_LABELS: Record<NexusTokenGroup, string> = {
    workspace: 'Workspace',
    document: 'Document and reader',
    interaction: 'Interaction',
    text: 'Text',
};

/**
 * The only control kind v0.1 has.
 *
 * A colour, edited with a picker AND a text field — the picker for the common
 * case, the text field because the stored value has to stay CSS, and CSS
 * colours are not all six hex digits. `rgba()`, `hsl()` and `color-mix()` are
 * values this project already relies on elsewhere.
 */
export type NexusControlType = 'color';

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
            'The second plane inside a dock: its tab strip and the vault profile. Set it to the workspace surface to make each dock read as one slab.',
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
    },
    {
        key: 'splitterHover',
        cssVariable: '--nexus-splitter-hover',
        label: 'Splitter (hover)',
        group: 'interaction',
        controlType: 'color',
        defaultValue: 'rgba(255, 255, 255, 0.28)',
        description: 'The same edge under the pointer.',
    },
    {
        key: 'splitterActive',
        cssVariable: '--nexus-splitter-active',
        label: 'Splitter (dragging)',
        group: 'interaction',
        controlType: 'color',
        defaultValue: 'rgba(255, 255, 255, 0.45)',
        description: 'The same edge while it is being dragged.',
    },
    {
        key: 'textPrimary',
        cssVariable: '--nexus-text-primary',
        label: 'Text',
        group: 'text',
        controlType: 'color',
        defaultValue: '#dadada',
        description: 'Ordinary text.',
    },
    {
        key: 'textMuted',
        cssVariable: '--nexus-text-muted',
        label: 'Text (muted)',
        group: 'text',
        controlType: 'color',
        defaultValue: '#b3b3b3',
        description: 'Secondary text: headers, counts, placeholders.',
    },
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
