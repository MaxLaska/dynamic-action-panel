// annotationButton.ts
// Pure mapping from a captured annotation to the tool created for it — the
// sibling of vaultFileButton.ts, and the same promise: no new action type.
//
// A local annotation becomes the EXISTING `file` action, pointed at the PDF and
// carrying the reader's own navigation subpath. A library annotation becomes the
// EXISTING `url` action, carrying ZotFlow's protocol URI. Both are ordinary
// tools afterwards: copy, duplicate, GC, export and import treat them like any
// other, and a build without this feature would still open the file.

import type { ButtonAction } from '@/types/action';
import {
    buildAnnotationSubpath,
    buildLibraryAnnotationUrl,
    type ZotflowAnnotationRef,
} from '@/utils/zotflowAnnotationDrop';
import { annotationTooltip, shortSourceLabel, PAGE_PREFIX } from '@/utils/sourceLabel';

/** How long a label may get before it is cut; the cell shows far less. */
const MAX_LABEL_TEXT = 60;

export interface AnnotationButtonDraft {
    name: string;
    /** Obsidian icon id; the caller resolves it to the stored SVG markup. */
    iconId: string;
    action: ButtonAction;
    /**
     * Hover text: which source and which page. Captured once, as a snapshot —
     * the bookmark is not a live view of ZotFlow's metadata.
     */
    tooltip?: string;
}

/** Icon per annotation kind; an unknown kind is still a highlight to the user. */
function annotationIconId(annotationType: string | undefined): string {
    switch (annotationType) {
        case 'underline':
            return 'underline';
        case 'note':
            return 'sticky-note';
        case 'image':
            return 'image';
        case 'ink':
            return 'pen-tool';
        case 'text':
            return 'type';
        default:
            return 'highlighter';
    }
}

/**
 * One line of readable text out of an annotation body: newlines and runs of
 * whitespace collapse, then it is cut at a word boundary when that does not
 * throw away most of the allowance.
 */
function condense(value: string | undefined): string {
    const text = (value ?? '').replace(/\s+/g, ' ').trim();
    if (text.length <= MAX_LABEL_TEXT) {
        return text;
    }
    const cut = text.slice(0, MAX_LABEL_TEXT);
    const lastSpace = cut.lastIndexOf(' ');
    const stem = lastSpace > MAX_LABEL_TEXT * 0.6 ? cut.slice(0, lastSpace) : cut;
    return `${stem.trimEnd()}…`;
}

/**
 * The tool label: what the highlight SAYS.
 *
 * Deliberately just the quote. A grid cell shows one short line, and the quote
 * is what the user recognises the bookmark by; which source and page it is lives
 * in the hover text, where there is room for it. Renaming stays the ordinary
 * edit path, and nothing later overwrites a name the user chose.
 */
function annotationName(ref: ZotflowAnnotationRef): string {
    const body = condense(ref.text) || condense(ref.comment);
    if (body) {
        return body;
    }
    // A highlight with neither text nor comment (an image or ink region): name it
    // after what it points at, since there is nothing to quote.
    const page = ref.pageLabel?.trim();
    if (ref.kind === 'local' && ref.fileBasename) {
        return page ? `${ref.fileBasename} · ${PAGE_PREFIX} ${page}` : ref.fileBasename;
    }
    return page ? `Annotation · ${PAGE_PREFIX} ${page}` : 'Annotation';
}

/** The action that reopens the annotation. */
function annotationAction(ref: ZotflowAnnotationRef): ButtonAction {
    if (ref.kind === 'library') {
        return { type: 'url', parameters: { url: buildLibraryAnnotationUrl(ref) } };
    }
    return {
        type: 'file',
        parameters: {
            filePath: ref.filePath,
            subpath: buildAnnotationSubpath(ref.annotationId, ref.pageIndex),
        },
    };
}

/** The tool a dropped ZotFlow annotation becomes. */
export function buildAnnotationButtonDraft(ref: ZotflowAnnotationRef): AnnotationButtonDraft {
    // Only a local annotation has a file whose folder names the source; a library
    // one has no vault path at all, so it gets the page alone.
    const source = ref.kind === 'local' ? shortSourceLabel(ref.filePath) : null;
    const tooltip = annotationTooltip(source, ref.pageLabel);
    return {
        name: annotationName(ref),
        iconId: annotationIconId(ref.annotationType),
        action: annotationAction(ref),
        ...(tooltip !== undefined ? { tooltip } : {}),
    };
}
