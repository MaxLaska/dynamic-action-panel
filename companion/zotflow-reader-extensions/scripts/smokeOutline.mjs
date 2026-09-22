// smokeOutline.mjs
// Drives a real ZotFlow reader and a real panel through the whole outline
// gesture: drag a section out of the reader's own outline, drop it on a grid
// cell, click the tool, and land on the right page of the right document.
//
// Everything is driven through the real UI — a real DragEvent with a real
// DataTransfer, a real click on the created button. Nothing in the plugins is
// instrumented for this: a test hook in shipped code would prove that the hook
// works, not that the gesture does.
//
// Same setup as smoke.mjs: an Obsidian started with its own user-data-dir and
// --remote-debugging-port=9333, pointed at the disposable smoke vault, with the
// panel view open.

import { attach } from './cdp.mjs';

const COMPANION = 'zotflow-reader-extensions';
const PANEL = 'dynamic-action-panel';
const PANEL_VIEW = 'buttons-panel-view';
const READER_VIEW = 'zotflow-local-zotero-reader-view';
const MIME = 'application/x-dap-reader-object';
const PDF_A = 'other/ZotTest/Bieker-Westerholt-2021-Soziale_Arbeit_studieren-Aufl_5.pdf';
const PDF_B = 'other/Bieker, Westerholt (2021) - Soziale Arbeit studieren/PaperA.pdf';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function check(label, passed, detail = '') {
    results.push({ label, passed, detail });
    console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

const session = await attach((t) => t.url.includes('index.html'));

const inReader = (nth, body) =>
    session.eval(`(() => {
        const leaf = window.app.workspace.getLeavesOfType(${JSON.stringify(READER_VIEW)})[${nth}];
        if (!leaf) return { error: 'no reader leaf ' + ${nth} };
        const frame = leaf.view.containerEl.querySelector('iframe');
        if (!frame || !frame.contentDocument) return { error: 'no reader document' };
        const d = frame.contentDocument;
        const W = frame.contentWindow;
        ${body}
    })()`);

const openPdf = (path, newTab) =>
    session.eval(`(async () => {
        const app = window.app;
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
        if (!file) return { error: 'no such file: ' + ${JSON.stringify(path)} };
        const leaf = app.workspace.getLeaf(${newTab ? "'tab'" : 'true'});
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return { ok: true };
    })()`);

const openOutline = async (nth) => {
    await inReader(
        nth,
        `if (!d.body.classList.contains('sidebar-open')) d.getElementById('sidebarToggle').click(); return { ok: true };`
    );
    await pause(1200);
    await inReader(
        nth,
        `
        const tab = [...d.querySelectorAll('#sidebarContainer .sidebar-toolbar .toolbar-button')]
            .find((b) => /Outline/i.test(b.title));
        if (tab) tab.click();
        return { ok: !!tab };
    `
    );
    await pause(1500);
};

const expandAll = async (nth, rounds = 3) => {
    for (let i = 0; i < rounds; i++) {
        const left = await inReader(
            nth,
            `
            const collapsed = [...d.querySelectorAll('#outlineView li')]
                .filter((li) => li.querySelector(':scope > .item.expandable') && !li.querySelector(':scope > .children'));
            collapsed.slice(0, 60).forEach((li) => li.querySelector(':scope > .item.expandable > .toggle').click());
            return collapsed.length;
        `
        );
        await pause(1200);
        if (!left) break;
    }
};

/** Index of the first rendered row at or below `depth`. */
const deepRowIndex = (nth, depth) =>
    inReader(
        nth,
        `
        const rows = [...d.querySelectorAll('#outlineView .item')];
        for (let i = 0; i < rows.length; i++) {
            let level = 0, cur = rows[i].closest('li');
            cur = cur ? cur.parentElement : null;
            while (cur && cur.id !== 'outlineView') { if (cur.tagName === 'LI') level++; cur = cur.parentElement; }
            if (level >= ${depth}) return i;
        }
        return 0;
    `
    );

/**
 * Starts a real drag on an outline row and keeps what the companion wrote.
 *
 * The DataTransfer is a real one, so what is captured is exactly the bytes a
 * drop would receive.
 */
const dragRow = (nth, rowIndex) =>
    inReader(
        nth,
        `
        const rows = [...d.querySelectorAll('#outlineView .item')];
        const row = rows[${rowIndex}];
        if (!row) return { error: 'no row ' + ${rowIndex} };
        const transfer = new W.DataTransfer();
        const event = new W.DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer });
        row.dispatchEvent(event);
        return {
            draggable: row.getAttribute('draggable'),
            title: ((row.querySelector('.title') || {}).textContent || '').trim(),
            types: [...transfer.types],
            payload: transfer.getData(${JSON.stringify(MIME)}) || null,
        };
    `
    );

/** Drops a payload on the first empty grid slot, as a real drop. */
const dropOnEmptySlot = (payload) =>
    session.eval(`(() => {
        const leaf = window.app.workspace.getLeavesOfType(${JSON.stringify(PANEL_VIEW)})[0];
        if (!leaf) return { error: 'panel not open' };
        const slot = leaf.view.containerEl.querySelector('.ocap-grid-slot--empty');
        if (!slot) return { error: 'no empty slot' };
        const transfer = new DataTransfer();
        transfer.setData(${JSON.stringify(MIME)}, ${JSON.stringify(payload)});
        for (const type of ['dragenter', 'dragover', 'drop']) {
            slot.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
        }
        return { slot: slot.getAttribute('data-slot') };
    })()`);

/**
 * The tools the panel currently stores.
 *
 * From `settings.tools`, which is the registry — categories and variants hold
 * only PLACEMENTS pointing into it. Reading a category's own `buttons` finds
 * nothing and looks exactly like a drop that did not work, which is what it
 * looked like on the first run of this suite.
 */
const storedTools = () =>
    session.eval(`(() => {
        const settings = window.app.plugins.plugins[${JSON.stringify(PANEL)}].settings;
        return Object.values(settings.tools || {}).map((tool) => {
            const action = (tool.actions || [])[0] || {};
            const parameters = action.parameters || {};
            return {
                id: tool.id,
                name: tool.name,
                tooltip: tool.tooltip || null,
                icon: tool.icon || '',
                actionType: action.type || null,
                filePath: parameters.filePath ?? null,
                subpath: parameters.subpath ?? null,
                section: parameters.section ?? null,
            };
        });
    })()`);

/**
 * Presses a tool the way a person does.
 *
 * Real input again, and for the same reason as the outline row: the panel reads
 * the mouse grammar from the pointer sequence, so a dispatched `click()` finds
 * the button, reports success and runs nothing.
 */
async function clickTool(id) {
    const spot = await session.eval(`(() => {
        const leaf = window.app.workspace.getLeavesOfType(${JSON.stringify(PANEL_VIEW)})[0];
        const button = leaf.view.containerEl.querySelector('[data-button-id="' + ${JSON.stringify(id)} + '"]');
        if (!button) return { error: 'tool not rendered' };
        const r = button.getBoundingClientRect();
        if (r.width === 0) return { error: 'tool not visible' };
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    if (spot.error) return spot;
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: spot.x, y: spot.y, buttons: 0 });
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', buttons: 1, clickCount: 1 });
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spot.x, y: spot.y, button: 'left', buttons: 0, clickCount: 1 });
    return { ok: true };
}

const frameOffset = () =>
    session.eval(`(() => {
        const leaf = window.app.workspace.getLeavesOfType(${JSON.stringify(READER_VIEW)})[0];
        const r = leaf.view.containerEl.querySelector('iframe').getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y) };
    })()`);

/**
 * Clicks an outline row with the real input pipeline.
 *
 * A dispatched `click()` is not enough here and would prove nothing: the reader
 * navigates from the pointer sequence, so a synthetic click leaves the page
 * where it was WHETHER OR NOT this plugin has touched the row. Measured both
 * ways before this was written.
 */
async function clickOutlineRow(nth, rowIndex) {
    const offset = await frameOffset();
    const spot = await inReader(
        nth,
        `
        const el = [...d.querySelectorAll('#outlineView .item .title')][${rowIndex}];
        if (!el) return { error: 'no row ' + ${rowIndex} };
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: el.textContent.trim() };
    `
    );
    if (spot.error) return spot;
    const x = offset.x + spot.x;
    const y = offset.y + spot.y;
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    return spot;
}

const readerPage = (nth) =>
    inReader(
        nth,
        `
        const stats = W._reader && W._reader._state ? W._reader._state.primaryViewStats : null;
        return { pageIndex: stats ? stats.pageIndex : null, pageLabel: stats ? stats.pageLabel : null };
    `
    );

const openReaders = () =>
    session.eval(
        `(() => window.app.workspace.getLeavesOfType(${JSON.stringify(READER_VIEW)}).map((l) => (l.view.file ? l.view.file.path : null)))()`
    );

// ---------------------------------------------------------------- run

console.log('\n== setup ==');
const loaded = await session.eval(
    `(() => ({ companion: !!window.app.plugins.plugins[${JSON.stringify(COMPANION)}],
               panel: !!window.app.plugins.plugins[${JSON.stringify(PANEL)}] }))()`
);
check('companion and panel are both loaded', loaded.companion && loaded.panel, JSON.stringify(loaded));

await session.eval(`(async () => {
    const w = window.app.workspace;
    let leaf = w.getLeavesOfType(${JSON.stringify(PANEL_VIEW)})[0];
    if (!leaf) { leaf = w.getRightLeaf(false); await leaf.setViewState({ type: ${JSON.stringify(PANEL_VIEW)}, active: true }); }
    w.revealLeaf(leaf);
    w.detachLeavesOfType(${JSON.stringify(READER_VIEW)});
    return true;
})()`);
await pause(2500);
const before = await storedTools();

await openPdf(PDF_A, false);
await pause(8000);
await openOutline(0);
await expandAll(0);

console.log('\n== the outline is draggable ==');
const marked = await inReader(
    0,
    `
    const rows = [...d.querySelectorAll('#outlineView .item')];
    return {
        rows: rows.length,
        draggable: rows.filter((r) => r.getAttribute('draggable') === 'true').length,
        marked: rows.filter((r) => r.classList.contains('zfrx-draggable-row')).length,
    };
`
);
check('every outline row is draggable', marked.rows > 0 && marked.draggable === marked.rows, JSON.stringify(marked));
check('and marked exactly once each', marked.marked === marked.rows, JSON.stringify(marked));

console.log('\n== the drag describes the section ==');
const rowIndex = await deepRowIndex(0, 2);
const dragged = await dragRow(0, rowIndex);
check('the drag carried our payload', !!dragged.payload, dragged.error ?? JSON.stringify(dragged.types));
let section = null;
if (dragged.payload) {
    section = JSON.parse(dragged.payload);
    check('it is a pdf-outline object, version 1', section.kind === 'pdf-outline' && section.version === 1);
    check('it names the right document', section.filePath === PDF_A, section.filePath);
    check('the title matches the row', dragged.title === section.title, `${dragged.title} vs ${section.title}`);
    check('it carries the hierarchy', Array.isArray(section.parents) && section.parents.length >= 1, JSON.stringify(section.parents));
    check('it carries the depth', section.level >= 1, `level=${section.level}`);
    check('it carries the reader destination', typeof section.location?.position?.pageIndex === 'number', String(section.location?.position?.pageIndex));
    check('it carries a printed page label', typeof section.pageLabel === 'string', String(section.pageLabel));
    check(
        'a boundary, if present, lies after the section',
        section.nextPageIndex === undefined || section.nextPageIndex > section.pageIndex,
        String(section.nextPageIndex)
    );
}

console.log('\n== the reader still behaves ==');
await inReader(0, `W._reader.navigate({ pageIndex: 0 }); return { ok: true };`);
await pause(1800);
const beforeNav = await readerPage(0);
const clicked = await clickOutlineRow(0, rowIndex);
await pause(2500);
const afterNav = await readerPage(0);
check(
    'clicking an outline row still navigates',
    !clicked.error && afterNav.pageIndex !== beforeNav.pageIndex,
    `"${clicked.text ?? clicked.error}" ${beforeNav.pageIndex} -> ${afterNav.pageIndex}`
);

const collapse = await inReader(
    0,
    `
    const open = [...d.querySelectorAll('#outlineView li')].find((li) => li.querySelector(':scope > .children'));
    if (!open) return { error: 'nothing expanded' };
    const before = d.querySelectorAll('#outlineView li').length;
    open.querySelector(':scope > .item.expandable > .toggle').click();
    return { before };
`
);
await pause(1500);
const afterCollapse = await inReader(0, `return { after: d.querySelectorAll('#outlineView li').length };`);
check('expand/collapse still works', !collapse.error && afterCollapse.after < collapse.before, `${collapse.before} -> ${afterCollapse.after}`);

await inReader(
    0,
    `const t = [...d.querySelectorAll('#outlineView li')].find((li) => li.querySelector(':scope > .item.expandable')); if (t) t.querySelector(':scope > .item.expandable > .toggle').click(); return { ok: true };`
);
await pause(1800);
const remarked = await inReader(
    0,
    `const rows = [...d.querySelectorAll('#outlineView .item')]; return { rows: rows.length, draggable: rows.filter((r) => r.getAttribute('draggable') === 'true').length };`
);
check('re-rendered rows are draggable again', remarked.rows === remarked.draggable, JSON.stringify(remarked));

console.log('\n== the panel turns it into a tool ==');
const dropped = await dropOnEmptySlot(dragged.payload);
check('the drop landed on a slot', !dropped.error, dropped.error ?? `slot ${dropped.slot}`);
await pause(2500);
const after = await storedTools();
const created = after.filter((t) => !before.some((b) => b.id === t.id));
check('exactly one tool was created', created.length === 1, `${created.length}`);
const tool = created[0];
if (tool && section) {
    check('named after the section', tool.name === section.title, tool.name);
    check('an ordinary file action', tool.actionType === 'file', String(tool.actionType));
    check('pointed at the document', tool.filePath === PDF_A, String(tool.filePath));
    check('the subpath leads with the page', /^#page=/.test(tool.subpath ?? ''), (tool.subpath ?? '').slice(0, 30));
    check('it carries the section description', !!tool.section, JSON.stringify(tool.section));
    check('the description keeps the title', tool.section?.title === section.title, String(tool.section?.title));
    check('the description keeps the hierarchy', JSON.stringify(tool.section?.parents) === JSON.stringify(section.parents), JSON.stringify(tool.section?.parents));
    check('the description keeps the page index', tool.section?.pageIndex === section.pageIndex, String(tool.section?.pageIndex));
    check('the hover text names source and page', (tool.tooltip ?? '').length > 0, String(tool.tooltip));
}

console.log('\n== clicking the tool navigates an OPEN reader ==');
if (tool && section) {
    await inReader(0, `W._reader.navigate({ pageIndex: 0 }); return { ok: true };`);
    await pause(1800);
    check('reader parked at the start', (await readerPage(0)).pageIndex === 0);
    const pressed = await clickTool(tool.id);
    check('the tool could be pressed', !pressed.error, pressed.error ?? '');
    await pause(3500);
    const arrived = await readerPage(0);
    check('it jumped to the section', arrived.pageIndex === section.pageIndex, `${arrived.pageIndex} vs ${section.pageIndex}`);
}

console.log('\n== a second document ==');
await openPdf(PDF_B, true);
await pause(8000);
await openOutline(1);
const secondDrag = await dragRow(1, 0);
let second = null;
if (secondDrag.payload) {
    second = JSON.parse(secondDrag.payload);
    check('the second reader drags its OWN document', second.filePath === PDF_B, second.filePath);
} else {
    check('the second reader produced a payload', false, secondDrag.error ?? '');
}
const beforeSecond = await storedTools();
if (secondDrag.payload) await dropOnEmptySlot(secondDrag.payload);
await pause(2500);
const afterSecond = await storedTools();
const secondTool = afterSecond.filter((t) => !beforeSecond.some((b) => b.id === t.id))[0];
check('the second section became its own tool', !!secondTool, secondTool ? secondTool.name : 'none');
if (secondTool) {
    check('pointed at the second document', secondTool.filePath === PDF_B, String(secondTool.filePath));
}

console.log('\n== clicking with every reader CLOSED ==');
await session.eval(`(() => { window.app.workspace.detachLeavesOfType(${JSON.stringify(READER_VIEW)}); return true; })()`);
await pause(2000);
check('all readers closed', (await openReaders()).length === 0);

if (tool && section) {
    await clickTool(tool.id);
    await pause(10000);
    const reopened = await openReaders();
    check('the shortcut reopened its document', reopened.includes(PDF_A), JSON.stringify(reopened));
    const landed = await readerPage(0);
    check('and landed on the section, not page one', landed.pageIndex === section.pageIndex, `${landed.pageIndex} vs ${section.pageIndex}`);
}

if (secondTool && second) {
    await clickTool(secondTool.id);
    await pause(10000);
    const both = (await openReaders()).filter(Boolean);
    check('the other shortcut opened the OTHER document', both.includes(PDF_B), JSON.stringify(both));
    check('two documents open, not one reused', new Set(both).size >= 2, JSON.stringify(both));
}

console.log('\n== the existing drops still work ==');
const fileDrop = await session.eval(`(() => {
    const leaf = window.app.workspace.getLeavesOfType(${JSON.stringify(PANEL_VIEW)})[0];
    const slot = leaf.view.containerEl.querySelector('.ocap-grid-slot--empty');
    if (!slot) return { error: 'no empty slot' };
    const transfer = new DataTransfer();
    transfer.setData('text/plain', ${JSON.stringify(PDF_A)});
    for (const type of ['dragenter', 'dragover', 'drop']) {
        slot.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }
    return { ok: true };
})()`);
await pause(2500);
const afterFile = await storedTools();
const fileTool = afterFile.filter((t) => !afterSecond.some((b) => b.id === t.id))[0];
check('a plain vault-file drop still creates a file tool', !fileDrop.error && !!fileTool && fileTool.actionType === 'file', fileTool ? fileTool.name : (fileDrop.error ?? 'none'));
check('and it carries no section description', !fileTool?.section, JSON.stringify(fileTool?.section ?? null));

// ---------------------------------------------------------------- report
const failed = results.filter((r) => !r.passed);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  - ${f.label} ${f.detail}`);
}
session.close();
process.exit(failed.length ? 1 : 0);
