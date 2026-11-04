# Cinnabar website

The official Cinnabar landing page, deployed as a Cloudflare static-assets Worker.
Client releases and downloads remain in [cinnabar-mc/cinnabar](https://github.com/cinnabar-mc/cinnabar).
The site was extracted from that repository at
[`e33610ed`](https://github.com/cinnabar-mc/cinnabar/tree/e33610ed1b24d9a219d7e4a93936bd9c72a3b1fd/website)
and retains its [PolyForm Noncommercial license](LICENSE).

## Build and test

Requires Python 3.11+, Node.js 22+, npm, Git, and the pinned mdBook binary. No Rust or
 game assets are needed.

```sh
npm ci
python3 mdbook.py
python3 source.py fetch
python3 render.py
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

`dist/` contains generated files. `source.json` pins a full client commit and
names the release manifest, API contract, branding and modding book used by the renderer.
`source.py fetch` materializes only those files and directories in the ignored `.source/` checkout.
To render against another local client checkout, use `python3 render.py --source PATH`.

`mdbook.py` downloads mdBook 0.5.4 from its release archives, verifies the pinned
SHA-256 for the current platform, and installs it in the ignored `.tools/` directory.
Both build workflows use the same installer. It supports Linux and macOS on
x86-64 and ARM64. The renderer builds the book at `dist/docs/modding/`, applying
the website's `docs-theme/` overrides to a temporary copy of the book.

The landing page and book share `site-header.html.in` and `site-header.css`.
The book places its sidebar and search controls in that header row, marks Docs
as the current page, and uses a dark theme without theme or print controls.
Sidebar chapter numbers are disabled; upstream chapter titles are preserved.

The hourly Update client inputs workflow checks the client's `dev` branch. It
opens a tested PR changing the pin only when one of the declared inputs changes;
unrelated client commits leave the pin alone. One input-update PR stays open at a
time. After the Website workflow verifies the exact branch head, the Merge client
inputs workflow squash-merges same-repository automation PRs targeting `main` that
modify only `source.json`. It dispatches Website on `main` to deploy the merged
pin, then deletes the automation branch. Human PRs keep their usual review path.
To check manually:

```sh
python3 mdbook.py
python3 source.py update
python3 render.py
```

## Deploy

The Website workflow tests every PR and validates the pinned Wrangler version
with a dry run. Pushes to `main` deploy after verification; manual dispatch deploys
only when run on `main`. The workflow follows redirects and byte-compares every
published file with the build. Other branches can validate without deploying.

The `website` GitHub environment supplies the `CLOUDFLARE_API_TOKEN` secret and
`CLOUDFLARE_ACCOUNT_ID` variable. `wrangler.jsonc` identifies the existing Worker
and account, serves `dist/` without a Worker script, and disables request logs.
The input-update workflow needs Actions permission to create pull requests and
dispatch the Website workflow, because token-created PRs do not trigger CI.

The `RestartFU/configurations` repository owns the custom domain's Caddy proxy.
It forwards requests to the Worker over HTTPS while preserving the public domain,
path and query string. Moving this repository does not require a hosting or DNS
change. The workflow's `WEBSITE_URL` selects the post-deploy verification target.

Static assets use `auto-trailing-slash`: `/docs/modding/` serves the book's
`index.html`, and nested chapter paths serve their matching HTML files. Requests
for `.html` pages redirect to the clean URL. With `404-page`, missing book paths
return the book's generated `404.html` with status 404; other missing paths return
a normal 404. No route falls back to the landing page.

## Official Mod

`/mod/` introduces the official HUD and module pack: its module list, settings,
HUD Layout, profiles and import steps. The download button uses the shared API origin
and the anonymous `/v1/mod/download` endpoint. The home page, mod page and book
share the same navigation, with the current destination marked on each page.

`assets/mod/` holds three in-game screenshots of the released mod in a
local world, taken at 1920×1080 and saved as WebP: the Mods menu (`mods.webp`), Keystrokes settings
(`settings.webp`), both cropped to 16:9 around the menu, and HUD Layout
(`layout.webp`). Retake them, and update the module
list in `mod.html.in`, when the mod's catalog or menu changes.

## Player presence

The activity section also shows unique Cinnabar users since tracking began, from
`GET /v1/users/count` (`{"unique":0}`). This counts verified accounts once across
reconnects and devices, including accounts with presence visibility off. The API
retains salted account digests and publishes only the total. Tracking starts at
API deployment with no historical backfill; existing sessions count on their next
successful login. Deploy that endpoint before the website to enable this count.
It polls independently every ten minutes with the same timeout, failure and
attention handling as the online count; a missing endpoint leaves just this count empty.

The player activity section shows unique connected, visible Cinnabar accounts
from `GET /v1/presence/count`. The API origin comes from the shared bridge contract.
It refreshes once per minute while the page is attended, bypassing the browser cache,
with a five-second request timeout. Failed or invalid responses clear the count.
Deploy the API endpoint before the website to enable the count.

Every API poll invokes the `cinnabar-api` Worker, even when its edge cache answers,
and counts toward the account's daily Workers request limit. `activity.js` therefore
pauses all polling, clearing the live counts, in hidden tabs and in visible tabs
without pointer, keyboard, scroll or focus input for ten minutes. The next input or
return to the tab refreshes everything at once, cancelling any request still in
flight so its late failure cannot delay the fresh count. An attended page makes about 1.4
requests per minute; an unattended one makes none.

The player chart reads `GET /v1/presence/history?range=24h|7d|30d` from the same
origin. The API collects one anonymous count per minute independently of website
visits. The 7-day and 30-day views show ten-minute and hourly averages, with peaks
and averages calculated from observed minutes only. Missing buckets appear as
gaps; recorded zeroes sit on the baseline. History starts when the API collector
is deployed, without backfilled estimates.

The chart refreshes every five minutes while attended and bypasses the browser cache
on each request. The API's shared cache still limits upstream reads to once per
minute. Range changes cancel older requests; empty history and errors have
explicit messages. Hover or touch the plot to inspect a sample, or focus it and
use the arrow, Home and End keys.

## Mod marketplace

Open `/mods/` for category/search discovery, descriptions and galleries, an
account-specific library and creator draft, component checks, and staff review,
reports, role and audit screens. `/marketplace/` serves the same hash application
for existing preview links. Both pages share the download site's header.

The normal build selects `marketplace.backend = "http"` and uses the API origin
from the pinned bridge contract. Deploy/configure the marketplace API before
merging this website rollout. Failed requests show recovery controls and never
fall back to fictional data. For a labelled local preview, run
`python3 render.py --marketplace-backend mock`; sample accounts appear only there.

The HTTP adapter uses Microsoft sign-in, credentials, CSRF and multipart component
and image uploads. Captions, alt text, descriptions, category, license and release
notes are versioned by the API. Prepared raster derivatives are uploaded as files;
pending screenshots use authenticated creator/staff routes. Drafts stay local and
do not retain component bytes: reselect the file after reloading.

Your projects and the review workspace refresh server scan/publication states every
ten seconds while visible. Staff notes survive refreshes and failed requests.
Approval requires the API's current readiness result; AI flags require an explanation.
Staff can request rescans and administrators can manage project-specific creator
trust. The server authorizes every action and publishes eligible established updates.
Library removal works for public and unavailable selections, matching the exact
saved hash and send timestamp. Installed mods are managed in Cinnabar.
See [docs/marketplace.md](docs/marketplace.md)
for integration, local verification and rollout requirements.

Permission labels/types come from the pinned client's `grants.rs` through
`source.json`. Command diffs include exact added/removed values; unsupported
new field types fail the build. A disposable worker uses pinned Jco/Wasmtime
component parsing to validate structure/types and nested guest bytecode without
instantiating uploaded code. A timeout or parser failure blocks submission.
These are browser preflight checks, not a server authorization or malware verdict.
The API must independently validate uploaded bytes. The validator is bundled by
`render.py` into ignored `dist/validator/` and lazily fetched during file checks.
Its license is retained; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
## Release downloads

The line below the download button reads `GET /v1/downloads/count`
(`{"downloads":0}`) from the shared API origin and links to the client release page.
It counts installer and automatic update packages across published versioned
releases and the current nightly, including repeat downloads. Update manifests,
checksums and support files are excluded. Deleted or replaced assets cannot be
counted, so this is neither a lifetime total nor a unique-user count.

The website refreshes every fifteen minutes while attended, matching the API's
GitHub snapshot, with a five-second timeout.
Unavailable or invalid totals leave the line empty without affecting downloads or
player activity. The API shares a fifteen-minute GitHub snapshot plus a five-minute
edge cache. Deploy the API endpoint before the website to enable the count.
