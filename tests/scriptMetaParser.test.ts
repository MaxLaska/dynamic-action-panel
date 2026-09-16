import { describe, expect, it } from 'vitest';
import { parseScriptMeta } from '@/utils/scriptMetaParser';

describe('parseScriptMeta', () => {
    it('parses the documented metadata shape (localized objects, tags, entry reference)', () => {
        const source = `
            async function main() {
                const { app, obsidian, notice } = this.$context;
                notice('hello');
            }

            module.exports = {
                entry: main,
                name: { zh: '批量处理', en: 'Batch process', ru: 'Пакетная обработка' },
                description: { zh: '描述', en: 'Description', ru: 'Описание' },
                tags: ['file', 'batch'],
            };
        `;
        const meta = parseScriptMeta(source);
        expect(meta).not.toBeNull();
        expect(meta?.hasEntry).toBe(true);
        expect(meta?.name).toEqual({
            zh: '批量处理',
            en: 'Batch process',
            ru: 'Пакетная обработка',
        });
        expect(meta?.description).toEqual({
            zh: '描述',
            en: 'Description',
            ru: 'Описание',
        });
        expect(meta?.tags).toEqual(['file', 'batch']);
    });

    it('parses plain string name/description and template literals without interpolation', () => {
        const source = `
            module.exports = {
                entry: () => {},
                name: "My script",
                description: \`does things\`,
            };
        `;
        const meta = parseScriptMeta(source);
        expect(meta?.hasEntry).toBe(true);
        expect(meta?.name).toBe('My script');
        expect(meta?.description).toBe('does things');
    });

    it('does not execute top-level script code', () => {
        const globals = globalThis as Record<string, unknown>;
        delete globals.__scriptMetaParserPwned;
        const source = `
            globalThis.__scriptMetaParserPwned = true;
            require('child_process');

            module.exports = {
                entry: function () {},
                name: 'safe',
            };
        `;
        const meta = parseScriptMeta(source);
        expect(globals.__scriptMetaParserPwned).toBeUndefined();
        expect(meta?.name).toBe('safe');
    });

    it('returns null when there is no module.exports assignment', () => {
        expect(parseScriptMeta('const x = 1;\nconsole.log(x);')).toBeNull();
    });

    it('ignores module.exports occurrences inside strings and comments', () => {
        const source = `
            // module.exports = { entry: fake, name: 'comment' }
            const s = "module.exports = { entry: fake, name: 'string' }";
        `;
        expect(parseScriptMeta(source)).toBeNull();
    });

    it('uses the last module.exports assignment (last write wins)', () => {
        const source = `
            module.exports = { entry: a, name: 'first' };
            module.exports = { entry: b, name: 'second' };
        `;
        expect(parseScriptMeta(source)?.name).toBe('second');
    });

    it('reports hasEntry for inline function expressions and shorthand properties', () => {
        const inline = `module.exports = { entry: async function () { const s = "{'}"; }, name: 'x' };`;
        expect(parseScriptMeta(inline)?.hasEntry).toBe(true);
        expect(parseScriptMeta(inline)?.name).toBe('x');

        const shorthand = `function entry() {}\nmodule.exports = { entry, name: 'y' };`;
        expect(parseScriptMeta(shorthand)?.hasEntry).toBe(true);
        expect(parseScriptMeta(shorthand)?.name).toBe('y');
    });

    it('reports hasEntry: false when entry is missing', () => {
        const meta = parseScriptMeta(`module.exports = { name: 'no entry' };`);
        expect(meta?.hasEntry).toBe(false);
        expect(meta?.name).toBe('no entry');
    });

    it('skips values that are not statically determinable without failing', () => {
        const source = `
            module.exports = {
                entry: main,
                name: buildName(),
                description: 'static ' + suffix,
                tags: ['ok', dynamicTag, 42],
            };
        `;
        const meta = parseScriptMeta(source);
        expect(meta?.hasEntry).toBe(true);
        expect(meta?.name).toBeUndefined();
        expect(meta?.description).toBeUndefined();
        expect(meta?.tags).toEqual(['ok']);
    });

    it('skips template literals with interpolation', () => {
        const meta = parseScriptMeta(
            'module.exports = { entry: main, name: `hello ${user}` };'
        );
        expect(meta?.hasEntry).toBe(true);
        expect(meta?.name).toBeUndefined();
    });

    it('returns null for non-literal exports assignments', () => {
        expect(parseScriptMeta('module.exports = buildMeta();')).toBeNull();
        expect(parseScriptMeta('module.exports = someObject;')).toBeNull();
    });

    it('returns null for malformed object literals instead of throwing', () => {
        expect(parseScriptMeta('module.exports = { entry: main, name: ')).toBeNull();
        expect(parseScriptMeta('module.exports = { entry: main; name: 1 }')).toBeNull();
        expect(parseScriptMeta("module.exports = { name: 'unterminated")).toBeNull();
    });

    it('handles comments and trailing commas inside the exports object', () => {
        const source = `
            module.exports = {
                // the entry point
                entry: main, /* inline */
                name: 'commented', // trailing note
            };
        `;
        const meta = parseScriptMeta(source);
        expect(meta?.hasEntry).toBe(true);
        expect(meta?.name).toBe('commented');
    });

    it('keeps only string values in localized text objects', () => {
        const meta = parseScriptMeta(
            "module.exports = { entry: main, name: { en: 'ok', zh: dynamic() } };"
        );
        expect(meta?.name).toEqual({ en: 'ok' });
    });

    it('decodes common string escapes', () => {
        const meta = parseScriptMeta(
            "module.exports = { entry: main, name: 'a\\nb\\u0041\\'c' };"
        );
        expect(meta?.name).toBe("a\nbA'c");
    });
});
