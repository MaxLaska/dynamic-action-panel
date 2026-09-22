// Tests for the Nexus theme: the token table, the stylesheet that declares it,
// and the seam where the host styling stopped being a plugin's business.
//
// Most of this file is about a property no screenshot can show: that there is
// exactly ONE place a host surface is named. The colours themselves are a
// judgement the user makes by looking; whether a colour can be defined twice is
// not, and that is the part worth pinning.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
    NEXUS_GROUPS,
    NEXUS_GROUP_LABELS,
    NEXUS_THEME_NAME,
    NEXUS_TOKENS,
    NEXUS_VARIABLES,
    nexusToken,
    nexusTokensOfGroup,
} from '../theme/nexus/src/tokens';

const themeCss = readFileSync('theme/nexus/theme.css', 'utf8');
const themeManifest = JSON.parse(readFileSync('theme/nexus/manifest.json', 'utf8')) as Record<
    string,
    unknown
>;

/** The declaration block between the two markers: the generated-by-hand part. */
const TOKEN_BLOCK_START = '/* >>> NEXUS TOKENS v0.1 >>> */';
const TOKEN_BLOCK_END = '/* <<< NEXUS TOKENS v0.1 <<< */';

function tokenBlock(): string {
    const start = themeCss.indexOf(TOKEN_BLOCK_START);
    const end = themeCss.indexOf(TOKEN_BLOCK_END);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return themeCss.slice(start + TOKEN_BLOCK_START.length, end);
}

/** The stylesheet with its comments removed. */
const rulesOnly = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every selector the sheet declares, one per entry. */
function selectorsOf(css: string): string[] {
    return rulesOnly(css)
        .split('}')
        .map((block) => block.slice(0, block.indexOf('{')))
        .filter((head) => head.trim())
        .flatMap((head) => head.split(','))
        .map((selector) => selector.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
}

describe('the token table is a table', () => {
    it('has at least the v0.1 surfaces', () => {
        expect(NEXUS_TOKENS.length).toBeGreaterThanOrEqual(11);
    });

    // A duplicate key silently makes one of two profiles' overrides
    // unreachable; a duplicate variable makes two controls fight over one
    // surface. Both are invisible until somebody wonders why a slider does
    // nothing.
    it('gives every token a unique key', () => {
        const keys = NEXUS_TOKENS.map((token) => token.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('gives every token a unique custom property', () => {
        expect(new Set(NEXUS_VARIABLES).size).toBe(NEXUS_VARIABLES.length);
    });

    it('prefixes every custom property, so a token is recognisable on sight', () => {
        for (const token of NEXUS_TOKENS) {
            expect(token.cssVariable.startsWith('--nexus-')).toBe(true);
        }
    });

    it('gives every token a default, a label, a group and a description', () => {
        for (const token of NEXUS_TOKENS) {
            expect(token.defaultValue.trim().length).toBeGreaterThan(0);
            expect(token.label.trim().length).toBeGreaterThan(0);
            expect(token.description.trim().length).toBeGreaterThan(0);
            expect(NEXUS_GROUPS).toContain(token.group);
        }
    });

    it('labels every group it uses', () => {
        for (const group of NEXUS_GROUPS) {
            expect(NEXUS_GROUP_LABELS[group].trim().length).toBeGreaterThan(0);
        }
    });

    it('puts every token in exactly one group', () => {
        const grouped = NEXUS_GROUPS.flatMap((group) => nexusTokensOfGroup(group));
        expect(grouped.length).toBe(NEXUS_TOKENS.length);
        expect(new Set(grouped.map((token) => token.key)).size).toBe(NEXUS_TOKENS.length);
    });

    it('looks a token up by key, and answers null for one it does not have', () => {
        expect(nexusToken('workspaceSurface')?.cssVariable).toBe('--nexus-workspace-surface');
        expect(nexusToken('nothingLikeThis')).toBeNull();
    });

    // The panel's semantic colours mean "this tool is a red one". These mean
    // "this is a surface". Folding them together would turn every palette
    // change into a semantics change.
    it('keeps the panel\'s semantic cell colours out of the palette', () => {
        const text = JSON.stringify(NEXUS_TOKENS).toLowerCase();
        for (const word of ['ocap:', 'cell', 'selection']) {
            expect(text).not.toContain(word);
        }
    });
});

describe('the theme declares exactly the token table', () => {
    const block = tokenBlock();

    it('declares every token with the table\'s own value', () => {
        for (const token of NEXUS_TOKENS) {
            expect(block).toContain(`${token.cssVariable}: ${token.defaultValue};`);
        }
    });

    // The other direction, which is the one that catches a token removed from
    // the table but left in the CSS — a variable nothing can reach and nothing
    // will ever set.
    it('declares no Nexus variable the table does not have', () => {
        const declared = [...themeCss.matchAll(/(--nexus-[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
        expect(declared.length).toBeGreaterThan(0);
        for (const variable of declared) expect(NEXUS_VARIABLES).toContain(variable);
    });

    it('spends no Nexus variable the table does not have', () => {
        const used = [...themeCss.matchAll(/var\((--nexus-[a-z0-9-]+)/g)].map((m) => m[1]);
        expect(used.length).toBeGreaterThan(0);
        for (const variable of used) expect(NEXUS_VARIABLES).toContain(variable);
    });

    // Every literal colour belongs to the token block. A hex buried in a rule
    // is a value with no control on it and no name to search for.
    it('puts every literal colour in the token block and nowhere else', () => {
        const outside = rulesOnly(themeCss).replace(block, '');
        expect(outside).not.toMatch(/#[0-9a-f]{3,8}\b/i);
        expect(outside).not.toMatch(/\brgba?\(/);
        expect(outside).not.toMatch(/\bhsla?\(/);
    });
});

describe('the theme is a theme Obsidian can load', () => {
    it('is named the name the deploy is pinned to', () => {
        expect(themeManifest.name).toBe(NEXUS_THEME_NAME);
    });

    it('carries the fields a theme manifest needs', () => {
        for (const field of ['name', 'version', 'minAppVersion', 'author']) {
            expect(typeof themeManifest[field]).toBe('string');
            expect((themeManifest[field] as string).length).toBeGreaterThan(0);
        }
    });

    // A theme folder is named by the theme, so the name IS the destination.
    it('installs under its own name, into the themes folder', () => {
        const deploy = readFileSync('scripts/deployThemeSmoke.mjs', 'utf8');
        expect(deploy).toContain('themeDirFor');
        expect(deploy).toContain('THEME_NAME');
        const core = readFileSync('scripts/deployCore.mjs', 'utf8');
        expect(core).toContain(`export const THEME_NAME = '${NEXUS_THEME_NAME}'`);
        expect(core).toMatch(/THEME_FILES = \[[^\]]*'theme\.css'/);
        expect(core).toMatch(/'\.obsidian', 'themes', themeName/);
    });

    // The smoke vault is the only place an experimental theme may be written.
    it('cannot resolve a target other than smoke', () => {
        const deploy = readFileSync('scripts/deployThemeSmoke.mjs', 'utf8');
        expect(deploy).toContain("const TARGET_NAME = 'smoke'");
        expect(deploy).toContain('target.productive');
        expect(deploy).not.toContain("'prod'");
    });
});

describe('the theme paints the workspace', () => {
    it('names Obsidian\'s own side-dock class rather than a plugin', () => {
        expect(themeCss).toContain('.workspace-split.mod-sidedock');
        // A rule naming the panel would break the moment Backlinks or
        // Properties was open instead, and would be a different colour for the
        // same surface.
        //
        // Asserted against the RULES, not the raw text: the comments name the
        // very views the rules must not single out, which is the sentence that
        // documents the care.
        expect(rulesOnly(themeCss)).not.toMatch(
            /ocap-|dynamic-action-panel|buttons-panel|backlink/i
        );
    });

    it('paints the split, the leaf and the ribbon as one plane', () => {
        const rules = rulesOnly(themeCss);
        for (const selector of [
            '.workspace-split.mod-sidedock',
            '.workspace-split.mod-sidedock .workspace-leaf',
            '.workspace-ribbon.mod-left',
        ]) {
            expect(rules).toContain(selector);
        }
        expect(rules).toContain('var(--nexus-workspace-surface)');
    });

    // Obsidian paints the vault profile from a four-class selector of its own.
    // A rule with less weight loses silently and leaves a lighter strip.
    it('outweighs Obsidian\'s own vault-profile rule', () => {
        const vaultProfile = selectorsOf(themeCss).find((selector) =>
            selector.includes('workspace-sidedock-vault-profile')
        );
        expect(vaultProfile).toBeDefined();
        const classes = (vaultProfile?.match(/\.[a-z-]+|:not\(/g) ?? []).length;
        expect(classes).toBeGreaterThanOrEqual(5);
    });

    it('re-points Obsidian\'s own variables at Nexus tokens', () => {
        const rules = rulesOnly(themeCss);
        expect(rules).toContain('--background-primary: var(--nexus-document-surface)');
        expect(rules).toContain('--text-normal: var(--nexus-text-primary)');
        expect(rules).toContain('--text-muted: var(--nexus-text-muted)');
        expect(rules).toContain('--divider-color: var(--nexus-workspace-border)');
    });

    // The token is declared because the theme owns the value; the surface it
    // names is inside an iframe a stylesheet cannot enter, so the theme itself
    // never spends it. That asymmetry is deliberate and worth pinning.
    it('declares the reader panel surface without spending it', () => {
        expect(themeCss).toContain('--nexus-reader-panel-surface:');
        expect(rulesOnly(themeCss)).not.toContain('var(--nexus-reader-panel-surface)');
    });

    // Deriving a light theme's surfaces is a different piece of work with
    // different judgements, and one that has not been made.
    it('confines itself to the dark theme it was judged in', () => {
        const selectors = selectorsOf(themeCss);
        expect(selectors.length).toBeGreaterThan(0);
        for (const selector of selectors) expect(selector).toContain('theme-dark');
    });
});

describe('every movable edge speaks one language', () => {
    const rules = rulesOnly(themeCss);

    it('uses the three splitter tokens and no other colour', () => {
        for (const token of [
            '--nexus-splitter-idle',
            '--nexus-splitter-hover',
            '--nexus-splitter-active',
        ]) {
            expect(rules).toContain(`var(${token})`);
        }
    });

    // Accent colours carry meaning in this project — cell colours, selection.
    // An edge is not a meaning, and Obsidian's own accent-filled hover on these
    // handles is exactly what the neutral hairline replaces.
    it('borrows no accent colour', () => {
        expect(rules).not.toContain('--interactive-accent');
        expect(rules).not.toContain('--color-accent');
    });

    it('resets the accent fill Obsidian puts on a hovered or dragged handle', () => {
        const reset = rules.slice(rules.lastIndexOf('.workspace-leaf-resize-handle:hover,'));
        expect(reset).toContain('background-color: transparent');
        expect(reset).toContain('border-color');
    });

    // The point of the rewrite: a horizontal split — the panel above, a note
    // below, inside one dock — is the edge that had no visible line at all.
    it('covers the side dock, vertical splits AND horizontal splits', () => {
        expect(rules).toContain('.workspace-split.mod-sidedock > .workspace-leaf-resize-handle');
        expect(rules).toContain('.workspace-split.mod-vertical > * > .workspace-leaf-resize-handle');
        expect(rules).toContain(
            '.workspace-split.mod-horizontal > * > .workspace-leaf-resize-handle'
        );
    });

    // One meaning, written once. The axis decides the geometry and nothing
    // else; if the colour rules were axis-scoped there would be two languages
    // wearing the same tokens.
    it('states the three colours once, for every axis at the same time', () => {
        for (const [selector, token] of [
            ['.workspace-leaf-resize-handle::after', '--nexus-splitter-idle'],
            ['.workspace-leaf-resize-handle:hover::after', '--nexus-splitter-hover'],
            ['.workspace-leaf-resize-handle.is-active::after', '--nexus-splitter-active'],
        ] as const) {
            const shared = selectorsOf(themeCss).filter(
                (candidate) => candidate === `body.theme-dark ${selector}`
            );
            expect(shared).toHaveLength(1);
            const block = rules.slice(rules.indexOf(`body.theme-dark ${selector}`));
            expect(block.slice(0, block.indexOf('}'))).toContain(`var(${token})`);
        }
    });

    // The grab zone is Obsidian's, and every Obsidian user already has the
    // muscle memory for it. The line makes the edge visible; it does not move
    // it.
    it('leaves the hit zone exactly where Obsidian put it', () => {
        for (const block of rules.split('}')) {
            if (!block.includes('.workspace-leaf-resize-handle')) continue;
            if (block.includes('::after')) continue;
            expect(block).not.toMatch(/(^|[^-])width:/);
            expect(block).not.toMatch(/(^|[^-])height:/);
        }
    });
});

describe('the host styling left the reader companion', () => {
    const companionCss = readFileSync(
        'companion/zotflow-reader-extensions/styles.css',
        'utf8'
    );

    // The rule this whole migration exists for: a colour that two files may
    // define is a colour that will eventually be defined twice, differently.
    it('leaves no competing host colour behind in the companion', () => {
        expect(selectorsOf(companionCss)).toHaveLength(0);
        expect(rulesOnly(companionCss).trim()).toBe('');
    });

    it('stops shipping the old workspace variables', () => {
        for (const variable of [
            '--zfrx-workspace-surface',
            '--zfrx-edge-idle',
            '--zfrx-edge-hover',
            '--zfrx-edge-active',
        ]) {
            expect(rulesOnly(companionCss)).not.toContain(variable);
        }
    });

    // It stays as an EMPTY file rather than being deleted: a deployment installs
    // files and never removes them, so dropping it from the build would leave
    // the old copy installed and still applying its rules.
    it('still ships, so an installed copy is overwritten rather than orphaned', () => {
        const deploy = readFileSync(
            'companion/zotflow-reader-extensions/scripts/deploySmoke.mjs',
            'utf8'
        );
        expect(deploy).toMatch(/COMPANION_FILES = \[[^\]]*'styles\.css'/);
        const build = readFileSync(
            'companion/zotflow-reader-extensions/esbuild.config.mjs',
            'utf8'
        );
        expect(build).toMatch(/COPIED = \[[^\]]*'styles\.css'/);
    });
});
