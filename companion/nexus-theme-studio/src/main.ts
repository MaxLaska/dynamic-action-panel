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
import { overrideDeclarations } from './overrides';
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

export default class NexusThemeStudioPlugin extends Plugin {
    settings: NexusStudioSettings = defaultSettings();

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
        // A disabled plugin must leave the theme exactly as it found it, or the
        // user is left with a palette nothing on screen can explain.
        clearTokenOverrides(document.body);
        removeScratchCss(document);
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
        applyTokenOverrides(document.body, overrideDeclarations(profile.overrides));
        applyScratchCss(document, profile.scratchEnabled ? profile.scratchCss : null);
        window.dispatchEvent(new CustomEvent(NEXUS_TOKENS_CHANGED_EVENT));
    }

    /**
     * Stores a new settings object and shows it.
     *
     * Applied BEFORE it is saved: the apply is synchronous and the save is not,
     * and a colour picker that repaints only after a disk write is a colour
     * picker that feels broken.
     */
    async update(next: NexusStudioSettings): Promise<void> {
        this.settings = next;
        this.applyActiveProfile();
        await this.saveData(this.settings);
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
