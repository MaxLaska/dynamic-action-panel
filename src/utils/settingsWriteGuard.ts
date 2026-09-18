// settingsWriteGuard.ts
// The one rule that keeps an older build from destroying a newer build's
// configuration:
//
//   A CONFIGURATION FROM A NEWER SCHEMA IS READ-ONLY.
//
// The migration pipeline has always recognised the case — a stored
// `settingsVersion` above the one this build knows comes back as
// `status: 'future'` — and has always declined to migrate it, precisely so it
// would not be downgraded. What was missing was the second half: the decision
// not to write it was taken at load and then forgotten, so the next ordinary
// save wrote anyway.
//
// Why writing is worse than it looks. `normalizeSettings` produces a view, not
// a copy: it keeps unknown top-level keys, but forces `tools` to a record and
// `categories` to an array, so a future schema that stores either differently
// has already been reduced by the time it reaches memory. Writing that view
// back would persist the reduction AND keep the higher `settingsVersion`, so no
// later build would recognise the file as damaged or repair it. The loss would
// be silent and permanent.
//
// The deliberate non-goal: there is no downgrade path. Nothing here guesses at
// unknown fields, converts future tools, or lowers a version number. Read what
// can be read, refuse to write, say so.

import { Notice } from 'obsidian';
import { CURRENT_SETTINGS_VERSION } from '@/types/settings';
import type { MigrationResult } from '@/settings/settingsMigrations';
import type { ButtonsPanelPlugin } from '@/types/plugin';
import { t, tWithParams } from '@/utils/i18n';

/**
 * Why settings are read-only.
 *
 * `storedVersion` is null when the file carries a `settingsVersion` that is not
 * a usable version number at all — a string, a float, `Infinity`. That is a
 * different situation from "newer than us" and deserves a different
 * explanation, but the same refusal: in both cases this build cannot say what
 * the document means, and writing over something you cannot read is the one
 * move with no recovery.
 */
export interface FutureSettingsBlock {
    storedVersion: number | null;
    supportedVersion: number;
}

/**
 * The state the guard keeps. It lives on the plugin INSTANCE rather than in
 * module scope, which is the whole reason a reload or a disable/enable clears
 * it: module state would outlive the instance and could leave a vault
 * read-only after the user updated the plugin.
 */
interface GuardState {
    futureSettings?: FutureSettingsBlock | null;
    settingsWriteRefusalNotified?: boolean;
}

/** The block currently in force, or null when settings are writable. */
export function futureSettingsBlock(plugin: ButtonsPanelPlugin): FutureSettingsBlock | null {
    return (plugin as ButtonsPanelPlugin & GuardState).futureSettings ?? null;
}

/**
 * Records what loading found, and tells the caller whether to persist.
 *
 * Called once per load with the migration result, so the block always describes
 * the file that is actually open: opening a supported configuration clears it,
 * which is what makes the protection follow the data rather than the session.
 *
 * Returns whether the loaded result should be written back — true only for a
 * document this build genuinely migrated, exactly as before.
 */
export function noteLoadedSettings(
    plugin: ButtonsPanelPlugin,
    result: MigrationResult
): boolean {
    const state = plugin as ButtonsPanelPlugin & GuardState;
    const previous = state.futureSettings ?? null;

    if (result.status !== 'future' && result.status !== 'unreadable') {
        // Clearing matters as much as setting: the settings are re-read every
        // time the panel opens, so a file that has been brought back into a
        // supported version must become writable again without a reload.
        state.futureSettings = null;
        state.settingsWriteRefusalNotified = false;
        return result.changed;
    }

    const storedVersion = result.status === 'future' ? result.fromVersion : null;
    state.futureSettings = {
        storedVersion,
        supportedVersion: CURRENT_SETTINGS_VERSION,
    };

    // Only when the block is NEW. `loadSettings` runs on every panel open, not
    // just at startup, so announcing it unconditionally would greet the user
    // every single time they opened the panel.
    if (previous !== null && previous.storedVersion === storedVersion) {
        return false;
    }
    state.settingsWriteRefusalNotified = false;

    console.warn(
        storedVersion === null
            ? '[Dynamic Action Panel] Stored settings carry a settingsVersion this build ' +
                  'cannot interpret. Loading read-only; no settings will be written.'
            : `[Dynamic Action Panel] Stored settings use schema version ${storedVersion}, ` +
                  `newer than the ${CURRENT_SETTINGS_VERSION} this build supports. ` +
                  'Loading read-only; no settings will be written.'
    );
    // The user needs to know before they start editing, not after.
    new Notice(
        storedVersion === null
            ? t('settings_unreadable_readonly')
            : tWithParams('settings_future_readonly', {
                  stored: storedVersion,
                  supported: CURRENT_SETTINGS_VERSION,
              }),
        10000
    );
    return false;
}

/**
 * Whether a change may be made and persisted, explaining once if it may not.
 *
 * The explanation fires on the FIRST refused change and then not again for the
 * life of this plugin instance. A notice per attempt would be noise — a drag
 * alone can produce several — and the startup warning has already said it. Pass
 * `silent` where the answer only steers UI and no user action was taken.
 */
export function canMutateSettings(
    plugin: ButtonsPanelPlugin,
    options: { silent?: boolean } = {}
): boolean {
    const block = futureSettingsBlock(plugin);
    if (!block) {
        return true;
    }
    const state = plugin as ButtonsPanelPlugin & GuardState;
    if (!options.silent && !state.settingsWriteRefusalNotified) {
        state.settingsWriteRefusalNotified = true;
        new Notice(t('settings_future_blocked'), 8000);
    }
    return false;
}

/**
 * THE write. Every path that persists settings ends here, and this is the only
 * place in the plugin that hands the settings object to `saveData`.
 *
 * Returns whether anything was written, so a caller can avoid reporting success
 * for a write that did not happen.
 */
export async function persistSettings(plugin: ButtonsPanelPlugin): Promise<boolean> {
    if (!canMutateSettings(plugin)) {
        return false;
    }
    await plugin.saveData(plugin.settings);
    return true;
}
