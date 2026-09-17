// settingsMigrations.ts
// Deterministic settings migration pipeline for OCAP.
//
// Loading strategy (see docs/ocap/DECISIONS.md):
// - data without a settingsVersion field is version 0 (upstream Buttons Panel
//   data) and runs through the migration chain 0 -> 1 -> ... -> CURRENT;
// - data at the current version is only normalized in memory (missing optional
//   nested fields are filled with defaults) and never rewritten on disk;
// - data from an UNKNOWN FUTURE version is never downgraded or rewritten: it is
//   loaded best-effort (defaults merged underneath, unknown keys preserved) and
//   the higher settingsVersion is kept so a newer plugin version can still
//   migrate it correctly later.

import {
    ButtonConfig,
    ButtonsPanelPluginSettings,
    CategoryConfig,
    CategoryVariant,
    CURRENT_SETTINGS_VERSION,
    DEFAULT_SETTINGS,
} from '@/types/settings';
import type { ButtonCondition } from '@/types/conditions';
import { placeButtonsOnGrid } from '@/utils/categoryGrid';
import {
    composeFallbackVariant,
    composeFullVariant,
    liftButtonConditions,
} from '@/utils/categoryVariants';

/** How the raw persisted data was handled by migrateSettings. */
export type MigrationStatus =
    /** No stored data: fresh defaults. */
    | 'defaults'
    /** Data already at the current version (normalized in memory only). */
    | 'current'
    /** Data from an older version, migrated through the pipeline. */
    | 'migrated'
    /** Data from an unknown future version, loaded best-effort, not rewritten. */
    | 'future';

export interface MigrationResult {
    settings: ButtonsPanelPluginSettings;
    /** True if the migrated data should be persisted (only for status 'migrated'). */
    changed: boolean;
    status: MigrationStatus;
    /** Version found in the stored data (0 = unversioned). */
    fromVersion: number;
}

/**
 * One migration step from schema version `from` to `from + 1`.
 * Steps must be deterministic and must not mutate their input.
 */
interface MigrationStep {
    from: number;
    apply(data: Record<string, unknown>): Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read the stored schema version; unversioned/invalid data is version 0. */
function readStoredVersion(raw: Record<string, unknown>): number {
    const v = raw['settingsVersion'];
    return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 0;
}

/** Deep-cloned default settings (DEFAULT_SETTINGS itself must never be shared mutably). */
function cloneDefaults(): ButtonsPanelPluginSettings {
    return {
        ...DEFAULT_SETTINGS,
        categories: [],
        panelConfig: { ...DEFAULT_SETTINGS.panelConfig },
        pathConfig: { ...DEFAULT_SETTINGS.pathConfig },
    };
}

/**
 * Conservative category sanitization: keep the user's array as-is if it is an
 * array (never drop or rewrite user buttons), fall back to [] otherwise.
 */
function sanitizeCategories(value: unknown): CategoryConfig[] {
    return Array.isArray(value) ? (value as CategoryConfig[]) : [];
}

/**
 * Normalize a raw settings object against the current defaults without losing
 * data: unknown top-level keys are preserved, nested config objects are
 * deep-merged over the defaults (fixes the upstream shallow-merge gap where
 * new nested defaults were lost for old data).
 */
function normalizeSettings(raw: Record<string, unknown>): Record<string, unknown> {
    return {
        ...raw,
        categories: sanitizeCategories(raw['categories']),
        panelConfig: {
            ...DEFAULT_SETTINGS.panelConfig,
            ...(isRecord(raw['panelConfig']) ? raw['panelConfig'] : {}),
        },
        pathConfig: {
            ...DEFAULT_SETTINGS.pathConfig,
            ...(isRecord(raw['pathConfig']) ? raw['pathConfig'] : {}),
        },
    };
}

/**
 * 0 -> 1: adopt unversioned upstream Buttons Panel data.
 * Structurally the v1 schema is a superset of the upstream schema (new
 * optional fields only), so the step normalizes nested defaults and stamps
 * the version. Existing categories/buttons are preserved untouched.
 */
function migrateV0toV1(data: Record<string, unknown>): Record<string, unknown> {
    return {
        ...normalizeSettings(data),
        settingsVersion: 1,
    };
}

function withNormalizedOrder(buttons: ButtonConfig[]): ButtonConfig[] {
    return buttons.map((button, index) => ({ ...button, order: index }));
}

// --- Version 2 (legacy palette context layers) --------------------------------
//
// Version 2 modelled a grid category as a layered palette: `buttons` was the
// base/pinned layer and `contextProfiles` carried named alternative layers.
// Version 3 retires that model, but the migration CHAIN still passes through
// it, so the v2 shape lives on here as a purely internal representation.

/** The persisted shape of a v2 context profile (legacy, migration-only). */
interface LegacyContextProfile {
    id: string;
    name: string;
    conditions?: ButtonCondition;
    buttons: ButtonConfig[];
}

/**
 * 1 -> 2 for ONE grid category: lift per-button conditions into context
 * profiles.
 *
 * Version 1 let every grid button carry its own condition. Version 2 grouped
 * buttons sharing the same valid condition into ONE profile (per-button copy
 * dropped), kept condition-free and invalid-condition buttons in the base
 * layer, and materialized the current arrangement first so nothing moves.
 */
function migrateGridCategoryToLayers(
    category: Record<string, unknown>
): Record<string, unknown> {
    const rawButtons = Array.isArray(category['buttons'])
        ? (category['buttons'] as ButtonConfig[])
        : [];
    if (rawButtons.length === 0) {
        return category;
    }

    // Freeze the arrangement the user currently sees before splitting layers,
    // so materializing missing/duplicate slots cannot move anything.
    const placement = placeButtonsOnGrid(rawButtons);
    const positioned: ButtonConfig[] = [];
    placement.slots.forEach((button, slot) => {
        if (button) positioned.push({ ...button, slot });
    });
    positioned.push(...placement.overflow.map((button) => ({ ...button })));

    const categoryId = typeof category['id'] === 'string' ? category['id'] : 'category';
    const { base, groups } = liftButtonConditions(positioned);

    if (groups.length === 0) {
        return { ...category, buttons: withNormalizedOrder(positioned) };
    }

    const profiles: LegacyContextProfile[] = groups.map((group, index) => ({
        id: `${categoryId}-ctx-${index + 1}`,
        name: group.name,
        conditions: group.condition,
        buttons: group.buttons,
    }));

    const existing = Array.isArray(category['contextProfiles'])
        ? (category['contextProfiles'] as LegacyContextProfile[])
        : [];

    return {
        ...category,
        buttons: base,
        contextProfiles: [...existing, ...profiles],
    };
}

/**
 * 1 -> 2: palette context layers (legacy step, kept so the chain stays
 * forward-only). Only `layout: 'grid'` categories are transformed; flow
 * categories and every other setting are passed through untouched.
 */
function migrateV1toV2(data: Record<string, unknown>): Record<string, unknown> {
    const categories = Array.isArray(data['categories'])
        ? (data['categories'] as unknown[])
        : [];

    let anyChanged = false;
    const migrated = categories.map((category) => {
        if (!isRecord(category) || category['layout'] !== 'grid') {
            return category;
        }
        const next = migrateGridCategoryToLayers(category);
        if (next !== category) {
            anyChanged = true;
        }
        return next;
    });

    return {
        ...data,
        // Keep the original array when no palette needed transforming, so
        // untouched data really stays untouched (identity included).
        categories: anyChanged ? migrated : (data['categories'] ?? categories),
        settingsVersion: 2,
    };
}

// --- Version 3 (dynamic category variants) ------------------------------------

/**
 * The v2 runtime only considered profiles with this exact shape; malformed
 * entries were filtered out and never rendered. The migration mirrors that
 * rule so a profile that was dead data in v2 cannot suddenly become an active
 * (or always-matching) variant in v3.
 */
function readLegacyProfiles(category: Record<string, unknown>): LegacyContextProfile[] {
    const raw = category['contextProfiles'];
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.filter(
        (profile): profile is LegacyContextProfile =>
            typeof profile === 'object' &&
            profile !== null &&
            typeof (profile as LegacyContextProfile).id === 'string' &&
            Array.isArray((profile as LegacyContextProfile).buttons)
    );
}

/**
 * 2 -> 3 for ONE layered grid category: compose full variants.
 *
 * Every v2 context profile becomes one COMPLETE variant that reproduces the
 * old effective runtime grid of that profile: the base/pinned buttons on their
 * exact slots plus the profile's buttons on the slots the base left free.
 * Base copies get deterministic derived ids (`<profileId>--<buttonId>`) so
 * every button id stays unique across variants; the profile's own buttons
 * keep their ids (they exist in exactly one variant).
 *
 * - profile order -> variant priority (unchanged);
 * - a profile's condition -> the variant's trigger;
 * - a profile WITHOUT a condition always matched in v2, so it gets the
 *   explicit always-true trigger `{ all: [] }` — same priority behavior,
 *   nothing hidden;
 * - the base-only state (what v2 rendered when no profile matched) becomes
 *   the fallback variant "Default", so the old runtime semantics survive
 *   exactly. Deliberate redundancy, zero data loss.
 *
 * A grid category without profiles stays a STATIC grid and is not touched.
 */
function migrateLayeredCategoryToVariants(
    category: Record<string, unknown>
): Record<string, unknown> {
    const profiles = readLegacyProfiles(category);
    if (profiles.length === 0) {
        // No layers: a static grid. Only drop a malformed/empty
        // contextProfiles field if one exists.
        if (category['contextProfiles'] === undefined) {
            return category;
        }
        const { contextProfiles: _dropped, ...rest } = category;
        return rest;
    }

    const base = Array.isArray(category['buttons'])
        ? (category['buttons'] as ButtonConfig[])
        : [];
    const categoryId = typeof category['id'] === 'string' ? category['id'] : 'category';

    const variants: CategoryVariant[] = profiles.map((profile) =>
        composeFullVariant(
            base,
            profile.buttons,
            profile.id,
            typeof profile.name === 'string' && profile.name.length > 0
                ? profile.name
                : profile.id,
            profile.conditions ?? { all: [] }
        )
    );
    if (base.length > 0) {
        variants.push(composeFallbackVariant(base, `${categoryId}-fallback`));
    }

    const { contextProfiles: _profiles, ...rest } = category;
    return { ...rest, buttons: [], variants };
}

/**
 * 2 -> 3: dynamic category variants. Only grid categories carrying context
 * profiles are transformed; static grids, flow categories and every other
 * setting pass through untouched.
 */
function migrateV2toV3(data: Record<string, unknown>): Record<string, unknown> {
    const categories = Array.isArray(data['categories'])
        ? (data['categories'] as unknown[])
        : [];

    let anyChanged = false;
    const migrated = categories.map((category) => {
        if (!isRecord(category) || category['layout'] !== 'grid') {
            return category;
        }
        const next = migrateLayeredCategoryToVariants(category);
        if (next !== category) {
            anyChanged = true;
        }
        return next;
    });

    return {
        ...data,
        categories: anyChanged ? migrated : (data['categories'] ?? categories),
        settingsVersion: 3,
    };
}

const MIGRATION_STEPS: readonly MigrationStep[] = [
    { from: 0, apply: migrateV0toV1 },
    { from: 1, apply: migrateV1toV2 },
    { from: 2, apply: migrateV2toV3 },
];

/**
 * Migrate raw persisted plugin data to the current settings schema.
 * Pure and deterministic: never mutates `raw`, never touches disk.
 */
export function migrateSettings(raw: unknown): MigrationResult {
    if (!isRecord(raw)) {
        return {
            settings: cloneDefaults(),
            changed: false,
            status: 'defaults',
            fromVersion: 0,
        };
    }

    const fromVersion = readStoredVersion(raw);

    if (fromVersion > CURRENT_SETTINGS_VERSION) {
        // Unknown future schema: load best-effort, keep the higher version so
        // it is never silently downgraded, and signal not to persist.
        const settings = normalizeSettings(raw) as unknown as ButtonsPanelPluginSettings;
        return { settings, changed: false, status: 'future', fromVersion };
    }

    if (fromVersion === CURRENT_SETTINGS_VERSION) {
        const settings = normalizeSettings(raw) as unknown as ButtonsPanelPluginSettings;
        return { settings, changed: false, status: 'current', fromVersion };
    }

    let data: Record<string, unknown> = raw;
    let version = fromVersion;
    while (version < CURRENT_SETTINGS_VERSION) {
        const step = MIGRATION_STEPS.find((s) => s.from === version);
        if (!step) {
            // A gap in the chain is a programming error; fail safe by
            // normalizing at the current version instead of corrupting data.
            console.error(`[OCAP] Missing settings migration step from version ${version}`);
            data = { ...normalizeSettings(data), settingsVersion: CURRENT_SETTINGS_VERSION };
            break;
        }
        data = step.apply(data);
        version += 1;
    }

    return {
        // Normalize once at the end of the chain, exactly like the 'current'
        // branch does: a migrated document must also receive nested defaults
        // that were added since it was written, and normalizing here keeps
        // migrateSettings idempotent over its own output.
        settings: normalizeSettings(data) as unknown as ButtonsPanelPluginSettings,
        changed: true,
        status: 'migrated',
        fromVersion,
    };
}
