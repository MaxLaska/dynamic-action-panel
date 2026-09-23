// smokeView.mjs
// Drives a real Obsidian and checks the Theme Studio as a workspace view.
//
// Unit tests (tests/nexusStudioView.test.ts) render the panel into happy-dom.
// This checks what only a running Obsidian can answer: that the command opens
// ONE view in the right dock, that Obsidian's own stylesheets do not undo the
// fold, that the locator really repaints a dock, that the Nexus colour
// picker's drafts repaint it live and Escape restores it exactly, that Pick from
// Obsidian takes a real pixel by mouse and by keyboard, and that the picker
// stays readable and inside the window.
//
// Run against an Obsidian started on its OWN profile, never the user's:
//
//   Obsidian.exe --user-data-dir=<scratch> --remote-debugging-port=9333
//                --disable-features=CalculateNativeWinOcclusion
//
// The occlusion flag matters on Windows: once other windows cover the scratch
// window, Chromium marks it hidden and delivers NO input to it — neither CDP's
// nor `sendInputEvent`'s — so every click-driven check below would fail for a
// reason that has nothing to do with the studio. Seen live, not assumed.
//
// with that profile's obsidian.json registering one throwaway vault that has
// the Nexus theme, this plugin and Dynamic Action Panel installed. It writes
// nothing to any vault itself; the one token it edits through the UI it resets
// through the UI.
//
//   node companion/nexus-theme-studio/scripts/smokeView.mjs [screenshot.png]
//
// It never opens Chromium's native colour popup or its EyeDropper: the studio
// has no way into either any more, and this checks that there is none.

import fs from 'node:fs';

const PORT = 9333;
const STUDIO = 'nexus-theme-studio';
const VIEW_TYPE = 'nexus-theme-studio';
const COMMAND = `${STUDIO}:open-theme-studio`;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
function check(label, passed, detail = '') {
    results.push({ label, passed, detail });
    console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

/** A CDP session that also records exceptions and console errors. */
async function connect() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
    if (!page) throw new Error('No Obsidian window on port ' + PORT);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () => reject(new Error('ws error'));
    });
    let nextId = 0;
    const pending = new Map();
    const problems = [];
    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.method === 'Runtime.exceptionThrown') {
            problems.push(message.params.exceptionDetails?.exception?.description ?? 'exception');
        }
        if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
            problems.push(message.params.args.map((a) => a.value ?? a.description).join(' '));
        }
        if (!message.id || !pending.has(message.id)) return;
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
    };
    const send = (method, params = {}) =>
        new Promise((resolve, reject) => {
            const id = ++nextId;
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
        });
    const evaluate = async (expression) => {
        const result = await send('Runtime.evaluate', {
            expression: `(async () => { ${expression} })()`,
            returnByValue: true,
            awaitPromise: true,
            userGesture: true,
        });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        }
        return result.result?.value;
    };
    await send('Runtime.enable');
    return { send, evaluate, problems, close: () => ws.close() };
}

const cdp = await connect();

// --- a fresh profile starts in restricted mode --------------------------------
await cdp.evaluate(`
    document.querySelectorAll('.modal-container').forEach((m) => m.remove());
    if (!app.plugins.isEnabled()) await app.plugins.setEnable(true);
`);
for (let i = 0; i < 40; i += 1) {
    if (await cdp.evaluate(`return !!app.plugins.plugins['${STUDIO}'];`)) break;
    await pause(250);
}
cdp.problems.length = 0;

// The instance this runs against is a window nobody is looking at, and
// Chromium treats a covered window as hidden: measured, a 200ms timer took
// 488ms there and requestAnimationFrame did not fire at all. That would test
// the throttling, not the studio. Turning it off for THIS window makes it
// behave like the visible window a user actually works in.
await cdp.evaluate(`window.electron.remote.getCurrentWebContents().setBackgroundThrottling(false);`);
await pause(300);

// DevTools left open by an earlier run docks into the window, narrows the
// workspace and would make the Inspect checks read that run's state as this
// one's. Close it and wait until it really is closed.
await cdp.evaluate(`window.electron.remote.getCurrentWebContents().closeDevTools();`);
for (let i = 0; i < 30; i += 1) {
    if (!(await cdp.evaluate(`return window.electron.remote.getCurrentWebContents().isDevToolsOpened();`))) break;
    await pause(100);
}

// How many rows there should be, from the theme installed in this vault rather
// than from a number in this file that the next token makes wrong.
const expectedRows = await cdp.evaluate(`
    const css = await app.vault.adapter.read('.obsidian/themes/Nexus/theme.css');
    const block = css.slice(css.indexOf('>>> NEXUS TOKENS'), css.indexOf('<<< NEXUS TOKENS'));
    return (block.match(/--nexus-[a-z0-9-]+\\s*:/g) || []).length;
`);
const seeded = JSON.parse(await cdp.evaluate(`return await app.vault.adapter.read('.obsidian/plugins/${STUDIO}/data.json');`));

console.log('\nloaded');
check('the installed theme declares its tokens', expectedRows > 0, String(expectedRows));
check('the studio plugin loaded', await cdp.evaluate(`return !!app.plugins.plugins['${STUDIO}'];`));
// Nexus paints in the dark scheme only. In `.obsidian/appearance.json` the
// COMMUNITY theme is `cssTheme` and `theme` is the base scheme — "obsidian"
// for dark. A light instance would fail every colour check below for a reason
// that has nothing to do with the studio, so it is checked up front.
const scheme = await cdp.evaluate(
    `return { theme: app.customCss.theme, dark: document.body.classList.contains('theme-dark') };`
);
check('Nexus is the active theme', scheme.theme === 'Nexus', JSON.stringify(scheme));
check('in the dark scheme it paints', scheme.dark === true);

console.log('\nthe command, and no settings tab');
check(
    'the command is registered under its product name',
    (await cdp.evaluate(`return app.commands.commands['${COMMAND}']?.name ?? null;`)) ===
        'Nexus Theme Studio: Open Nexus Theme Studio',
    String(await cdp.evaluate(`return app.commands.commands['${COMMAND}']?.name ?? null;`))
);
check(
    'there is no settings tab for the studio any more',
    (await cdp.evaluate(`return app.setting.pluginTabs.some((tab) => tab.id === '${STUDIO}');`)) === false
);

// A note in the main area and the panel in the left dock, so the studio has
// real neighbours: the whole point of a view is designing beside them.
await cdp.evaluate(`
    const file = app.vault.getAbstractFileByPath('Probe.md');
    if (file) await app.workspace.getLeaf(false).openFile(file);
    app.commands.executeCommandById('dynamic-action-panel:open-panel');
`);
await pause(600);

console.log('\nopening');
await cdp.evaluate(`app.commands.executeCommandById('${COMMAND}');`);
await pause(800);
const firstOpen = await cdp.evaluate(`
    const leaves = app.workspace.getLeavesOfType('${VIEW_TYPE}');
    return {
        count: leaves.length,
        inRightDock: leaves[0] ? leaves[0].getRoot() === app.workspace.rightSplit : false,
        title: leaves[0]?.view?.getDisplayText?.() ?? null,
        rows: leaves[0]?.view?.contentEl.querySelectorAll('.nexus-studio-row').length ?? 0,
    };
`);
check('the command opens exactly one studio', firstOpen.count === 1, JSON.stringify(firstOpen));
check('in the right dock', firstOpen.inRightDock === true);
check('titled Nexus Theme Studio', firstOpen.title === 'Nexus Theme Studio');
check('with a row for every token', firstOpen.rows === expectedRows, `${firstOpen.rows} of ${expectedRows}`);

await cdp.evaluate(`app.workspace.setActiveLeaf(app.workspace.getLeavesOfType('markdown')[0], { focus: true });`);
await cdp.evaluate(`app.commands.executeCommandById('${COMMAND}');`);
await cdp.evaluate(`app.commands.executeCommandById('${COMMAND}');`);
await pause(600);
const again = await cdp.evaluate(`
    const leaves = app.workspace.getLeavesOfType('${VIEW_TYPE}');
    return { count: leaves.length, active: app.workspace.activeLeaf === leaves[0] };
`);
check('running it again reveals the same view instead of a second one', again.count === 1, JSON.stringify(again));
check('and focuses it', again.active === true);

const neighbours = await cdp.evaluate(`
    const visible = (el) => !!el && el.getBoundingClientRect().width > 0;
    const studio = app.workspace.getLeavesOfType('${VIEW_TYPE}')[0].view.containerEl;
    const note = app.workspace.getLeavesOfType('markdown')[0]?.view.containerEl;
    return { studio: visible(studio), note: visible(note) };
`);
check('the studio and a note are on screen at the same time', neighbours.studio && neighbours.note, JSON.stringify(neighbours));

// --- the migrated fold state ----------------------------------------------------
console.log('\nfolding');
const panel = `app.workspace.getLeavesOfType('${VIEW_TYPE}')[0].view.contentEl`;
const foldState = await cdp.evaluate(`
    return Array.from(${panel}.querySelectorAll('.nexus-studio-group')).map((g) => ({
        key: g.dataset.group,
        hidden: getComputedStyle(g.querySelector('.nexus-studio-group-body')).display === 'none',
    }));
`);
if ((seeded.version ?? 1) < 2) {
    check(
        'a fold stored by the old settings tab does not come back',
        foldState.every((g) => !g.hidden),
        JSON.stringify(foldState.filter((g) => g.hidden))
    );
} else {
    // A file the view wrote: its fold is real, and it must come back exactly.
    const stored = new Set(seeded.collapsedGroups ?? []);
    check(
        'the fold the view stored comes back exactly',
        foldState.every((g) => g.hidden === stored.has(g.key)),
        JSON.stringify({ stored: [...stored], shown: foldState })
    );
}

const fold = await cdp.evaluate(`
    const group = ${panel}.querySelector('.nexus-studio-group[data-group="workspace"]');
    const header = group.querySelector('.nexus-studio-group-header');
    const body = group.querySelector('.nexus-studio-group-body');
    if (header.getAttribute('aria-expanded') === 'false') header.click();
    header.click();
    const closed = {
        display: getComputedStyle(body).display,
        expanded: header.getAttribute('aria-expanded'),
        headerHeight: header.getBoundingClientRect().height,
    };
    header.click();
    const open = { display: getComputedStyle(body).display, expanded: header.getAttribute('aria-expanded') };
    return { closed, open };
`);
check(
    'clicking the header really hides the controls, with Obsidian\'s stylesheets loaded',
    fold.closed.display === 'none' && fold.closed.expanded === 'false',
    JSON.stringify(fold.closed)
);
check('the header stays on screen while folded', fold.closed.headerHeight > 0);
check('clicking again brings them back', fold.open.display !== 'none' && fold.open.expanded === 'true');

// --- the row ----------------------------------------------------------------------
console.log('\nthe row');
const row = (key) => `${panel}.querySelector('.nexus-studio-row[data-token="${key}"]')`;
const rowShape = await cdp.evaluate(`
    const r = ${row('workspaceSurface')};
    return {
        reset: r.querySelector('.nexus-studio-reset').getAttribute('aria-label'),
        swatch: r.querySelector('.nexus-studio-swatch')?.tagName,
        extras: r.querySelectorAll('input, .nexus-studio-pipette, .nexus-studio-row-css').length,
        nativeAnywhere: document.querySelectorAll('input[type="color"]').length,
        chip: r.querySelector('.nexus-studio-value').textContent,
    };
`);
check('the reset says "Reset to default"', rowShape.reset === 'Reset to default', rowShape.reset);
check('a colour row is a swatch button and a readout, nothing else', rowShape.swatch === 'BUTTON' && rowShape.extras === 0, JSON.stringify(rowShape));
check('no native colour input exists anywhere in Obsidian', rowShape.nativeAnywhere === 0);
check('the value readout is compact', /^#[0-9a-f]{6}$/.test(rowShape.chip), rowShape.chip);

// --- the locator --------------------------------------------------------------------
console.log('\nthe locator');
const dockColour = `getComputedStyle(document.querySelector('.workspace-split.mod-left-split')).backgroundColor`;
const token = `getComputedStyle(document.body).getPropertyValue('--nexus-workspace-surface').trim()`;
const before = await cdp.evaluate(`return { token: ${token}, dock: ${dockColour} };`);
const dataBefore = await cdp.evaluate(`return await app.vault.adapter.read('.obsidian/plugins/${STUDIO}/data.json');`);
await cdp.evaluate(`${row('workspaceSurface')}.dispatchEvent(new PointerEvent('pointerenter'));`);
await pause(350);
const during = await cdp.evaluate(`return { token: ${token}, dock: ${dockColour} };`);
await cdp.evaluate(`${row('workspaceSurface')}.dispatchEvent(new PointerEvent('pointerleave'));`);
await pause(50);
const after = await cdp.evaluate(`return { token: ${token}, dock: ${dockColour} };`);
const dataAfter = await cdp.evaluate(`return await app.vault.adapter.read('.obsidian/plugins/${STUDIO}/data.json');`);
check('resting on Workspace surface paints the real dock magenta', during.dock === 'rgb(255, 0, 255)', during.dock);
check('leaving restores it exactly', after.token === before.token && after.dock === before.dock, JSON.stringify({ before, after }));
check('and nothing was written to data.json', dataAfter === dataBefore);

// --- the Nexus colour picker ----------------------------------------------------------
//
// The profile may already override this token. Reset goes to the THEME default,
// not to that override, so the run records the stored value first and puts it
// back afterwards, through the picker's CSS field, the way a user would.
console.log('\nthe colour picker');
const popover = `document.querySelector('.nexus-studio-popover')`;
const openPicker = (key) =>
    cdp.evaluate(`${row(key)}.querySelector('.nexus-studio-swatch').click(); await new Promise((r) => setTimeout(r, 60));`);
const pressKey = async (key, code = key, keyCode = 0) => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
};
const escape = () => pressKey('Escape', 'Escape', 27);
const inline = (variable) => `document.body.style.getPropertyValue('${variable}')`;
const readData = () => cdp.evaluate(`return await app.vault.adapter.read('.obsidian/plugins/${STUDIO}/data.json');`);

const original = await cdp.evaluate(`return ${inline('--nexus-workspace-surface')};`);
const dataAtOpen = await readData();
await openPicker('workspaceSurface');
const opened = await cdp.evaluate(`
    const p = ${popover};
    if (!p) return null;
    const box = p.getBoundingClientRect();
    return {
        count: document.querySelectorAll('.nexus-studio-popover').length,
        inside: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
        box: [Math.round(box.left), Math.round(box.top), Math.round(box.right), Math.round(box.bottom), innerWidth, innerHeight],
        native: p.querySelectorAll('input[type="color"]').length,
        focus: document.activeElement?.className,
    };
`);
check('the swatch opens one Nexus picker', opened?.count === 1, JSON.stringify(opened));
check('placed inside the window, beside a right-dock swatch', opened?.inside === true, JSON.stringify(opened?.box));
check('with nothing native in it, and the square focused', opened?.native === 0 && /nexus-studio-cp-area/.test(opened?.focus ?? ''), JSON.stringify(opened));

const draft = await cdp.evaluate(`
    const hue = ${popover}.querySelector('.nexus-studio-cp-hue');
    const hex = ${popover}.querySelector('.nexus-studio-cp-field[data-field="hex"]');
    hex.value = '#405060';
    hex.dispatchEvent(new Event('input', { bubbles: true }));
    const dock = ${dockColour};
    hue.value = '0';
    hue.dispatchEvent(new Event('input', { bubbles: true }));
    return { dock, dockAfterHue: ${dockColour} };
`);
await pause(700);
check('a draft repaints the dock at once', draft.dock === 'rgb(64, 80, 96)', draft.dock);
check('and follows the hue bar while it moves', draft.dockAfterHue !== draft.dock, draft.dockAfterHue);
check('a draft is not saved, even after the save debounce', (await readData()) === dataAtOpen);
await escape();
await pause(100);
const afterEsc = await cdp.evaluate(`return { popover: !!${popover}, inline: ${inline('--nexus-workspace-surface')}, dock: ${dockColour} };`);
check('Escape closes the picker and restores the value exactly', !afterEsc.popover && afterEsc.inline === original && afterEsc.dock === before.dock, JSON.stringify(afterEsc));
check('and writes nothing', (await readData()) === dataAtOpen);

await openPicker('workspaceSurface');
const committed = await cdp.evaluate(`
    const hex = ${popover}.querySelector('.nexus-studio-cp-field[data-field="hex"]');
    hex.value = '#405060';
    hex.dispatchEvent(new Event('input', { bubbles: true }));
    ${popover}.querySelector('.nexus-studio-cp-format[data-format="hsl"]').click();
    const afterFormat = ${inline('--nexus-workspace-surface')};
    const readout = ${popover}.querySelector('.nexus-studio-cp-readout').textContent;
    ${popover}.querySelector('.nexus-studio-cp-format[data-format="hex"]').click();
    ${popover}.querySelector('.nexus-studio-cp-done').click();
    const r = ${row('workspaceSurface')};
    return { afterFormat, readout, inline: ${inline('--nexus-workspace-surface')}, resetEnabled: !r.querySelector('.nexus-studio-reset').disabled, popover: !!${popover} };
`);
await pause(700);
check('switching the format changes the display, not the value', committed.afterFormat === '#405060' && /^hsl\(/.test(committed.readout), JSON.stringify(committed));
check('Done keeps the colour and closes', committed.inline === '#405060' && !committed.popover, JSON.stringify(committed));
check('and saves it, once the debounce has passed', JSON.parse(await readData()).profiles.some((profile) => profile.overrides?.workspaceSurface === '#405060'));
check('the reset becomes available at once', committed.resetEnabled === true);

const afterReset = await cdp.evaluate(`
    const r = ${row('workspaceSurface')};
    r.querySelector('.nexus-studio-reset').click();
    return { inline: ${inline('--nexus-workspace-surface')}, resetDisabled: r.querySelector('.nexus-studio-reset').disabled };
`);
check('reset removes the override, so the theme default applies again', afterReset.inline === '' && afterReset.resetDisabled === true, JSON.stringify(afterReset));

// Alpha, in the picker, on a translucent token.
await openPicker('splitterHover');
const alpha = await cdp.evaluate(`
    const bar = ${popover}.querySelector('.nexus-studio-cp-alpha');
    const number = ${popover}.querySelector('.nexus-studio-cp-alpha-number');
    const at = { bar: bar?.value, number: number?.value };
    bar.value = '60';
    bar.dispatchEvent(new Event('input', { bubbles: true }));
    return { at, draft: ${inline('--nexus-splitter-hover')}, readout: ${row('splitterHover')}.querySelector('.nexus-studio-alpha-readout').textContent };
`);
await escape();
await pause(100);
check('opacity lives in the picker, at the stored value', alpha.at.bar === '28' && alpha.at.number === '28', JSON.stringify(alpha.at));
check('and moves the draft live, with the row saying how much', alpha.draft === 'rgba(255, 255, 255, 0.6)' && alpha.readout === '60%', JSON.stringify(alpha));

// Custom CSS is kept as written.
if (original) {
    // Put the user's own value back first, through the picker's CSS field.
    await openPicker('workspaceSurface');
    await cdp.evaluate(`
        const p = ${popover};
        p.querySelector('.nexus-studio-cp-advanced-toggle').click();
        const f = p.querySelector('.nexus-studio-cp-css');
        f.value = ${JSON.stringify(original)};
        f.dispatchEvent(new Event('input', { bubbles: true }));
        p.querySelector('.nexus-studio-cp-done').click();
    `);
}
check(
    'the value the profile had before the run is back',
    (await cdp.evaluate(`return ${inline('--nexus-workspace-surface')};`)) === original,
    original
);

// --- the theme changing under an open studio -------------------------------------------
//
// Found in live use: the "Nexus is not selected" note stayed up after Nexus had
// been selected, because nothing re-checked it. Obsidian announces a loaded
// theme with `css-change`, and the studio now listens.
console.log('\nthe theme changing while the studio is open');
const noteShown = () =>
    cdp.evaluate(`return !!${panel}.querySelector('.nexus-studio-warning');`);
const rowIdentity = `${panel}.querySelector('.nexus-studio-row')`;
await cdp.evaluate(`window.__nexusRow = ${rowIdentity}; app.customCss.setTheme('');`);
await pause(900);
check('choosing another theme brings the note up', (await noteShown()) === true);
await cdp.evaluate(`app.customCss.setTheme('Nexus');`);
await pause(900);
check('choosing Nexus again takes it down', (await noteShown()) === false);
check(
    'without rebuilding the panel',
    (await cdp.evaluate(`return window.__nexusRow === ${rowIdentity};`)) === true
);

// --- the control plane ---------------------------------------------------------------
//
// The rule: the studio does not consume the user-editable presentation tokens
// for its own UI. Push text and docks to near-black; Obsidian must follow, the
// studio must not.
console.log('\nthe studio as a control plane');
// Colours through the picker's CSS field, then Done; other kinds through the
// row's own raw CSS field. The same paths a user has.
const setToken = (key, value) =>
    cdp.evaluate(`
        const r = ${row(key)};
        if (r.classList.contains('is-color')) {
            r.querySelector('.nexus-studio-swatch').click();
            const p = document.querySelector('.nexus-studio-popover');
            if (p.querySelector('.nexus-studio-cp-advanced').hidden) p.querySelector('.nexus-studio-cp-advanced-toggle').click();
            const f = p.querySelector('.nexus-studio-cp-css');
            f.value = ${JSON.stringify(value)};
            f.dispatchEvent(new Event('input', { bubbles: true }));
            p.querySelector('.nexus-studio-cp-done').click();
            return;
        }
        r.querySelector('.nexus-studio-value').click();
        const f = r.querySelector('.nexus-studio-css-input');
        f.value = ${JSON.stringify(value)};
        f.dispatchEvent(new Event('input', { bubbles: true }));
        r.querySelector('.nexus-studio-value').click();
    `);
const clearToken = (key) =>
    cdp.evaluate(`
        const reset = ${row(key)}.querySelector('.nexus-studio-reset');
        if (!reset.disabled) reset.click();
    `);
const studioLooks = () =>
    cdp.evaluate(`
        const label = ${panel}.querySelector('.nexus-studio-row-label');
        return {
            text: getComputedStyle(label).color,
            surface: getComputedStyle(${panel}).backgroundColor,
            size: getComputedStyle(label).fontSize,
            font: getComputedStyle(label).fontFamily,
        };
    `);
const obsidianText = `getComputedStyle(document.querySelector('.nav-file-title, .tree-item-self') ?? document.body).color`;

const calm = await studioLooks();
await setToken('textPrimary', '#111111');
await setToken('textMuted', '#121212');
await setToken('workspaceSurface', '#141414');
await pause(150);
const dark = await studioLooks();
const explorerText = await cdp.evaluate(`return ${obsidianText};`);
check('Obsidian follows a near-black text token', explorerText === 'rgb(18, 18, 18)' || explorerText === 'rgb(17, 17, 17)', explorerText);
check(
    'the studio\'s own text and surface do not',
    dark.text === calm.text && dark.surface === calm.surface,
    JSON.stringify({ calm, dark })
);

await cdp.evaluate(`${row('workspaceSurface')}.dispatchEvent(new PointerEvent('pointerenter'));`);
await pause(350);
const located = await cdp.evaluate(`
    return {
        dock: ${dockColour},
        studio: getComputedStyle(${panel}).backgroundColor,
    };
`);
await cdp.evaluate(`${row('workspaceSurface')}.dispatchEvent(new PointerEvent('pointerleave'));`);
check('the locator paints the dock', located.dock === 'rgb(255, 0, 255)', located.dock);
check('and not the studio lying on it', located.studio === calm.surface, located.studio);

await cdp.evaluate(`${row('textPrimary')}.dispatchEvent(new PointerEvent('pointerenter'));`);
await pause(350);
const locatedText = await studioLooks();
await cdp.evaluate(`${row('textPrimary')}.dispatchEvent(new PointerEvent('pointerleave'));`);
check('locating the text token leaves the studio\'s text alone', locatedText.text === calm.text, locatedText.text);

// The picker is on the control plane too: open it while text and docks are dark.
await openPicker('workspaceSurface');
const pickerLooks = await cdp.evaluate(`
    const p = ${popover};
    return {
        text: getComputedStyle(p.querySelector('.nexus-studio-cp-title')).color,
        field: getComputedStyle(p.querySelector('.nexus-studio-cp-field')).color,
        surface: getComputedStyle(p).backgroundColor,
    };
`);
await escape();
await pause(100);
check(
    'the picker stays readable while the text token is near-black',
    pickerLooks.text === calm.text && pickerLooks.field !== 'rgb(17, 17, 17)' && pickerLooks.surface !== 'rgb(20, 20, 20)',
    JSON.stringify(pickerLooks)
);

await clearToken('textPrimary');
await clearToken('textMuted');
await clearToken('workspaceSurface');

// --- typography ------------------------------------------------------------------
console.log('\ntypography');
const explorerSize = `getComputedStyle(document.querySelector('.nav-file-title, .tree-item-self')).fontSize`;
const sizeBefore = await cdp.evaluate(`return ${explorerSize};`);
await cdp.evaluate(`
    const slider = ${row('uiFontSize')}.querySelector('.nexus-studio-range');
    slider.value = '16';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
`);
await pause(100);
const sizeAfter = await cdp.evaluate(`return ${explorerSize};`);
const studioAfterSize = await studioLooks();
check('the UI text size slider reaches Obsidian live', sizeBefore === '13px' && sizeAfter === '16px', `${sizeBefore} → ${sizeAfter}`);
check('and not the studio', studioAfterSize.size === calm.size, studioAfterSize.size);

await cdp.evaluate(`
    const select = ${row('uiFontFamily')}.querySelector('.nexus-studio-font-select');
    select.value = 'Georgia, "Times New Roman", serif';
    select.dispatchEvent(new Event('change', { bubbles: true }));
`);
await pause(100);
const bodyFont = await cdp.evaluate(`return getComputedStyle(document.body).fontFamily;`);
const studioAfterFont = await studioLooks();
check('a font suggestion reaches the interface', /Georgia/.test(bodyFont), bodyFont);
check('and not the studio', studioAfterFont.font === calm.font, studioAfterFont.font);

await clearToken('uiFontSize');
await clearToken('uiFontFamily');
const sizeReset = await cdp.evaluate(`return ${explorerSize};`);
check('reset returns the interface to 13px', sizeReset === '13px', sizeReset);

// --- contrast -----------------------------------------------------------------------
console.log('\ncontrast');
const figure = (pair) =>
    cdp.evaluate(`
        const r = ${panel}.querySelector('[data-pair="${pair}"]');
        return { text: r.querySelector('.nexus-studio-contrast-figure').textContent, cls: r.className };
    `);
const fine = await figure('textPrimary:workspaceSurface');
check('the default text on the docks reads as enough', /✓$/.test(fine.text), fine.text);
await setToken('textPrimary', '#3a3a3a');
await pause(50);
const poor = await figure('textPrimary:workspaceSurface');
check('text sunk into its surface is flagged at once', /is-too-low|is-large-only/.test(poor.cls), poor.text);
const textStill = await cdp.evaluate(`return document.body.style.getPropertyValue('--nexus-text-primary');`);
check('and nothing is changed for the user', textStill === '#3a3a3a', textStill);
await setToken('textPrimary', 'color-mix(in srgb, #ffffff 90%, #000000)');
await pause(50);
const mixed = await figure('textPrimary:workspaceSurface');
check('a color-mix() is resolved by the browser and measured', /^\d+\.\d:1/.test(mixed.text), mixed.text);
await clearToken('textPrimary');

// --- Pick from Obsidian, end to end with a real mouse and keyboard ---------------------
console.log('\ntaking a colour');
const dockPoint = await cdp.evaluate(`
    const dock = document.querySelector('.workspace-split.mod-left-split .workspace-leaf');
    const r = dock.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.85), colour: getComputedStyle(dock).backgroundColor };
`);
const clickAt = async (x, y) => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const shieldUp = () => cdp.evaluate(`return !!document.querySelector('.nexus-studio-pick-shield');`);
const toHex = (rgb) => '#' + rgb.match(/\d+/g).slice(0, 3).map((v) => Number(v).toString(16).padStart(2, '0')).join('');
const chromeDraft = () => cdp.evaluate(`return ${inline('--nexus-document-chrome')};`);
const chromeBefore = await chromeDraft();

await openPicker('documentChrome');
// A draft that is NOT the dock's colour first: taking a pixel equal to the
// starting value would rightly change nothing, and prove nothing.
await cdp.evaluate(`
    const hex = ${popover}.querySelector('.nexus-studio-cp-field[data-field="hex"]');
    hex.value = '#010203';
    hex.dispatchEvent(new Event('input', { bubbles: true }));
    ${popover}.querySelector('.nexus-studio-cp-sample').click();
`);
await pause(150);
const aiming = await cdp.evaluate(`return { shield: !!document.querySelector('.nexus-studio-pick-shield'), hidden: getComputedStyle(${popover}).visibility };`);
check('Pick from Obsidian lays its crosshair layer and steps the picker aside', aiming.shield && aiming.hidden === 'hidden', JSON.stringify(aiming));
await clickAt(dockPoint.x, dockPoint.y);
await pause(600);
const byMouse = await cdp.evaluate(`
    const p = ${popover};
    return { draft: ${inline('--nexus-document-chrome')}, open: !!p, visible: p && getComputedStyle(p).visibility, hex: p?.querySelector('.nexus-studio-cp-field[data-field="hex"]')?.value };
`);
check('a click on the dock takes exactly its colour, into the open picker', byMouse.draft === toHex(dockPoint.colour) && byMouse.hex === byMouse.draft, `${JSON.stringify(byMouse)} vs ${dockPoint.colour}`);
check('the picker is back, and the layer is gone', byMouse.open && byMouse.visible === 'visible' && !(await shieldUp()), JSON.stringify(byMouse));

// The keyboard: aim with the arrows, take with Enter. The reticle starts at
// the last mouse position, on the dock.
await cdp.evaluate(`
    const hex = ${popover}.querySelector('.nexus-studio-cp-field[data-field="hex"]');
    hex.value = '#010203';
    hex.dispatchEvent(new Event('input', { bubbles: true }));
    ${popover}.querySelector('.nexus-studio-cp-sample').click();
`);
await pause(150);
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dockPoint.x, y: dockPoint.y });
await pressKey('ArrowRight', 'ArrowRight', 39);
await pressKey('ArrowUp', 'ArrowUp', 38);
const reticle = await cdp.evaluate(`const r = document.querySelector('.nexus-studio-pick-reticle'); return r ? { hidden: r.hidden, left: r.style.left, top: r.style.top } : null;`);
check('arrows move a reticle of its own, one pixel at a time', reticle && !reticle.hidden && reticle.left === `${dockPoint.x + 1}px` && reticle.top === `${dockPoint.y - 1}px`, JSON.stringify(reticle));
await pressKey('Enter', 'Enter', 13);
await pause(600);
const byKeyboard = await cdp.evaluate(`return ${popover}?.querySelector('.nexus-studio-cp-field[data-field="hex"]')?.value;`);
check('Enter takes the pixel under it', byKeyboard === toHex(dockPoint.colour), byKeyboard);

await cdp.evaluate(`${popover}.querySelector('.nexus-studio-cp-sample').click();`);
await pause(150);
await escape();
await pause(200);
const escAiming = await cdp.evaluate(`return { shield: !!document.querySelector('.nexus-studio-pick-shield'), open: !!${popover} };`);
check('Escape while aiming ends the pick and keeps the picker', !escAiming.shield && escAiming.open, JSON.stringify(escAiming));
await escape();
await pause(100);
const escPicker = await cdp.evaluate(`return { open: !!${popover}, draft: ${inline('--nexus-document-chrome')} };`);
check('a second Escape closes the picker with nothing kept', !escPicker.open && escPicker.draft === chromeBefore, JSON.stringify({ escPicker, chromeBefore }));

// --- the palette ---------------------------------------------------------------------------
console.log('\nthe palette');
const swatchesBefore = JSON.parse(await readData()).savedSwatches ?? [];
await openPicker('splitterHover');
await cdp.evaluate(`${popover}.querySelector('.nexus-studio-cp-add').click();`);
await pause(300);
const saved = JSON.parse(await readData()).savedSwatches ?? [];
check('+ saves the current colour, opacity included, to data.json at once', saved.includes('rgba(255, 255, 255, 0.28)'), JSON.stringify(saved));
const added = saved.length - swatchesBefore.length;
// Delete what this run added, with the keyboard, so the palette is left as found.
if (added === 1) {
    await cdp.evaluate(`
        const all = ${popover}.querySelectorAll('.nexus-studio-cp-swatch');
        all[all.length - 1].focus();
    `);
    await pressKey('Delete', 'Delete', 46);
    await pause(300);
}
await escape();
await pause(100);
check('Delete on a focused swatch removes it again', JSON.stringify(JSON.parse(await readData()).savedSwatches ?? []) === JSON.stringify(swatchesBefore));

// --- Inspect UI, end to end ------------------------------------------------------------
console.log('\nInspect UI');
const wcState = `(() => { const wc = window.electron.remote.getCurrentWebContents(); return { attached: wc.debugger.isAttached(), devtools: wc.isDevToolsOpened() }; })()`;
await cdp.evaluate(`${panel}.querySelector('[data-tool="inspect"]').click();`);
await pause(400);
const picking = await cdp.evaluate(`return ${wcState};`);
check('Inspect UI switches on DevTools\' element picker', picking.attached === true && picking.devtools === false, JSON.stringify(picking));
await clickAt(dockPoint.x, dockPoint.y);
await pause(1500);
const inspected = await cdp.evaluate(`return ${wcState};`);
check('clicking an element opens DevTools on it and lets go', inspected.devtools === true && inspected.attached === false, JSON.stringify(inspected));
// Closing DevTools is asynchronous. Wait until it is really closed, or the
// next check would read the previous step's DevTools as this step's.
await cdp.evaluate(`window.electron.remote.getCurrentWebContents().closeDevTools();`);
for (let i = 0; i < 30; i += 1) {
    if (!(await cdp.evaluate(`return ${wcState};`)).devtools) break;
    await pause(100);
}
const beforeEscape = await cdp.evaluate(`return ${wcState};`);

await cdp.evaluate(`${panel}.querySelector('[data-tool="inspect"]').click();`);
await pause(400);
await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await pause(400);
const escaped = await cdp.evaluate(`return ${wcState};`);
check(
    'Escape switches the picker off without opening DevTools',
    beforeEscape.devtools === false && escaped.attached === false && escaped.devtools === false,
    JSON.stringify({ beforeEscape, escaped })
);

// --- the plugin reloading under an open studio ------------------------------------------
//
// Disabling must leave the workspace as it was found: no inline token, no
// scratch sheet, no magenta. Enabling must bring the SAME leaf back where it
// was, rendered once, with nothing doubled.
console.log('\nthe plugin reloading while the studio is open');
const inlineNexus = `Array.from(document.body.style).filter((name) => name.startsWith('--nexus-')).length`;
// A picker is left open with a draft on screen: disabling must take both away.
await openPicker('documentSurface');
await cdp.evaluate(`
    const hex = document.querySelector('.nexus-studio-popover .nexus-studio-cp-field[data-field="hex"]');
    hex.value = '#ff0000';
    hex.dispatchEvent(new Event('input', { bubbles: true }));
`);
await cdp.evaluate(`
    await app.plugins.disablePlugin('${STUDIO}');
`);
await pause(500);
const whileOff = await cdp.evaluate(`
    return {
        inline: ${inlineNexus},
        scratch: document.querySelectorAll('#nexus-theme-studio-scratch').length,
        leaves: app.workspace.getLeavesOfType('${VIEW_TYPE}').length,
        popovers: document.querySelectorAll('.nexus-studio-popover').length,
        shields: document.querySelectorAll('.nexus-studio-pick-shield').length,
    };
`);
check('disabling leaves no Nexus override, no draft and no preview behind', whileOff.inline === 0, JSON.stringify(whileOff));
check('and no picker or pick layer', whileOff.popovers === 0 && whileOff.shields === 0, JSON.stringify(whileOff));
check('and no scratch stylesheet', whileOff.scratch === 0);

await cdp.evaluate(`await app.plugins.enablePlugin('${STUDIO}');`);
await pause(1200);
const whileOn = await cdp.evaluate(`
    const leaves = app.workspace.getLeavesOfType('${VIEW_TYPE}');
    const view = leaves[0]?.view;
    return {
        leaves: leaves.length,
        inRightDock: leaves[0] ? leaves[0].getRoot() === app.workspace.rightSplit : false,
        panels: view?.contentEl?.querySelectorAll('.nexus-studio-profile').length ?? 0,
        rows: view?.contentEl?.querySelectorAll('.nexus-studio-row').length ?? 0,
        scratch: document.querySelectorAll('#nexus-theme-studio-scratch').length,
        // A row the pointer rests on after the reload may light up — that is
        // the locator working. A colour with no hovered row behind it is a
        // leftover. (The scratch window is on screen; a real cursor over the
        // studio is possible, and was seen.)
        magenta: Array.from(document.body.style)
            .filter((name) => name.startsWith('--nexus-'))
            .filter((name) => document.body.style.getPropertyValue(name).trim() === '#ff00ff')
            .filter((name) => !document.querySelector('.nexus-studio-row:hover'))
            .length > 0,
        draft: document.body.style.getPropertyValue('--nexus-document-surface'),
    };
`);
check('re-enabling restores the one studio where it was', whileOn.leaves === 1 && whileOn.inRightDock, JSON.stringify(whileOn));
check('rendered once, not twice', whileOn.panels === 1 && whileOn.rows === expectedRows, JSON.stringify(whileOn));
check('with at most one scratch stylesheet', whileOn.scratch <= 1);
check('and no locator colour left over from before the reload', whileOn.magenta === false);
check('and not the draft that was open when it was disabled', whileOn.draft !== '#ff0000', whileOn.draft);

// --- a picture, for the human reviewing this ------------------------------------------
const shot = process.argv[2];
if (shot) {
    await openPicker('splitterHover');
    await pause(200);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(shot, Buffer.from(data, 'base64'));
    await escape();
    console.log(`\n  screenshot: ${shot}`);
}

check('no exception or console error during the run', cdp.problems.length === 0, cdp.problems.slice(0, 3).join(' | '));

const failed = results.filter((r) => !r.passed);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
cdp.close();
process.exit(failed.length ? 1 : 0);
