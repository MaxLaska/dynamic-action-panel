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
  `PanelVisibility*`, `__OCAP_DND_DEBUG` → `__DYNAMIC_ACTION_PANEL_DND_DEBUG`. Console
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
| ~~Plugin id `buttons-panel`~~ — **superseded, see below** | Kept during this pass because the install path, the user's `data.json` and any registry entry hang off it. It was migrated to `dynamic-action-panel` afterwards for a reason this pass did not weigh: the old id is the id of the *published* upstream plugin, so an upstream update could overwrite this fork's installation. See [Plugin identity migration](#plugin-identity-migration). |
| View type `buttons-panel-view` | Persisted by Obsidian in the workspace layout; a change silently drops the panel from saved layouts. Independent of the plugin id, so it survived the id migration unchanged. |
| ~~Command ids `buttons-panel:*`~~ — **now `dynamic-action-panel:*`** | Obsidian derives the namespace from the plugin id, so these moved with it. Only the sub-ids (`open-panel`, `open-options`, `import-template`, `run-script:*`) are ours, and those are unchanged. Hotkeys bound to the old full ids would have to be rebound; none were set. |
| CSS classes `buttons-panel-*`, `ocap-*` and custom properties `--ocap-*` | A DOM contract that user CSS snippets and themes may target. Renaming would churn the whole stylesheet and every component for zero user benefit. |
| DOM events `buttons-panel-refresh`, `buttons-panel-search` | Internal, but same cost/benefit as the classes. |
| Colour values `ocap:<name>` and `GRID_CELL_COLOR_NAME_PATTERN` | **Persisted values** inside `cellStyles`, already present in saved vaults and in exported templates. Renaming needs a data migration and breaks every template in the wild. |
| Format id `ocap-template`, extension `.ocap.json`, constants `OCAP_TEMPLATE_*` | The format id is an external, versioned contract carried by every exported file. Rebranding it would mean format v2 plus a migration path, purely for cosmetics. The constant names are kept **because** they mirror the literal — a constant named `TEMPLATE_FORMAT` holding `"ocap-template"` would hide the link. Treat `ocap-template` as a historical stable identifier. |
| TypeScript identifiers `ButtonsPanel*` (`ButtonsPanelPlugin`, `ButtonsPanelView`, `ButtonsPanelApp`, `ButtonsPanelLayout`, `ButtonsPanelSettingTab`, `ButtonsPanelPluginSettings`) | They mirror the view type `buttons-panel-view` and the CSS prefix `buttons-panel-*`, both of which stay. The plugin id has since moved away from them, so the mirror is no longer exact — but the strings they mostly describe are unchanged, and renaming them is a pure naming refactor with no contract behind it. Deliberately deferred. |
| `docs/ocap/` and the dated audits inside it | A rename would churn several hundred cross-references for cosmetics, and historical audits must keep saying what was true on their date. Read `OCAP` in an audit as the project's former name. |
| `LICENSE` | MIT, `Copyright (c) 2025 Kevin`. MIT requires the notice to be retained; it was not touched. |

## Repository identity

The repository is `MaxLaska/dynamic-action-panel`, renamed from
`MaxLaska/obsidian-contextual-action-panel`. About and topics were set in the
GitHub UI:

- **About:** Context-aware action panel for the Obsidian sidebar: grids of tools that change with the file you are working in.
- **Topics:** `obsidian`, `obsidian-plugin`, `productivity`, `context-aware`, `action-panel`, `workflow`

The follow-up inside the repository is done: `package.json` `repository.url`,
the local git remote, the contributing guide, the issue-template config,
`CLAUDE.md` and `STATUS.md` all point at the new slug. GitHub keeps redirecting
the old one, so older links stay usable.

The upstream attribution links in the README deliberately still point at
`TracingOrigins/obsidian-buttons-panel-plugin` — that is the original project,
not this repository.

## Plugin identity migration

Done after the rebranding pass above, and for a different reason than a name.

**`manifest.id` is now `dynamic-action-panel`.** The old id `buttons-panel` is
the id of the *published* upstream plugin in the community directory. Sharing
it meant an upstream install or update could land on top of this fork's
installation and its `data.json`. The fork is private/local-only, so nothing
was gained by the collision; removing it is purely a safety measure.

What moved with the id:

- **The install folder.** Obsidian requires it to match, so the plugin now
  lives at `.obsidian/plugins/dynamic-action-panel/`. `scripts/deploy.mjs`
  already reads the id from `manifest.json`, so no deploy tooling changed.
- **`data.json`.** It is loaded from inside the plugin folder, so it just
  moves with it. The productive file was copied byte-identically — no
  migration, no `settingsVersion` bump, no reformatting.
- **Command ids.** Obsidian namespaces them by plugin id; `open-panel` is now
  `dynamic-action-panel:open-panel`. Our sub-ids are unchanged.
- **The settings tab id**, which `activateSettingsView` addresses through
  `this.manifest.id` — it reads the live value, so nothing was hardcoded.

What deliberately did **not** move:

- **The view type `buttons-panel-view`** is a plain string constant in
  `src/main.ts`, unrelated to the plugin id. Obsidian persists it in
  `workspace.json`, so keeping it is what lets an existing panel leaf come back
  under the new id. Everything else in the "Kept on purpose" table — CSS
  classes, DOM events, persisted colour values, the `ocap-template` format —
  is likewise independent of the id and untouched.
- **`community-plugins.json` and every other vault config file.** Activating
  the new id is a user action in *Settings → Community plugins*; writing that
  file from outside Obsidian is not.

Leftovers that are harmless and stay: a stale
`left-ribbon.hiddenItems["buttons-panel:Open Dynamic Action Panel"]` key in
`workspace.json` (value `false`, i.e. the default — the new id simply gets a
fresh entry), and the `buttons-panel` install folder in any vault that has not
been migrated.
