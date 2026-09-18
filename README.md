# Dynamic Action Panel

A context-aware action panel for the Obsidian sidebar.

Instead of one static button bar, Dynamic Action Panel gives you grids of tools
that can **change with the file you are working in**. A category can be a fixed
grid, or it can hold several complete variants and show whichever one matches
the current note — by file name, folder, path, extension, tag, frontmatter
property or view type.

> Dynamic Action Panel began as an independent fork of
> [Buttons Panel](https://github.com/TracingOrigins/obsidian-buttons-panel-plugin)
> and has since diverged substantially. See [Credits](#credits).

## Features

**Panel and categories**

- Three panel views: list, tabs and folder.
- Categories hold your tools, either as a **flow** list or as a **grid**.
- Two interaction modes: **Locked** for normal use, **Edit** for managing
  everything. One toggle in the navigation bar, which shows the current state.
- Search filters categories and tools as you type.

**Context-aware categories**

- A grid category is either **static** (one grid) or **dynamic** (several
  independent variants, each with its own grid, size and tools).
- Every variant has exactly one **trigger**, or is the single explicit
  **fallback**.
- At runtime the **first matching trigger wins**; without a match the fallback
  is used, and without a fallback the category stays hidden.
- Categories themselves can carry a visibility condition, built in a visual
  rule editor (with an advanced JSON view).

**The grid**

- Resizable from 1×1 up to 5×5, per grid — a dynamic category sizes each
  variant on its own.
- Positions are stable: a tool keeps its row and column, empty cells stay
  empty, and nothing reflows when you resize.
- Drag the whole right or bottom edge to add or remove columns and rows.
  Removing a strip that still holds tools asks first and names them.
- Drag-and-drop move and swap inside a grid and across categories.

**Creating tools where you point**

- Every empty cell in edit mode carries a `+` that creates a tool **in that
  cell** — the position is part of the gesture, not a form field.
- Drag a file from Obsidian's file explorer straight onto an empty cell:
  PDFs, notes and other vault files become an *Open file* tool, and a `.js`
  file inside your configured script folder becomes a *Run script* tool.
- A tool may exist before its action does; clicking one that has none says so.

**Actions**

- Open file · Run command · Open link · Create file · Run script.
- One tool can run several actions in sequence or in parallel, with an
  optional delay and a stop-on-error policy.
- Icons come from the built-in Lucide library or from your own SVG.

**Portable templates**

- Export a category — with all of its variants and every tool it references —
  to a single `.ocap.json` file, and import it into another vault.
- Import always mints fresh ids, so it can never overwrite anything and the
  same file can be imported twice without a collision.
- Dynamic variants, triggers, grid sizes and cell styles all travel with the
  template. Format details: [`docs/ocap/template-format.md`](docs/ocap/template-format.md).

## How it works

Under the hood a tool is stored once as a **ToolDefinition** in a registry, and
each place it appears is a **ToolPlacement**. That split is what lets the same
tool sit in several places, and what keeps a drag from ever duplicating or
losing a definition.

Open the panel from the ribbon icon or via the command palette
(*Open Dynamic Action Panel*). Switch to edit mode with the lock toggle in the
navigation bar to create, arrange and configure tools; switch back to locked
mode to use them.

## Development status

Actively developed, and not yet released to the Obsidian community plugin
directory. The current focus is stabilisation and test coverage.

Designed but **not yet implemented**: visible cell colours, multi-selection and
marquee, pipette and same-colour selection, create-note-from-selection,
export-selected, a tool library UI. Cell colours already exist in the data
model and in the template format, but there is no colour UI yet. The design for
selection and colours lives in
[`docs/ocap/audits/2026-09-18-selection-color-architecture.md`](docs/ocap/audits/2026-09-18-selection-color-architecture.md)
(German).

## Installation

Not in the community plugin directory yet, so install manually or via BRAT.

**Manual**

1. Build the plugin (see below) or take `main.js`, `manifest.json` and
   `styles.css` from a release.
2. Put them in `YourVault/.obsidian/plugins/dynamic-action-panel/`.
3. Enable the plugin in *Settings → Community plugins*.

> **Heads-up on the plugin id.** The id is `dynamic-action-panel`, and the
> folder must be named after it. Earlier builds of this fork shipped as
> `buttons-panel` — the *same* id the original Buttons Panel uses in the
> community directory, so an upstream update could overwrite this fork. If you
> are coming from such a build, copy your `data.json` from
> `.obsidian/plugins/buttons-panel/` into the new folder and remove the old
> one; nothing else has to be migrated. Background:
> [`docs/ocap/rebranding-dynamic-action-panel.md`](docs/ocap/rebranding-dynamic-action-panel.md).

**From source**

```bash
npm install
npm run build      # production build (also deploys to VAULT_PATH from .env)
npm run dev        # watch mode
npm test           # unit tests
npm run lint
```

Node 18 or newer. To deploy into a vault of your choice, put
`VAULT_PATH=/path/to/your/vault` into a `.env` file in the project root.
See [`docs/contributing/contributing.md`](docs/contributing/contributing.md).

## Settings

Open them from the gear in the navigation bar, or via
*Settings → Community plugins → Dynamic Action Panel*.

| Setting | Effect |
|---|---|
| Show top navigation bar | Show or hide the bar above the panel. |
| Enable button animation | Hover animation on buttons. |
| Show button name on hover | Full tool name as a tooltip. |
| Auto collapse in list view | Every category starts collapsed in list view. |
| Tabs auto wrap | Tabs wrap onto several rows instead of scrolling horizontally. |
| Folder name editable | Click the name of an expanded folder to rename it. |
| Show button count | Number of tools on each folder tile. |
| Close on blank click | Click empty space inside an expanded folder to close it. |
| Template folder | Where *Create file* looks for templates. |
| Script folder | Where *Run script* loads `.js` files from. |
| Create paths | Creates the two folders above if they do not exist yet. |

**Date variables.** A *Create file* action resolves `{{DATE:...}}` in the file
name using Moment formats, so `Journal/{{DATE:YYYY-MM-DD}}` creates today's
note.

**Folder view.** Categories appear as tiles. Click one to expand it, pin it to
keep it open, and drag a tool out of an expanded folder onto another tile —
hovering a tile briefly auto-expands it so you can drop into it.

**Touch.** Swipe to scroll the panel or the tab bar; long-press a tool or a
category to start dragging it. A quick swipe before the long press completes
counts as scrolling, not as a drag.

**Custom icons.** Paste SVG markup as a tool icon. Replace `fill="..."` with
`fill="currentColor"` so the icon follows the Obsidian theme, and prefer
24×24 outline icons to match the built-in Lucide set.

## Scripts

A *Run script* action executes a `.js` file from your configured script folder.
Scripts export through CommonJS; the entry function takes no parameters and
reads its context from `this.$context`:

```js
// scripts/hello.js
module.exports = {
    entry: main,
    name: { en: 'Say hello', zh: '打招呼', ru: 'Поздороваться' },
    description: { en: 'Send a greeting to the notice bar.' },
    tags: ['demo'],
};

async function main() {
    const { app, obsidian, notice } = this.$context;
    notice('Hello from script!');
}
```

`this.$context` provides `app`, `plugin`, the `obsidian` module namespace,
`requestUrl` (which avoids CORS) and `notice`. The entry must be a regular
function — an arrow function has no own `this`. `name` and `description` accept
either a plain string or an object keyed by language code (`en`, `zh`, `ru`),
and the script picker shows them in your current Obsidian language.

Script errors are caught and shown as a notice. **Do not run scripts from
untrusted sources.**

## Credits

Dynamic Action Panel originated as an independent fork of **Buttons Panel** by
Kevin ([TracingOrigins](https://github.com/TracingOrigins)) — original
repository:
[obsidian-buttons-panel-plugin](https://github.com/TracingOrigins/obsidian-buttons-panel-plugin).
The fork keeps that project's MIT licence and copyright notice; see
[LICENSE](LICENSE).

Icons come from [Lucide](https://github.com/lucide-icons/lucide), licensed
under the ISC License.

## License

MIT — see [LICENSE](LICENSE).
