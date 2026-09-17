// obsidianFileDrag.ts
// Reading a drag that STARTED INSIDE OBSIDIAN (file explorer, search results,
// a link in a note) — the input side of the "drop a file on an empty slot"
// gesture.
//
// Two mechanisms, in this order:
//
// 1. `app.dragManager.draggable` — Obsidian's own drag bookkeeping, set at
//    dragstart and carrying the actual TFile/TFolder objects. This is the
//    reliable source and the only one readable during `dragover`, where the
//    HTML5 spec forbids reading dataTransfer CONTENT (only its types are
//    exposed). It is not part of the public API typings, so it is read through
//    a narrow structural type and every field is checked.
// 2. `text/plain` of the DataTransfer, at drop time only. A file-explorer drag
//    writes an `obsidian://open?vault=…&file=…` URI there (measured live);
//    other drag sources write link text ("[[Note]]", "[Note](Note.pdf)", or a
//    bare path). Used as a fallback so the gesture still works if the drag
//    manager is unavailable.
//
// Deliberately NOT the browser File API: a file-explorer drag carries vault
// files, not OS file handles, and `dataTransfer.files` is empty for it.
//
// This is separate from OCAP's internal button DnD, which is pointer-based
// (dnd-kit) and never produces HTML5 drag events. The two cannot collide.

import type { App } from 'obsidian';
import type { DroppedVaultFile } from '@/utils/vaultFileButton';

/** The shape of `app.dragManager` this module relies on. */
interface ObsidianDraggable {
    type?: unknown;
    file?: unknown;
    files?: unknown;
}

interface ObsidianDragManager {
    draggable?: ObsidianDraggable | null;
}

function dragManagerOf(app: App): ObsidianDragManager | null {
    const manager = (app as unknown as { dragManager?: ObsidianDragManager }).dragManager;
    return manager && typeof manager === 'object' ? manager : null;
}

/**
 * A TFile in everything that matters here. A TFolder is rejected precisely
 * because it has no `extension`, so folders never create a tool.
 */
function toDroppedVaultFile(value: unknown): DroppedVaultFile | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const candidate = value as { path?: unknown; basename?: unknown; extension?: unknown };
    if (
        typeof candidate.path !== 'string' ||
        candidate.path.length === 0 ||
        typeof candidate.basename !== 'string' ||
        typeof candidate.extension !== 'string'
    ) {
        return null;
    }
    return {
        path: candidate.path,
        basename: candidate.basename,
        extension: candidate.extension,
    };
}

/** Vault files carried by the drag Obsidian currently tracks. */
function readDragManagerFiles(app: App): DroppedVaultFile[] {
    const draggable = dragManagerOf(app)?.draggable;
    if (!draggable) {
        return [];
    }
    const candidates: unknown[] = [];
    // `Array.isArray` on an `unknown` widens to `any[]`; keep it `unknown[]`.
    const dragged: unknown[] = Array.isArray(draggable.files)
        ? (draggable.files as unknown[])
        : [];
    candidates.push(...dragged);
    if (draggable.file !== undefined && draggable.file !== null) {
        candidates.push(draggable.file);
    }

    const seen = new Set<string>();
    const files: DroppedVaultFile[] = [];
    for (const candidate of candidates) {
        const file = toDroppedVaultFile(candidate);
        if (file && !seen.has(file.path)) {
            seen.add(file.path);
            files.push(file);
        }
    }
    return files;
}

/**
 * The link target inside Obsidian's `text/plain` payload:
 * "obsidian://open?vault=v&file=sub%2Fx" yields "sub/x" (what the file
 * explorer actually writes), "![[x.pdf]]" and "[[x.pdf|alias]]" yield "x.pdf",
 * "[alias](sub/x.pdf)" yields "sub/x.pdf", anything else is taken as-is and
 * tried as a path. The result is a LINKPATH, which may omit the extension —
 * resolving it is Obsidian's job, not this parser's.
 */
export function parseDraggedLinkText(text: string): string | null {
    const trimmed = text.trim().replace(/^!/, '');
    if (trimmed.length === 0 || trimmed.includes('\n')) {
        return null;
    }

    if (/^obsidian:\/\//i.test(trimmed)) {
        try {
            const file = new URL(trimmed).searchParams.get('file');
            return file && file.length > 0 ? file : null;
        } catch {
            return null;
        }
    }

    const wiki = /^\[\[([^\]]+)\]\]$/.exec(trimmed);
    if (wiki) {
        const target = (wiki[1] ?? '').split('|')[0]?.trim() ?? '';
        return target.length > 0 ? target : null;
    }

    const markdown = /^\[[^\]]*\]\(([^)]+)\)$/.exec(trimmed);
    if (markdown) {
        const raw = (markdown[1] ?? '').trim();
        if (raw.length === 0 || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
            return null;
        }
        try {
            return decodeURIComponent(raw);
        } catch {
            return raw;
        }
    }

    return trimmed;
}

/** Resolve a link target against the vault, as Obsidian resolves links. */
function resolveLinkTarget(app: App, linkpath: string): DroppedVaultFile | null {
    const direct = app.vault.getAbstractFileByPath(linkpath);
    const resolvedDirect = toDroppedVaultFile(direct);
    if (resolvedDirect) {
        return resolvedDirect;
    }
    const linked = app.metadataCache.getFirstLinkpathDest(linkpath, '');
    return toDroppedVaultFile(linked);
}

/** Vault files named by the DataTransfer's text payload (drop time only). */
function readDataTransferFiles(
    app: App,
    dataTransfer: DataTransfer | null
): DroppedVaultFile[] {
    if (!dataTransfer) {
        return [];
    }
    let text = '';
    try {
        text = dataTransfer.getData('text/plain');
    } catch {
        // Reading is not allowed outside a drop; treated as "nothing here".
        return [];
    }
    if (!text) {
        return [];
    }
    const linkpath = parseDraggedLinkText(text);
    if (linkpath === null) {
        return [];
    }
    const file = resolveLinkTarget(app, linkpath);
    return file ? [file] : [];
}

/**
 * The vault files this drop carries. The drag manager wins; the text payload
 * is consulted only when it has nothing.
 */
export function resolveDroppedVaultFiles(
    app: App,
    dataTransfer: DataTransfer | null
): DroppedVaultFile[] {
    const fromManager = readDragManagerFiles(app);
    return fromManager.length > 0 ? fromManager : readDataTransferFiles(app, dataTransfer);
}

/**
 * Whether a slot should accept this drag — decided during `dragover`, where
 * only the drag manager and the list of available types are readable.
 *
 * An OS file drag (`Files` in the type list) is explicitly NOT accepted: those
 * are not vault files and OCAP has nothing to point a tool at.
 */
export function canAcceptVaultFileDrag(
    app: App,
    dataTransfer: DataTransfer | null
): boolean {
    if (readDragManagerFiles(app).length > 0) {
        return true;
    }
    if (!dataTransfer) {
        return false;
    }
    const types = Array.from(dataTransfer.types ?? []);
    return types.includes('text/plain') && !types.includes('Files');
}
