# OCAP – Status

Last updated: 2026-09-23 (the pipette is a tool that stays on, swatches drag —
Recent to Saved copies, Saved reorders — and one Escape ends one thing; on
top of: Recent follows each finished colour action while the
picker stays open — interaction commit, session commit and Saved are three
levels; one format button and a pipette icon; on top of: the colour picker has
two memories — RECENT,
filled by commits, and SAVED, kept on purpose and exportable as a palette file;
on top of: colour is edited in ONE Nexus colour picker —
drafts until closed, Escape restores, a global palette, Pick from Obsidian by
mouse or keyboard, no native popup or red-grid pipette left; on top of the
Theme Studio as a CONTROL PLANE that stays
readable whatever it sets, with UI typography, a contrast assist that never
writes, and a Discovery area — Inspect UI and a window colour sampler; on top
of the Theme Studio as a WORKSPACE VIEW, opened by
one command and docked beside the surfaces it designs, with folding groups that
actually fold, a compact design row with the raw CSS behind a disclosure, and a
live check in a real Obsidian; on top of the first interaction pass after real
use, on top of the `Nexus` THEME that owns every host surface, the editor for
it, and the thin bridge that carries its tokens into the reader's iframe; on top
of the three distinguishable surfaces those rules used to live in as a companion
CSS patch, on top of a section shortcut landing exactly where the
reader's own outline lands, on top of outline sections as panel tools and the
reader sidebar side — those three in `zotflow-reader-extensions`, which is
not part of the panel; and on top of the
help button and context routing, and the EXPERIMENTAL corrected mouse
grammar: left click uses, Shift/Ctrl + left selects, right click is context,
right drag moves a tool — the same-day version with selection on the right
button is superseded; implemented locally and live-smoke-tested, awaiting the
user's judgement in use)

## Newest work first

- **Nexus Theme Studio: the pipette as a tool, swatch drag and drop
  (2026-09-23).** Implemented locally, deployed to the smoke vault only, checked
  live in an isolated Obsidian. Not pushed, not in the productive vault.
  Normative: the `DECISIONS.md` entries from "The pipette is a tool that stays
  on" onward.
  - **Kept as it was, and now regression-tested:**
    - Recent's move-to-front, with canonical RGBA dedupe and all colour paths
      through `pushRecent`; slot 4 clicked repeatedly rotates only the first
      four;
    - the single cycling format button;
    - the pipette icon.
  - **Pipette:**
    - a toggle (`aria-pressed`) that switches on a sampling mode;
    - every click samples, and the mode stays on;
    - the picker stays visible above the layer;
    - its own controls stay live;
    - the picker's swatches can be sampled too;
    - a throttled live loupe;
    - Alt held for a temporary sampler.

    One Escape ends one thing: a drag, then the sampler, then the session.
  - **Drag and drop:**
    - Recent → Saved copies, at the insert marker;
    - a duplicate is only outlined;
    - Saved → Saved moves, and the order persists and exports;
    - Recent is never reordered;
    - 5px threshold; the click after a drag is swallowed;
    - wrapped rows map to one linear insertion point.
  - **Swatch cursor:** a small black-and-white SVG pipette.
  - **Resolved:** the intermittent Delete failure of the last two rounds.
    - **In the smoke:** its dialog-close selector did not exist in Obsidian
      1.13.7, so the dialog stayed open and took the key.
    - **In the product, found while tracing it:** one Escape closed a dialog
      AND cancelled the picker, because Obsidian closes dialogs before the
      picker's handler runs. Such an Escape is now ignored. See `DECISIONS.md`.
  - **Verified:**
    - typecheck and lint are clean;
    - 2196 tests pass in 62 files;
    - 12 of 13 mutations caught; the one survivor is a deliberately
      redundant guard (the sampler already blocks drags);
    - `smokeView.mjs` passed 130/130 on four runs in a row, with real mouse
      drags;
    - measured: a 1px capture takes 13ms, and 40 moves produced 9 loupe
      captures.
  - **Not verified:** the OS-level effect of a real Alt key on Windows, because
    CDP keys do not reach the OS.

- **Nexus Theme Studio: Recent follows each colour action (2026-09-23).**
  Implemented locally, deployed to the smoke vault only, checked live in an
  isolated Obsidian. Not pushed, not in the productive vault. Normative:
  `DECISIONS.md` "Recent records finished colour actions, not picker sessions"
  and "One format button, and the pipette as an icon".
  - **Found in use:** Recent changed only when the picker closed.
  - **Now:** each finished interaction (square or bar released, a field
    confirmed, a swatch clicked, a pixel taken) goes to the front of Recent at
    once, with the picker open. Only the Recent row is redrawn, so focus stays
    put. Escape and Revert revert the token and keep Recent.
  - **Persistence:** interaction commits go through `updateUiLater`, which
    applies no theme and writes after a 1.5s debounce. The token keeps its own
    session and commit path.
  - **UI:** one cycling format button (HEX → RGB → HSL), and the pipette is an
    icon beside it.
  - **Verified:**
    - typecheck and lint are clean;
    - 2141 tests pass in 62 files;
    - 8 mutations were caught: recording on move, no recording on release,
      keyboard steps each recorded, a Recent click not a use, a Saved click not
      a use, a sample not a use, Recent on the token path, and cancel wiping
      Recent;
    - `smokeView.mjs` passed 109/109 on its last four runs, driving real mouse
      events on the square and the hue bar.
  - **Open, and the same class as before:** the smoke's clean-up Delete, run
    right after the import dialog closed, failed once before it got the same
    wait-for-the-dialog as the Delete check. That is consistent with focus
    returning late after a dialog closes, which is still not proven.

- **Nexus Theme Studio: Recent and Saved colours (2026-09-23).** Implemented
  locally, deployed to the smoke vault only, checked live in an isolated
  Obsidian. Not pushed, not in the productive vault. Normative: the
  `DECISIONS.md` entries from "The colour library has two memories" onward.
  - **Model:** `colorLibrary.ts` is pure (no DOM, no Obsidian):
    - canonical RGBA identity, with alpha counted;
    - Recent: 16 colours, newest left, a reused colour moved to the front;
    - Saved: explicit, at most 48;
    - the `nexus-color-palette` v1 file format, with merge import.

    The picker is a client of it through `PickerLibrary`.
  - **Recent:** recorded only when a picker session commits a changed colour,
    in the same write as the token. Drafts, cancel, unchanged commits, Custom
    CSS and cancelled picks are never recorded.
  - **Saved:** `+` never saves a duplicate (the existing swatch is outlined).
    `⋯` replaces or deletes the loaded colour, imports, exports, copies as CSS
    variables, and clears after asking.
  - **Transfer:** export is JSON with a name and Copy. Import takes pasted JSON
    or a chosen file, read-only. There is no save dialog; see `DECISIONS.md`.
  - **Persistence:** `recentColors` was added and the settings stay at v3.
    Existing `savedSwatches` are kept and canonicalised on read.
  - **Verified:**
    - typecheck and lint are clean;
    - 2126 tests pass in 62 files, including the new
      `tests/nexusColorLibrary.test.ts`;
    - mutations were caught: no dedupe, newest on the right, dedupe by spelling,
      import replacing, dialog clicks closing the picker, recent recorded on
      cancel, and an unchanged commit counted as use;
    - `smokeView.mjs` passed 101/101 on the last three runs, with a restart
      check.
  - **Open:** the smoke's Delete-key check failed in 2 of its first 5 runs,
    once even after waiting for the closing dialog. It has passed 15 runs in a
    row since keydown instrumentation was added. The cause is not proven;
    focus returning late after a dialog closes is plausible. The smoke now
    records where the key landed.

- **Nexus Theme Studio: one colour workflow (2026-09-23).** Implemented
  locally, deployed to the smoke vault only, checked live in an isolated
  Obsidian. Not pushed, not in the productive vault. Normative: the
  `DECISIONS.md` entries from "A colour is edited in one place" onward.
  - **Consolidated:** a colour row is a swatch, a readout and a reset. The
    swatch opens the Nexus colour picker (`colorPicker.ts`), which holds:
    - the square, the hue bar and opacity;
    - HEX, RGB and HSL (display only);
    - Pick from Obsidian;
    - a global palette;
    - the raw CSS value.

    Removed: the native `<input type="color">` (Chromium's popup and its
    red-grid pipette), the row pipette, the row opacity slider, the row raw CSS
    line, and the native EyeDropper fallback (`eyedropper.ts` deleted).
  - **Session semantics:** changes in the picker are runtime-only drafts
    (`withSession`). Done, Enter or a click outside commits one write. Escape or
    Revert restores the exact previous value, and nothing is written while the
    picker is open.
  - **Model:** one RGBA model in `colorValue.ts`, which now also parses `hsl()`.
    Custom CSS values stay authoritative and are converted only on request.
  - **Keyboard sampling:** arrows (Shift ×10), Enter or Space, and Escape, with
    a neutral reticle. This did not exist in code before; see `DECISIONS.md`.
  - **Persistence:** settings v3 adds `savedSwatches` and `pickerFormat`. A v2
    file reads unchanged, and damaged palettes are read fail-soft.
  - **Discovery:** Take colour is now Copy colour, a developer utility.
  - **Verified:**
    - typecheck and lint are clean;
    - 2074 tests pass in 61 files, including the new
      `tests/nexusColorPicker.test.ts` (68 tests) and a shared
      `tests/support/nexusStudioHarness.ts`;
    - mutations were caught: Escape committing, the sampling guard, drafts
      saved, a rebuild keeping the picker, Space not taken, and the locator
      guard;
    - `smokeView.mjs` passed 79/79 twice.

- **Nexus Theme Studio: control plane, typography, contrast, Discovery
  (2026-09-23).** Implemented locally, deployed to the smoke vault only, and
  checked live in an isolated Obsidian. Not pushed, and not in the productive
  vault. The normative text is in the `DECISIONS.md` entries from "The studio is
  a control plane" onward.
  - **Control plane:** the studio no longer paints itself with the tokens it
    edits. It uses an internal palette built from Obsidian's base scale, and its
    context menu is the OS-native menu. Checked live: with text set to the
    surface colour, the studio stays readable, and the locator never reaches it.
  - **Typography:** three new tokens: UI font family, UI font size and UI line
    height. They drive `--font-interface-theme`, the `--font-ui-*` scale and
    `--line-height-tight`. There is no weight token, because Obsidian has no UI
    weight hook. The registry gained `controlType`, `range` and `suggestions`.
  - **Contrast assist:** WCAG ratios for five real text/surface pairs, graded
    against 4.5:1 and 3:1. It never writes. **Auto contrast was not built**;
    the reasons and the prerequisite (per-surface text tokens) are in
    `DECISIONS.md`.
  - **Discovery:**
    - **Inspect UI** (button and command) starts DevTools' own element picker
      through `webContents.debugger`, then `inspectElement`. No shortcut is
      simulated.
    - **Take colour** copies the hex value of a pixel.
  - **Red eyedropper grid:** the cause was traced in source to Electron not
    registering Chromium's eye-dropper colour mixer (the last link is not
    verified). The pipette now samples the Obsidian window itself with
    `capturePage`, and the native sampler is only the fallback. Limit: it sees
    only its own window.
  - **Found live and fixed:** after one inspect, Chromium replays the old node
    on the next `Overlay.enable`, and the picker opened DevTools without a
    click. Picks now count only once the picker is armed.
  - **Verified:**
    - typecheck and lint are clean;
    - 2017 tests pass in 60 files;
    - the new behaviour is mutation-checked: the locator guard, the inspect
      detach and the armed guard;
    - `smokeView.mjs` passed 61/61 twice against Obsidian 1.13.7. The run used
      its own profile, started with `--disable-features=CalculateNativeWinOcclusion`,
      because a covered window receives no input.

- **Nexus Theme Studio as a workspace view (2026-09-23), implemented locally,
  deployed to the smoke vault only, checked live in an isolated Obsidian. Not
  pushed, not in the productive vault.** Normative: the `DECISIONS.md` entries
  from "Why the settings-tab fold never folded" onward.
  - **Why:** it had become a design tool, and a settings tab is a modal over the
    workspace being designed. Now an `ItemView` (`nexus-theme-studio`), opened by
    **Open Nexus Theme Studio**, single-instance through `ensureSideLeaf`, placed
    in the right dock, and moved, split or popped out with Obsidian's own UI. No
    settings tab, no ribbon button, no window logic.
  - **The fold never worked, and the reason is now measured:** Obsidian's
    declarative settings renderer applies a group's `cls` only when the group is
    created and reconciles it afterwards. The click was stored (three groups in
    the smoke `data.json`) and never shown. Settings version 2 drops that stored
    fold; profiles and overrides are read unchanged. An earlier claim that `cls`
    "throws on a space" was wrong and is corrected in `DECISIONS.md`.
  - **The row** is swatch, name, description, opacity where the registry says,
    a compact value readout, pipette, reset. The raw CSS is behind the readout;
    a complex value shows `CSS` and is never rewritten. Reset says "Reset to
    default". Narrow-first: below 300px of view width the actions go under the
    label.
  - **Found in live use and fixed:** the "Nexus is not selected" note stayed up
    after Nexus was selected; it now follows `css-change` in place.
  - **Verified:** typecheck, lint (0/0), 1926 tests in 58 files — including
    DOM tests under happy-dom, mutation-checked on the fold — and
    `companion/nexus-theme-studio/scripts/smokeView.mjs`, 39/39 against
    Obsidian 1.13.7 on its own profile and a throwaway vault seeded with the smoke
    vault's real v1 `data.json`.
  - **The pipette, honestly:** `window.EyeDropper` exists, opens from the studio
    window and cancels cleanly (checked live). Sampling a pixel from another pane
    needs a physical click, which automation does not provide — that is manual
    acceptance step I. Nothing technical stands between the sampler and another
    pane of the same window now that no modal covers it.

- **Nexus Theme Studio, interaction pass (2026-09-23), implemented locally,
  deployed to the smoke vault only. Not pushed, not in the productive vault.**
  Normative: the `DECISIONS.md` entries dated 2026-09-23.
  - **Everything here came from using the editor, not reading it.** Seven
    reports, one root cause behind two of them.
  - **The per-token reset did nothing.** The arrow's enabled state was computed
    once, at render, and a write deliberately does not re-render the tab (that
    would tear the colour picker out from under the pointer mid-drag). So it was
    rendered disabled for a token with no override and stayed that way after the
    user changed the colour. Rows now hold their components and re-sync after
    every write; `tokenRow.ts` exists for that.
  - **The colour picker was not live.** Obsidian's `ColorComponent` registers
    `change` only, and `change` on a native colour input does not arrive until
    the picker is dismissed. The row now owns a plain `<input type="color">` and
    listens for `input`, which streams while the colour moves — the same event
    Obsidian's own canvas picker relies on.
  - **A drag no longer writes `data.json` per frame.** `updateLive` applies
    synchronously and debounces the save by 400ms; `update` still saves at once
    for discrete actions; `onunload` flushes.
  - **The pipette is now `window.EyeDropper`**, feature-detected, with no button
    at all where it is missing. What the user found before was Chromium's own
    pipette inside the native `<input type="color">` popup — an OS window that
    covers the workspace you are trying to sample. The tinted magnifier grid is
    Chromium's and cannot be restyled; nothing here pretends otherwise.
  - **Splitter alphas have a real control.** `supportsAlpha` in the registry
    marks exactly the tokens whose default is translucent, and those rows get an
    opacity slider. `colorValue.ts` parses hex/rgb()/rgba()/transparent; anything
    it cannot take apart — `color-mix()`, `var()` — keeps its text field and
    loses its swatch rather than being rewritten.
  - **The locator.** Resting the pointer on a row (200ms) paints that token
    magenta on top of the profile, so every rule spending it lights up, reader
    iframe included. Nothing is persisted: the preview is a runtime field the
    save path does not read, composed by a pure function. Cleared on leave, on
    any real write, on tab hide, before the sampler opens, and on unload.
  - **The swatch ring was clipped by Obsidian's own stylesheet.** The colour
    input is `calc(--swatch-width + 4px)` wide but only `--swatch-height` tall,
    while the swatch wrapper has 2px of padding — so the ring has room left and
    right and none top and bottom. The theme studio adds the missing 4px on its
    own rows.
  - **Groups fold** — CORRECTION: they did not. The class never reached the
    element (see the view entry above). The fold state was stored but never
    shown. Value fields went 18em → 16em, fixed.
  - **Verified:** typecheck, lint (0 errors, 0 warnings), 1861 tests in 57
    files, three builds, three smoke deploys.

- **Nexus: a theme, a live editor for it, and a bridge into the reader
  (2026-09-22), implemented locally, deployed to the smoke vault only. Not
  pushed, not in the productive vault.** Normative: the seven `DECISIONS.md`
  entries dated 2026-09-22 from "The theme owns the visual language" onward.
  Workflow: `docs/ocap/nexus-theme-workflow.md`.
  - **What changed in principle.** Host colours are no longer CSS patches in a
    plugin. `theme/nexus/` is a real, selectable Obsidian theme and the one
    place a host surface is named. `companion/zotflow-reader-extensions/styles.css`
    is now empty — kept, not deleted, because a deployment installs files and
    never removes them, so an installed stale copy has to be overwritten.
  - **The token table** is `theme/nexus/src/tokens.ts`: eleven tokens over
    workspace, document/reader, interaction and text. The theme's CSS is
    hand-written and held to the table value-for-value by
    `tests/nexusTheme.test.ts`, in both directions. Adding a knob is a row plus
    a rule; the editor's controls follow by themselves.
  - **Defaults are the measured baseline**, not a new palette: `#333333`
    workspace, `#282828` its secondary plane, `#1c1c1c` document, `#232323`
    reader panel, `#dadada`/`#b3b3b3` text, the three splitter alphas as before.
    Measured against Obsidian 1.13.7's default dark theme, so activating Nexus
    changes nothing by itself. One deliberate exception: the root tab strip
    stops dimming when the window loses focus, because the token has to mean a
    colour.
  - **Nexus Theme Studio** (`companion/nexus-theme-studio/`, id
    `nexus-theme-studio`) is a settings tab plus a command, no ribbon button.
    Overrides are INLINE custom properties on `<body>` — they outrank every
    stylesheet without `!important` and without knowing Obsidian's load order,
    and they are visible in DevTools exactly where somebody would look. Profiles
    are named override sets in the plugin's own `data.json`; `Standard` is
    locked and rebuilt from a constant on load. New / duplicate / rename /
    delete / reset / JSON export / JSON import, plus Developer scratch CSS as an
    explicitly-marked development tool.
  - **The reader bridge** reads the host's *computed* `--nexus-*` values and
    mirrors them onto the reader iframe's root. It holds no colour and has no
    "is Nexus installed" check: the injected stylesheet spends each value as
    `var(<token>, <the reader's own>)`, so no theme means the exact appearance
    the plugin had before. Live updates ride one DOM event,
    `nexus-theme-tokens-changed`, declared in the token table so neither side
    owns a private copy of the name.
  - **Splitters** now speak one language on all three handle families,
    including the horizontal split inside a dock, which previously had no
    visible line at all. Three state colours stated once for every axis; only
    the geometry is per-axis. Obsidian's hit zone untouched.
  - **Not done, deliberately:** light theme; the reader's TOOLBAR (its pages are
    in a *nested* iframe and its own token names have not been measured);
    pop-out windows; Style Settings (see the decision — two authorities for one
    value, where one of them silently loses).
  - **Verified:** typecheck, lint (0 errors, 0 warnings), 1776 tests in 56
    files, three builds, three smoke deploys. Manual acceptance in the running
    Obsidian is still the user's to do.

- **A section now lands exactly where the outline lands (2026-09-22),
  implemented locally, smoke-tested, smoke vault only. Not pushed, not in the
  productive vault.** Normative: `DECISIONS.md` "A section navigates by
  destination, because that branch ignores options".
  - **The bug:** a section shortcut reached the right page but sat half a
    viewport too low — up to ten pages off for a far target. ZotFlow hands the
    reader a hardcoded `{behavior:"smooth"}` with no `block`, so the position
    branch defaults to `block:"center"`; the reader's own outline calls the
    view directly with `block:"start"`.
  - **The fix:** the subpath now leads with a PDF destination
    `[pageIndex,{name:"XYZ"},left,top,null]` — the reader's own resolved point,
    re-expressed. That branch calls PDF.js's `goToDestination` and consults no
    options at all. The position stays behind it as the fallback.
  - **Measured against the native outline click**, settled scroll offset, six
    entries: delta 0 for all of them (was −18 to −14132).
  - **Legacy tools are untouched** and behave as before; re-dropping upgrades
    them. No settings bump. The destination is derived in the panel, so old
    drag payloads get it too.

- **Outline sections as tools, and Search before Appearance (2026-09-22),
  implemented locally, smoke-tested, deployed only to the disposable smoke
  vault. Not pushed, not in the productive vault.** Normative: `DECISIONS.md`
  "A dropped outline entry is a section, not a page bookmark".
  - **Drag an entry out of the reader outline onto a grid cell** and it becomes
    a tool named after the section. Clicking it opens the document — reusing an
    open reader, or opening one — and lands on the entry's own destination.
  - **It stays a section.** The tool is an ordinary `file` action, and beside
    the subpath it carries `section`: title, level, ancestors, page index,
    printed label, and the next entry's start. No new action type, no settings
    bump; an older build still opens the file.
  - **Navigation reuses ZotFlow's own channel:** it parses `annotation=<json>`
    from a subpath and passes the object to the reader's `navigate()`.
    *(The claim that a position lands precisely is SUPERSEDED by the entry
    above: through that channel a position is centred, not top-aligned.)*
  - **The semantic source is `_reader._state.outline`**, not scraped text. Rows
    are matched by index PATH: `outline-N` and `data-id` renumber on expand.
  - **Toolbar:** Search now sits before Appearance on both sides; with the
    sidebar right the group reads Search → Appearance → Toggle.
  - 39/39 outline smoke checks and 56/56 sidebar smoke checks against a live
    reader; 1493 unit tests.

- **Panel surface hierarchy (2026-09-22) — SUPERSEDED the same day by the
  Nexus theme, above. The colours and the three levels are unchanged; they
  simply live in `theme/nexus/theme.css` now instead of in the companion's
  `styles.css`, and the reader half reads them through the bridge rather than
  mixing its own. The rest of this entry is kept as the record of where those
  values came from.** Implemented locally, verified visually and by test,
  deployed only to the disposable smoke vault. Not pushed, not in the
  productive vault. Was in `zotflow-reader-extensions`, not in the panel.
  - **The problem was that there was no hierarchy.** Obsidian's side docks and
    the reader's own sidebar were both painted `#282828` — the same grey, from
    two unrelated variables that happened to agree. With the reader's sidebar
    docked right, it and the right dock formed one uninterrupted slab and
    nothing said where the document ended.
  - **Three levels now, measured:** the side docks ≈`#333` (workspace), the
    reader's sidebar ≈`#232323` (the document's own panel), the pages `#1C1C1C`.
    Both colours are mixed from the theme's / the reader's own tokens, never
    fixed, and the whole thing is scoped to `body.theme-dark`.
  - **Two stylesheets, two realms, deliberately.** `styles.css` is ordinary
    plugin CSS for Obsidian's workspace and knows nothing about the reader;
    `surfaceStylesheet()` is injected into the reader's iframe, which no
    stylesheet loader can reach, and knows nothing about Obsidian. The
    companion orchestrates both; the panel is not involved.
  - **A workspace rule, not a panel rule.** Nothing names DAP, so the docks look
    the same with Backlinks, Properties or Tags open — verified in all four.
  - **The boundary is the side-dock `.workspace-leaf-resize-handle`**, not the
    reader's internal `.sidebar-resizer`, which moves a different edge. A 1px
    neutral hairline idle, 2px brighter on hover, brighter still while dragged;
    the drag state hangs off Obsidian's own `.is-active`, because the pointer
    leaves the 3px strip immediately. The grab zone is untouched.
  - **Neutral throughout.** Obsidian paints this handle with `--color-accent`
    while dragging, via both `background-color` and `border-color`; both are
    reset. Accent colours mean cell colour and selection in this panel, and an
    edge is not a meaning.
  - Deliberately out of scope: light theme, any colour-settings UI, and the
    known narrow-reader resizer bug below 768px (still open, see caveats).
  - `styles.css` now ships with the plugin: `COPIED` in `esbuild.config.mjs`,
    `COMPANION_FILES` in `deploySmoke.mjs`. 18 new unit tests; the four existing
    smoke suites re-run unchanged.

- **Reader sidebar side (2026-09-22), implemented locally, smoke-tested,
  deployed only to the disposable smoke vault. Not pushed, not in the
  productive vault.** Normative: `DECISIONS.md` "Reader extensions are a
  companion plugin…"; audit `audits/2026-09-22-zotflow-reader-sidebar-side.md`.
  - **A separate plugin, not a DAP feature.** `companion/zotflow-reader-extensions/`
    (`zotflow-reader-extensions`) adjusts the reader ZotFlow embeds from outside
    its iframe. No ZotFlow fork, no reader fork, no bundle patch.
  - **One capability:** `sidebarSide: "left" | "right"`, in the plugin's own
    `data.json`. Default `left` is the reader untouched. Right-click the reader's
    sidebar toggle to choose; the toggle always lives on the sidebar's side.
  - **Two traps the audit caught:** the reader ships both `.split-view` and
    `#split-view` and only the id one carries the PDF; the resizer maths is
    hardcoded to the left edge and is re-derived through `_reader.setSidebarWidth`.
  - **One trap the smoke caught:** `target instanceof Element` is always false
    across the iframe realm boundary, which silently disabled both the right-hand
    resize and the context menu. Guards are duck-typed now, with a test.
  - **Fails soft:** an unfamiliar reader DOM is a logged no-op, never a half patch.
  - 54/54 live smoke checks, 42 unit tests; below the reader's own 768px
    breakpoint it mirrors the reader's overlay mode. Known narrow-width limit:
    the toolbar already scrolls there, so the right-hand toggle sits in that
    scroll area.

- **Help button and context routing (2026-09-20), implemented locally,
  live-smoke-tested, deployed only to the disposable smoke vault. Not pushed,
  not in the productive vault.** Normative: `cell-selection-colors.md` §20;
  `DECISIONS.md` "Die Bedienreferenz steht an einer Stelle…";
  `HANDOFF.md` §2p.
  - **One reference, one place.** `src/utils/interactionReference.ts` is the
    only formulation of the mouse grammar for the user; the `?` button in the
    panel toolbar opens a plain Obsidian modal that renders it. Ctrl/Cmd per
    platform, en/ru/zh.
  - **The help text cannot document a dead rule**: tests assert the absence of
    the discarded left-drag-moves, right-button selection, locked/edit, and the
    old "a plain colour click selects that colour's cells".
  - **A right click now has a subject.** `resolveContextTarget` answers TOOL
    context vs SELECTION context (clicked cell inside the selection), with the
    cell count, the tool ids and the clicked tool already resolved.
  - **The right click never changes the selection** — verified live, before and
    after every menu.
  - **Nothing invented**: the menu is still exactly Edit/Copy/Delete. What the
    selection context will offer is explicitly future.
  - **Found live, fixed:** the cell-key provider wrapped every cell's children
    unconditionally, which made all sixteen cells count as filled (no `+`, no
    empty-cell tooltip, no file drop). Now it wraps only a real tool.
  - Tests **1370/1370**, `tsc`, `eslint`, build green. **Live smoke 486/486**
    over fourteen stages, 0 console problems.

- **Corrected mouse grammar — EXPERIMENTAL PROTOTYPE (2026-09-20), implemented
  locally, live-smoke-tested, deployed only to the disposable smoke vault. Not
  pushed, not in the productive vault.** Normative:
  `cell-selection-colors.md` §3a, §4.1, §4a.5, §4.5, §5a; `DECISIONS.md`
  "Corrected: left uses, right moves".
  - **left click = use, Shift/Ctrl + left = select, right click = context,
    right drag = move the tool.** The left DRAG is reserved: no move, no
    selection, and no run on release.
  - **Supersedes the same day's first attempt** (selection on the right button,
    move on the left), which manual use rejected. The button still carries part
    of the meaning and the mode is still gone; only the assignment changed.
  - **Two drags, two buttons, one dnd-kit**: the sensor accepts both and each
    draggable filters (`activateOnButton`) — tool right, category grip left
    (and never while a selection modifier is held).
  - **One context menu is swallowed after a right drag**, armed from the drag
    itself because the grid remounts mid-drag. No standing block.
  - **A tool rests on `pointer`** again; the closed hand shows only during a
    real drag.
  - Tests **1323/1323**, `tsc`, `eslint`, build green. **Live smoke 462/462**
    over thirteen stages, 0 console problems.
  - **Open, deliberately:** the left drag stays free for a future outbound
    resource drag.

- **The mouse button carries the meaning — EXPERIMENTAL PROTOTYPE
  (2026-09-20), implemented locally, live-smoke-tested, deployed only to the
  disposable smoke vault. Not pushed, not in the productive vault.** Normative:
  `cell-selection-colors.md` §3a (new; §3 marked superseded), §4.1, §4a.5,
  §4.5, §5a; `DECISIONS.md` "The mouse button carries the meaning".
  - **left = use / move, right = context, Shift+right = add, Ctrl/Cmd+right =
    remove.** A right drag is reserved (no menu, no selection, no move). One
    decision per press, latched at pointer-down (`gridPointerIntent`), read by
    the click, the rectangle and the context menu alike.
  - **The locked/edit toggle is gone from the UI and has no effect.** Every
    layout affordance is always available. The stored value is untouched and
    unread (`SINGLE_INTERACTION_MODE`); a stored "locked" provably changes
    nothing. Reverting is one constant plus the nav-bar button.
  - **A modifier no longer changes the left button anywhere**; the drag guards
    and the `+`'s selection branch are gone. The palette keeps its left-button
    modifiers (a swatch is a control, not grid).
  - **Context menus route into the existing infrastructure** (`useButtonMenu`:
    Edit/Copy/Delete; `createCategoryMenuHandler`). Nothing was invented; an
    empty cell has no menu.
  - Tests **1316/1316** (new `tests/mouseGrammar.test.ts`), `tsc`, `eslint`,
    build green. **Live smoke 453/453** over thirteen stages, 0 console
    problems.
  - **Open, deliberately:** what a right drag should mean, and how a future
    outbound resource drag is told apart from a left-drag move.

- **A swatch is a paint colour (2026-09-20) — implemented locally,
  live-smoke-tested, deployed only to the disposable smoke vault. Not pushed,
  not in the productive vault.** Normative: `cell-selection-colors.md` §8,
  §8.2, §10, §10.1; `DECISIONS.md` "A swatch is a paint colour: choose it,
  then work with it".
  - **A plain click always means "paint with this"**: it chooses the colour,
    and paints the selection too if there is one. It never selects — that is
    what Shift (add the colour's cells) and Ctrl/Cmd (remove them) are for, and
    those never paint and never change the chosen colour.
  - **Supersedes the same day's "plain click with nothing selected selects that
    colour group"**, which failed manual acceptance as a hidden special case.
  - **Arming needs no selection**: the paint survives exactly the transition
    from no selection to one, so "choose red, then Shift-collect cells" paints
    them red. Escape and a background click drop it, selection or not.
  - **The chosen colour is visible**: an accent ring on its swatch (the loud
    marker, for the state with no other representation); what the selection
    currently is keeps a quiet border. Neither moves a pixel.
  - Tests **1305/1305**, `tsc`, `eslint`, build green. **Live smoke 411/411**
    over twelve stages, 0 console problems.

- **A container is not a control (2026-09-20) — implemented locally,
  live-smoke-tested, deployed only to the disposable smoke vault. Not pushed,
  not in the productive vault.** Normative: `cell-selection-colors.md` §4.4;
  `DECISIONS.md` "A container is not a control because it holds one".
  - **The backdrop list now names only elements whose own click acts.** The
    colour palette and the variant bar were on it as containers, so `closest`
    walled off their whitespace and the user had to hunt for the strip between
    two categories to deselect. Their buttons stay excluded on their own
    account; the grid stays listed, because the grid decides what a press on a
    cell means.
  - **The surface is this view's `view-content`**, so the empty room below the
    last category clears too. Editor, modal and other leaves stay out.
  - Click-vs-drag, the travel threshold and every control's own action are
    unchanged.
  - Tests **1295/1295**, `tsc`, `eslint`, build green. **Live smoke 398/398**
    over twelve stages, 0 console problems. The variant bar's whitespace is
    covered by unit tests only — see HANDOFF §2l.

- **The palette speaks the grammar of the grid (2026-09-20) — implemented
  locally, live-smoke-tested, deployed only to the disposable smoke vault. Not
  pushed, not in the productive vault.** Normative:
  `cell-selection-colors.md` §8, §10.1, §7.2, §4.2, §8.2; `DECISIONS.md` "The
  palette speaks the grammar of the grid".
  - **plain = primary action, Shift = add, Ctrl/Cmd = remove**, on swatches as
    on cells. With nothing selected a plain click selects that colour's cells
    (clear = the uncoloured ones); with a selection it paints it. Ctrl removes
    that group, or does nothing when there is nothing to remove from.
  - **Supersedes `Ctrl + swatch = replace the selection`** and the asymmetry it
    carried. Selecting is an ADD, so the one-active-context rule holds
    unchanged across grids.
  - **Only a plain click with a selection writes**, and only it arms the paint
    colour.
  - **The tooltip states this click's effect in this state** and follows the
    held key live; the swatch wears the same plus/minus cursors as a cell, from
    the same tracker.
  - One pure decision (`src/utils/cellPaletteAction.ts`) feeds click, tooltip
    and cursor.
  - Tests **1286/1286** (new `tests/cellPaletteAction.test.ts`), `tsc`,
    `eslint`, build green. **Live smoke 375/375** over eleven stages, 0 console
    problems.

- **Honest cursors and a category drag handle (2026-09-19) — implemented
  locally, live-smoke-tested, deployed only to the disposable smoke vault. Not
  pushed, not in the productive vault.** Normative:
  `cell-selection-colors.md` §4.5 (the cursor model), §5a (the handle), §4.4,
  §19; `DECISIONS.md` "The cursor tells the truth, and a category moves only by
  its handle".
  - **The cursor says what a press does here:** a drag in flight `grabbing`,
    Ctrl/Cmd a bold minus, Shift `cell`, a movable tool `grab`, otherwise the
    surface's own (`pointer` on a tool that runs and on the `+`, `default` on a
    cell or gutter). Priority is one custom property with per-surface
    fallbacks, not a specificity race; the minus is an embedded SVG data URI
    (no native minus cursor exists); `grabbing` is the single `!important`,
    tied to dnd-kit's active drag.
  - **A list category moves only by a grip handle** at the head of its header,
    before the icon. The header folds and does nothing else; grid, empty cells
    and the free block area start no reorder. Same sortable, same reorder
    logic — only the activator moved (`setActivatorNodeRef`). Edit-only, with
    its space reserved in locked so the header never shifts.
  - **Background clear:** a press that ever travelled past the threshold
    forfeits its click, now that the free area has no drag engine to do it.
  - Tests **1261/1261** (new `tests/cursorModel.test.ts`), `tsc`, `eslint`,
    build green. **Live smoke 306/306** over ten stages, 0 console problems.

- **One selection context, grab-surface clear, modifier cursor (2026-09-19) —
  implemented locally, live-smoke-tested, deployed only to the disposable smoke
  vault. Not pushed, not in the productive vault.** Normative:
  `cell-selection-colors.md` §4.2, §4.4, §4.5, §4a.6, §8.1, §11;
  `DECISIONS.md` "One active selection context; Shift moves it, Ctrl never
  reaches across".
  - **Exactly one active context panel-wide**, keyed on `(categoryId,
    variantId)`. Shift click / drag / swatch in another grid clears the old
    one and starts there; Ctrl/Cmd in another grid is a no-op; a plain tool
    click in another grid runs it and keeps the selection. The armed paint
    colour is not carried across; Escape mid-gesture restores the old grid's
    whole selection.
  - **The free category grab surface clears on a click** and still reorders on
    a drag (root cause: dnd-kit's `role="button"` on the block). Tabs and
    folder tiles stay excluded.
  - **Shift or Ctrl/Cmd held → `cursor: cell`** on all grid surfaces, both
    modes, visual only.
  - Tests **1224/1224**; `tsc`, `eslint`, build green. **Live smoke 248/248**
    over nine stages, 0 console problems.

- **The operative model (2026-09-19) — implemented locally, live-smoke-tested,
  deployed only to the disposable smoke vault. Not pushed, not in the productive
  vault.** Normative: `docs/ocap/cell-selection-colors.md` §3 (rewritten), §4.1,
  §10, §11, §12; `DECISIONS.md` "Locked protects the layout; using and selecting
  work in both modes" (supersedes "Edit mode manages, locked mode executes").
  - **Plain click = USE, modifier = SELECT, in both modes.** A plain click on a
    tool runs it in edit mode too, and no longer replaces the selection; a click
    on an empty cell does nothing. Shift/Ctrl(Cmd) click and drag select in
    locked mode too, and never run the tool. The grid decides in the capture
    phase via the pure, mode-free `gridClickMeaning` / `isClickNotDrag`. The
    closing click of a layout drag is swallowed even when a tool returns to its
    own cell, so moving never runs anything.
  - **Locked = layout locked, nothing else.** `interactionMode.ts` now exports
    one predicate, `allowsLayoutEditing`. Move/swap, category reorder, resize,
    the `+` and the restructuring menus stay edit-only; selection, rectangles,
    the palette, Escape/background clear and file drops work in both.
  - **A mode toggle keeps the selection**, its contour and the armed paint
    colour. The selection gate no longer mentions the mode or `sortableEnabled`
    (the latter took every grid offline during any category drag — the root
    cause of "a category reorder drops the selection"); only a search suspends
    it (`available` on the selection context). The PanelContent guard compares
    the variant the projection actually renders, right in both modes.
  - **A category reorder keeps the selection** — including when the dragged
    category is the one holding it: its grid is swapped for the preview during
    the drag, so the deferred "is it gone?" check stands down while a category
    drag is active (`CellSelectionLayoutDragHold`) and re-asks after the drop.
  - **Escape works after the focused element was unmounted** (a replaced tool, a
    block rebuilt by a toggle): it now counts from anywhere in the panel's leaf
    or from `<body>`. Found by the live run, not by review.
  - **A drop onto an occupied cell is silent** (no confirm, no warning, no
    success notice); a drop onto an empty cell keeps its notice. The grid tells
    the hook via `replacing`.
  - No schema bump, no template bump, no second create path, no outbound drag.
  - Tests: **1208/1208** (43 files; +36, incl. `tests/operativeSelection.test.ts`
    with the pure click decision). `tsc --noEmit`, `eslint .`, `npm run build`
    green.
  - **Live smoke: 198/198** across eight stages in an isolated Obsidian 1.13.7,
    0 console errors. New stage (55): in BOTH modes a plain click runs the tool
    and selects nothing, Shift/Ctrl click select and do not run it, rectangles,
    palette apply / Ctrl- / Shift-swatch, Escape and background clear; a toggle
    in either direction keeps selection, contour and paint colour; dragging the
    category that holds the selection, and the other one, keeps it; in edit a
    plain drag moves and does not run; in locked a plain drag moves nothing and
    there are no resize edges; an empty-cell drop is announced and a replacing
    drop is silent. The seven older stages were adapted where they encoded the
    old click model (selection-starting clicks became Shift-clicks; "edit click
    selects" became "edit click runs"; "locked shows no selection" became
    "locked keeps it").
  - Harness note: a fresh scratch vault now shows Obsidian's "trust the author"
    prompt; the run accepts it inside the disposable instance (the copy's only
    plugin is this build).

- **Two productivity additions (2026-09-19) — implemented locally,
  live-smoke-tested, deployed only to the disposable smoke vault. Not pushed,
  not in the productive vault.** The selection visuals were accepted by the user
  as finished and were NOT redesigned. Specification:
  `docs/ocap/cell-selection-colors.md` §3, §4.2, §4.4; two new entries in
  `DECISIONS.md`.
  - **A selection now ends with Escape OR a click on empty panel background.**
    Escape was already correct and was left alone (verified live, including for
    a selection of empty cells). The background click is new: what counts as
    background is an EXCLUSION list (`src/utils/selectionBackdrop.ts`) — the
    grid, its frame and cells, tools, the palette, the category title, the
    variant bar and every ordinary control keep their meaning. The decision is
    made on the CLICK, never the press, because that same background is the
    list-view category drag handle; an activated drag forfeits its click
    outright. This supersedes "a click outside the grid has no effect" (§4.2).
  - **Locked is the working mode: a file dropped on a cell creates a tool
    there**, and a drop on an OCCUPIED cell replaces it with no confirmation.
    The line is not between the modes but between bringing something IN and
    rearranging what is there — move, swap, reorder, resize, selection, colours
    and the `+` all stay edit-only. It coincides with a technical line that
    keeps it safe: a file drop is a native HTML5 drag from outside, while the
    plugin's own drag is pointer-based and still follows `sortableEnabled`.
    Locked mode was NOT made DnD-capable.
  - Replacing is opt-in at the call site (`createToolInCategory`'s
    `replaceOccupied`) so the `+`, the modal and copy keep dodging to a free
    slot. The displaced definition is collected by the ORDINARY `gcTools` rule:
    a tool still placed in another variant, another category, or marked
    `library`, survives. The renderer now tells the hook which variant the drop
    landed on — in locked mode there is no editing selection, and the old
    fallback ("the first variant") would have filed the tool into a grid nobody
    was looking at.
  - New: `src/utils/selectionBackdrop.ts`,
    `src/components/buttons-panel/CellSelectionBackdrop.tsx`. No schema bump, no
    template bump, no second create path, no new notice.
  - Tests: **1172/1172** (42 files; +43). `tsc --noEmit`, `eslint .`,
    `npm run build` green.
  - **Live smoke: 143/143 checks** across seven stages in an isolated Obsidian
    1.13.7, 0 console errors. New stage (26): Escape clears filled AND empty
    cell selections with their contour; a background click clears; a cell click
    still replaces; a title click still only collapses; a category drag produces
    no click at all for the backdrop listener to act on; a drag starting on the
    background does not clear; in LOCKED mode an empty and an occupied cell both
    light up as drop targets, the drop creates and replaces, no dialog opens,
    the displaced definition is collected (tool count unchanged) and the
    replacement persists; an internal tool drag is still refused; a tool click
    still executes; the drop still works in edit mode.
  - Observed, pre-existing and unchanged: a category REORDER drops the cell
    selection (a grid-context change per §11). It is not caused by the new
    background click — the live probe shows a category drag fires no click.

- **Persistent selection contour (2026-09-19) — implemented locally,
  live-smoke-tested, deployed only to the disposable smoke vault. Not pushed,
  not in the productive vault.** The selection visuals are now three distinct
  layers. Specification: `docs/ocap/cell-selection-colors.md` §9, §9.1, §9.2;
  one new entry in `DECISIONS.md`.
  - **The selection keeps an outline that survives the gesture**, and it traces
    the REAL shape, never a bounding box. The wash alone was too soft to read as
    a form, and the gesture's outline vanished on release — so the most
    interesting selections, the ones built by subtracting a block from a larger
    one, were exactly the ones with no shape to see.
  - One rule does all of it (`src/utils/gridSelectionOutline.ts`, pure): *a cell
    draws a border on each side whose orthogonal neighbour is not selected, and
    every piece reaches half a gutter toward every side that has an in-grid
    neighbour.* Following the cells' own edges makes the topology correct for
    free — **holes get their own inner contour, disconnected islands each get
    their own, a diagonal touch stays two shapes** — with no polygon tracing and
    no SVG. The uniform reach is what turns tiles into one shape: neighbouring
    pieces meet exactly in the middle of the gutter, and a concave corner closes
    exactly for the same reason.
  - **The gesture preview became dashed** and is drawn above the contour, so
    "provisional" and "settled" differ in style rather than position; both sit
    on the same gutter midline so they never nest. Both overlays now share one
    piece of track arithmetic (`.ocap-grid-overlay`).
  - New: `src/utils/gridSelectionOutline.ts`,
    `src/components/buttons-panel/GridSelectionOutline.tsx`. Selection logic,
    gesture semantics, DnD precedence, paint and persistence all untouched; no
    schema bump.
  - Tests: **1129/1129** (40 files; +24, incl. a randomised closed-contour
    invariant over 200 shapes). `tsc --noEmit`, `eslint .`, `npm run build`
    green.
  - **Live smoke: 117/117 checks** across six stages in an isolated Obsidian
    1.13.7 (parity 18, rectangle 19, paint 18, regression 14, visuals 26,
    contour 22), 0 console errors. Verified live: the contour stands after
    mouse-up; a 2×3 block draws its perimeter and no inner edge; removing the
    middle 2×2 from a full grid yields 16 + 8 = 24 edges, i.e. the hole gets its
    own contour; two isolated cells are two contours; adjacent pieces meet
    within 0.75px in the gutter and neither draws the shared edge; a click in an
    outlined gutter still behaves as before; a coloured cell keeps colour, wash
    and contour; Escape clears all of it; locked mode shows none of it.

- **Selection readability + the collapsed-category drag bug (2026-09-18, third
  round) — implemented locally, live-smoke-tested, deployed only to the
  disposable smoke vault. Not pushed, not in the productive vault.** Both came
  out of the user's manual test of the rectangle feature: it worked, but it was
  not readable. Specification: `docs/ocap/cell-selection-colors.md` §9 and §9.1;
  two new entries in `DECISIONS.md`.
  - **Selection is a STATE, the gesture is a SHAPE.** A selected cell is now
    *washed* with a translucent accent tint (inset `box-shadow`, the one free
    channel — it paints above the cell background and below its contents, so a
    coloured cell stays coloured and the tool stays legible). The running
    gesture draws **one continuous outline** around the whole block, gutters
    included, placed from four integers against the grid's own tracks. Before,
    both questions were answered by the same per-cell accent ring: at four or
    five columns the rings tiled, the gaps cut the block apart, and a
    `Ctrl`-removal had nothing to show at all — its cells just stopped being
    ringed. A removal now also marks the cells it is dropping, in the error
    colour and in the same channel, so they change **in place** from "selected"
    to "leaving". The selection LOGIC is untouched.
  - **A drag no longer touches a collapse state.** `ListModeContent` revealed
    *every* collapsed category for the duration of *any* button drag and folded
    them back on release, so dragging a tool at the bottom of the panel unfolded
    a category at the top and moved everything in between mid-gesture. The
    collapsed grid now stays hidden throughout (still MOUNTED, so its droppables
    keep their registration), and the 0.4s drag-hover that expanded a collapsed
    category was removed with it. Consequence, accepted: a collapsed category is
    not a drop target; expanding it first is the visible way in.
  - Tests: **1104/1104** (38 files; +23). `tsc --noEmit`, `eslint .` and
    `npm run build` green.
  - **Live smoke: 95/95 checks** across five stages in an isolated Obsidian
    1.13.7 (parity 18, new visuals 26, rectangle 19, paint 18, regression 14),
    0 console errors. Verified live: the wash is an inset shadow and not an
    outline, it moves no cell, it survives on a coloured cell; exactly one
    preview box exists during a gesture and it spans the whole block including
    gaps; it is out of flow and pointer-transparent, and the 16 cells are not
    displaced; a removal marks the right cells and colours the outline
    differently; Escape clears both; a collapsed category stays collapsed
    before, during and after a drag in another category, chevron included.

- **Locked/Edit visual parity + modifier rectangle selection + ephemeral paint
  colour (2026-09-18, second round) — implemented locally, live-smoke-tested,
  deployed only to the disposable smoke vault. Not pushed, not in the productive
  vault, awaiting Max's manual UX acceptance.** Specification:
  `docs/ocap/cell-selection-colors.md` §4a, §8.2, §19; three new entries in
  `DECISIONS.md`.
  - **Locked and edit now render the same panel.** The manual test reported that
    the design "jumps" on a mode switch, and it did, for four reasons — three of
    them accidents: (a) `.icon-top`/`.icon-left` pin a FIXED button width at
    0-4-2, which the grid's `width: 100%` only beat in edit mode because the drag
    wrapper adds a class, so a locked tool sat 56px wide and left-aligned in a
    much wider cell; (b) the same collision killed the tool's hover ground in
    BOTH modes, leaving only a drop shadow whose size jumped with (a); (c) the
    raster and the outer frame were gated on `--managed`, i.e. on edit mode; and
    (d) — found only by measuring in a running Obsidian — the 16px resize gutter
    exists only in edit mode, so every cell of a 4-column grid grew by 4px on
    locking. Fixed by naming the layout class (0-5-2), giving the slot a real
    hover ground that loses to the coloured-cell rule, drawing the raster in
    every mode, and reserving the gutter as an empty pointer-through spacer in
    locked. `--managed` now gates only genuine editing chrome (empty-cell hover,
    grab cursor).
  - **Shift-drag adds a rectangle of cells, Ctrl/Cmd-drag removes one** — the
    same semantics as the click, applied to an area. Cell-gridded, never pixel
    geometry; direction-free; the pointer always resolves to the nearest track so
    gutters and the grid edge have no dead zones. Below the 4px threshold the
    gesture IS the existing single-cell click. Every step derives from the
    pointer-down BASELINE, so grow/shrink inside one gesture is exact. Escape and
    `pointercancel` restore the baseline and write nothing.
  - **A modifier press reserves the selection**: no tool move, no swap, no
    category reorder, on filled and empty cells alike. Claimed in the capture
    phase inside a grid, and by wrapping dnd-kit's activator on the list-view
    category block, the tabs and the folder tiles. No global switch, nothing that
    a key-up can leave stuck.
  - **Ephemeral selection paint colour:** applying a colour arms it for that
    selection session, so a following additive gesture paints exactly the cells
    it adds ("no colour" included). Modifier swatch clicks never arm it. Nothing
    is written during a drag; pointer-up produces ONE bundled write, and the
    preview is held until the stored styles carry it. Never persisted.
  - **No settings-version bump, no template-format bump, no data change.**
  - Tests: **1081/1081** (38 files; +61 over the previous round in
    `tests/gridRectangleSelection.test.ts`,
    `tests/cellSelectionGesturePrecedence.test.ts` and the extended
    `tests/paletteGridGeometry.test.ts`). `tsc --noEmit`, `eslint .` and
    `npm run build` all green.
  - **Live smoke (2026-09-18): 69/69 checks in a real, isolated Obsidian
    1.13.7**, driven by trusted CDP mouse and key input against a snapshot of the
    smoke vault in a scratch Electron profile (the user's Obsidian and both real
    vaults untouched). Verified live: identical grid/cell/tool geometry and
    raster in both modes, slot-wide hover, locked execution, edit selection;
    rectangles 1xN, Nx1, 2x3, reverse diagonal, grow-and-shrink, Ctrl removal,
    sub-threshold clicks, live preview, Escape restore, the cross-grid rule, and
    a rectangle from all 16 start cells; a Shift drag on a tool never moving it
    while a plain drag still does; category reorder suppressed with a modifier
    and working without one; paint carried through Shift rectangles with exactly
    ONE settings write, Ctrl removal writing nothing, Escape committing nothing,
    "no colour" armed the same way, and no paint state anywhere in the settings;
    `Ctrl`/`Shift` + swatch unchanged and still write-free; colours in locked
    mode and across a plugin reload; the resize-edge drag. Console: no errors, no
    unhandled rejections.

- **Cell Selection + Cell Colors v1 (2026-09-18) — implemented locally and
  live-smoke-tested; NOT yet validated by the user, and NOT in the productive
  vault.** Deployed only to the disposable smoke vault, not pushed.
  Normative specification: `docs/ocap/cell-selection-colors.md`; durable
  decisions in `DECISIONS.md` (six entries dated 2026-09-18); technical detail
  in `HANDOFF.md` §2d.
  - **Edit mode no longer executes tools** (click and Enter/Space); locked mode
    unchanged. This is a deliberate, user-visible behavior change.
  - Selection is the **cell coordinate** in one grid context, ephemeral React
    state in `PanelContent`, never persisted. Gestures: plain = replace,
    Shift = add, Ctrl/Cmd = remove. No toggle, no range, no marquee, no
    sub-mode, no multi-drag. *(Superseded in part the same day: a modifier DRAG
    now spans a cell rectangle — see the entry above. A free pixel marquee and
    the Shift-click range remain non-goals.)*
  - Colors use the **existing `cellStyles`** — no `settingsVersion` bump, no
    template format bump. One commit per color application, whatever the
    selection size.
  - The `+` of an empty cell became an 18px top-right corner target; a modifier
    held over it selects instead of creating.
  - Palette of six colors plus clear below the grid, permanently mounted in edit
    mode; `Ctrl/Shift + swatch` selects by color and never writes.
  - Colors render in locked mode too (they are content).
  - Tests: **1020/1020** (36 files; +113 new in `tests/gridCellSelection.test.ts`,
    `tests/cellColors.test.ts` and the extended `tests/paletteGridGeometry.test.ts`).
    `tsc --noEmit`, `eslint .` and `npm run build` all green.
  - **Live smoke pass (2026-09-18): 84/84 checks in a real, isolated Obsidian
    1.13.7**, driven by trusted CDP input (real mouse presses/moves/releases
    with modifiers, real key events) against a snapshot of the smoke vault in a
    scratch profile. Verified live: locked-mode execution and Enter/Space,
    plain/Shift/Ctrl selection on filled AND empty cells, drag move/swap with
    the selection and colour staying on the coordinate, the corner `+` incl.
    modifier suppression, colouring/clearing, the palette's active indicator,
    `Ctrl`/`Shift` + swatch (and that they never write), variant and grid scope,
    Escape (including that an Obsidian modal still closes while a selection is
    held), the real resize-edge gesture, persistence across a plugin reload,
    the vault-file drop, the template export/import roundtrip of `cellStyles`,
    and the read-only future-settings guard. Console: no errors, no unhandled
    rejections. Two real defects were found live and fixed (below), plus one
    visual defect from screenshot review.
  - An independent adversarial review ran against the finished code and found
    one **high-severity** defect plus four smaller ones, all fixed before the
    commits: the Escape handler swallowed the key globally (breaking drag
    cancel, resize cancel, inline rename and very likely Obsidian's own modals
    while a selection existed); the palette stayed live during a resize preview
    and searched a different grid than the one on screen; the grid gutters
    silently stopped being a category-drag handle; the `+` accepted a click
    after a short drag inside it; and the click threshold used a per-axis test
    where the drag sensor uses a euclidean one, leaving a narrow band where a
    press did nothing at all. Detail in `HANDOFF.md` §2d.
  - Found by the LIVE run, not by the review: (a) a tool drag cleared the cell
    selection every time, because list view changes the category block’s element
    type while a drag is in flight and React therefore rebuilds the whole grid —
    an unmount alone cannot mean “this grid is gone”; (b) growing a grid back after
    a shrink resurrected the cells the shrink had removed from the selection,
    because pruning was derived on read only. Found by screenshot review: (c) the
    Gray swatch rendered pure white in a dark theme.

## Current state

- GitHub fork `MaxLaska/dynamic-action-panel`, local repo in `H:\Dropbox\11-Projects\A1_Obsidian contextual action panel - OCAP`, branch `master`.
- Stabilization phase 1 complete (baseline `4d233de`); Phase 2 Context Engine foundation (`5995ee5`); Phase 3 visual condition rules (`a88d92e`); desktop DnD activation fix (`3267842`); Phase 4a palette grid (`31199ae`); Phase 4b palette context layers (`90f5b38`); Phase 5 dynamic category variants (`3177f1d`). Details in git history and `docs/ocap/audits/`.
- **Phase 5 (dynamic category variants) is implemented and live-verified.** The Phase 4b layer model (Base/Pinned + context profiles + locked/reserved slots) was **retired after a manual UX test** — too much invisible state. A grid category is now either STATIC (one full grid) or DYNAMIC (complete, independent variants; first matching trigger wins, explicit fallback, else hidden). Settings version 3 with a forward-only migration that reproduces the old runtime grids exactly. Full detail: `docs/ocap/audits/2026-09-17-dynamic-category-variants.md`.
- **Phase 5.1 (polish round after the manual user test) is complete.** The intermittent "drag dead after a variant switch" bug is root-caused and structurally fixed: empty-slot droppables used to mount/unmount per variant switch, so a drag started right after a switch raced their dnd-kit registration/measurement and the drop fell through to the container zone (self-healing on any later re-render — hence the "re-select sort mode" workaround). **Every grid cell is now a permanent droppable** (`GridSlotCell` renders filled and empty cells, keyed by slot), which also makes the whole cell the drop hitbox. Plus: explicit 4×4 grid chrome in the management modes with mode-invariant geometry, drag preview/overlay geometrically identical to the final slot rendering, priority wording ("wins earlier/later"), variant bar readable at narrow widths. 340 unit tests; ~215 automated live drags/checks in an isolated Obsidian 1.13.7 (0 errors). Full detail: `docs/ocap/audits/2026-09-17-variant-grid-dnd-ux-polish.md`.

- **Future-Settings-Schutz (2026-09-18).** Eine `data.json` mit höherer `settingsVersion` als dieser Build versteht, wird jetzt als **read-only** behandelt statt überschrieben. Der Migrations-Pipeline war der Fall immer bekannt (`status: 'future'`), das Signal wurde aber nur geloggt — die nächste beliebige Benutzeraktion schrieb die verlustbehaftete In-Memory-Sicht zurück und behielt dabei die höhere Version, sodass kein späterer Build den Schaden erkannt hätte. Schutz sitzt in `src/utils/settingsWriteGuard.ts` (`persistSettings` ist der einzige `saveData`-Aufruf); die drei Commit-Funnels lehnen **vor** der Mutation ab und liefern `boolean`, damit keine Aufrufstelle Erfolg meldet, den es nicht gab. Zustand pro Plugin-Instanz, bei jedem Laden neu abgeleitet. Lesen, Navigieren und Tool-Ausführung bleiben vollständig nutzbar; Settings-Tab disabled mit Erklärung; Export erlaubt (mit Vollständigkeits-Hinweis), Import abgelehnt. Kein Downgrade. Dazu ein zweiter, schwererer Fund aus dem Review: eine *unbrauchbare* `settingsVersion` (String, Float, `Infinity`) fiel auf 0 zurück, wurde durch die ganze Migrationskette gejagt — was jede `placements`-Liste leerte — und beim Start geschrieben; jetzt `status: 'unreadable'` und ebenfalls read-only. 43 neue Tests in `tests/futureSettings.test.ts`. Detail in `DECISIONS.md` und `HANDOFF.md` §1b.
- **Build/Deploy-Trennung (2026-09-18).** `npm run build` baut nur noch (`tsc` + esbuild → `dist/`) und fasst keinen Vault an; das automatische Deploy am Ende ist entfernt. Installiert wird über `npm run deploy:smoke` bzw. `npm run deploy:prod` (letzteres nur mit `--confirm-production`), gegen eine Ziel-Allowlist in `scripts/deployCore.mjs`. **Deploy schreibt `data.json` nicht mehr** — kein Überschreiben, kein Zurückkopieren, kein Löschen des Plugin-Ordners (gelesen wird sie nur zum Hashen und fürs Prod-Backup); stattdessen Staging-Datei + Rename je Artefakt und ein SHA256-Vergleich von `data.json` vorher/nachher. Die Dev-Junction ist entfallen (sie war die Quelle von `dist/data.json`), ersetzt durch `npm run dev:smoke`. 59 neue Tests in `tests/deploySafety.test.ts`. Detail in `HANDOFF.md` §1a.
- **Template Library (2026-09-18).** Panel templates now live in one fixed, visible vault folder `Dynamic Action Panel/Templates/` instead of the vault root. Export writes there without a dialog, the primary import lists that folder in a `FuzzySuggestModal`, the OS file picker survives as the explicitly secondary `Import template from file…`, and `Open template folder` opens it in Explorer/Finder using only public API (`FileSystemAdapter#getFilePath` + `window.open(url, '_external')`). The path is deliberately NOT configurable and is NOT `pathConfig.templateFolderPath`. No format or settings-version change. Detail in `DECISIONS.md` and `docs/ocap/template-format.md` §9.

> Note: the sections below still describe the state at Phase 5.1 (2026-09-17) and are stale in two known places — `CURRENT_SETTINGS_VERSION` is 5, not 3, and the suite is 907 tests in 34 files, not 340 in 15. The ZotFlow annotation work and the template library are not reflected in them.

## Phase 5 architecture – dynamic category variants

### Product model (see DECISIONS.md, superseding decision)

- **Static category**: flow (historical) or static grid — one full 4×4 grid in `CategoryConfig.buttons`, no context behavior.
- **Dynamic category**: `CategoryConfig.variants: CategoryVariant[]` — one stable container, several COMPLETE variants. Each variant: stable `id`, `name`, exactly one `trigger` (`ButtonCondition`) **or** `fallback: true` (at most one), and its own full `buttons` grid.
- Runtime: first matching trigger in array order → else fallback → else the category is hidden. No merging, no inheritance, no pinned slots, no cross-variant blocking. Redundant storage across variants is deliberate.
- A variant switch changes only the rendered grid inside the same category container (same id, position, name).
- A grid ignores per-button conditions (`ButtonConfig.conditions` is inert legacy data there); flow categories keep the Phase-3 per-button model. `CategoryConfig.conditions` stays whole-category visibility only.

### Pure core (`src/utils/categoryVariants.ts`, replaces `paletteLayers.ts`)

- `resolveDynamicCategoryVariant(category, context)` → `{variant, reason: 'trigger'|'fallback'|'none'}`; `resolveGridViewForContext` / `resolveGridViewForVariant` → `ResolvedGridView` (16 slots + overflow). An invalid trigger never matches (non-fail-open, so a corrupt variant cannot shadow the rest); an absent trigger never matches — always-match is explicit `{ all: [] }`.
- Variant ops (pure, immutable): add / update (refuses a second fallback) / remove / move (fallback not movable) / `duplicateVariant` (full copy, new variant + button ids, inserted below source).
- Button placement across variants: `addButtonToGrid`, `removeButtonFromGridCategory`, `replaceButtonInGridCategory`, `findButtonVariantId`, `applySlotIdsToGridCategory` (drag write-back into exactly the on-screen grid; off-screen variants byte-identical; unclaimed overflow preserved).
- Conversions: `convertStaticGridToDynamic` (grid → first variant, lossless); `convertCategoryToGrid` (flow → static grid, or → dynamic with fallback + one full variant per distinct per-button condition); dynamic → flow/static **refused** (`'dynamic_category'`).
- `composeFullVariant` / `composeFallbackVariant` — the composition rule shared with the v2→v3 migration.

### Editor UI

- `VariantSelector` above a dynamic grid (sort/edit): `Editing: [Source ▾]` dropdown (scales to many variants), **⇄ quick A/B flip** to the previously edited variant, duplicate / new / `⋮` menu (edit name & trigger, move up/down, delete), plus a status line `Trigger: … · Active now: …` separating EDITED variant from RUNTIME-active variant (`none (category hidden)`, `(fallback)` annotations included).
- Without an explicit pick, editing preselects the runtime-active variant (no silent grid change on mode switch). Selection incl. the ⇄ history is session-local UI state (`CategoryVariantContext`), normalized so a deleted variant can never stay selected.
- `VariantModal` (create/edit/duplicate/make-dynamic): name, fallback toggle (disabled when taken; hides the trigger section), shared `ConditionEditor` as trigger editor; empty trigger saved as explicit `{ all: [] }`.
- Deleting the last variant is refused (Notice); deleting a variant with tools confirms and names them. "Make dynamic…" sits in the context menu of static grid categories.
- Button modals state the target variant instead of a condition editor; new tools land in the edited variant.
- Markers: dynamic category title icon `layers`, static grid `layout-grid`, flow `list`. No per-button pin/filter badges inside grids any more (variant-level contextuality); flow badges unchanged. Locked mode shows no selector.

### Rendering / DnD

- `projectCategoriesForContext` returns `gridViews` (locked: runtime resolution; sort/edit: the selected variant) — `panelProjection.ts`.
- Drag state mirrors the ONE grid on screen; a drag in `Source` cannot touch `Topic`. `BlockedSlots`, pinned/reserved/locked cells are gone. Only remaining grid rejection: flow → occupied slot (reverted + Notice).
- **Drag previews and drops are computed from the drag-start baseline** (`ButtonDragContext`): crossing occupied cells leaves no trail of intermediate swaps; release over the dragged tool itself keeps the preview; a pending rAF drag-over is flushed synchronously at drop. (Fixes a pre-existing Phase-4a defect found live.)
- **Every grid cell is a permanent droppable** (Phase 5.1): `GridSlotCell` renders filled AND empty cells keyed by slot, so the 16 droppable nodes and their measured rects survive variant switches — the root cause of the intermittent "drag dead after variant switch" bug. Collision ranking (button > slot > zones) unchanged; the whole cell is the drop hitbox. Grid chrome: `--managed` (edit+sort) shows all 16 cells (solid filled / dashed empty), `--sort` at full strength; constant 1px cell border in every mode keeps geometry mode-invariant. Flag-gated DnD lifecycle tracing: `window.__DYNAMIC_ACTION_PANEL_DND_DEBUG = true`.

### Settings – version 3

`CURRENT_SETTINGS_VERSION = 3`, chain `0 → 1 → 2 → 3` (the v1→v2 step lives on as internal legacy code in `settingsMigrations.ts`). v2→v3: every context profile → one complete variant (base + profile on the old effective slots, deterministic derived ids `<profileId>--<buttonId>` for base copies), base-only state → fallback `Default`, profile order → priority, conditionless profile → `{ all: [] }`. Grid categories without profiles stay static; malformed profile entries (dead in v2) are skipped; flow categories untouched; deterministic + idempotent. **Accepted:** a v3 document in a pre-v3 build shows a dynamic category as an empty grid.

## Unchanged foundations

- Phase 2: versioned settings + forward-only migrations; `WorkspaceContextService` snapshot store (`useSyncExternalStore`); declarative serializable conditions, fail-open, pure interpreter.
- Phase 3: one central rendering projection; locked filters / management marks; `ConditionEditor` (visual builder + explicit-apply JSON) shared by all modals; category `conditions` = visibility only.
- Phase 4a: 4×4 grid, 16 stable slots, slot lives on the button, holes are real, `placeButtonsOnGrid` self-heals deterministically; positional drop semantics (move to empty / swap occupied / flow→grid empty-only / grid→flow list insert); desktop DnD distance activation (4px, no long press).

## Verification (2026-09-17, after Phase 5.1)

- `npm test`: **340/340 PASS** (15 files). Phase 5 added `categoryVariants` 54, `variantDrag` 9, `settingsMigrations` 38; Phase 5.1 added `variantGridDnd` 16 (slot droppables on occupied cells, collision ranking, A→B→A drag-state round-trip, duplicate id-disjointness, `selectedVariantOf` normalization incl. deletion).
- `npm run lint`: PASS (0 problems) · `npx tsc --noEmit`: PASS · production build: PASS.

## Live smoke test (2026-09-17, Phase 5, 107 checks PASS, 0 errors)

Automated via CDP against an isolated Obsidian 1.13.7 (scratch `--user-data-dir`, snapshot copy of `ocap-smoke`, non-symlinked plugin dir, **version-2 fixture** so the run exercised the real migration; the user's running Obsidian and both real vaults untouched, source `data.json` verified unchanged). Error monitors active before plugin load: **0 errors** throughout.

- **Migration (22):** v3 on disk+memory byte-equal; profiles → full variants with exact old effective slots; base-only → fallback `Default`; unique button ids; static grid stayed static; flow untouched.
- **Runtime (14):** Source/Topic/plain notes resolve to the right full grids with stable slots and byte-identical restoration; flow conditions still filter; locked shows no selector; editing preselects the runtime variant.
- **Editor UX (31):** dropdown switching, ⇄ flip both ways, duplicate workflow end-to-end (prefill, auto-select, full copy, new ids, original untouched), tool creation into the edited variant, priority + Move-up changing the runtime winner, 5 variants usable, delete confirm.
- **DnD/persistence/conversion (40):** move/swap change only the dragged variant (others byte-identical, also across plugin reloads); no cascading reorder across crossed cells; flow→occupied rejected+reverted+explained; script action runs once; make-dynamic lossless; last-variant delete refused; no-match+no-fallback hides the category.
- **Views/markers (11):** tabs+folder render 16-cell variant grids; locked click executes once; `layers`/`list` title icons correct.

Two defects were found and fixed during the run (⇄ flip after implicit selection; cumulative drag-preview swaps — a pre-existing 4a defect). Detail: `docs/ocap/audits/2026-09-17-dynamic-category-variants.md`.

## Live verification (2026-09-17, Phase 5.1 — DnD stress, ~215 checks PASS, 0 errors)

Isolated Obsidian 1.13.7 (scratch `--user-data-dir`, snapshot vault, own fixture A/B/Z). Every drag validated by post-drop DOM occupancy; after each switch the harness waited only until the new grid was rendered, then dragged immediately. Results: 40/40 A/B switch+drag; 35/35 A/B/Z rotation; 6/6 create/duplicate(UI)/delete/priority + drags; 20/20 quick-⇄+drag; 30/30 sort/edit/sort transitions; 50/50 switch+drag stress; 30/30 quick-⇄ stress; 30/30 clean-build re-run. Regression: locked runtime resolution (A/B/fallback), script click once, static grid, tabs-view grid + drags, runtime preselection, reload byte-identity. Preview alignment measured: preview/overlay/final byte-equal size, centered within 0.1px. 4-column invariant verified at widths 500→150px, slot 16 drag at 150px. Before the fix the same harness reproduced the user's bug deterministically. Detail: `docs/ocap/audits/2026-09-17-variant-grid-dnd-ux-polish.md`.

## Caveats / open points

- Dynamic → static/flow conversion is deliberately not offered (data-loss path); delete variants first or keep the grid.
- The ⇄ flip history is one step deep and session-local by design.
- Migration redundancy: base tools are duplicated into every variant — intended, but a large v2 palette with many profiles grows accordingly.
- The `ConditionEditor` canonicalizes a bare-rule trigger to `all [rule]` on save (semantically identical; visible in stored JSON after editing/duplicating).
- A v3 document opened by a pre-v3 build shows a dynamic category as an empty grid (forward-only migration policy).
- Variant-bar DOM is covered by the live smoke test only (no jsdom); the pure core is fully unit-tested.
- A grid always reserves four rows; dimensions fixed at 4×4 (unchanged).
- Live-test mode/view switches went through the settings API (same code path as the nav menu); DnD, menus and all modal flows used real trusted CDP input. Note for future live runs: launch the isolated instance with `--disable-backgrounding-occluded-windows`, or rAF-driven previews pause while the window is occluded.
- Pre-existing: 6 dev-dependency `npm audit` findings; Dropbox can transiently lock `node_modules`.

## Next step

1. **Slot hotkeys** — slot identity is stable and variant-independent; only the keybinding layer is missing.
2. **Toggle tools** (OFF/ON state with separate actions/appearance) — needs a tool-type notion on `ButtonConfig`.
3. **Rich tooltip / description** — name, description, variant, hotkey in one hover surface.
4. Category/variant export-import — a dynamic category is a self-contained JSON tree.
5. `enabledWhen` and dynamic labels/icons on the existing condition model.

Still open from earlier phases: context-specific locked-mode empty state, optional jsdom-based editor unit tests, packaging/release strategy + manifest id decision.
