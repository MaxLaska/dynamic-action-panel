# Rebranding: Dynamic Action Panel

Durable record of the project's identity and of which legacy names are kept on
purpose. Written 2026-09-18.

## Names

| | |
|---|---|
| Public product name | **Dynamic Action Panel** |
| Former name | Obsidian Contextual Action Panel (OCAP) |
| Origin | independent fork of **Buttons Panel** by Kevin ([TracingOrigins](https://github.com/TracingOrigins)) |

There is deliberately **no acronym**. Write `Dynamic Action Panel` in full;
`DAP` is not a project term and must not be introduced into code or docs.

Internal code uses **domain language**, not the product name: Panel, Grid,
Tool, ToolDefinition, ToolPlacement, Category, Variant, Cell, Template,
Selection. A product name in an internal identifier is a smell unless the
identifier genuinely is about the product as a whole.

## What changed

- Public branding: `manifest.json` name and description, `package.json` name,
  description, author and repository URL, the panel's view title, the command
  and ribbon labels, the template error messages in all three locales, and the
  README.
- `manifest.json` `author` / `authorUrl` now name the maintainer of this fork.
  `fundingUrl` was **removed** rather than retargeted: it pointed at the
  upstream author's donation page, which would have misdirected funding for a
  differently-named product. Attribution to the original author lives in the
  README and in `LICENSE`.
- Internal identifiers lost the old acronym without gaining a new one:
  `OCAPContextSnapshot` → `WorkspaceContextSnapshot`, `EMPTY_OCAP_CONTEXT` →
  `EMPTY_WORKSPACE_CONTEXT`, `OCAPContextService` → `WorkspaceContextService`,
  `useOCAPContext` → `useWorkspaceContext`, `OCAPVisibility*` →
  `PanelVisibility*`, `__OCAP_DND_DEBUG` → `__PANEL_DND_DEBUG`. Console
  prefixes are now `[Dynamic Action Panel]`.
- `README.zh.md`, `README.ru.md` and `docs/contributing/contributing.zh.md`
  were removed: they were translations of the **upstream** README, never
  updated for this fork, and carried no information the English docs lack.
  The plugin's own i18n locales (`src/locales/{en,zh,ru}.json`) are unaffected
  and stay fully translated.

## Kept on purpose

Each of these is a contract, not a name. Changing one buys nothing and costs a
migration or a broken installation.

| Identifier | Why it stays |
|---|---|
| Plugin id `buttons-panel` | The install path `.obsidian/plugins/buttons-panel/`, the user's `data.json` and any registry entry hang off it. Renaming it orphans every existing installation and its settings. The **visible** name is independent of it, and that is what was rebranded. |
| View type `buttons-panel-view` | Persisted by Obsidian in the workspace layout; a change silently drops the panel from saved layouts. |
| Command ids `buttons-panel:*` | User hotkeys are stored against these ids. |
| CSS classes `buttons-panel-*`, `ocap-*` and custom properties `--ocap-*` | A DOM contract that user CSS snippets and themes may target. Renaming would churn the whole stylesheet and every component for zero user benefit. |
| DOM events `buttons-panel-refresh`, `buttons-panel-search` | Internal, but same cost/benefit as the classes. |
| Colour values `ocap:<name>` and `GRID_CELL_COLOR_NAME_PATTERN` | **Persisted values** inside `cellStyles`, already present in saved vaults and in exported templates. Renaming needs a data migration and breaks every template in the wild. |
| Format id `ocap-template`, extension `.ocap.json`, constants `OCAP_TEMPLATE_*` | The format id is an external, versioned contract carried by every exported file. Rebranding it would mean format v2 plus a migration path, purely for cosmetics. The constant names are kept **because** they mirror the literal — a constant named `TEMPLATE_FORMAT` holding `"ocap-template"` would hide the link. Treat `ocap-template` as a historical stable identifier. |
| TypeScript identifiers `ButtonsPanel*` (`ButtonsPanelPlugin`, `ButtonsPanelView`, `ButtonsPanelApp`, `ButtonsPanelLayout`, `ButtonsPanelSettingTab`, `ButtonsPanelPluginSettings`) | They mirror the plugin id, view type and CSS prefix above. Renaming the symbols while the strings they describe stay would *increase* the mismatch, not reduce it. They move only if the plugin id ever moves. |
| `docs/ocap/` and the dated audits inside it | A rename would churn several hundred cross-references for cosmetics, and historical audits must keep saying what was true on their date. Read `OCAP` in an audit as the project's former name. |
| `LICENSE` | MIT, `Copyright (c) 2025 Kevin`. MIT requires the notice to be retained; it was not touched. |

## Repository identity

The GitHub repository is still `MaxLaska/obsidian-contextual-action-panel`. It
was **not** renamed as part of this pass, and no remote URL was repointed at a
slug that does not exist yet.

Recommended, to be done manually in the GitHub UI:

- **Slug:** `dynamic-action-panel`
- **About:** Context-aware action panel for the Obsidian sidebar: grids of tools that change with the file you are working in.
- **Topics:** `obsidian`, `obsidian-plugin`, `productivity`, `context-aware`, `action-panel`, `workflow`

GitHub redirects the old slug after a rename, so the links in this repository
keep working. Once renamed, update in one pass: `package.json`
`repository.url`, the git remote, the contributing guide, the issue-template
config and the attribution links in the README.
