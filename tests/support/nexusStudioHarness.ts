// A StudioPanel rendered into the (happy-dom) document, with a host that
// behaves like the plugin: `update` rebuilds the view, `updateLive` applies
// without rebuilding, `updateUi` touches only UI state, and a picker's draft
// (`setSessionValue`) is held apart from the settings and re-syncs the panel —
// exactly the split main.ts makes. Shared by the DOM test files; not a test.

import { defaultSettings, type NexusStudioSettings } from '../../companion/nexus-theme-studio/src/profiles';
import {
    StudioPanel,
    type StudioMenuAction,
    type StudioPanelHost,
} from '../../companion/nexus-theme-studio/src/studioPanel';

/** A host that behaves like the plugin, recording what the panel asked of it. */
export function makeHost(initial: NexusStudioSettings = defaultSettings()) {
    let settings = initial;
    const session = new Map<string, string>();
    const log = {
        update: 0,
        updateLive: 0,
        updateUi: 0,
        updateUiLater: 0,
        previews: [] as string[][],
        sessions: [] as Array<[string, string | null]>,
        menus: [] as StudioMenuAction[][],
        notices: [] as string[],
        exports: [] as string[][],
        confirms: [] as string[],
    };
    /** What the next confirm dialog answers; tests flip it to say no. */
    const answers = { confirm: true };
    /** The import dialog's callback, as if the user pressed Import with this text. */
    let pendingImport: ((text: string) => void) | null = null;
    let panel: StudioPanel | null = null;
    const host: StudioPanelHost = {
        settings: () => settings,
        themeIsActive: () => true,
        update: (next) => {
            settings = next;
            log.update += 1;
            // The plugin rebuilds every studio view after a discrete change.
            panel?.render();
            return Promise.resolve();
        },
        updateLive: (next) => {
            settings = next;
            log.updateLive += 1;
        },
        updateUi: (next) => {
            settings = next;
            log.updateUi += 1;
            panel?.syncCollapse();
            return Promise.resolve();
        },
        updateUiLater: (next) => {
            settings = next;
            log.updateUiLater += 1;
        },
        setPreview: (variables) => {
            log.previews.push([...variables]);
        },
        setSessionValue: (key, value) => {
            log.sessions.push([key, value]);
            if (value === null) session.delete(key);
            else session.set(key, value);
            panel?.sync();
        },
        sessionValue: (key) => session.get(key),
        promptName: () => Promise.resolve('Named'),
        openTransfer: () => undefined,
        showMenu: (_evt, actions) => {
            log.menus.push(actions);
        },
        notify: (message) => {
            log.notices.push(message);
        },
        openPaletteExport: (colors) => {
            log.exports.push([...colors]);
        },
        openPaletteImport: (onImport) => {
            pendingImport = onImport;
        },
        confirm: (title) => {
            log.confirms.push(title);
            return Promise.resolve(answers.confirm);
        },
    };
    return {
        host,
        log,
        session,
        answers,
        /** Presses Import in the open import dialog with this text. */
        importText(text: string): void {
            const run = pendingImport;
            pendingImport = null;
            run?.(text);
        },
        get settings() {
            return settings;
        },
        attach(next: StudioPanel) {
            panel = next;
        },
    };
}

/** Renders a panel into the live document and hands back its parts. */
export function mount(initial?: NexusStudioSettings) {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const fake = makeHost(initial);
    const panel = new StudioPanel(root, fake.host);
    fake.attach(panel);
    panel.render();
    const q = <T extends Element>(selector: string) => root.querySelector<T>(selector);
    const group = (key: string) => q<HTMLElement>(`.nexus-studio-group[data-group="${key}"]`)!;
    const header = (key: string) =>
        group(key).querySelector<HTMLButtonElement>('.nexus-studio-group-header')!;
    const body = (key: string) => group(key).querySelector<HTMLElement>('.nexus-studio-group-body')!;
    const row = (key: string) => q<HTMLElement>(`.nexus-studio-row[data-token="${key}"]`)!;
    const inRow = <T extends Element>(key: string, selector: string) =>
        row(key).querySelector<T>(selector)!;
    // Not `...fake`: spreading evaluates the `settings` getter once, and every
    // assertion afterwards would read the settings as they were at mount.
    return {
        root,
        panel,
        host: fake.host,
        log: fake.log,
        session: fake.session,
        answers: fake.answers,
        importText: (text: string) => fake.importText(text),
        get settings() {
            return fake.settings;
        },
        q,
        group,
        header,
        body,
        row,
        inRow,
    };
}

/** Fires an event of any name, the way a real control would. */
export function fire(target: Element, type: string): void {
    target.dispatchEvent(new Event(type, { bubbles: true }));
}

/** Types a value into an input and fires `input`, as the browser does per keystroke. */
export function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    fire(input, 'input');
}
