# Nexus – the design workflow

Last updated: 2026-09-23.

This document describes how a visual change is made in this project now that
there is a theme and an editor for it. It exists because the expensive part of
theming Obsidian is not choosing a colour — it is *finding the selector again*.
The whole point of the setup below is that a relevant selector has to be
discovered **once**.

## The four pieces, and what each one is for

| Piece | Role |
| --- | --- |
| **Nexus theme** (`theme/nexus/`) | The visual language. Every host surface is named here, exactly once. |
| **Nexus Theme Studio** (`companion/nexus-theme-studio/`) | Controlled live editing of that language, as a workspace view beside the surfaces it changes. Named profiles of token overrides, applied to the running workspace. |
| **Chromium DevTools** | A tool for *discovering* an unknown corner of Obsidian. Not a place to keep anything. |
| **ZotFlow Reader Extensions** (`companion/zotflow-reader-extensions/`) | A thin bridge that carries Nexus tokens into the reader's iframe, which a theme cannot reach. |

## The loop

### Phase 1 — Discovery

Press **Inspect UI**, in the studio's Discovery area or as a command. The
pointer becomes DevTools' own element picker, with its usual highlight. Click
the element and DevTools opens with that element selected. Escape cancels.
Read the rule that actually wins, and note two things: the **selector** and the
**variable** the rule spends, if any. (`Ctrl+Shift+I` still opens DevTools
without a picker.)

**Copy colour**, next to it, is a developer utility. It reads one pixel of the
Obsidian window and copies its hex value to the clipboard. Use it to answer
"which colour is that?" for a surface that has no token. Editing a token's
colour is done in the colour picker, not here.

This is the only phase that needs an inspector, and it happens once per surface.

### Phase 2 — Experiment

Two ways, and they are for different things.

- **The value already has a token.** Change it in the Theme Studio and look.
  Nothing else is needed.
- **The value has no token yet.** Put the rule in the studio's
  *Developer scratch CSS* section and press Apply. It takes effect immediately and survives a reload, so the idea can be
  judged over a day's work rather than in the twenty seconds before the next
  DevTools refresh wipes it.

Scratch CSS is a **development tool**, not the architecture. Anything still in
it after it has proven itself belongs in Phase 3.

### Phase 3 — Promote

When a value has earned a permanent place, it takes three edits and no more:

1. **A row in the token table** — `theme/nexus/src/tokens.ts`: key, CSS custom
   property, label, group, default value, description.
2. **The declaration and the rule** — `theme/nexus/theme.css`: the token in the
   marked token block, and a rule that spends it.
3. Nothing else. The editor builds its controls from the table, so the new
   control appears by itself.

`tests/nexusTheme.test.ts` holds the CSS to the table, value for value, so a
row added in one place and forgotten in the other fails the suite rather than
becoming a control that sets a variable nothing reads.

If the surface lives inside the reader's iframe, there is one more edit: add
the key to `BRIDGED_KEYS` in
`companion/zotflow-reader-extensions/src/nexusBridge.ts` and spend it in
`surfaceStylesheet()` with the reader's own value as the CSS fallback.

### Phase 4 — Tune

From here on the value is changed in the studio, live. Open it with the
command **Open Nexus Theme Studio** (Ctrl/Cmd+P); it docks on the right, and can
be dragged into a split, a tab or its own window like any other view. Running the
command again brings back the one that is open. No inspector, no code change, no
reload. This is where a palette is actually made:
the twentieth two-percent adjustment costs seconds.

What a colour row gives you: the swatch, a compact readout (`#333333`, and
`28%` where the token has an opacity), and the reset. Everything else is in the
**colour picker**, which the swatch opens:

- **The square and the hue bar** repaint the workspace while they move. So do
  the opacity bar and every field, and so does choosing a swatch. The reader
  follows too.
- **The format button** beside the fields (it reads `HEX`, `RGB` or `HSL`)
  cycles how the value is shown and typed. Switching changes nothing; what is
  stored is always `#rrggbb`, or `rgba()` below full opacity.
- **Opacity**, where the token has one, is a bar with a checkerboard and a
  percent field.
- **The pipette icon** next to it is a tool you switch on. While it is on,
  every click anywhere in Obsidian takes the colour under it into the picker and
  into Recent, and the picker stays visible, so you can collect colour after
  colour without switching it on again. While it is on, the cursor itself is a
  pipette, and a small loupe above and to the right of it shows the colour under
  the tip, ringed by the current one. From the keyboard, the arrows
  move a reticle one pixel (ten with Shift) and Enter or Space takes the pixel.
  Hold **Alt** to sample only while it is held. Click the pipette again, or press
  Escape, to stop; the picker stays open. It sees only this window, so no
  popped-out window and no other application, and there is no red-gridded
  browser pipette anywhere.
- **Recent** fills itself while you work, with the picker open. Each finished
  action puts its colour on the left: a click or a drag in the square let go, a
  bar let go, a value confirmed with Enter, a Recent or Saved swatch clicked, or
  a pixel taken. It holds at most 16, the oldest dropping off the right, and a
  colour used again moves to the front. Moving the mouse adds nothing until you
  let go. Escape puts the token back, but what you tried stays in Recent.
- **Saved** is what you keep on purpose. `+` saves the current colour, opacity
  included, and never twice. Clicking any swatch, Recent or Saved, loads it as a
  draft; the swatch itself does not change, so you can make a variant and commit
  or save that too. Drag a Recent colour into Saved to keep a copy exactly where
  the marker shows. Drag a saved colour to reorder the palette; the order is
  kept and exported. After loading a saved colour, `⋯` can replace it with the
  current colour or delete it. `⋯` also imports, exports and clears the palette,
  and copies it as CSS variables. Right-click and the Delete key work as well.
- **Palette files** (`.nexus-color-palette.json`) hold your saved colours.
  Export shows the JSON to copy; import takes pasted JSON or a chosen file and
  adds its colours to yours. Nothing is removed, and no theme value changes.
  They are separate from profile files, which hold token values.
- **CSS value** is the raw text, for what the picker cannot show:
  `color-mix()`, `var()`, `oklch()`. Such a value opens as **Custom CSS** and is
  never rewritten, unless you press *Convert to colour*.

**Everything in the picker is a draft until you close it.** Done, Enter or a
click outside keeps it. **Escape or Revert puts back exactly what was there
before you opened the picker**, so experiment freely. Nothing is written to
disk while the picker is open.

The rest of the row:

- **The reset arrow** ("Reset to default") clears this one token's override and
  nothing else. It is live only when this token actually has an override.
- **Resting the pointer on a row** paints that token magenta for as long as you
  stay there, so you can see which surfaces it controls without setting a colour
  to red and back. It changes nothing, saves nothing, and is gone the moment you
  move away. It is off while a picker is open.

**Typography** has three rows: the interface font family (a list of font
stacks, or any stack typed in), the UI font size (a slider; the smaller and
larger UI sizes follow in Obsidian's own proportions), and the UI line height.
There is no UI font weight, because Obsidian has no variable for one. Your own
*Interface font* in Obsidian's Appearance settings still wins over the theme's.

**Contrast** lists the text-and-surface pairs that really meet in Nexus, each
with its WCAG ratio against 4.5:1. ✓ means enough, ⚠ means enough for large
text only, and ✗ means too low. It only measures and never changes a value. It
is a design aid, not an accessibility audit.

The studio does not paint itself with the tokens it edits. Text the colour of
its surface, or a 30px UI font, leaves the studio readable, so you can always
undo it from there.

Fold a group by clicking its heading (or Enter/Space on it) when the list gets
long; folding hides controls, touches no value, and is remembered across a
restart. The profile menu (⋯) holds new, duplicate, rename, delete, import and
export; the arrow beside the profile resets the whole profile.

### Phase 5 — Bake

When a profile has become the good baseline, its values move into the defaults:
the `defaultValue` column of the token table and the matching declarations in
`theme.css`. The profile can then be reset — it is saying the same thing the
theme now says.

Baking is a deliberate commit, not something the editor does. A profile is a
proposal; the theme is the decision.

## Where things are stored

| What | Where |
| --- | --- |
| Token names, defaults, labels, groups | `theme/nexus/src/tokens.ts` |
| The theme's rules | `theme/nexus/theme.css` |
| Profiles, overrides, scratch CSS | the Theme Studio's own `data.json`, and nowhere else |
| Which theme is selected | Obsidian's `.obsidian/appearance.json` (the Studio never writes it) |

The Theme Studio never writes to the panel's `data.json`, ZotFlow's, the reader
extension's, a note, or the theme's files.

## Commands

```
npm run deploy:theme-smoke     # install the theme into the smoke vault
npm run build:studio           # build the Theme Studio
npm run deploy:studio-smoke    # install it into the smoke vault
node companion/nexus-theme-studio/scripts/smokeView.mjs   # live check, see its header
npm run build:companion        # build the reader extensions
npm run deploy:companion-smoke # install them into the smoke vault
```

All three smoke scripts resolve only the `smoke` target and refuse anything
marked productive. There is no flag that points them at the productive vault.

## What this deliberately is not

- Not a theme editor for other people's themes.
- Not a general no-code CSS builder, a DOM picker, or a CSS inspector. Inspect UI
  opens DevTools, which is that tool.
- Not a theme marketplace, a sync service, or a font manager or spacing system.
- Not an accessibility audit, and it has no automatic contrast mode (see
  `DECISIONS.md`).
- Not a home for the panel's semantic colours. Cell colours and the selection
  colour mean *"this tool is a red one"*; Nexus tokens mean *"this is a
  surface"*. They stay apart, and
  `tests/nexusTheme.test.ts` checks that they do.
