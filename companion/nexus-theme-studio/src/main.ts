// main.ts
// Nexus Theme Studio — the editor for the Nexus theme, and nothing else.
//
// What this plugin is NOT: a theme editor for other people's themes, a CSS
// builder, a DOM picker, or a settings UI generator. It knows exactly one
// vocabulary — the token table in `theme/nexus/src/tokens.ts` — and its whole
// job is to let a value in that table be changed and seen at the same moment.
//
// The workflow it exists to serve is written down in
// docs/ocap/nexus-theme-workflow.md. In short: DevTools is for DISCOVERING an
// unknown corner of Obsidian, once; a token plus a rule plus a row in the table
// PROMOTES that discovery; and from then on the value is changed here, in
// seconds, without an inspector and without a code change. This file is the
// fourth step of that loop and deliberately not the first three.
//
// Live editing is what makes it worth building. There is no save-and-restart:
// the overrides are inline custom properties on `<body>`, so moving a colour
// picker repaints the running Obsidian. See runtime.ts for why inline.

import { Plugin } from 'obsidian';

import {
    NEXUS_THEME_NAME,
    NEXUS_TOKENS_CHANGED_EVENT,
} from '../../../theme/nexus/src/tokens';
import { overrideDeclarations, withPreview } from './overrides';
import {
    activeProfile,
    defaultSettings,
    normalizeSettings,
    type NexusStudioSettings,
} from './profiles';
import {
    applyScratchCss,
    applyTokenOverrides,
    clearTokenOverrides,
    removeScratchCss,
} from './runtime';
import { NexusThemeStudioSettingTab } from './settingsTab';

/**
 * The slices of Obsidian's app object this plugin reads that are not in the
 * published types.
 *
 * Both are read defensively and both have a "then do nothing" branch, because
 * an internal that moves must cost a disabled convenience and never a broken
 * plugin. `customCss.theme` is only used to tell the user their theme is not
 * selected; `setting` is only used by the command that opens this tab.
 */
interface InternalApp {
    customCss?: { theme?: unknown };
    setting?: { open?: () => void; openTabById?: (id: string) => void };
}

/**
 * How long a continuous edit waits before it is written to disk.
 *
 * Dragging a colour picker produces an `input` event per frame, and every one
 * of them is a real change that has to reach the screen immediately. Writing
 * `data.json` at that rate would be a hundred file writes for one decision
 * about one grey — so the APPLY stays synchronous and only the SAVE is
 * deferred. Long enough to collapse a drag into one write, short enough that
 * letting go and closing Obsidian cannot outrun it; and `onunload` flushes
 * whatever is still pending, so nothing is lost even then.
 */
const SAVE_DEBOUNCE_MS = 400;

export default class NexusThemeStudioPlugin extends Plugin {
    settings: NexusStudioSettings = defaultSettings();

    /**
     * The custom properties currently painted in the locator colour, if any.
     *
     * Runtime-only, and the ONLY piece of this plugin's state that is not in
     * `settings`. That is the point: it is held in a field the save path cannot
     * see, so "the locator never writes anything" is a consequence of where the
     * state lives rather than a rule someone has to remember. `update()` — the
     * one method that saves — does not read it, and this does not call
     * `saveData`.
     */
    private previewVariables: readonly string[] = [];

    /** A pending debounced save, so it can be flushed or replaced. */
    private saveTimer = 0;

    async onload(): Promise<void> {
        this.settings = normalizeSettings(await this.loadData());
        this.applyActiveProfile();
        this.addSettingTab(new NexusThemeStudioSettingTab(this.app, this));
        this.addCommand({
            id: 'open-theme-studio',
            name: 'Open theme studio',
            callback: () => this.openSettings(),
        });
    }

    onunload(): void {
        // A colour the user dragged a moment ago may still be waiting on the
        // debounce. Flushing first is the difference between "the last edit is
        // saved" and "the last edit is saved unless you were quick".
        this.flushSave();
        // A disabled plugin must leave the theme exactly as it found it, or the
        // user is left with a palette nothing on screen can explain. Clearing
        // every Nexus variable also takes any locator preview down with it,
        // which is why there is no separate teardown for one.
        this.previewVariables = [];
        clearTokenOverrides(document.body);
        removeScratchCss(document);
    }

    /** Writes now, if a debounced save is outstanding. */
    private flushSave(): void {
        if (!this.saveTimer) return;
        window.clearTimeout(this.saveTimer);
        this.saveTimer = 0;
        void this.saveData(this.settings);
    }

    /**
     * Makes the running Obsidian show the active profile.
     *
     * Called on load, after every edit, and after every profile switch. It is a
     * full apply rather than a delta — see `applyTokenOverrides` — so there is
     * no accumulated state to get wrong.
     *
     * The event at the end is the seam to the reader: `zotflow-reader-extensions`
     * listens for it and mirrors the current values into every open reader
     * iframe, which a stylesheet cannot reach. It is one event with no payload
     * on purpose. The receiver reads the live computed values itself, so there
     * is no second copy of the palette in flight and nothing to keep in sync.
     */
    applyActiveProfile(): void {
        const profile = activeProfile(this.settings);
        applyTokenOverrides(
            document.body,
            withPreview(overrideDeclarations(profile.overrides), this.previewVariables)
        );
        applyScratchCss(document, profile.scratchEnabled ? profile.scratchCss : null);
        window.dispatchEvent(new CustomEvent(NEXUS_TOKENS_CHANGED_EVENT));
    }

    /**
     * Paints some tokens in the locator colour, or stops painting them.
     *
     * This is how "which surface does this control?" gets answered in a second
     * instead of by setting a colour to red, looking, and setting it back. It
     * lights the TOKEN, not a list of selectors, so every rule that spends the
     * variable responds — including the ones inside the reader's iframe, which
     * follow through the bridge like any other change.
     *
     * Nothing is stored and nothing is remembered beyond the field above.
     * Clearing is a full re-apply of the active profile, which is a pure
     * function of that profile, so "restore exactly what was there" needs no
     * snapshot to be correct — there is nothing to get out of step.
     */
    setPreview(variables: readonly string[]): void {
        const next = [...variables];
        if (
            next.length === this.previewVariables.length &&
            next.every((variable, index) => this.previewVariables[index] === variable)
        ) {
            return;
        }
        this.previewVariables = next;
        this.applyActiveProfile();
    }

    /** Whether a locator preview is currently showing. */
    hasPreview(): boolean {
        return this.previewVariables.length > 0;
    }

    /**
     * Stores a new settings object and shows it.
     *
     * Applied BEFORE it is saved: the apply is synchronous and the save is not,
     * and a colour picker that repaints only after a disk write is a colour
     * picker that feels broken.
     */
    async update(next: NexusStudioSettings): Promise<void> {
        this.adopt(next);
        // A discrete action — a button, a profile switch, a reset — is worth a
        // write of its own. Any debounced save is cancelled rather than left to
        // fire afterwards with the same content.
        window.clearTimeout(this.saveTimer);
        this.saveTimer = 0;
        await this.saveData(this.settings);
    }

    /**
     * Stores and shows a change that is part of a continuous gesture.
     *
     * Same apply, deferred save. This is what a colour picker and an opacity
     * slider call: they change the value every frame, and the screen has to
     * follow every frame, but the disk does not.
     */
    updateLive(next: NexusStudioSettings): void {
        this.adopt(next);
        window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = 0;
            void this.saveData(this.settings);
        }, SAVE_DEBOUNCE_MS);
    }

    /** The half both write paths share: take the settings, and show them. */
    private adopt(next: NexusStudioSettings): void {
        this.settings = next;
        // A stored change while a preview is up would leave the locator colour
        // sitting on a token the user has just edited, and the edit invisible.
        // Dropping the preview first is both the safe order and the honest one:
        // an explicit change outranks a hover.
        this.previewVariables = [];
        this.applyActiveProfile();
    }

    /**
     * Whether Nexus is the selected theme — or null when Obsidian will not say.
     *
     * Three states rather than two, because "I could not find out" must not be
     * reported as "your theme is not active". The tab shows a hint only for a
     * definite false.
     */
    themeIsActive(): boolean | null {
        const theme = (this.app as unknown as InternalApp).customCss?.theme;
        if (typeof theme !== 'string') return null;
        return theme === NEXUS_THEME_NAME;
    }

    /** Opens this plugin's own settings tab, for the command. */
    openSettings(): void {
        const setting = (this.app as unknown as InternalApp).setting;
        setting?.open?.();
        setting?.openTabById?.(this.manifest.id);
    }
}
