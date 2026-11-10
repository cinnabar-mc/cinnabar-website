---
name: Cinnabar
description: A familiar world. A new client.
colors:
  cinnabar-red: "#B8281E"
  red-hover: "color-mix(in oklab, #B8281E 86%, #ff8a6e)"
  red-press: "color-mix(in oklab, #B8281E 74%, #000)"
  red-deep: "color-mix(in oklab, #B8281E 38%, #000)"
  red-line: "color-mix(in oklab, #B8281E 70%, #ffb199)"
  red-text: "color-mix(in oklab, #B8281E 44%, #ffb199)"
  on-red: "#ffffff"
  gold: "#f2c35c"
  rim: "#140405"
  warning-face: "#120b0b"
  night-1: "#0e1322"
  night-2: "#151d33"
  night-3: "#1f2b47"
  night-4: "#304262"
  night-5: "#52698d"
  star: "#dbe4f2"
  ground: "#0b0708"
  raise: "#151011"
  raise-2: "#211919"
  line: "#2e2423"
  line-strong: "#4c3c39"
  frame-channel: "#3a2d2b"
  ink: "#f6eee7"
  soft: "#d8ccc3"
  quiet: "#ab9d93"
  hover-wash: "#ffffff14"
  backdrop: "#0b0708d9"
  scanline: "#00000052"
  code-ink: "#e6e1da"
  syntax-comment: "#a39d96"
  syntax-string: "#dcc9a3"
  syntax-number: "#efb7a4"
  syntax-type: "#c9c3bb"
typography:
  display-tagline:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(26px, 2.9vw, 40px)"
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 112"
  headline-pixel:
    fontFamily: "Silkscreen, ui-monospace, monospace"
    fontSize: "48px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0em"
  numeral-pixel:
    fontFamily: "Silkscreen, ui-monospace, monospace"
    fontSize: "64px"
    fontWeight: 700
    lineHeight: 0.82
    letterSpacing: "0em"
  title-pixel:
    fontFamily: "Silkscreen, ui-monospace, monospace"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0em"
  title-pixel-large:
    fontFamily: "Silkscreen, ui-monospace, monospace"
    fontSize: "32px"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "0em"
  score-pixel:
    fontFamily: "Silkscreen, ui-monospace, monospace"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0em"
    fontFeature: "'tnum' 1"
  label-pixel:
    fontFamily: "Silkscreen, ui-monospace, monospace"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0em"
  headline-reading:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(30px, 2.8vw, 38px)"
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: "-0.024em"
    fontVariation: "'wdth' 108"
  title-reading:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.18
    letterSpacing: "-0.022em"
  title-card:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.25
  title-reading-compact:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
  body-compact:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  caption:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  control:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.2
  control-operate:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.2
  tag:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  none: "0px"
spacing:
  "2": "2px"
  "4": "4px"
  "8": "8px"
  "12": "12px"
  "16": "16px"
  "24": "24px"
  "32": "32px"
  "40": "40px"
  "48": "48px"
  "64": "64px"
  target: "44px"
  header: "64px"
  gutter: "clamp(16px, 4vw, 64px)"
  page: "1360px"
  section: "136px"
  section-compact: "96px"
components:
  button-power-up:
    backgroundColor: "{colors.cinnabar-red}"
    textColor: "{colors.on-red}"
    typography: "{typography.label-pixel}"
    rounded: "{rounded.none}"
    padding: "0 24px 4px"
    height: "56px"
  button-power-up-hover:
    backgroundColor: "{colors.red-hover}"
  button-power-up-active:
    backgroundColor: "{colors.cinnabar-red}"
    padding: "0 24px"
  button-mode-key:
    backgroundColor: "{colors.cinnabar-red}"
    textColor: "{colors.on-red}"
    typography: "{typography.label-pixel}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "56px"
    width: "56px"
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    typography: "{typography.label-pixel}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "52px"
  button-ink-operate:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    typography: "{typography.control-operate}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "44px"
  button-pixel-box:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.soft}"
    typography: "{typography.label-pixel}"
    rounded: "{rounded.none}"
    padding: "0 14px"
    height: "48px"
  button-pixel-box-hover:
    backgroundColor: "{colors.raise-2}"
    textColor: "{colors.ink}"
  button-pixel-box-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
  button-platform:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.none}"
    padding: "0 18px 2px"
    height: "52px"
  button-quiet-operate:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.control-operate}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "44px"
  input:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.body-compact}"
    rounded: "{rounded.none}"
    padding: "12px 14px"
    height: "48px"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.soft}"
    typography: "{typography.label-pixel}"
    padding: "0 12px"
    height: "44px"
  nav-link-current:
    textColor: "{colors.ink}"
    padding: "0 12px 0 24px"
  tag:
    backgroundColor: "transparent"
    textColor: "{colors.soft}"
    typography: "{typography.tag}"
    rounded: "{rounded.none}"
    padding: "0 10px"
    height: "26px"
  panel:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "24px"
  cabinet:
    backgroundColor: "{colors.raise}"
    rounded: "{rounded.none}"
    padding: "40px 48px 28px"
  warning-panel:
    backgroundColor: "{colors.warning-face}"
    textColor: "{colors.ink}"
    typography: "{typography.body-compact}"
    rounded: "{rounded.none}"
    padding: "22px 28px 24px"
  module-slot:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "12px 34px 12px 14px"
    height: "60px"
  module-slot-selected:
    backgroundColor: "{colors.raise-2}"
    textColor: "{colors.ink}"
  stage-card:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.soft}"
    rounded: "{rounded.none}"
    padding: "24px 24px 28px"
  chart-tip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.none}"
    padding: "10px 14px"
  dialog:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "32px"
    width: "min(600px, calc(100% - 32px))"
---

# Design System: Cinnabar

## Overview

**Creative North Star: "The Attract-Mode Cabinet"**

Cinnabar's site is an arcade cabinet left running in a dark room. The home page is its attract-mode screen: an original pixel world drawn in code, a score line of real numbers along the top, and PRESS START as the download. The world is a warm phosphor-black night over blocky hills, lit from below by a glowing formation of cinnabar crystals, with a pixel moon, stars and block clouds overhead. Everything around it is built from the same materials: hard-edged pixel boxes with two-step corners, pixel caps for labels and titles, and one red key.

The cabinet has two registers. Persuade surfaces (home, `/mod/`) run the full world: the canvas scene, the riveted cabinet frames, the phosphor glow on pixel titles, the stepped high-score chart and the select screen. Operate and Read surfaces (`/mods/`, `/docs/modding/`) keep the world's ground, corners, pixel-caps labels and red focus, and leave standard controls, a crisp grotesk and calm reading columns alone. Density is moderate. The scene and the frames carry the character so the text can stay plain.

The world rejects two things by construction: the dimmed-screenshot hero, and the generic dark page with a neon accent. It is not a Minecraft imitation either. It draws its own world, never borrows the game's font or Mojang's UI textures, and shows the game only through the owner's own captures.

**Key Characteristics:**
- A seeded pixel world drawn on `<canvas>` at runtime, scaled by whole device pixels, never a shipped image.
- One sixteen-colour sprite palette: cool night blues plus warm ramps hue-shifted from the icon red.
- Pixel boxes everywhere: nine-slice SVG frames with 2px stepped corners, zero radius, no glass.
- Silkscreen pixel caps only at multiples of its 8px grid. Prose is always Archivo.
- One red action family, the power-up key, with a gold top edge and a pressed-in shade.
- A capability layer of scanlines, bloom and phosphor glow behind a visible Effects switch. Reduced motion gives a still frame.

### Imagery and Provenance

- **The scenes are code.** Both worlds, the surface night (home hero, `/mod/` hero with the formation mirrored to the left) and the deep cave chamber (home closing), are drawn at runtime by `arcade-scene.js` from a fixed seed (`0x51CB`). Every visit and every width draws the same place. No generated rasters ship.
- **The captures are the owner's.** `assets/gameplay/*.webp` (sunset, forest, PvP, cave, river) and `assets/mod/*.webp` (mods, settings, layout) are the owner's captures of Cinnabar. They are shown unfiltered inside frames and bezels.
- **The logotype is the client's.** `/title.png` is copied from the client repository's `assets/branding/title.png`. The header mark is the client's `packaging/icons/cinnabar.svg`, inlined as a data URI.
- **Fonts are OFL and self-hosted** in `assets/fonts/`: Silkscreen 400 and 700, Archivo variable (weight 100–900, width 62–125%) and JetBrains Mono 400, each with its licence file.
- **Pixel icons are hand-drawn SVG paths** on a 2px grid with `shape-rendering: crispEdges`: the download arrow, the warning triangle, the close cross, the chevron and the menu cursor.

## Colors

A phosphor-black cabinet of warm near-blacks, one red pulled from the icon, a single gold pixel, and the cool night blues that only the scene uses.

### Primary
- **Cinnabar Red** (read from the icon, currently #B8281E): the face of the power-up key, the mode key and the MOD cartridge tag. It comes from the `fill` of the first `<rect>` in the client's `packaging/icons/cinnabar.svg`. `render.py` substitutes it for `@@RED@@` into `--cinnabar-red`, so the value in the frontmatter is a reading of the icon, not a constant.
- **Red Hover** (red mixed 86% with #ff8a6e): the key face under the pointer.
- **Red Press** (red mixed 74% with black): the pressed-in shade along the key's bottom, the on state of the Effects switch, and text selection.
- **Red Deep** (red mixed 38% with black): the 2px drop under key labels and key icons.
- **Red Line** (red mixed 70% with #ffb199): small red marks on the dark ground. These are the menu cursor, the lit pixel in the mode menu, the square bullets, the chart line, the warning frame, the focus ring and the active tab rule.
- **Red Text** (red mixed 44% with #ffb199): red that must read as text, such as the WARNING title, stage numerals, error messages and docs links.
- **On Red** (#ffffff): labels on the red key.
- **Gold** (#f2c35c): the single art-pixel top edge of a red key, 2px in CSS, blended into the face by a second row of red mixed 70% with gold. Nothing else is gold.
- **Rim** (#140405): the dark stepped rim around every red key and the cartridge tag.
- **Warning Face** (#120b0b): the face of the WARNING panel, inside its red-line frame.

### Secondary
- **Night 1–5** (#0e1322, #151d33, #1f2b47, #304262, #52698d) and **Star** (#dbe4f2): the scene's cool sky, far hills, moon ramp and stars. They live only inside the canvas and never appear in interface chrome.

### Neutral
- **Ground** (#0b0708): the page, the scene's darkest pixel, the theme colour and the text-drop colour.
- **Raise** (#151011): the face of neutral pixel boxes, frames and panels.
- **Raise 2** (#211919): hover faces, selected rows and the face of a selected module slot.
- **Line** (#2e2423): quiet dividers, the solid header's bottom edge and the quiet box's edge.
- **Line Strong** (#4c3c39): the 2px edge of every standard pixel box, input borders, chart gridlines and the title rules.
- **Frame Channel** (#3a2d2b): the dark channel inside the riveted cabinet frame. It appears only inside that frame.
- **Ink** (#f6eee7): headings, numbers, the selected and inverted keys, the select-screen frame and tooltip faces.
- **Soft** (#d8ccc3): secondary prose, nav at rest and captions.
- **Quiet** (#ab9d93): score labels, axis text, hints, frame rivets and missing data.
- **Hover Wash** (#ffffff14): the background of a text link or nav item under the pointer. The marketplace uses a slightly stronger white wash at about 10%.
- **Backdrop** (#0b0708d9): the dialog backdrop.
- **Scanline** (#00000052): the dark gap of each scanline over the scene.

### Code
- **Code Ink** (#e6e1da) with **Syntax Comment** (#a39d96), **Syntax String** (#dcc9a3), **Syntax Number** (#efb7a4) and **Syntax Type** (#c9c3bb): code blocks in the book and the marketplace. Keywords use Red Text.

### The scene's warm ramps
The canvas builds its warm colours at runtime from the same `--cinnabar-red`, as HSL offsets of hue, saturation and lightness from the base. For the current icon they come out as listed below.

| Name | Hue shift | Saturation × | Lightness × | Current value |
|---|---|---|---|---|
| oxide | −6° | 0.62 | 0.27 | #2a1011 |
| rust | −3° | 0.78 | 0.48 | #501717 |
| ruby | −1° | 0.94 | 0.76 | #88201a |
| red | 0 | 1 | 1 | the icon red |
| ember | +3° | 1.02 | 1.3 | #e04a36 |
| coral | +8° | 1.16 | 1.6 | #f18165 |
| glint | +18° | 1.3 | 2.05 | #fdd2ba |
| ochre | +26° | 0.85 | 1.14 | #c57a2f |
| gold | +38° | 1.2 | 1.55 | #f3c459 |

With ground, the five night blues and star, these make the full sixteen-colour sprite palette. Every scene pixel is one of them, and gradients and light falloff are ordered-dithered (4×4 Bayer) between palette steps, never blended.

### Named Rules
**The Icon Red Rule.** The red is read from the icon's fill at build time and enters the page only as `--cinnabar-red`. Every red step is a `color-mix` from it, and every warm scene colour is a hue shift of it. Never type a red hex into a stylesheet, template or script.

**The One Power-Up Rule.** Red fills belong to one family: the stepped red key (the download, its mode key, the marketplace's "Add to Cinnabar") and the MOD cartridge tag that shares its material. Every other control is a neutral pixel box or an ink key. Elsewhere red appears only as small marks, such as a cursor, a lit pixel, a square bullet, the chart line, a frame edge or focus.

**The Gold Pixel Rule.** Gold is the top edge of a red key and nothing else.

## Typography

**Display Font:** none set in type. The logotype `/title.png` is the display object.
**Pixel Font:** Silkscreen 400/700 (with ui-monospace, monospace)
**Body Font:** Archivo variable (with system-ui, sans-serif)
**Mono Font:** JetBrains Mono 400 (with ui-monospace, monospace)

**Character:** Silkscreen is the cabinet's voice: blocky caps for the marquee, the score line and the menus. Archivo, wide and heavy for the tagline and plain for everything else, is the voice of a person explaining things. Pixel type names things and grotesk explains them.

### Hierarchy
- **Logotype** (`/title.png`, up to 720px wide on home, 520px on `/mod/`, 400px at the home closing): the name, always as the textured image, with a soft drop shadow so it sits over the scene.
- **Tagline** (Archivo 800, clamp(26px, 2.9vw, 40px), 1.08, width 112%, −0.02em): "A familiar world. A new client." under the logotype. The closing and `/mod/` versions run at 800 with widths of 108–112% and smaller clamps.
- **Section Title** (Silkscreen 700, 48px, 1; 32px at ≤900px): cabinet and section titles, uppercase, flanked by the title rule.
- **Stage Numeral** (Silkscreen 700, 64px, 0.82 on `/mod/`, 48px there on phones; 48px in the home install dialog, 32px there on phones): the oversized numbers of install stages, in Red Text.
- **Pixel Title** (Silkscreen 400–700, 24px): the WARNING title, module group names, fact titles, stage names, dialog titles and marketplace panel headings.
- **Score** (Silkscreen 700, 24px, tabular): the numbers in the score line.
- **Pixel Label** (Silkscreen 400, 16px, 1, uppercase): nav, score labels, key labels, chart axes, tabs, captions on frames, table headers and part titles in the book's sidebar.
- **Reading Headline** (Archivo 800, clamp(30px, 2.8vw, 38px), 1.08, width 108%): chapter titles in the book. Chapter h2s are Archivo 700 at 24px, opened by a dashed line-strong rule.
- **Body** (Archivo 400, 17px, 1.6): lead prose and stats. The book reads at 16px with a line height of 1.65–1.68 in a 64ch column, and the marketplace's markdown is capped at 64ch.
- **Body Compact** (Archivo 400, 16px, 1.55): the warning text, stage text and `/mod/` body.
- **Control** (Archivo 600, 16px, 1.2): platform keys and download options. Module slots use the same weight at 15px. Marketplace controls are Archivo 500 at 15px.
- **Mono** (JetBrains Mono 400, 14px, 1.5; 13.5px in code blocks): commands, code, version strings and counts.

### Named Rules
**The Grid Multiple Rule.** Silkscreen is set only at 16, 24, 32, 48 or 64px, the multiples of its 8px grid. It is always uppercase, with letter-spacing 0 and font smoothing switched off. On phones the nav keeps 16px and swaps to short labels rather than shrinking.

**The Prose Is Never Pixel Rule.** Sentences, descriptions, the warning, hints, captions that explain things, and all marketplace and book content are set in Archivo. Pixel caps carry names, numbers and short commands only.

**The Logotype Is the Display Rule.** The largest name on a page is always `/title.png`. Never set "Cinnabar" as a type headline or redraw the logotype.

## Layout

The page is a centred column of up to 1360px with a fluid gutter of clamp(16px, 4vw, 64px). Spacing follows whole steps of 2, 4, 8, 12, 16, 24, 32, 40, 48 and 64px, so every edge lands on the pixel grid. Touch and pointer targets are at least 44px.

- **Header** (64px): it floats transparent over the scene on home and `/mod/` and turns solid ground with a 2px line edge as it scrolls past (scroll-driven, at `--solid-at`, which is 100svh on home and 520px on `/mod/`). It is solid and sticky on the marketplace and fixed in the book.
- **Home attract screen**: a full-viewport hero (100svh) on a three-row grid with the HUD score line at the top, the logotype, tagline, edition line, PRESS START and the split key centred in the sky, and the WARNING panel at the fold. Below it come the high-score board in a cabinet frame, a twelve-column gallery (the large sunset spans eight columns and two rows, forest and PvP stack beside it, and cave and river share the last row), and a closing chamber at least 760px tall with platform keys.
- **`/mod/`**: a hero split 7fr/5fr between the logotype with its cartridge tag and the pitch with the split key. A CRT bezel showcase overlaps the hero's bottom edge by 136px. Below come a module select screen in two columns of groups, a paired settings and layout bezel row, three fact columns, and three stage cards.
- **Marketplace**: a 7/5 heading row, tabs, then a 220px filter rail beside the result list, a 7/5 project page, and a 220px, fluid, 300px editor.
- **Book**: a 288px sidebar beside a 64ch reading column. Below 1080px the sidebar becomes a drawer under the fixed header.
- **Section rhythm**: 136px between home sections (128px on `/mod/`) and 96px at 900px and below.
- **Breakpoints**: 1100px (the score line drops its average), 900px (everything stacks to one column and section titles drop to 32px), 640px (the score line becomes a two-column grid and the split key fills the width), and 480px (the nav switches to short labels, the brand word hides, the mode key shrinks to its chevron, and module slots go to two columns).
- **Scene scale**: the canvas covers its host at a native resolution of the host size ÷ the art scale, which is 4× at 1200px and up, 3× at 640px and up and 2× below, multiplied by the device pixel ratio and rounded to a whole number. Scanline pitch follows the same pixel through `--px`. On narrow screens the formation moves to the far edge, clear of the centred text, and the moon shrinks.

## Elevation & Depth

Depth comes from the world, not from surfaces. The scene parallaxes in layers, but interface boxes are flat faces with drawn edges. Shadows are limited to a few named jobs: text legibility over the scene, the bevel of a red key, the logotype and the two floating layers. No surface uses `backdrop-filter`, frosted glass or rounded elevation cards.

### Shadow Vocabulary
- **Pixel Text Drop** (`text-shadow: 0 2px var(--ground)`): pixel labels and the tagline over the scene, the sprite-text drop of the medium. Key labels drop onto Red Deep instead (`0 2px var(--red-deep)`).
- **Key Bevel** (`box-shadow: inset 0 2px var(--gold), inset 0 4px color-mix(in oklab, var(--cinnabar-red) 70%, var(--gold)), inset 0 -4px var(--red-press)`): the lit top edge and pressed-in base of the red key. On press, the base shade collapses and the key moves down 2px.
- **Logotype Drop** (`filter: drop-shadow(0 12px 18px #000000b3)`): it lifts `/title.png` off the scene.
- **Floating Layer** (`filter: drop-shadow(0 18px 24px #000c)` for the mode menu, `0 24px 32px #000c` for marketplace dialogs): the only soft shadows on interface boxes, used only for layers that float over content.
- **Phosphor Glow** (`text-shadow: 0 0 1px` ink at 55%, `0 0 10px` red at 60%, `0 0 26px` red at 28%): it applies only to pixel section titles marked `.glow`, and only while effects are on.

### The effects layer
- **Bloom**: a second canvas copies the scene and is drawn with `mix-blend-mode: screen; filter: contrast(2.4) brightness(.85) blur(10px); opacity: .6`.
- **Scanlines**: a repeating gradient with one dark row (Scanline colour) every native pixel over the scene, plus faint scan gaps (`#0000002e`, every 4px) over the chart screen only.

### Named Rules
**The Effects Stop at Prose Rule.** Scanlines, bloom and glow apply to the canvas, the chart screen and pixel titles. They never cover the warning, the tagline, captions, the book or the marketplace, and the book and marketplace have no effects layer at all.

**The Still Frame Rule.** With effects off, or under `prefers-reduced-motion`, the world settles on one still frame: tick zero, no embers, no glint sweep and no parallax, with PRESS START not blinking. The Effects switch defaults to off when reduced motion is set, remembers the visitor's choice in `localStorage`, and switches scanlines, bloom and glow together. Reduced motion stops the scene even if a visitor has turned the effects back on.

## Shapes

Every box is a pixel box with square corners. The rounded scale has a single value, zero. Corners are cut instead: each box loses two 2px steps at each corner, drawn either by a nine-slice SVG `border-image` (neutral boxes) or by a `clip-path` polygon (red keys, the warning frame, switches). Borders are 2px, or 4px where a box frame is drawn. Hairlines appear only as 1px code borders in the book. Icons, cursors, the trend arrow and the chevron are stepped polygons on the same 2px grid.

The frame vocabulary:
- **Box** (12px tile, slice 4): a Line Strong edge around a Raise face. This is the standard panel, button and code frame.
- **Box Hover** (slice 4): a Quiet edge around a Raise 2 face, for neutral boxes under the pointer.
- **Box Quiet** (slice 4): a Line edge around a Ground face, for the chart screen and the phone download note.
- **Box Select** (slice 4): an Ink edge around a Raise 2 face, for a module slot under the cursor.
- **Box Ink** (slice 4): a solid Ink box, for the copy key, the selected range and the chart tooltip.
- **Cabinet Frame** (24px tile, slice 10): a stepped Line Strong outer edge, a Ground body, a Frame Channel ring, a Raise face and a Quiet rivet at each inner corner. It frames the high-score board, gallery captures, CRT bezels and stage cards.

### Named Rules
**The Two-Step Corner Rule.** Corners are cut in whole 2px steps and never rounded. A `border-radius` above zero is outside the system.

## Components

### Buttons
The keys are tactile and arcade-literal. They press down by 2px, step through state changes (`steps(2, end)` over 0.12s) and never glide.
- **Power-Up Key (primary):** a red face inside a 2px Rim, stepped corners, the Key Bevel, Silkscreen 16px white caps over a Red Deep drop, 56px tall, padded 0 24px 4px. Hover lightens the face to Red Hover. Active moves the key down 2px and collapses the bevel. Focus draws a 2px Ink outline offset 2px, since red on red would vanish.
- **Split Key:** the download key and a separate mode key on one 4px-gapped panel. The mode key shows the chosen channel (BETA or NIGHTLY) and a chevron that flips when open. On phones it shrinks to the chevron alone.
- **Ink Key:** an inverted Ink box with Ground text, used for the main step of an operate flow (marketplace primary, Archivo 500 15px; the dialog's COPY key, Silkscreen 700 16px). Hover goes to pure white on the marketplace and brightens slightly elsewhere.
- **Pixel Box Key:** a Box frame with Soft pixel caps. Hover switches to Box Hover with Ink text, and the selected state (`aria-pressed`) switches to Box Ink with Ground text. It is used for the chart's 24H, 7D and 30D ranges.
- **Platform Key / Download Option:** a Box frame with Archivo 600 16px Ink text and a stepped download glyph in Quiet that turns Red Line on hover.
- **Quiet Operate Button:** a transparent face, a 2px Line Strong border, square corners, Archivo 500 15px and a height of 44px. Hover raises it to Raise 2 with a Quiet border.

### Mode Select (channel menu)
A Box-framed menu (340px) under the split key, with arrow-key and Escape support kept from the existing script. Each row is Silkscreen 16px caps with an Archivo 14px hint below. A pixel socket on the left shows a lit Red Line pixel for the chosen channel. Hovered and focused rows take Raise 2, and focus draws an inset 2px Red Line outline.

### Chips / Tags
Tags have square corners, a 2px Line Strong border and Archivo 500 13px Soft text. State tags carry a 6px square marker, Ink for good and Red Line for warning or error, rather than a colour fill.

### Cards / Containers
- **Corner Style:** stepped, via the frames in Shapes. Radius is 0.
- **Background:** a Raise face drawn by the frame itself (`border-image … fill`). The CSS background stays `none`.
- **Shadow Strategy:** flat. See Elevation & Depth.
- **Panels:** the marketplace sideboxes, preview cards, verdicts, queues, notices, code blocks and dialogs, plus the book's code, tables, quotes and warnings, all use the Box frame. Notices and warnings carry an 8px Red Line square at the top left.
- **Cabinet:** the high-score board, inside the riveted Cabinet Frame, padded 40px 48px 28px (28px 18px 20px on phones).
- **Internal Padding:** 24px in standard panels, 32px in dialogs.

### Inputs / Fields
- **Style:** a Ground face, a 2px Line Strong border, square corners, 48px tall, padded 12px 14px, Archivo 16px. The caret is Red Line on the home page and Red Text in the marketplace.
- **Focus:** a 2px Red Line outline offset 2px. Hover moves the border to Quiet.
- **Error:** the border turns Red Line, with a Red Text message below in Archivo 14px.

### Navigation
- **Header:** the brand mark (28px icon) and the word CINNABAR in Silkscreen 700 16px, followed by nav links in Silkscreen 400 16px Soft caps, 44px targets and GitHub and Discord marks as 44px square icon links. Hover applies Hover Wash with Ink text.
- **Current page:** the arcade menu cursor, a 6×10 stepped triangle in Red Line, sits left of an Ink label. The book's sidebar and the marketplace review queue reuse the same cursor.
- **Phone (≤480px):** the brand word hides, "Official Mod" becomes "Mod" and "Marketplace" becomes "Mods". The visible text is always the link's accessible name.
- **Tabs (marketplace):** Silkscreen 16px caps with a 4px Red Line rule under the current tab.

### Score Line (signature)
The cabinet's HUD runs along the top of the home hero above a 2px dashed white-12% rule. Labels are Silkscreen 16px Quiet and values are Silkscreen 700 24px Ink with tabular figures. Online carries an 8px Red Line square and a stepped trend arrow (Red Line up, Quiet down) that compares the current count with the 24-hour average. Values only mirror what the shared scripts wrote, and missing data shows `--` in Quiet. The Effects switch sits at the right end.

### Title Rule (signature)
Section titles sit between two pixel lines: a 2px Line Strong line ending in an 8px Red Line block on each side. On phones the lines run full width above and below a wrapped title. Section titles on home and `/mod/` also carry the Phosphor Glow.

### High-Score Chart (signature)
The player chart, redrawn by `arcade-chart.js` over `history.js`, keeps its data, ranges, keyboard support and readout. Lines are snapped to a 4px grid as horizontal-then-vertical runs: a 2px Red Line stroke with square caps and a 2×2 checker dither under the line in red mixed 55% with Ground. Gridlines are dotted 2px Line Strong. The inspected sample is an 8px Ink square, and its readout appears in a Box Ink tooltip (Archivo 600 14px, tabular) that flips to the left near the right edge.

### Select Screen (signature, `/mod/`)
The 39-module catalog is a character-select board. Groups have Silkscreen 24px headings with a dashed rule and a Quiet count. Each module is a slot in a Box frame, at least 60px tall, with Archivo 600 15px names. On hover-capable devices the slot under the pointer gets the Box Select ink frame and a Red Line cursor on its right. When nothing is hovered, the first HUD slot holds the selection. On phones the slots go to two columns and the cursor is dropped.

### CRT Bezel and Gallery Frame
Captures sit inside the Cabinet Frame. On `/mod/` the bezel adds a black 2px screen edge, a 44px chin with a Silkscreen nameplate (Quiet) and an 8px Red Line power light. Each capture links to its full-size file (zoom-in cursor) and is never filtered or recoloured.

### Warning Panel
The attract-mode WARNING screen is a Red Line stepped frame around a Warning Face. A Red Text Silkscreen 700 24px title with a stepped warning glyph sits beside Archivo 16px Ink prose. It never blinks and never sits under effects.

### Stage Cards
Install steps are numbered stages. Each has a Red Text Silkscreen 700 64px numeral with the word STAGE in Quiet 16px caps beneath it, and a Silkscreen 24px step name above Archivo prose. On `/mod/` they are three Cabinet Frame cards. In the home install dialog they form a 56px numeral column.

### Effects Switch
A 28×16 stepped track in Line Strong with an 8px Quiet knob reads EFFECTS ON or OFF in Silkscreen caps. When on, the track turns Red Press and the knob moves right in Ink. It sets `aria-pressed`.

## Do's and Don'ts

### Do:
- **Do** read the red from the icon through `@@RED@@` and `--cinnabar-red`, and derive every other red with `color-mix` from it.
- **Do** use `/title.png` as the largest name on any Persuade surface.
- **Do** draw new pixel art in code from the sixteen-colour palette, at whole-pixel scale with `image-rendering: pixelated`, and dither between palette steps rather than blending.
- **Do** frame panels with the nine-slice pixel boxes and cut corners in 2px steps; keep `border-radius` at 0.
- **Do** set Silkscreen only at 16, 24, 32, 48 or 64px, uppercase, with smoothing off.
- **Do** put new red actions in the power-up key family, and use the Ink Key or Pixel Box Key for everything else.
- **Do** mark current or selected items with the 6×10 Red Line menu cursor.
- **Do** show live numbers only from the real API, and show `--` in Quiet when they are missing.
- **Do** keep the Effects switch visible wherever a scene runs, and freeze to a still frame under reduced motion.
- **Do** keep targets at 44px or more and focus rings at 2px Red Line, or Ink on red keys.

### Don't:
- **Don't** hardcode a red hex anywhere in the site's code.
- **Don't** set prose, descriptions, warnings, hints or book and marketplace content in pixel type.
- **Don't** apply scanlines, bloom or glow over prose, or add an effects layer to the book or the marketplace.
- **Don't** imitate the Minecraft font or Mojang UI textures, or ship Mojang assets. The game appears only in the owner's captures.
- **Don't** filter, tint or crop captures into decoration. They sit unaltered in frames and bezels.
- **Don't** ship generated or stock rasters for the world. The scenes are drawn at runtime.
- **Don't** use frosted glass, `backdrop-filter`, rounded corners or soft elevation cards for interface boxes.
- **Don't** make the WARNING panel blink or hide it below decorative content.
- **Don't** use gold anywhere except the top edge of a red key.
- **Don't** let world motion glide. The scene ticks at 12fps in whole pixels, Persuade-surface state changes and dialog reveals step (`steps()`), and only the marketplace's and book's standard controls keep their short 0.12–0.15s ease-out colour fades.
