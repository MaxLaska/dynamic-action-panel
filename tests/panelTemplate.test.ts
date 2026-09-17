// tests/panelTemplate.test.ts
// The portable template format: export, parse/validate, import.
//
// The two properties everything else hangs off:
// - EXPORT IS READ-ONLY. A category can be shipped without the settings
//   changing by a single byte;
// - IMPORT CREATES. Every identity in a document is a package-local reference
//   that is replaced by a fresh id, so importing can never overwrite,
//   merge into or silently share with what the vault already has — and the
//   same file can be imported twice without a collision.
//
// The failure cases matter as much as the happy path: a broken, foreign or
// too-new document must leave the state EXACTLY as it was. There is no such
// thing as a partial import.

import { describe, it, expect } from 'vitest';
import {
    buildTemplateDocument,
    serializeTemplateDocument,
    templateFileName,
} from '@/export/templateExport';
import { parseTemplateDocument, validateTemplateDocument } from '@/export/templateParse';
import {
    collectTemplateExternalReferences,
    planTemplateImport,
    type TemplateIdKind,
} from '@/export/templateImport';
import {
    OCAP_TEMPLATE_FORMAT,
    OCAP_TEMPLATE_FORMAT_VERSION,
    type TemplateDocument,
} from '@/export/templateFormat';
import { materializeCategoriesForRuntime } from '@/domain/tools';
import type { ToolState } from '@/domain/categoryOps';
import type { CategoryConfig, GridCellStyles, StoredCategory } from '@/types/settings';
import {
    p,
    registryOf,
    stateOf,
    storedDynamic,
    storedFlow,
    storedGrid,
    storedVariant,
    tool,
} from './helpers/stored';

// --- Fixtures -------------------------------------------------------------------

const fileTool = (id: string, path: string) =>
    tool(id, {
        name: id.toUpperCase(),
        icon: '<svg />',
        actions: [{ type: 'file' as const, parameters: { filePath: path } }],
        executionMode: 'sequential' as const,
        stopOnError: true,
        delayBetweenActions: 120,
        customCss: 'color: red;',
    });

const styles = (entries: Record<string, string>): GridCellStyles => {
    const result: GridCellStyles = {};
    for (const [key, color] of Object.entries(entries)) {
        result[key] = { color };
    }
    return result;
};

/** Deterministic, collision-free id factory for the tests. */
function idFactory(): (kind: TemplateIdKind) => string {
    let n = 0;
    return (kind) => `${kind}-${++n}`;
}

/** A snapshot to prove a state was not touched. */
const snapshot = (state: ToolState): string => JSON.stringify(state);

/**
 * The runtime view of a category with every identity blanked out. Ids are
 * expected to differ after an import — everything else must not.
 */
function semantics(category: CategoryConfig): unknown {
    const button = (b: CategoryConfig['buttons'][number]) => {
        const { id: _id, ...rest } = b;
        return rest;
    };
    const { id: _id, order: _order, variants, buttons, ...rest } = category;
    return {
        ...rest,
        buttons: buttons.map(button),
        ...(variants
            ? {
                  variants: variants.map((variant) => {
                      const { id: _vid, buttons: variantButtons, ...variantRest } = variant;
                      return { ...variantRest, buttons: variantButtons.map(button) };
                  }),
              }
            : {}),
    };
}

function viewOf(state: ToolState, categoryId: string): CategoryConfig {
    const view = materializeCategoriesForRuntime(state.categories, state.tools).find(
        (category) => category.id === categoryId
    );
    if (!view) throw new Error(`no category ${categoryId}`);
    return view;
}

/** Export one category and import it into `target`; returns the new state. */
function roundtrip(
    source: ToolState,
    categoryId: string,
    target: ToolState = { tools: {}, categories: [] }
): { state: ToolState; document: TemplateDocument } {
    const document = buildTemplateDocument(source, [categoryId]);
    const parsed = parseTemplateDocument(serializeTemplateDocument(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('parse failed');
    const plan = planTemplateImport(target, parsed.document, { newId: idFactory() });
    return { state: plan.state, document: parsed.document };
}

// --- Roundtrips -------------------------------------------------------------------

describe('static category roundtrip (tests 1, 5, 6, 7, 12-roundtrip)', () => {
    const source = stateOf(
        registryOf(fileTool('a', 'Literatur/Bieker.pdf'), fileTool('b', 'Notes/x.md')),
        storedGrid([p('a', 0), p('b', 5)], {
            id: 'cat',
            name: 'Research',
            rows: 2,
            columns: 3,
            conditions: { rule: 'extension', value: 'md' },
        })
    );

    it('survives export -> import into an empty state unchanged except for ids', () => {
        const { state } = roundtrip(source, 'cat');
        expect(state.categories).toHaveLength(1);
        expect(semantics(viewOf(state, state.categories[0]!.id))).toEqual(
            semantics(viewOf(source, 'cat'))
        );
    });

    it('keeps grid dimensions, slots and the full tool configuration', () => {
        const { state } = roundtrip(source, 'cat');
        const imported = state.categories[0]!;
        expect(imported.rows).toBe(2);
        expect(imported.columns).toBe(3);
        expect(imported.placements.map((placement) => placement.slot)).toEqual([0, 5]);

        const definition = state.tools[imported.placements[0]!.toolId]!;
        expect(definition.name).toBe('A');
        expect(definition.icon).toBe('<svg />');
        expect(definition.executionMode).toBe('sequential');
        expect(definition.stopOnError).toBe(true);
        expect(definition.delayBetweenActions).toBe(120);
        expect(definition.customCss).toBe('color: red;');
        expect(definition.actions).toEqual([
            { type: 'file', parameters: { filePath: 'Literatur/Bieker.pdf' } },
        ]);
    });

    it('never exports the vault-local library flag', () => {
        const withLibrary = stateOf(
            registryOf(tool('a', { library: true })),
            storedGrid([p('a', 0)], { id: 'cat' })
        );
        const document = buildTemplateDocument(withLibrary, ['cat']);
        expect(document.tools['a']).not.toHaveProperty('library');
        const { state } = roundtrip(withLibrary, 'cat');
        expect(Object.values(state.tools)[0]).not.toHaveProperty('library');
    });
});

describe('flow category roundtrip (test 2)', () => {
    it('keeps the placement order and drops no per-tool condition', () => {
        const source = stateOf(
            registryOf(
                tool('a', { conditions: { rule: 'extension', value: 'pdf' } }),
                tool('b'),
                tool('c')
            ),
            storedFlow([p('c'), p('a'), p('b')], { id: 'cat', name: 'Flow' })
        );
        const { state } = roundtrip(source, 'cat');
        const imported = state.categories[0]!;
        expect(imported.layout).toBeUndefined();
        expect(
            imported.placements.map((placement) => state.tools[placement.toolId]!.name)
        ).toEqual(['c', 'a', 'b']);
        expect(imported.placements.every((placement) => placement.slot === undefined)).toBe(
            true
        );
        expect(semantics(viewOf(state, imported.id))).toEqual(semantics(viewOf(source, 'cat')));
    });
});

describe('dynamic category roundtrip (tests 3, 4, 13)', () => {
    const source = stateOf(
        registryOf(
            fileTool('a1', 'Src/one.pdf'),
            fileTool('a2', 'Src/two.pdf'),
            fileTool('b1', 'Other/one.md'),
            fileTool('f1', 'Fallback/one.md')
        ),
        storedDynamic(
            [
                storedVariant(
                    'vA',
                    { rule: 'fileName', op: 'startsWith', value: 'SRC_' },
                    [p('a1', 0), p('a2', 7)],
                    false,
                    { rows: 3, columns: 4, cellStyles: styles({ r2c3: 'ocap:red' }) }
                ),
                storedVariant(
                    'vB',
                    { rule: 'extension', value: 'md' },
                    [p('b1', 4)],
                    false,
                    { rows: 2, columns: 5, cellStyles: styles({ r1c4: 'ocap:blue' }) }
                ),
                storedVariant('vF', undefined, [p('f1', 0)], true, {
                    rows: 1,
                    columns: 2,
                }),
            ],
            { id: 'cat', name: 'Research' }
        )
    );

    it('keeps every variant, its order, trigger, fallback, size and placements', () => {
        const { state } = roundtrip(source, 'cat');
        const variants = state.categories[0]!.variants!;
        expect(variants).toHaveLength(3);

        expect(variants[0]!.name).toBe('vA');
        expect(variants[0]!.trigger).toEqual({
            rule: 'fileName',
            op: 'startsWith',
            value: 'SRC_',
        });
        expect(variants[0]!.rows).toBe(3);
        expect(variants[0]!.columns).toBe(4);
        expect(variants[0]!.placements.map((entry) => entry.slot)).toEqual([0, 7]);

        expect(variants[1]!.trigger).toEqual({ rule: 'extension', value: 'md' });
        expect(variants[1]!.rows).toBe(2);
        expect(variants[1]!.columns).toBe(5);

        expect(variants[2]!.fallback).toBe(true);
        expect(variants[2]!.trigger).toBeUndefined();
        expect(variants[2]!.rows).toBe(1);
        expect(variants[2]!.columns).toBe(2);
    });

    it('is semantically identical to the original', () => {
        const { state } = roundtrip(source, 'cat');
        expect(semantics(viewOf(state, state.categories[0]!.id))).toEqual(
            semantics(viewOf(source, 'cat'))
        );
    });

    it('mints fresh ids for the category, every variant and every tool (test 8)', () => {
        const { state } = roundtrip(source, 'cat');
        const imported = state.categories[0]!;
        expect(imported.id).not.toBe('cat');
        const variantIds = imported.variants!.map((variant) => variant.id);
        expect(variantIds).not.toContain('vA');
        expect(new Set(variantIds).size).toBe(3);

        const toolIds = Object.keys(state.tools);
        expect(toolIds).toHaveLength(4);
        for (const original of ['a1', 'a2', 'b1', 'f1']) {
            expect(toolIds).not.toContain(original);
        }
    });

    it('keeps the cell styles of each variant variant-local (tests 19, 20)', () => {
        const { state, document } = roundtrip(source, 'cat');
        expect(document.categories[0]!.variants![0]!.cellStyles).toEqual(
            styles({ r2c3: 'ocap:red' })
        );
        const variants = state.categories[0]!.variants!;
        expect(variants[0]!.cellStyles).toEqual(styles({ r2c3: 'ocap:red' }));
        expect(variants[1]!.cellStyles).toEqual(styles({ r1c4: 'ocap:blue' }));
        expect(variants[2]!.cellStyles).toBeUndefined();
    });
});

describe('cell styles of a STATIC grid survive the roundtrip (test 19)', () => {
    it('travels in the document and arrives on the imported category', () => {
        const source = stateOf(
            registryOf(tool('a')),
            storedGrid([p('a', 0)], {
                id: 'cat',
                rows: 2,
                columns: 3,
                cellStyles: styles({ r0c0: 'ocap:red', r1c2: '#a1b2c3' }),
            })
        );
        const { state, document } = roundtrip(source, 'cat');
        expect(document.categories[0]!.cellStyles).toEqual(
            styles({ r0c0: 'ocap:red', r1c2: '#a1b2c3' })
        );
        expect(state.categories[0]!.cellStyles).toEqual(
            styles({ r0c0: 'ocap:red', r1c2: '#a1b2c3' })
        );
    });

    it('drops styles of cells the imported grid does not have', () => {
        const document: TemplateDocument = {
            format: OCAP_TEMPLATE_FORMAT,
            formatVersion: 1,
            categories: [
                {
                    id: 'c',
                    name: 'C',
                    layout: 'grid',
                    rows: 1,
                    columns: 2,
                    cellStyles: styles({ r0c0: 'ocap:red', r4c4: 'ocap:blue' }),
                    placements: [],
                },
            ],
            tools: {},
        };
        const plan = planTemplateImport({ tools: {}, categories: [] }, document, {
            newId: idFactory(),
        });
        expect(plan.state.categories[0]!.cellStyles).toEqual(styles({ r0c0: 'ocap:red' }));
    });
});

// --- Export scope and purity ---------------------------------------------------

describe('export scope (test 17)', () => {
    const state = stateOf(
        registryOf(tool('used'), tool('elsewhere'), tool('orphan', { library: true })),
        storedGrid([p('used', 0)], { id: 'cat', name: 'Exported' }),
        storedGrid([p('elsewhere', 0)], { id: 'other', name: 'Other', order: 1 })
    );

    it('exports only the tools the exported categories reference', () => {
        const document = buildTemplateDocument(state, ['cat']);
        expect(Object.keys(document.tools)).toEqual(['used']);
    });

    it('exports several categories with their combined tool set', () => {
        const document = buildTemplateDocument(state, ['cat', 'other']);
        expect(document.categories.map((category) => category.name)).toEqual([
            'Exported',
            'Other',
        ]);
        expect(Object.keys(document.tools).sort()).toEqual(['elsewhere', 'used']);
    });

    it('carries the format identifier and its OWN version', () => {
        const document = buildTemplateDocument(state, ['cat']);
        expect(document.format).toBe('ocap-template');
        expect(document.formatVersion).toBe(OCAP_TEMPLATE_FORMAT_VERSION);
        expect(document).not.toHaveProperty('settingsVersion');
    });

    it('never mutates the state it reads (rule 22)', () => {
        const before = snapshot(state);
        buildTemplateDocument(state, ['cat', 'other'], {
            pluginVersion: '1.2.3',
            exportedAt: 'now',
        });
        expect(snapshot(state)).toBe(before);
    });

    it('produces a document detached from the stored objects', () => {
        const document = buildTemplateDocument(state, ['cat']);
        expect(document.tools['used']).not.toBe(state.tools['used']);
        expect(document.categories[0]!.placements[0]).not.toBe(
            state.categories[0]!.placements[0]
        );
    });

    it('derives a readable file name from the category name', () => {
        expect(templateFileName('Research')).toBe('Research.ocap.json');
        expect(templateFileName('Re/se*arch?')).toBe('Re se arch.ocap.json');
        expect(templateFileName('   ')).toBe('template.ocap.json');
    });
});

// --- Import against an existing state ---------------------------------------------

describe('import never touches what is already there (tests 9, 10)', () => {
    const source = stateOf(
        registryOf(fileTool('a', 'Literatur/Bieker.pdf')),
        storedGrid([p('a', 0)], { id: 'cat', name: 'Research' })
    );

    const existing = (): ToolState =>
        stateOf(
            registryOf(tool('a', { name: 'Bieker' })),
            storedGrid([p('a', 0)], { id: 'cat', name: 'Research' })
        );

    it('keeps the existing category and tool untouched', () => {
        const target = existing();
        const before = snapshot(target);
        const { state } = roundtrip(source, 'cat', target);

        expect(snapshot(target)).toBe(before);
        expect(state.categories[0]).toBe(target.categories[0]);
        expect(state.tools['a']).toBe(target.tools['a']);
        expect(state.categories).toHaveLength(2);
        expect(Object.keys(state.tools)).toHaveLength(2);
    });

    it('creates a SEPARATE tool even when an identical one exists (test 7 of the brief)', () => {
        const target = existing();
        const { state } = roundtrip(source, 'cat', target);
        const importedToolId = state.categories[1]!.placements[0]!.toolId;
        expect(importedToolId).not.toBe('a');
        expect(state.tools[importedToolId]).not.toBe(state.tools['a']);
    });

    it('imports the same document twice without any collision', () => {
        const document = buildTemplateDocument(source, ['cat']);
        const parsed = validateTemplateDocument(JSON.parse(JSON.stringify(document)));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        const newId = idFactory();
        const first = planTemplateImport(existing(), parsed.document, { newId });
        const second = planTemplateImport(first.state, parsed.document, { newId });

        expect(second.state.categories).toHaveLength(3);
        const ids = second.state.categories.map((category) => category.id);
        expect(new Set(ids).size).toBe(3);
        expect(Object.keys(second.state.tools)).toHaveLength(3);
        expect(second.state.categories[2]!.placements[0]!.toolId).not.toBe(
            second.state.categories[1]!.placements[0]!.toolId
        );
    });

    it('disambiguates a category name that is already taken', () => {
        const document = buildTemplateDocument(source, ['cat']);
        const parsed = validateTemplateDocument(JSON.parse(JSON.stringify(document)));
        if (!parsed.ok) throw new Error('parse failed');

        const newId = idFactory();
        const first = planTemplateImport(existing(), parsed.document, { newId });
        const second = planTemplateImport(first.state, parsed.document, { newId });
        expect(second.state.categories.map((category) => category.name)).toEqual([
            'Research',
            'Research (imported)',
            'Research (imported 2)',
        ]);
    });

    it('leaves a free name alone and appends at the end of the order', () => {
        const target = stateOf(registryOf(), storedGrid([], { id: 'other', name: 'Other' }));
        const { state } = roundtrip(source, 'cat', target);
        expect(state.categories[1]!.name).toBe('Research');
        expect(state.categories[1]!.order).toBe(1);
    });
});

describe('several categories in one document (test 18)', () => {
    it('imports all of them, in document order, with their own tools', () => {
        const source = stateOf(
            registryOf(tool('a'), tool('b'), tool('c')),
            storedGrid([p('a', 0)], { id: 'one', name: 'One' }),
            storedDynamic([storedVariant('v', undefined, [p('b', 0)], true)], {
                id: 'two',
                name: 'Two',
                order: 1,
            }),
            storedFlow([p('c')], { id: 'three', name: 'Three', order: 2 })
        );
        const document = buildTemplateDocument(source, ['one', 'two', 'three']);
        const parsed = parseTemplateDocument(serializeTemplateDocument(document));
        if (!parsed.ok) throw new Error('parse failed');

        const plan = planTemplateImport({ tools: {}, categories: [] }, parsed.document, {
            newId: idFactory(),
        });
        expect(plan.state.categories.map((category) => category.name)).toEqual([
            'One',
            'Two',
            'Three',
        ]);
        expect(plan.state.categories.map((category) => category.order)).toEqual([0, 1, 2]);
        expect(Object.keys(plan.state.tools)).toHaveLength(3);
        expect(plan.summary).toEqual({
            categoryCount: 3,
            toolCount: 3,
            categoryNames: ['One', 'Two', 'Three'],
        });
    });

    it('keeps a tool the document shares between two categories shared', () => {
        // Nothing produces this today (create/copy always fork), but a future
        // library tool placed twice would — and the imported panel must be the
        // panel that was exported.
        const document: TemplateDocument = {
            format: OCAP_TEMPLATE_FORMAT,
            formatVersion: 1,
            categories: [
                { id: 'a', name: 'A', layout: 'grid', placements: [{ toolId: 't', slot: 0 }] },
                { id: 'b', name: 'B', layout: 'grid', placements: [{ toolId: 't', slot: 1 }] },
            ],
            tools: { t: { id: 't', name: 'Shared', actions: [] } },
        };
        const plan = planTemplateImport({ tools: {}, categories: [] }, document, {
            newId: idFactory(),
        });
        expect(Object.keys(plan.state.tools)).toHaveLength(1);
        expect(plan.state.categories[0]!.placements[0]!.toolId).toBe(
            plan.state.categories[1]!.placements[0]!.toolId
        );
    });
});

// --- Missing external targets -------------------------------------------------------

describe('missing external targets never block an import (test 11)', () => {
    it('keeps the action path byte-for-byte and imports anyway', () => {
        const source = stateOf(
            registryOf(
                fileTool('a', 'Literatur/Bieker_Westerholt.pdf'),
                tool('s', {
                    actions: [{ type: 'script', parameters: { scriptName: 'test.js' } }],
                })
            ),
            storedGrid([p('a', 0), p('s', 1)], { id: 'cat' })
        );
        const { state } = roundtrip(source, 'cat');
        const actions = Object.values(state.tools).flatMap(
            (definition) => definition.actions
        );
        expect(actions).toContainEqual({
            type: 'file',
            parameters: { filePath: 'Literatur/Bieker_Westerholt.pdf' },
        });
        expect(actions).toContainEqual({
            type: 'script',
            parameters: { scriptName: 'test.js' },
        });
    });

    it('reports the external targets for the summary without judging them', () => {
        const document: TemplateDocument = {
            format: OCAP_TEMPLATE_FORMAT,
            formatVersion: 1,
            categories: [{ id: 'c', name: 'C', placements: [] }],
            tools: {
                t1: {
                    id: 't1',
                    name: 'T1',
                    actions: [
                        { type: 'file', parameters: { filePath: 'a.pdf' } },
                        { type: 'script', parameters: { scriptName: 's.js' } },
                        { type: 'url', parameters: { url: 'https://example.com' } },
                    ],
                },
            },
        };
        expect(collectTemplateExternalReferences(document)).toEqual({
            filePaths: ['a.pdf'],
            scriptNames: ['s.js'],
        });
    });
});

// --- Rejection: nothing changes ------------------------------------------------------

describe('a document that cannot be trusted changes nothing (tests 12-16)', () => {
    const state = (): ToolState =>
        stateOf(registryOf(tool('a')), storedGrid([p('a', 0)], { id: 'cat' }));

    const rejects = (content: string, kind: string): void => {
        const before = snapshot(state());
        const parsed = parseTemplateDocument(content);
        expect(parsed.ok).toBe(false);
        if (parsed.ok) return;
        expect(parsed.error.kind).toBe(kind);
        // The import never ran, so the state is untouched by construction —
        // pinned here because "no partial import" is the whole promise.
        expect(snapshot(state())).toBe(before);
    };

    it('rejects invalid JSON (test 12)', () => {
        rejects('{ not json', 'invalid_json');
        rejects('', 'invalid_json');
    });

    it('rejects a foreign format identifier (test 13)', () => {
        rejects(JSON.stringify({ format: 'something-else', formatVersion: 1 }), 'not_a_template');
        rejects(JSON.stringify({ categories: [], tools: {} }), 'not_a_template');
        rejects(JSON.stringify([1, 2, 3]), 'not_a_template');
        // A raw internal data.json is not a template either.
        rejects(
            JSON.stringify({ settingsVersion: 5, tools: {}, categories: [] }),
            'not_a_template'
        );
    });

    it('rejects a newer format version instead of guessing (test 14)', () => {
        rejects(
            JSON.stringify({
                format: OCAP_TEMPLATE_FORMAT,
                formatVersion: OCAP_TEMPLATE_FORMAT_VERSION + 1,
                categories: [{ id: 'c', name: 'C', placements: [] }],
                tools: {},
            }),
            'unsupported_version'
        );
    });

    it('rejects a dangling internal tool reference (test 15)', () => {
        rejects(
            JSON.stringify({
                format: OCAP_TEMPLATE_FORMAT,
                formatVersion: 1,
                categories: [
                    { id: 'c', name: 'C', placements: [{ toolId: 'missing', slot: 0 }] },
                ],
                tools: { t: { id: 't', name: 'T', actions: [] } },
            }),
            'dangling_tool_reference'
        );
    });

    it('rejects a dangling reference inside a variant', () => {
        rejects(
            JSON.stringify({
                format: OCAP_TEMPLATE_FORMAT,
                formatVersion: 1,
                categories: [
                    {
                        id: 'c',
                        name: 'C',
                        layout: 'grid',
                        placements: [],
                        variants: [
                            { id: 'v', name: 'V', fallback: true, placements: [{ toolId: 'x' }] },
                        ],
                    },
                ],
                tools: {},
            }),
            'dangling_tool_reference'
        );
    });

    it('rejects malformed structures rather than importing them partially (test 16)', () => {
        const base = { format: OCAP_TEMPLATE_FORMAT, formatVersion: 1, tools: {} };
        rejects(JSON.stringify({ ...base, categories: 'nope' }), 'invalid_structure');
        rejects(JSON.stringify({ ...base, categories: [] }), 'invalid_structure');
        rejects(
            JSON.stringify({ ...base, categories: [{ name: 'no id', placements: [] }] }),
            'invalid_structure'
        );
        rejects(
            JSON.stringify({
                ...base,
                categories: [{ id: 'c', name: 'C', placements: [], layout: 'mosaic' }],
            }),
            'invalid_structure'
        );
        rejects(
            JSON.stringify({
                ...base,
                categories: [{ id: 'c', name: 'C', placements: [{ toolId: 't', slot: -1 }] }],
                tools: { t: { id: 't', name: 'T', actions: [] } },
            }),
            'invalid_structure'
        );
    });

    it('rejects an unknown action type', () => {
        rejects(
            JSON.stringify({
                format: OCAP_TEMPLATE_FORMAT,
                formatVersion: 1,
                categories: [{ id: 'c', name: 'C', placements: [{ toolId: 't' }] }],
                tools: {
                    t: {
                        id: 't',
                        name: 'T',
                        actions: [{ type: 'exec', parameters: { cmd: 'rm -rf /' } }],
                    },
                },
            }),
            'invalid_structure'
        );
    });

    it('rejects an unknown condition rule and a non-portable color', () => {
        const base = { format: OCAP_TEMPLATE_FORMAT, formatVersion: 1, tools: {} };
        rejects(
            JSON.stringify({
                ...base,
                categories: [
                    { id: 'c', name: 'C', placements: [], conditions: { rule: 'eval', value: 'x' } },
                ],
            }),
            'invalid_structure'
        );
        rejects(
            JSON.stringify({
                ...base,
                categories: [
                    {
                        id: 'c',
                        name: 'C',
                        layout: 'grid',
                        placements: [],
                        cellStyles: { r0c0: { color: 'var(--interactive-accent)' } },
                    },
                ],
            }),
            'invalid_structure'
        );
    });

    it('rejects a second fallback variant, which the domain would refuse anyway', () => {
        rejects(
            JSON.stringify({
                format: OCAP_TEMPLATE_FORMAT,
                formatVersion: 1,
                categories: [
                    {
                        id: 'c',
                        name: 'C',
                        layout: 'grid',
                        placements: [],
                        variants: [
                            { id: 'v1', name: 'A', fallback: true, placements: [] },
                            { id: 'v2', name: 'B', fallback: true, placements: [] },
                        ],
                    },
                ],
            }),
            'invalid_structure'
        );
    });
});

// --- Untrusted input ------------------------------------------------------------------

describe('a template is data, never code or a prototype', () => {
    it('refuses a tool id that would reach Object.prototype', () => {
        // Written as raw JSON on purpose: an object LITERAL with a
        // `__proto__` key sets the prototype instead of creating the property,
        // so building this fixture with JSON.stringify would test nothing.
        const parsed = parseTemplateDocument(
            `{"format":"${OCAP_TEMPLATE_FORMAT}","formatVersion":1,` +
                '"categories":[{"id":"c","name":"C","placements":[]}],' +
                '"tools":{"__proto__":{"id":"__proto__","name":"x","actions":[]}}}'
        );
        // JSON.parse really does hand `__proto__` through as an own property,
        // so this is a live hazard rather than a theoretical one: assigning it
        // into an object literal would replace that object's prototype.
        expect(parsed.ok).toBe(false);
        if (parsed.ok) return;
        expect(parsed.error.kind).toBe('invalid_structure');
        expect(({} as Record<string, unknown>)['name']).toBeUndefined();
    });

    it('refuses a reserved name as a reference id', () => {
        const parsed = parseTemplateDocument(
            JSON.stringify({
                format: OCAP_TEMPLATE_FORMAT,
                formatVersion: 1,
                categories: [
                    { id: 'c', name: 'C', placements: [{ toolId: 'constructor' }] },
                ],
                tools: { constructor: { name: 'x', actions: [] } },
            })
        );
        expect(parsed.ok).toBe(false);
    });

    it('adopts no property it does not know', () => {
        const parsed = parseTemplateDocument(
            JSON.stringify({
                format: OCAP_TEMPLATE_FORMAT,
                formatVersion: 1,
                evil: 'payload',
                categories: [
                    {
                        id: 'c',
                        name: 'C',
                        placements: [{ toolId: 't', extra: 1 }],
                        somethingElse: true,
                    },
                ],
                tools: {
                    t: {
                        id: 't',
                        name: 'T',
                        actions: [],
                        library: true,
                        onClick: 'alert(1)',
                    },
                },
            })
        );
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.document).not.toHaveProperty('evil');
        expect(parsed.document.categories[0]).not.toHaveProperty('somethingElse');
        expect(parsed.document.categories[0]!.placements[0]).not.toHaveProperty('extra');
        expect(parsed.document.tools['t']).not.toHaveProperty('onClick');
        expect(parsed.document.tools['t']).not.toHaveProperty('library');

        const plan = planTemplateImport({ tools: {}, categories: [] }, parsed.document, {
            newId: idFactory(),
        });
        const imported = Object.values(plan.state.tools)[0]!;
        expect(imported).not.toHaveProperty('library');
        expect(imported).not.toHaveProperty('onClick');
    });

    it('imports a script action as configuration, never as something to run', () => {
        const parsed = parseTemplateDocument(
            JSON.stringify({
                format: OCAP_TEMPLATE_FORMAT,
                formatVersion: 1,
                categories: [{ id: 'c', name: 'C', placements: [{ toolId: 't' }] }],
                tools: {
                    t: {
                        id: 't',
                        name: 'T',
                        actions: [{ type: 'script', parameters: { scriptName: 'evil.js' } }],
                    },
                },
            })
        );
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        const plan = planTemplateImport({ tools: {}, categories: [] }, parsed.document, {
            newId: idFactory(),
        });
        // The one and only effect is a stored action configuration.
        expect(Object.values(plan.state.tools)[0]!.actions).toEqual([
            { type: 'script', parameters: { scriptName: 'evil.js' } },
        ]);
    });

    it('bounds the work a document can ask for', () => {
        const deep = (depth: number): unknown => {
            let node: unknown = { rule: 'extension', value: 'md' };
            for (let i = 0; i < depth; i += 1) node = { not: node };
            return node;
        };
        const parsed = parseTemplateDocument(
            JSON.stringify({
                format: OCAP_TEMPLATE_FORMAT,
                formatVersion: 1,
                categories: [{ id: 'c', name: 'C', placements: [], conditions: deep(200) }],
                tools: {},
            })
        );
        expect(parsed.ok).toBe(false);
    });
});

// --- Serialization ----------------------------------------------------------------------

describe('serialization', () => {
    it('writes readable JSON that parses back into the same document', () => {
        const source: StoredCategory = storedGrid([p('a', 0)], { id: 'cat', name: 'Research' });
        const document = buildTemplateDocument(
            stateOf(registryOf(tool('a')), source),
            ['cat']
        );
        const text = serializeTemplateDocument(document);
        expect(text.startsWith('{\n')).toBe(true);
        expect(text.endsWith('\n')).toBe(true);
        const parsed = parseTemplateDocument(text);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.document.categories).toEqual(document.categories);
    });
});
