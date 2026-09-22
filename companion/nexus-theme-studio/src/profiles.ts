// profiles.ts
// The profile model, with no DOM and no Obsidian in sight.
//
// A profile is a NAMED SET OF OVERRIDES on the Nexus theme — not a theme of its
// own. That is the whole architectural point: Nexus is a real, selectable
// Obsidian theme with real defaults, and a profile is a variation the user is
// trying out on top of it. Baking a profile into its own theme directory would
// have meant maintaining N copies of the theme and re-baking all of them every
// time a rule changed, to buy nothing the override layer does not already give.
//
// Every function here takes settings and returns NEW settings. Nothing mutates
// its argument, because the plugin persists what it gets back and a half-applied
// in-place edit is exactly the state that survives a crash.

import { sanitizeOverrides, type TokenOverrides } from './overrides';

/** The persisted shape's version, for any future migration. */
export const SETTINGS_VERSION = 1;

/**
 * The built-in baseline profile.
 *
 * It is LOCKED: it cannot be renamed, deleted, or given an override. That is
 * what makes it a safe place to come back to — "switch to Standard" has to mean
 * "the theme as its author left it", and a Standard the user can edit stops
 * meaning that after the first slider. Editing starts from a duplicate.
 */
export const STANDARD_PROFILE_ID = 'standard';
export const STANDARD_PROFILE_NAME = 'Standard';

/** The editable profile a fresh install starts in, so the first edit works. */
export const FIRST_PROFILE_ID = 'custom';
export const FIRST_PROFILE_NAME = 'Custom';

/** The longest profile name accepted; long enough to be descriptive. */
export const MAX_NAME_LENGTH = 60;

export interface NexusProfile {
    id: string;
    name: string;
    overrides: TokenOverrides;
    /**
     * Free CSS applied to the host document while `scratchEnabled` is on.
     *
     * A development tool, stored separately from tokens on purpose: a token is
     * part of the theme's language, and this is a note stuck to the side of it.
     * See `runtime.ts` for what applying it means.
     */
    scratchCss: string;
    scratchEnabled: boolean;
}

export interface NexusStudioSettings {
    version: number;
    activeProfileId: string;
    profiles: NexusProfile[];
    /**
     * Groups the user has folded shut in the editor, by group key.
     *
     * Deliberately at the top level and NOT inside a profile: which sections you
     * have folded is a property of how you are working right now, not of the
     * palette you are working on. Switching profile to compare two greys should
     * not also reshuffle the shape of the page.
     *
     * It is stored at all because the alternative — forgetting on every close —
     * is exactly the annoyance collapsing was added to remove. One array of
     * strings is the whole cost; there is no new persistence machinery here.
     */
    collapsedGroups: string[];
}

function standardProfile(): NexusProfile {
    return {
        id: STANDARD_PROFILE_ID,
        name: STANDARD_PROFILE_NAME,
        overrides: {},
        scratchCss: '',
        scratchEnabled: false,
    };
}

/** The state a fresh install starts in: the locked baseline, and one to edit. */
export function defaultSettings(): NexusStudioSettings {
    return {
        version: SETTINGS_VERSION,
        activeProfileId: FIRST_PROFILE_ID,
        // Everything open to begin with: a user who has never seen the editor
        // should see what it offers, not a row of closed drawers.
        collapsedGroups: [],
        profiles: [
            standardProfile(),
            {
                id: FIRST_PROFILE_ID,
                name: FIRST_PROFILE_NAME,
                overrides: {},
                scratchCss: '',
                scratchEnabled: false,
            },
        ],
    };
}

/** Whether a profile is the locked baseline. */
export function isLocked(profile: NexusProfile | null | undefined): boolean {
    return profile?.id === STANDARD_PROFILE_ID;
}

/** A name that can be stored, or null when it is not a usable name at all. */
export function normalizeName(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim().replace(/\s+/g, ' ');
    if (trimmed.length === 0) return null;
    return trimmed.slice(0, MAX_NAME_LENGTH);
}

function normalizeProfile(raw: unknown, fallbackId: string): NexusProfile | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : fallbackId;
    const name = normalizeName(record.name) ?? id;
    const scratchCss = typeof record.scratchCss === 'string' ? record.scratchCss : '';
    return {
        id,
        name,
        overrides: sanitizeOverrides(record.overrides),
        scratchCss,
        scratchEnabled: record.scratchEnabled === true,
    };
}

/**
 * Reads settings that came off disk.
 *
 * `loadData` returns null on first run and whatever a hand-edit left behind
 * after that, so every field is checked rather than cast. Three invariants are
 * restored rather than asserted, because a file that violates one of them is
 * still a file the user has to be able to open Obsidian with:
 *
 *   - Standard always exists, is always first, and is always empty;
 *   - ids are unique, so "the active profile" resolves to one profile;
 *   - the active id names a profile that is actually in the list.
 */
export function normalizeSettings(raw: unknown): NexusStudioSettings {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultSettings();
    const record = raw as Record<string, unknown>;

    const rawProfiles = Array.isArray(record.profiles) ? record.profiles : [];
    const seen = new Set<string>([STANDARD_PROFILE_ID]);
    const profiles: NexusProfile[] = [standardProfile()];

    rawProfiles.forEach((entry, index) => {
        const profile = normalizeProfile(entry, `profile-${index + 1}`);
        if (!profile) return;
        // Standard is rebuilt above from the constant, never read from the
        // file: a stored Standard carrying overrides would quietly stop being
        // the baseline it is the only reason to have.
        if (profile.id === STANDARD_PROFILE_ID) return;
        if (seen.has(profile.id)) return;
        seen.add(profile.id);
        profiles.push(profile);
    });

    if (profiles.length === 1) {
        profiles.push({
            id: FIRST_PROFILE_ID,
            name: FIRST_PROFILE_NAME,
            overrides: {},
            scratchCss: '',
            scratchEnabled: false,
        });
    }

    const wanted = typeof record.activeProfileId === 'string' ? record.activeProfileId : '';
    const activeProfileId = profiles.some((profile) => profile.id === wanted)
        ? wanted
        : (profiles[1]?.id ?? STANDARD_PROFILE_ID);

    const collapsedGroups = Array.isArray(record.collapsedGroups)
        ? record.collapsedGroups.filter((group): group is string => typeof group === 'string')
        : [];

    return { version: SETTINGS_VERSION, activeProfileId, profiles, collapsedGroups };
}

/** The profile currently being edited; never null, because Standard is always there. */
export function activeProfile(settings: NexusStudioSettings): NexusProfile {
    return (
        settings.profiles.find((profile) => profile.id === settings.activeProfileId) ??
        settings.profiles[0] ??
        standardProfile()
    );
}

/**
 * A free id, derived from the list rather than from a clock or a random source.
 *
 * Deterministic on purpose: these ids end up in a file the user may read, and a
 * test that cannot predict them has to match on shape instead of on value.
 */
export function nextProfileId(settings: NexusStudioSettings): string {
    const taken = new Set(settings.profiles.map((profile) => profile.id));
    for (let index = 1; ; index += 1) {
        const candidate = `profile-${index}`;
        if (!taken.has(candidate)) return candidate;
    }
}

/** A name not already in use, by appending a counter the way a file manager would. */
export function uniqueName(settings: NexusStudioSettings, wanted: string): string {
    const taken = new Set(settings.profiles.map((profile) => profile.name));
    if (!taken.has(wanted)) return wanted;
    for (let index = 2; ; index += 1) {
        const candidate = `${wanted} ${index}`;
        if (!taken.has(candidate)) return candidate;
    }
}

function withProfiles(
    settings: NexusStudioSettings,
    profiles: NexusProfile[],
    activeProfileId = settings.activeProfileId
): NexusStudioSettings {
    return {
        version: SETTINGS_VERSION,
        activeProfileId,
        profiles,
        // Carried through every profile operation. A rename is not a reason to
        // unfold the page.
        collapsedGroups: [...settings.collapsedGroups],
    };
}

/** Adds an empty profile and makes it active, because creating one is wanting it. */
export function createProfile(
    settings: NexusStudioSettings,
    name: string
): NexusStudioSettings {
    const id = nextProfileId(settings);
    const profile: NexusProfile = {
        id,
        name: uniqueName(settings, normalizeName(name) ?? 'Profile'),
        overrides: {},
        scratchCss: '',
        scratchEnabled: false,
    };
    return withProfiles(settings, [...settings.profiles, profile], id);
}

/**
 * Copies a profile, including its scratch CSS, and makes the copy active.
 *
 * Duplicating Standard is allowed and is in fact the intended way to start
 * editing: it produces an empty, unlocked profile that renders exactly like the
 * theme's defaults.
 */
export function duplicateProfile(
    settings: NexusStudioSettings,
    sourceId: string,
    name?: string
): NexusStudioSettings {
    const source = settings.profiles.find((profile) => profile.id === sourceId);
    if (!source) return settings;
    const id = nextProfileId(settings);
    const profile: NexusProfile = {
        id,
        name: uniqueName(settings, normalizeName(name) ?? `${source.name} copy`),
        overrides: { ...source.overrides },
        scratchCss: source.scratchCss,
        scratchEnabled: source.scratchEnabled,
    };
    return withProfiles(settings, [...settings.profiles, profile], id);
}

/** Renames a profile. Standard keeps its name, and an unusable name is refused. */
export function renameProfile(
    settings: NexusStudioSettings,
    id: string,
    name: string
): NexusStudioSettings {
    if (id === STANDARD_PROFILE_ID) return settings;
    const normalized = normalizeName(name);
    if (!normalized) return settings;
    if (!settings.profiles.some((profile) => profile.id === id)) return settings;
    const without = { ...settings, profiles: settings.profiles.filter((p) => p.id !== id) };
    const unique = uniqueName(without, normalized);
    return withProfiles(
        settings,
        settings.profiles.map((profile) =>
            profile.id === id ? { ...profile, name: unique } : profile
        )
    );
}

/**
 * Deletes a profile.
 *
 * Standard is refused, and deleting the active profile falls back to Standard —
 * the baseline, never an arbitrary neighbour, so the workspace after a delete
 * is a state the user recognises.
 */
export function deleteProfile(settings: NexusStudioSettings, id: string): NexusStudioSettings {
    if (id === STANDARD_PROFILE_ID) return settings;
    if (!settings.profiles.some((profile) => profile.id === id)) return settings;
    const profiles = settings.profiles.filter((profile) => profile.id !== id);
    const activeProfileId =
        settings.activeProfileId === id ? STANDARD_PROFILE_ID : settings.activeProfileId;
    return withProfiles(settings, profiles, activeProfileId);
}

/** Switches profile. An unknown id changes nothing. */
export function setActiveProfile(
    settings: NexusStudioSettings,
    id: string
): NexusStudioSettings {
    if (!settings.profiles.some((profile) => profile.id === id)) return settings;
    return withProfiles(settings, settings.profiles, id);
}

/**
 * Sets or clears one token override on one profile.
 *
 * `null` clears, and so does an invalid value — clearing means "fall back to
 * the theme", which is always a defined state. Standard is refused, which is
 * the single rule that keeps the baseline a baseline.
 */
export function setOverride(
    settings: NexusStudioSettings,
    id: string,
    key: string,
    value: string | null
): NexusStudioSettings {
    if (id === STANDARD_PROFILE_ID) return settings;
    return withProfiles(
        settings,
        settings.profiles.map((profile) => {
            if (profile.id !== id) return profile;
            const next = { ...profile.overrides };
            if (value === null) delete next[key];
            else next[key] = value;
            return { ...profile, overrides: sanitizeOverrides(next) };
        })
    );
}

/** Sets a profile's scratch CSS and whether it is applied. */
export function setScratch(
    settings: NexusStudioSettings,
    id: string,
    patch: { css?: string; enabled?: boolean }
): NexusStudioSettings {
    if (id === STANDARD_PROFILE_ID) return settings;
    return withProfiles(
        settings,
        settings.profiles.map((profile) =>
            profile.id === id
                ? {
                      ...profile,
                      scratchCss: patch.css ?? profile.scratchCss,
                      scratchEnabled: patch.enabled ?? profile.scratchEnabled,
                  }
                : profile
        )
    );
}

/**
 * Returns a profile to the theme's defaults.
 *
 * It clears the profile's OWN overrides and its scratch CSS, and touches
 * nothing else: not the theme's files, not another profile, not another plugin.
 * "Reset" here means "forget what I changed", which is why it is safe to press.
 */
export function resetProfile(settings: NexusStudioSettings, id: string): NexusStudioSettings {
    if (id === STANDARD_PROFILE_ID) return settings;
    return withProfiles(
        settings,
        settings.profiles.map((profile) =>
            profile.id === id
                ? { ...profile, overrides: {}, scratchCss: '', scratchEnabled: false }
                : profile
        )
    );
}

/** Whether a group is currently folded shut. */
export function isGroupCollapsed(settings: NexusStudioSettings, group: string): boolean {
    return settings.collapsedGroups.includes(group);
}

/**
 * Folds a group shut or opens it.
 *
 * Collapsing hides controls and touches no value: a folded group's tokens keep
 * their overrides, keep being applied, and come back unchanged when it opens.
 */
export function setGroupCollapsed(
    settings: NexusStudioSettings,
    group: string,
    collapsed: boolean
): NexusStudioSettings {
    const without = settings.collapsedGroups.filter((entry) => entry !== group);
    return {
        ...settings,
        profiles: settings.profiles,
        collapsedGroups: collapsed ? [...without, group] : without,
    };
}
