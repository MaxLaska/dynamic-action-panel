// eyedropper.ts
// Picking a colour off the screen, through the one API that can actually do it.
//
// WHAT WAS THERE BEFORE, and why it was useless. There was no eyedropper of
// ours at all. The pipette the user found was Chromium's own, inside the native
// popup that `<input type="color">` opens — and that popup is the problem, not
// the feature. It is an OS-level window that takes focus and sits over the
// workspace, so "sample the colour of the left dock" means sampling a dock that
// is behind a dialog. The magnifier's tinted grid is drawn by that same native
// UI. None of it is ours: we cannot restyle it, reposition it, or keep the
// workspace visible behind it.
//
// WHAT THIS IS INSTEAD. `window.EyeDropper` is a first-class web API in
// Chromium, and Obsidian is Chromium. It has no dialog: calling `open()` turns
// the pointer into a sampler over the whole screen and resolves with the pixel
// the user clicks. The workspace stays exactly where it was, which is the
// entire point — the colours worth sampling are the ones already on screen.
//
// The magnifier it draws is still Chromium's, and still not ours to style. What
// changes is that it is now the ONLY thing between the user and the pixels,
// instead of the thing behind a modal colour dialog.
//
// FAIL-SOFT. The API is feature-detected, never assumed. Where it is missing
// the editor simply does not offer the button, and every other way of entering
// a colour goes on working. A cancelled pick — Escape, or a click that resolves
// to nothing — is a normal outcome and changes no value.

/** The slice of the EyeDropper API this uses. */
interface EyeDropperLike {
    open(options?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }>;
}

interface EyeDropperCapableWindow {
    EyeDropper?: new () => EyeDropperLike;
}

/**
 * Whether this build of Obsidian can sample a colour off the screen.
 *
 * Probed structurally rather than by version, because the only honest test of
 * "can I call this" is whether it is a constructor right now.
 */
export function eyedropperAvailable(win: Window = window): boolean {
    return typeof (win as unknown as EyeDropperCapableWindow).EyeDropper === 'function';
}

/** What a pick produced. `null` means the user cancelled, or it was refused. */
export type PickedColor = string | null;

/**
 * Opens the screen sampler and resolves with the colour, or with null.
 *
 * Never rejects. Every failure — unavailable, cancelled with Escape, refused by
 * the platform, an unexpected shape in the result — is the same thing to the
 * caller: no colour was chosen, so nothing changes. A pipette that can throw is
 * a pipette every caller has to wrap, and there is only one sensible wrapping.
 */
export async function pickScreenColor(win: Window = window): Promise<PickedColor> {
    const constructor = (win as unknown as EyeDropperCapableWindow).EyeDropper;
    if (typeof constructor !== 'function') return null;
    try {
        const result = await new constructor().open();
        const hex = result?.sRGBHex;
        if (typeof hex !== 'string') return null;
        const trimmed = hex.trim();
        // The API is specified to return `#rrggbb`. Checked anyway, because
        // this value goes straight into a stored token.
        return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
    } catch {
        // AbortError on Escape is the common case and is not a failure.
        return null;
    }
}
