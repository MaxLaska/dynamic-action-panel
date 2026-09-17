// export/templateFormat.ts
// THE definition of the portable panel/category template format.
//
// Why a format of its own instead of exporting `data.json`:
// - `data.json` is the INTERNAL persistence shape. It carries vault-local
//   identities (tool/category/variant ids), lifecycle metadata (`library`),
//   global ordering (`order`) and whatever internal fields a future refactor
//   adds. None of that travels;
// - a template must stay readable across internal refactors. It therefore
//   carries its OWN version (`formatVersion`) — `settingsVersion` describes
//   the internal schema and must never be reused here, or every settings
//   migration would invalidate every exported template.
//
// Contract of the format:
// - ids inside a document are PACKAGE-LOCAL REFERENCES, not identities. The
//   importer mints fresh ids for everything and rewrites the references
//   (see templateImport.ts), so importing the same file twice yields two
//   independent sets and an import can never overwrite existing objects;
// - external targets (file paths, script names, command ids) are transported
//   VERBATIM. A template may legitimately reference a file that does not
//   exist in the importing vault; the existing lazy runtime failure
//   (`File not found: …`) is the right place for that, not the import;
// - a template is DATA. Importing one never executes any action it contains.

import type { ButtonAction } from '@/types/action';
import type { ButtonCondition } from '@/types/conditions';
import type { GridCellStyles } from '@/types/settings';

/** Format identifier every template document carries. */
export const OCAP_TEMPLATE_FORMAT = 'ocap-template';

/**
 * Version of the PORTABLE format — deliberately independent of
 * CURRENT_SETTINGS_VERSION. Bump it only when the document shape changes in a
 * way an older reader cannot handle, and add a migration step in
 * templateParse.ts at the same time.
 */
export const OCAP_TEMPLATE_FORMAT_VERSION = 1;

/** Suggested file extension of an exported template. */
export const OCAP_TEMPLATE_FILE_EXTENSION = '.ocap.json';

/** One placed tool inside a template grid/flow list. */
export interface TemplatePlacement {
    /** Reference into the document's own `tools` map — NOT a tool id of this vault. */
    toolId: string;
    /** Row-major slot inside the owning grid; absent on flow placements. */
    slot?: number;
}

/**
 * A tool definition as it travels. Deliberately WITHOUT `library`: library
 * membership is a vault-local lifecycle decision, and an imported tool starts
 * as an ordinary ad-hoc tool owned by its imported placements.
 */
export interface TemplateTool {
    id: string;
    name: string;
    icon?: string;
    actions: ButtonAction[];
    executionMode?: 'sequential' | 'parallel';
    stopOnError?: boolean;
    delayBetweenActions?: number;
    customCss?: string;
    conditions?: ButtonCondition;
}

/** One variant of a dynamic category — a complete, independent grid state. */
export interface TemplateVariant {
    id: string;
    name: string;
    trigger?: ButtonCondition;
    fallback?: boolean;
    rows?: number;
    columns?: number;
    cellStyles?: GridCellStyles;
    placements: TemplatePlacement[];
}

/**
 * One category. `order` is deliberately absent: the position inside the
 * exported set IS the array order, and the position inside the importing
 * vault is decided by the importer (appended at the end).
 */
export interface TemplateCategory {
    id: string;
    name: string;
    layout?: 'flow' | 'grid';
    conditions?: ButtonCondition;
    rows?: number;
    columns?: number;
    cellStyles?: GridCellStyles;
    placements: TemplatePlacement[];
    variants?: TemplateVariant[];
}

/** Provenance only — never read back for behavior. */
export interface TemplateMeta {
    /** Plugin version that wrote the document. */
    pluginVersion?: string;
    /** ISO timestamp of the export. */
    exportedAt?: string;
}

/** A complete template document. */
export interface TemplateDocument {
    format: typeof OCAP_TEMPLATE_FORMAT;
    formatVersion: number;
    meta?: TemplateMeta;
    /** At least one; multiple categories are a valid set from v1 on. */
    categories: TemplateCategory[];
    /** Only the definitions the exported categories actually reference. */
    tools: Record<string, TemplateTool>;
}

/** Why a document could not be turned into a usable template. */
export type TemplateParseErrorKind =
    | 'invalid_json'
    | 'not_a_template'
    | 'unsupported_version'
    | 'invalid_structure'
    | 'dangling_tool_reference';

export interface TemplateParseError {
    kind: TemplateParseErrorKind;
    /** Machine-readable detail (a JSON-ish path or the offending value). */
    detail?: string;
}

export type TemplateParseResult =
    | { ok: true; document: TemplateDocument }
    | { ok: false; error: TemplateParseError };
