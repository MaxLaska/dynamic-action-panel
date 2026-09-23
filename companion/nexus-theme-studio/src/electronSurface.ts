// electronSurface.ts
// The slice of Electron the studio uses, reached the way Obsidian reaches it.
//
// Obsidian's own renderer code calls `window.electron.remote
// .getCurrentWebContents()` — for its "devtools" CLI handler
// (`toggleDevTools`) and for exporting a canvas as an image (`capturePage`).
// Measured in Obsidian 1.13.7 (Electron 43.3.0, Chromium 150): the object is
// there, and `capturePage`, `inspectElement`, `openDevTools`,
// `isDevToolsOpened`, `getZoomFactor` and `debugger` are all functions on it.
//
// None of it is in Obsidian's published API, so every use is feature-detected
// here, in one place, and everything that depends on it has a stated fallback.
// A future Obsidian without `remote` costs the studio its Inspect button and
// its capture-based pipette — both then say so — and nothing else.

/** A captured image, as much of Electron's NativeImage as the studio reads. */
export interface CapturedImage {
    toPNG(): Uint8Array;
    getSize(): { width: number; height: number };
}

/** Electron's `webContents.debugger`: a Chrome DevTools Protocol client. */
export interface ProtocolClient {
    isAttached(): boolean;
    attach(protocolVersion?: string): void;
    detach(): void;
    sendCommand(method: string, params?: object): Promise<unknown>;
    on(event: 'message', listener: (event: unknown, method: string, params: unknown) => void): unknown;
    removeListener(event: 'message', listener: (event: unknown, method: string, params: unknown) => void): unknown;
}

/** The window's WebContents, as far as the studio needs it. */
export interface StudioWebContents {
    getZoomFactor(): number;
    capturePage(rect: { x: number; y: number; width: number; height: number }): Promise<CapturedImage>;
    inspectElement(x: number, y: number): void;
    readonly debugger: ProtocolClient;
}

interface ElectronCapableWindow {
    electron?: { remote?: { getCurrentWebContents?: () => unknown } };
}

/**
 * The WebContents behind a window, or null when this Obsidian does not expose
 * one the way 1.13.7 does.
 *
 * Checked member by member rather than trusted: this is somebody else's object
 * on somebody else's global, and "can I call capturePage" is only honestly
 * answered by whether it is a function right now.
 */
export function webContentsOf(win: Window): StudioWebContents | null {
    try {
        const remote = (win as unknown as ElectronCapableWindow).electron?.remote;
        if (typeof remote?.getCurrentWebContents !== 'function') return null;
        const wc = remote.getCurrentWebContents() as Partial<StudioWebContents> | null;
        if (!wc) return null;
        if (typeof wc.getZoomFactor !== 'function') return null;
        if (typeof wc.capturePage !== 'function') return null;
        if (typeof wc.inspectElement !== 'function') return null;
        return wc as StudioWebContents;
    } catch {
        return null;
    }
}

/**
 * A page coordinate (CSS pixels, as events report them) as a window coordinate
 * (device-independent pixels, as `capturePage` and `inspectElement` take them).
 * The two differ exactly by Obsidian's zoom level, Ctrl+= and Ctrl+-.
 */
export function toWindowPoint(wc: StudioWebContents, x: number, y: number): { x: number; y: number } {
    const zoom = wc.getZoomFactor() || 1;
    return { x: Math.round(x * zoom), y: Math.round(y * zoom) };
}
