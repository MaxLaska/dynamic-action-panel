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
// seconds, without an inspector and without a code change.
//
// The editor is a WORKSPACE VIEW (view.ts), opened by one command. It has no
// settings tab: everything it does is design work, and design work happens
// beside the surfaces being designed, not in a dialog over them.
//
// Live editing is what makes it worth building. The overrides are inline custom
// properties on `<body>`, so moving a colour picker repaints the running
// Obsidian. See runtime.ts for why inline.

import { Notice, Plugin } from 'obsidian';

import {
    NEXUS_THEME_NAME,
    NEXUS_TOKENS_CHANGED_EVENT,
} from '../../../theme/nexus/src/tokens';
import { startInspect, type InspectSession } from './inspectUi';
import { openStudio } from './open';
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
import { NEXUS_STUDIO_VIEW_TYPE, NexusStudioView, type StudioServices } from './view';

/**
 * The slice of Obsidian's app object this plugin reads that is not in the
 * published types. Read defensively, with a "then do nothing" branch: it only
 * decides whether to tell the user their theme is not selected.
 */
interface InternalApp {
    customCss?: { theme?: unknown };
}

/**
 * How long a continuous edit waits before it is written to disk.
 *
 * Dragging a colour picker produces an `input` event per frame, and every one
 * of them is a real change that has to reach the screen immediately. Writing
 * `data.json` at that rate would be a hundred file writes for one decision
 * about one grey — so the APPLY stays synchronous and only the SAVE is
 * deferred. `onunload` flushes whatever is still pending.
 */
const SAVE_DEBOUNCE_MS = 400;

export default class NexusThemeStudioPlugin extends Plugin implements StudioServices {
    settings: NexusStudioSettings = defaultSettings();

    /**
     * The custom properties currently painted in the locator colour, if any.
     *
     * Runtime-only, and the ONLY piece of this plugin's state that is not in
     * `settings`. That is the point: it is held in a field the save path cannot
     * see, so "the locator never writes anything" is a consequence of where the
     * state lives rather than a rule someone has to remember.
     */
    private previewVariables: readonly string[] = [];

    /** A pending debounced save, so it can be flushed or replaced. */
    private saveTimer = 0;

    /** An inspect started from the command palette, so unload can end it. */
    private inspectSession: InspectSession | null = null;

    /**
     * Set as the very first thing `onunload` does.
     *
     * Views are closed by Obsidian as part of the same teardown, in an order
     * this plugin does not control, and a closing view clears the locator —
     * which re-applies the profile. Without this flag a view closing AFTER
     * `onunload` had cleared the overrides would put them straight back on a
     * workspace whose plugin is gone.
     */
    private unloaded = false;

    async onload(): Promise<void> {
        this.settings = normalizeSettings(await this.loadData());
        this.applyActiveProfile();

        // After the settings are loaded, so a view Obsidian restores from the
        // saved layout renders the user's profile and not the defaults.
        // `registerView` also unregisters the type on unload by itself.
        this.registerView(NEXUS_STUDIO_VIEW_TYPE, (leaf) => new NexusStudioView(leaf, this));

        this.addCommand({
            // The id is unchanged from the settings-tab version, so a hotkey
            // somebody already bound keeps working.
            id: 'open-theme-studio',
            name: 'Open Nexus Theme Studio',
            callback: () => {
                void openStudio(this.app.workspace);
            },
        });

        // The same way into DevTools the studio's button offers, for when the
        // studio is not open. The element picker, never a synthetic shortcut.
        this.addCommand({
            id: 'inspect-ui',
            name: 'Inspect UI',
            callback: () => {
                this.inspectSession?.cancel();
                const session = startInspect(window);
                this.inspectSession = session;
                void session.result.then((outcome) => {
                    if (this.inspectSession === session) this.inspectSession = null;
                    if (outcome === 'unavailable') {
                        new Notice('Developer tools cannot be reached from this Obsidian.');
                    }
                    if (outcome === 'failed') new Notice('The inspector could not be started.');
                });
            },
        });

        // The locator is ended by the row that started it, on pointerleave.
        // These cover every way the pointer can stop being on that row without
        // leaving it: the focus moving to another pane, the layout changing
        // under it (a tab closed, a view dragged or detached), or the whole
        // window losing focus — alt-tab, or the screen sampler taking over.
        this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.setPreview([])));
        this.registerEvent(this.app.workspace.on('layout-change', () => this.setPreview([])));
        this.registerDomEvent(window, 'blur', () => this.setPreview([]));

        // Choosing a theme under Appearance while the studio is open changes
        // whether its "Nexus is not selected" note is true. Obsidian announces
        // a loaded theme with `css-change`; found in live use, where the note
        // stayed up after Nexus had been selected.
        this.registerEvent(
            this.app.workspace.on('css-change', () =>
                this.forEachStudioView((view) => view.syncThemeState())
            )
        );
    }

    onunload(): void {
        this.unloaded = true;
        // DevTools' picker left switched on would outlive the plugin that
        // started it. (Picks started from a studio view end with the view.)
        this.inspectSession?.cancel();
        this.inspectSession = null;
        // A colour dragged a moment ago may still be waiting on the debounce.
        this.flushSave();
        // A disabled plugin must leave the theme exactly as it found it.
        // Clearing every Nexus variable also takes any locator preview down.
        //
        // Studio leaves are NOT detached. Obsidian keeps them in the layout, so
        // the view comes back exactly where the user put it when the plugin is
        // enabled again — detaching would reset it to the default dock.
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
     * Makes the running Obsidian show the active profile, plus any preview.
     *
     * A full apply rather than a delta, so there is no accumulated state to get
     * wrong. The event at the end is the seam to the reader: the reader
     * extensions mirror the current values into every open reader iframe.
     */
    applyActiveProfile(): void {
        if (this.unloaded) return;
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
     * Nothing is stored. Clearing is a full re-apply of the active profile,
     * which is a pure function of that profile, so "restore exactly what was
     * there" needs no snapshot.
     */
    setPreview(variables: readonly string[]): void {
        if (this.unloaded) return;
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
     * A discrete change — a profile switch, a reset, an import: shown, saved at
     * once, and every studio view rebuilt from it.
     */
    async update(next: NexusStudioSettings): Promise<void> {
        this.adopt(next);
        window.clearTimeout(this.saveTimer);
        this.saveTimer = 0;
        this.forEachStudioView((view) => view.refresh());
        await this.saveData(this.settings);
    }

    /**
     * A change that is part of a continuous gesture — a picker, a slider:
     * shown at once, saved on a debounce, and every studio view re-synced in
     * place so a second view does not fall behind the one being dragged in.
     */
    updateLive(next: NexusStudioSettings): void {
        this.adopt(next);
        this.forEachStudioView((view) => view.sync());
        window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = 0;
            void this.saveData(this.settings);
        }, SAVE_DEBOUNCE_MS);
    }

    /**
     * A change to the studio's OWN UI state — which groups are folded. Saved,
     * but nothing is re-applied to the theme: folding a section is not a
     * colour change, and must not re-send every token to every reader.
     */
    async updateUi(next: NexusStudioSettings): Promise<void> {
        this.settings = next;
        this.forEachStudioView((view) => view.syncCollapse());
        window.clearTimeout(this.saveTimer);
        this.saveTimer = 0;
        await this.saveData(this.settings);
    }

    /** The half both colour write paths share: take the settings, and show them. */
    private adopt(next: NexusStudioSettings): void {
        this.settings = next;
        // An explicit change outranks a hover: a preview left up would sit on
        // the token just edited and hide the edit.
        this.previewVariables = [];
        this.applyActiveProfile();
    }

    /**
     * Every open studio view, found through the workspace.
     *
     * Deliberately not a list the plugin keeps. A plugin that holds its views
     * keeps closed ones alive; the workspace already knows which exist.
     */
    private forEachStudioView(visit: (view: NexusStudioView) => void): void {
        for (const leaf of this.app.workspace.getLeavesOfType(NEXUS_STUDIO_VIEW_TYPE)) {
            if (leaf.view instanceof NexusStudioView) visit(leaf.view);
        }
    }

    /**
     * Whether Nexus is the selected theme — or null when Obsidian will not say.
     * Three states, because "I could not find out" must not be reported as
     * "your theme is not active".
     */
    themeIsActive(): boolean | null {
        const theme = (this.app as unknown as InternalApp).customCss?.theme;
        if (typeof theme !== 'string') return null;
        return theme === NEXUS_THEME_NAME;
    }
}
