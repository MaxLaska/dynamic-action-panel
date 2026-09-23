// sampler.ts
// Taking a colour off the visible Obsidian, without a red grid over it.
//
// WHY NOT THE NATIVE PIPETTE. `window.EyeDropper` works, over the studio's
// edge and beyond, but its magnifier draws a saturated red grid over the very
// pixels being judged. Traced in the sources: Electron hands the request to
// Chromium's EyeDropperView, which paints its grid, border and centre rings in
// colours looked up by id in a ColorProvider. Chrome registers the eye dropper's
// colour mixer, which maps those ids to greys; Electron registers its own mixers
// and not that one — and Chromium answers an unmapped id with
// `gfx::kPlaceholderColor`, which is SK_ColorRED, "a visual flag for
// misbehaving code". Nothing a page can do reaches that; it belongs to
// Electron. (Checked: Chromium's color_mixer.cc and color_palette.h, Electron's
// electron_browser_main_parts.cc.)
//
// WHAT THIS DOES INSTEAD. `webContents.capturePage(rect)` — the call Obsidian
// itself uses to export a canvas as an image — renders the window's own content
// into an image. Asked for one pixel under a click, it returns that pixel:
// measured in Obsidian 1.13.7, the left dock sampled `#333333` against a
// computed `rgb(51, 51, 51)`. No screen permission (it is this window's own
// rendering, not the screen), no magnifier, no grid. And it is exact in a way
// the screen sampler is not: it reads what the page drew, before the display's
// colour profile touches it — the CSS value, which is what a token holds.
//
// Its one limit: it sees this window and nothing else. That is the whole of the
// job here — the colours worth taking are Obsidian's. Where `capturePage` is
// not reachable there is NO sampler: the native pipette, red grid and all, is
// deliberately not a fallback any more. It was the thing the user kept landing
// in by accident, and a pipette that sometimes draws a red grid is not one
// tool. (The native `<input type="color">` is gone from the studio for the same
// reason; see colorPicker.ts.)
//
// It is deliberately NOT a screenshot tool: one pixel, one click, no zoom
// window, no history, nothing kept.

import { webContentsOf, toWindowPoint, type CapturedImage } from './electronSurface';
import { KEYBOARD_STEP_LARGE, afterPaint, pickPoint } from './pickPoint';

/** Whether this window can take a colour from its own rendering. */
export function canSample(win: Window): boolean {
    return webContentsOf(win) !== null;
}

/** Reads the top-left pixel of a captured image as RGBA 0–255. */
export type PixelDecoder = (
    image: CapturedImage,
    win: Window
) => Promise<[number, number, number, number] | null>;

/**
 * Decodes through the browser rather than reading raw bitmap bytes.
 *
 * `NativeImage.toBitmap()` is in the platform's native byte order — BGRA on
 * Windows, not promised elsewhere — so the PNG is decoded by the page instead,
 * with colour-space conversion off, so a stored `#333333` reads back as exactly
 * that. At a device pixel ratio above 1 one CSS pixel is several device pixels;
 * the first one is the one under the pointer's hot spot.
 */
export const decodeFirstPixel: PixelDecoder = async (image, win) => {
    const png = image.toPNG();
    // The window's own Blob, not the module's: in a pop-out window the two are
    // different realms, and createImageBitmap wants its own.
    const WindowBlob = (win as unknown as { Blob: typeof Blob }).Blob;
    const blob = new WindowBlob([png], { type: 'image/png' });
    const bitmap = await win.createImageBitmap(blob, { colorSpaceConversion: 'none' });
    const canvas = win.document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, 1, 1, 0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return [r ?? 0, g ?? 0, b ?? 0, a ?? 0];
};

/** A pick in progress. */
export interface SampleSession {
    /** The colour as `#rrggbb`, or null when cancelled or nothing could be read. */
    readonly result: Promise<string | null>;
    cancel(): void;
}

const hex = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');

/**
 * Starts a colour pick in a window.
 *
 * Nothing is written anywhere by this: it resolves with a colour, and the caller
 * decides what to do with it. A cancelled pick — Escape, a right-click, the view
 * closing — resolves null, and null changes nothing.
 */
export function sampleColor(win: Window, decode: PixelDecoder = decodeFirstPixel): SampleSession {
    const wc = webContentsOf(win);
    if (!wc) return { result: Promise.resolve(null), cancel: () => undefined };

    const pick = pickPoint(
        win.document,
        'Click to take a colour · arrows aim, Enter takes · Esc cancels'
    );
    const result = (async (): Promise<string | null> => {
        const point = await pick.result;
        if (!point) return null;
        try {
            // The hint has gone; the shield stays, so nothing under the click
            // switches to its hover colour before this frame is read.
            await afterPaint(win.document);
            const at = toWindowPoint(wc, point.x, point.y);
            const image = await wc.capturePage({ x: at.x, y: at.y, width: 1, height: 1 });
            const rgba = await decode(image, win);
            if (!rgba) return null;
            return `#${hex(rgba[0])}${hex(rgba[1])}${hex(rgba[2])}`;
        } catch {
            return null;
        } finally {
            pick.release();
        }
    })();
    return { result, cancel: () => pick.cancel() };
}

// --- the sampling MODE ----------------------------------------------------------------
//
// The picker's pipette is a TOOL, not a one-shot action: switched on, every
// click anywhere in the window takes the colour under it, and the mode stays
// on — the picker stays visible, above the layer, so the colour just taken,
// Recent and Saved can be watched while the next one is taken. It ends with
// the pipette again, with Escape, or with the picker closing.
//
// PRIORITY. While the mode is on, a press is a SAMPLE unless it lands on one of
// the few controls the caller keeps live (the pipette itself, the format
// button, Done, Revert). Everything else is sampled — including the picker's
// own swatches, which is allowed rather than special-cased. The press is
// taken on `pointerdown` and the click that would follow is swallowed, so a
// swatch sampled is not also clicked.
//
// THE LOUPE. A small ring north-east of the cursor (see `loupePosition`): its
// centre is the colour under the hot spot, its ring the picker's current colour. The centre is a real pixel,
// read with the same one-pixel capture as a sample — at most one capture in
// flight and at most one every CANDIDATE_INTERVAL_MS, so a moving mouse costs a
// dozen captures a second at most, never one per pointer event. It sits off the
// hot spot, so it is never in the pixel it reports.

/** The least time between two live candidate captures. */
export const CANDIDATE_INTERVAL_MS = 80;

/** The loupe's size, as styles.css draws it. */
export const LOUPE_SIZE = 34;

/**
 * Where the loupe goes relative to the hot spot: NORTH-EAST. The pipette cursor
 * runs from its tip (the hot spot) up and to the right for 18px, so the loupe
 * starts just right of the cursor's body and ends just above the tip — close
 * enough to belong to it, never on the tip or the pixel.
 */
export const LOUPE_DX = 20;
export const LOUPE_DY = 4;

/** Kept from the window's edges. */
const LOUPE_EDGE = 2;

/**
 * The loupe's top-left for a hot spot at (x, y) in a w × h window.
 *
 * North-east whenever it fits. At an edge it is slid back inside, only as far
 * as needed — along the top it slides down, along the right it slides left —
 * so it follows the cursor without jumping. Only if sliding would put it over
 * the hot spot itself (the top-right corner) does it move to the other side of
 * the tip, below it.
 */
export function loupePosition(x: number, y: number, w: number, h: number): { left: number; top: number } {
    const size = LOUPE_SIZE;
    const maxLeft = Math.max(LOUPE_EDGE, w - size - LOUPE_EDGE);
    const maxTop = Math.max(LOUPE_EDGE, h - size - LOUPE_EDGE);
    const left = Math.min(Math.max(LOUPE_EDGE, x + LOUPE_DX), maxLeft);
    let top = Math.min(Math.max(LOUPE_EDGE, y - LOUPE_DY - size), maxTop);
    const covers = (t: number): boolean => x >= left && x <= left + size && y >= t && y <= t + size;
    if (covers(top)) top = Math.min(Math.max(LOUPE_EDGE, y + LOUPE_DX), maxTop);
    return { left, top };
}

export interface SamplingModeOptions {
    /** Presses on these stay ordinary clicks: the controls of the mode itself. */
    keepLive(target: Element): boolean;
    /** A colour was taken. `#rrggbb`. */
    onSample(hex: string): void;
    /** The mode ended by itself (Escape), not by `stop()`. */
    onEnd(): void;
    /** The colour the loupe's ring shows: the picker's current one. */
    reference(): string;
    decode?: PixelDecoder;
}

export interface SamplingMode {
    /** Ends the mode. Harmless when already ended. */
    stop(): void;
    /** How many captures the loupe has made — for the throttle's tests and the smoke. */
    readonly candidateCaptures: number;
}

/** Starts the sampling mode in a window; null where the window cannot be captured. */
export function startSamplingMode(win: Window, options: SamplingModeOptions): SamplingMode | null {
    const wc = webContentsOf(win);
    if (!wc) return null;
    const doc = win.document;
    const decode = options.decode ?? decodeFirstPixel;

    const shield = doc.createElement('div');
    shield.className = 'nexus-studio-pick-shield nexus-studio-isolated is-persistent';
    shield.setAttribute('role', 'presentation');
    const reticle = doc.createElement('div');
    reticle.className = 'nexus-studio-pick-reticle';
    reticle.hidden = true;
    shield.appendChild(reticle);
    const loupe = doc.createElement('div');
    loupe.className = 'nexus-studio-sample-loupe nexus-studio-isolated';
    loupe.hidden = true;
    const candidate = doc.createElement('span');
    candidate.className = 'nexus-studio-sample-candidate';
    loupe.appendChild(candidate);
    doc.body.append(shield, loupe);

    let ended = false;
    let swallowClick = false;
    const aim = { x: Math.round(win.innerWidth / 2), y: Math.round(win.innerHeight / 2) };
    let captures = 0;
    let inFlight = false;
    let lastCapture = -Infinity;
    let queued: { x: number; y: number } | null = null;
    let queueTimer = 0;

    const read = async (x: number, y: number): Promise<string | null> => {
        const at = toWindowPoint(wc, x, y);
        const image = await wc.capturePage({ x: at.x, y: at.y, width: 1, height: 1 });
        const rgba = await decode(image, win);
        return rgba ? `#${hex(rgba[0])}${hex(rgba[1])}${hex(rgba[2])}` : null;
    };

    /** One sample, in order: a second click waits for the first. */
    let chain: Promise<void> = Promise.resolve();
    const sampleAt = (x: number, y: number): void => {
        chain = chain.then(async () => {
            if (ended) return;
            // The keyboard reticle sits exactly on the point: out of the frame first.
            const wasShown = !reticle.hidden;
            reticle.hidden = true;
            if (wasShown) await afterPaint(doc);
            try {
                const colour = await read(x, y);
                if (colour && !ended) {
                    options.onSample(colour);
                    ring();
                }
            } catch {
                // A frame that could not be read is not a colour; the mode goes on.
            } finally {
                if (wasShown && !ended) reticle.hidden = false;
            }
        });
    };

    const ring = (): void => loupe.style.setProperty('--nexus-studio-loupe-ring', options.reference());

    /** The live candidate under the cursor, throttled. */
    const capture = (x: number, y: number): void => {
        queued = { x, y };
        if (inFlight || queueTimer) return;
        const wait = CANDIDATE_INTERVAL_MS - (win.performance.now() - lastCapture);
        if (wait > 0) {
            queueTimer = win.setTimeout(() => {
                queueTimer = 0;
                if (queued) capture(queued.x, queued.y);
            }, wait);
            return;
        }
        const point = queued;
        queued = null;
        inFlight = true;
        lastCapture = win.performance.now();
        captures += 1;
        void read(point.x, point.y)
            .then((colour) => {
                if (colour && !ended) candidate.style.setProperty('--nexus-studio-loupe-candidate', colour);
            }, () => undefined)
            .finally(() => {
                inFlight = false;
                if (queued && !ended) capture(queued.x, queued.y);
            });
    };

    const placeLoupe = (x: number, y: number): void => {
        const at = loupePosition(x, y, win.innerWidth, win.innerHeight);
        loupe.style.left = `${Math.round(at.left)}px`;
        loupe.style.top = `${Math.round(at.top)}px`;
    };

    // Duck-typed, not `instanceof Element`: a pop-out window has its own Element.
    const live = (target: EventTarget | null): boolean => {
        const element = target as Element | null;
        return !!element && typeof element.closest === 'function' && options.keepLive(element);
    };

    const onPointerDown = (event: PointerEvent): void => {
        if (event.button !== 0 || live(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        swallowClick = true;
        aim.x = event.clientX;
        aim.y = event.clientY;
        sampleAt(event.clientX, event.clientY);
    };
    const onClick = (event: MouseEvent): void => {
        if (!swallowClick) return;
        swallowClick = false;
        event.preventDefault();
        event.stopPropagation();
    };
    const onMove = (event: PointerEvent): void => {
        aim.x = event.clientX;
        aim.y = event.clientY;
        reticle.hidden = true;
        if (live(event.target)) {
            loupe.hidden = true;
            return;
        }
        loupe.hidden = false;
        ring();
        placeLoupe(event.clientX, event.clientY);
        capture(event.clientX, event.clientY);
    };
    const ARROWS: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
    };
    const onKey = (event: KeyboardEvent): void => {
        // A dialog's keys are the dialog's. Enter and Space on a control the
        // caller keeps live press that control (the pipette switches off). The
        // arrows and Escape stay the sampler's even there: after a mouse click
        // the focus IS on the pipette button, and aiming must still work.
        if (doc.querySelector('.modal-container')) return;
        // A key whose target a dialog has already taken out of the document
        // closed that dialog; it is not the sampler's (see colorPicker.ts).
        const target = event.target as Node | null;
        if (target && target !== doc && target.isConnected === false) return;
        if ((event.key === 'Enter' || event.key === ' ') && live(event.target)) return;
        const arrow = ARROWS[event.key];
        if (arrow) {
            const step = event.shiftKey ? KEYBOARD_STEP_LARGE : 1;
            aim.x = Math.min(Math.max(0, aim.x + arrow[0] * step), win.innerWidth - 1);
            aim.y = Math.min(Math.max(0, aim.y + arrow[1] * step), win.innerHeight - 1);
            reticle.hidden = false;
            reticle.style.left = `${aim.x}px`;
            reticle.style.top = `${aim.y}px`;
            loupe.hidden = false;
            ring();
            placeLoupe(aim.x, aim.y);
        } else if (event.key === 'Enter' || event.key === ' ') {
            sampleAt(aim.x, aim.y);
        } else if (event.key === 'Escape') {
            stop();
            options.onEnd();
        } else {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    };

    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('pointermove', onMove, true);
    doc.addEventListener('keydown', onKey, true);

    function stop(): void {
        if (ended) return;
        ended = true;
        win.clearTimeout(queueTimer);
        doc.removeEventListener('pointerdown', onPointerDown, true);
        doc.removeEventListener('click', onClick, true);
        doc.removeEventListener('pointermove', onMove, true);
        doc.removeEventListener('keydown', onKey, true);
        shield.remove();
        loupe.remove();
    }

    return {
        stop,
        get candidateCaptures(): number {
            return captures;
        },
    };
}
