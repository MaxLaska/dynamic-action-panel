import { describe, expect, it } from 'vitest';
import {
    buildContextSnapshot,
    contextSnapshotsEqual,
    EMPTY_OCAP_CONTEXT,
    extractTagsFromCache,
} from '@/context/OCAPContext';

describe('buildContextSnapshot', () => {
    it('builds the empty context for null input', () => {
        const snapshot = buildContextSnapshot({ viewType: null, filePath: null });
        expect(snapshot).toEqual(EMPTY_OCAP_CONTEXT);
    });

    it('derives file name, base name, extension and folder from the path', () => {
        const snapshot = buildContextSnapshot({
            viewType: 'markdown',
            filePath: 'Projects/OCAP/Notes.md',
        });
        expect(snapshot.viewType).toBe('markdown');
        expect(snapshot.filePath).toBe('Projects/OCAP/Notes.md');
        expect(snapshot.fileName).toBe('Notes.md');
        expect(snapshot.fileBaseName).toBe('Notes');
        expect(snapshot.fileExtension).toBe('md');
        expect(snapshot.folderPath).toBe('Projects/OCAP');
    });

    it('uses an empty folder path for files in the vault root', () => {
        const snapshot = buildContextSnapshot({ viewType: 'markdown', filePath: 'Root.md' });
        expect(snapshot.folderPath).toBe('');
        expect(snapshot.fileName).toBe('Root.md');
    });

    it('lowercases the extension and handles dotfiles/extensionless names', () => {
        expect(
            buildContextSnapshot({ viewType: null, filePath: 'a/Image.PNG' }).fileExtension
        ).toBe('png');
        const dotfile = buildContextSnapshot({ viewType: null, filePath: 'a/.hidden' });
        expect(dotfile.fileExtension).toBeNull();
        expect(dotfile.fileBaseName).toBe('.hidden');
    });

    it('collects frontmatter properties and drops the position key', () => {
        const snapshot = buildContextSnapshot({
            viewType: 'markdown',
            filePath: 'a.md',
            cache: {
                frontmatter: { status: 'done', priority: 2, position: { start: 0 } },
            },
        });
        expect(snapshot.properties).toEqual({ status: 'done', priority: 2 });
    });

    it('keeps tags and properties empty when there is no file', () => {
        const snapshot = buildContextSnapshot({
            viewType: 'empty',
            filePath: null,
            cache: { frontmatter: { ignored: true }, tags: [{ tag: '#x' }] },
        });
        expect(snapshot.tags).toEqual([]);
        expect(snapshot.properties).toEqual({});
    });
});

describe('extractTagsFromCache', () => {
    it('returns [] for missing cache', () => {
        expect(extractTagsFromCache(null)).toEqual([]);
        expect(extractTagsFromCache(undefined)).toEqual([]);
    });

    it('normalizes inline tags (strips #)', () => {
        expect(extractTagsFromCache({ tags: [{ tag: '#project' }, { tag: '#a/b' }] })).toEqual([
            'project',
            'a/b',
        ]);
    });

    it('reads frontmatter tags as array, string and comma-separated string', () => {
        expect(extractTagsFromCache({ frontmatter: { tags: ['x', 'y'] } })).toEqual(['x', 'y']);
        expect(extractTagsFromCache({ frontmatter: { tags: 'solo' } })).toEqual(['solo']);
        expect(extractTagsFromCache({ frontmatter: { tags: 'a, b' } })).toEqual(['a', 'b']);
        expect(extractTagsFromCache({ frontmatter: { tag: 'legacy' } })).toEqual(['legacy']);
    });

    it('deduplicates case-insensitively across sources and ignores non-strings', () => {
        expect(
            extractTagsFromCache({
                tags: [{ tag: '#Project' }],
                frontmatter: { tags: ['project', 'other', 42, null] },
            })
        ).toEqual(['Project', 'other']);
    });
});

describe('contextSnapshotsEqual', () => {
    const base = () =>
        buildContextSnapshot({
            viewType: 'markdown',
            filePath: 'a/b.md',
            cache: { frontmatter: { status: 'open' }, tags: [{ tag: '#t' }] },
        });

    it('treats structurally identical snapshots as equal', () => {
        expect(contextSnapshotsEqual(base(), base())).toBe(true);
    });

    it('detects scalar field changes', () => {
        const changed = buildContextSnapshot({
            viewType: 'pdf',
            filePath: 'a/b.md',
            cache: { frontmatter: { status: 'open' }, tags: [{ tag: '#t' }] },
        });
        expect(contextSnapshotsEqual(base(), changed)).toBe(false);
    });

    it('detects tag list changes', () => {
        const changed = buildContextSnapshot({
            viewType: 'markdown',
            filePath: 'a/b.md',
            cache: { frontmatter: { status: 'open' }, tags: [{ tag: '#t' }, { tag: '#u' }] },
        });
        expect(contextSnapshotsEqual(base(), changed)).toBe(false);
    });

    it('detects property value and key-set changes', () => {
        const valueChanged = buildContextSnapshot({
            viewType: 'markdown',
            filePath: 'a/b.md',
            cache: { frontmatter: { status: 'done' }, tags: [{ tag: '#t' }] },
        });
        const keyAdded = buildContextSnapshot({
            viewType: 'markdown',
            filePath: 'a/b.md',
            cache: { frontmatter: { status: 'open', extra: 1 }, tags: [{ tag: '#t' }] },
        });
        expect(contextSnapshotsEqual(base(), valueChanged)).toBe(false);
        expect(contextSnapshotsEqual(base(), keyAdded)).toBe(false);
    });

    it('treats the empty context as equal to a rebuilt empty context', () => {
        expect(
            contextSnapshotsEqual(
                EMPTY_OCAP_CONTEXT,
                buildContextSnapshot({ viewType: null, filePath: null })
            )
        ).toBe(true);
    });
});
