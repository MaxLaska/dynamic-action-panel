// runtime.ts
// How an override becomes something you can see, and how it stops being that.
//
// Two mechanisms, and the difference between them is the point:
//
// TOKENS are written as INLINE custom properties on `document.body`. Not a
// stylesheet, and not `!important`. An inline declaration outranks every rule
// in every stylesheet by construction, so the override wins over the theme
// without either of them having to know the other's load order — and Obsidian
// loads a theme, a snippet and a plugin's CSS in an order this plugin does not
// control. It also means the override is visible in DevTools as element style,
// on `<body>`, which is exactly where somebody looking for "why is this colour
// what it is" would want to find it.
//
// SCRATCH CSS is a single `<style>` element, because it is whole rules rather
// than values and there is nowhere else for a rule to live.
//
// Both are idempotent and both are fully removable, which is what `onunload`
// depends on: a plugin that is disabled must leave the theme as it found it.

import { NEXUS_VARIABLES } from '../../../theme/nexus/src/tokens';

/**
 * The id of the scratch stylesheet.
 *
 * Identified by id rather than by position so that re-applying reuses the one
 * element instead of stacking a new sheet on every keystroke.
 */
export const SCRATCH_STYLE_ID = 'nexus-theme-studio-scratch';

/**
 * Applies exactly the given declarations, and removes every Nexus variable that
 * is not among them.
 *
 * The removal half is not optional. Switching from a profile that overrides six
 * tokens to one that overrides two has to leave four tokens back at the theme's
 * value, and "set what the new profile says" alone would leave the other four
 * frozen at the old profile's. Every Nexus variable is visited on every apply,
 * so the applied state is a function of the active profile and nothing else.
 */
export function applyTokenOverrides(
    body: HTMLElement,
    declarations: ReadonlyArray<readonly [string, string]>,
    variables: readonly string[] = NEXUS_VARIABLES
): void {
    const declared = new Map(declarations.map(([name, value]) => [name, value]));
    for (const variable of variables) {
        const value = declared.get(variable);
        if (value === undefined) body.style.removeProperty(variable);
        else body.style.setProperty(variable, value);
    }
}

/** Removes every Nexus override, leaving the theme's own values in place. */
export function clearTokenOverrides(
    body: HTMLElement,
    variables: readonly string[] = NEXUS_VARIABLES
): void {
    for (const variable of variables) body.style.removeProperty(variable);
}

/**
 * Puts the scratch stylesheet in the document, or takes it out.
 *
 * `null` and empty CSS both mean "take it out", so disabling the toggle and
 * clearing the field do the same visible thing — there is no state where a
 * disabled scratch sheet is still sitting in `<head>` doing nothing.
 */
export function applyScratchCss(doc: Document, css: string | null): void {
    const existing = doc.getElementById(SCRATCH_STYLE_ID);
    if (css === null || css.trim().length === 0) {
        existing?.remove();
        return;
    }
    // Plain `createElement` rather than Obsidian's `createEl`: this module is
    // called with a fake document in tests, and the convenience API exists only
    // on documents Obsidian has augmented. The companion ESLint override in
    // eslint.config.mjs covers this directory.
    const element = existing ?? doc.createElement('style');
    if (!existing) {
        element.id = SCRATCH_STYLE_ID;
        doc.head.appendChild(element);
    }
    // Comparing first keeps a re-apply from invalidating style resolution for
    // nothing; this runs on every change in the editor.
    if (element.textContent !== css) element.textContent = css;
}

/** Takes the scratch stylesheet out, whatever it currently says. */
export function removeScratchCss(doc: Document): void {
    doc.getElementById(SCRATCH_STYLE_ID)?.remove();
}
