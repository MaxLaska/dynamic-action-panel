// inspectUi.ts
// "Inspect UI": DevTools' own element picker, started from the studio.
//
// The studio is not a DOM inspector and does not become one. DevTools is the
// discovery tool; this is only the shortest way into it. What was checked in
// Obsidian 1.13.7 (Electron 43.3.0) before a line of this was written:
//
//   - `webContents.inspectElement(x, y)` opens DevTools with the element at
//     that point selected. Documented Electron API. Verified live.
//   - `webContents.debugger` is Electron's documented Chrome DevTools Protocol
//     client. Attached, it can switch on the protocol's `Overlay` inspect mode
//     — the SAME hover highlight, box model and name tag DevTools' own picker
//     draws — and report the node the user clicks. Verified live: attach,
//     `Overlay.setInspectMode`, off again, detach.
//
// So the flow is: attach, switch the picker on, wait for the click, then hand
// that element to `inspectElement`, which opens DevTools on it, and detach.
// Escape, the view closing and the plugin unloading all switch the picker off
// and detach.
//
// There is NO keyboard-shortcut fallback. If the protocol client cannot be
// attached — something else holds it — the fallback is still an API call: a
// crosshair click through the shared pick layer, then `inspectElement` at that
// point. What is lost is the hover highlight, not the result. Where Electron's
// WebContents is not reachable at all, the button says so and does nothing.

import { webContentsOf, toWindowPoint, type ProtocolClient, type StudioWebContents } from './electronSurface';
import { pickPoint, type PickSession } from './pickPoint';

/** How an inspect ended. */
export type InspectOutcome = 'inspected' | 'cancelled' | 'unavailable' | 'failed';

/** An inspect in progress. */
export interface InspectSession {
    readonly result: Promise<InspectOutcome>;
    cancel(): void;
}

/**
 * DevTools' own inspect-mode highlight colours — content blue, padding green,
 * border yellow, margin orange — so the picker looks exactly like the one the
 * user already knows from DevTools, not like something new.
 */
const HIGHLIGHT = {
    showInfo: true,
    showStyles: true,
    contentColor: { r: 111, g: 168, b: 220, a: 0.66 },
    paddingColor: { r: 147, g: 196, b: 125, a: 0.55 },
    borderColor: { r: 255, g: 229, b: 153, a: 0.66 },
    marginColor: { r: 246, g: 178, b: 107, a: 0.66 },
};

/** Whether this Obsidian can open DevTools on an element at all. */
export function inspectAvailable(win: Window): boolean {
    return webContentsOf(win) !== null;
}

/** The centre of a CDP box-model quad `[x1,y1, x2,y2, x3,y3, x4,y4]`. */
export function quadCentre(quad: readonly number[]): { x: number; y: number } | null {
    if (quad.length < 8) return null;
    const xs = [quad[0], quad[2], quad[4], quad[6]] as number[];
    const ys = [quad[1], quad[3], quad[5], quad[7]] as number[];
    if (xs.some((v) => !Number.isFinite(v)) || ys.some((v) => !Number.isFinite(v))) return null;
    return {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
}

/**
 * Starts DevTools' element picker. Resolves once the user has picked an
 * element (and DevTools is open on it), cancelled, or it could not be done.
 */
export function startInspect(win: Window): InspectSession {
    const wc = webContentsOf(win);
    if (!wc) return { result: Promise.resolve('unavailable'), cancel: () => undefined };

    const client = wc.debugger;
    let attached = false;
    try {
        if (!client.isAttached()) {
            client.attach('1.3');
            attached = true;
        }
    } catch {
        attached = false;
    }
    if (!attached) return pointFallback(win, wc);
    return protocolPicker(win, wc, client);
}

function protocolPicker(win: Window, wc: StudioWebContents, client: ProtocolClient): InspectSession {
    let finish: (outcome: InspectOutcome) => void = () => undefined;
    let done = false;
    // Picks count only once the picker is really on. Verified live: after
    // `inspectElement` has been used once, the next `Overlay.enable` replays an
    // `inspectNodeRequested` for that earlier node — before `setInspectMode`
    // resolves and without any click. Taking it would open DevTools unasked.
    let armed = false;

    const onMessage = (_event: unknown, method: string, params: unknown): void => {
        if (method !== 'Overlay.inspectNodeRequested' || !armed || tornDown) return;
        const backendNodeId = (params as { backendNodeId?: unknown }).backendNodeId;
        void (async () => {
            try {
                const box = (await client.sendCommand('DOM.getBoxModel', { backendNodeId })) as {
                    model?: { content?: number[] };
                };
                const centre = quadCentre(box.model?.content ?? []);
                await teardown();
                if (!centre) {
                    finish('failed');
                    return;
                }
                const at = toWindowPoint(wc, centre.x, centre.y);
                wc.inspectElement(at.x, at.y);
                finish('inspected');
            } catch {
                await teardown();
                finish('failed');
            }
        })();
    };

    const onKey = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        void teardown().then(() => finish('cancelled'));
    };

    let tornDown = false;
    const teardown = async (): Promise<void> => {
        if (tornDown) return;
        tornDown = true;
        win.document.removeEventListener('keydown', onKey, true);
        client.removeListener('message', onMessage);
        try {
            await client.sendCommand('Overlay.setInspectMode', { mode: 'none', highlightConfig: {} });
        } catch {
            // Already off, or already detached: either way the picker is gone.
        }
        try {
            client.detach();
        } catch {
            // Detaching a client something else already detached is not an error here.
        }
    };

    const result = new Promise<InspectOutcome>((resolve) => {
        finish = (outcome) => {
            if (done) return;
            done = true;
            resolve(outcome);
        };
    });

    client.on('message', onMessage);
    win.document.addEventListener('keydown', onKey, true);
    void (async () => {
        try {
            await client.sendCommand('DOM.enable');
            await client.sendCommand('Overlay.enable');
            await client.sendCommand('Overlay.setInspectMode', {
                mode: 'searchForNode',
                highlightConfig: HIGHLIGHT,
            });
            armed = true;
        } catch {
            await teardown();
            finish('failed');
        }
    })();

    return {
        result,
        cancel: () => {
            void teardown().then(() => finish('cancelled'));
        },
    };
}

/** The same outcome without the protocol client: a crosshair click, then DevTools on that point. */
function pointFallback(win: Window, wc: StudioWebContents): InspectSession {
    const pick: PickSession = pickPoint(win.document, 'Click an element to inspect it · Esc to cancel');
    const result = pick.result.then((point): InspectOutcome => {
        pick.release();
        if (!point) return 'cancelled';
        try {
            const at = toWindowPoint(wc, point.x, point.y);
            wc.inspectElement(at.x, at.y);
            return 'inspected';
        } catch {
            return 'failed';
        }
    });
    return { result, cancel: () => pick.cancel() };
}
