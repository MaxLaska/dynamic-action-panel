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
// Its one limit is the reason the native pipette stays as a fallback: it sees
// this window and nothing else. That is the whole of the job here — the colours
// worth taking are Obsidian's — and where `capturePage` is not reachable, the
// native sampler is used rather than nothing.
//
// It is deliberately NOT a screenshot tool: one pixel, one click, no zoom
// window, no history, nothing kept.

import { webContentsOf, toWindowPoint, type CapturedImage } from './electronSurface';
import { eyedropperAvailable, pickScreenColor } from './eyedropper';
import { afterPaint, pickPoint } from './pickPoint';

/** Which sampler a window offers. */
export type SamplerKind = 'capture' | 'eyedropper' | 'none';

export function samplerKind(win: Window): SamplerKind {
    if (webContentsOf(win)) return 'capture';
    if (eyedropperAvailable(win)) return 'eyedropper';
    return 'none';
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
    if (!wc) {
        // The native pipette: red grid and all, but a colour rather than none.
        return { result: pickScreenColor(win), cancel: () => undefined };
    }

    const pick = pickPoint(win.document, 'Click to take a colour · Esc to cancel');
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
