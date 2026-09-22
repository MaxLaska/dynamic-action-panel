// smoke.mjs
// Drives a real ZotFlow reader in the disposable smoke vault and checks the
// things a unit test cannot see.
//
// Run against an Obsidian started like this (its own user-data-dir, so the
// user's real Obsidian is never involved):
//
//   Obsidian.exe --user-data-dir=<scratch> --remote-debugging-port=9333
//
// with the scratch dir's obsidian.json pointing at the smoke vault. The script
// never writes to a vault itself; it only drives the UI.

import { attach } from './cdp.mjs';

const PLUGIN_ID = 'zotflow-reader-extensions';
const READER_VIEW = 'zotflow-local-zotero-reader-view';
const PDF_A = 'other/ZotTest/Bieker-Westerholt-2021-Soziale_Arbeit_studieren-Aufl_5.pdf';
const PDF_B = 'other/Thole (2012) - Grundriss Soziale Arbeit/PaperB.pdf';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function check(label, passed, detail = '') {
    results.push({ label, passed, detail });
    const mark = passed ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`);
}

const session = await attach((t) => t.url.includes('index.html'));

/** Runs an expression inside the reader document of the nth reader leaf. */
const inReader = (nth, body) =>
    session.eval(`(() => {
        const leaves = window.app.workspace.getLeavesOfType(${JSON.stringify(READER_VIEW)});
        const leaf = leaves[${nth}];
        if (!leaf) return { error: 'no reader leaf ' + ${nth} };
        const frame = leaf.view.containerEl.querySelector('iframe');
        if (!frame || !frame.contentDocument) return { error: 'no reader document' };
        const d = frame.contentDocument;
        const W = frame.contentWindow;
        const R = (el) => el ? (r => ({ x: Math.round(r.x), w: Math.round(r.width) }))(el.getBoundingClientRect()) : null;
        ${body}
    })()`);

const state = (nth = 0) =>
    inReader(
        nth,
        `
        const toggle = d.getElementById('sidebarToggle');
        const sidebar = d.querySelector('#sidebarContainer');
        const doc = d.getElementById('split-view');
        return {
            applied: d.body.getAttribute('data-zfrx-side'),
            right: d.body.classList.contains('zfrx-sidebar-right'),
            open: d.body.classList.contains('sidebar-open'),
            styles: d.querySelectorAll('#zfrx-sidebar-style').length,
            toggleParent: toggle ? toggle.parentElement.className : null,
            toggleX: toggle ? Math.round(toggle.getBoundingClientRect().x) : null,
            toggleLastInEnd: toggle ? toggle === d.querySelector('.toolbar .end').lastElementChild : null,
            mirrored: toggle ? W.getComputedStyle(toggle).transform !== 'none' : null,
            toggleCount: d.querySelectorAll('.sidebar-toggle').length,
            sidebarCount: d.querySelectorAll('#sidebarContainer').length,
            sidebar: R(sidebar),
            doc: R(doc),
            firstInStart: (() => {
                const kids = [...d.querySelector('.toolbar .start').children]
                    .filter((c) => c.getBoundingClientRect().width > 0);
                return kids.length ? (kids[0].title || kids[0].className) : null;
            })(),
            endOrder: [...d.querySelector('.toolbar .end').children]
                .map((c) => ({ what: c.title || c.className, x: Math.round(c.getBoundingClientRect().x) }))
                .sort((a, b) => a.x - b.x)
                .map((c) => c.what),
            tabs: sidebar
                ? [...sidebar.querySelectorAll('.sidebar-toolbar .toolbar-button')]
                      .map((b) => ({ t: b.title, on: b.classList.contains('active') }))
                : null,
            viewport: W.innerWidth,
        };
    `
    );

/**
 * `state`, with the refusal that keeps a hidden tab from passing as agreement.
 *
 * A hidden leaf is not merely narrow: everything inside it is in a
 * `display: none` subtree, so every rectangle measures zero while the frame's
 * `innerWidth` keeps its last value. Checking the viewport alone therefore
 * misses it — the rectangles have to be checked too. Comparing two sets of
 * zeroes is how the first run of this suite reported a layout regression that
 * did not exist.
 */
async function visibleState(nth = 0) {
    const s = await state(nth);
    if (s.error) return s;
    if (!s.viewport || !s.doc || s.doc.w === 0) {
        throw new Error(
            `reader ${nth} measures zero — it is a hidden tab, and every measurement ` +
                `taken from it would be a meaningless zero (viewport=${s.viewport}, ` +
                `doc=${JSON.stringify(s.doc)})`
        );
    }
    return s;
}

const clickToggle = (nth = 0) =>
    inReader(nth, `d.getElementById('sidebarToggle').click(); return { ok: true };`);

/**
 * Brings a reader tab to the front before its geometry is measured.
 *
 * A hidden Obsidian leaf reports every rectangle as zero, so measuring one
 * produces a tidy set of zeroes that compare equal to each other and quietly
 * pass. Every geometric check below is preceded by this, and `state` refuses a
 * zero-width viewport outright, so that failure mode cannot come back.
 */
const focusReader = async (nth = 0) => {
    await session.eval(`(() => {
        const w = window.app.workspace;
        const leaf = w.getLeavesOfType(${JSON.stringify(READER_VIEW)})[${nth}];
        if (!leaf) return false;
        w.setActiveLeaf(leaf, { focus: true });
        w.revealLeaf(leaf);
        return true;
    })()`);
    await pause(700);
};

const setSide = (side) =>
    session.eval(
        `(async () => {
            await window.app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].setSide(${JSON.stringify(side)});
            return true;
        })()`
    );

const frameOffset = () =>
    session.eval(`(() => {
        const leaf = window.app.workspace.getLeavesOfType(${JSON.stringify(READER_VIEW)})[0];
        const r = leaf.view.containerEl.querySelector('iframe').getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y) };
    })()`);

async function dragResizer(fromX, toX, y = 300) {
    const offset = await frameOffset();
    const at = (x) => ({ x: offset.x + x, y: offset.y + y });
    const down = at(fromX);
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...down, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 10; i++) {
        const moved = at(fromX + ((toX - fromX) * i) / 10);
        await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...moved, button: 'left', buttons: 1 });
        await pause(30);
    }
    const up = at(toX);
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...up, button: 'left', buttons: 0, clickCount: 1 });
}

async function clickToggleWithMouse(button) {
    const offset = await frameOffset();
    const current = await state(0);
    const x = offset.x + current.toggleX + 14;
    const y = offset.y + 20;
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: button === 'right' ? 2 : 1, clickCount: 1 });
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 });
}

const openPdf = (path, newTab) =>
    session.eval(`(async () => {
        const app = window.app;
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
        const leaf = app.workspace.getLeaf(${newTab ? "'tab'" : 'true'});
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return true;
    })()`);

// ---------------------------------------------------------------- run

console.log('\n== plugin present ==');
const loaded = await session.eval(
    `(() => {
        const p = window.app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        return { loaded: !!p, side: p ? p.settings.sidebarSide : null };
    })()`
);
check('companion plugin is loaded', loaded.loaded === true, JSON.stringify(loaded));
check('default side is left', loaded.side === 'left', `side=${loaded.side}`);

console.log('\n== reader opens and is patched ==');
await session.eval(
    `(() => { const w = window.app.workspace; w.detachLeavesOfType(${JSON.stringify(READER_VIEW)}); try { w.leftSplit.collapse(); w.rightSplit.collapse(); } catch (e) {} return true; })()`
);
await pause(500);
await openPdf(PDF_A, false);
await pause(7000);
let s = await visibleState(0);
check('reader reports the applied side', s.applied === 'left', `applied=${s.applied}`);
check('exactly one injected stylesheet', s.styles === 1, `styles=${s.styles}`);
if (!s.open) {
    await clickToggle(0);
    await pause(1200);
    s = await visibleState(0);
}
const baseline = s;
check('LEFT: sidebar on the left edge', s.sidebar && s.sidebar.x === 0, JSON.stringify(s.sidebar));
check('LEFT: toggle in the start group', s.toggleParent === 'start', `parent=${s.toggleParent}`);
check('LEFT: icon not mirrored', s.mirrored === false);
check('LEFT: sidebar tabs present', (s.tabs ?? []).length === 3, JSON.stringify((s.tabs ?? []).map((t) => t.t)));

console.log('\n== LEFT toggle still works ==');
await clickToggle(0); await pause(1000);
let closed = await visibleState(0);
check('LEFT: closes', closed.open === false && closed.sidebarCount === 0);
check('LEFT: document takes the full width', closed.doc.x === 0 && closed.doc.w === closed.viewport, JSON.stringify(closed.doc));
await clickToggle(0); await pause(1000);
check('LEFT: reopens', (await visibleState(0)).open === true);

console.log('\n== switch to RIGHT ==');
await setSide('right'); await pause(1500);
s = await visibleState(0);
check('RIGHT: body flag set', s.right === true && s.applied === 'right');
check('RIGHT: sidebar on the right edge', s.sidebar && s.sidebar.x + s.sidebar.w === s.viewport, JSON.stringify(s.sidebar));
check('RIGHT: document reflows to the left, full remaining width', s.doc.x === 0 && s.doc.w === s.viewport - s.sidebar.w, JSON.stringify(s.doc));
check('RIGHT: toggle in the end group', s.toggleParent === 'end');
check('RIGHT: toggle is the outermost right element', s.toggleLastInEnd === true, s.endOrder.join(' -> '));
check('RIGHT: icon mirrored', s.mirrored === true);
check('RIGHT: no dead gap where the toggle was', s.firstInStart === 'Zoom Out', `first=${s.firstInStart}`);
check('RIGHT: exactly one toggle', s.toggleCount === 1);
check('RIGHT: exactly one sidebar', s.sidebarCount === 1);
check('RIGHT: still one stylesheet', s.styles === 1);

console.log('\n== RIGHT toggle works ==');
await clickToggle(0); await pause(1000);
closed = await visibleState(0);
check('RIGHT: closes', closed.open === false && closed.sidebarCount === 0);
check('RIGHT: toggle stays on the right while closed', closed.toggleParent === 'end');
await clickToggle(0); await pause(1000);
check('RIGHT: reopens', (await visibleState(0)).open === true);

console.log('\n== sidebar tabs on the right ==');
for (const want of ['Thumbnail', 'Outline', 'Annotation']) {
    await inReader(0, `
        const tabs = [...d.querySelectorAll('#sidebarContainer .sidebar-toolbar .toolbar-button')];
        const hit = tabs.find((b) => /${want}/i.test(b.title));
        if (hit) hit.click();
        return { ok: !!hit };
    `);
    await pause(900);
    const tabState = await visibleState(0);
    const active = (tabState.tabs ?? []).find((t) => t.on);
    check(`RIGHT: ${want} tab activates`, !!active && new RegExp(want, 'i').test(active.t), active ? active.t : 'none');
}

console.log('\n== right-hand resizer ==');
const before = await visibleState(0);
const handleX = before.sidebar.x;
await dragResizer(handleX, handleX - 80);
await pause(800);
let resized = await visibleState(0);
check('RIGHT: dragging inward widens the sidebar', resized.sidebar.w === before.sidebar.w + 80, `${before.sidebar.w} -> ${resized.sidebar.w}`);
check('RIGHT: document keeps the rest', resized.doc.w === resized.viewport - resized.sidebar.w, JSON.stringify(resized.doc));
await dragResizer(resized.sidebar.x, resized.sidebar.x + 80);
await pause(800);
resized = await visibleState(0);
check('RIGHT: dragging outward narrows it again', resized.sidebar.w === before.sidebar.w, `-> ${resized.sidebar.w}`);
await clickToggle(0); await pause(800); await clickToggle(0); await pause(1000);
check('RIGHT: width survives close/open', (await visibleState(0)).sidebar.w === resized.sidebar.w);

console.log('\n== mouse buttons stay separate ==');
const beforeClicks = await visibleState(0);
await clickToggleWithMouse('left'); await pause(1000);
const afterLeft = await visibleState(0);
check('left click toggles', afterLeft.open !== beforeClicks.open);
await clickToggleWithMouse('left'); await pause(1000);
await clickToggleWithMouse('right'); await pause(800);
const afterRight = await visibleState(0);
check('right click does not toggle', afterRight.open === beforeClicks.open);
const menu = await session.eval(
    `(() => {
        const items = [...document.querySelectorAll('.menu .menu-item')].map((i) => i.textContent.trim());
        return { count: items.length, items };
    })()`
);
check('right click opens a menu', menu.count >= 2, JSON.stringify(menu.items));
check('menu offers both sides', menu.items.some((i) => /left/i.test(i)) && menu.items.some((i) => /right/i.test(i)));
const checkedItem = await session.eval(
    `(() => {
        const marked = [...document.querySelectorAll('.menu .menu-item')]
            .filter((i) => i.classList.contains('is-checked') || i.querySelector('.menu-item-icon svg, .menu-item-icon .svg-icon'));
        return marked.map((i) => i.textContent.trim());
    })()`
);
check('menu marks the active side', checkedItem.some((i) => /right/i.test(i)), JSON.stringify(checkedItem));
await session.eval(`(() => { document.body.click(); return true; })()`);
await pause(400);

console.log('\n== a second reader is patched automatically ==');
await openPdf(PDF_B, true);
await pause(7000);
const second = await visibleState(1);
check('second reader exists', !second.error, second.error ?? '');
check('second reader is on the right too', second.right === true && second.applied === 'right');
check('second reader: toggle on the right', second.toggleParent === 'end' && second.toggleLastInEnd === true);
check('second reader: one toggle, one sidebar DOM', second.toggleCount === 1 && second.sidebarCount <= 1);
check('first reader unaffected', (await state(0)).applied === 'right');

console.log('\n== idempotence ==');
await focusReader(0);
const beforeRepeat = await visibleState(0);
await session.eval(`(() => { for (let i = 0; i < 5; i++) window.app.workspace.trigger('layout-change'); return true; })()`);
await pause(1500);
const afterRepeat = await visibleState(0);
check('repeated sync adds no stylesheet', afterRepeat.styles === 1, `styles=${afterRepeat.styles}`);
check('repeated sync adds no toggle', afterRepeat.toggleCount === 1);
check('repeated sync keeps the toggle in place', afterRepeat.toggleParent === beforeRepeat.toggleParent);
check('repeated sync keeps the width', afterRepeat.sidebar?.w === beforeRepeat.sidebar?.w);

console.log('\n== persistence ==');
const saved = await session.eval(
    `(async () => {
        const p = window.app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        return await p.loadData();
    })()`
);
check('preference is written to the plugin\'s own data', saved && saved.sidebarSide === 'right', JSON.stringify(saved));
const foreign = await session.eval(
    `(async () => {
        const zf = window.app.plugins.plugins['zotflow'];
        const zfData = zf ? await zf.loadData() : null;
        return { zotflowHasOurKey: zfData ? Object.keys(zfData).some((k) => /zfrx|sidebarSide/i.test(k)) : null };
    })()`
);
check('nothing of ours is written into ZotFlow settings', foreign.zotflowHasOurKey === false, JSON.stringify(foreign));

console.log('\n== back to LEFT is the baseline ==');
await setSide('left'); await pause(1500);
// The second PDF took the foreground; bring the measured reader back before
// comparing it against the baseline taken while it was visible.
await focusReader(0);
const restored = await visibleState(0);
check('LEFT: sidebar back on the left', restored.sidebar.x === 0);
check('LEFT: document back to its baseline offset', restored.doc.x === baseline.doc.x, `${restored.doc.x} vs ${baseline.doc.x}`);
check('LEFT: toggle back in the start group', restored.toggleParent === 'start');
check('LEFT: toggle back to its original x', restored.toggleX === baseline.toggleX, `${restored.toggleX} vs ${baseline.toggleX}`);
check('LEFT: icon not mirrored', restored.mirrored === false);
check('LEFT: right group back to baseline', JSON.stringify(restored.endOrder) === JSON.stringify(baseline.endOrder), restored.endOrder.join(' -> '));
check('LEFT: second reader followed too', (await state(1)).applied === 'left');

// ---------------------------------------------------------------- report
const failed = results.filter((r) => !r.passed);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  - ${f.label} ${f.detail}`);
}
session.close();
process.exit(failed.length ? 1 : 0);
