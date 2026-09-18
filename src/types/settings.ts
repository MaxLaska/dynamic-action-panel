// settings.ts
// Type definitions for the persisted settings and the runtime view shapes.
import type { ButtonAction } from '@/types/action';
import type { ButtonCondition } from '@/types/conditions';

/**
 * Current settings schema version.
 * Bump together with a new migration step in src/settings/settingsMigrations.ts.
 * Version history:
 * - 0 (implicit): unversioned upstream Buttons Panel settings (no settingsVersion field)
 * - 1: settingsVersion introduced; nested defaults deep-merged; optional
 *      ButtonConfig.conditions added (absent field = always visible).
 *      Phase 3 additionally added optional CategoryConfig.conditions — a
 *      purely additive optional field that requires no data transformation,
 *      so it stays within version 1.
 *      Phase 4 (palette grid) added optional CategoryConfig.layout and
 *      ButtonConfig.slot on the same terms: an absent layout means the
 *      historical flow behavior and an absent slot is only consulted inside a
 *      grid category, so no stored data needs transforming and version 1 data
 *      written today stays loadable by earlier builds.
 * - 2: palette context layers (retired by version 3). A grid category was a
 *      layered palette: its own `buttons` array was the base/pinned layer and
 *      `contextProfiles` carried named alternative layers, each with exactly
 *      one condition. Per-button conditions inside grid categories were lifted
 *      into context profiles.
 * - 3: dynamic category variants. The layer model was retired after a manual
 *      UX test (see docs/ocap/DECISIONS.md): a grid category is now either
 *      STATIC (one full grid in `buttons`, no context behavior) or DYNAMIC
 *      (`variants` holds complete, independent 4x4 grids; exactly one variant
 *      renders at a time — the first whose trigger matches, else the fallback,
 *      else the category is hidden). No inheritance, no pinned slots, no
 *      merging. The migration composes each v2 profile with the base layer
 *      into one full variant and turns the base-only state into the fallback,
 *      so the v2 runtime semantics are preserved exactly (with deliberate
 *      redundancy instead of shared state). Flow categories are untouched.
 * - 4: two interaction modes instead of three. 'sort' (drag only) and 'edit'
 *      (menus only) were one job split across two modes; they are merged into
 *      'edit', which now carries drag AND editing, and the panel toggles
 *      between 'locked' and 'edit'. Stored `panelConfig.interactionMode` of
 *      'sort' migrates to 'edit'; nothing else changes.
 * - 5: tool registry + placements. A stored button is split into its two
 *      halves: the functional ToolDefinition (name, icon, actions, execution
 *      settings) lives once in the root `tools` registry, and a ToolPlacement
 *      (`{ toolId, slot? }`) inside the category/variant says where it sits.
 *      Grid position has exactly one truth (`slot`); flow order is the
 *      placement array order. Button ids become tool ids unchanged. See
 *      docs/ocap/audits/2026-09-17-architecture-audit-target-model.md.
 */
export const CURRENT_SETTINGS_VERSION = 5;

/**
 * ButtonConfig describes all properties of a single button.
 *
 * Since settings version 5 this is the RUNTIME VIEW shape (and the shape of
 * pre-v5 stored data inside the migration chain): the persisted model splits
 * a button into a ToolDefinition in the root registry plus a ToolPlacement
 * inside its category/variant, and the projection materializes objects of
 * this shape for the renderers (`id` = the tool id, `order` = the placement
 * array index, `slot` = the placement's slot). Renderers, drag state and
 * modals keep consuming exactly this shape.
 */
export interface ButtonConfig {
    /** Unique button id */
    id: string;
    /** Button label */
    name: string;
    /** Button icon (SVG markup or a single character) */
    icon?: string;
    /**
     * Hover text, when it should say more than the label does. Absent means the
     * label is the hover text, which is the historical behaviour.
     */
    tooltip?: string;
    /** Action sequence run on click */
    actions: ButtonAction[];
    /** Sort value of the button inside its category */
    order: number;
    /** Custom CSS for this button (optional) */
    customCss?: string;
    /** How the actions are executed (sequentially or in parallel) */
    executionMode?: 'sequential' | 'parallel';
    /** Whether to stop the sequence when an action fails */
    stopOnError?: boolean;
    /** Delay between actions in sequential mode (milliseconds) */
    delayBetweenActions?: number;
    /**
     * Optional declarative visibility condition (context engine).
     * Absent/undefined = the button behaves exactly like a static upstream
     * button and is always visible. Conditions are applied against the
     * current workspace context snapshot in locked interaction mode only; in
     * sort/edit mode the button stays manageable (visually marked).
     *
     * **Flow categories only.** Inside a `layout: 'grid'` category this field
     * is ignored at runtime: contextuality there is modelled at the variant
     * level (see CategoryConfig.variants), never per button. Migrations keep
     * structurally invalid legacy conditions on the button as inert data
     * rather than discarding them.
     */
    conditions?: ButtonCondition;
    /**
     * Palette grid slot of this button inside a `layout: 'grid'` category,
     * read row-major against the grid's own dimensions (`slot = row * columns
     * + column`, 0..rows*columns-1). Ignored by flow categories, where `order`
     * keeps deciding the position. The slot is a stable spatial identity — it
     * is what a future slot hotkey will bind to — so it must not be recomputed
     * from the array index: a button hidden by its conditions leaves its slot
     * empty instead of letting the following buttons slide up. Resizing the
     * grid is the one operation that renumbers slots, and it does so
     * coordinate-aware so the button keeps its logical row/column.
     * Absent/invalid slots are repaired deterministically at render time by
     * placeButtonsOnGrid (src/utils/categoryGrid.ts), never by dropping data.
     */
    slot?: number;
}

// --- v5 stored model: tool registry + placements ------------------------------

/**
 * The functional half of a tool, stored ONCE in the root `tools` registry and
 * referenced from placements by id. Everything that says what the tool IS and
 * DOES lives here; where it sits lives on the ToolPlacement.
 *
 * Field-for-field this is a ButtonConfig without its positional fields
 * (`order`, `slot`), plus the `library` lifecycle flag.
 */
export interface ToolDefinition {
    /** Globally unique tool id (former button id for migrated data). */
    id: string;
    name: string;
    /** Stored SVG markup (same convention as ButtonConfig.icon). */
    icon?: string;
    /**
     * Hover text, when the label alone does not say enough. A dropped PDF
     * annotation records its source and page here, captured ONCE — it is a
     * presentation snapshot, not a live view of the annotation's metadata.
     * Absent means the label is the hover text.
     */
    tooltip?: string;
    actions: ButtonAction[];
    executionMode?: 'sequential' | 'parallel';
    stopOnError?: boolean;
    delayBetweenActions?: number;
    customCss?: string;
    /** Flow-only visibility condition; inert inside grid categories. */
    conditions?: ButtonCondition;
    /**
     * Library membership (domain field only — there is no library UI yet).
     * Absent/false: an ad-hoc tool that is garbage-collected when its last
     * placement is removed, exactly matching the pre-v5 behavior where a
     * button existed only on its grid. True: the definition survives with
     * zero placements and will appear in the future library.
     */
    library?: boolean;
}

/** The root tool registry: id -> definition. */
export type ToolRegistry = Record<string, ToolDefinition>;

/**
 * One placed tool. Deliberately WITHOUT an own id (`(container, slot)`
 * identifies a grid placement, the array position a flow placement) and
 * without any name/icon/action overrides — those are ToolDefinition
 * properties.
 */
export interface ToolPlacement {
    toolId: string;
    /**
     * Grid categories: the row-major slot (the single truth of the position —
     * there is no `order` on grid placements anymore). Absent on flow
     * placements, where the placement array order IS the order, and on
     * corrupt/overflow grid data, which the render-time self-healing places
     * deterministically (array order is the tiebreaker).
     */
    slot?: number;
}

/**
 * One stored variant of a dynamic grid category (v5 shape): identical to the
 * runtime CategoryVariant except that its grid is `placements` into the tool
 * registry instead of embedded buttons.
 */
export interface StoredVariant extends GridDimensionFields, GridCellStyleFields {
    id: string;
    name: string;
    trigger?: ButtonCondition;
    fallback?: boolean;
    placements: ToolPlacement[];
}

/**
 * One stored category (v5 shape). Same fields and semantics as the runtime
 * CategoryConfig, with `placements` (and stored variants) instead of embedded
 * buttons. The runtime view is materialized from this plus the registry —
 * see src/domain/tools.ts.
 */
export interface StoredCategory extends GridDimensionFields, GridCellStyleFields {
    id: string;
    name: string;
    order: number;
    /**
     * - flow category: all placements, array order = visible order;
     * - STATIC grid category: the one grid (each placement carries its slot);
     * - DYNAMIC grid category: unused and kept empty (every tool lives inside
     *   exactly one variant); non-empty data is carried as inert placements,
     *   mirroring how inert `buttons` were treated before v5.
     */
    placements: ToolPlacement[];
    /** Stored variants of a DYNAMIC grid category; absent = static/flow. */
    variants?: StoredVariant[];
    conditions?: ButtonCondition;
    layout?: 'flow' | 'grid';
}

/**
 * Dimensions of ONE grid, stored on the object that owns that grid: on the
 * category for a static grid, on the variant for a dynamic one (a variant IS a
 * complete independent grid, so its size is its own).
 *
 * Both fields are optional and purely additive: data written before variable
 * grids existed carries neither, and absent fields read as the historical
 * fixed 4x4 (see LEGACY_GRID_DIMENSIONS in src/utils/categoryGrid.ts). No
 * migration and no rewrite of existing `data.json` files is therefore needed;
 * only grids the user actually resizes — and newly created ones — store them.
 * Bounded to 1..5 in both directions.
 */
export interface GridDimensionFields {
    /** Number of grid rows (1..5). Absent = legacy 4. */
    rows?: number;
    /** Number of grid columns (1..5). Absent = legacy 4. */
    columns?: number;
}

/**
 * Key of ONE grid cell inside the styles map: `r<row>c<column>`, e.g. `r1c2`.
 *
 * Deliberately NOT the flat slot index. A slot index only names a cell
 * relative to the current column count — add a column and slot 4 stops being
 * the cell it was — while a row/column pair names the same logical cell no
 * matter how the grid is resized. Growing a grid therefore needs no remap at
 * all, and shrinking drops exactly the keys whose cell no longer exists
 * (resizeGridCellStyles in src/utils/categoryGrid.ts).
 */
export type GridCellKey = string;

/**
 * Presentation metadata of ONE grid cell.
 *
 * The cell — not the tool — owns it: an EMPTY cell must be able to carry a
 * color too, which rules out both ToolDefinition and ToolPlacement as a home.
 *
 * `color` is a portable value, never a CSS class name (a class only exists
 * inside the current UI build and would not survive an export or a restyle):
 * either a literal `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` hex color, or a
 * namespaced palette entry (`ocap:<name>`, e.g. `ocap:accent`). The two
 * forms are told apart by their own prefixes, so a later palette can be
 * introduced without another structural migration — and so a stray UI class
 * name can be REJECTED rather than merely discouraged.
 *
 * There is no color UI yet; the field exists so the stored shape, the copy
 * semantics and the portable template format do not have to be reinvented
 * when it arrives.
 */
export interface GridCellStyle {
    color?: string;
}

/** Cell metadata of ONE grid, keyed by GridCellKey. Absent = no styled cell. */
export type GridCellStyles = Record<GridCellKey, GridCellStyle>;

/**
 * The optional cell metadata a grid carries, stored on the object that owns
 * that grid — exactly like GridDimensionFields: on the category for a static
 * grid, on the variant for a dynamic one (a variant IS a complete independent
 * grid, so its cell styles are its own and stay variant-local).
 *
 * Purely additive and optional: data written before cell styles existed
 * carries no `cellStyles`, which reads as "no cell is styled". No migration
 * and no rewrite of existing `data.json` files is needed, and settings
 * written today stay loadable by earlier builds — so this field does NOT
 * require a settingsVersion bump.
 */
export interface GridCellStyleFields {
    cellStyles?: GridCellStyles;
}

/**
 * One complete variant of a dynamic grid category (dynamic category variants).
 *
 * A variant is a FULL, independent configuration of the grid: its own
 * dimensions (`rows`/`columns`) and its own buttons with their own slots,
 * actions and appearance. There is no inheritance, no base layer, no overrides
 * and no sharing between variants — if two variants agree on all but two
 * slots, those buttons are stored twice on purpose. Predictable, independently
 * editable variants beat normalized data.
 *
 * At runtime exactly one variant renders: the first (in array order) whose
 * trigger matches, else the fallback variant, else none (category hidden).
 * Variants are never merged.
 *
 * Fully JSON-serializable: no functions, no runtime references, no shared
 * object graphs.
 *
 * Since settings version 5 this is the RUNTIME VIEW shape (materialized from
 * StoredVariant + the tool registry) and the pre-v5 shape inside the
 * migration chain.
 */
export interface CategoryVariant extends GridDimensionFields, GridCellStyleFields {
    /** Stable id, independent of the name and of the variant's position. */
    id: string;
    /** User-facing name shown in the variant selector (e.g. "Source"). */
    name: string;
    /**
     * The variant's single trigger condition, same model as everywhere else.
     * Required on a normal variant; not evaluated on the fallback variant.
     * A structurally invalid trigger does NOT match, so one corrupt variant
     * can never shadow every variant below it; it is surfaced in the editor.
     * An absent trigger on a non-fallback variant also never matches — a
     * variant that should always win is expressed as `{ all: [] }`.
     */
    trigger?: ButtonCondition;
    /**
     * Exactly one variant of a category may be the fallback. It has no
     * trigger; it renders only when no triggered variant matches, and it is
     * always evaluated after ALL triggered variants regardless of its
     * position, so it can never shadow them by accident.
     */
    fallback?: boolean;
    /**
     * The complete grid of this variant: every button carries its own `slot`.
     * Never shares button objects with any other variant.
     */
    buttons: ButtonConfig[];
}

/**
 * CategoryConfig describes a category and the buttons it contains.
 *
 * Since settings version 5 this is the RUNTIME VIEW shape (materialized from
 * StoredCategory + the tool registry — see src/domain/tools.ts) and the
 * pre-v5 shape inside the migration chain. Renderers and drag state consume
 * this; write paths operate on StoredCategory and the registry.
 */
export interface CategoryConfig extends GridDimensionFields, GridCellStyleFields {
    /** Unique category id */
    id: string;
    /** Category name */
    name: string;
    /** Global sort value of the category */
    order: number;
    /**
     * Buttons of this category.
     * - flow category: all buttons, in `order` sequence (historical behavior);
     * - STATIC grid category (`layout: 'grid'`, no `variants`): the one full
     *   grid of the category — always the same buttons, no context behavior;
     * - DYNAMIC grid category (`variants` present): unused and kept empty —
     *   every button lives inside exactly one variant.
     */
    buttons: ButtonConfig[];
    /**
     * Variants of a DYNAMIC grid category, in priority order — the first
     * variant whose trigger matches wins and no others are applied; the
     * fallback variant (at most one) renders when nothing matches. Absent =
     * the category is static. Ignored by flow categories.
     *
     * Deliberately distinct from `conditions` below: variants decide WHICH
     * FULL GRID renders inside the category's stable container, `conditions`
     * decides whether the category is shown at all.
     */
    variants?: CategoryVariant[];
    /**
     * Optional declarative **palette visibility** condition (context
     * Engine), same model as ButtonConfig.conditions. Absent/undefined =
     * always visible. In locked mode a category is rendered only when this
     * condition holds AND at least one button is effectively visible; in
     * sort/edit mode the category stays rendered and manageable (visually
     * marked).
     *
     * This is NOT the variant mechanism: variants choose which grid renders
     * inside a visible dynamic category. Use this field only to hide a whole
     * category.
     */
    conditions?: ButtonCondition;
    /**
     * Button layout of this category.
     * - absent / 'flow': historical behavior — buttons render in `order`
     *   sequence and reflow whenever one is added, removed or context-hidden;
     * - 'grid': the palette with stable slots (see `rows`/`columns`), where a
     *   hidden or removed button leaves its slot empty and nothing else moves.
     * Optional additive field: categories without it keep behaving exactly as
     * before, so no settingsVersion bump / migration step is required.
     * See src/utils/categoryGrid.ts for the slot semantics.
     */
    layout?: 'flow' | 'grid';
    // `rows` / `columns` (GridDimensionFields) size the STATIC grid of this
    // category. A DYNAMIC category ignores them: every variant carries the
    // dimensions of its own grid.
}

/**
 * Interaction mode of the whole panel — exactly two states, toggled by the
 * lock button in the navigation bar.
 *
 * - 'locked': normal use. No drag and drop, no edit controls, no context
 *   menus; context rules are applied (hidden elements are really hidden).
 * - 'edit': one management mode. Drag and drop, right-click menus, add/create
 *   controls and the variant selector are all active, and elements hidden by
 *   their context rules stay visible and manageable.
 *
 * The former separate 'sort' mode was merged into 'edit' (settings version 4).
 */
export type InteractionMode = 'locked' | 'edit';

/**
 * PanelConfig holds the panel-wide display and layout settings.
 */
export interface PanelConfig {
    /** Button layout (icon_left: icon left of the label, icon_top: icon above the label) */
    displayStyle: 'icon_left' | 'icon_top';
    /** Panel view type (list / tabs / folder) */
    panelViewType: 'list' | 'tabs' | 'folder';
    /** Whether button animations are enabled */
    enableAnimation?: boolean;
    /** Whether hovering a button shows its full name as a tooltip */
    showButtonTooltip?: boolean;
    /** Interaction mode: 'locked' (normal use) or 'edit' (manage everything). */
    interactionMode?: InteractionMode;
    /** Whether the top navigation bar is shown */
    showTopNavBar?: boolean;
    /** Whether the tab bar wraps onto multiple rows */
    tabsWrap?: boolean;
    /** List view: collapse all categories every time the list view opens */
    listAutoCollapse?: boolean;
    /** Folder view: whether the name of an expanded folder is editable */
    folderDetailNameEditable?: boolean;
    /** Folder view: whether the button count is shown */
    folderShowBtnCount?: boolean;
    /** Folder view: close the expanded folder when clicking empty space */
    folderCloseOnBlankClick?: boolean;
}

/**
 * PathConfig holds the template and script folder paths.
 */
export interface PathConfig {
    /** Template folder path */
    templateFolderPath?: string;
    /** Script folder path */
    scriptFolderPath?: string;
}

/**
 * ButtonsPanelPluginSettings is the plugin-wide persisted settings shape.
 */
export interface ButtonsPanelPluginSettings {
    /**
     * Settings schema version (see CURRENT_SETTINGS_VERSION).
     * Data without this field is treated as version 0 (unversioned upstream
     * data) and migrated by src/settings/settingsMigrations.ts.
     */
    settingsVersion: number;
    /**
     * The tool registry (since v5): every tool of the vault, keyed by id.
     * Placements reference into this; nothing else stores tool data.
     */
    tools: ToolRegistry;
    /** Categories (stored v5 shape; the runtime view is materialized from it) */
    categories: StoredCategory[];
    /** Panel settings */
    panelConfig: PanelConfig;
    /** Path settings */
    pathConfig: PathConfig;
}

/**
 * DEFAULT_SETTINGS is the configuration a fresh install starts from.
 */
export const DEFAULT_SETTINGS: ButtonsPanelPluginSettings = {
    settingsVersion: CURRENT_SETTINGS_VERSION,
    tools: {},
    categories: [],
    panelConfig: {
        displayStyle: 'icon_top',
        panelViewType: 'list',
        enableAnimation: false,
        showButtonTooltip: true,
        interactionMode: 'edit',
        showTopNavBar: true,
        tabsWrap: false,
        listAutoCollapse: false,
        folderDetailNameEditable: true,
        folderShowBtnCount: true,
        folderCloseOnBlankClick: false,
    },
    pathConfig: {
        templateFolderPath: 'templates/',
        scriptFolderPath: 'scripts/',
    },
};
