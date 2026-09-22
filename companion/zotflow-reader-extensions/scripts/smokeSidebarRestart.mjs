// smokeSidebarRestart.mjs
// Does the sidebar side survive a real Obsidian restart?
//
// This is the one question a unit test cannot answer. It runs in two halves,
// because the middle of it is Obsidian shutting down:
//
//   node smokeSidebarRestart.mjs choose left|right   → picks the side through
//        the reader's OWN context menu, proves the file on disk, and quits
//        Obsidian gracefully.
//   node smokeSidebarRestart.mjs expect left|right   → run after restarting
//        Obsidian: checks the loaded preference, the reader that was restored,
//        and a reader opened fresh afterwards.
//
// The side is chosen through the menu rather than through the plugin's API on
// purpose: the menu's click handler does not await the save, and that gap is
// exactly the kind of thing a restart would expose.

import { attach } from './cdp.mjs';

const COMPANION = 'zotflow-reader-extensions';
const READER_VIEW = 'zotflow-local-zotero-reader-view';
const PDF_A = 'other/ZotTest/Bieker-Westerholt-2021-Soziale_Arbeit_studieren-Aufl_5.pdf';
const PDF_B = 'other/Bieker, Westerholt (2021) - Soziale Arbeit studieren/PaperA.pdf';

const mode = process.argv[2];
const wanted = process.argv[3];
if (!['choose', 'expect'].includes(mode) || !['left', 'right'].includes(wanted)) {
    console.log('usage: smokeSidebarRestart.mjs choose|expect left|right');
    process.exit(2);
}

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
        if (!leaf) return { error: 'no reader ' + ${nth} };
        const frame = leaf.view.containerEl.querySelector('iframe');
        if (!frame) return { error: 'deferred (no iframe)' };
        const d = frame.contentDocument;
        if (!d || !d.body) return { error: 'not built yet' };
        const W = frame.contentWindow;
        ${body}
    })()`);

const readerSide = (nth) =>
    inReader(
        nth,
        `
        const toggle = d.getElementById('sidebarToggle');
        if (!toggle) return { error: 'toolbar not rendered yet' };
        return {
            applied: d.body.getAttribute('data-zfrx-side'),
            toggleParent: toggle.parentElement.className,
            mirrored: W.getComputedStyle(toggle).transform !== 'none',
            toggleX: Math.round(toggle.getBoundingClientRect().x),
        };
    `
    );

const openPdf = (path, newTab) =>
    session.eval(`(async () => {
        const app = window.app;
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
        if (!file) return { error: 'no such file' };
        const leaf = app.workspace.getLeaf(${newTab ? "'tab'" : 'true'});
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return { ok: true };
    })()`);

/**
 * Waits until a reader is built AND the plugin has had its say.
 *
 * Two conditions, not one. A reader whose document exists is not yet a reader
 * whose toolbar is rendered, and a rendered toolbar is not yet a patched one —
 * the plugin applies the side as soon as the structure appears, which is fast
 * but not instant. Reading in that window reports `null` and would look exactly
 * like a preference that was never loaded.
 */
async function waitForReader(nth, maxMs = 25000) {
    let last = { error: 'never appeared' };
    for (let waited = 0; waited < maxMs; waited += 500) {
        last = await readerSide(nth);
        if (!last.error && last.applied !== null) return last;
        await pause(500);
    }
    return last;
}

const storedSide = () =>
    session.eval(
        `(async () => await window.app.plugins.plugins[${JSON.stringify(COMPANION)}].loadData())()`
    );

const runtimeSide = () =>
    session.eval(
        `(() => window.app.plugins.plugins[${JSON.stringify(COMPANION)}].settings.sidebarSide)()`
    );

// ---------------------------------------------------------------- choose

if (mode === 'choose') {
    console.log(`\n== choosing "${wanted}" through the reader's own menu ==`);
    // Give the reader room first. Below the reader's own breakpoint its toolbar
    // overflows and the right-hand toggle scrolls out of reach — nothing to do
    // with persistence, but it makes the gesture impossible to perform.
    await session.eval(`(() => {
        const w = window.app.workspace;
        w.detachLeavesOfType(${JSON.stringify(READER_VIEW)});
        try { w.leftSplit.collapse(); } catch (e) {}
        try { w.rightSplit.collapse(); } catch (e) {}
        return true;
    })()`);
    await pause(1200);
    await openPdf(PDF_A, false);
    const ready = await waitForReader(0);
    check('a reader is up', !ready.error, ready.error ?? `currently ${ready.applied}`);

    // The real gesture: right-click the sidebar toggle, pick the side.
    const frame = await session.eval(`(() => {
        const leaf = window.app.workspace.getLeavesOfType(${JSON.stringify(READER_VIEW)})[0];
        const f = leaf.view.containerEl.querySelector('iframe');
        const r = f.getBoundingClientRect();
        const t = f.contentDocument.getElementById('sidebarToggle').getBoundingClientRect();
        return { x: Math.round(r.x + t.x + t.width / 2), y: Math.round(r.y + t.y + t.height / 2) };
    })()`);
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: frame.x, y: frame.y, buttons: 0 });
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: frame.x, y: frame.y, button: 'right', buttons: 2, clickCount: 1 });
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: frame.x, y: frame.y, button: 'right', buttons: 0, clickCount: 1 });
    await pause(800);
    const picked = await session.eval(`(() => {
        const menu = [...document.querySelectorAll('.menu')].pop();
        if (!menu) return { error: 'no menu' };
        const item = [...menu.querySelectorAll('.menu-item')]
            .find((i) => new RegExp(${JSON.stringify(wanted)}, 'i').test(i.textContent.trim()));
        if (!item) return { error: 'no entry for ' + ${JSON.stringify(wanted)} };
        item.click();
        return { ok: true, clicked: item.textContent.trim() };
    })()`);
    check('the menu offered both sides and one was chosen', !picked.error, picked.error ?? picked.clicked);
    await pause(2000);

    check('the reader shows it at once', (await readerSide(0)).applied === wanted);
    check('the runtime setting says so', (await runtimeSide()) === wanted);
    // The file, not the memory: this is the half that has to survive.
    const onDisk = await storedSide();
    check('and it reached the plugin\'s own data file', onDisk?.sidebarSide === wanted, JSON.stringify(onDisk));

    // Leave a reader open, so the restart has one to restore.
    await session.eval('(() => { window.app.workspace.requestSaveLayout?.(); return true; })()');
    await pause(2500);
}

// ---------------------------------------------------------------- expect

if (mode === 'expect') {
    console.log(`\n== after the restart, "${wanted}" must still hold ==`);
    check('the plugin loaded the stored side', (await runtimeSide()) === wanted, String(await runtimeSide()));
    const onDisk = await storedSide();
    check('the file still says it', onDisk?.sidebarSide === wanted, JSON.stringify(onDisk));

    const restored = await waitForReader(0);
    check('the restored reader came up', !restored.error, restored.error ?? '');
    if (!restored.error) {
        check('it is on the stored side', restored.applied === wanted, String(restored.applied));
        check(
            'with the toggle on that side',
            restored.toggleParent === (wanted === 'right' ? 'end' : 'start'),
            String(restored.toggleParent)
        );
        check('and the icon mirrored only on the right', restored.mirrored === (wanted === 'right'));
    }

    // A reader opened AFTER the restart must get it too, not just the restored one.
    await openPdf(PDF_B, true);
    const fresh = await waitForReader(1);
    check('a reader opened after the restart came up', !fresh.error, fresh.error ?? '');
    if (!fresh.error) {
        check('it is on the stored side as well', fresh.applied === wanted, String(fresh.applied));
        check(
            'with its toggle on that side',
            fresh.toggleParent === (wanted === 'right' ? 'end' : 'start'),
            String(fresh.toggleParent)
        );
    }
    check('both readers agree', (await readerSide(0)).applied === (await readerSide(1)).applied);
}

const failed = results.filter((r) => !r.passed);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  - ${f.label} ${f.detail}`);
}
session.close();
process.exit(failed.length ? 1 : 0);
