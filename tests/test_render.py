"""Check the standalone site's build and GitHub download contract."""

from html.parser import HTMLParser
import importlib.util
import json
from pathlib import Path
import re
import shutil
import tempfile
import unittest
from urllib.parse import urlsplit


SITE = Path(__file__).resolve().parents[1]
SOURCE = SITE / ".source"
SPEC = importlib.util.spec_from_file_location("site_render", SITE / "render.py")
RENDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RENDER)


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []
        self.downloads = []
        self.repository = None
        self.elements = []
        self.ancestors = []

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        self.elements.append((tag, attrs, self.ancestors.copy()))
        if tag == "script":
            self.scripts.append(attrs)
        if tag == "a" and "data-release-asset" in attrs:
            self.downloads.append(attrs["data-release-asset"])
        if tag == "a" and attrs.get("class") == "github":
            self.repository = attrs["href"]
        if tag not in {"meta", "link", "img", "input", "br"}:
            self.ancestors.append((tag, attrs))

    def handle_endtag(self, tag):
        """Track enclosing regions so tests can check reading and grouping order."""
        for index in range(len(self.ancestors) - 1, -1, -1):
            if self.ancestors[index][0] == tag:
                del self.ancestors[index:]
                break


class RenderTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.repository = self.root / "source"
        self.output = self.root / "candidate"
        self.config = json.loads((SOURCE / RENDER.INPUTS["release_manifest"]).read_text(encoding="utf-8"))
        self.config["repository"] = "fixture/download-contract"
        self.config["website"] = "https://unrelated-site.invalid"
        self.config["install_script"] = "fixture-" + self.config["install_script"]
        self.config["assets"] = {
            platform: {arch: "fixture-" + name for arch, name in arches.items()}
            for platform, arches in self.config["assets"].items()
        }
        self.config["manual_assets"] = {
            platform: {arch: "fixture-" + name for arch, name in arches.items()}
            for platform, arches in self.config["manual_assets"].items()
        }
        for path in (RENDER.INPUTS["icon"], RENDER.INPUTS["title"], RENDER.INPUTS["discord_mark"], RENDER.INPUTS["mod_grants"]):
            target = self.repository / path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(SOURCE / path, target)
        manifest = self.repository / RENDER.INPUTS["release_manifest"]
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text(json.dumps(self.config))
        contract = self.repository / RENDER.INPUTS["api_contract"]
        contract.parent.mkdir(parents=True, exist_ok=True)
        contract.write_text(json.dumps({"constants": [{
            "rust_name": "CINNABAR_API_BASE_URL", "value": "https://fixture-api.invalid/",
        }]}))
        shutil.copytree(SITE / "tests/fixtures/modding", self.repository / RENDER.INPUTS["modding"])

    def config_from_output(self):
        script = (self.output / "downloads.js").read_text(encoding="utf-8")
        return json.loads(script.removeprefix("window.CINNABAR_DOWNLOADS = ").removesuffix(";\n"))

    def test_discord_mark_uses_shared_client_branding(self):
        (self.repository / RENDER.INPUTS["discord_mark"]).write_text("M0 0L1 1Z\n")
        RENDER.build(self.repository, self.output)
        self.assertIn('<path d="M0 0L1 1Z"', (self.output / "index.html").read_text(encoding="utf-8"))

    def test_download_guidance_and_player_activity_stay_grouped(self):
        """Keep social navigation separate and presence inside its history region."""
        RENDER.build(self.repository, self.output)
        page = Page()
        page.feed((self.output / "index.html").read_text(encoding="utf-8"))
        positions = {}
        for index, (tag, attrs, ancestors) in enumerate(page.elements):
            if attrs.get("class") in {"github", "discord"}:
                self.assertIn("header", [parent for parent, _ in ancestors])
                self.assertNotIn("main", [parent for parent, _ in ancestors])
            key = attrs.get("id") or attrs.get("class")
            if key in {"download", "download-count", "disclaimer", "online-count", "unique-count", "history-plot"}:
                positions[key] = index
                if key in {"download", "download-count", "disclaimer"}:
                    self.assertTrue(any(parent.get("class") == "hero" for _, parent in ancestors))
                else:
                    self.assertTrue(any(parent.get("aria-labelledby") == "history-title"
                                        for _, parent in ancestors))
        self.assertEqual(sorted(positions, key=positions.get),
                         ["download", "download-count", "disclaimer", "online-count", "unique-count", "history-plot"])

    def test_build_uses_declared_inputs_and_redirects_to_release_assets(self):
        RENDER.build(self.repository, self.output)
        config = self.config_from_output()
        self.assertEqual(config["online_count_url"], "https://fixture-api.invalid/v1/presence/count")
        self.assertEqual(config["unique_count_url"], "https://fixture-api.invalid/v1/users/count")
        self.assertEqual(config["download_count_url"], "https://fixture-api.invalid/v1/downloads/count")
        self.assertEqual(config["online_history_url"], "https://fixture-api.invalid/v1/presence/history")
        self.assertEqual(config["assets"], self.config["assets"])
        self.assertEqual(config["manual_assets"], self.config["manual_assets"])
        release = urlsplit(config["release_url"])
        self.assertEqual(release.scheme, "https")
        self.assertEqual(release.path, f'/{self.config["repository"]}/releases/latest')
        self.assertEqual(config["download_base"], config["release_url"] + "/download/")
        self.assertEqual(config["install_command"],
                         f'curl -fsSL {config["download_base"]}{self.config["install_script"]} | sh')
        self.assertNotIn(self.config["website"], config["install_command"])
        self.assertEqual(config["nightly_base"],
                         f'https://github.com/{self.config["repository"]}/releases/download/nightly/')
        self.assertEqual(config["nightly_install_command"], config["install_command"] + " -s -- --channel nightly")
        self.assertEqual({path.name for path in self.output.iterdir()}, {
            "index.html", "downloads.js", "app.js", "activity.js", "presence.js", "history.js", "download-count.js", "title.png", "texture.svg", "docs", "mod", "assets",
            "mods", "marketplace", "marketplace.css", "marketplace-capabilities.js",
            "marketplace-core.js", "marketplace-mock.js", "marketplace-http.js", "marketplace-content.js",
            "marketplace-validation.js", "marketplace.js", "validator",
            "arcade-scene.js", "arcade-ui.js", "arcade-chart.js",
        })
        self.assertFalse((self.output / self.config["install_script"]).exists())

    def test_official_mod_page_download_and_shared_navigation(self):
        """Keep the pack reachable and use the configured API for anonymous downloads."""
        RENDER.build(self.repository, self.output)
        mod_html = (self.output / "mod/index.html").read_text(encoding="utf-8")
        self.assertNotIn("@@", mod_html)
        mod_page = Page()
        mod_page.feed(mod_html)
        downloads = [attrs for tag, attrs, _ in mod_page.elements
                     if tag == "a" and attrs.get("class") == "download"]
        self.assertEqual([item["href"] for item in downloads],
                         ["https://fixture-api.invalid/v1/mod/download?channel=beta"])
        self.assertEqual(downloads[0]["data-mod-download"],
                         "https://fixture-api.invalid/v1/mod/download")
        options = [attrs for tag, attrs, _ in mod_page.elements
                   if tag == "button" and attrs.get("role") == "menuitemradio"]
        self.assertEqual([(item["data-channel"], item["aria-checked"]) for item in options],
                         [("beta", "true"), ("nightly", "false")])
        self.assertIn("Beta<span class=\"hint\">Recommended</span>", mod_html)
        self.assertIn("Nightly (Unstable)<span class=\"hint\">Built daily from dev and may break.</span>", mod_html)
        self.assertEqual([script for script in mod_page.scripts if "src" in script],
                         [{"src": "/app.js", "defer": None}, {"src": "/arcade-ui.js", "defer": None},
                          {"src": "/arcade-scene.js", "defer": None}])
        self.assertEqual((self.output / "app.js").read_bytes(), (SITE / "app.js").read_bytes())
        self.assertIn("Right Shift", mod_html)
        for capture in RENDER.MOD_CAPTURES:
            self.assertIn(f'src="/mod/{capture}"', mod_html)
            self.assertEqual((self.output / "mod" / capture).read_bytes(),
                             (SITE / "assets/mod" / capture).read_bytes())
        for route in ["index.html", "mod/index.html", "mods/index.html", "docs/modding/index.html"]:
            page = Page()
            page.feed((self.output / route).read_text(encoding="utf-8"))
            links = [attrs for tag, attrs, parents in page.elements
                     if tag == "a" and attrs.get("class") == "official-mod"
                     and any(parent == "nav" for parent, _ in parents)]
            self.assertEqual(len(links), 1)
            self.assertEqual(links[0]["href"], "/mod/")
            self.assertEqual(links[0].get("aria-current"),
                             "page" if route == "mod/index.html" else None)
        self.assertIn((SITE / "site-header.css").read_text(encoding="utf-8"), mod_html)
        for route in ["index.html", "mod/index.html", "mods/index.html", "docs/modding/index.html"]:
            html = (self.output / route).read_text(encoding="utf-8")
            self.assertNotIn("@@", html)
            page = Page()
            page.feed(html)
            links = [attrs for tag, attrs, _ in page.elements
                     if tag == "a" and attrs.get("class") == "marketplace-link"]
            # The marketplace stays reachable at /mods/ but only its own page links to it.
            if route == "mods/index.html":
                self.assertEqual(links, [{"class": "marketplace-link", "href": "/mods/", "aria-current": "page"}])
            else:
                self.assertEqual(links, [])

    def test_gameplay_captures_are_published_unchanged(self):
        """Serve every capture from the repository at its stable /assets/ path."""
        RENDER.build(self.repository, self.output)
        captures = sorted((SITE / "assets/gameplay").iterdir())
        self.assertTrue(captures)
        for capture in captures:
            self.assertEqual((self.output / "assets/gameplay" / capture.name).read_bytes(), capture.read_bytes())

    def test_closing_links_lead_to_real_destinations(self):
        """Offer every direct download and the mod where the home page ends, with no self-links."""
        RENDER.build(self.repository, self.output)
        page = Page()
        page.feed((self.output / "index.html").read_text())
        closing = [attrs for tag, attrs, parents in page.elements
                   if tag == "a" and any(parent == "section" and values.get("class") == "closing"
                                         for parent, values in parents)]
        self.assertEqual({link["data-release-asset"] for link in closing if "data-release-asset" in link},
                         {"windows/x86_64", "linux/x86_64", "macos/arm64", "macos/x86_64", "android/arm64"})
        self.assertEqual([link["href"] for link in closing if "data-release-asset" not in link], ["/mod/"])

    def test_self_hosted_fonts_are_published_with_their_licenses(self):
        """Keep every declared webfont served from /assets/fonts/ and its license in the repository."""
        RENDER.build(self.repository, self.output)
        css = (SITE / "site-header.css").read_text()
        fonts = re.findall(r"/assets/fonts/([\w.-]+\.woff2)", css)
        self.assertTrue(fonts)
        for font in fonts:
            self.assertTrue((self.output / "assets/fonts" / font).is_file(), font)
            family = font.split("-latin-")[0]
            self.assertTrue((SITE / "assets/fonts" / f"{family}-LICENSE.txt").is_file(), family)

    def test_shared_styles_respect_reduced_motion(self):
        """Stop press and hover lifts on every page for visitors who ask for less motion."""
        RENDER.build(self.repository, self.output)
        rule = "@media (prefers-reduced-motion: reduce)"
        self.assertIn(rule, (self.output / "index.html").read_text())
        self.assertIn(rule, (self.output / "mod/index.html").read_text())
        self.assertIn(rule, (self.output / "mods/index.html").read_text())
        themes = list((self.output / "docs/modding").rglob("*.css"))
        self.assertTrue(any(rule in theme.read_text() for theme in themes))

    def test_install_command_is_fully_readable(self):
        """Wrap the Linux command in a multi-line field so no one pastes what they cannot read."""
        RENDER.build(self.repository, self.output)
        page = Page()
        page.feed((self.output / "index.html").read_text())
        fields = [(tag, attrs) for tag, attrs, _ in page.elements if attrs.get("id") == "install-command"]
        self.assertEqual([tag for tag, _ in fields], ["textarea"])
        self.assertIn("readonly", fields[0][1])

    def test_each_capture_appears_once_on_the_home_page(self):
        """Show each capture once, without captions."""
        RENDER.build(self.repository, self.output)
        html = (self.output / "index.html").read_text()
        self.assertEqual(html.count('src="/assets/gameplay/sunset.webp"'), 1)
        self.assertNotIn("<figcaption>", html)

    def test_channel_button_names_its_visible_channel_and_market_scene_is_still(self):
        """Keep the channel button's accessible name starting with its visible label, and the marketplace scene still."""
        RENDER.build(self.repository, self.output)
        for page in ("index.html", "mod/index.html"):
            html = (self.output / page).read_text()
            toggle = html.split('id="channel-toggle"', 1)[1].split("</button>", 1)[0]
            self.assertNotIn("aria-label", toggle.split(">", 1)[0])
            self.assertIn('<span class="mode" id="channel-mode">Beta</span><span class="visually-hidden"> channel, change</span>', toggle)
        market = (self.output / "mods/index.html").read_text()
        self.assertIn("data-still", market)
        self.assertNotIn("scene-bloom", market)
        self.assertNotIn('class="glow"', market)

    def test_mod_page_title_leads_with_the_logotype(self):
        """Keep the accessible title reading Cinnabar Mod with the logotype as its first element."""
        RENDER.build(self.repository, self.output)
        page = Page()
        page.feed((self.output / "mod/index.html").read_text())
        logos = [attrs for tag, attrs, parents in page.elements
                 if tag == "img" and any(parent == "h1" for parent, _ in parents)]
        self.assertEqual([(logo["src"], logo["alt"]) for logo in logos], [("/title.png", "Cinnabar")])

    def test_chapter_cards_name_their_destination(self):
        """Rewrite each generated Previous and Next card with the linked chapter's title."""
        book = self.root / "book"
        (book / "guides").mkdir(parents=True)
        (book / "guides/next.html").write_text("<title>The next one - Fixture Book</title>")
        chapter = book / "guides/first.html"
        chapter.write_text('<a rel="next prefetch" href="../guides/next.html" class="mobile-nav-chapters next" '
                           'title="Next chapter" aria-label="Next chapter" aria-keyshortcuts="Right"><svg></svg></a>')
        RENDER.label_chapter_links(book)
        html = chapter.read_text()
        self.assertIn('aria-label="Next chapter: The next one"', html)
        self.assertIn('<span class="chapter-name">The next one</span><svg></svg>', html)

    def test_docs_link_is_in_the_main_navigation(self):
        """Give desktop and mobile the same accessible link to the book."""
        RENDER.build(self.repository, self.output)
        page = Page()
        page.feed((self.output / "index.html").read_text(encoding="utf-8"))
        links = [(attrs, parents) for tag, attrs, parents in page.elements
                 if tag == "a" and attrs.get("class") == "docs"]
        self.assertEqual(len(links), 1)
        attrs, parents = links[0]
        self.assertEqual(attrs["href"], "/docs/modding/")
        self.assertTrue(any(tag == "nav" and attrs.get("aria-label") == "Main navigation"
                            for tag, attrs in parents))
        self.assertIn("header", [tag for tag, _ in parents])

    def test_home_and_book_share_navigation_markup_and_styles(self):
        """Keep the brand, destinations, icons and navigation styles identical."""
        RENDER.build(self.repository, self.output)
        home = Page()
        home_html = (self.output / "index.html").read_text(encoding="utf-8")
        home.feed(home_html)
        book = Page()
        book.feed((self.output / "docs/modding/guides/getting-started.html").read_text(encoding="utf-8"))

        def header_elements(page):
            """Collect header markup, allowing only the Docs current-page marker to differ."""
            return [(tag, {key: value for key, value in attrs.items() if key != "aria-current"})
                    for tag, attrs, parents in page.elements
                    if any(parent.get("class") == "site-header" for _, parent in parents)]

        self.assertEqual(header_elements(home), header_elements(book))
        docs, = [attrs for tag, attrs, _ in book.elements
                 if tag == "a" and attrs.get("class") == "docs"]
        self.assertEqual(docs["aria-current"], "page")
        shared_styles = (SITE / "site-header.css").read_text(encoding="utf-8")
        self.assertIn(shared_styles, home_html)
        stylesheet, = (self.output / "docs/modding/theme").glob("cinnabar-*.css")
        self.assertTrue(stylesheet.read_text(encoding="utf-8").startswith(shared_styles))

    def test_book_has_no_print_action_or_numbered_sidebar_sections(self):
        """Apply book-wide options without changing the client book configuration."""
        RENDER.build(self.repository, self.output)
        docs = self.output / "docs/modding"
        self.assertNotIn('aria-label="Print this book"', (docs / "index.html").read_text(encoding="utf-8"))
        self.assertFalse((docs / "print.html").exists())
        self.assertNotIn('<strong aria-hidden="true">', (docs / "toc.html").read_text(encoding="utf-8"))

    def test_book_output_theme_and_nested_chapters_leave_source_unchanged(self):
        """Build with the real pinned binary and keep upstream book files untouched."""
        book = self.repository / RENDER.INPUTS["modding"]
        before = {path.relative_to(book): path.read_bytes() for path in book.rglob("*") if path.is_file()}
        RENDER.build(self.repository, self.output)
        docs = self.output / "docs/modding"
        self.assertTrue((docs / "index.html").is_file())
        nested = (docs / "guides/getting-started.html").read_text(encoding="utf-8")
        self.assertIn("Getting started", nested)
        self.assertIn('href="/" aria-label="Cinnabar home"', nested)
        self.assertIn('href="/docs/modding/"', nested)
        stylesheet, = docs.glob("theme/cinnabar-*.css")
        self.assertIn("../" + stylesheet.relative_to(docs).as_posix(), nested)
        self.assertIn("system-ui", stylesheet.read_text(encoding="utf-8"))
        self.assertNotIn("@@", nested + stylesheet.read_text(encoding="utf-8"))
        self.assertTrue((docs / "404.html").is_file())
        favicon, = docs.glob("favicon-*.svg")
        self.assertEqual(favicon.read_bytes(), (self.repository / RENDER.INPUTS["icon"]).read_bytes())
        self.assertEqual(before, {path.relative_to(book): path.read_bytes() for path in book.rglob("*") if path.is_file()})
        stale = docs / "removed-chapter.html"
        stale.write_text("Old chapter")
        RENDER.build(self.repository, self.output)
        self.assertFalse(stale.exists())

    def test_missing_upstream_book_fails_instead_of_publishing_a_fixture(self):
        """Keep test documentation out of normal builds when the input is missing."""
        shutil.rmtree(self.repository / RENDER.INPUTS["modding"])
        with self.assertRaisesRegex(FileNotFoundError, "docs/modding/book.toml"):
            RENDER.build(self.repository, self.output)

    def test_rendered_page_assets_and_mac_first_open_guidance_are_complete(self):
        RENDER.build(self.repository, self.output)
        html = (self.output / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("@@", html)
        page = Page()
        page.feed(html)
        config = self.config_from_output()
        self.assertEqual(page.repository + "/releases/latest", config["release_url"])
        external = [script for script in page.scripts if "src" in script]
        self.assertEqual([script["src"] for script in external],
                         ["/downloads.js", "/app.js", "/activity.js", "/presence.js", "/download-count.js", "/history.js",
                          "/arcade-ui.js", "/arcade-chart.js", "/arcade-scene.js"])
        for name in ("arcade-ui.js", "arcade-chart.js", "arcade-scene.js"):
            self.assertEqual((self.output / name).read_bytes(), (SITE / name).read_bytes())
        for script in external:
            self.assertIn("defer", script)
            self.assertTrue((self.output / script["src"].lstrip("/")).is_file())
        for selection in page.downloads:
            platform, architecture = selection.split("/")
            assets = {**config["assets"], **config["manual_assets"]}
            self.assertIn(architecture, assets[platform])
        self.assertIn("android/arm64", page.downloads)
        self.assertIn('aria-haspopup="menu"', html)
        self.assertEqual(html.count('role="menuitemradio"'), 2)
        self.assertIn("Nightly (Unstable)", html)
        self.assertIn("Built daily from dev and may break.", html)
        self.assertIn("If macOS blocks the first launch", html)
        self.assertIn('class="first-open"', html)
        self.assertEqual((self.output / "title.png").read_bytes(),
                         (self.repository / RENDER.INPUTS["title"]).read_bytes())

    def test_packet_only_capability_metadata_preserves_the_complete_client_contract(self):
        """Support the client's optional packet-only marker without dropping its grant."""
        text = 'grants! {\n    /// Packet authority.\n    #[permission("Session packets", true, true)]\n    pub packets: bool,\n}\n'
        descriptors = RENDER.capability_descriptors(text)
        self.assertEqual(len(descriptors), 1)
        self.assertEqual(descriptors[0]["name"], "packets")
        self.assertTrue(descriptors[0]["packet_only"])
        with self.assertRaisesRegex(ValueError, "unsupported grant type"):
            RENDER.capability_descriptors(text.replace("bool", "u64"))

    def test_marketplace_uses_shared_branding_origin_and_pinned_capability_descriptors(self):
        """A client descriptor change must reach the page without a website snapshot edit."""
        grants = self.repository / RENDER.INPUTS["mod_grants"]
        grants.write_text(grants.read_text(encoding="utf-8").replace('permission("HUD",', 'permission("Fixture HUD",'), encoding="utf-8")
        RENDER.build(self.repository, self.output)
        config = self.config_from_output()
        self.assertEqual(config["marketplace"], {"backend": "http", "api_url": "https://fixture-api.invalid/v1"})
        caps = (self.output / "marketplace-capabilities.js").read_text(encoding="utf-8")
        self.assertIn('"label": "Fixture HUD"', caps)
        page = (self.output / "mods/index.html").read_text(encoding="utf-8")
        self.assertNotIn("@@", page)
        self.assertIn('id="preview-note"', page)
        self.assertEqual(page, (self.output / "marketplace/index.html").read_text(encoding="utf-8"))
        parser = Page()
        parser.feed(page)
        external = [script for script in parser.scripts if "src" in script]
        self.assertIn("/arcade-scene.js", [script["src"] for script in external])
        for script in external:
            self.assertIn("defer", script)
            self.assertTrue((self.output / script["src"].lstrip("/")).is_file())
        for filename in ("marketplace-validator-worker.js", "js-component-bindgen-component.core.wasm", "JCO-LICENSE"):
            self.assertTrue((self.output / "validator" / filename).is_file())

    def test_capability_extractor_refuses_unknown_grant_shapes(self):
        """New client field types must not silently become boolean permissions."""
        text = (self.repository / RENDER.INPUTS["mod_grants"]).read_text(encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "unsupported grant type"):
            RENDER.capability_descriptors(text.replace('pub hud: bool,', 'pub hud: u64,'))

    def test_preview_backend_requires_an_explicit_build_option(self):
        """Production targets the shared API; mock data stays an intentional local preview."""
        RENDER.build(self.repository, self.output, marketplace_backend="mock")
        self.assertEqual(self.config_from_output()["marketplace"]["backend"], "mock")
        with self.assertRaisesRegex(ValueError, "marketplace backend"):
            RENDER.build(self.repository, self.output, marketplace_backend="other")


if __name__ == "__main__":
    unittest.main()
