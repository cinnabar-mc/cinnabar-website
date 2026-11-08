# Marketplace implementation boundary

The website combines category/library workflows with permission-aware review and
an HTTP adapter targeting the real API by default. An explicit
`render.py --marketplace-backend mock` build retains the labelled local preview. The
canonical entry is `/mods/`; `/marketplace/` serves the same hash application.
No SPA fallback or dynamic Worker is required.

## Website behavior

- The project editor labels every field Required or Optional. Name, summary,
  version and a valid release component are required; distribution rights must be
  confirmed before submission. Description, category, license, source repository,
  release notes are optional. A source repository
  is optional at every permission level; when supplied it must be a GitHub URL.
  Source uses a text input with a URL keyboard hint; all editor validation is inline.
  Publishing identity is always the website username.
- Project address is optional. Blank addresses use the name lowercased, with runs
  outside ASCII letters/digits replaced by one dash, trimmed and limited to 40
  characters (trailing dashes are removed again after truncation). If fewer than
  three characters remain, choose an address. Reserved addresses are rejected.
  The preview shows the listing's `/mods/#/mod/<address>` route. Continuing a step
  validates that step; submission validates all steps. Client and API field
  errors appear beside the controls and focus the first invalid field.

- Live sign-in uses a Cinnabar account through Google. The provider is named on the
  sign-in control; additional providers can be added alongside it later. Signed-in
  controls show the username, quieter email, staff role when applicable, Sign
  out and Link Xbox / Xbox linked. The explicit mock build keeps its persona
  chooser, including an unlinked New player account and a labelled simulated
  in-game linking action.
- Xbox is a separate delivery identity. An unlinked account can browse, publish
  and keep a library and local drafts. Add to Cinnabar opens the linking panel
  before sending; the API's unlinked-account 409 also opens it. Linking does not
  automatically send the previously selected mod: choose Add to Cinnabar again.
- The linking panel explains that mods go to the linked Xbox account. Get link
  code displays a selectable monospace code, Copy code and a wall-clock expiry
  countdown. In Cinnabar, open Settings → Account → Link website account and enter
  this code. Expired codes cannot be copied; request a new one. Clipboard failures
  leave the code available to copy manually.
- While the panel is open and visible, `/me` refreshes every three seconds to
  detect the link and show the gamertag. Closing the panel, Escape, page exit or
  hiding the tab stops its timers; stale poll responses cannot update the session.
  Returning to a visible tab resumes polling and updates the expiry immediately.
  Unlink requires an explicit confirmation and retains the Cinnabar account,
  library and local drafts. Account changes close the panel and discard its code.

- Compact catalogue rows show each mod's creator, summary, category and version.
  Project pages keep the install action prominent, with expandable permissions
  and dedicated overview, version and permission tabs.
- Search/filter state survives a project visit. The library belongs to the chosen
  account; unavailable selections remain visible and removable in both backends.
  Adding a mod never grants runtime permissions or installs code.
- Library removal sends the displayed selection's hash and send timestamp. A stale
  selection refreshes before another attempt; errors leave removal retryable.
  Opening the library refreshes its account and selections. Pending removals cannot
  replace a later route or account. Installed mods are managed in Cinnabar.
- Descriptions support Markdown headings, lists, emphasis, code and HTTPS links,
  rendered as DOM nodes. Creator HTML is plain text. The editor keeps a Markdown
  hint below Description without a separate preview button.
- Project → Release → Checks & publish keeps a browser-local draft per Cinnabar
  account ID, independent of Xbox linking or gamertag changes. Old draft galleries
  are ignored and dropped on save. The editor has no screenshot uploads; existing
  API galleries still display on mod pages. Component bytes are never saved in
  browser storage.
- Listing icons come from a single top-level `cinnabar:extension/icon@1` section.
  A PNG must decode completely, fit within 256 KiB and have nonzero dimensions no
  larger than 256 px on either side. Missing, duplicate or invalid icons leave the
  category placeholder. The release preview uses the extracted icon; catalog,
  library, detail and staff rows use safe API `icon` URLs. Icons fit within a square
  with their aspect ratio preserved and nearest-neighbour scaling.
- Checks & publish explains upload and review in plain language, requires permission
  to share the mod, and shows a local-preview notice only in mock mode.
- Strict metadata checks enforce the whole component header, known section IDs,
  section-local bounds, bounded u32 lengths, UTF-8 and unique declarations/grants.
  The pinned Jco parser checks component structure/types and guest bytecode in a
  disposable worker with a 20-second deadline. Generated guest bindings are never
  imported or evaluated. New selections and account changes cancel stale checks.
- Review diffs show exact command additions/removals. An older API's name-only
  diff cannot authorize a command-bearing update: approval is disabled until it
  supplies previous grants or a value-level diff. No AI results are fabricated.
- Pending project metadata is versioned by the API and cannot change public
  descriptions or images before publication. The preview simulates this behavior.
- Creator releases show queued/running/failed scans, AI flags, staff review,
  interrupted publication and signed manual/automatic publication states. Creator
  and review workspaces refresh every ten seconds while visible and cancel timers
  on navigation. Refresh failures preserve review notes; session expiry removes
  staff controls. A manual Refresh status action is always available there.
- Review controls require the server's `scan.review_ready` result and complete
  scan evidence. AI flags need an explanatory note. Staff can rescan a pending
  release; admins can establish/revoke project trust with an audit reason.

## Service contract

The HTTP adapter uses the existing `/v1` routes: `/me`, `/me/mods`, `/mods`,
`/mods/:slug`, `/mods/:slug/send`, `/mods/:slug/remove`, reports, `/submissions`,
`/auth/*` and `/staff/*`.
It includes the host session cookie, repeats `/me`'s CSRF token on writes and sends
release bytes as multipart forms. The API must derive identity, hashes, requested
grants and publication authorization from trusted state and actual uploaded bytes.

Sign-in navigates to `{api}/v1/auth/google/start?return_to=<current URL>`,
including the current hash route. The API returns to that URL and may add
`signin_error=<code>`. The website selects messages with `Object.hasOwn`; unknown
codes (including `__proto__`) use inert generic error text.

`GET /v1/me` returns `{account, library, csrf, game_online}`. `account` is null or
`{id, username, email, role, suspended, xbox}`, where `xbox` is null or
`{xuid, gamertag}`. Draft keys, ownership checks, review-note keys, approval
identities and stale-response guards use the Cinnabar `id`, never the Xbox XUID.
A null username opens a dismissible chooser once per browser session. Usernames are
public, permanent, and required before publishing or reviewing.
`POST /v1/me/username` sends `{username}` with credentials and CSRF and returns
the full `/v1/me` envelope. Use 3–16 ASCII letters, digits or underscores;
the API checks reserved names and availability.
Staff records and approvals show `username`; role changes send `username`.

`POST /v1/me/xbox/link-code` uses credentials and CSRF and returns
`{code, expires_in}` (seconds). `POST /v1/me/xbox/unlink` uses the same protections
and returns 204 with no JSON body. Linking completes in the game, not in a browser
provider flow. `POST /v1/mods/:slug/send` returns 409 with
`{error: "Link your Xbox account in Cinnabar first."}` if Xbox is not linked.
The website does not persist link codes in browser storage.

Multipart submissions contain only `listing` and one component `file`. The icon
travels inside the component; no images or image metadata are sent. Descriptions
allow 40,000 characters; category, license and release notes are saved with the
release. Failed uploads retain the draft and selected component for retry.
API `icon: string | null` is accepted on listing summaries, details and version
views; relative URLs resolve against the API base and use the same HTTPS and
credential-free URL policy as other API media. Private views load with credentials.

Public gallery URLs derive from `/mods/media/<sha256>`. Pending images use
`/me/mods/<id>/media/<sha256>` with credentials and exact origin CORS; only the
creator and active staff may read them. API-provided URL strings do not override
the digest-derived route. Staff download the exact artifact from
`/staff/versions/<id>/file`. Scan findings are inert text, and public summaries omit
private scanner evidence. Automatic publication is reported only after the API
marks the release approved. Local roles never authorize a write.

`POST /mods/:slug/remove` sends `{sha256, sent_at}` from `/me`'s saved selection.
The API requires the browser session and CSRF token, scopes deletion to that
account, and notifies its connected clients. A 409 refreshes a changed selection
without deleting a newer send. Hidden and pulled releases remain removable.
Drafts are local, including in HTTP mode, and are not presented as server-synced state.

Client capability descriptors are generated through `source.json`. Website reach
groups are presentation/review categories. The client `sensitive` flag describes
gameplay effects, not a malware rating. Unknown grant names are rejected; new
known descriptors without a website group use the most restrictive group. New
client value types fail the build rather than silently becoming booleans.

## Required before production enablement

1. Deploy the parallel Cinnabar account API change before this website: Google
   OAuth, the new `/me` shape with opaque IDs, code issuance/game redemption,
   unlink and send-without-link 409 behavior. Test bound OAuth state, exact
   redirect/origin allowlists, Secure HttpOnly cookies, CSRF, role revocation,
   account-switch isolation and Xbox linking on the real site/API/game domains.
2. Merge and deploy [the API implementation](https://github.com/cinnabar-mc/cinnabar-api/pull/32)
   before deploying this website. Provision the private artifact bucket,
   the separate scanner and its limited credentials, signing and Google OAuth secrets.
   The API owns static validation, raster decoding, bounded AI triage, trust,
   signed publication and recovery. Browser checks can be bypassed.
3. Verify scanner failures, expired evidence, trust revocation and interrupted
   promotions against the deployed API. Missing/failed/timed-out checks must hold
   publication. AI cannot override deterministic blocks or establish creator trust.
4. Verify same-site private image cookies, caption/alt text, real artifact uploads
   and polling on the deployed site/API domains. No scanner or signing credentials
   belong in the browser or website configuration.
5. The client verifies signed manifests/hashes, compatibility and exact permission
   consent, installs atomically and honors signed revocations with a documented
   offline/freshness policy.

This change wires the UI to the API; it does not deploy infrastructure or certify
mods as safe. The scanner uses static evidence and AI triage, with no guest-code
execution or full source audit. Website secrets stay in GitHub's `website`
environment; only `main` deploys. Use an explicit mock build for local design demos.

## Regression coverage

Run the README commands after changes. Security fixtures cover malformed framing,
duplicate/escaped keys, command expansion, full type/bytecode validation, a start
that must never run, inert Markdown/media, private pending metadata and removable
unavailable entries. Controller tests cover focus/search retention, identity-scoped
drafts/libraries, stale file checks, server scan gates, AI flag notes, status polling,
session expiry and upload recovery. HTTP tests assert multipart bytes/metadata,
digest-derived private/public gallery routes, Google return URLs, credentialed
link writes, empty unlink responses and CSRF cleanup. Account UI tests cover
prototype-safe sign-in errors, code/countdown/copy, poll pause and cancellation,
confirmed unlink, send interception and ID-keyed drafts with and without Xbox.
Renderer tests assert a live default, an explicit mock override and generated client descriptors.
