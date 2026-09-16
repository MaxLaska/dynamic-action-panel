import { describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import { ScriptService } from '@/services/ScriptService';

/** Builds a ScriptService whose vault returns the given script source. */
function createService(scriptSource: string) {
    const read = vi.fn().mockResolvedValue(scriptSource);
    const app = { vault: { read } } as unknown as App;
    return { service: new ScriptService(app), read };
}

function fakeFile(path: string): TFile {
    return { path, basename: path.replace(/^.*\//, '').replace(/\.js$/, '') } as TFile;
}

describe('ScriptService.getScriptMeta', () => {
    it('extracts static metadata without executing the script', async () => {
        const globals = globalThis as Record<string, unknown>;
        delete globals.__scriptServicePwned;
        const { service } = createService(`
            globalThis.__scriptServicePwned = true;

            async function main() {
                this.$context.notice('side effect');
            }

            module.exports = {
                entry: main,
                name: { zh: '名称', en: 'Name', ru: 'Имя' },
                description: 'a description',
                tags: ['demo'],
            };
        `);

        const meta = await service.getScriptMeta(fakeFile('scripts/demo.js'));

        // Top-level code must NOT run during metadata retrieval.
        expect(globals.__scriptServicePwned).toBeUndefined();
        expect(meta).not.toBeNull();
        expect(meta?.name).toEqual({ zh: '名称', en: 'Name', ru: 'Имя' });
        expect(meta?.description).toBe('a description');
        expect(meta?.tags).toEqual(['demo']);
    });

    it('returns null for scripts without module.exports metadata', async () => {
        const { service } = createService('console.log("just a script");');
        expect(await service.getScriptMeta(fakeFile('scripts/plain.js'))).toBeNull();
    });

    it('returns null when the exports object lacks an entry property', async () => {
        const { service } = createService("module.exports = { name: 'no entry' };");
        expect(await service.getScriptMeta(fakeFile('scripts/noentry.js'))).toBeNull();
    });

    it('returns null for invalid metadata without throwing', async () => {
        const { service } = createService('module.exports = { entry: main, name: ');
        await expect(
            service.getScriptMeta(fakeFile('scripts/broken.js'))
        ).resolves.toBeNull();
    });

    it('returns null when reading the file fails', async () => {
        const read = vi.fn().mockRejectedValue(new Error('io error'));
        const app = { vault: { read } } as unknown as App;
        const service = new ScriptService(app);
        expect(await service.getScriptMeta(fakeFile('scripts/missing.js'))).toBeNull();
    });

    it('caches results per file path', async () => {
        const { service, read } = createService(
            "module.exports = { entry: main, name: 'cached' };"
        );
        const file = fakeFile('scripts/cached.js');
        await service.getScriptMeta(file);
        await service.getScriptMeta(file);
        expect(read).toHaveBeenCalledTimes(1);
    });

    it('resolves localized text from partial locale objects', () => {
        const app = {} as App;
        const service = new ScriptService(app);
        expect(service.resolveLocalizedText({ en: 'english' }, 'fallback')).toBe('english');
        expect(service.resolveLocalizedText({ zh: '中文' }, 'fallback')).toBe('中文');
        expect(service.resolveLocalizedText(undefined, 'fallback')).toBe('fallback');
        expect(service.resolveLocalizedText('plain', 'fallback')).toBe('plain');
    });
});
