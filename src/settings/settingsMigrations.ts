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
    ContextProfile,
    CURRENT_SETTINGS_VERSION,
    DEFAULT_SETTINGS,
} from '@/types/settings';
import { placeButtonsOnGrid } from '@/utils/categoryGrid';
import { liftButtonConditionsToProfiles } from '@/utils/paletteLayers';

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

/**
 * 1 -> 2 for ONE grid category: lift per-button conditions into context
 * profiles.
 *
 * Version 1 let every grid button carry its own condition, which meant five
 * tools belonging to the same context needed five independent rules and two
 * unrelated context systems (button conditions and, from now on, profiles)
 * could drive the same slots. Version 2 models palette contextuality with
 * context profiles only.
 *
 * The split rule itself lives in liftButtonConditionsToProfiles
 * (src/utils/paletteLayers.ts) so the flow -> palette conversion produces
 * exactly the same shape. Nothing is dropped, and slots are preserved exactly.
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
    const { base, profiles } = liftButtonConditionsToProfiles(positioned, categoryId);

    if (profiles.length === 0) {
        return { ...category, buttons: withNormalizedOrder(positioned) };
    }

    const existing = Array.isArray(category['contextProfiles'])
        ? (category['contextProfiles'] as ContextProfile[])
        : [];

    return {
        ...category,
        buttons: base,
        contextProfiles: [...existing, ...profiles],
    };
}

/**
 * 1 -> 2: palette context layers.
 * Only `layout: 'grid'` categories are transformed; flow categories (including
 * their per-button conditions, which keep working exactly as before) and every
 * other setting are passed through untouched.
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

const MIGRATION_STEPS: readonly MigrationStep[] = [
    { from: 0, apply: migrateV0toV1 },
    { from: 1, apply: migrateV1toV2 },
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
