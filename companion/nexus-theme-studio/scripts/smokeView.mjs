// smokeView.mjs
// Drives a real Obsidian and checks the Theme Studio as a workspace view.
//
// Unit tests (tests/nexusStudioView.test.ts) render the panel into happy-dom.
// This checks what only a running Obsidian can answer: that the command opens
// ONE view in the right dock, that Obsidian's own stylesheets do not undo the
// fold, that the locator really repaints a dock, that the picker's `input`
// really repaints it live, and that `window.EyeDropper` exists in this Electron
// and can be opened from the view's window.
//
// Run against an Obsidian started on its OWN profile, never the user's:
//
//   Obsidian.exe --user-data-dir=<scratch> --remote-debugging-port=9333
//
// with that profile's obsidian.json registering one throwaway vault that has
// the Nexus theme, this plugin and Dynamic Action Panel installed. It writes
// nothing to any vault itself; the one token it edits through the UI it resets
// through the UI.
//
//   node companion/nexus-theme-studio/scripts/smokeView.mjs [screenshot.png]
//
// Note: the EyeDropper check opens the native screen sampler for about a second
// and then cancels it. The pointer is a pipette for that second.

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

console.log('\nloaded');
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
check('with a row for every token', firstOpen.rows === 11, String(firstOpen.rows));

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
check(
    'a fold stored by the old settings tab does not come back',
    foldState.every((g) => !g.hidden),
    JSON.stringify(foldState.filter((g) => g.hidden))
);

const fold = await cdp.evaluate(`
    const group = ${panel}.querySelector('.nexus-studio-group[data-group="workspace"]');
    const header = group.querySelector('.nexus-studio-group-header');
    const body = group.querySelector('.nexus-studio-group-body');
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
        cssHidden: getComputedStyle(r.querySelector('.nexus-studio-row-css')).display === 'none',
        chip: r.querySelector('.nexus-studio-value').textContent,
    };
`);
check('the reset says "Reset to default"', rowShape.reset === 'Reset to default', rowShape.reset);
check('the raw CSS field is closed by default', rowShape.cssHidden === true);
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

// --- live editing -------------------------------------------------------------------
//
// The profile may already override this token. Reset goes to the THEME default,
// not to that override, so the run records the stored value first and types it
// back in afterwards — through the raw CSS field, the way a user would.
console.log('\nlive editing');
const live = await cdp.evaluate(`
    const r = ${row('workspaceSurface')};
    const inline = () => document.body.style.getPropertyValue('--nexus-workspace-surface');
    const original = inline();

    const picker = r.querySelector('.nexus-studio-picker');
    picker.value = '#405060';
    picker.dispatchEvent(new Event('input', { bubbles: true }));
    const dock = ${dockColour};

    const reset = r.querySelector('.nexus-studio-reset');
    const resetEnabled = !reset.disabled;
    reset.click();
    const afterReset = { inline: inline(), resetDisabled: reset.disabled, chip: r.querySelector('.nexus-studio-value').textContent };

    if (original) {
        r.querySelector('.nexus-studio-value').click();
        const field = r.querySelector('.nexus-studio-css-input');
        field.value = original;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        r.querySelector('.nexus-studio-value').click();
    }
    return { dock, resetEnabled, afterReset, original, restored: inline() };
`);
check('an `input` from the picker repaints the dock immediately', live.dock === 'rgb(64, 80, 96)', live.dock);
check('the reset becomes available at once', live.resetEnabled === true);
check(
    'reset removes the override, so the theme default applies again',
    live.afterReset.inline === '' && live.afterReset.resetDisabled === true,
    JSON.stringify(live.afterReset)
);
check(
    'the value the profile had before the run is back',
    live.restored === live.original,
    JSON.stringify({ original: live.original, restored: live.restored })
);

// --- the screen sampler ---------------------------------------------------------------
console.log('\nthe screen sampler');
const eyedropper = await cdp.evaluate(`
    const available = typeof window.EyeDropper === 'function';
    const pipette = !!${row('workspaceSurface')}.querySelector('.nexus-studio-pipette');
    if (!available) return { available, pipette };
    const controller = new AbortController();
    const outcome = new EyeDropper()
        .open({ signal: controller.signal })
        .then((r) => ({ picked: r.sRGBHex }), (e) => ({ error: e.name }));
    setTimeout(() => controller.abort(), 1000);
    return { available, pipette, ...(await outcome) };
`);
check('window.EyeDropper exists in this Obsidian', eyedropper.available === true);
check('so the pipette is offered', eyedropper.pipette === true);
check(
    'the sampler opens from the studio window and cancels cleanly',
    eyedropper.error === 'AbortError',
    JSON.stringify(eyedropper)
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

// --- the plugin reloading under an open studio ------------------------------------------
//
// Disabling must leave the workspace as it was found: no inline token, no
// scratch sheet, no magenta. Enabling must bring the SAME leaf back where it
// was, rendered once, with nothing doubled.
console.log('\nthe plugin reloading while the studio is open');
const inlineNexus = `Array.from(document.body.style).filter((name) => name.startsWith('--nexus-')).length`;
await cdp.evaluate(`
    ${row('documentSurface')}.dispatchEvent(new PointerEvent('pointerenter'));
    await new Promise((r) => setTimeout(r, 300));
    await app.plugins.disablePlugin('${STUDIO}');
`);
await pause(500);
const whileOff = await cdp.evaluate(`
    return {
        inline: ${inlineNexus},
        scratch: document.querySelectorAll('#nexus-theme-studio-scratch').length,
        leaves: app.workspace.getLeavesOfType('${VIEW_TYPE}').length,
    };
`);
check('disabling leaves no Nexus override and no preview behind', whileOff.inline === 0, JSON.stringify(whileOff));
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
        magenta: Array.from(document.body.style)
            .filter((name) => name.startsWith('--nexus-'))
            .some((name) => document.body.style.getPropertyValue(name).trim() === '#ff00ff'),
    };
`);
check('re-enabling restores the one studio where it was', whileOn.leaves === 1 && whileOn.inRightDock, JSON.stringify(whileOn));
check('rendered once, not twice', whileOn.panels === 1 && whileOn.rows === 11);
check('with at most one scratch stylesheet', whileOn.scratch <= 1);
check('and no locator colour left over from before the reload', whileOn.magenta === false);

// --- a picture, for the human reviewing this ------------------------------------------
const shot = process.argv[2];
if (shot) {
    await cdp.evaluate(`
        const r = ${row('splitterHover')};
        r.querySelector('.nexus-studio-value').click();
    `);
    await pause(200);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(shot, Buffer.from(data, 'base64'));
    console.log(`\n  screenshot: ${shot}`);
}

check('no exception or console error during the run', cdp.problems.length === 0, cdp.problems.slice(0, 3).join(' | '));

const failed = results.filter((r) => !r.passed);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
cdp.close();
process.exit(failed.length ? 1 : 0);
