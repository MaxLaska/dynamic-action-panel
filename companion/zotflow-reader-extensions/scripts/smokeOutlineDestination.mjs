// smokeOutlineDestination.mjs
// The acceptance test for "a section shortcut lands where the outline lands".
//
// For each named outline entry it does the same thing twice and compares the
// result: once by clicking the reader's own outline, once by dropping that
// entry on a panel cell and pressing the tool. The comparison is the actual
// scroll offset of the PDF viewer, not the page number — landing on the right
// page while sitting half a screen too low is exactly the failure this exists
// to catch.
//
// Two measurement rules, both learned the hard way:
//
// - EVERY reading waits for the scroll to settle. The reader animates, and
//   renders pages lazily, so a value read too early is a value from the middle
//   of the journey: the same native click measured 4627 mid-flight and 5734
//   settled. Comparing unsettled numbers invents differences that do not exist.
// - Both routes start from the SAME far-away page, so neither is helped by the
//   destination already being on screen.
//
// Setup as in smoke.mjs: Obsidian with its own user-data-dir and
// --remote-debugging-port=9333 on the disposable smoke vault, panel view open.

import { attach } from './cdp.mjs';

const PANEL = 'dynamic-action-panel';
const PANEL_VIEW = 'buttons-panel-view';
const READER_VIEW = 'zotflow-local-zotero-reader-view';
const MIME = 'application/x-dap-reader-object';
const PDF = 'other/ZotTest/Bieker-Westerholt-2021-Soziale_Arbeit_studieren-Aufl_5.pdf';
/** A page nobody is near, so every run starts from the same cold distance. */
const PARK_PAGE = 60;

const ENTRIES = [
    'Deckblatt',
    'Titelseite',
    'Impressun',
    'Inhalt',
    'Glossar',
    'Stichwortverzeichnis',
];

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function check(label, passed, detail = '') {
    results.push({ label, passed, detail });
    console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

const session = await attach((t) => t.url.includes('index.html'));

const inReader = (body) =>
    session.eval(`(async () => {
        const leaf = window.app.workspace.getLeavesOfType(${JSON.stringify(READER_VIEW)})[0];
        if (!leaf) return { error: 'no reader' };
        const frame = leaf.view.containerEl.querySelector('iframe');
        if (!frame || !frame.contentDocument) return { error: 'no reader document' };
        const d = frame.contentDocument;
        const W = frame.contentWindow;
        ${body}
    })()`);

/** The ground truth: where the PDF viewer is actually scrolled to. */
const viewport = () =>
    inReader(`
        const iw = W._reader._primaryView._iframeWindow;
        const vc = iw.document.getElementById('viewerContainer');
        const st = W._reader._state.primaryViewState || {};
        return {
            scrollTop: Math.round(vc.scrollTop),
            scrollLeft: Math.round(vc.scrollLeft),
            pageIndex: st.pageIndex,
            scale: st.scale,
        };
    `);

/** Waits until the viewport stops moving, then reports it. */
async function settled(maxMs = 15000) {
    let last = null;
    let stable = 0;
    const step = 400;
    for (let waited = 0; waited < maxMs; waited += step) {
        await pause(step);
        const now = await viewport();
        if (now.error) return now;
        if (last && now.scrollTop === last.scrollTop && now.scrollLeft === last.scrollLeft) {
            stable += step;
            if (stable >= 1600) return now;
        } else {
            stable = 0;
        }
        last = now;
    }
    return last;
}

const park = async () => {
    await inReader(`W._reader.navigate({ pageIndex: ${PARK_PAGE} }); return { ok: true };`);
    return settled();
};

const frameOffset = () =>
    session.eval(`(() => {
        const leaf = window.app.workspace.getLeavesOfType(${JSON.stringify(READER_VIEW)})[0];
        const r = leaf.view.containerEl.querySelector('iframe').getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y) };
    })()`);

async function realClick(x, y) {
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

/** Clicks an outline row with the real input pipeline. */
async function clickOutline(label) {
    const offset = await frameOffset();
    const spot = await inReader(`
        const rows = [...d.querySelectorAll('#outlineView .item .title')];
        const el = rows.find((t) => t.textContent.trim().toLowerCase().startsWith(${JSON.stringify(label.toLowerCase())}));
        if (!el) return { error: 'no outline entry ' + ${JSON.stringify(label)} };
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: el.textContent.trim() };
    `);
    if (spot.error) return spot;
    await realClick(offset.x + spot.x, offset.y + spot.y);
    return spot;
}

/** Starts a real drag on an outline row and keeps the payload. */
const dragOutline = (label) =>
    inReader(`
        const rows = [...d.querySelectorAll('#outlineView .item')];
        const row = rows.find((r) => (r.querySelector('.title')?.textContent || '').trim().toLowerCase().startsWith(${JSON.stringify(label.toLowerCase())}));
        if (!row) return { error: 'no row ' + ${JSON.stringify(label)} };
        const transfer = new W.DataTransfer();
        row.dispatchEvent(new W.DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        return { payload: transfer.getData(${JSON.stringify(MIME)}) || null };
    `);

const dropOnEmptySlot = (payload) =>
    session.eval(`(() => {
        const leaf = window.app.workspace.getLeavesOfType(${JSON.stringify(PANEL_VIEW)})[0];
        if (!leaf) return { error: 'panel not open' };
        const slot = leaf.view.containerEl.querySelector('.ocap-grid-slot--empty');
        if (!slot) return { error: 'no empty slot left' };
        const transfer = new DataTransfer();
        transfer.setData(${JSON.stringify(MIME)}, ${JSON.stringify(payload)});
        for (const type of ['dragenter', 'dragover', 'drop']) {
            slot.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
        }
        return { ok: true };
    })()`);

const storedToolIds = () =>
    session.eval(`(() => Object.keys(window.app.plugins.plugins[${JSON.stringify(PANEL)}].settings.tools || {}))()`);

const toolOf = (id) =>
    session.eval(`(() => {
        const tool = window.app.plugins.plugins[${JSON.stringify(PANEL)}].settings.tools[${JSON.stringify(id)}];
        const parameters = ((tool.actions || [])[0] || {}).parameters || {};
        return { name: tool.name, subpath: parameters.subpath ?? null, section: parameters.section ?? null };
    })()`);

async function pressTool(id) {
    const spot = await session.eval(`(() => {
        const leaf = window.app.workspace.getLeavesOfType(${JSON.stringify(PANEL_VIEW)})[0];
        const button = leaf.view.containerEl.querySelector('[data-button-id="' + ${JSON.stringify(id)} + '"]');
        if (!button) return { error: 'tool not rendered' };
        const r = button.getBoundingClientRect();
        if (r.width === 0) return { error: 'tool not visible' };
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    if (spot.error) return spot;
    await realClick(spot.x, spot.y);
    return { ok: true };
}

// ---------------------------------------------------------------- run

console.log('\n== setup ==');
await session.eval(`(async () => {
    const w = window.app.workspace;
    let panel = w.getLeavesOfType(${JSON.stringify(PANEL_VIEW)})[0];
    if (!panel) { panel = w.getRightLeaf(false); await panel.setViewState({ type: ${JSON.stringify(PANEL_VIEW)}, active: true }); }
    w.revealLeaf(panel);
    w.detachLeavesOfType(${JSON.stringify(READER_VIEW)});
    try { w.leftSplit.collapse(); } catch (e) {}
    return true;
})()`);
await pause(1500);
await session.eval(`(async () => {
    const app = window.app;
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(PDF)});
    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(file);
    app.workspace.setActiveLeaf(leaf, { focus: true });
    return true;
})()`);
await pause(9000);
await inReader(`if (!d.body.classList.contains('sidebar-open')) d.getElementById('sidebarToggle').click(); return { ok: true };`);
await pause(1400);
await inReader(`
    const tab = [...d.querySelectorAll('#sidebarContainer .sidebar-toolbar .toolbar-button')].find((b) => /Outline/i.test(b.title));
    if (tab) tab.click();
    return { ok: !!tab };
`);
await pause(2000);
const ready = await viewport();
check('reader is up', !ready.error, ready.error ?? `scale ${ready.scale}`);

const table = [];
for (const label of ENTRIES) {
    console.log(`\n== ${label} ==`);

    // A. the reference: the reader's own outline
    await park();
    const clicked = await clickOutline(label);
    if (clicked.error) {
        check(`${label}: outline entry exists`, false, clicked.error);
        continue;
    }
    const native = await settled();

    // B. the same entry as a panel tool
    const dragged = await dragOutline(label);
    if (!dragged.payload) {
        check(`${label}: drag produced a payload`, false, dragged.error ?? '');
        continue;
    }
    const before = await storedToolIds();
    const dropped = await dropOnEmptySlot(dragged.payload);
    if (dropped.error) {
        check(`${label}: drop landed`, false, dropped.error);
        continue;
    }
    await pause(2200);
    const created = (await storedToolIds()).filter((id) => !before.includes(id))[0];
    if (!created) {
        check(`${label}: a tool was created`, false, 'none');
        continue;
    }
    const tool = await toolOf(created);

    await park();
    const pressed = await pressTool(created);
    if (pressed.error) {
        check(`${label}: the tool could be pressed`, false, pressed.error);
        continue;
    }
    const viaTool = await settled();

    const sameScroll = viaTool.scrollTop === native.scrollTop;
    const samePage = viaTool.pageIndex === native.pageIndex;
    const sameScale = viaTool.scale === native.scale;
    console.log(`  native : scrollTop ${native.scrollTop}  page ${native.pageIndex}  scale ${native.scale}`);
    console.log(`  tool   : scrollTop ${viaTool.scrollTop}  page ${viaTool.pageIndex}  scale ${viaTool.scale}`);
    check(`${label}: the shortcut carries a destination`, Array.isArray(tool.section?.dest), JSON.stringify(tool.section?.dest));
    check(`${label}: same page as the outline`, samePage, `${viaTool.pageIndex} vs ${native.pageIndex}`);
    check(`${label}: same zoom as the outline`, sameScale, `${viaTool.scale} vs ${native.scale}`);
    check(`${label}: same scroll position as the outline`, sameScroll, `delta ${viaTool.scrollTop - native.scrollTop}`);
    table.push({ label, native: native.scrollTop, tool: viaTool.scrollTop });
}

console.log('\n== summary (delta 0 means the shortcut landed exactly where the outline did) ==');
for (const row of table) {
    console.log(`  ${row.label.padEnd(22)} native ${String(row.native).padStart(7)}   tool ${String(row.tool).padStart(7)}   delta ${String(row.tool - row.native).padStart(7)}`);
}

const failed = results.filter((r) => !r.passed);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  - ${f.label} ${f.detail}`);
}
session.close();
process.exit(failed.length ? 1 : 0);
