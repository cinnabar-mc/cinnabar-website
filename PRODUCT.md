# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Minecraft: Bedrock Edition players of every kind, on Windows, macOS, Linux and Android, who have heard of Cinnabar and want to get it onto their device. Secondary: players who already run Cinnabar and want the Official Mod or community mods, mod authors reading the modding book or publishing to the marketplace, and staff who review marketplace releases.

## Product Purpose

The website gets Cinnabar and its Official Mod onto a player's device and shows that real people are using it. Success is a visitor finding the correct download for their platform and channel, understanding the risk before playing on servers, and, for authors, finding the modding docs.

## Positioning

Cinnabar is an independent, unofficial Minecraft: Bedrock Edition client written from scratch. Site tagline: "A familiar world. A new client."

## Operating Context

Static pages served from a Cloudflare static-assets Worker. Live aggregates come from the public Cinnabar API: people online now, unique users, release downloads and player history. Polling pauses in hidden or unattended tabs. The docs are an mdBook build of the client repository's `docs/modding`, restyled by this repository without changing its source.

## Capabilities and Constraints

- Home carries only its existing content: the logo, tagline, edition line, platform-aware download with a Beta/Nightly channel choice, install dialogs (Linux command, macOS architecture and first-open guidance, all-platform list), download total, server-risk warning, online and unique counts, and the player history chart with its 24h/7d/30d ranges. The owner confirmed this redesign adds no new product claims to the home page.
- `/mod/` carries its existing content: the anonymous WASM download, 39-module catalog, settings and HUD Layout, profiles, waypoints, autosave, three-step install, Discord help.
- `/mods/` is the community mod marketplace: browsing, project pages, per-account libraries the client downloads from, a creator editor, and staff review, report, role and audit screens. The default build targets the separate Cinnabar API; an explicit mock build is a clearly labelled preview with sample data. Runtime grants, compatibility and installation stay client responsibilities, and the site never invents a scan or review pass.
- `/docs/modding/` is a generated book. Chapter text is upstream; the site owns its theme and shared header.
- Release filenames, API origin, branding and the book come from the client repository through `source.json`. There is no build step beyond `render.py`, and no framework.

## Brand Commitments

- Name: Cinnabar. Mark: `packaging/icons/cinnabar.svg` (a red isometric block). Logotype: `assets/branding/title.png` (textured cinnabar-ore block letters).
- The brand red comes from the icon's fill, not a website constant.
- The site must say it is not affiliated with Mojang or Microsoft, and must keep the anticheat and server-ban warning prominent.
- The website does not bundle Mojang assets. Its screenshots are the owner's captures of Cinnabar.

## Evidence on Hand

- Live API aggregates (real, never to be simulated on the production page).
- `assets/mod/*.webp`: three captures of the released mod.
- `assets/gameplay/`: gameplay captures from the client README, approved for site use by the owner.
- No benchmarks, testimonials, press or pricing exist on the site. Do not invent them. Performance claims are not on the home page.

## Product Principles

1. The right download for this device comes first; everything else supports it.
2. Numbers shown are real and honestly labelled; missing data looks missing.
3. Say the risk plainly, before someone is banned.
4. It is a game: the page should look like someone who plays built it.

## Accessibility & Inclusion

Keep the existing keyboard support: the channel menu's arrow keys and Escape, chart inspection with arrows and Home/End, focus-visible states and 44px targets. Keep reduced-motion respect in any motion added.
