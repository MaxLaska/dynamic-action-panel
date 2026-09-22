// nexusBridge.ts
// The one place where a Nexus token crosses into the reader's iframe.
//
// WHY THERE HAS TO BE ONE. Obsidian loads a theme into its own document. The
// reader ZotFlow embeds is a blob iframe with its own document, its own root
// element and its own custom properties, and CSS custom properties do not cross
// a frame boundary in either direction. So a theme — any theme — stops at the
// edge of that frame. Something has to carry the values across, and this is it.
//
// WHAT IT IS NOT. It is not a second palette. It holds no colour of its own,
// and it decides nothing: it reads the values the HOST currently computes for
// the `--nexus-*` properties and writes those same values into the reader's
// root element. If the Theme Studio has overridden a token, the host's computed
// value already reflects that, so the bridge needs to know nothing about
// profiles, overrides or the editor.
//
// FAIL-SOFT IS THE DEFAULT, NOT A BRANCH. When Nexus is not the active theme
// there are no `--nexus-*` values to read, the bridge writes nothing, and the
// injected reader stylesheet falls back through CSS's own `var(x, fallback)` to
// the reader's own tokens — which is exactly the behaviour this plugin had
// before the theme existed. There is no "is Nexus installed" check anywhere,
// because there is nothing for one to do.

import { NEXUS_VARIABLES, nexusToken } from '../../../theme/nexus/src/tokens';

/**
 * The tokens mirrored into a reader document.
 *
 * Two of them are SPENT by the injected stylesheet today:
 *
 *   readerPanelSurface  the reader's own sidebar — the TOGGLE PANEL, the one
 *                       surface this plugin has always owned;
 *   documentSurface     the plane behind the reader's pages.
 *
 * The rest are mirrored but not yet spent. That is deliberate and it is cheap:
 * they are five custom properties on one element, and having them already in
 * the frame is what makes "promote a discovery into a rule" a one-line change
 * to the stylesheet rather than a new round of plumbing. They are listed by KEY
 * rather than by variable name so that a rename in the token table reaches here
 * as a compile error instead of as a quietly dead override.
 */
export const BRIDGED_KEYS = [
    'readerPanelSurface',
    'documentSurface',
    'documentChrome',
    'workspaceBorder',
    'splitterIdle',
    'splitterHover',
    'splitterActive',
] as const;

/**
 * The custom property a token key names.
 *
 * Throws on an unknown key rather than returning a placeholder. This is only
 * ever called with a literal from this repository, so a miss means the token
 * table and a consumer have gone out of step — and a stylesheet that silently
 * references `var(undefined)` is a bug that shows up as a colour nobody can
 * explain, weeks later. Failing at load says it immediately.
 */
export function nexusVariable(key: string): string {
    const token = nexusToken(key);
    if (!token) throw new Error(`No Nexus token named "${key}".`);
    return token.cssVariable;
}

/** The custom properties `BRIDGED_KEYS` names, resolved through the token table. */
export const BRIDGED_VARIABLES: readonly string[] = BRIDGED_KEYS.map(nexusVariable);

/** A snapshot of what some tokens are currently worth: variable to value. */
export type TokenValues = Record<string, string>;

/**
 * Keeps only the entries that actually say something.
 *
 * `getPropertyValue` answers with an empty string for a property that is not
 * declared, and with a padded string for one that is, so both have to be dealt
 * with before a value is worth writing. An absent token must stay absent in the
 * frame too: writing an empty value would define the property as empty, and an
 * empty `var()` is NOT the same as a missing one — the fallback would stop
 * being used and the reader would lose its own colour.
 */
export function presentTokens(raw: Record<string, string | null | undefined>): TokenValues {
    const values: TokenValues = {};
    for (const [name, value] of Object.entries(raw)) {
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (trimmed.length === 0) continue;
        values[name] = trimmed;
    }
    return values;
}

/**
 * What the host currently computes for the bridged tokens.
 *
 * Read from the live computed style rather than from any stored state, which is
 * what keeps this plugin out of the palette business: whatever combination of
 * theme, profile and override produced the value on screen, this reads the
 * result.
 */
export function readHostTokens(body: HTMLElement, win: Window): TokenValues {
    const computed = win.getComputedStyle(body);
    const raw: Record<string, string> = {};
    for (const variable of BRIDGED_VARIABLES) {
        raw[variable] = computed.getPropertyValue(variable);
    }
    return presentTokens(raw);
}

/**
 * Mirrors a snapshot into one reader document.
 *
 * Written on the root element, not on `body`: the injected stylesheet declares
 * its own variables on `body`, and keeping the two levels apart means a rule
 * there can read a bridged value without the two ever being the same
 * declaration.
 *
 * Every bridged variable is visited on every call, and one that is missing from
 * the snapshot is REMOVED. Without that, turning an override off in the editor
 * would leave the last value frozen in every reader that was open at the time.
 */
export function syncNexusTokens(doc: Document, values: TokenValues): void {
    const root = doc.documentElement;
    if (!root) return;
    for (const variable of BRIDGED_VARIABLES) {
        const value = values[variable];
        if (value === undefined) root.style.removeProperty(variable);
        else root.style.setProperty(variable, value);
    }
}

/**
 * Takes every mirrored token back out of a reader document.
 *
 * Used when the plugin unloads. Every Nexus variable is removed, not just the
 * bridged ones: a build that once mirrored more of them must not be able to
 * leave a stale property behind for a later build to inherit.
 */
export function clearNexusTokens(doc: Document): void {
    const root = doc.documentElement;
    if (!root) return;
    for (const variable of NEXUS_VARIABLES) root.style.removeProperty(variable);
}
