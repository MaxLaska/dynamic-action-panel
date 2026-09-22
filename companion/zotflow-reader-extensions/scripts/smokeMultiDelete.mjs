// smokeMultiDelete.mjs
// Deleting a selection, driven through the real panel.
//
// Everything is the real gesture: a real rectangle drag over the grid, a real
// right click, the real Obsidian menu, the real confirmation dialog. Nothing in
// the plugin is instrumented for this — a test hook would prove the hook works,
// not the feature.
//
// What it checks, in the order a person would: that the menu offers the entry
// only when it should, that Cancel and Escape really change nothing, that a
// confirmed delete removes exactly the selected occupied tools and nothing
// else, that the selection is gone afterwards, and that a reload agrees.
//
// Setup as in smoke.mjs: Obsidian with its own user-data-dir and
// --remote-debugging-port=9333 on the disposable smoke vault.

import { attach } from './cdp.mjs';

const PANEL = 'dynamic-action-panel';
const PANEL_VIEW = 'buttons-panel-view';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function check(label, passed, detail = '') {
    results.push({ label, passed, detail });
    console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

const session = await attach((t) => t.url.includes('index.html'));

const panelEval = (body) =>
    session.eval(`(() => {
        const plugin = window.app.plugins.plugins[${JSON.stringify(PANEL)}];
        const leaf = window.app.workspace.getLeavesOfType(${JSON.stringify(PANEL_VIEW)})[0];
        if (!plugin || !leaf) return { error: 'panel not open' };
        const el = leaf.view.containerEl;
        ${body}
    })()`);

/** Every tool the settings hold, by id. */
const toolNames = () =>
    session.eval(`(() => {
        const tools = window.app.plugins.plugins[${JSON.stringify(PANEL)}].settings.tools || {};
        return Object.fromEntries(Object.entries(tools).map(([id, t]) => [id, t.name]));
    })()`);

/** Which tool sits in which slot of the first grid that has empty room. */
const gridState = () =>
    panelEval(`
        const frame = el.querySelector('.ocap-grid-frame');
        if (!frame) return { error: 'no grid' };
        const slots = [...frame.querySelectorAll('.ocap-grid-slot')].map((slot) => ({
            slot: Number(slot.getAttribute('data-slot')),
            filled: slot.classList.contains('ocap-grid-slot--filled'),
            selected: slot.getAttribute('data-selected') === 'true',
            toolId: (slot.querySelector('[data-button-id]') || {}).getAttribute
                ? slot.querySelector('[data-button-id]').getAttribute('data-button-id')
                : null,
        }));
        return { slots };
    `);

const slotRect = (slot) =>
    panelEval(`
        const frame = el.querySelector('.ocap-grid-frame');
        const cell = frame.querySelector('.ocap-grid-slot[data-slot="' + ${slot} + '"]');
        if (!cell) return { error: 'no slot ' + ${slot} };
        const r = cell.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    `);

async function mouse(type, x, y, button = 'left', buttons = 1, clickCount = 1) {
    await session.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount });
}

/** A real Shift-rectangle from one slot to another. */
async function shiftRectangle(fromSlot, toSlot) {
    const a = await slotRect(fromSlot);
    const b = await slotRect(toSlot);
    if (a.error || b.error) return a.error ? a : b;
    const shift = 8; // Modifiers.Shift
    await session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: shift, key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y, modifiers: shift, buttons: 0 });
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1, modifiers: shift });
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
        await session.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: Math.round(a.x + ((b.x - a.x) * i) / steps),
            y: Math.round(a.y + ((b.y - a.y) * i) / steps),
            button: 'left',
            buttons: 1,
            modifiers: shift,
        });
        await pause(60);
    }
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1, modifiers: shift });
    await session.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 0, key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
    await pause(700);
    return { ok: true };
}

async function rightClickSlot(slot) {
    const spot = await slotRect(slot);
    if (spot.error) return spot;
    await mouse('mouseMoved', spot.x, spot.y, 'none', 0);
    await mouse('mousePressed', spot.x, spot.y, 'right', 2);
    await mouse('mouseReleased', spot.x, spot.y, 'right', 0);
    await pause(700);
    return { ok: true };
}

/** What the open Obsidian menu says, plus the marker the panel records on it. */
const openMenu = () =>
    session.eval(`(() => {
        const menu = [...document.querySelectorAll('.menu')].pop();
        if (!menu) return { open: false };
        return {
            open: true,
            items: [...menu.querySelectorAll('.menu-item')].map((i) => i.textContent.trim()),
            kind: menu.dataset.ocapContextKind ?? null,
            cells: menu.dataset.ocapContextCells ?? null,
            tools: menu.dataset.ocapContextTools ?? null,
            deleteTargets: menu.dataset.ocapDeleteTargets ?? null,
        };
    })()`);

const clickMenuItem = (pattern) =>
    session.eval(`(() => {
        const menu = [...document.querySelectorAll('.menu')].pop();
        if (!menu) return { error: 'no menu' };
        const item = [...menu.querySelectorAll('.menu-item')]
            .find((i) => new RegExp(${JSON.stringify(pattern)}, 'i').test(i.textContent.trim()));
        if (!item) return { error: 'no item matching ' + ${JSON.stringify(pattern)} };
        item.click();
        return { ok: true, clicked: item.textContent.trim() };
    })()`);

/** What the confirmation dialog says. */
const openDialog = () =>
    session.eval(`(() => {
        const modal = document.querySelector('.modal-container .buttons-panel.button-delete');
        if (!modal) return { open: false };
        return {
            open: true,
            title: (document.querySelector('.modal-container .modal-title') || {}).textContent?.trim() ?? null,
            message: (modal.querySelector('.delete-message') || {}).textContent?.trim() ?? null,
            items: [...modal.querySelectorAll('.delete-target-list li')].map((li) => li.textContent.trim()),
            warning: (modal.querySelector('.warning-message') || {}).textContent?.trim() ?? null,
            buttons: [...modal.querySelectorAll('button')].map((b) => b.textContent.trim()),
        };
    })()`);

const clickDialogButton = (pattern) =>
    session.eval(`(() => {
        const modal = document.querySelector('.modal-container .buttons-panel.button-delete');
        if (!modal) return { error: 'no dialog' };
        const button = [...modal.querySelectorAll('button')]
            .find((b) => new RegExp(${JSON.stringify(pattern)}, 'i').test(b.textContent.trim()));
        if (!button) return { error: 'no button matching ' + ${JSON.stringify(pattern)} };
        button.click();
        return { ok: true };
    })()`);

const pressEscape = () =>
    session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).then(() =>
        session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    );

/**
 * Takes an open menu off the screen without choosing anything from it.
 *
 * Deliberately NOT Escape: in this panel Escape means "drop the selection",
 * so dismissing a menu that way would destroy the very thing the next check
 * is about — and did, on the first run of this suite. Removing the menu
 * element touches the DOM and no application state.
 */
async function dismissMenus() {
    await session.eval(
        "(() => { document.querySelectorAll('.menu').forEach((m) => m.remove()); return true; })()"
    );
    await pause(400);
}

/** The real Delete key, through the browser input pipeline. */
async function pressDelete() {
    await session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 });
    await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 });
}

// ---------------------------------------------------------------- run

console.log('\n== setup ==');
await session.eval(`(async () => {
    const w = window.app.workspace;
    let panel = w.getLeavesOfType(${JSON.stringify(PANEL_VIEW)})[0];
    if (!panel) { panel = w.getRightLeaf(false); await panel.setViewState({ type: ${JSON.stringify(PANEL_VIEW)}, active: true }); }
    w.revealLeaf(panel);
    return true;
})()`);
await pause(2500);

const before = await gridState();
check('a grid is on screen', !before.error, before.error ?? `${before.slots.length} slots`);
const filledBefore = before.slots.filter((s) => s.filled);
const emptyBefore = before.slots.filter((s) => !s.filled);
check('it holds several tools', filledBefore.length >= 3, `${filledBefore.length} filled, ${emptyBefore.length} empty`);
const names = await toolNames();
console.log('  tools in the grid:', filledBefore.map((s) => names[s.toolId]).join(', '));

console.log('\n== a rectangle over occupied and empty cells ==');
// The corners are chosen so that tools are left OUTSIDE the rectangle: a
// delete that removed everything would pass a test that never asked whether
// it removed too much.
const corners = await panelEval(`
    const frame = el.querySelector('.ocap-grid-frame');
    const slots = [...frame.querySelectorAll('.ocap-grid-slot')];
    const columns = new Set(slots.map((s) => Math.round(s.getBoundingClientRect().x))).size;
    const filled = slots
        .map((s, index) => ({ index, filled: s.classList.contains('ocap-grid-slot--filled') }))
        .filter((s) => s.filled)
        .map((s) => s.index);
    // Any two cells define a rectangle: its bounding box in rows and columns.
    // Try every pair and take the first that covers at least two tools, leaves
    // at least one tool outside, and includes at least one empty cell — the
    // mix the feature is actually about.
    const rowOf = (i) => Math.floor(i / columns);
    const colOf = (i) => i % columns;
    const inBox = (i, a, b) => {
        const r0 = Math.min(rowOf(a), rowOf(b));
        const r1 = Math.max(rowOf(a), rowOf(b));
        const c0 = Math.min(colOf(a), colOf(b));
        const c1 = Math.max(colOf(a), colOf(b));
        return rowOf(i) >= r0 && rowOf(i) <= r1 && colOf(i) >= c0 && colOf(i) <= c1;
    };
    let fallback = null;
    for (let a = 0; a < slots.length; a++) {
        for (let b = a; b < slots.length; b++) {
            const covered = slots.map((_, i) => i).filter((i) => inBox(i, a, b));
            const inside = covered.filter((i) => filled.includes(i)).length;
            const empties = covered.length - inside;
            if (inside < 2 || inside >= filled.length) continue;
            const pick = {
                from: Number(slots[a].getAttribute('data-slot')),
                to: Number(slots[b].getAttribute('data-slot')),
                columns,
            };
            if (empties > 0) return pick;
            fallback ??= pick;
        }
    }
    if (fallback) return fallback;
    return { error: 'no rectangle leaves a tool outside it (grid too full or too empty)' };
`);
check('a rectangle can be drawn that leaves tools outside it', !corners.error, corners.error ?? `slots ${corners.from}..${corners.to}, ${corners.columns} columns`);
if (corners.error) {
    console.log('\nCannot continue without survivors to check against.');
    session.close();
    process.exit(1);
}
await shiftRectangle(corners.from, corners.to);
const selected = await gridState();
const selectedSlots = selected.slots.filter((s) => s.selected);
const selectedFilled = selectedSlots.filter((s) => s.filled);
const selectedEmpty = selectedSlots.filter((s) => !s.filled);
check('the rectangle selected cells', selectedSlots.length >= 2, `${selectedSlots.length} cells`);
check('including occupied ones', selectedFilled.length >= 2, `${selectedFilled.length} occupied`);
check('and empty ones too', selectedEmpty.length >= 1, `${selectedEmpty.length} empty`);

console.log('\n== the menu, on a selected occupied cell ==');
await rightClickSlot(selectedFilled[0].slot);
const menu = await openMenu();
check('a menu opened', menu.open === true);
check('it knows it is about the selection', menu.kind === 'selection', String(menu.kind));
check('it counts the cells, empty ones included', Number(menu.cells) === selectedSlots.length, `${menu.cells} vs ${selectedSlots.length}`);
check('it counts only the occupied ones as tools', Number(menu.tools) === selectedFilled.length, `${menu.tools} vs ${selectedFilled.length}`);
check('Delete targets the whole selection', Number(menu.deleteTargets) === selectedFilled.length, String(menu.deleteTargets));
// One action, one entry, one word. The count belongs in the confirmation,
// which names the tools; a menu offering both "Delete" and "Delete 4 selected
// items" would be offering the same action twice.
check('there is exactly ONE Delete entry', menu.items.filter((i) => /^delete$/i.test(i)).length === 1, JSON.stringify(menu.items));
check('and no second entry naming a count', !menu.items.some((i) => /selected items/i.test(i)), JSON.stringify(menu.items));
check('the single-tool entries are still there', ['edit', 'copy', 'delete'].every((w) => menu.items.some((i) => new RegExp(w, 'i').test(i))), JSON.stringify(menu.items));
check('right-clicking did not disturb the selection', (await gridState()).slots.filter((s) => s.selected).length === selectedSlots.length);

console.log('\n== the menu, on an UNSELECTED occupied cell ==');
await dismissMenus();
const outsider = selected.slots.find((s) => s.filled && !s.selected);
if (outsider) {
    await rightClickSlot(outsider.slot);
    const outsideMenu = await openMenu();
    check('it is about that one tool, not the selection', outsideMenu.kind === 'tool', String(outsideMenu.kind));
    check('Delete targets only that one tool', Number(outsideMenu.deleteTargets) === 1, String(outsideMenu.deleteTargets));
    check('it still offers the tool entries', ['edit', 'copy', 'delete'].every((w) => outsideMenu.items.some((i) => new RegExp(w, 'i').test(i))), JSON.stringify(outsideMenu.items));
    check('the entry list is exactly the single-tool one', outsideMenu.items.length === 3, JSON.stringify(outsideMenu.items));
    // The standing rule: a click outside the selection does not reduce it.
    check('the selection was not disturbed', (await gridState()).slots.filter((s) => s.selected).length === selectedSlots.length);
    await dismissMenus();
} else {
    check('there is an unselected occupied cell to test against', false, 'none outside the rectangle');
}

console.log('\n== Cancel changes nothing ==');
await rightClickSlot(selectedFilled[0].slot);
await clickMenuItem('^delete$');
await pause(900);
let dialog = await openDialog();
check('the confirmation opened', dialog.open === true);
check('it says how many items', new RegExp(`\\b${selectedFilled.length}\\b`).test(dialog.message ?? ''), dialog.message ?? '');
check('it lists them by name', (dialog.items ?? []).length === selectedFilled.length, JSON.stringify(dialog.items ?? null));
check('the names are readable, not ids', (dialog.items ?? []).length > 0 && (dialog.items ?? []).every((label) => selectedFilled.some((s) => names[s.toolId] === label) || !/^[a-z0-9]{6,}-/.test(label)), JSON.stringify(dialog.items));
check('it warns that this cannot be undone', /undone|отмен|撤销/i.test(dialog.warning ?? ''), dialog.warning ?? '');
await clickDialogButton('cancel');
await pause(1200);
let afterCancel = await gridState();
check('nothing was deleted', afterCancel.slots.filter((s) => s.filled).length === filledBefore.length, `${afterCancel.slots.filter((s) => s.filled).length} vs ${filledBefore.length}`);
check('the selection still stands', afterCancel.slots.filter((s) => s.selected).length === selectedSlots.length);

console.log('\n== Escape changes nothing either ==');
await rightClickSlot(selectedFilled[0].slot);
await clickMenuItem('^delete$');
await pause(900);
check('the confirmation opened again', (await openDialog()).open === true);
await pressEscape();
await pause(1200);
check('the dialog closed', (await openDialog()).open === false);
const afterEscape = await gridState();
check('still nothing deleted', afterEscape.slots.filter((s) => s.filled).length === filledBefore.length);
check('the selection still stands', afterEscape.slots.filter((s) => s.selected).length === selectedSlots.length);

console.log('\n== confirming deletes exactly the selected tools ==');
const doomedIds = selectedFilled.map((s) => s.toolId);
const survivorIds = filledBefore.filter((s) => !doomedIds.includes(s.toolId)).map((s) => s.toolId);
await rightClickSlot(selectedFilled[0].slot);
await clickMenuItem('^delete$');
await pause(900);
await clickDialogButton('delete');
await pause(2500);
const afterDelete = await gridState();
const stillThere = afterDelete.slots.filter((s) => s.filled).map((s) => s.toolId);
check('every selected tool is gone from the grid', doomedIds.every((id) => !stillThere.includes(id)), JSON.stringify(doomedIds));
check('every unselected tool is still there', survivorIds.every((id) => stillThere.includes(id)), JSON.stringify(survivorIds));
check('the selection is empty afterwards', afterDelete.slots.filter((s) => s.selected).length === 0);
const namesAfter = await toolNames();
check('the definitions were collected too', doomedIds.every((id) => namesAfter[id] === undefined), JSON.stringify(doomedIds.filter((id) => namesAfter[id] !== undefined)));
check('the surviving definitions were NOT collected', survivorIds.every((id) => namesAfter[id] !== undefined));

console.log('\n== the Delete key opens the same door ==');
const keyState = await gridState();
const keyFilled = keyState.slots.filter((s) => s.filled);
if (keyFilled.length >= 2) {
    // A fresh selection over the tools that are left.
    await shiftRectangle(keyFilled[0].slot, keyFilled[1].slot);
    const keySelected = (await gridState()).slots.filter((s) => s.selected && s.filled);
    check('a new selection stands', keySelected.length >= 2, `${keySelected.length} occupied`);

    // A text field first: the key must belong to whoever is typing.
    await session.eval(`(() => {
        const input = document.createElement('input');
        input.id = 'zfrx-smoke-input';
        document.body.appendChild(input);
        input.focus();
        return true;
    })()`);
    await pressDelete();
    await pause(900);
    check('typing in a text field is left alone', (await openDialog()).open === false);
    check('and nothing was deleted', (await gridState()).slots.filter((s) => s.filled).length === keyFilled.length);
    await session.eval(`(() => { document.getElementById('zfrx-smoke-input')?.remove(); document.body.focus(); return true; })()`);
    await pause(400);

    // Now from the panel itself.
    await session.eval(`(() => {
        const leaf = window.app.workspace.getLeavesOfType(${JSON.stringify(PANEL_VIEW)})[0];
        leaf.view.containerEl.querySelector('.ocap-grid-slot')?.focus?.();
        return true;
    })()`);
    await pressDelete();
    await pause(900);
    let keyDialog = await openDialog();
    check('the Delete key opened the confirmation', keyDialog.open === true);
    check('for the selected tools', (keyDialog.items ?? []).length === keySelected.length || /\b1\b/.test(keyDialog.message ?? ''), JSON.stringify(keyDialog.items ?? keyDialog.message));

    // A second Delete must not stack another dialog on top.
    await pressDelete();
    await pause(700);
    check('a second Delete does not stack a second dialog', (await session.eval("(() => document.querySelectorAll('.modal-container .buttons-panel.button-delete').length)()")) === 1);

    await clickDialogButton('cancel');
    await pause(1000);
    check('Cancel from the key deletes nothing', (await gridState()).slots.filter((s) => s.filled).length === keyFilled.length);
    check('and the selection survives', (await gridState()).slots.filter((s) => s.selected).length > 0);

    const doomedByKey = keySelected.map((s) => s.toolId);
    await pressDelete();
    await pause(900);
    await clickDialogButton('delete');
    await pause(2500);
    const afterKey = await gridState();
    check('confirming from the key deleted them', doomedByKey.every((id) => !afterKey.slots.some((s) => s.toolId === id)), JSON.stringify(doomedByKey));
    check('and cleared the selection', afterKey.slots.filter((s) => s.selected).length === 0);
} else {
    check('there are enough tools left to test the Delete key', false, `${keyFilled.length}`);
}

console.log('\n== a reload agrees ==');
// Taken HERE, not before the key section: that section deleted more tools, and
// comparing against a list captured earlier would report its own deletions as
// survivors that went missing.
const beforeReload = await toolNames();
const survivingIds = Object.keys(beforeReload);
await session.eval(`(async () => {
    await window.app.plugins.disablePlugin(${JSON.stringify(PANEL)});
    await new Promise((r) => setTimeout(r, 700));
    await window.app.plugins.enablePlugin(${JSON.stringify(PANEL)});
    return true;
})()`);
await pause(3500);
await session.eval(`(async () => {
    const w = window.app.workspace;
    let panel = w.getLeavesOfType(${JSON.stringify(PANEL_VIEW)})[0];
    if (!panel) { panel = w.getRightLeaf(false); await panel.setViewState({ type: ${JSON.stringify(PANEL_VIEW)}, active: true }); }
    w.revealLeaf(panel);
    return true;
})()`);
await pause(2500);
const reloaded = await toolNames();
check('the deleted tools are still gone after a reload', doomedIds.every((id) => reloaded[id] === undefined));
check(
    'every tool that was there before the reload is there after it',
    survivingIds.every((id) => reloaded[id] !== undefined),
    JSON.stringify(survivingIds.filter((id) => reloaded[id] === undefined))
);

const failed = results.filter((r) => !r.passed);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  - ${f.label} ${f.detail}`);
}
session.close();
process.exit(failed.length ? 1 : 0);
