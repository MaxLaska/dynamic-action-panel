// workspaceContext.ts
// Immutable context snapshot for the context engine, plus the pure
// builder/equality logic. This module has no Obsidian runtime dependency and
// is fully unit-testable; event wiring lives in WorkspaceContextService.ts.

/**
 * Immutable snapshot of the workspace context relevant for visibility conditions.
 * All fields describe the last active CONTENT leaf (the buttons panel itself
 * and other non-content leaves never become the context).
 */
export interface WorkspaceContextSnapshot {
    /** View type of the active content leaf (e.g. 'markdown', 'pdf'), or null. */
    viewType: string | null;
    /** Vault-relative path of the active file, or null if the view has no file. */
    filePath: string | null;
    /** File name including extension, or null. */
    fileName: string | null;
    /** File name without extension, or null. */
    fileBaseName: string | null;
    /** Lowercased file extension without dot (e.g. 'md'), or null. */
    fileExtension: string | null;
    /** Parent folder path ('' for the vault root), or null if no file. */
    folderPath: string | null;
    /** All tags of the active file (frontmatter + inline), without '#', deduped. */
    tags: readonly string[];
    /** Frontmatter properties of the active file ({} if none). */
    properties: Readonly<Record<string, unknown>>;
}

/** Minimal structural slice of Obsidian's CachedMetadata used by the builder. */
export interface ContextFileCache {
    frontmatter?: Record<string, unknown> | null;
    tags?: { tag: string }[] | null;
}

/** Input for buildContextSnapshot; plain data, no Obsidian objects. */
export interface ContextSnapshotInput {
    viewType: string | null;
    filePath: string | null;
    cache?: ContextFileCache | null;
}

const EMPTY_TAGS: readonly string[] = Object.freeze([]);
const EMPTY_PROPERTIES: Readonly<Record<string, unknown>> = Object.freeze({});

/** The empty context (no active content leaf / no file). */
export const EMPTY_WORKSPACE_CONTEXT: WorkspaceContextSnapshot = Object.freeze({
    viewType: null,
    filePath: null,
    fileName: null,
    fileBaseName: null,
    fileExtension: null,
    folderPath: null,
    tags: EMPTY_TAGS,
    properties: EMPTY_PROPERTIES,
});

/** Strip a leading '#' from a tag and trim whitespace. */
function normalizeTag(tag: string): string {
    const trimmed = tag.trim();
    return trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
}

/**
 * Extract all tags of a file from its metadata cache: inline tags
 * (cache.tags) plus frontmatter 'tags'/'tag' entries (string, comma-separated
 * string, or array). Returns normalized (no '#'), deduplicated tags in
 * encounter order. Original casing is kept; matching is case-insensitive in
 * the condition evaluator.
 */
export function extractTagsFromCache(cache: ContextFileCache | null | undefined): string[] {
    if (!cache) {
        return [];
    }

    const result: string[] = [];
    const seen = new Set<string>();
    const add = (value: unknown): void => {
        if (typeof value !== 'string') {
            return;
        }
        for (const part of value.split(',')) {
            const tag = normalizeTag(part);
            if (tag.length === 0) {
                continue;
            }
            const key = tag.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                result.push(tag);
            }
        }
    };

    if (Array.isArray(cache.tags)) {
        for (const entry of cache.tags) {
            if (entry && typeof entry === 'object') {
                add(entry.tag);
            }
        }
    }

    const frontmatter = cache.frontmatter;
    if (frontmatter && typeof frontmatter === 'object') {
        for (const key of ['tags', 'tag']) {
            const value = frontmatter[key];
            if (Array.isArray(value)) {
                value.forEach(add);
            } else {
                add(value);
            }
        }
    }

    return result;
}

/** Copy frontmatter into a plain properties record (drops the legacy 'position' key). */
function extractProperties(
    cache: ContextFileCache | null | undefined
): Record<string, unknown> {
    const frontmatter = cache?.frontmatter;
    if (!frontmatter || typeof frontmatter !== 'object') {
        return EMPTY_PROPERTIES;
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
        if (key === 'position') {
            continue;
        }
        result[key] = value;
    }
    return result;
}

/**
 * Build an immutable context snapshot from plain input data.
 * Pure function: same input yields a structurally identical snapshot.
 */
export function buildContextSnapshot(input: ContextSnapshotInput): WorkspaceContextSnapshot {
    const filePath = input.filePath && input.filePath.length > 0 ? input.filePath : null;

    let fileName: string | null = null;
    let fileBaseName: string | null = null;
    let fileExtension: string | null = null;
    let folderPath: string | null = null;

    if (filePath !== null) {
        const lastSlash = filePath.lastIndexOf('/');
        fileName = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
        folderPath = lastSlash >= 0 ? filePath.slice(0, lastSlash) : '';
        const lastDot = fileName.lastIndexOf('.');
        if (lastDot > 0) {
            fileBaseName = fileName.slice(0, lastDot);
            fileExtension = fileName.slice(lastDot + 1).toLowerCase();
        } else {
            fileBaseName = fileName;
            fileExtension = null;
        }
    }

    return {
        viewType: input.viewType ?? null,
        filePath,
        fileName,
        fileBaseName,
        fileExtension,
        folderPath,
        tags: filePath !== null ? extractTagsFromCache(input.cache) : EMPTY_TAGS,
        properties: filePath !== null ? extractProperties(input.cache) : EMPTY_PROPERTIES,
    };
}

/** Shallow equality on two plain records (key sets + Object.is on values). */
function recordsEqual(
    a: Readonly<Record<string, unknown>>,
    b: Readonly<Record<string, unknown>>
): boolean {
    if (a === b) {
        return true;
    }
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
        return false;
    }
    for (const key of aKeys) {
        if (!Object.prototype.hasOwnProperty.call(b, key) || !Object.is(a[key], b[key])) {
            return false;
        }
    }
    return true;
}

/**
 * Semantic equality of two snapshots. Used by the context service to avoid
 * emitting a new snapshot (and re-rendering React subscribers) when nothing
 * relevant changed. Note: nested frontmatter values are compared by identity;
 * Obsidian's metadata cache replaces the frontmatter object when a file's
 * metadata changes, so identity is a reliable change signal here.
 */
export function contextSnapshotsEqual(
    a: WorkspaceContextSnapshot,
    b: WorkspaceContextSnapshot
): boolean {
    if (a === b) {
        return true;
    }
    if (
        a.viewType !== b.viewType ||
        a.filePath !== b.filePath ||
        a.fileName !== b.fileName ||
        a.fileBaseName !== b.fileBaseName ||
        a.fileExtension !== b.fileExtension ||
        a.folderPath !== b.folderPath
    ) {
        return false;
    }
    if (a.tags.length !== b.tags.length || a.tags.some((tag, i) => tag !== b.tags[i])) {
        return false;
    }
    return recordsEqual(a.properties, b.properties);
}
