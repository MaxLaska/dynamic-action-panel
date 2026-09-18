// liveTooltip.ts
// The one value in a tool's hover text that is NOT a snapshot.
//
// A bookmark on a PDF annotation records its source once, deliberately: the
// bibliography of a book does not change. Its PAGE does, because ZotFlow lets
// the user correct the printed page afterwards ("Edit Page Number"), which is
// routine — PDFs usually carry an offset between the physical page and the
// printed folio. A bookmark that kept showing the page from capture time would
// be quietly wrong from the moment the user fixed it.
//
// So: the source stays as captured, the page is looked up when the hover text is
// actually needed, and the captured page remains the fallback for when nothing
// can be looked up. That is the whole mechanism — no synchronization, no store,
// no watcher, and nothing written anywhere.

import type { App } from 'obsidian';
import type { ButtonConfig } from '@/types/settings';
import { parseAnnotationSubpath } from '@/utils/zotflowAnnotationDrop';
import { resolveCurrentPageLabel } from '@/utils/zotflowReader';
import { withCurrentPage } from '@/utils/sourceLabel';

/** The annotation a tool bookmarks, if it bookmarks one. */
function annotationTargetOf(
    button: ButtonConfig
): { filePath: string; annotationId: string } | null {
    for (const action of button.actions ?? []) {
        if (action?.type !== 'file') {
            continue;
        }
        // Read defensively: this also runs against data a user or an import may
        // have shaped differently than the types promise.
        const parameters = action.parameters as { filePath?: unknown; subpath?: unknown } | undefined;
        const filePath = parameters?.filePath;
        if (typeof filePath !== 'string' || filePath.length === 0) {
            continue;
        }
        const target = parseAnnotationSubpath(
            typeof parameters?.subpath === 'string' ? parameters.subpath : undefined
        );
        if (target) {
            return { filePath, annotationId: target.annotationId };
        }
    }
    return null;
}

/**
 * The hover text this tool should show right now, or null when the stored one is
 * already it.
 *
 * Only annotation bookmarks have anything to refresh; every other tool returns
 * null immediately, so this costs nothing for them. When the annotation cannot
 * be found — deleted, ZotFlow disabled, sidecar gone — the stored text stands,
 * because a captured page is better than no page and far better than a guess.
 *
 * NEVER rejects and never throws: it runs from a pointer handler, where the only
 * acceptable failure is "keep what you have".
 *
 * @param app Obsidian app
 * @param button The tool being hovered
 * @returns The refreshed hover text, or null to keep the stored one
 */
export async function resolveLiveTooltip(
    app: App,
    button: ButtonConfig
): Promise<string | null> {
    try {
        const stored = button?.tooltip?.trim();
        if (!stored) {
            return null;
        }
        const target = annotationTargetOf(button);
        if (!target) {
            return null;
        }
        const pageLabel = await resolveCurrentPageLabel(app, target.filePath, target.annotationId);
        if (!pageLabel) {
            return null;
        }
        const refreshed = withCurrentPage(stored, pageLabel);
        return refreshed && refreshed !== stored ? refreshed : null;
    } catch {
        return null;
    }
}
