// studioPanel.ts
// The Theme Studio's surface: a design panel, not a settings form.
//
// This used to be a settings tab, and that was the wrong home twice over. It
// put a modal over the very workspace being designed — so the pipette could not
// see the surfaces worth sampling — and it rendered through Obsidian's
// declarative settings renderer, which reconciles an existing group on
// `update()` by re-rendering its items only: a group's `cls` and its header
// buttons are applied when the group is first created and never again. The
// collapse chevron changed `cls` between renders, so nothing ever folded.
//
// Here the panel owns its DOM outright. Folding is a `hidden` attribute on a
// group body this file created, toggled by a real `<button>` this file created,
// and nothing between the click and the result can decide to skip it.
//
// It knows nothing about Obsidian's Plugin or ItemView. Everything it needs
// from outside comes through `StudioPanelHost`, which is what lets the tests
// render a real panel into a real (happy-dom) document and click it.
//
// Nothing here names a token. Rows come from the control plan, and the plan
// comes from `theme/nexus/src/tokens.ts`.

import { setIcon, setTooltip } from 'obsidian';

import {
    NEXUS_CONTRAST_PAIRS,
    NEXUS_THEME_NAME,
    nexusToken,
    type NexusContrastPair,
    type ThemeTokenDefinition,
} from '../../../theme/nexus/src/tokens';
import { parseColorValue } from './colorValue';
import {
    CONTRAST_LARGE,
    CONTRAST_TEXT,
    formatRatio,
    measureContrast,
    type ContrastResult,
} from './contrast';
import { buildControlPlan } from './controlPlan';
import { button, el, winOf } from './dom';
import { inspectAvailable, startInspect, type InspectSession } from './inspectUi';
import { effectiveValue, isOverridden } from './overrides';
import { sampleColor, samplerKind, type SampleSession } from './sampler';
import {
    activeProfile,
    createProfile,
    deleteProfile,
    duplicateProfile,
    isGroupCollapsed,
    isLocked,
    renameProfile,
    resetProfile,
    setActiveProfile,
    setGroupCollapsed,
    setOverride,
    setScratch,
    type NexusProfile,
    type NexusStudioSettings,
} from './profiles';
import { parseProfileDocument } from './transfer';
import { renderTokenRow, type TokenRowHandle } from './tokenRow';

/** One entry in the profile actions menu, as data. */
export interface StudioMenuAction {
    id: string;
    title: string;
    icon: string;
    disabled: boolean;
    run(): void;
}

/** Everything the panel needs from the world outside it. */
export interface StudioPanelHost {
    settings(): NexusStudioSettings;
    /** Whether Nexus is the selected theme, or null when Obsidian will not say. */
    themeIsActive(): boolean | null;
    /** A discrete change: persisted at once; every studio view re-renders. */
    update(next: NexusStudioSettings): Promise<void>;
    /** A continuous change: applied at once, persisted on a debounce. */
    updateLive(next: NexusStudioSettings): void;
    /** A change to the studio's own UI state: persisted, theme untouched. */
    updateUi(next: NexusStudioSettings): Promise<void>;
    /** Paints the given custom properties in the locator colour; [] stops. */
    setPreview(variables: readonly string[]): void;
    /** Asks for a profile name; null when cancelled. */
    promptName(title: string, initial: string): Promise<string | null>;
    /** Opens the import/export dialog. */
    openTransfer(mode: 'export' | 'import', profile: NexusProfile, onImport: (text: string) => void): void;
    /** Shows a menu of actions at a pointer event. */
    showMenu(evt: MouseEvent, actions: StudioMenuAction[]): void;
    /** A transient message to the user. */
    notify(message: string): void;
}

/** The key of the scratch CSS section, alongside the token groups' keys. */
export const ADVANCED_GROUP = 'advanced';

/** The key of the contrast section. */
export const CONTRAST_GROUP = 'contrast';

/**
 * The colour of the probe's host, as the browser serialises it. Must match
 * `.nexus-studio-probe` in styles.css; a test holds the two together.
 */
export const PROBE_SENTINEL = 'rgb(1,2,3)';

/** Said wherever contrast figures are shown, so a figure is not read as a verdict. */
export const CONTRAST_DISCLAIMER =
    'A contrast indicator for these colour pairs, by the WCAG ratio — not an accessibility audit of the theme.';

interface ContrastRowParts {
    pair: NexusContrastPair;
    row: HTMLElement;
    text: HTMLElement;
    surface: HTMLElement;
    figure: HTMLElement;
}

/** Unique ids across every panel in every window. */
let panelSerial = 0;

interface GroupParts {
    key: string;
    header: HTMLButtonElement;
    chevron: HTMLElement;
    meta: HTMLElement;
    body: HTMLElement;
    tokens: ThemeTokenDefinition[];
}

export class StudioPanel {
    private readonly serial = (panelSerial += 1);
    private rows: TokenRowHandle[] = [];
    private groups: GroupParts[] = [];
    private themeState: HTMLElement | null = null;
    private contrastRows: ContrastRowParts[] = [];
    private contrastMeta: HTMLElement | null = null;
    private probe: HTMLElement | null = null;
    /** A colour pick or an inspect in progress, so closing the view ends it. */
    private pending: { cancel(): void } | null = null;
    private disposed = false;

    constructor(
        private readonly root: HTMLElement,
        private readonly host: StudioPanelHost
    ) {
        root.classList.add('nexus-studio');
    }

    private get win(): Window {
        return winOf(this.root);
    }

    private current(): NexusProfile {
        return activeProfile(this.host.settings());
    }

    /**
     * Builds the whole panel from the current settings.
     *
     * A full rebuild, for discrete changes — a profile switch, a rename, an
     * import. Continuous changes do not come through here; they call `sync`,
     * which leaves every element (and the focus) where it is.
     */
    render(): void {
        if (this.disposed) return;
        this.teardownRows();
        // A rebuild removes the row under the pointer without a pointerleave,
        // so a preview started by that row would otherwise outlive it.
        this.host.setPreview([]);
        this.root.replaceChildren();

        this.themeState = el(this.root, 'div', { cls: 'nexus-studio-theme-state' });
        this.syncThemeState();
        this.renderProfileBar();
        this.renderTools();
        for (const group of buildControlPlan()) {
            this.renderTokenGroup(group.group, group.label, group.tokens);
        }
        this.renderContrast();
        this.renderAdvanced();
        this.syncCollapse();
        this.syncContrast();
    }

    /** Brings every row and every group count back in step with the settings. */
    sync(): void {
        if (this.disposed) return;
        for (const row of this.rows) row.sync();
        this.syncGroupMeta();
        this.syncContrast();
    }

    /** Applies the stored fold state to the groups already on screen. */
    syncCollapse(): void {
        const settings = this.host.settings();
        for (const group of this.groups) {
            this.applyCollapsed(group, isGroupCollapsed(settings, group.key));
        }
    }

    /** Takes the panel down: rows, timers, and any preview they started. */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        // A pick or an inspect left running would outlive the view that started
        // it: a crosshair over Obsidian, or DevTools' picker, with nothing left
        // to receive the result.
        this.pending?.cancel();
        this.pending = null;
        this.teardownRows();
        this.host.setPreview([]);
        this.root.replaceChildren();
    }

    private teardownRows(): void {
        for (const row of this.rows) row.dispose();
        this.rows = [];
        this.groups = [];
        this.themeState = null;
        this.contrastRows = [];
        this.contrastMeta = null;
        this.probe = null;
    }

    // --- top of the panel ---------------------------------------------------

    /**
     * Says so when the tokens edited here are not the ones on screen — only
     * for a definite "no", because a hint that might be wrong is worse than no
     * hint on a panel full of colours.
     *
     * Refilled in place rather than by a rebuild, because it goes stale for a
     * reason that has nothing to do with the studio: the user picks a theme
     * under Appearance while this view sits open beside them. A rebuild then
     * would throw away an open CSS field and the focus with it, to change one
     * line of text.
     */
    syncThemeState(): void {
        const slot = this.themeState;
        if (!slot || this.disposed) return;
        slot.replaceChildren();
        if (this.host.themeIsActive() !== false) return;
        const note = el(slot, 'div', { cls: 'nexus-studio-warning' });
        el(note, 'strong', { text: `${NEXUS_THEME_NAME} is not the selected theme.` });
        el(note, 'span', {
            text: ` These controls edit ${NEXUS_THEME_NAME} tokens; choose it under Appearance to see them.`,
        });
    }

    private renderProfileBar(): void {
        const settings = this.host.settings();
        const current = this.current();
        const locked = isLocked(current);

        const bar = el(this.root, 'div', { cls: 'nexus-studio-profile' });
        const select = el(bar, 'select', {
            cls: ['dropdown', 'nexus-studio-profile-select'],
            attr: { 'aria-label': 'Active profile' },
        });
        for (const profile of settings.profiles) {
            const option = el(select, 'option', { text: profile.name, attr: { value: profile.id } });
            option.selected = profile.id === current.id;
        }
        select.addEventListener('change', () => {
            void this.host.update(setActiveProfile(this.host.settings(), select.value));
        });

        const resetAll = button(bar, {
            cls: ['clickable-icon', 'nexus-studio-profile-reset'],
            attr: { 'aria-label': `Reset profile to ${NEXUS_THEME_NAME} defaults` },
        });
        setIcon(resetAll, 'rotate-ccw');
        setTooltip(resetAll, `Reset profile to ${NEXUS_THEME_NAME} defaults`);
        resetAll.disabled = locked;
        resetAll.addEventListener('click', () => {
            if (isLocked(this.current())) return;
            void this.host.update(resetProfile(this.host.settings(), this.current().id));
        });

        const more = button(bar, {
            cls: ['clickable-icon', 'nexus-studio-profile-more'],
            attr: { 'aria-label': 'Profile actions' },
        });
        setIcon(more, 'more-horizontal');
        setTooltip(more, 'Profile actions');
        more.addEventListener('click', (evt) => this.host.showMenu(evt, this.profileActions()));

        if (locked) {
            el(this.root, 'div', {
                cls: 'nexus-studio-note',
                text: `"${current.name}" is the theme's own baseline and cannot be edited — which is what makes switching back to it a reliable way home. Duplicate it to start changing values.`,
            });
        }
    }

    /**
     * The profile menu, as data, so it can be checked without opening a menu.
     *
     * New and duplicate always apply. Rename and delete do not apply to the
     * locked baseline, and say so by being disabled rather than by vanishing.
     */
    profileActions(): StudioMenuAction[] {
        const current = this.current();
        const locked = isLocked(current);
        return [
            {
                id: 'new',
                title: 'New profile',
                icon: 'plus',
                disabled: false,
                run: () => {
                    void this.host.promptName('New profile', 'Profile').then((name) => {
                        if (name) void this.host.update(createProfile(this.host.settings(), name));
                    });
                },
            },
            {
                id: 'duplicate',
                title: 'Duplicate profile',
                icon: 'copy',
                disabled: false,
                run: () => {
                    const source = this.current();
                    void this.host
                        .promptName('Duplicate profile', `${source.name} copy`)
                        .then((name) => {
                            if (name) {
                                void this.host.update(
                                    duplicateProfile(this.host.settings(), source.id, name)
                                );
                            }
                        });
                },
            },
            {
                id: 'rename',
                title: 'Rename profile',
                icon: 'pencil',
                disabled: locked,
                run: () => {
                    const target = this.current();
                    if (isLocked(target)) return;
                    void this.host.promptName('Rename profile', target.name).then((name) => {
                        if (name) {
                            void this.host.update(renameProfile(this.host.settings(), target.id, name));
                        }
                    });
                },
            },
            {
                id: 'delete',
                title: 'Delete profile',
                icon: 'trash-2',
                disabled: locked,
                run: () => {
                    const target = this.current();
                    if (isLocked(target)) return;
                    void this.host.update(deleteProfile(this.host.settings(), target.id));
                },
            },
            {
                id: 'export',
                title: 'Export profile',
                icon: 'upload',
                disabled: false,
                run: () => this.host.openTransfer('export', this.current(), () => undefined),
            },
            {
                id: 'import',
                title: 'Import profile',
                icon: 'download',
                disabled: false,
                run: () =>
                    this.host.openTransfer('import', this.current(), (text) => this.import(text)),
            },
        ];
    }

    /** Reads an exported profile back in, as a new profile, or explains why not. */
    import(text: string): void {
        const result = parseProfileDocument(text);
        if (!result.ok) {
            this.host.notify(`Import refused: ${result.reason}`);
            return;
        }
        let next = createProfile(this.host.settings(), result.document.name);
        const created = activeProfile(next);
        for (const [key, value] of Object.entries(result.document.overrides)) {
            next = setOverride(next, created.id, key, value);
        }
        if (result.document.scratchCss) {
            next = setScratch(next, created.id, { css: result.document.scratchCss });
        }
        void this.host.update(next);
        this.host.notify(`Imported "${created.name}".`);
    }

    // --- groups -------------------------------------------------------------

    /**
     * A foldable section: a real button for a header, a body it controls.
     *
     * The header is a `<button>`, so it is focusable and announced as a
     * control. Enter and Space are handled explicitly and default-prevented:
     * that keeps the behaviour identical in every engine, and preventing the
     * default is what stops a real browser from also synthesising a click and
     * toggling twice.
     */
    private renderGroup(key: string, label: string, tokens: ThemeTokenDefinition[]): GroupParts {
        const bodyId = `nexus-studio-${this.serial}-group-${key}`;
        const section = el(this.root, 'section', {
            cls: 'nexus-studio-group',
            attr: { 'data-group': key },
        });
        const header = button(section, {
            cls: 'nexus-studio-group-header',
            attr: { 'aria-controls': bodyId, 'aria-expanded': 'true' },
        });
        const chevron = el(header, 'span', { cls: 'nexus-studio-chevron' });
        el(header, 'span', { cls: 'nexus-studio-group-title', text: label });
        const meta = el(header, 'span', { cls: 'nexus-studio-group-meta' });
        const body = el(section, 'div', { cls: 'nexus-studio-group-body', attr: { id: bodyId } });

        const parts: GroupParts = { key, header, chevron, meta, body, tokens };
        const toggle = (): void => this.toggleGroup(parts);
        header.addEventListener('click', toggle);
        header.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            toggle();
        });
        this.groups.push(parts);
        return parts;
    }

    private toggleGroup(group: GroupParts): void {
        const settings = this.host.settings();
        const collapsed = !isGroupCollapsed(settings, group.key);
        // The DOM first, so the fold is instant and does not wait on a disk
        // write. The stored state follows; other open studio views pick it up
        // through `syncCollapse`, which is idempotent for this one.
        this.applyCollapsed(group, collapsed);
        void this.host.updateUi(setGroupCollapsed(settings, group.key, collapsed));
    }

    private applyCollapsed(group: GroupParts, collapsed: boolean): void {
        group.body.hidden = collapsed;
        group.header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        group.header.parentElement?.classList.toggle('is-collapsed', collapsed);
        group.chevron.replaceChildren();
        setIcon(group.chevron, collapsed ? 'chevron-right' : 'chevron-down');
    }

    /** "2 changed" beside a group's name — a folded group still says it holds edits. */
    private syncGroupMeta(): void {
        const overrides = this.current().overrides;
        for (const group of this.groups) {
            const changed = group.tokens.filter((token) => isOverridden(overrides, token.key)).length;
            group.meta.textContent = changed > 0 ? `${changed} changed` : '';
        }
    }

    private renderTokenGroup(key: string, label: string, tokens: ThemeTokenDefinition[]): void {
        const group = this.renderGroup(key, label, tokens);
        for (const token of tokens) {
            this.rows.push(
                renderTokenRow(group.body, token, {
                    win: this.win,
                    currentValue: (item) => effectiveValue(this.current().overrides, item.key),
                    isOverridden: (item) => isOverridden(this.current().overrides, item.key),
                    isLocked: () => isLocked(this.current()),
                    write: (item, value) => this.write(item, value),
                    preview: (item) => this.preview(item),
                    pickKind: this.pickKind(),
                    pickColor: () => this.pickColor(),
                })
            );
        }
        this.syncGroupMeta();
    }

    /**
     * One token write, on the live path: applied now, saved on a debounce.
     *
     * Every row re-syncs, not just the one that wrote. One write changes what
     * "overridden" means for exactly one row, but refreshing eleven costs
     * nothing and keeps the rule simple: nothing on screen is trusted to still
     * be true after a write.
     */
    private write(token: ThemeTokenDefinition, value: string | null): void {
        const settings = this.host.settings();
        this.host.updateLive(setOverride(settings, this.current().id, token.key, value));
        this.sync();
    }

    /**
     * Starts or stops the locator. The tokens painted are this one plus what
     * the registry says to light with it — the splitter states name the idle
     * line, because nothing is being hovered while you hover "hover".
     */
    private preview(token: ThemeTokenDefinition | null): void {
        if (!token) {
            this.host.setPreview([]);
            return;
        }
        const variables = [token.key, ...(token.locateAlso ?? [])].flatMap((key) => {
            const found = nexusToken(key);
            return found ? [found.cssVariable] : [];
        });
        this.host.setPreview(variables);
    }

    // --- discovery tools -------------------------------------------------------

    private pickKind(): 'capture' | 'screen' | null {
        const kind = samplerKind(this.win);
        return kind === 'capture' ? 'capture' : kind === 'eyedropper' ? 'screen' : null;
    }

    /**
     * Takes a colour off the screen. One at a time: starting a second pick
     * cancels the first, so there is never more than one crosshair.
     */
    private pickColor(): Promise<string | null> {
        this.pending?.cancel();
        this.host.setPreview([]);
        const session: SampleSession = sampleColor(this.win);
        this.pending = session;
        return session.result.finally(() => {
            if (this.pending === session) this.pending = null;
        });
    }

    /**
     * The studio's way into DevTools, for finding a surface that has no token
     * yet: DevTools' own element picker, started from here. The studio is not a
     * DOM inspector and does not become one.
     */
    private renderTools(): void {
        const bar = el(this.root, 'div', { cls: 'nexus-studio-tools' });
        el(bar, 'span', { cls: 'nexus-studio-tools-label', text: 'Discovery' });

        const inspect = button(bar, { cls: 'nexus-studio-tool', attr: { 'data-tool': 'inspect' } });
        const inspectIcon = el(inspect, 'span', { cls: 'nexus-studio-tool-icon' });
        setIcon(inspectIcon, 'scan-search');
        el(inspect, 'span', { text: 'Inspect UI' });
        const canInspect = inspectAvailable(this.win);
        inspect.disabled = !canInspect;
        const inspectTip = canInspect
            ? "Pick an element with DevTools' inspector. Esc cancels."
            : 'Developer tools cannot be reached from this Obsidian.';
        inspect.setAttribute('aria-label', inspectTip);
        setTooltip(inspect, inspectTip);
        inspect.addEventListener('click', () => {
            this.pending?.cancel();
            this.host.setPreview([]);
            const session: InspectSession = startInspect(this.win);
            this.pending = session;
            void session.result.then((outcome) => {
                if (this.pending === session) this.pending = null;
                if (outcome === 'unavailable') this.host.notify('Developer tools cannot be reached from this Obsidian.');
                if (outcome === 'failed') this.host.notify('The inspector could not be started.');
            });
        });

        const kind = this.pickKind();
        if (kind) {
            const pick = button(bar, { cls: 'nexus-studio-tool', attr: { 'data-tool': 'pick' } });
            const pickIcon = el(pick, 'span', { cls: 'nexus-studio-tool-icon' });
            setIcon(pickIcon, 'pipette');
            el(pick, 'span', { text: 'Take colour' });
            const tip =
                kind === 'capture'
                    ? 'Read the colour of any point in Obsidian and copy it. Esc cancels.'
                    : 'Pick a colour from the screen and copy it. Esc cancels.';
            pick.setAttribute('aria-label', tip);
            setTooltip(pick, tip);
            const readout = el(bar, 'span', { cls: 'nexus-studio-tools-readout' });
            pick.addEventListener('click', () => {
                void this.pickColor().then((picked) => {
                    if (!picked) return;
                    readout.textContent = picked;
                    readout.style.setProperty('--nexus-studio-swatch', picked);
                    void this.win.navigator.clipboard?.writeText(picked).then(
                        () => this.host.notify(`${picked} copied.`),
                        () => undefined
                    );
                });
            });
        }
    }

    // --- contrast ---------------------------------------------------------------

    /**
     * The contrast of each text-and-surface pair the registry names, by the
     * WCAG ratio. It reports and never changes a value — there is no automatic
     * text colour; see DECISIONS.md "Contrast is assisted, not automatic".
     */
    private renderContrast(): void {
        const group = this.renderGroup(CONTRAST_GROUP, 'Contrast', []);
        this.contrastMeta = group.meta;
        el(group.body, 'div', { cls: 'nexus-studio-row-desc nexus-studio-contrast-note', text: CONTRAST_DISCLAIMER });
        for (const pair of NEXUS_CONTRAST_PAIRS) {
            const row = el(group.body, 'div', {
                cls: 'nexus-studio-contrast-row',
                attr: { 'data-pair': `${pair.text}:${pair.surface}` },
            });
            const sample = el(row, 'span', { cls: 'nexus-studio-contrast-sample' });
            const surface = el(sample, 'span', { cls: 'nexus-studio-contrast-surface' });
            const text = el(surface, 'span', { cls: 'nexus-studio-contrast-text', text: 'Aa' });
            el(row, 'span', { cls: 'nexus-studio-contrast-label', text: pair.label });
            const figure = el(row, 'span', { cls: 'nexus-studio-contrast-figure' });
            this.contrastRows.push({ pair, row, text, surface, figure });
        }
        // A hidden element the browser resolves colours on, for values the
        // parser cannot take apart — `color-mix()`, `var()`. It sits inside a
        // host whose colour is a sentinel: a value that resolves to nothing
        // makes the probe INHERIT, and inheriting the sentinel is detectable,
        // where inheriting the studio's own text colour would be measured as if
        // it were the answer.
        const host = el(group.body, 'span', { cls: 'nexus-studio-probe', attr: { 'aria-hidden': 'true' } });
        this.probe = el(host, 'span');
    }

    /**
     * A token's current value as a colour this can measure.
     *
     * Parsed directly when it is a plain colour; otherwise the browser resolves
     * it on a probe element and the COMPUTED colour is read back. What neither
     * can read stays unmeasured rather than being guessed.
     */
    private resolveColour(value: string): string {
        if (parseColorValue(value)) return value;
        const probe = this.probe;
        if (!probe) return value;
        probe.style.setProperty('--nexus-studio-probe', value);
        const computed = this.win.getComputedStyle(probe).color;
        // The sentinel, inherited: the value resolved to nothing. Returning the
        // original leaves it unparsed, so it is reported as unmeasured.
        if (!computed || computed.replace(/\s+/g, '') === PROBE_SENTINEL) return value;
        return computed;
    }

    private measure(pair: NexusContrastPair): ContrastResult {
        const overrides = this.current().overrides;
        const text = this.resolveColour(effectiveValue(overrides, pair.text));
        const surface = this.resolveColour(effectiveValue(overrides, pair.surface));
        return measureContrast(text, surface);
    }

    private syncContrast(): void {
        let below = 0;
        for (const parts of this.contrastRows) {
            const result = this.measure(parts.pair);
            const overrides = this.current().overrides;
            parts.surface.style.setProperty('--nexus-studio-swatch', effectiveValue(overrides, parts.pair.surface));
            parts.text.style.setProperty('--nexus-studio-contrast-ink', effectiveValue(overrides, parts.pair.text));
            parts.row.classList.remove('is-text', 'is-large-only', 'is-too-low', 'is-unmeasured');
            if (!result.measured) {
                parts.row.classList.add('is-unmeasured');
                parts.figure.textContent = '—';
                parts.figure.setAttribute('title', result.reason);
                parts.figure.setAttribute('aria-label', `${parts.pair.label}: not measured. ${result.reason}`);
                continue;
            }
            const ratio = formatRatio(result.ratio);
            const verdict =
                result.grade === 'text'
                    ? `${ratio} ✓`
                    : result.grade === 'large-only'
                      ? `${ratio} ⚠`
                      : `${ratio} ✗`;
            const meaning =
                result.grade === 'text'
                    ? `At least ${CONTRAST_TEXT}:1 — enough for normal text.`
                    : result.grade === 'large-only'
                      ? `Below ${CONTRAST_TEXT}:1 — enough only for large text and UI shapes (${CONTRAST_LARGE}:1).`
                      : `Below ${CONTRAST_LARGE}:1 — too low even for large text.`;
            if (result.grade !== 'text') below += 1;
            parts.row.classList.add(`is-${result.grade}`);
            parts.figure.textContent = verdict;
            parts.figure.setAttribute('title', meaning);
            parts.figure.setAttribute('aria-label', `${parts.pair.label}: ${ratio}. ${meaning}`);
        }
        if (this.contrastMeta) {
            this.contrastMeta.textContent = below > 0 ? `${below} below ${CONTRAST_TEXT}:1` : '';
            this.contrastMeta.classList.toggle('is-warning', below > 0);
        }
    }

    // --- developer scratch CSS ------------------------------------------------

    /**
     * A DEVELOPMENT TOOL, not the architecture: somewhere a rule found in
     * DevTools survives a reload while it is being judged. Off unless switched
     * on; clearing it removes the stylesheet entirely.
     */
    private renderAdvanced(): void {
        const group = this.renderGroup(ADVANCED_GROUP, 'Developer scratch CSS', []);
        const current = this.current();
        const locked = isLocked(current);

        el(group.body, 'div', {
            cls: 'nexus-studio-row-desc',
            text: 'Applied to the Obsidian window while enabled. Promote anything worth keeping into a token and a theme rule.',
        });

        const toggleLine = el(group.body, 'label', { cls: 'nexus-studio-scratch-toggle' });
        const toggle = el(toggleLine, 'input', { attr: { type: 'checkbox' } });
        toggle.checked = current.scratchEnabled;
        toggle.disabled = locked;
        el(toggleLine, 'span', { text: 'Enabled' });
        toggle.addEventListener('change', () => {
            void this.host.update(
                setScratch(this.host.settings(), this.current().id, { enabled: toggle.checked })
            );
        });

        const area = el(group.body, 'textarea', {
            cls: 'nexus-studio-scratch',
            attr: {
                spellcheck: 'false',
                placeholder: '.workspace-tab-header { ... }',
                'aria-label': 'Scratch CSS',
            },
        });
        area.value = current.scratchCss;
        area.disabled = locked;

        const buttons = el(group.body, 'div', { cls: 'nexus-studio-scratch-buttons' });
        const apply = button(buttons, { cls: 'mod-cta', text: 'Apply' });
        apply.disabled = locked;
        apply.addEventListener('click', () => {
            void this.host.update(
                setScratch(this.host.settings(), this.current().id, { css: area.value })
            );
        });
        const clear = button(buttons, { cls: 'mod-warning', text: 'Clear' });
        clear.disabled = locked;
        clear.addEventListener('click', () => {
            void this.host.update(
                setScratch(this.host.settings(), this.current().id, { css: '', enabled: false })
            );
        });
    }
}
