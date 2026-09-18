# Dynamic Action Panel portable template format (`ocap-template`, v1)

> The format id `ocap-template` and the `.ocap.json` extension keep the
> project's former name (Obsidian Contextual Action Panel) on purpose: they are
> an external, versioned contract carried by every file already exported.
> See `docs/ocap/rebranding-dynamic-action-panel.md`.

A **template** is one or more fully configured categories — their tools,
placements, dynamic variants, triggers, grid sizes and (future) cell colors —
in a single portable file that can be moved into a different vault.

It is deliberately **not** a copy of the plugin's internal `data.json`.

## 1. Identity and versioning

| Field | Value |
| --- | --- |
| `format` | `"ocap-template"` |
| `formatVersion` | `1` (`OCAP_TEMPLATE_FORMAT_VERSION`) |
| File extension | `.ocap.json` (`OCAP_TEMPLATE_FILE_EXTENSION`) |

`formatVersion` is the version of the **portable** format and is independent of
`settingsVersion`. This is the whole point of having a format of its own: the
internal persistence shape may keep evolving (v5 → v6 → …) without making every
template file that was ever exported unreadable. A document from an **unknown,
newer** format version is refused with a clear message rather than imported
best-effort. Older versions would be lifted in `migrateTemplateDocument`
(`src/export/templateParse.ts`) — the one place template migrations belong.

## 2. Structure

```jsonc
{
  "format": "ocap-template",
  "formatVersion": 1,
  "meta": {                       // provenance only, never read for behavior
    "pluginVersion": "2.4.7",
    "exportedAt": "2026-09-17T21:03:02.933Z"
  },
  "categories": [
    {
      "id": "cat-…",              // PACKAGE-LOCAL reference, not an identity
      "name": "Research",
      "layout": "grid",           // absent = flow
      "conditions": { … },        // optional category visibility condition
      "rows": 3, "columns": 4,    // absent = the historical 4x4
      "cellStyles": { "r2c3": { "color": "ocap:red" } },
      "placements": [ { "toolId": "…", "slot": 0 } ],
      "variants": [               // present = DYNAMIC category
        {
          "id": "var-…",
          "name": "Source",
          "trigger": { "rule": "fileName", "op": "startsWith", "value": "SRC_" },
          "rows": 3, "columns": 4,
          "cellStyles": { … },
          "placements": [ { "toolId": "…", "slot": 0 } ]
        },
        { "id": "var-…", "name": "Default", "fallback": true, "placements": [] }
      ]
    }
  ],
  "tools": {
    "<document tool id>": {
      "id": "<same id>",
      "name": "Becker_Westerholt",
      "icon": "<svg …>",
      "actions": [ { "type": "file", "parameters": { "filePath": "other/x.pdf" } } ],
      "executionMode": "sequential",
      "stopOnError": true,
      "delayBetweenActions": 100,
      "customCss": "…",
      "conditions": { … }         // flow-only per-tool condition
    }
  }
}
```

`categories` is an **array from v1 on**, so a multi-category set (and later a
whole panel) needs no format change. The first UI exports one category; the
importer already handles several correctly.

Two things are deliberately **absent**:

- **`order`** — position inside the exported set is the array order, and the
  position in the importing vault is the importer's business (appended);
- **`library`** — library membership is a vault-local lifecycle decision. An
  imported tool arrives as an ordinary ad-hoc tool owned by its placements.

## 3. Where the code lives

| Concern | File |
| --- | --- |
| Constants + document types | `src/export/templateFormat.ts` |
| Exporter (read-only) | `src/export/templateExport.ts` |
| Parser / validator (trust boundary, migration hook) | `src/export/templateParse.ts` |
| Importer (pure planner, id remapping) | `src/export/templateImport.ts` |
| Obsidian I/O + the single commit | `src/export/templateIo.ts` |

## 4. Export

- Ships exactly the categories asked for and **only the tool definitions those
  categories reference** — exporting one category never ships the whole vault
  registry.
- **Strictly read-only.** No id is minted, no order normalized and persisted,
  no GC, no migration written, no `library` flag set, no `ToolDefinition`
  touched. The document is built field by field into fresh objects, so it can
  neither alias nor mutate anything that is stored.
- Written into the **vault root** as `<Category>.ocap.json` (`Research 1.ocap.json`
  if the name is taken). The vault is a plain folder, so the file is visible in
  the file explorer and immediately ready to be copied to another vault.

## 5. Import

```
read file → parse JSON → check format id → check formatVersion → validate
structure → check internal references → remap ids → plan the next ToolState
→ ONE commitToolState
```

- **Ids in a document are references, not identities.** Every category,
  variant and tool gets a fresh id (`freshId`) and every reference is
  rewritten. Consequences: an import can never overwrite an existing object
  because an id happens to match, and the same file can be imported twice
  without any collision.
- **Import creates; it never merges.** There is no reconciliation with existing
  data and no deduplication by name, action, icon, path or hash. An imported
  tool that looks identical to one already in the vault stays a separate
  definition — matching would create invisible coupling. (Deliberate sharing
  is a later, explicit feature.)
- A tool the document shares between two placements **stays shared** after the
  import, because that is the panel that was exported.
- **Atomic.** Everything before the commit is pure planning against a copy. A
  malformed, foreign or too-new file therefore leaves the state byte-identical:
  no half category, no half tool, no registry corpse.
- **Name collisions** get a readable suffix instead of a merge dialog:
  `Research` → `Research (imported)` → `Research (imported 2)`. A free name is
  left alone. (Duplicate names are technically harmless — ids are the identity,
  and "Copy category" already produces two equal names — so this is purely so
  the user can tell the two apart.)
- Imported categories are **appended** at the end of the panel order.

## 6. External references stay untouched

File paths, script names, command ids and URLs travel **byte for byte**. A
template may reference `Literatur/Bieker_Westerholt.pdf` in a vault that does
not have that file, and importing it still succeeds: the existing lazy runtime
failure (`File not found: …` on click) is the right place for that. There is no
path rewriting, no fuzzy matching and no substitute file.

The import summary reports what is missing without judging it:

> Imported 1 category with 8 tools. 3 referenced files were not found in this vault.

## 7. Importing never executes anything

A template is data. The parser validates actions and condition trees against
the known unions as **plain values** — it never constructs an action object,
resolves a path or runs a script. A `script` action arrives as a stored action
configuration and nothing more.

Other rules at the trust boundary (`templateParse.ts`):

- parse, then **rebuild**: no parsed object is spread into the result and no
  unknown property is adopted, so a document cannot smuggle keys into settings;
- keys that come from the document (tool ids) are checked against
  `__proto__` / `constructor` / `prototype` before being used as object keys,
  and the tool record is built with a null prototype;
- size and depth limits (categories, variants, placements, tools, actions,
  cell styles, condition depth and string lengths) bound the work a file can
  ask for;
- a **dangling internal tool reference** is refused — silently dropping it
  would import a grid with holes the user never designed;
- a second `fallback` variant is refused, because the domain operations refuse
  it too.

## 8. Grid cell styles (prepared, no UI yet)

The colour of a cell belongs to the **cell**, not to whatever tool happens to
sit on it — an empty cell has to be able to carry one. It is therefore stored
on the grid, keyed by the **logical cell**:

```ts
type GridCellKey = string;                       // `r<row>c<column>`, e.g. "r2c3"
interface GridCellStyle { color?: string }
type GridCellStyles = Record<GridCellKey, GridCellStyle>;
```

`cellStyles` sits on the object that owns the grid — the category for a static
grid, the **variant** for a dynamic one — exactly like `rows`/`columns`.

**Why row/column and not the flat slot index:** a slot index only names a cell
relative to the current column count. Row 1 / column 2 is slot 5 in a 3-column
grid and slot 6 in a 4-column one, so a flat key would silently move a colour
to a different cell on every resize. With a coordinate key, **growing needs no
remap at all** and **shrinking drops exactly the keys of the cut strip** — the
same outer strip the tools are cut from.

**Portable colour values.** `color` is either a hex literal (`#rgb`, `#rgba`,
`#rrggbb`, `#rrggbbaa`) or a namespaced palette entry (`ocap:<name>`, e.g.
`ocap:accent`). CSS class names and `var(--…)` references are refused: they
only exist inside the current UI build, so a template carrying one would arrive
somewhere it means nothing. The two forms are distinguished by their own
prefixes, so a real palette can be added later without another structural
migration.

Semantics already in place:

- copy category / duplicate variant take an **independent** copy;
- `Make dynamic…` moves the grid's cell styles **onto the first variant** —
  they are part of that grid state;
- a resize remaps them coordinate-stably;
- `grid → flow` drops them with the grid;
- export and import carry them, per variant, and drop styles of cells the
  imported grid does not have.

**No colour UI exists yet** — no picker, no selection rectangle, no pipette, no
paint mode, no visible tinting. Only the data model, the persistence, the copy
semantics and the template support are prepared.

**No `settingsVersion` bump is needed** for `cellStyles`: it is an optional,
purely additive field whose absence means "no cell is styled", exactly like
`rows`/`columns`. Nothing stored has to be transformed, and settings written by
this build stay loadable by earlier ones.

## 9. UI entry points

| Where | Entry |
| --- | --- |
| Category context menu | `Export template…`, `Import template…` |
| Right-click on the `+` "Add category" button | `Add category`, `Import template…` |
| Command palette | `Import template…` (`dynamic-action-panel:import-template`) |

Import uses a transient `<input type="file">` — the OS file picker — which can
reach a file anywhere, including another vault, and is a plain DOM API rather
than a hand-built browser or an Electron internal. It needs a real user
gesture, which every entry point above provides.
