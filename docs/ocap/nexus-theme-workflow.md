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
| **Nexus Theme Studio** (`companion/nexus-theme-studio/`) | Controlled live editing of that language. Named profiles of token overrides, applied to the running workspace. |
| **Chromium DevTools** | A tool for *discovering* an unknown corner of Obsidian. Not a place to keep anything. |
| **ZotFlow Reader Extensions** (`companion/zotflow-reader-extensions/`) | A thin bridge that carries Nexus tokens into the reader's iframe, which a theme cannot reach. |

## The loop

### Phase 1 — Discovery

Open DevTools in the real Obsidian (`Ctrl+Shift+I`). Find the element, read the
rule that actually wins, and note two things: the **selector** and the
**variable** the rule spends, if any.

This is the only phase that needs an inspector, and it happens once per surface.

### Phase 2 — Experiment

Two ways, and they are for different things.

- **The value already has a token.** Change it in the Theme Studio and look.
  Nothing else is needed.
- **The value has no token yet.** Put the rule in
  *Settings → Nexus Theme Studio → Advanced → Developer scratch CSS* and press
  Apply. It takes effect immediately and survives a reload, so the idea can be
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

From here on the value is changed in *Settings → Nexus Theme Studio*, live. No
inspector, no code change, no reload. This is where a palette is actually made:
the twentieth two-percent adjustment costs seconds.

What each row gives you:

- **The swatch** repaints the workspace while you are still moving the picker,
  not when you dismiss it.
- **The pipette** samples any pixel on the screen — the panel, a dock, the
  reader, another application — and drops the colour into the token. It uses the
  browser's own screen sampler, so the workspace stays visible while you aim.
  The tinted magnifier is Chromium's and cannot be restyled.
- **The opacity slider** appears on the tokens whose value is translucent. The
  stored result is still ordinary CSS: white at 28% is
  `rgba(255, 255, 255, 0.28)`.
- **The text field** is the authoritative control and takes any CSS colour. A
  value the editor cannot take apart — `color-mix()`, `var()` — keeps its text
  and loses its swatch rather than being rewritten.
- **The reset arrow** clears this one token's override and nothing else. It is
  live only when this token actually has an override.
- **Resting the pointer on a row** paints that token magenta for as long as you
  stay there, so you can see which surfaces it controls without setting a colour
  to red and back. It changes nothing, saves nothing, and is gone the moment you
  move away.

Fold a group with the chevron in its heading when the list gets long; folding
hides controls and touches no value.

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
npm run build:companion        # build the reader extensions
npm run deploy:companion-smoke # install them into the smoke vault
```

All three smoke scripts resolve only the `smoke` target and refuse anything
marked productive. There is no flag that points them at the productive vault.

## What this deliberately is not

- Not a theme editor for other people's themes.
- Not a general no-code CSS builder, a DOM picker, or a CSS inspector.
- Not a theme marketplace, a sync service, or a font or spacing system.
- Not a home for the panel's semantic colours. Cell colours and the selection
  colour mean *"this tool is a red one"*; Nexus tokens mean *"this is a
  surface"*. They stay apart, and
  `tests/nexusTheme.test.ts` checks that they do.
